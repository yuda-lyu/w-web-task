//api-agent.test.mjs：對外 agent HTTP 生命週期契約測試（需 backend，不需 browser）。
//以裸 fetch 打 apiBaseUrl，驗證 HTTP REST API 契約（§6.1 對應 spec 設計總覽）。
//雙角色：human token='sys'（id-for-admin）, agent token='agent-demo'（id=agent-demo）。
//seed 由 startServersOnce 的 seedDb (g.initialData) 完成，含 demo channel + welcome message。
import assert from 'assert'
import { startServersOnce, cleanup, apiBaseUrl } from './e2e-setup.mjs'


const TOKEN_HUMAN = 'sys'         //id-for-admin（人類）
const TOKEN_AGENT = 'agent-demo'  //agent-demo（agent）
const CHANNEL_ID = 'id-for-channel-demo'


//http helper：GET/POST
async function apiGet(path, token) {
    const sep = path.includes('?') ? '&' : '?'
    const url = `${apiBaseUrl}${path}${sep}token=${encodeURIComponent(token)}`
    const res = await fetch(url)
    return await res.json()
}

async function apiPost(path, token, body) {
    const url = `${apiBaseUrl}${path}`
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, token }),
    })
    return await res.json()
}


describe('api-agent（HTTP 生命週期契約）', function() {
    this.timeout(180000) //首次起後端含 seedDb

    before(async function() {
        await startServersOnce({ backendOnly: true })
    })

    //快照 id，跨 it 傳遞（mocha it 依序執行）
    let taskId = ''
    let taskMessageId = ''


    // ── getChannels ─────────────────────────────────────────────────────────────
    it('getChannels?agentId=agent-demo → 含 demo 頻道且有 lastSeenMessageId 欄位', async function() {
        //對應 spec §6.1 getChannels：agentId 過濾；每筆附 lastSeenMessageId 游標
        const r = await apiGet(`/api/getChannels?agentId=agent-demo`, TOKEN_AGENT)
        assert.strictEqual(r.state, 'success', `getChannels 應 success，得 ${JSON.stringify(r)}`)
        const channels = r.msg
        assert.ok(Array.isArray(channels) && channels.length > 0, '應有頻道')
        const demo = channels.find((c) => c.id === CHANNEL_ID)
        assert.ok(demo, 'demo 頻道應存在')
        assert.ok('lastSeenMessageId' in demo, 'demo 頻道應有 lastSeenMessageId 欄位')
    })


    // ── postMessage asTask=true ────────────────────────────────────────────────
    it('postMessage(human, asTask=true) → task.state=pending, message.kind=task, message.taskId 指回 task', async function() {
        //對應 spec §6.3 asTask=true 契約 + §4 原子寫入
        const r = await apiPost('/api/postMessage', TOKEN_HUMAN, {
            channelId: CHANNEL_ID,
            content: 'Please do this task',
            asTask: true,
        })
        assert.strictEqual(r.state, 'success', `postMessage 應 success，得 ${JSON.stringify(r)}`)
        const { message, task } = r.msg
        assert.strictEqual(message.kind, 'task', 'message.kind 應為 task')
        assert.strictEqual(task.state, 'pending', 'task.state 應為 pending')
        assert.strictEqual(message.taskId, task.id, 'message.taskId 應指回 task.id')
        assert.strictEqual(task.payload, 'Please do this task', 'task.payload 應等於 content')
        taskId = task.id
        taskMessageId = message.id
    })


    // ── getRecentTasks state=pending ───────────────────────────────────────────
    it('getRecentTasks?state=pending&order=asc 含新任務', async function() {
        //對應 spec §6.1 getRecentTasks state 過濾 + order=asc（agent FIFO）
        const r = await apiGet(`/api/getRecentTasks?channelId=${CHANNEL_ID}&state=pending&order=asc`, TOKEN_AGENT)
        assert.strictEqual(r.state, 'success')
        const tasks = r.msg
        assert.ok(Array.isArray(tasks) && tasks.length > 0, '應有 pending 任務')
        const found = tasks.find((t) => t.id === taskId)
        assert.ok(found, '新任務應在 pending 清單中')
    })


    // ── claimTask ──────────────────────────────────────────────────────────────
    it('claimTask(agent) → running + assigneeId=agent-demo', async function() {
        //對應 spec §5 claimTask: pending→running；assigneeId 取自 token（spec §7 身分權威）
        const r = await apiPost('/api/claimTask', TOKEN_AGENT, { taskId })
        assert.strictEqual(r.state, 'success')
        const t = r.msg
        assert.strictEqual(t.state, 'running')
        assert.strictEqual(t.assigneeId, 'agent-demo', 'assigneeId 應為 token 解析之 agent-demo')
    })

    it('重複 claimTask → errTaskAlreadyClaimed', async function() {
        //對應 spec §5 並發守衛 D6
        const r = await apiPost('/api/claimTask', TOKEN_AGENT, { taskId })
        assert.strictEqual(r.state, 'error')
        assert.strictEqual(r.msg, 'errTaskAlreadyClaimed')
    })


    // ── respondTask done ───────────────────────────────────────────────────────
    it('respondTask(agent, done) → done + result + resultMessageId', async function() {
        //對應 spec §5 respondTask→done；§4 taskReply message 寫入
        const r = await apiPost('/api/respondTask', TOKEN_AGENT, {
            taskId,
            result: 'Task completed successfully',
            state: 'done',
        })
        assert.strictEqual(r.state, 'success')
        const t = r.msg
        assert.strictEqual(t.state, 'done')
        assert.strictEqual(t.result, 'Task completed successfully')
        assert.ok(t.resultMessageId, 'resultMessageId 應有值')
    })

    it('重複 respondTask → errTaskNotRunning', async function() {
        //對應 spec §5 respondTask 鎖內守衛：state==='running' 否則 errTaskNotRunning
        const r = await apiPost('/api/respondTask', TOKEN_AGENT, {
            taskId,
            result: 'second respond',
            state: 'done',
        })
        assert.strictEqual(r.state, 'error')
        assert.strictEqual(r.msg, 'errTaskNotRunning')
    })


    // ── getTask ─────────────────────────────────────────────────────────────────
    it('getTask → done（終態）', async function() {
        //對應 spec §6.1 getTask 查單一任務
        const r = await apiGet(`/api/getTask?taskId=${taskId}`, TOKEN_AGENT)
        assert.strictEqual(r.state, 'success')
        assert.strictEqual(r.msg.state, 'done')
    })


    // ── getRecentMessages ──────────────────────────────────────────────────────
    it('getRecentMessages → 含 task+taskReply，時序 asc；afterId=最後一則 → 回空', async function() {
        //對應 spec §6.1 getRecentMessages 時序 asc；afterId 游標
        const r = await apiGet(`/api/getRecentMessages?channelId=${CHANNEL_ID}&n=50`, TOKEN_HUMAN)
        assert.strictEqual(r.state, 'success')
        const msgs = r.msg
        assert.ok(Array.isArray(msgs) && msgs.length >= 2, '應至少 2 筆訊息')
        //時序 asc 驗證（id 字典序遞增）
        for (let i = 1; i < msgs.length; i++) {
            assert.ok(msgs[i - 1].id <= msgs[i].id, `訊息應時序 asc: ${msgs[i - 1].id} vs ${msgs[i].id}`)
        }
        //找 task + taskReply kind
        const kinds = msgs.map((m) => m.kind)
        assert.ok(kinds.includes('task'), '應含 task 訊息')
        assert.ok(kinds.includes('taskReply'), '應含 taskReply 訊息')

        //afterId=最後一則 → 回空
        const lastId = msgs[msgs.length - 1].id
        const r2 = await apiGet(`/api/getRecentMessages?channelId=${CHANNEL_ID}&afterId=${lastId}`, TOKEN_HUMAN)
        assert.strictEqual(r2.state, 'success')
        assert.deepStrictEqual(r2.msg, [], 'afterId=最後一則應回空陣列')
    })


    // ── resetTask 對 done → errTaskNotResettable ───────────────────────────────
    it('resetTask 對 done → errTaskNotResettable', async function() {
        //對應 spec §5 resetTask 守衛：state∈{error,running} 才可重置
        const r = await apiPost('/api/resetTask', TOKEN_HUMAN, { taskId })
        assert.strictEqual(r.state, 'error')
        assert.strictEqual(r.msg, 'errTaskNotResettable')
    })


    // ── ackChannel ─────────────────────────────────────────────────────────────
    it('ackChannel → 成功；之後 getChannels 該頻道 cursor = 推進值', async function() {
        //對應 spec §6.1 ackChannel 推進游標；spec §3.2 channelMembers.lastSeenMessageId
        //取最新一則訊息 id 作為推進值
        const msgsR = await apiGet(`/api/getRecentMessages?channelId=${CHANNEL_ID}&n=50`, TOKEN_AGENT)
        const lastMsgId = msgsR.msg[msgsR.msg.length - 1].id

        const r = await apiPost('/api/ackChannel', TOKEN_AGENT, {
            channelId: CHANNEL_ID,
            lastMessageId: lastMsgId,
        })
        assert.strictEqual(r.state, 'success')
        assert.deepStrictEqual(r.msg, { ok: true })

        //驗 getChannels 游標已推進
        const chR = await apiGet(`/api/getChannels?agentId=agent-demo`, TOKEN_AGENT)
        const demo = chR.msg.find((c) => c.id === CHANNEL_ID)
        assert.strictEqual(demo.lastSeenMessageId, lastMsgId, 'getChannels 游標應等於推進值')
    })


    // ── 壞 token ───────────────────────────────────────────────────────────────
    it('壞 token → state=error', async function() {
        //對應 spec §7 認證模型：getUserByToken 失敗 → errUserNotFound
        const r = await apiGet(`/api/getChannels`, 'bad-invalid-token-xyz')
        assert.strictEqual(r.state, 'error', '壞 token 應回 error')
    })


    // ── error 流程（完整 pending→running→error→pending→running）────────────────
    it('error 流程：新任務 → claim → respondTask(error) → resetTask(error→pending) → 重新 claim', async function() {
        //對應 spec §5 任務狀態機完整路徑（含 error 分支與 resetTask 標準重試）
        //1. 建新任務
        const postR = await apiPost('/api/postMessage', TOKEN_HUMAN, {
            channelId: CHANNEL_ID,
            content: 'Error flow task',
            asTask: true,
        })
        assert.strictEqual(postR.state, 'success')
        const errTaskId = postR.msg.task.id

        //2. claim → running
        const claimR = await apiPost('/api/claimTask', TOKEN_AGENT, { taskId: errTaskId })
        assert.strictEqual(claimR.state, 'success')
        assert.strictEqual(claimR.msg.state, 'running')

        //3. respondTask error
        const errR = await apiPost('/api/respondTask', TOKEN_AGENT, {
            taskId: errTaskId,
            result: '執行失敗說明',
            state: 'error',
            errorKey: 'someErrKey',
        })
        assert.strictEqual(errR.state, 'success')
        assert.strictEqual(errR.msg.state, 'error')
        assert.strictEqual(errR.msg.result, '執行失敗說明')

        //4. resetTask: error→pending，清殘留
        const resetR = await apiPost('/api/resetTask', TOKEN_AGENT, { taskId: errTaskId })
        assert.strictEqual(resetR.state, 'success')
        assert.strictEqual(resetR.msg.state, 'pending')
        assert.strictEqual(resetR.msg.result, '')
        assert.strictEqual(resetR.msg.errorKey, '')
        assert.strictEqual(resetR.msg.assigneeId, '')

        //5. 可重新 claim
        const reclaimR = await apiPost('/api/claimTask', TOKEN_AGENT, { taskId: errTaskId })
        assert.strictEqual(reclaimR.state, 'success')
        assert.strictEqual(reclaimR.msg.state, 'running')
    })


    // ── F1：token 放 POST body（不帶 query）的 postMessage 成功 ────────────────
    it('F1: token 放 POST body（不帶 query）的 postMessage 成功', async function() {
        //對應 spec §6.1 handler：token = query.token || payload.token
        const url = `${apiBaseUrl}/api/postMessage`
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            //token 只放 body，不帶 ?token= query
            body: JSON.stringify({ channelId: CHANNEL_ID, content: 'body token test', token: TOKEN_HUMAN }),
        })
        const r = await res.json()
        assert.strictEqual(r.state, 'success', `F1: token in body 應 success，得 ${JSON.stringify(r)}`)
    })


    // ── F3：asTask 字串值 ─────────────────────────────────────────────────────
    it('F3: asTask:"false"（字串）不開任務；asTask:"true"（字串）開任務', async function() {
        //對應 spec §6.3；WWebTask.mjs 直接取 payload.asTask → 字串傳入 procCore → cbol 轉換
        const r1 = await apiPost('/api/postMessage', TOKEN_HUMAN, {
            channelId: CHANNEL_ID,
            content: 'text only by string false',
            asTask: 'false',
        })
        assert.strictEqual(r1.state, 'success')
        assert.strictEqual(r1.msg.task, undefined, 'asTask:"false" 不應開任務')

        const r2 = await apiPost('/api/postMessage', TOKEN_HUMAN, {
            channelId: CHANNEL_ID,
            content: 'task by string true',
            asTask: 'true',
        })
        assert.strictEqual(r2.state, 'success')
        assert.ok(r2.msg.task, 'asTask:"true" 應開任務')
        assert.strictEqual(r2.msg.task.state, 'pending')
    })


    // ── F2：getRecentTasks n=0 asc/desc 對稱 ─────────────────────────────────
    it('F2: getRecentTasks n=0 asc 與 desc 筆數相同（對稱）', async function() {
        //對應 spec §6.1 n=0 正規化為預設（procCore getTasks）；asc/desc 取同源資料故筆數相同
        const ascR = await apiGet(`/api/getRecentTasks?channelId=${CHANNEL_ID}&n=0&order=asc`, TOKEN_AGENT)
        const descR = await apiGet(`/api/getRecentTasks?channelId=${CHANNEL_ID}&n=0&order=desc`, TOKEN_AGENT)
        assert.strictEqual(ascR.state, 'success')
        assert.strictEqual(descR.state, 'success')
        assert.strictEqual(ascR.msg.length, descR.msg.length, 'n=0 asc/desc 筆數應對稱')
    })


    // ── G：封存冷表查詢端點 (spec D12 方向②) ─────────────────────────────────
    it('G1: getArchivedTasks/getArchivedMessages 契約（成功回陣列；缺 channelId 回 errChannelIdInvalid；壞 token 拒絕）', async function() {
        //對應 spec D12：冷表查詢面。pristine 種子未達封存齡 → 冷表為空陣列（契約驗回傳形狀非內容）
        const t1 = await apiGet(`/api/getArchivedTasks?channelId=${CHANNEL_ID}&n=20&order=desc`, TOKEN_AGENT)
        assert.strictEqual(t1.state, 'success')
        assert.ok(Array.isArray(t1.msg), 'getArchivedTasks 應回陣列')

        const m1 = await apiGet(`/api/getArchivedMessages?channelId=${CHANNEL_ID}&n=20`, TOKEN_AGENT)
        assert.strictEqual(m1.state, 'success')
        assert.ok(Array.isArray(m1.msg), 'getArchivedMessages 應回陣列')

        const t2 = await apiGet(`/api/getArchivedTasks?n=20`, TOKEN_AGENT)
        assert.strictEqual(t2.state, 'error')
        assert.strictEqual(t2.msg, 'errChannelIdInvalid')

        const t3 = await apiGet(`/api/getArchivedTasks?channelId=${CHANNEL_ID}`, 'tk-bad-token')
        assert.strictEqual(t3.state, 'error')
    })

})
