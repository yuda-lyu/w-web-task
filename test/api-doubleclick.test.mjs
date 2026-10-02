//api-doubleclick.test.mjs：按鈕雙擊防護之後端不變式（spec D16；需 backend，不需 browser）。
//以裸 fetch 直打真後端（繞過前端 runSubmit / promiseUnlock）：HTTP REST（/api/postMessage、/api/ackChannel）與前端資料通道之
//kpFunExt RPC（POST /api/main, w-converhp 封包; 頻道 / 成員之儲存與刪除只經此通道）。
//兩次請求是否於後端重疊取決於時序, 故只斷言與時序無關之不變式:
//  - 同一操作者對同一列 / 同一頻道之並行寫入: 拒絕者只能是 saveInProgress(儲存) / deleteInProgress(刪除) / sendInProgress(發訊), 且資料終態與成功數一致(無幽靈列、無遺失);
//  - 「確保成員列」兩路徑(saveChannel 主責 agent 列、ackChannel 游標列)並行: 同一 (channelId, memberId) 恰 1 列;
//  - 不同操作者互不影響; 依序再送之訊息為新訊息不擋.
//占位與原子性本身由 unit-lockSave、unit-procCore「雙擊防護 / 並行 (D16)」以受控情境驗(結果確定).
//角色: 'sys'（id-for-admin）、'agent-demo'、'agent-api'（皆為 srv.mjs 之非 production 測試權杖, isAdmin='y'）。
//資料: 共用 harness 開場之種子（api 各檔不逐案重置, 同 api-agent）; 本檔新建之頻道與其成員列於 after 刪除,
//訊息不可經 API 刪除（殘留於 demo 頻道, 同 api-agent; e2e 每案重建種子不受影響）。
//跑法: npx mocha test/api-doubleclick.test.mjs --timeout 180000
import assert from 'assert'
import obj2u8arr from 'wsemi/src/obj2u8arr.mjs'
import u8arr2obj from 'wsemi/src/u8arr2obj.mjs'
import { startServersOnce, apiBaseUrl } from './tools/e2e-setup.mjs'


const TOKEN_HUMAN = 'sys' //id-for-admin
const TOKEN_AGENT = 'agent-demo' //agent-demo
const TOKEN_AGENT2 = 'agent-api' //agent-api
const CHANNEL_ID = 'id-for-channel-demo'


//http helper：GET/POST（同 api-agent）
async function apiGet(path, token) {
    const sep = path.includes('?') ? '&' : '?'
    const url = `${apiBaseUrl}${path}${sep}token=${encodeURIComponent(token)}`
    const res = await fetch(url)
    return await res.json()
}

async function apiPost(path, token, body) {
    const res = await fetch(`${apiBaseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, token }),
    })
    return await res.json()
}


//callRpc：直打前端資料通道之 kpFunExt（POST /api/main）, 封包格式對齊 w-converhp client（同 w-web-sso test/api-doubleclick 之 callRpc; 兩專案 w-converhp 2.1.3 / w-serv-webdata 1.1.3 同版）:
//  request  body = obj2u8arr({ func, input: { __sysInputArgs__: [args...], __sysToken__: token } }), Authorization: Bearer <token>(本專案 verifyConn 會驗此權杖)
//  response u8arr2obj → { success: { func, output: { state, msg } } } 或 { error: <msg> }
//回傳 { state, msg }（與 HTTP REST 同形）; kpFunExt 之 reject key 即 msg
async function callRpc(func, args, token) {
    const body = Buffer.from(obj2u8arr({ func, input: { __sysInputArgs__: args, __sysToken__: token } }))
    const res = await fetch(`${apiBaseUrl}/api/main`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
        body,
    })
    const o = u8arr2obj(new Uint8Array(await res.arrayBuffer()))
    if (o && typeof o === 'object' && 'error' in o) {
        return { state: 'error', msg: String(o.error) }
    }
    const out = o && o.success && o.success.output
    if (out && typeof out === 'object') {
        return { state: out.state, msg: out.msg }
    }
    return { state: 'error', msg: `unparseable response: ${JSON.stringify(o)}` }
}


//assertRejectsOnly：拒絕者之 msg 只能是 key（與時序無關: 兩次重疊則第 2 次被拒, 未重疊則皆成功）
function assertRejectsOnly(rs, key) {
    for (const r of rs.filter((x) => x.state !== 'success')) {
        assert.strictEqual(r.msg, key, `拒絕之 key 應為 ${key}, 實得 ${JSON.stringify(r)}`)
    }
}

//channelsByName / membersOf：以 kpFunExt 讀後端權威狀態
async function channelsByName(name) {
    const r = await callRpc('getChannelsList', [], TOKEN_HUMAN)
    assert.strictEqual(r.state, 'success', `getChannelsList 應 success, 得 ${JSON.stringify(r)}`)
    return r.msg.filter((c) => c.name === name)
}

async function membersOf(channelId, memberId) {
    const r = await callRpc('getChannelMembers', [channelId], TOKEN_HUMAN)
    assert.strictEqual(r.state, 'success', `getChannelMembers 應 success, 得 ${JSON.stringify(r)}`)
    return r.msg.filter((m) => m.memberId === memberId)
}

//createChannel：以 kpFunExt 建一個本檔專用頻道（名稱唯一）, 回其 id
async function createChannel(name) {
    const r = await callRpc('saveChannel', [{ name }], TOKEN_HUMAN)
    assert.strictEqual(r.state, 'success', `saveChannel(新增 ${name}) 應 success, 得 ${JSON.stringify(r)}`)
    const cs = await channelsByName(name)
    assert.strictEqual(cs.length, 1, `頻道 ${name} 應恰 1 列`)
    return cs[0].id
}


describe('api-doubleclick（按鈕雙擊防護之後端不變式, D16）', function() {
    this.timeout(180000) //首次起後端含 seedDb

    //本檔新建之頻道名稱（after 刪除其成員列與頻道）
    const namesCreated = []

    before(async function() {
        await startServersOnce({ backendOnly: true })
    })

    after(async function() {
        for (const name of namesCreated) {
            for (const c of await channelsByName(name)) {
                const rm = await callRpc('getChannelMembers', [c.id], TOKEN_HUMAN)
                for (const m of (rm.state === 'success' ? rm.msg : [])) {
                    await callRpc('deleteChannelMember', [m.id], TOKEN_HUMAN)
                }
                await callRpc('deleteChannel', [c.id], TOKEN_HUMAN)
            }
        }
    })


    it('DC-01 postMessage：同一權杖並行送出同頻道 → 拒絕者只能是 sendInProgress, 成功者各恰 1 則、被拒者 0 則', async function() {
        //對應 D16 後端: postMessage 以 lockSave('postMessage', `${userId}:${channelId}`, …, { errKey: 'sendInProgress' })
        const contents = ['dc01-message-a', 'dc01-message-b']
        const rs = await Promise.all(contents.map((content) => apiPost('/api/postMessage', TOKEN_HUMAN, { channelId: CHANNEL_ID, content })))
        assertRejectsOnly(rs, 'sendInProgress')
        assert.ok(rs.some((r) => r.state === 'success'), `至少 1 次成功, 實得 ${JSON.stringify(rs)}`)
        const msgs = (await apiGet(`/api/getRecentMessages?channelId=${CHANNEL_ID}&n=500`, TOKEN_HUMAN)).msg
        contents.forEach((c, i) => {
            const n = msgs.filter((m) => m.content === c).length
            assert.strictEqual(n, rs[i].state === 'success' ? 1 : 0, `「${c}」之訊息數應與其成敗一致, 實得 ${n}`)
        })
    })

    it('DC-02 postMessage：不同權杖並行送出同頻道皆成功; 同一權杖依序再送同樣內容亦成功(新訊息不擋)', async function() {
        //對應 D16 後端: 不同操作者不互擋(kmx 仍序列化同頻道發訊); 依序再送為使用者之新訊息
        const rs = await Promise.all([
            apiPost('/api/postMessage', TOKEN_HUMAN, { channelId: CHANNEL_ID, content: 'dc02-human' }),
            apiPost('/api/postMessage', TOKEN_AGENT, { channelId: CHANNEL_ID, content: 'dc02-agent' }),
        ])
        assert.deepStrictEqual(rs.map((r) => r.state), ['success', 'success'], `不同權杖皆應成功, 實得 ${JSON.stringify(rs)}`)
        const r1 = await apiPost('/api/postMessage', TOKEN_HUMAN, { channelId: CHANNEL_ID, content: 'dc02-resend' })
        const r2 = await apiPost('/api/postMessage', TOKEN_HUMAN, { channelId: CHANNEL_ID, content: 'dc02-resend' })
        assert.deepStrictEqual([r1.state, r2.state], ['success', 'success'], '依序再送皆應成功')
        const msgs = (await apiGet(`/api/getRecentMessages?channelId=${CHANNEL_ID}&n=500`, TOKEN_HUMAN)).msg
        assert.strictEqual(msgs.filter((m) => m.content === 'dc02-resend').length, 2, '依序再送之同樣內容應各成 1 則')
    })

    it('DC-03 saveChannel：同一操作者並行儲存同一新列(同 name) → 拒絕者只能是 saveInProgress, 同名頻道數 = 成功數', async function() {
        //對應 D16 後端: saveChannel 以 lockSave('saveChannel', `${userId}:${row.id || row.name}`); 新列無 id 可比對, 依序重送(未重疊)仍各建 1 列(D16 已知限制)
        const name = 'dc03-new-channel'
        namesCreated.push(name)
        const rs = await Promise.all([
            callRpc('saveChannel', [{ name }], TOKEN_HUMAN),
            callRpc('saveChannel', [{ name }], TOKEN_HUMAN),
        ])
        assertRejectsOnly(rs, 'saveInProgress')
        const nOk = rs.filter((r) => r.state === 'success').length
        assert.ok(nOk >= 1, `至少 1 次成功, 實得 ${JSON.stringify(rs)}`)
        assert.strictEqual((await channelsByName(name)).length, nOk, '同名頻道數應等於成功數(被拒者不得建列)')
    })

    it('DC-04 saveChannel：不同操作者並行對同一頻道設同一 agentId → 皆成功, 主責 agent 成員列恰 1 列', async function() {
        //對應 D7「saveChannel 設 agentId 時確保 agent member 列」+ D16: 先 select 後 insert 以 kmx(`channelMember:${channelId}:${memberId}`) 包成原子
        const name = 'dc04-agent-channel'
        namesCreated.push(name)
        const chId = await createChannel(name)
        const rs = await Promise.all([
            callRpc('saveChannel', [{ id: chId, agentId: 'agent-dc04' }], TOKEN_HUMAN),
            callRpc('saveChannel', [{ id: chId, agentId: 'agent-dc04' }], TOKEN_AGENT),
        ])
        assert.deepStrictEqual(rs.map((r) => r.state), ['success', 'success'], `不同操作者不互擋, 實得 ${JSON.stringify(rs)}`)
        const ms = await membersOf(chId, 'agent-dc04')
        assert.strictEqual(ms.length, 1, `主責 agent 成員列應恰 1 列, 實得 ${ms.length}`)
    })

    it('DC-05 ackChannel：同一權杖並行 ack 同頻道(缺列) → 皆成功, 游標成員列恰 1 列', async function() {
        //對應 D7 ackChannel 對缺列者 upsert + D16: 先 select 後 save / insert 以 kmx 包成原子(ack 非按鈕, 不拒絕)
        const name = 'dc05-ack-channel'
        namesCreated.push(name)
        const chId = await createChannel(name)
        const rs = await Promise.all([
            apiPost('/api/ackChannel', TOKEN_AGENT2, { channelId: chId, lastMessageId: 'dc05-msg-a' }),
            apiPost('/api/ackChannel', TOKEN_AGENT2, { channelId: chId, lastMessageId: 'dc05-msg-b' }),
        ])
        assert.deepStrictEqual(rs.map((r) => r.state), ['success', 'success'], `兩次 ack 皆應成功, 實得 ${JSON.stringify(rs)}`)
        const ms = await membersOf(chId, 'agent-api')
        assert.strictEqual(ms.length, 1, `游標成員列應恰 1 列, 實得 ${ms.length}`)
        assert.ok(['dc05-msg-a', 'dc05-msg-b'].includes(ms[0].lastSeenMessageId), `游標應為兩次 ack 之一, 實得 ${ms[0].lastSeenMessageId}`)
    })

    it('DC-06 saveChannel 設 agentId 與該 agent 之 ackChannel 並行 → 成員列恰 1 列且游標保留(兩路徑共用同一 kmx key)', async function() {
        //對應 D7 同一 (channelId, memberId) 列之兩個「確保存在」路徑 + D16
        const name = 'dc06-cross-channel'
        namesCreated.push(name)
        const chId = await createChannel(name)
        const rs = await Promise.all([
            callRpc('saveChannel', [{ id: chId, agentId: 'agent-demo' }], TOKEN_HUMAN),
            apiPost('/api/ackChannel', TOKEN_AGENT, { channelId: chId, lastMessageId: 'dc06-msg' }),
        ])
        assert.deepStrictEqual(rs.map((r) => r.state), ['success', 'success'], `兩者皆應成功, 實得 ${JSON.stringify(rs)}`)
        const ms = await membersOf(chId, 'agent-demo')
        assert.strictEqual(ms.length, 1, `成員列應恰 1 列, 實得 ${ms.length}`)
        assert.strictEqual(ms[0].lastSeenMessageId, 'dc06-msg', '游標應為 ack 之值')
    })

    it('DC-07 saveChannelMember / deleteChannelMember / deleteChannel：同一操作者並行同一列 → 拒絕者只能是 saveInProgress(儲存) / deleteInProgress(刪除), 終態一致', async function() {
        //對應 D16 後端: 成員儲存以 `${userId}:${row.id || (channelId:memberId)}`、刪除以 `${userId}:${id}` 為列識別; 刪除之占位衝突回 deleteInProgress
        const name = 'dc07-member-channel'
        namesCreated.push(name)
        const chId = await createChannel(name)

        //新成員列並行儲存 → 該成員列數 = 成功數
        const row = { channelId: chId, memberId: 'member-dc07', memberType: 'human', role: 'member' }
        const rsSave = await Promise.all([
            callRpc('saveChannelMember', [{ ...row }], TOKEN_HUMAN),
            callRpc('saveChannelMember', [{ ...row }], TOKEN_HUMAN),
        ])
        assertRejectsOnly(rsSave, 'saveInProgress')
        const ms = await membersOf(chId, 'member-dc07')
        assert.strictEqual(ms.length, rsSave.filter((r) => r.state === 'success').length, '成員列數應等於成功數(被拒者不得建列)')

        //同一成員列並行刪除 → 拒絕者只能是 deleteInProgress, 列已刪除
        const rsDelM = await Promise.all([
            callRpc('deleteChannelMember', [ms[0].id], TOKEN_HUMAN),
            callRpc('deleteChannelMember', [ms[0].id], TOKEN_HUMAN),
        ])
        assertRejectsOnly(rsDelM, 'deleteInProgress')
        assert.ok(rsDelM.some((r) => r.state === 'success'), `至少 1 次成功, 實得 ${JSON.stringify(rsDelM)}`)
        assert.strictEqual((await callRpc('getChannelMembers', [chId], TOKEN_HUMAN)).msg.filter((m) => m.id === ms[0].id).length, 0, '成員列應已刪除')

        //同一頻道並行刪除 → 拒絕者只能是 deleteInProgress, 頻道已刪除
        const rsDelC = await Promise.all([
            callRpc('deleteChannel', [chId], TOKEN_HUMAN),
            callRpc('deleteChannel', [chId], TOKEN_HUMAN),
        ])
        assertRejectsOnly(rsDelC, 'deleteInProgress')
        assert.ok(rsDelC.some((r) => r.state === 'success'), `至少 1 次成功, 實得 ${JSON.stringify(rsDelC)}`)
        assert.strictEqual((await channelsByName(name)).length, 0, '頻道應已刪除')
    })

})
