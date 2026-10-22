//unit-draft: 後台清單頁草稿保護之純邏輯 (src/plugins/mDraft.mjs) —— 多人同時編輯 (原則 10) 規格 §8、V11、E7。
//頁面本身 (LayoutContentChannels.vue / LayoutContentMembers.vue) 於真實瀏覽器以 e2e-channeltask E2E-014 / E2E-015 驗證; 本檔驗證其所依賴之決策函式與前端基準與伺服端一致。
import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { buildBaseline } from 'w-serv-orm/src/baseline.mjs'
import channelsContract from '../src/schema/contracts/channels.mjs'
import getMembersContract from '../src/schema/contracts/channelMembers.mjs'
import { STALE_KEYS, isStaleKey, calcBaseline, sameBaseline, isStale, isDirty, countDuplicates, decidePush, removeFromBaseline } from '../src/plugins/mDraft.mjs'


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
