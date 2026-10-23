//unit-draft: 後台清單頁草稿保護之純邏輯 (src/plugins/mDraft.mjs) —— 多人同時編輯 (原則 10) 規格 §8、V11、E7。
//頁面本身 (LayoutContentChannels.vue / LayoutContentMembers.vue) 於真實瀏覽器以 e2e-channeltask E2E-014 / E2E-015 驗證; 本檔驗證其所依賴之決策函式與前端基準與伺服端一致。
import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { buildBaseline } from 'w-serv-orm/src/baseline.mjs'
import channelsContract from '../src/schema/contracts/channels.mjs'
import getMembersContract from '../src/schema/contracts/channelMembers.mjs'
import { STALE_KEYS, isStaleKey, calcBaseline, sameBaseline, isStale, isDirty, resolveModified, countDuplicates, decidePush, removeFromBaseline } from '../src/plugins/mDraft.mjs'
import { isEditorOpen, onceEditorStopped } from '../src/plugins/mGridEdit.mjs'


const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const chRows = () => [
    { id: 'c1', name: 'alpha', description: '', agentId: '', levels: '', ownerId: 'u1', order: 1, userId: 'u1', timeCreate: 't0', userIdUpdate: 'u1', timeUpdate: 't0', isActive: 'y' },
    { id: 'c2', name: 'beta', description: 'd', agentId: 'a1', levels: 'L', ownerId: 'u1', order: 2, userId: 'u1', timeCreate: 't0', userIdUpdate: 'u1', timeUpdate: 't0', isActive: 'y' },
]


describe('unit-draft', function() {

    describe('isStaleKey: 畫面資料過期類拒收鍵 (提示重新載入, 草稿保留)', function() {
        it('後端轉出之 baselineMismatch / rowNotFound / baselineFormat / 頻道不存在鍵皆屬過期類; 資料規則錯誤不屬之 (修正草稿即可)', function() {
            //規格 §6 拒收鍵 → 本套件語系鍵 (server/procCore.mjs guarded): saveStale / errRowNotFound / errBaselineFormat
            for (let k of ['saveStale', 'errRowNotFound', 'errBaselineFormat', 'errChannelNotFound']) {
                assert.strictEqual(isStaleKey(k), true, k)
            }
            for (let k of ['errChannelNameDuplicate', 'errChannelNameInvalid', 'errMemberDuplicate', 'saveWriteFail', 'saveRolledBack', 'errRowsInvalid', 'saveInProgress', '', null, undefined, 1, {}]) {
                assert.strictEqual(isStaleKey(k), false, String(k))
            }
            assert.strictEqual(STALE_KEYS.length, 4)
        })
    })

    describe('decidePush: 推播到達時之處置 (V11、E7)', function() {
        let base = calcBaseline(chRows(), channelsContract)

        it('無未存修改 → rebuild (照舊重建)', function() {
            let d = decidePush({ isModified: false, ownWriting: false, baseline: base, rows: chRows(), contract: channelsContract })
            assert.deepStrictEqual(d, { action: 'rebuild', stale: false })
        })

        it('E7 / V11: 有未存修改 + 他人已改內容 → keep (不重建編輯中之內容) 且 stale=true (出現提示); 基準由呼叫端維持凍結', function() {
            let others = chRows()
            others[1].name = 'beta-by-other'
            let d = decidePush({ isModified: true, ownWriting: false, baseline: base, rows: others, contract: channelsContract })
            assert.deepStrictEqual(d, { action: 'keep', stale: true })
        })

        it('V11: 有未存修改 + 推播內容全同 (新陣列、只動伺服器專有欄位 / 稽核欄) → keep 且不提示 (不誤報)', function() {
            let same = chRows()
            same[0].timeUpdate = 't9'
            same[0].userIdUpdate = 'someone'
            same[1].order = 99
            let d = decidePush({ isModified: true, ownWriting: false, baseline: base, rows: same, contract: channelsContract })
            assert.deepStrictEqual(d, { action: 'keep', stale: false })
        })

        it('有未存修改 + 他人新增 / 刪除列 → stale=true', function() {
            let added = [...chRows(), { id: 'c3', name: 'gamma', description: '', agentId: '', levels: '', ownerId: '' }]
            assert.strictEqual(decidePush({ isModified: true, ownWriting: false, baseline: base, rows: added, contract: channelsContract }).stale, true)
            assert.strictEqual(decidePush({ isModified: true, ownWriting: false, baseline: base, rows: chRows().slice(0, 1), contract: channelsContract }).stale, true)
        })

        it('自身存檔期間到達之推播視為己寫 → defer (不重建、不提示), 不論有無草稿', function() {
            for (let m of [true, false]) {
                let d = decidePush({ isModified: m, ownWriting: true, baseline: base, rows: [], contract: channelsContract })
                assert.deepStrictEqual(d, { action: 'defer', stale: false })
            }
        })

        it('N1 / task-verify01 #115: 儲存格編輯器開啟中 (已輸入未按 Enter, 尚無 isModified) 視同有草稿 → keep (不重建), 他人已改內容則 stale=true (提示); 內容全同則不提示', function() {
            let others = chRows()
            others[1].name = 'beta-by-other'
            assert.deepStrictEqual(decidePush({ isModified: false, isEditing: true, ownWriting: false, baseline: base, rows: others, contract: channelsContract }), { action: 'keep', stale: true })
            assert.deepStrictEqual(decidePush({ isModified: false, isEditing: true, ownWriting: false, baseline: base, rows: chRows(), contract: channelsContract }), { action: 'keep', stale: false })
        })

        it('N1: 編輯器未開啟且無修改 → 仍 rebuild (isEditing 缺省 / false 皆同); 自身存檔期間優先於編輯器 (defer)', function() {
            assert.deepStrictEqual(decidePush({ isModified: false, isEditing: false, ownWriting: false, baseline: base, rows: chRows(), contract: channelsContract }), { action: 'rebuild', stale: false })
            assert.deepStrictEqual(decidePush({ isModified: false, ownWriting: false, baseline: base, rows: chRows(), contract: channelsContract }), { action: 'rebuild', stale: false })
            assert.deepStrictEqual(decidePush({ isModified: false, isEditing: true, ownWriting: true, baseline: base, rows: chRows(), contract: channelsContract }), { action: 'defer', stale: false })
        })
    })

    describe('resolveModified: 提交 (Enter) 後 rowsChange / 停止事件回呼前之空窗以列內容重算 (外審 sol#4)', function() {
        let base = calcBaseline(chRows(), channelsContract)

        it('旗標為真 → 真; 旗標為假但畫面列已與凍結基準不同 (剛提交之修改, 旗標尚未更新) → 真; 旗標為假且列相同 → 假', function() {
            assert.strictEqual(resolveModified(true, chRows(), base, channelsContract), true)
            let edited = chRows()
            edited[0].description = 'just-committed'
            assert.strictEqual(resolveModified(false, edited, base, channelsContract), true)
            assert.strictEqual(resolveModified(false, chRows(), base, channelsContract), false)
            assert.strictEqual(resolveModified(undefined, chRows(), base, channelsContract), false)
        })

        it('配合 decidePush: 空窗內 (旗標假、編輯器已關、列已改) 收到推播不得 rebuild (剛提交之修改視為草稿 → keep)', function() {
            let edited = chRows()
            edited[0].description = 'just-committed'
            let others = chRows()
            others[1].name = 'beta-by-other'
            let modified = resolveModified(false, edited, base, channelsContract)
            assert.deepStrictEqual(decidePush({ isModified: modified, isEditing: false, ownWriting: false, baseline: base, rows: others, contract: channelsContract }), { action: 'keep', stale: true })
            //對照: 只看旗標 (修前) 會 rebuild, 剛提交之修改丟失
            assert.deepStrictEqual(decidePush({ isModified: false, isEditing: false, ownWriting: false, baseline: base, rows: others, contract: channelsContract }), { action: 'rebuild', stale: false })
        })
    })

    describe('mGridEdit: 儲存格編輯器開啟中之判定與關閉監聽 (N1)', function() {
        //假 ag-grid api: getEditingCells 回目前編輯中儲存格; addEventListener / removeEventListener 記錄監聽; fire 模擬 ag-grid 發出事件
        const mkApi = (editing = []) => {
            let ls = []
            let api = {
                editing,
                getEditingCells: () => api.editing,
                addEventListener: (t, f) => { ls.push([t, f]) },
                removeEventListener: (t, f) => { ls = ls.filter((e) => !(e[0] === t && e[1] === f)) },
                fire: (t) => { ls.slice().forEach((e) => { if (e[0] === t) { e[1]({ type: t }) } }) },
                count: (t) => ls.filter((e) => e[0] === t).length,
            }
            return api
        }
        const mkComp = (api) => ({ getApi: () => api })

        it('isEditorOpen: getEditingCells 非空才為 true; 元件不存在 / 未就緒 (getApi 回 null 或拋錯) / api 無此方法 / 查詢拋錯一律 false (不當作編輯中而卡住推播)', function() {
            assert.strictEqual(isEditorOpen(mkComp(mkApi([{ rowIndex: 0, column: {} }]))), true)
            assert.strictEqual(isEditorOpen(mkComp(mkApi([]))), false)
            assert.strictEqual(isEditorOpen(undefined), false)
            assert.strictEqual(isEditorOpen(null), false)
            assert.strictEqual(isEditorOpen({}), false)
            assert.strictEqual(isEditorOpen({ getApi: () => null }), false)
            assert.strictEqual(isEditorOpen({ getApi: () => { throw new Error('not ready') } }), false)
            assert.strictEqual(isEditorOpen(mkComp({})), false)
            assert.strictEqual(isEditorOpen(mkComp({ getEditingCells: () => { throw new Error('boom') } })), false)
        })

        it('onceEditorStopped: cellEditingStopped 觸發 fn 恰一次並自動移除監聽; 再觸發不重複呼叫', function() {
            let api = mkApi([{}])
            let n = 0
            let dispose = onceEditorStopped(mkComp(api), () => { n++ })
            assert.strictEqual(typeof dispose, 'function')
            assert.strictEqual(api.count('cellEditingStopped'), 1)
            api.fire('cellEditingStarted') //無關事件不觸發
            assert.strictEqual(n, 0)
            api.fire('cellEditingStopped')
            assert.strictEqual(n, 1)
            assert.strictEqual(api.count('cellEditingStopped'), 0, '觸發後移除監聽')
            api.fire('cellEditingStopped')
            assert.strictEqual(n, 1)
            dispose() //觸發後呼叫取消函式無害
            assert.strictEqual(n, 1)
        })

        it('onceEditorStopped: 取消函式移除監聽後不再觸發; api 無法掛接 (元件不存在 / 未就緒 / 缺方法) 回 null (呼叫端不得進入延後狀態)', function() {
            let api = mkApi([{}])
            let n = 0
            let dispose = onceEditorStopped(mkComp(api), () => { n++ })
            dispose()
            assert.strictEqual(api.count('cellEditingStopped'), 0)
            api.fire('cellEditingStopped')
            assert.strictEqual(n, 0)
            assert.strictEqual(onceEditorStopped(undefined, () => {}), null)
            assert.strictEqual(onceEditorStopped({ getApi: () => null }, () => {}), null)
            assert.strictEqual(onceEditorStopped(mkComp({ addEventListener: () => {} }), () => {}), null)
        })
    })

    describe('isStale / isDirty / removeFromBaseline', function() {
        it('isStale: 響應式列 (存取器屬性) 亦可比較 —— 先轉純資料; 列主鍵重複無法算基準 → 視為過期 (不靜默放過)', function() {
            let base = calcBaseline(chRows(), channelsContract)
            let reactive = chRows().map((r) => {
                let o = {}
                for (let k of Object.keys(r)) {
                    let v = r[k]; Object.defineProperty(o, k, { get: () => v, enumerable: true, configurable: true })
                }
                return o
            })
            assert.strictEqual(isStale(reactive, base, channelsContract), false)
            assert.strictEqual(isStale([chRows()[0], chRows()[0]], base, channelsContract), true)
        })

        it('isDirty: 以內容判定 —— 新列 / 改值 / 列數不同為有修改; 值改回原值或僅伺服器專有欄不同為無修改; 非 JSON 值視為有修改', function() {
            let rows = chRows()
            let base = calcBaseline(rows, channelsContract)
            assert.strictEqual(isDirty(rows, base, channelsContract), false)
            let edited = chRows(); edited[0].name = 'x'
            assert.strictEqual(isDirty(edited, base, channelsContract), true)
            edited[0].name = 'alpha'
            assert.strictEqual(isDirty(edited, base, channelsContract), false, '改回原值')
            let srv = chRows(); srv[0].timeUpdate = 'zzz'; srv[1].order = 7
            assert.strictEqual(isDirty(srv, base, channelsContract), false, '伺服器專有欄不入基準')
            assert.strictEqual(isDirty([...chRows(), { id: 'new-1', name: 'n' }], base, channelsContract), true, '新列')
            assert.strictEqual(isDirty(chRows().slice(1), base, channelsContract), true, '列數不同')
            let bad = chRows(); bad[0].name = () => 1
            assert.strictEqual(isDirty(bad, base, channelsContract), true)
        })

        it('isDirty (主鍵集合): 兩份相同內容之重複列 (列數同基準) / 缺 id 而基準恰有字串 id "undefined" / 空 id / 非字串 id → 皆為有修改 (不得因逐列命中而漏判)', function() {
            let base = calcBaseline(chRows(), channelsContract)
            //c1 重複、c2 消失: 列數 2 = 基準 2, 兩列摘要皆命中 c1
            assert.strictEqual(isDirty([chRows()[0], chRows()[0]], base, channelsContract), true, 'c1 重複 / c2 消失')
            //基準含 id 為字串 'undefined' 之單列; 畫面列缺 id、其餘欄相同 (舊實作 String(undefined) 恰命中)
            let odd = [{ id: 'undefined', name: 'n', description: '', agentId: '', levels: '', ownerId: '' }]
            let baseOdd = calcBaseline(odd, channelsContract)
            assert.strictEqual(isDirty(odd, baseOdd, channelsContract), false, '同列同內容無修改')
            let noId = [{ name: 'n', description: '', agentId: '', levels: '', ownerId: '' }]
            assert.strictEqual(isDirty(noId, baseOdd, channelsContract), true, '缺 id')
            assert.strictEqual(isDirty([{ ...odd[0], id: '' }], baseOdd, channelsContract), true, '空 id')
            assert.strictEqual(isDirty([{ ...odd[0], id: 5 }], baseOdd, channelsContract), true, '非字串 id')
        })

        it('countDuplicates: 以 Map 計數 —— "constructor" / "__proto__" / "toString" 等合法字串識別碼亦正確 (物件字面量計數會取到原型成員而漏報 / 誤報); 回傳僅含次數 > 1 者', function() {
            let mk = (ids) => ids.map((memberId, i) => ({ id: `m${i}`, memberId }))
            for (let k of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
                let d = countDuplicates(mk([k, 'x', k]), 'memberId')
                assert.deepStrictEqual([...d], [[k, 2]], `${k} 重複應被計到`)
                assert.strictEqual(countDuplicates(mk([k, 'x']), 'memberId').size, 0, `${k} 單一不誤報`)
            }
            let d3 = countDuplicates(mk(['a', 'b', 'a', 'b', 'a', 'c']), 'memberId')
            assert.deepStrictEqual([...d3].sort(), [['a', 3], ['b', 2]])
            assert.strictEqual(countDuplicates([], 'memberId').size, 0)
            assert.strictEqual(countDuplicates(null, 'memberId').size, 0)
            //空字串 / 缺值亦屬可比較之值 (同為空者視為重複, 與後端 (channelId, memberId) 唯一之判定一致)
            assert.deepStrictEqual([...countDuplicates([{ memberId: '' }, { memberId: '' }], 'memberId')], [['', 2]])
        })

        it('removeFromBaseline: 刪除成功後去掉被刪之 id, 其餘列摘要不變 (凍結基準維持)', function() {
            let base = calcBaseline(chRows(), channelsContract)
            let b2 = removeFromBaseline(base, ['c1'])
            assert.deepStrictEqual(b2.map((e) => e[0]), ['c2'])
            assert.strictEqual(b2[0][1], base[1][1])
            assert.strictEqual(sameBaseline(base, removeFromBaseline(base, [])), true)
        })
    })

    describe('成員頁: 範圍隨頻道 (契約工廠)', function() {
        it('V8: 基準只含本頻道之有效成員列; 他頻道列於 scope 外不入基準; 游標 (lastSeenMessageId) 改變不影響基準 (伺服器專有)', function() {
            let rows = [
                { id: 'm1', channelId: 'X', memberId: 'a', memberType: 'human', role: 'member', lastSeenMessageId: '', isActive: 'y' },
                { id: 'm2', channelId: 'Y', memberId: 'b', memberType: 'human', role: 'member', lastSeenMessageId: '', isActive: 'y' },
            ]
            let ct = getMembersContract('X')
            let base = calcBaseline(rows, ct)
            assert.deepStrictEqual(base.map((e) => e[0]), ['m1'])
            let moved = JSON.parse(JSON.stringify(rows)); moved[0].lastSeenMessageId = 'MSG-1'; moved[1].memberId = 'changed'
            assert.strictEqual(isStale(moved, base, ct), false)
            moved[0].role = 'owner'
            assert.strictEqual(isStale(moved, base, ct), true)
        })
    })

    describe('V10: 前端算之基準 (經 JSON 傳輸之畫面列) = 伺服端算法 (同一份共用模組、同一契約)', function() {
        it('以 JSON 往返前後之列算出之基準相同 (傳輸不改變摘要); 與直接 buildBaseline 相同', function() {
            let rows = chRows()
            let viaJson = JSON.parse(JSON.stringify(rows))
            assert.strictEqual(sameBaseline(calcBaseline(viaJson, channelsContract), buildBaseline(rows, channelsContract)), true)
        })
    })

    describe('R-CONC-08: 清單編輯頁不得再逐列呼叫單筆 API', function() {
        it('src 內無 $fapi.saveChannel( / saveChannelMember( / deleteChannel( / deleteChannelMember( 之呼叫 (單筆 API 保留供外部呼叫, 前端改用清單級 API)', function() {
            let hits = []
            let walk = (dir) => {
                for (let f of fs.readdirSync(dir, { withFileTypes: true })) {
                    let p = path.join(dir, f.name)
                    if (f.isDirectory()) {
                        walk(p); continue
                    }
                    if (!/\.(vue|mjs|js)$/.test(f.name)) {
                        continue
                    }
                    let src = fs.readFileSync(p, 'utf8')
                    for (let m of src.matchAll(/\$fapi\.(saveChannel|saveChannelMember|deleteChannel|deleteChannelMember)\(/g)) {
                        hits.push(`${path.relative(ROOT, p)}:${m[1]}`)
                    }
                }
            }
            walk(path.join(ROOT, 'src'))
            assert.deepStrictEqual(hits, [])
        })

        it('清單頁改用 saveChannels / deleteChannels / saveChannelMembers / deleteChannelMembers 且皆帶 { baseline }', function() {
            let ch = fs.readFileSync(path.join(ROOT, 'src/components/LayoutContentChannels.vue'), 'utf8')
            let mb = fs.readFileSync(path.join(ROOT, 'src/components/LayoutContentMembers.vue'), 'utf8')
            assert.ok(/\$fapi\.saveChannels\(payload, \{ baseline:/.test(ch))
            assert.ok(/\$fapi\.deleteChannels\(idsDb, \{ baseline:/.test(ch))
            assert.ok(/\$fapi\.saveChannelMembers\(cid, payload, \{ baseline:/.test(mb))
            assert.ok(/\$fapi\.deleteChannelMembers\(cid, idsDb, \{ baseline:/.test(mb))
        })
    })
})
