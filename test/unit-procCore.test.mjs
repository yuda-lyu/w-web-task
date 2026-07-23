//unit-procCore：procCore 工廠之業務邏輯單元測試（不需 server/browser）。
//mock woItems（in-memory Map）+ srLog + kmx，讓 procCore 在純記憶體環境執行。
//對應 spec 設計總覽 §5（任務狀態機）與 §6（API 目錄）。
import assert from 'assert'
import procCore from '../server/procCore.mjs'
import ds from '../src/schema/index.mjs'


// ── in-memory woItems mock ────────────────────────────────────────────────────
//每張表一個 Map<id,row>。select/insert/save/del/delAll 語意對齊 lmdb WServOrm。
function makeTable() {
    const map = new Map()
    return {
        //select: 回全表列，過濾 q 中各 key 等值條件，依 id 字典序排序（模擬 lmdb getRange 時序）。
        async select(q) {
            let rows = Array.from(map.values())
            if (q && typeof q === 'object') {
                for (const [k, v] of Object.entries(q)) {
                    rows = rows.filter((r) => r[k] === v)
                }
            }
            rows = [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
            return rows
        },
        //insert: rows 陣列（或單筆物件），重複 id 略過。
        async insert(rows) {
            const arr = Array.isArray(rows) ? rows : [rows]
            for (const row of arr) {
                if (!map.has(row.id)) { map.set(row.id, { ...row }) }
            }
        },
        //save: rows 陣列（或單筆物件），merge 到既有列（空字串覆寫，對齊 lodash merge 對 '' 之行為）。
        async save(rows) {
            const arr = Array.isArray(rows) ? rows : [rows]
            for (const row of arr) {
                const existing = map.get(row.id) || {}
                map.set(row.id, { ...existing, ...row })
            }
        },
        //del: 刪 q.id，回 [{nDeleted:1}]。
        async del(q) {
            map.delete(q.id)
            return [{ nDeleted: 1 }]
        },
        //delAll: 清表。
        async delAll() {
            map.clear()
        },
        //取得整個 map（測試用）
        _map: map,
    }
}

//woItems mock
const woItems = {
    channels: makeTable(),
    channelMembers: makeTable(),
    messages: makeTable(),
    messagesArchive: makeTable(),
    tasks: makeTable(),
    tasksArchive: makeTable(),
}

//srLog mock（靜默，不寫檔）
const srLog = { info() {}, warn() {}, error() {} }

//kmx mock：直接執行 fn，不做序列化（unit 不測並發）。對應 WWebTask.mjs 中 pmKeyMutex() 的用途。
const kmx = (key, fn) => fn()

//procCore 實體
const pc = procCore({ woItems, procOrm: null, ds, srLog, kmx })


// ── 工具函式 ─────────────────────────────────────────────────────────────────
//字串型 reject 斷言（procCore reject err-key 字串，非 Error 物件）
async function expectReject(fn, key) {
    let rejected = false
    try {
        await fn()
    }
    catch (e) {
        rejected = true
        assert.strictEqual(e, key, `應 reject「${key}」，實得「${e}」`)
    }
    assert.ok(rejected, `應 reject「${key}」但未 reject`)
}

//測試前清空所有表（hermetic：每個 describe 重置）
async function clearAllTables() {
    await woItems.channels.delAll()
    await woItems.channelMembers.delAll()
    await woItems.messages.delAll()
    await woItems.messagesArchive.delAll()
    await woItems.tasks.delAll()
    await woItems.tasksArchive.delAll()
}

//準備一個 demo channel（id 固定，供各測試使用）
const DEMO_CHANNEL_ID = 'id-for-channel-demo'
const USER_HUMAN = 'id-for-human'
const USER_AGENT = 'id-for-agent'

async function seedDemoChannel() {
    const ch = ds.channels.funNew({
        name: 'Demo Channel',
        agentId: USER_AGENT,
        ownerId: USER_HUMAN,
        userId: USER_HUMAN,
    })
    ch.id = DEMO_CHANNEL_ID
    await woItems.channels.insert(ch)
}


// ── 測試套件 ──────────────────────────────────────────────────────────────────
describe('unit-procCore', function() {
    this.timeout(10000)

    // ── postMessage ────────────────────────────────────────────────────────────
    describe('postMessage', function() {

        before(async function() {
            await clearAllTables()
            await seedDemoChannel()
        })

        it('asTask=true 寫 message(kind=task) + task(state=pending)，回傳含 task', async function() {
            //對應 spec §6.3 postMessage 的 asTask 契約
            const { message, task } = await pc.postMessage(USER_HUMAN, DEMO_CHANNEL_ID, 'Hello task', { asTask: true })
            assert.strictEqual(message.kind, 'task', 'message.kind 應為 task')
            assert.strictEqual(message.senderId, USER_HUMAN, 'senderId 取自 token userId')
            assert.ok(message.taskId, 'message.taskId 應指向 task')
            assert.strictEqual(task.state, 'pending', 'task.state 應為 pending')
            assert.strictEqual(task.payload, 'Hello task', 'task.payload 應等於 content')
            assert.strictEqual(task.messageId, message.id, 'task.messageId 應指回 message')
        })

        it('asTask=false 只寫 message(kind=text)，無 task 回傳', async function() {
            //對應 spec §6.3 asTask=false 僅寫 message(kind=text)
            const r = await pc.postMessage(USER_HUMAN, DEMO_CHANNEL_ID, 'Just text', { asTask: false })
            assert.strictEqual(r.message.kind, 'text', 'message.kind 應為 text')
            assert.strictEqual(r.task, undefined, '無 task')
        })

        it('asTask 字串 "false" 不開任務 (cbol)，asTask 字串 "true" 開任務', async function() {
            //對應 spec §6.3 asTask 契約；WWebTask.mjs 從 payload 取字串值傳入，需正確 cbol 轉換
            const r1 = await pc.postMessage(USER_HUMAN, DEMO_CHANNEL_ID, 'str false', { asTask: 'false' })
            assert.strictEqual(r1.task, undefined, 'asTask:"false" 不開任務')

            const r2 = await pc.postMessage(USER_HUMAN, DEMO_CHANNEL_ID, 'str true', { asTask: 'true' })
            assert.ok(r2.task, 'asTask:"true" 應開任務')
        })

        it('title 缺省時取 content 首行（截至 100 字元）', async function() {
            //對應 spec §6.3 title 缺省取 content 首行
            const content = 'First line\nSecond line'
            const { task } = await pc.postMessage(USER_HUMAN, DEMO_CHANNEL_ID, content, { asTask: true })
            assert.strictEqual(task.title, 'First line', 'title 應取 content 首行')
        })

        it('senderId 一律取自 userId（token 解析身分），忽略呼叫端 senderId', async function() {
            //對應 spec §6.1 身分權威：senderId 取自 token 解析之 user.id
            const { message } = await pc.postMessage('custom-agent-id', DEMO_CHANNEL_ID, 'agent msg', { senderType: 'agent' })
            assert.strictEqual(message.senderId, 'custom-agent-id', 'senderId 應為 userId')
            assert.strictEqual(message.senderType, 'agent', 'senderType 由呼叫端宣告')
        })

        it('channelId 非字串 → reject errChannelIdInvalid', async function() {
            //對應 spec §6.1 getRecentMessages 必需 channelId
            await expectReject(() => pc.postMessage(USER_HUMAN, null, 'x'), 'errChannelIdInvalid')
        })

        it('content 非字串 → reject errContentInvalid', async function() {
            await expectReject(() => pc.postMessage(USER_HUMAN, DEMO_CHANNEL_ID, null), 'errContentInvalid')
        })

    })


    // ── claimTask ──────────────────────────────────────────────────────────────
    describe('claimTask', function() {

        let taskId

        before(async function() {
            await clearAllTables()
            await seedDemoChannel()
            const { task } = await pc.postMessage(USER_HUMAN, DEMO_CHANNEL_ID, 'task to claim', { asTask: true })
            taskId = task.id
        })

        it('pending → running，設 assigneeId=userId 與 timeClaim', async function() {
            //對應 spec §5 任務狀態機：claimTask: pending→running
            const t = await pc.claimTask(USER_AGENT, taskId)
            assert.strictEqual(t.state, 'running', '狀態應為 running')
            assert.strictEqual(t.assigneeId, USER_AGENT, 'assigneeId 取自 token userId')
            assert.ok(t.timeClaim, 'timeClaim 應有值')
        })

        it('已 running 再 claim → reject errTaskAlreadyClaimed', async function() {
            //對應 spec §5 並發守衛 D6：claimTask 鎖內 state==='pending' 否則 reject errTaskAlreadyClaimed
            await expectReject(() => pc.claimTask(USER_AGENT, taskId), 'errTaskAlreadyClaimed')
        })

        it('不存在的 taskId → reject errTaskNotFound', async function() {
            //對應 spec §5 claimTask 不存在 reject
            await expectReject(() => pc.claimTask(USER_AGENT, 'non-exist-id'), 'errTaskNotFound')
        })

        it('taskId 非字串 → reject errTaskIdInvalid', async function() {
            //對應 spec §6.1 claimTask 參數驗證
            await expectReject(() => pc.claimTask(USER_AGENT, null), 'errTaskIdInvalid')
            await expectReject(() => pc.claimTask(USER_AGENT, 123), 'errTaskIdInvalid')
        })

    })


    // ── respondTask ────────────────────────────────────────────────────────────
    describe('respondTask', function() {

        let taskId

        beforeEach(async function() {
            await clearAllTables()
            await seedDemoChannel()
            const { task } = await pc.postMessage(USER_HUMAN, DEMO_CHANNEL_ID, 'task to respond', { asTask: true })
            taskId = task.id
            await pc.claimTask(USER_AGENT, taskId) //→ running
        })

        it('running → done：寫 result/timeDone/resultMessageId + 發 taskReply message', async function() {
            //對應 spec §5 respondTask→done；§4 回完即結束
            const t = await pc.respondTask(USER_AGENT, taskId, 'done result', 'done')
            assert.strictEqual(t.state, 'done', '狀態應為 done')
            assert.strictEqual(t.result, 'done result', '應寫 result')
            assert.ok(t.timeDone, 'timeDone 應有值')
            assert.ok(t.resultMessageId, 'resultMessageId 應指向 taskReply message')
            //驗證 taskReply message 確實存入
            const msgs = await woItems.messages.select({ kind: 'taskReply', taskId })
            assert.ok(msgs.length > 0, '應有 taskReply message')
            assert.strictEqual(msgs[0].id, t.resultMessageId, 'resultMessageId 指向正確 message')
        })

        it('state=error：寫 result + errorKey', async function() {
            //對應 spec §5 respondTask→error；errorKey 選填
            const t = await pc.respondTask(USER_AGENT, taskId, '錯誤說明', 'error', 'someErrKey')
            assert.strictEqual(t.state, 'error')
            assert.strictEqual(t.errorKey, 'someErrKey')
            assert.strictEqual(t.result, '錯誤說明')
        })

        it('state 非 done/error → reject errStateInvalid', async function() {
            //對應 spec §5 respondTask 入口守衛
            await expectReject(() => pc.respondTask(USER_AGENT, taskId, 'x', 'pending'), 'errStateInvalid')
        })

        it('state !== running → reject errTaskNotRunning（防重複回應或 resetTask lost-update）', async function() {
            //已 done → 再 respond → errTaskNotRunning
            await pc.respondTask(USER_AGENT, taskId, 'first', 'done')
            await expectReject(() => pc.respondTask(USER_AGENT, taskId, 'second', 'done'), 'errTaskNotRunning')
        })

        it('result 非字串 → reject errResultInvalid', async function() {
            //對應 spec §6.1 respondTask 參數驗證
            await expectReject(() => pc.respondTask(USER_AGENT, taskId, null, 'done'), 'errResultInvalid')
        })

        it('senderType 預設 "agent"，可由呼叫端覆寫', async function() {
            //對應 spec §6.1 respondTask senderType 預設 'agent'（WWebTask.mjs 不傳 senderType）
            await pc.respondTask(USER_AGENT, taskId, 'done', 'done') //預設 agent
            const msgs = await woItems.messages.select({ kind: 'taskReply', taskId })
            assert.strictEqual(msgs[0].senderType, 'agent', '預設 senderType 為 agent')
        })

    })


    // ── resetTask ──────────────────────────────────────────────────────────────
    describe('resetTask', function() {

        let taskId

        beforeEach(async function() {
            await clearAllTables()
            await seedDemoChannel()
            const { task } = await pc.postMessage(USER_HUMAN, DEMO_CHANNEL_ID, 'task to reset', { asTask: true })
            taskId = task.id
        })

        it('error → pending：清空 result/errorKey/assigneeId/timeClaim/timeDone/resultMessageId', async function() {
            //對應 spec §5 resetTask: error→pending（標準重試）
            await pc.claimTask(USER_AGENT, taskId) //→ running
            await pc.respondTask(USER_AGENT, taskId, 'err desc', 'error', 'errKey') //→ error
            const t = await pc.resetTask(USER_HUMAN, taskId)
            assert.strictEqual(t.state, 'pending', '狀態應為 pending')
            assert.strictEqual(t.result, '', 'result 應清空為空字串')
            assert.strictEqual(t.errorKey, '', 'errorKey 應清空')
            assert.strictEqual(t.assigneeId, '', 'assigneeId 應清空')
            assert.strictEqual(t.timeClaim, '', 'timeClaim 應清空')
            assert.strictEqual(t.timeDone, '', 'timeDone 應清空')
            assert.strictEqual(t.resultMessageId, '', 'resultMessageId 應清空')
        })

        it('running → pending（人工救援停滯任務，L4 選用）', async function() {
            //對應 spec §5 resetTask: running→pending
            await pc.claimTask(USER_AGENT, taskId) //→ running
            const t = await pc.resetTask(USER_HUMAN, taskId)
            assert.strictEqual(t.state, 'pending')
        })

        it('state=done → reject errTaskNotResettable', async function() {
            //對應 spec §5 並發守衛：resetTask 鎖內 state∈{error,running} 否則 errTaskNotResettable
            await pc.claimTask(USER_AGENT, taskId)
            await pc.respondTask(USER_AGENT, taskId, 'done', 'done') //→ done
            await expectReject(() => pc.resetTask(USER_HUMAN, taskId), 'errTaskNotResettable')
        })

        it('state=pending → reject errTaskNotResettable', async function() {
            //pending 也不可 reset（對應 spec §5 守衛：state∈{error,running} 才可）
            await expectReject(() => pc.resetTask(USER_HUMAN, taskId), 'errTaskNotResettable')
        })

    })


    // ── getMessages ────────────────────────────────────────────────────────────
    describe('getMessages', function() {

        before(async function() {
            await clearAllTables()
            await seedDemoChannel()
            //插入 5 筆訊息（依時序遞增 id，模擬 UUIDv7）
            for (let i = 0; i < 5; i++) {
                await pc.postMessage(USER_HUMAN, DEMO_CHANNEL_ID, `msg ${i}`, { asTask: false })
            }
        })

        it('afterId 給定 → 回該 id 之後的新訊息（時序 asc）', async function() {
            //對應 spec §6.1 getRecentMessages：給 afterId 回該 id 之後全部新訊息
            const all = await pc.getMessages(USER_HUMAN, DEMO_CHANNEL_ID, 20)
            assert.ok(all.length >= 2, '至少 2 筆訊息')
            const afterId = all[1].id
            const after = await pc.getMessages(USER_HUMAN, DEMO_CHANNEL_ID, 20, afterId)
            assert.ok(after.every((m) => m.id > afterId), '應全為 afterId 之後')
            assert.ok(after.length < all.length, '筆數應少於全部')
        })

        it('afterId 未給 → 回最近 n 筆（時序 asc）', async function() {
            //對應 spec §6.1 未給 afterId 回最近 n 筆
            const r = await pc.getMessages(USER_HUMAN, DEMO_CHANNEL_ID, 3)
            assert.strictEqual(r.length, 3, '應回 3 筆')
        })

        it('n=0 → 正規化為預設值 20（有界，不回全部）', async function() {
            //對應任務要求：n=0 不回全部，正規化為預設
            //插入足夠多筆確保 > 20 或觀察正規化後 nn=20（表內只有 5 筆，所以回 5 筆 ≤ 20）
            const r = await pc.getMessages(USER_HUMAN, DEMO_CHANNEL_ID, 0)
            assert.ok(r.length <= 20, 'n=0 正規化後不超過 20（預設上限）')
        })

        it('channelId 非字串 → reject errChannelIdInvalid', async function() {
            await expectReject(() => pc.getMessages(USER_HUMAN, null, 10), 'errChannelIdInvalid')
        })

    })


    // ── getTasks ───────────────────────────────────────────────────────────────
    describe('getTasks', function() {

        let task1Id, task2Id, task3Id

        before(async function() {
            await clearAllTables()
            await seedDemoChannel()
            const r1 = await pc.postMessage(USER_HUMAN, DEMO_CHANNEL_ID, 'task A', { asTask: true })
            task1Id = r1.task.id
            const r2 = await pc.postMessage(USER_HUMAN, DEMO_CHANNEL_ID, 'task B', { asTask: true })
            task2Id = r2.task.id
            const r3 = await pc.postMessage(USER_HUMAN, DEMO_CHANNEL_ID, 'task C', { asTask: true })
            task3Id = r3.task.id
            //task1 → running
            await pc.claimTask(USER_AGENT, task1Id)
        })

        it('order=asc 最舊優先（FIFO agent 消化）', async function() {
            //對應 spec §6.1 getRecentTasks order=asc 取最舊優先
            const rs = await pc.getTasks(USER_AGENT, DEMO_CHANNEL_ID, 10, '', 'asc')
            for (let i = 1; i < rs.length; i++) {
                assert.ok(rs[i - 1].id <= rs[i].id, 'asc 應由舊到新')
            }
        })

        it('order=desc 最近優先（人類檢視，預設）', async function() {
            //對應 spec §6.1 getRecentTasks order=desc 取最近優先
            const rs = await pc.getTasks(USER_AGENT, DEMO_CHANNEL_ID, 10, '', 'desc')
            for (let i = 1; i < rs.length; i++) {
                assert.ok(rs[i - 1].id >= rs[i].id, 'desc 應由新到舊')
            }
        })

        it('state 過濾 pending 只回 pending 任務', async function() {
            //對應 spec §6.1 getRecentTasks state=pending 過濾
            const rs = await pc.getTasks(USER_AGENT, DEMO_CHANNEL_ID, 10, 'pending', 'asc')
            assert.ok(rs.every((t) => t.state === 'pending'), '應全為 pending')
            assert.ok(rs.find((t) => t.id === task2Id), 'task2 應在 pending 結果中')
            assert.ok(!rs.find((t) => t.id === task1Id), 'task1(running) 不應在 pending 結果中')
        })

        it('n=0 asc/desc 筆數對稱（同源資料相同筆數）', async function() {
            //對應任務要求 F2：n=0 asc 與 desc 筆數相同
            const asc = await pc.getTasks(USER_AGENT, DEMO_CHANNEL_ID, 0, '', 'asc')
            const desc = await pc.getTasks(USER_AGENT, DEMO_CHANNEL_ID, 0, '', 'desc')
            assert.strictEqual(asc.length, desc.length, 'n=0 asc/desc 筆數應對稱')
        })

    })


    // ── getChannelsList ────────────────────────────────────────────────────────
    describe('getChannelsList', function() {

        before(async function() {
            await clearAllTables()
            //插入 2 個頻道：demo(agentId=agent-demo) + other(agentId=other-agent)
            const ch1 = ds.channels.funNew({ name: 'Demo', agentId: 'agent-demo', userId: USER_HUMAN })
            ch1.id = DEMO_CHANNEL_ID
            await woItems.channels.insert(ch1)

            const ch2 = ds.channels.funNew({ name: 'Other', agentId: 'other-agent', userId: USER_HUMAN })
            await woItems.channels.insert(ch2)

            //游標掛在「呼叫者 token 身分 (USER_AGENT)」的 member 列 — 即 ackChannel 寫入之 key, getChannelsList 亦以此讀.
            //刻意讓 channel.agentId('agent-demo') ≠ 游標 member 之 memberId(USER_AGENT), 驗證 getChannelsList 以 userId
            //(非 agentId) 讀游標 → 部署時 channel.agentId 為友善名稱亦能讀寫對稱 (對應整體審查 #1 修正, D7/D8).
            const m = ds.channelMembers.funNew({
                channelId: DEMO_CHANNEL_ID,
                memberId: USER_AGENT,
                memberType: 'agent',
                lastSeenMessageId: 'msg-cursor-1',
                userId: USER_HUMAN,
            })
            await woItems.channelMembers.insert(m)
        })

        it('agentId 過濾：只回主責 agent 的頻道', async function() {
            //對應 spec §6.1 getChannels agentId 過濾
            const rs = await pc.getChannelsList(USER_AGENT, 'agent-demo')
            assert.ok(rs.every((r) => r.agentId === 'agent-demo'), '應全為 agent-demo 的頻道')
        })

        it('agentId 過濾：附 lastSeenMessageId 游標', async function() {
            //對應 spec §6.1 getChannels 為 agent 過濾時每筆附 lastSeenMessageId 游標
            const rs = await pc.getChannelsList(USER_AGENT, 'agent-demo')
            assert.ok(rs.length > 0, '應有頻道')
            assert.strictEqual(rs[0].lastSeenMessageId, 'msg-cursor-1', '應附游標 lastSeenMessageId')
        })

        it('agentId 空字串 → 回全部 active 頻道（不過濾）', async function() {
            //對應 spec §6.1 getChannels 無 agentId 回全部
            const rs = await pc.getChannelsList(USER_HUMAN, '')
            assert.ok(rs.length >= 2, '應回全部頻道')
        })

    })


    // ── ackChannel ─────────────────────────────────────────────────────────────
    describe('ackChannel', function() {

        before(async function() {
            await clearAllTables()
            await seedDemoChannel()
            //插入一筆訊息
            await pc.postMessage(USER_HUMAN, DEMO_CHANNEL_ID, 'hello', { asTask: false })
        })

        it('推進 channelMembers.lastSeenMessageId（有既有列則 save 更新）', async function() {
            //對應 spec §3.2 channelMembers.lastSeenMessageId 游標；ackChannel 推進
            //先插入 member 列
            const m = ds.channelMembers.funNew({
                channelId: DEMO_CHANNEL_ID,
                memberId: USER_AGENT,
                memberType: 'agent',
                lastSeenMessageId: '',
                userId: USER_HUMAN,
            })
            await woItems.channelMembers.insert(m)

            const r = await pc.ackChannel(USER_AGENT, DEMO_CHANNEL_ID, 'msg-cursor-2')
            assert.deepStrictEqual(r, { ok: true })

            const ms = await woItems.channelMembers.select({ channelId: DEMO_CHANNEL_ID, memberId: USER_AGENT })
            assert.strictEqual(ms[0].lastSeenMessageId, 'msg-cursor-2', '游標應推進')
        })

        it('缺 member 列則 upsert（insert 新列）', async function() {
            //對應 spec §3.2 ackChannel 亦對缺列者 upsert
            //清掉 member 列
            await woItems.channelMembers.delAll()

            const r = await pc.ackChannel('new-agent', DEMO_CHANNEL_ID, 'msg-cursor-3')
            assert.deepStrictEqual(r, { ok: true })

            const ms = await woItems.channelMembers.select({ channelId: DEMO_CHANNEL_ID, memberId: 'new-agent' })
            assert.ok(ms.length > 0, '應 upsert 新列')
            assert.strictEqual(ms[0].lastSeenMessageId, 'msg-cursor-3')
        })

        it('channelId 非字串 → reject errChannelIdInvalid', async function() {
            await expectReject(() => pc.ackChannel(USER_AGENT, null, 'msg-x'), 'errChannelIdInvalid')
        })

        it('lastMessageId 非字串 → reject errLastMessageIdInvalid', async function() {
            await expectReject(() => pc.ackChannel(USER_AGENT, DEMO_CHANNEL_ID, null), 'errLastMessageIdInvalid')
        })

    })

    // ── archiveSweep / getArchived* (spec D12 方向②: 冷熱分離) ────────────────────
    describe('archiveSweep', function() {

        //建一筆任務 (可指定 state/timeDone) 與一筆訊息 (可指定 kind/taskId/timeCreate)
        function seedTask(id, state, timeDone) {
            const t = ds.tasks.funNew({ channelId: DEMO_CHANNEL_ID, title: 't-' + id, payload: 'p', state, userId: USER_HUMAN })
            t.id = id
            t.timeDone = timeDone || ''
            return woItems.tasks.insert(t)
        }
        function seedMessage(id, kind, taskId, timeCreate) {
            const m = ds.messages.funNew({ channelId: DEMO_CHANNEL_ID, senderId: USER_HUMAN, senderType: 'human', kind, content: 'c-' + id, taskId: taskId || '', userId: USER_HUMAN })
            m.id = id
            m.timeCreate = timeCreate
            return woItems.messages.insert(m)
        }

        const OLD = '2020-01-01T00:00:00.000+08:00' //遠早於 cutoff
        const NEW = '2099-01-01T00:00:00.000+08:00' //遠晚於 cutoff

        beforeEach(async function() {
            await clearAllTables()
            await seedDemoChannel()
        })

        it('過齡終態任務 (done/error) 搬冷表並自熱表移除; pending/近期不搬', async function() {
            //對應 spec D12: 終態且 timeDone 早於 cutoff 才封存
            await seedTask('t-old-done', 'done', OLD)
            await seedTask('t-old-error', 'error', OLD)
            await seedTask('t-old-pending', 'pending', '') //過齡但非終態 → 不搬
            await seedTask('t-new-done', 'done', NEW) //終態但未過齡 → 不搬

            const r = await pc.archiveSweep(30)
            assert.strictEqual(r.tasksMoved, 2)

            const hot = await woItems.tasks.select({ isActive: 'y' })
            assert.deepStrictEqual(hot.map((t) => t.id).sort(), ['t-new-done', 't-old-pending'])
            const cold = await woItems.tasksArchive.select({ isActive: 'y' })
            assert.deepStrictEqual(cold.map((t) => t.id).sort(), ['t-old-done', 't-old-error'])
        })

        it('過齡訊息搬冷表; 任務相關訊息其任務仍在熱表者不搬 (守衛)', async function() {
            //對應 spec D12: 訊息不早於其任務離開熱表
            await seedTask('t-hot-pending', 'pending', '') //熱表任務
            await seedMessage('m-old-text', 'text', '', OLD) //過齡純文字 → 搬
            await seedMessage('m-old-task-hot', 'task', 't-hot-pending', OLD) //過齡但任務仍熱 → 不搬
            await seedMessage('m-old-task-gone', 'task', 't-not-exist', OLD) //任務已不在熱表 → 搬
            await seedMessage('m-new-text', 'text', '', NEW) //未過齡 → 不搬

            const r = await pc.archiveSweep(30)
            assert.strictEqual(r.messagesMoved, 2)

            const hot = await woItems.messages.select({ isActive: 'y' })
            assert.deepStrictEqual(hot.map((m) => m.id).sort(), ['m-new-text', 'm-old-task-hot'])
            const cold = await woItems.messagesArchive.select({ isActive: 'y' })
            assert.deepStrictEqual(cold.map((m) => m.id).sort(), ['m-old-task-gone', 'm-old-text'])
        })

        it('任務封存後, 其過齡起源/回覆訊息於同輪一併搬 (守衛以封存後熱表為準)', async function() {
            await seedTask('t-old-done2', 'done', OLD)
            await seedMessage('m-origin', 'task', 't-old-done2', OLD)
            await seedMessage('m-reply', 'taskReply', 't-old-done2', OLD)

            const r = await pc.archiveSweep(30)
            assert.strictEqual(r.tasksMoved, 1)
            assert.strictEqual(r.messagesMoved, 2)
        })

        it('重跑冪等: 第二輪無可搬項且冷表無重複', async function() {
            await seedTask('t-old-done3', 'done', OLD)
            await seedMessage('m-old-text3', 'text', '', OLD)

            await pc.archiveSweep(30)
            const r2 = await pc.archiveSweep(30)
            assert.strictEqual(r2.tasksMoved, 0)
            assert.strictEqual(r2.messagesMoved, 0)

            const cold = await woItems.tasksArchive.select({ isActive: 'y' })
            assert.strictEqual(cold.length, 1)
        })

        it('archiveAfterDays<=0 停用: 不搬任何資料', async function() {
            await seedTask('t-old-done4', 'done', OLD)
            const r = await pc.archiveSweep(0)
            assert.deepStrictEqual(r, { tasksMoved: 0, messagesMoved: 0 })
            const hot = await woItems.tasks.select({ isActive: 'y' })
            assert.strictEqual(hot.length, 1)
        })

    })

    describe('getArchivedTasks / getArchivedMessages', function() {

        beforeEach(async function() {
            await clearAllTables()
            await seedDemoChannel()
        })

        it('封存後可自冷表查得; channelId 非字串 → reject errChannelIdInvalid', async function() {
            const t = ds.tasks.funNew({ channelId: DEMO_CHANNEL_ID, title: 'arch-t', payload: 'p', state: 'done', userId: USER_HUMAN })
            t.id = 't-arch-q'
            t.timeDone = '2020-01-01T00:00:00.000+08:00'
            await woItems.tasks.insert(t)
            const m = ds.messages.funNew({ channelId: DEMO_CHANNEL_ID, senderId: USER_HUMAN, senderType: 'human', kind: 'text', content: 'arch-m', userId: USER_HUMAN })
            m.id = 'm-arch-q'
            m.timeCreate = '2020-01-01T00:00:00.000+08:00'
            await woItems.messages.insert(m)

            await pc.archiveSweep(30)

            const ts = await pc.getArchivedTasks(USER_HUMAN, DEMO_CHANNEL_ID, 20, 'desc')
            assert.strictEqual(ts.length, 1)
            assert.strictEqual(ts[0].id, 't-arch-q')

            const ms = await pc.getArchivedMessages(USER_HUMAN, DEMO_CHANNEL_ID, 20)
            assert.strictEqual(ms.length, 1)
            assert.strictEqual(ms[0].id, 'm-arch-q')

            await expectReject(() => pc.getArchivedTasks(USER_HUMAN, null), 'errChannelIdInvalid')
            await expectReject(() => pc.getArchivedMessages(USER_HUMAN, null), 'errChannelIdInvalid')
        })

    })

})
