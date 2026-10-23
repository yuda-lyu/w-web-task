//api-concurrency.test.mjs：多人同時編輯 (原則 10) 之清單級 API 契約（需 backend，不需 browser）。
//以裸 fetch 直打真後端之資料通道 kpFunExt (POST /api/main, w-converhp 封包; 前端 $fapi 同一路徑), 驗證經「實際傳輸」後:
//  V10 前端自算之基準 (buildBaseline, 對 RPC 回傳之列) = 伺服端表鎖內新鮮讀取所算;
//  V1 / V12 舊畫面存檔整次拒收零寫入 (拒收鍵 saveStale 等為本套件語系鍵); V13 格式不識之基準不降級; V6 / V7 單筆 API 只改不增、刪除未命中回 errRowNotFound;
//  清單 API 之回傳 rows (供前端取新基準) 與資料庫一致; 同一操作者並行清單存檔之占位 (saveInProgress); 客戶端夾帶之 opt 鍵不生效。
//後端單元層之完整規則 (人為延遲、補償還原、E2/E3/O1～O8) 見 test/unit-procCoreConcurrency.test.mjs。
//角色: 'sys' (id-for-admin; srv.mjs 之非 production 測試權杖)。資料: 共用 harness 開場之種子, 本檔新建之頻道以唯一前綴命名, 於 after 以清單刪除 API 清除 (成員列連帶刪除)。
//跑法: npx mocha test/api-concurrency.test.mjs --timeout 180000
import assert from 'assert'
import { buildBaseline } from 'w-serv-orm/src/baseline.mjs'
import { startServersOnce } from './tools/e2e-setup.mjs'
import { callRpc } from './tools/apiProbe.mjs'
import channelsContract from '../src/schema/contracts/channels.mjs'
import getMembersContract from '../src/schema/contracts/channelMembers.mjs'


const TOKEN = 'sys'
const PREFIX = `conc-${Date.now()}`


let rpc = async (func, args) => await callRpc(func, args, TOKEN)
let ok = async (func, args) => {
    let r = await rpc(func, args)
    assert.strictEqual(r.state, 'success', `${func} 應 success, 得 ${JSON.stringify(r)}`)
    return r.msg
}
let err = async (func, args) => {
    let r = await rpc(func, args)
    assert.strictEqual(r.state, 'error', `${func} 應 error, 得 ${JSON.stringify(r)}`)
    return r.msg
}

let loadMembers = async (channelId) => {
    let rows = await ok('getChannelMembers', [channelId])
    return { rows, baseline: buildBaseline(rows, getMembersContract(channelId)) }
}
//畫面所見之列 (前端等價: RPC 回傳, 經傳輸後自算基準): 頻道基準之範圍為整表 (伺服端新鮮讀取 select({}); 種子頻道一併納入),
//故以整表之畫面列算; 本檔只修改以 PREFIX 命名之列 (ownRows)
let loadAllChannels = async () => {
    let rows = await ok('getChannelsList', [])
    return { rows, baseline: buildBaseline(rows, channelsContract), ownRows: rows.filter((c) => String(c.name).startsWith(PREFIX)) }
}
let clone = (o) => JSON.parse(JSON.stringify(o))


describe('api-concurrency（多人同時編輯之清單級 API 契約, 原則 10）', function() {
    this.timeout(180000)

    before(async function() {
        await startServersOnce({ backendOnly: true })
    })

    after(async function() {
        let rs = (await ok('getChannelsList', [])).filter((c) => String(c.name).startsWith(PREFIX))
        if (rs.length > 0) {
            await rpc('deleteChannels', [rs.map((c) => c.id)])
        }
    })


    it('V10: 經實際傳輸之列所算基準 = 伺服端新鮮讀取所算 —— 整表基準與清單成員基準各以「未改動」存檔, 全數 unchanged 且零修改', async function() {
        //以整表 (含種子頻道) 存檔: 若前後端摘要不一致, 此處將 saveStale 而非成功
        let A = await loadAllChannels()
        let r = await ok('saveChannels', [clone(A.rows), { baseline: A.baseline }])
        assert.strictEqual(r.unchanged, A.rows.length, '全部列摘要相符')
        assert.deepStrictEqual(r.modified, [])
        assert.deepStrictEqual(r.inserted, [])
        assert.deepStrictEqual(r.deleted, [])
        //成員 (種子 demo 頻道之 agent-demo)
        let M = await loadMembers('id-for-channel-demo')
        let r2 = await ok('saveChannelMembers', ['id-for-channel-demo', clone(M.rows), { baseline: M.baseline }])
        assert.strictEqual(r2.unchanged, M.rows.length)
        assert.deepStrictEqual(r2.modified, [])
    })

    it('清單存檔: 新增 / 修改 / 回傳 rows 與資料庫一致 (供前端取新基準, 不以送出值當新基準); 新列不帶 id 由後端產生', async function() {
        let r = await ok('saveChannels', [[{ name: `${PREFIX}-a`, description: 'a<b', levels: '', agentId: '', ownerId: 'u' }, { name: `${PREFIX}-b` }]])
        assert.strictEqual(r.inserted.length, 2)
        //回傳 rows = 寫入後整表; 與 getChannelsList 一致
        let list = await ok('getChannelsList', [])
        assert.deepStrictEqual(buildBaseline(r.rows, channelsContract), buildBaseline(list, channelsContract), '回傳 rows 即伺服端寫入後之真相')
        //description 經 clearXSS 之改寫與否皆以伺服端為準: 用回傳之列當基準後再存檔不得被自己誤拒
        let a = r.rows.find((c) => c.name === `${PREFIX}-a`)
        let again = await ok('saveChannels', [clone(r.rows), { baseline: buildBaseline(r.rows, channelsContract) }])
        assert.strictEqual(again.unchanged, r.rows.length)
        assert.ok(a.id)
    })

    it('V1 / V12: 兩位管理員以同一基準 —— A 存後 B 之整份清單 (含多列修改) 被整次拒收 saveStale, 零寫入', async function() {
        let A = await loadAllChannels()
        let B = await loadAllChannels()
        let own = (rows) => rows.map((r, i) => [r, i]).filter(([r]) => String(r.name).startsWith(PREFIX)).map(([, i]) => i)
        let ia = own(A.rows)
        assert.ok(ia.length >= 2, '前置: 本檔已建至少 2 列')
        let ra = clone(A.rows); ra[ia[0]].description = 'by-A'
        await ok('saveChannels', [ra, { baseline: A.baseline }])
        let rb = clone(B.rows); rb[ia[0]].description = 'by-B-0'; rb[ia[1]].description = 'by-B-1'
        let before = await ok('getChannelsList', [])
        let key = await err('saveChannels', [rb, { baseline: B.baseline }])
        assert.strictEqual(key, 'saveStale')
        let after = await ok('getChannelsList', [])
        assert.deepStrictEqual(after, before, '被拒後零寫入 (含稽核欄)')
    })

    it('V13: 格式或版本不識之基準 → errBaselineFormat 且零寫入, 不降級為不帶基準 (null、字串、未知版本、重複 id)', async function() {
        let A = await loadAllChannels()
        let before = await ok('getChannelsList', [])
        let own0 = A.ownRows[0]
        let rows = clone(A.rows); rows.find((r) => r.id === own0.id).description = 'must-not-write'
        for (let bad of [null, 'x', [['a', 'h2:0123456789abcd']], [['a']], [[own0.id, 'h1:0123456789abcd'], [own0.id, 'h1:0123456789abcd']]]) {
            assert.strictEqual(await err('saveChannels', [rows, { baseline: bad }]), 'errBaselineFormat', JSON.stringify(bad))
            assert.strictEqual(await err('deleteChannels', [[own0.id], { baseline: bad }]), 'errBaselineFormat', JSON.stringify(bad))
        }
        assert.deepStrictEqual(await ok('getChannelsList', []), before)
    })

    it('V6 / V7 (外部呼叫: 單筆 API, 不帶基準): 修改已刪之列 → errRowNotFound 不復活; 刪除不存在之列 → errRowNotFound; 清單 API 不帶基準亦然', async function() {
        let created = await ok('saveChannels', [[{ name: `${PREFIX}-gone` }]])
        let gone = created.rows.find((c) => c.name === `${PREFIX}-gone`)
        await ok('deleteChannel', [gone.id])
        assert.strictEqual(await err('saveChannel', [{ ...gone, description: 'revive?' }]), 'errRowNotFound')
        assert.strictEqual(await err('saveChannels', [[{ id: gone.id, description: 'revive?' }]]), 'errRowNotFound')
        assert.strictEqual(await err('deleteChannel', [gone.id]), 'errRowNotFound')
        assert.strictEqual(await err('deleteChannels', [[gone.id]]), 'errRowNotFound')
        let list = await ok('getChannelsList', [])
        assert.ok(!list.some((c) => c.id === gone.id), '列不得復活')
    })

    it('O5 / O6 (原則 4: 所有入口一致): 頻道名稱必填且不重複於後端強制; 客戶端夾帶之 userId / isActive 與 opt 鍵不生效', async function() {
        let r = await ok('saveChannels', [[{ name: `${PREFIX}-own` }]])
        let own = r.rows.find((c) => c.name === `${PREFIX}-own`)
        assert.strictEqual(await err('saveChannel', [{ name: `${PREFIX}-own` }]), 'errChannelNameDuplicate')
        assert.strictEqual(await err('saveChannel', [{ name: '' }]), 'errChannelNameInvalid')
        await ok('saveChannels', [[{ id: own.id, userId: 'forged', isActive: 'n', timeCreate: '1999-01-01T00:00:00.000+08:00', description: 'd' }], { userId: 'forged-opt', mustExist: false, keepUserId: true }])
        let after = (await ok('getChannelsList', [])).find((c) => c.id === own.id)
        assert.ok(after, 'isActive 未被改為 n, 頻道仍在清單')
        assert.strictEqual(after.userId, own.userId)
        assert.strictEqual(after.timeCreate, own.timeCreate)
        assert.strictEqual(after.description, 'd')
    })

    it('成員清單: 新增 / 重複拒收 (errMemberDuplicate) / channelId 不符 (errMemberChannelMismatch) / 舊基準被拒; 刪頻道連帶刪成員列', async function() {
        let r = await ok('saveChannels', [[{ name: `${PREFIX}-mem`, agentId: 'agent-conc' }]])
        let ch = r.rows.find((c) => c.name === `${PREFIX}-mem`)
        let M = await loadMembers(ch.id) //主責 agent 成員列已補建
        assert.strictEqual(M.rows.length, 1)
        assert.strictEqual(M.rows[0].memberId, 'agent-conc')
        let add = await ok('saveChannelMembers', [ch.id, [...clone(M.rows), { channelId: ch.id, memberId: 'human-conc', memberType: 'human', role: 'member' }], { baseline: M.baseline }])
        assert.strictEqual(add.inserted.length, 1)
        assert.strictEqual(add.rows.length, 2, '回傳 rows 為寫入後該頻道有效成員')
        //重複
        assert.strictEqual(await err('saveChannelMembers', [ch.id, [{ memberId: 'human-conc' }]]), 'errMemberDuplicate')
        assert.strictEqual(await err('saveChannelMember', [{ channelId: ch.id, memberId: 'human-conc' }]), 'errMemberDuplicate')
        //channelId 不符
        assert.strictEqual(await err('saveChannelMembers', [ch.id, [{ channelId: 'other', memberId: 'x' }]]), 'errMemberChannelMismatch')
        //舊基準被拒
        let rows = clone(add.rows); rows[0].role = 'owner'
        assert.strictEqual(await err('saveChannelMembers', [ch.id, rows, { baseline: M.baseline }]), 'saveStale')
        //刪頻道連帶刪成員列
        await ok('deleteChannels', [[ch.id]])
        let after = await rpc('getChannelMembers', [ch.id])
        assert.deepStrictEqual(after.msg, [], '成員列連帶刪除')
        //對已刪頻道之成員存檔 / 發訊被拒
        assert.strictEqual(await err('saveChannelMembers', [ch.id, [{ memberId: 'x' }]]), 'errChannelNotFound')
        assert.strictEqual(await err('postMessage', [ch.id, 'to-deleted']), 'errChannelNotFound')
    })

    it('Q2 刪頻道 (經真後端實際傳輸): 該頻道之訊息與任務 (含進行中) 移入封存表 —— getArchivedTasks / getArchivedMessages 讀得到, 熱表查詢為空, getStats 不計, agent 對已移走之任務得 errTaskNotFound', async function() {
        let r = await ok('saveChannels', [[{ name: `${PREFIX}-arch` }]])
        let ch = r.rows.find((c) => c.name === `${PREFIX}-arch`)
        let stBefore = await ok('getStats', [])
        await ok('postMessage', [ch.id, 'q2-plain'])
        let t1 = (await ok('postMessage', [ch.id, 'q2-pending', { asTask: true }])).task
        let t2 = (await ok('postMessage', [ch.id, 'q2-running', { asTask: true }])).task
        await ok('claimTask', [t2.id])
        let stMid = await ok('getStats', [])
        assert.ok(stMid.messages >= stBefore.messages + 3 && stMid.tasks.total >= stBefore.tasks.total + 2, '前置: 熱表統計含本頻道之 3 則訊息與 2 個任務')

        await ok('deleteChannels', [[ch.id]])

        //封存表讀得到 (進行中任務維持原狀態)
        let at = await ok('getArchivedTasks', [ch.id, 50, 'asc'])
        assert.deepStrictEqual(at.map((t) => t.id).sort(), [t1.id, t2.id].sort())
        assert.strictEqual(at.find((t) => t.id === t2.id).state, 'running')
        assert.strictEqual(at.find((t) => t.id === t1.id).state, 'pending')
        let am = await ok('getArchivedMessages', [ch.id, 50])
        assert.strictEqual(am.length, 3)
        assert.ok(am.some((m) => m.content === 'q2-plain'))
        //熱表查詢為空
        assert.deepStrictEqual(await ok('getTasks', [ch.id, 50]), [])
        assert.deepStrictEqual(await ok('getMessages', [ch.id, 50]), [])
        //統計不計孤兒: 較刪除前至少少 3 則訊息 / 2 個任務, 且不高於本頻道建立前
        let stAfter = await ok('getStats', [])
        assert.ok(stMid.messages - stAfter.messages >= 3 && stMid.tasks.total - stAfter.tasks.total >= 2, '熱表統計已不含該頻道之訊息與任務')
        assert.ok(stAfter.messages <= stBefore.messages && stAfter.tasks.total <= stBefore.tasks.total, '刪頻道後統計不高於建頻道前 (無孤兒)')
        assert.strictEqual(stAfter.channels, stBefore.channels - 1, 'stBefore 於建頻道後取得; 刪除後頻道數少 1')
        //agent 對已移走之任務 / 已刪頻道之操作被拒
        assert.strictEqual(await err('claimTask', [t1.id]), 'errTaskNotFound')
        assert.strictEqual(await err('respondTask', [t2.id, 'late', 'done']), 'errTaskNotFound')
        assert.strictEqual(await err('postMessage', [ch.id, 'to-deleted']), 'errChannelNotFound')
    })

    it('同一操作者並行清單存檔 → 第 2 次只能被占位 key saveInProgress 拒絕 (時序無關不變式); 資料終態一致', async function() {
        let rs = await Promise.all([
            rpc('saveChannels', [[{ name: `${PREFIX}-par` }]]),
            rpc('saveChannels', [[{ name: `${PREFIX}-par` }]]),
        ])
        let oks = rs.filter((r) => r.state === 'success')
        assert.ok(oks.length >= 1, '至少 1 次成功')
        for (let r of rs.filter((x) => x.state !== 'success')) {
            assert.ok(['saveInProgress', 'errChannelNameDuplicate'].includes(r.msg), `被拒者只能是占位或名稱重複, 實得 ${JSON.stringify(r)}`)
        }
        let n = (await ok('getChannelsList', [])).filter((c) => c.name === `${PREFIX}-par`).length
        assert.strictEqual(n, 1, '同名頻道恰 1 列 (後端名稱唯一 + 占位)')
    })
})
