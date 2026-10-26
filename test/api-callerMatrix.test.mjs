//api-callerMatrix: 呼叫者存取矩陣(入口 × 呼叫者)——身分驗證責任(C3 執行身分完整驗證、C2 函數層級角色與成員檢查、C2b 不得讀到不屬於自己之頻道資料、第 128 項系統函數收緊)之 API 層契約測試(需 backend, 不需 browser)
//對應 spec/設計要點與取捨.md D20(呼叫者身分驗證與存取矩陣)、dspec/使用者身分驗證原則.md 二.2、二.4、二.7、二之一、dspec/w-web呼叫者身分驗證.md C2 / C2b / C3;規則帳本 rulebook_security.md R-AUTHZ-01～06
//
//呼叫者(7 類; srv.mjs 之測試權杖, 受 NODE_ENV!=='production' 守門; 部署方 verifyClientUser / verifyAppUser 對 id-for-member / id-for-outsider 放行以測套件自身之檢查):
//  NONE 無 token | U_MEMBER 使用者 token・一般使用者(測試中為頻道 A 之成員) | U_OUT 使用者 token・一般使用者(非任何頻道成員) | ADMIN 使用者 token・系統管理者('sys')
//  AU_USER 應用系統 token・使用者用途綁一般使用者(反查回 id-for-member 之實際資料, 同 U_MEMBER) | AU_ADMIN 應用系統 token・使用者用途綁系統管理者(同 ADMIN) | AS 應用系統 token・系統服務用途(id='app:…'、isAdmin='y', 不綁使用者)
//入口(25 個業務操作 × 頻道 A / B 變體 × 傳輸(資料通道 kpFunExt / HTTP REST)、2 個表 select、3 個系統函數、登入檢查、輪詢):
//  管理類(頻道與成員之建立 / 修改 / 刪除) → 限系統管理者(isAdmin='y'; 判準取自 token 反查之使用者, 本套件無自有使用者表, 同 w-web-api): 一般使用者 errUserNotAdmin
//  頻道內容(訊息、任務、已讀游標、成員名冊) → 限系統管理者或該頻道之有效成員: 非成員 errChannelNotMember(任務以 id 取用者為 errTaskNotFound, 不洩漏任務存在與否)
//  檔案(上傳 / metadata / 串流) → 限系統管理者或任一頻道之有效成員(檔案不屬單一頻道; 無任何頻道者無使用理由)
//  清單與統計 → 任一已驗證者可呼叫, 但只回呼叫者有權看之頻道之資料(表 select 同)
//
//每格 = 一個入口 × 一個呼叫者; 每格各自建 fixture(新任務 / 新頻道 / 新成員列, 由系統管理者建), 呼叫後再讀回副作用(拒絕者零寫入)
//跑法: npx mocha test/api-callerMatrix.test.mjs --timeout 180000(須持測試鎖)
import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import obj2u8arr from 'wsemi/src/obj2u8arr.mjs'
import u8arr2obj from 'wsemi/src/u8arr2obj.mjs'
import { startServersOnce, apiBaseUrl, backendLogDir } from './tools/e2e-setup.mjs'
import { callRpc, postMain, outputOf, snapshotLogs, waitRecords, proj } from './tools/apiProbe.mjs'


const TK = {
    NONE: '',
    U_MEMBER: '{token-for-member}',
    U_OUT: '{token-for-outsider}',
    ADMIN: 'sys',
    AU_USER: '{token-for-appuser}',
    AU_ADMIN: '{token-for-appadmin}',
    AS: '{token-for-appsys}',
}
const CALLERS = Object.keys(TK)
const ID_OF = { U_MEMBER: 'id-for-member', U_OUT: 'id-for-outsider', ADMIN: 'id-for-admin', AU_USER: 'id-for-member', AU_ADMIN: 'id-for-admin', AS: 'app:key-for-test' }
const ADMIN_CLASS = ['ADMIN', 'AU_ADMIN', 'AS'] //isAdmin='y' 者(使用者 token・系統管理者、綁系統管理者之應用系統 token、系統服務用途)
const MEMBER_CLASS = ['U_MEMBER', 'AU_USER'] //id-for-member: 頻道 A 之成員
const PREFIX = `cm-${Date.now()}`
const AGENT_ID = `${PREFIX}-agent` //頻道 A、B 之主責 agent(存檔時自動建 agent 成員列; 供 getChannels?agentId= 過濾之收斂測試)
let cells = 0 //已執行之格數(入口 × 傳輸 × 呼叫者)
let extra = 13 //矩陣以外之案數(入口全集 1、系統函數 2、輪詢 1、通訊路由 1、C3 8)
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='


//expectFor: 呼叫者在某類入口之預期結果: 'ok' | 'CONN'(無 token, 連線閘 / 路由認證即拒) | 拒絕之 key
function expectFor(cls, c) {
    if (c === 'NONE') {
        return 'CONN'
    }
    let admin = ADMIN_CLASS.includes(c)
    let mem = MEMBER_CLASS.includes(c)
    switch (cls) {
    case 'user': return 'ok'
    case 'admin': return admin ? 'ok' : 'errUserNotAdmin'
    case 'chA': return (admin || mem) ? 'ok' : 'errChannelNotMember'
    case 'chB': return admin ? 'ok' : 'errChannelNotMember'
    case 'taskA': return (admin || mem) ? 'ok' : 'errTaskNotFound'
    case 'taskB': return admin ? 'ok' : 'errTaskNotFound'
    case 'part': return (admin || mem) ? 'ok' : 'errChannelNotMember'
    }
    throw new Error(`unknown cls ${cls}`)
}


//傳輸: 資料通道(kpFunExt、表 select、系統函數)與 HTTP REST
async function rpcAs(c, func, args) {
    return await callRpc(func, args, TK[c]) //Authorization 與 __sysToken__ 皆為同一權杖
}

async function httpAs(c, method, path, query = {}, body = null) {
    let qs = new URLSearchParams()
    for (let [k, v] of Object.entries(query)) {
        qs.set(k, v)
    }
    let tk = Object.prototype.hasOwnProperty.call(TK, c) ? TK[c] : c //c 為呼叫者代號或(C3 案之)原始 token 字串
    if (tk !== '') {
        qs.set('token', tk)
    }
    let url = `${apiBaseUrl}${path}?${qs.toString()}`
    let res = method === 'GET'
        ? await fetch(url)
        : await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
    let text = await res.text()
    let j = null
    try {
        j = JSON.parse(text)
    }
    catch (err) {}
    if (j && typeof j === 'object' && 'state' in j) {
        return { state: j.state, msg: j.msg, status: res.status }
    }
    return { state: res.status === 200 ? 'success' : 'error', msg: text.slice(0, 40), status: res.status }
}

//系統管理者直呼(建 fixture / 讀回副作用), 失敗即拋
async function ad(func, args = []) {
    let r = await callRpc(func, args, TK.ADMIN)
    assert.strictEqual(r.state, 'success', `fixture ${func} 應成功, 實得 ${JSON.stringify(r)}`)
    return r.msg
}


//fixtures
let CH = { A: '', B: '' } //頻道 A(id-for-member 為成員)、頻道 B(無一般使用者為成員)
let createdChannelIds = []
let seq = 0
let nm = (tag) => `${PREFIX}-${tag}-${++seq}`

async function mkChannel(tag, agentId = '') {
    let name = nm(tag)
    await ad('saveChannel', [{ name, agentId }])
    let cs = (await ad('getChannelsList', [])).filter((x) => x.name === name)
    assert.strictEqual(cs.length, 1)
    createdChannelIds.push(cs[0].id)
    return cs[0].id
}
async function mkTask(chId, claim = false) {
    let r = await ad('postMessage', [chId, `task of ${nm('t')}`, { asTask: true }])
    let id = r.task.id
    if (claim) {
        await ad('claimTask', [id])
    }
    return id
}
async function stateOf(taskId) {
    return (await ad('getTask', [taskId])).state
}
async function mkMemberRow(chId) {
    let memberId = nm('m')
    await ad('saveChannelMember', [{ channelId: chId, memberId, memberType: 'human' }])
    let ms = await ad('getChannelMembers', [chId])
    let m = ms.find((x) => x.memberId === memberId)
    assert.ok(m, 'fixture member row')
    return { id: m.id, memberId }
}
async function countMsgs(chId) {
    return (await ad('getMessages', [chId, 500])).length
}
async function channelByName(name) {
    return (await ad('getChannelsList', [])).filter((x) => x.name === name).length
}
async function memberExists(chId, memberId) {
    return (await ad('getChannelMembers', [chId])).some((m) => m.memberId === memberId)
}
//測試實例之上傳檔實體目錄(後端工作目錄 = backendLogDir 之上層)下之檔案數
function dbfCount() {
    let d = path.join(path.dirname(backendLogDir), 'dbf')
    return fs.existsSync(d) ? fs.readdirSync(d).length : 0
}


//ops: 每個業務操作一列; surfaces: 各傳輸之呼叫(prep 回傳 st, 供 call 與 effect 使用); cls: 預期分類; effect: 呼叫後讀回之副作用值, want(allowed) 為預期值
//verify(res, c, st): 允許者之回應內容檢查(清單類須只含有權看之頻道之資料)
let ops = []
function op(def) {
    ops.push(def)
}
let variants = (name, make) => {
    for (let v of ['A', 'B']) {
        op({ name: `${name}(${v})`, ...make(v) })
    }
}

//── 已驗證者可呼叫 ──
op({
    name: 'getWebInfor',
    cls: 'user',
    rpc: async () => ({ func: 'getWebInfor', args: [] }),
    verify: (r) => assert.ok(r.msg && r.msg.kpLang, 'getWebInfor 應回網站資訊'),
})
//頻道清單之收斂判準(含 agentId 過濾後仍只回有權看之頻道: 頻道 A、B 之 agentId 相同, 見 before)
let verifyChannels = (r, c) => {
    let ids = r.msg.map((x) => x.id)
    if (ADMIN_CLASS.includes(c)) {
        assert.ok(ids.includes(CH.A) && ids.includes(CH.B), `系統管理者應見全部頻道, 實得 ${ids.length} 筆`)
    }
    else if (MEMBER_CLASS.includes(c)) {
        assert.ok(ids.includes(CH.A) && !ids.includes(CH.B), '成員只見自己所屬之頻道 A, 不得見 B')
        assert.ok(!ids.includes('id-for-channel-demo'), '成員不得見非所屬之種子頻道')
    }
    else {
        assert.deepStrictEqual(ids, [], '非成員不得見任何頻道')
    }
}
op({
    name: 'getChannelsList',
    cls: 'user',
    prep: async () => ({}),
    rpc: async () => ({ func: 'getChannelsList', args: [] }),
    http: async () => ({ method: 'GET', path: '/api/getChannels', query: {} }),
    verify: verifyChannels,
})
op({
    name: 'getChannelsList(agentId)', //HTTP 之 agentId 過濾(agent 輪詢之入口): 過濾後仍只回有權看之頻道
    cls: 'user',
    http: async () => ({ method: 'GET', path: '/api/getChannels', query: { agentId: AGENT_ID } }),
    verify: verifyChannels,
})
op({
    name: 'getStats',
    cls: 'user',
    rpc: async () => ({ func: 'getStats', args: [] }),
    http: async () => ({ method: 'GET', path: '/api/getStats', query: {} }),
    verify: (r, c) => {
        if (ADMIN_CLASS.includes(c)) {
            assert.ok(r.msg.channels >= 2, '系統管理者之統計含全部頻道')
        }
        else if (MEMBER_CLASS.includes(c)) {
            assert.strictEqual(r.msg.channels, 1, '成員之統計只計所屬之頻道')
        }
        else {
            assert.strictEqual(r.msg.channels, 0, '非成員之統計不含任何頻道')
            assert.strictEqual(r.msg.tasks.total, 0)
            assert.strictEqual(r.msg.messages, 0)
        }
    },
})
op({
    name: 'getUserByToken(登入檢查)',
    cls: 'user',
    http: async () => ({ method: 'GET', path: '/api/getUserByToken', query: {} }),
    verify: (r) => assert.deepStrictEqual(Object.keys(r.msg).sort(), ['email', 'id', 'isAdmin', 'name'], '登入檢查只回 id / name / email / isAdmin 四欄(不原樣回傳部署方物件, 如 isApp 等額外欄位)'),
})
for (let tab of ['channels', 'channelMembers']) {
    op({
        name: `${tab}.select`,
        cls: 'user',
        rpc: async () => ({ func: `${tab}.select`, args: [] }),
        verify: (r, c) => {
            let rows = r.msg
            if (ADMIN_CLASS.includes(c)) {
                return
            }
            let key = tab === 'channels' ? 'id' : 'channelId'
            let allowed = MEMBER_CLASS.includes(c) ? [CH.A] : []
            for (let x of rows) {
                assert.ok(allowed.includes(x[key]), `${tab}.select 不得回非所屬頻道之列: ${x[key]}`)
            }
            if (MEMBER_CLASS.includes(c)) {
                assert.ok(rows.length >= 1, '成員應取得所屬頻道之列')
            }
        },
    })
}

//── 管理類: 限系統管理者 ──
op({
    name: 'saveChannel',
    cls: 'admin',
    prep: async () => ({ name: nm('sc') }),
    rpc: async (st) => ({ func: 'saveChannel', args: [{ name: st.name }] }),
    effect: async (st) => await channelByName(st.name),
    want: (a) => a ? 1 : 0,
})
op({
    name: 'saveChannel(modify)', //修改既有列: 拒絕者不得改動
    cls: 'admin',
    prep: async () => ({ id: await mkChannel('mod'), desc: nm('desc') }),
    rpc: async (st) => ({ func: 'saveChannel', args: [{ id: st.id, description: st.desc }] }),
    effect: async (st) => ((await ad('getChannelsList', [])).find((x) => x.id === st.id) || {}).description || '',
    want: (a, c, st) => a ? st.desc : '',
})
op({
    name: 'saveChannelMember(modify)',
    cls: 'admin',
    prep: async () => await mkMemberRow(CH.A),
    rpc: async (st) => ({ func: 'saveChannelMember', args: [{ id: st.id, channelId: CH.A, memberId: st.memberId, role: 'owner' }] }),
    effect: async (st) => ((await ad('getChannelMembers', [CH.A])).find((x) => x.id === st.id) || {}).role,
    want: (a) => a ? 'owner' : 'member',
})
op({
    name: 'saveChannels',
    cls: 'admin',
    prep: async () => ({ name: nm('scs') }),
    rpc: async (st) => ({ func: 'saveChannels', args: [[{ name: st.name }]] }),
    effect: async (st) => await channelByName(st.name),
    want: (a) => a ? 1 : 0,
})
op({
    name: 'deleteChannel',
    cls: 'admin',
    prep: async () => ({ id: await mkChannel('dc') }),
    rpc: async (st) => ({ func: 'deleteChannel', args: [st.id] }),
    effect: async (st) => (await ad('getChannelsList', [])).some((x) => x.id === st.id),
    want: (a) => !a,
})
op({
    name: 'deleteChannels',
    cls: 'admin',
    prep: async () => ({ id: await mkChannel('dcs') }),
    rpc: async (st) => ({ func: 'deleteChannels', args: [[st.id]] }),
    effect: async (st) => (await ad('getChannelsList', [])).some((x) => x.id === st.id),
    want: (a) => !a,
})
op({
    name: 'saveChannelMember',
    cls: 'admin',
    prep: async () => ({ memberId: nm('smr') }),
    rpc: async (st) => ({ func: 'saveChannelMember', args: [{ channelId: CH.A, memberId: st.memberId, memberType: 'human' }] }),
    effect: async (st) => await memberExists(CH.A, st.memberId),
    want: (a) => a,
})
op({
    name: 'saveChannelMembers',
    cls: 'admin',
    prep: async () => ({ memberId: nm('smrs') }),
    rpc: async (st) => ({ func: 'saveChannelMembers', args: [CH.A, [{ channelId: CH.A, memberId: st.memberId, memberType: 'human' }]] }),
    effect: async (st) => await memberExists(CH.A, st.memberId),
    want: (a) => a,
})
op({
    name: 'deleteChannelMember',
    cls: 'admin',
    prep: async () => await mkMemberRow(CH.A),
    rpc: async (st) => ({ func: 'deleteChannelMember', args: [st.id] }),
    effect: async (st) => await memberExists(CH.A, st.memberId),
    want: (a) => !a,
})
op({
    name: 'deleteChannelMembers',
    cls: 'admin',
    prep: async () => await mkMemberRow(CH.A),
    rpc: async (st) => ({ func: 'deleteChannelMembers', args: [CH.A, [st.id]] }),
    effect: async (st) => await memberExists(CH.A, st.memberId),
    want: (a) => !a,
})

//── 頻道內容: 限系統管理者或該頻道成員 ──
variants('getChannelMembers', (v) => ({
    cls: `ch${v}`,
    rpc: async () => ({ func: 'getChannelMembers', args: [CH[v]] }),
    verify: (r) => assert.ok(Array.isArray(r.msg) && r.msg.length >= 1 && r.msg.every((m) => m.channelId === CH[v]), '名冊只含該頻道之成員列'),
}))
variants('getMessages', (v) => ({
    cls: `ch${v}`,
    rpc: async () => ({ func: 'getMessages', args: [CH[v], 50] }),
    http: async () => ({ method: 'GET', path: '/api/getRecentMessages', query: { channelId: CH[v], n: '50' } }),
    verify: (r) => assert.ok(Array.isArray(r.msg) && r.msg.every((m) => m.channelId === CH[v])),
}))
variants('getTasks', (v) => ({
    cls: `ch${v}`,
    rpc: async () => ({ func: 'getTasks', args: [CH[v], 50] }),
    http: async () => ({ method: 'GET', path: '/api/getRecentTasks', query: { channelId: CH[v], n: '50' } }),
    verify: (r) => assert.ok(Array.isArray(r.msg) && r.msg.every((t) => t.channelId === CH[v])),
}))
variants('getArchivedTasks', (v) => ({
    cls: `ch${v}`,
    rpc: async () => ({ func: 'getArchivedTasks', args: [CH[v], 50] }),
    http: async () => ({ method: 'GET', path: '/api/getArchivedTasks', query: { channelId: CH[v], n: '50' } }),
    verify: (r) => assert.ok(Array.isArray(r.msg) && r.msg.every((x) => x.channelId === CH[v])), //冷表有內容之情形見 unit-access A10(此處測試實例無封存資料)
}))
variants('getArchivedMessages', (v) => ({
    cls: `ch${v}`,
    rpc: async () => ({ func: 'getArchivedMessages', args: [CH[v], 50] }),
    http: async () => ({ method: 'GET', path: '/api/getArchivedMessages', query: { channelId: CH[v], n: '50' } }),
    verify: (r) => assert.ok(Array.isArray(r.msg) && r.msg.every((x) => x.channelId === CH[v])),
}))
variants('postMessage', (v) => ({
    cls: `ch${v}`,
    prep: async () => ({ before: await countMsgs(CH[v]) }),
    rpc: async () => ({ func: 'postMessage', args: [CH[v], 'hello from matrix', {}] }),
    http: async () => ({ method: 'POST', path: '/api/postMessage', body: { channelId: CH[v], content: 'hello from matrix' } }),
    effect: async (st) => (await countMsgs(CH[v])) - st.before,
    want: (a) => a ? 1 : 0,
}))
variants('getTask', (v) => ({
    cls: `task${v}`,
    prep: async () => ({ id: await mkTask(CH[v]) }),
    rpc: async (st) => ({ func: 'getTask', args: [st.id] }),
    http: async (st) => ({ method: 'GET', path: '/api/getTask', query: { taskId: st.id } }),
    verify: (r, c, st) => assert.strictEqual(r.msg.id, st.id),
}))
variants('claimTask', (v) => ({
    cls: `task${v}`,
    prep: async () => ({ id: await mkTask(CH[v]) }),
    rpc: async (st) => ({ func: 'claimTask', args: [st.id] }),
    http: async (st) => ({ method: 'POST', path: '/api/claimTask', body: { taskId: st.id } }),
    effect: async (st) => await stateOf(st.id),
    want: (a) => a ? 'running' : 'pending',
}))
variants('respondTask', (v) => ({
    cls: `task${v}`,
    prep: async () => ({ id: await mkTask(CH[v], true) }),
    rpc: async (st) => ({ func: 'respondTask', args: [st.id, 'result of matrix', 'done'] }),
    http: async (st) => ({ method: 'POST', path: '/api/respondTask', body: { taskId: st.id, result: 'result of matrix', state: 'done' } }),
    effect: async (st) => await stateOf(st.id),
    want: (a) => a ? 'done' : 'running',
}))
variants('resetTask', (v) => ({
    cls: `task${v}`,
    prep: async () => ({ id: await mkTask(CH[v], true) }),
    rpc: async (st) => ({ func: 'resetTask', args: [st.id] }),
    http: async (st) => ({ method: 'POST', path: '/api/resetTask', body: { taskId: st.id } }),
    effect: async (st) => await stateOf(st.id),
    want: (a) => a ? 'pending' : 'running',
}))

//── 檔案: 限系統管理者或任一頻道成員 ──
let FILE_ID = ''
op({
    name: 'uploadFile',
    cls: 'part',
    prep: async () => ({ before: dbfCount() }),
    rpc: async () => ({ func: 'uploadFile', args: [{ name: 'cm.png', type: 'image/png', dataBase64: PNG }] }),
    http: async () => ({ method: 'POST', path: '/api/uploadFile', body: { name: 'cm.png', type: 'image/png', dataBase64: PNG } }),
    verify: (r) => assert.ok(r.msg && r.msg.id),
    effect: async (st) => dbfCount() - st.before, //拒絕者不得寫出實體檔(測試實例之 ./dbf)
    want: (a) => a ? 1 : 0,
})
op({
    name: 'getFileInfo',
    cls: 'part',
    rpc: async () => ({ func: 'getFileInfo', args: [FILE_ID] }),
    http: async () => ({ method: 'GET', path: '/api/getFileInfo', query: { id: FILE_ID } }),
    verify: (r) => assert.strictEqual(r.msg.id, FILE_ID),
})
op({
    name: 'getFile',
    cls: 'part',
    http: async () => ({ method: 'GET', path: '/api/getFile', query: { id: FILE_ID } }),
})

//── ackChannel 置最後: 修正前非成員呼叫會替自己建立成員列(自我加入), 之後的格不受影響 ──
variants('ackChannel', (v) => ({
    cls: `ch${v}`,
    prep: async () => ({}),
    rpc: async () => ({ func: 'ackChannel', args: [CH[v], 'zzzzzzzz-matrix-cursor'] }),
    http: async () => ({ method: 'POST', path: '/api/ackChannel', body: { channelId: CH[v], lastMessageId: 'zzzzzzzz-matrix-cursor' } }),
    //非成員不得藉 ackChannel 替自己建立成員列(自我加入); 允許者寫入的是自己那一列之游標(值正確), 同頻道其他成員列(主責 agent)之游標不變(外審 sol#12)
    effect: async (st, c) => {
        let ms = await ad('getChannelMembers', [CH[v]])
        let self = ms.find((x) => x.memberId === ID_OF[c])
        let agent = ms.find((x) => x.memberId === AGENT_ID)
        return { self: self ? self.lastSeenMessageId : null, agent: agent ? agent.lastSeenMessageId : null }
    },
    want: (a) => ({ self: a ? 'zzzzzzzz-matrix-cursor' : null, agent: '' }), // 允許者: 成員寫自己既有列 / 系統管理者補建列; 拒絕者無列; 主責 agent 之列不被動到
}))


//runCell: 執行一格並檢查回應與副作用
async function runCell(o, surface, c) {
    let st = o.prep ? await o.prep() : {}
    let call = await o[surface](st)
    let want = expectFor(o.cls, c)
    let res = surface === 'rpc'
        ? await rpcAs(c, call.func, call.args)
        : await httpAs(c, call.method, call.path, call.query || {}, call.body || null)
    let label = `${o.name}/${surface}/${c}`
    if (want === 'ok') {
        assert.strictEqual(res.state, 'success', `${label} 應放行, 實得 ${JSON.stringify(res)}`)
        if (o.verify) {
            await o.verify(res, c, st)
        }
    }
    else if (want === 'CONN') {
        assert.strictEqual(res.state, 'error', `${label} 無 token 應被拒, 實得 ${JSON.stringify(res)}`)
        if (surface === 'rpc') {
            assert.strictEqual(res.msg, 'permission denied', `${label} 連線閘應回 permission denied, 實得 ${JSON.stringify(res)}`)
        }
    }
    else {
        assert.strictEqual(res.state, 'error', `${label} 應被拒(${want}), 實得 ${JSON.stringify(res)}`)
        assert.strictEqual(res.msg, want, `${label} 拒絕鍵應為 ${want}, 實得 ${JSON.stringify(res)}`)
    }
    if (o.effect) {
        let allowed = want === 'ok'
        let got = await o.effect(st, c)
        let exp = o.want(allowed, c, st)
        assert.deepStrictEqual(got, exp, `${label} 副作用應為 ${JSON.stringify(exp)}(${allowed ? '放行' : '拒絕者零寫入'}), 實得 ${JSON.stringify(got)}`)
    }
    return res
}


describe('api-callerMatrix(呼叫者存取矩陣: 入口 × 呼叫者; C3 / C2 / C2b / 第 128 項)', function() {
    this.timeout(600000)

    before(async function() {
        await startServersOnce({ backendOnly: true })
        CH.A = await mkChannel('A', AGENT_ID)
        CH.B = await mkChannel('B', AGENT_ID)
        await ad('saveChannelMember', [{ channelId: CH.A, memberId: 'id-for-member', memberType: 'human' }])
        //頻道 A、B 各有訊息與任務(供讀取類回非空資料, 才看得出越權)
        await mkTask(CH.A)
        await mkTask(CH.B)
        let f = await ad('uploadFile', [{ name: 'seed.png', type: 'image/png', dataBase64: PNG }])
        FILE_ID = f.id
    })

    after(async function() {
        //清理: 本檔建立之頻道(含修前紅燈時一般使用者建立者)一律以系統管理者刪除; 刪後回驗
        let cs = await ad('getChannelsList', [])
        let mine = cs.filter((x) => x.name.startsWith(PREFIX))
        if (mine.length > 0) {
            await ad('deleteChannels', [mine.map((x) => x.id)])
        }
        let left = (await ad('getChannelsList', [])).filter((x) => x.name.startsWith(PREFIX))
        assert.deepStrictEqual(left.map((x) => x.name), [], '本檔建立之頻道應已清除')
        console.log(`[callerMatrix] 入口×傳輸 ${cells / CALLERS.length} 列 × ${CALLERS.length} 類呼叫者 = ${cells} 格(另有系統函數、輪詢、C3 共 ${extra} 案)`)
    })


    //入口全集覆蓋: 新增入口而未入矩陣即紅(資料通道以 [sys:getFuncList] 取全集; HTTP 路由以 server/WWebTask.mjs 之 path 宣告取全集)
    it('入口全集: 資料通道函數(kpFunExt + 表 select)與 HTTP 路由皆在矩陣內', async function() {
        let covered = new Set(ops.filter((o) => typeof o.rpc === 'function').map((o) => o.name.split('(')[0]))
        let r = await postMain(TK.ADMIN, TK.ADMIN, '[sys:getFuncList]')
        let list = outputOf(r).msg.filter((f) => !f.startsWith('[sys:'))
        assert.deepStrictEqual(list.slice().sort(), [...covered].sort(), '資料通道函數全集應等於矩陣之 rpc 入口')
        let srv = fs.readFileSync(fileURLToPath(new URL('../server/WWebTask.mjs', import.meta.url)), 'utf8')
        let routes = [...srv.matchAll(/path: '(\/api\/[A-Za-z]+)'/g)].map((m) => m[1])
        let coveredHttp = new Set(ops.filter((o) => typeof o.http === 'function').map((o) => o.name.split('(')[0]))
        let names = routes.map((p) => p.slice('/api/'.length))
        //路由名與操作名之對照(同一業務以不同名稱出現者)
        let alias = { getChannels: 'getChannelsList', getRecentMessages: 'getMessages', getRecentTasks: 'getTasks', getUserByToken: 'getUserByToken' }
        for (let n of names) {
            assert.ok(coveredHttp.has(alias[n] || n), `HTTP 路由 /api/${n} 未入矩陣`)
        }
        assert.strictEqual(names.length, 16, `HTTP 路由應為 16 條, 實得 ${names.length}`)
    })

    //每個(入口 × 傳輸)一個 it, 內含 7 個呼叫者之格
    for (let o of ops) {
        for (let surface of ['rpc', 'http']) {
            if (typeof o[surface] !== 'function') {
                continue
            }
            it(`${o.name} [${surface}] × ${CALLERS.length} 類呼叫者`, async function() {
                let fails = []
                for (let c of CALLERS) {
                    try {
                        await runCell(o, surface, c)
                    }
                    catch (err) {
                        fails.push(err.message.split('\n')[0].slice(0, 300))
                    }
                    cells++
                }
                assert.deepStrictEqual(fails, [], `${o.name}/${surface} 有 ${fails.length} 格不符`)
            })
        }
    }


    //── 系統函數與輪詢(第 128 項: 只公開 [sys:getFuncList]) ──
    it('系統函數 [sys:getFuncList]、[sys:getTableTags]: 有效身分(已驗證之 __sysToken__)放行, 無 token 連線閘即拒', async function() {
        for (let func of ['[sys:getFuncList]', '[sys:getTableTags]']) {
            for (let c of CALLERS) {
                let r = await postMain(TK[c], TK[c], func, [])
                let out = outputOf(r)
                if (c === 'NONE') {
                    assert.strictEqual(r.obj && r.obj.error, 'permission denied', `${func}/${c} 連線閘應拒, 實得 ${r.text}`)
                }
                else {
                    assert.ok(out && out.state === 'success', `${func}/${c} 應放行, 實得 ${r.text}`)
                }
            }
        }
    })

    it('系統函數收緊(sysFuncsPublic=[sys:getFuncList]): 連線閘 token 有效但本體 __sysToken__ 空 / 缺 → [sys:getTableTags] 被拒; [sys:getFuncList] 仍須身分(本套件 getUserIdByToken fail-closed)', async function() {
        let r1 = await postMain(TK.ADMIN, '', '[sys:getTableTags]', [])
        assert.ok(!outputOf(r1) || outputOf(r1).state !== 'success', `空本體 token 不得取同步表時間戳, 實得 ${r1.text}`)
        let r2 = await postMain(TK.ADMIN, '', '[sys:getFuncList]', [])
        assert.ok(!outputOf(r2) || outputOf(r2).state !== 'success', `空本體 token 之函數名稱清單亦須身分(本套件不公開), 實得 ${r2.text}`)
    })

    it('輪詢 [sys:polling]: 帶有效 __sysToken__ 者放行; 無 token 之輪詢(連線閘 token 有效、本體缺 __sysToken__ 鍵或為空)被拒', async function() {
        //輪詢輸入為 { clientId, __sysToken__ }(w-serv-broadcast 於資料通道之前處理), 連線閘(Authorization)仍先驗
        let poll = async (auth, input) => {
            let res = await fetch(`${apiBaseUrl}/api/main`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${auth}`, 'Content-Type': 'application/octet-stream' },
                body: Buffer.from(obj2u8arr({ func: '[sys:polling]', input })),
            })
            let u8a = new Uint8Array(await res.arrayBuffer())
            return u8arr2obj(u8a)
        }
        for (let c of CALLERS.filter((x) => x !== 'NONE')) {
            let o = await poll(TK[c], { clientId: `${PREFIX}-poll-${c}`, __sysToken__: TK[c] })
            assert.ok(o && o.success && !('error' in o), `${c} 帶 token 之輪詢應放行, 實得 ${JSON.stringify(o)}`)
        }
        //無 token 之輪詢: 缺鍵(已發布之舊前端元件)、空字串
        let o1 = await poll(TK.ADMIN, { clientId: `${PREFIX}-poll-anon-1` })
        assert.ok('error' in o1 && String(o1.error).includes('permission denied'), `缺 __sysToken__ 鍵之輪詢應被拒, 實得 ${JSON.stringify(o1)}`)
        let o2 = await poll(TK.ADMIN, { clientId: `${PREFIX}-poll-anon-2`, __sysToken__: '' })
        assert.ok('error' in o2, `空 __sysToken__ 之輪詢應被拒, 實得 ${JSON.stringify(o2)}`)
        let o3 = await poll(TK.ADMIN, { clientId: `${PREFIX}-poll-anon-3`, __sysToken__: 'bad-token' })
        assert.ok('error' in o3, `無效 __sysToken__ 之輪詢應被拒, 實得 ${JSON.stringify(o3)}`)
        //clientId 與身分綁定(框架保證, 本套件之設定下實測; 外審 sol#10): 同一 clientId 先以成員身分輪詢, 其後以他人身分(系統管理者)重用即被拒, 不得取走他人之廣播
        let shared = `${PREFIX}-poll-shared`
        let o4 = await poll(TK.U_MEMBER, { clientId: shared, __sysToken__: TK.U_MEMBER })
        assert.ok(o4 && o4.success && !('error' in o4), `成員之輪詢應放行, 實得 ${JSON.stringify(o4)}`)
        let o5 = await poll(TK.ADMIN, { clientId: shared, __sysToken__: TK.ADMIN })
        assert.ok('error' in o5 && String(o5.error).includes('permission denied'), `同一 clientId 改以他人身分輪詢應被拒, 實得 ${JSON.stringify(o5)}`)
        let o6 = await poll(TK.U_MEMBER, { clientId: shared, __sysToken__: TK.U_MEMBER })
        assert.ok(o6 && o6.success && !('error' in o6), `原身分續輪詢仍放行, 實得 ${JSON.stringify(o6)}`)
    })


    it('通訊路由 ulctr / slc / dwgfn / dwgf / dw: 本套件未註冊監聽——無 token 連線閘即拒, 有 token(含系統管理者)亦不受理', async function() {
        //各路由之「合法」請求(通過框架之參數檢核, 才分得出「未註冊監聽」與「輸入不合法」): ulctr 為 JSON { mode, fileHash }, slc 為標頭 chunk-index / chunk-total / package-id + 切片本體,
        //dwgfn / dw 為 JSON { fileId }, dwgf 為 GET ?fileId=(瀏覽器下載管理器路徑, token 走 query)
        let json = { 'Content-Type': 'application/json' }
        let reqOf = {
            ulctr: { headers: json, body: JSON.stringify({ mode: 'check-total-hash', fileHash: 'abc123' }) },
            slc: { headers: { 'Content-Type': 'application/octet-stream', 'chunk-index': '0', 'chunk-total': '1', 'package-id': 'abc123' }, body: Buffer.from('x') },
            dwgfn: { headers: json, body: JSON.stringify({ fileId: 'x' }) },
            dw: { headers: json, body: JSON.stringify({ fileId: 'x' }) },
            dwgf: { headers: {}, body: undefined },
        }
        for (let route of ['ulctr', 'slc', 'dwgfn', 'dwgf', 'dw']) {
            for (let c of CALLERS) {
                let isGet = route === 'dwgf' //瀏覽器下載管理器路徑: token 走 query
                let url = `${apiBaseUrl}/api/${route}${isGet ? `?fileId=x${TK[c] !== '' ? `&token=${encodeURIComponent(TK[c])}` : ''}` : ''}`
                let res = await fetch(url, {
                    method: isGet ? 'GET' : 'POST',
                    headers: { ...reqOf[route].headers, 'Authorization': `Bearer ${TK[c]}` },
                    body: reqOf[route].body,
                })
                let text = Buffer.from(await res.arrayBuffer()).toString('utf8')
                let info = `${route}/${c} status=${res.status} return-type=${res.headers.get('return-type')} body=${text.slice(0, 100)}`
                //無 token: 連線閘即拒(permission denied; dwgf 以 403); 有 token(含系統管理者): 本套件未註冊該事件之監聽 → 框架立即回「no listener for event[…]」之錯誤封包(w-converhp 契約;
                //dwgf 為瀏覽器下載管理器路徑,以非 2xx 狀態碼表達), 不是「已受理但輸入不合法」(外審 opus#14 / sol#11)
                if (c === 'NONE') {
                    assert.ok(/permission denied/i.test(text) || res.status === 403, `應被連線閘拒, 實得 ${info}`)
                }
                else if (isGet) {
                    assert.strictEqual(res.status, 404, `dwgf 應以 404(應用端無法提供檔案)拒絕, 實得 ${info}`)
                }
                else if (route === 'ulctr' || route === 'slc') {
                    assert.ok(/no listener for event\[upload\]/.test(text), `上傳路由應回 no listener for event[upload], 實得 ${info}`)
                }
                else {
                    //下載路由: 框架把「應用端拒絕(含未註冊監聽)」一律以 'can not get file from fileId' 回前端(細節只經 error 事件), 見 w-converhp procDownload
                    assert.ok(/can not get file from fileId/.test(text), `下載路由應回 can not get file from fileId, 實得 ${info}`)
                }
            }
        }
    })


    //── C3: 執行身分(getUserIdByToken, 即資料通道本體 __sysToken__)須與連線閘同等完整 ──
    describe('C3 執行身分完整驗證(標頭 token 與本體 __sysToken__ 各自完整驗證)', function() {

        it('C3-01 標頭 token 為系統管理者、本體 __sysToken__ 為被部署方 verifyClientUser 拒絕者(id-for-nonadmin) → 函數不執行', async function() {
            let snap = snapshotLogs()
            let r = await postMain(TK.ADMIN, '{token-for-nonadmin}', 'getWebInfor', [])
            let out = outputOf(r)
            assert.ok(out && out.state === 'error' && out.msg === 'errUserIdMissing', `被拒者之本體 token 不得執行函數, 實得 ${r.text}`)
            let { text, recs } = await waitRecords(snap, 2)
            assert.ok(!text.includes('token-for-nonadmin'), 'srLog 不得含權杖')
            let ev = recs.filter((x) => x.event === 'getUserIdByToken').map(proj)
            assert.deepStrictEqual(ev, [{ level: 50, event: 'getUserIdByToken', err: 'errUserNoPermission' }], '應記 1 筆 getUserIdByToken 且 err 為授權不通過之 key')
        })

        it('C3-02 本體 __sysToken__ 為 verifyClientUser 拋錯者({token-for-verify-throw}) / 查無使用者者 → 函數不執行, srLog 不含原文', async function() {
            let snap = snapshotLogs()
            let r1 = await postMain(TK.ADMIN, '{token-for-verify-throw}', 'getWebInfor', [])
            assert.deepStrictEqual(outputOf(r1), { state: 'error', msg: 'errUserIdMissing' }, `實得 ${r1.text}`)
            let r2 = await postMain(TK.ADMIN, 'no-such-token-xyz', 'getWebInfor', [])
            assert.deepStrictEqual(outputOf(r2), { state: 'error', msg: 'errUserIdMissing' }, `實得 ${r2.text}`)
            let { text } = await waitRecords(snap, 3)
            assert.ok(!text.includes('SYNTH-VERIFY-SECRET-FOR-TEST') && !text.includes('token-for-verify-throw') && !text.includes('no-such-token-xyz'), 'srLog 不得含權杖或上游原文')
        })

        it('C3-03 身分取自本體 token: 標頭為系統管理者、本體為一般使用者 → 以一般使用者身分執行並受角色檢查(管理類被拒、不因標頭為系統管理者而放行)', async function() {
            let name = nm('c3')
            let r = await postMain(TK.ADMIN, TK.U_OUT, 'saveChannel', [{ name }])
            assert.deepStrictEqual(outputOf(r), { state: 'error', msg: 'errUserNotAdmin' }, `實得 ${r.text}`)
            assert.strictEqual(await channelByName(name), 0, '被拒者零寫入')
        })

        it('C3-04 身分取自本體 token: 標頭為一般使用者、本體為系統管理者 → 以系統管理者身分執行(兩個 token 各經完整驗證, 框架不比對兩者)', async function() {
            let name = nm('c3b')
            let r = await postMain(TK.U_OUT, TK.ADMIN, 'saveChannel', [{ name }])
            assert.strictEqual(outputOf(r) && outputOf(r).state, 'success', `實得 ${r.text}`)
            assert.strictEqual(await channelByName(name), 1)
        })

        it('C3-05 本體 __sysToken__ 反查所得使用者欄位不齊(缺 email / name; 修前只取 id 即放行)→ 函數不執行', async function() {
            let snap = snapshotLogs()
            let r = await postMain(TK.ADMIN, '{token-for-incomplete}', 'getWebInfor', [])
            assert.deepStrictEqual(outputOf(r), { state: 'error', msg: 'errUserIdMissing' }, `實得 ${r.text}`)
            let { text, recs } = await waitRecords(snap, 2)
            assert.ok(!text.includes('token-for-incomplete'), 'srLog 不得含權杖')
            assert.deepStrictEqual(recs.filter((x) => x.event === 'getUserIdByToken').map(proj), [{ level: 50, event: 'getUserIdByToken', err: 'errUserIdMissing' }])
        })

        it('C3-06 token 形狀(欄位不齊 / isAdmin 為 Y / id 非字串 / 被部署方拒絕之一般使用者): 本體 token → 函數不執行; 標頭 token → 連線閘拒; HTTP 路由 → 各自之固定鍵', async function() {
            //外審 sol#1 / opus#12: 認證形狀獨立成維度, 端到端驗證(而非只單測 isAdminUser)
            let shapes = [
                ['{token-for-incomplete}', 'errUserEmailMissing'],
                ['{token-for-badrole}', 'errUserRoleMissing'],
                ['{token-for-numid}', 'errUserIdMissing'],
                ['{token-for-nonadmin}', 'errUserNoPermission'],
                ['no-such-token-shape', 'errUserNotFound'],
            ]
            for (let [tk, keyHttp] of shapes) {
                let r1 = await postMain(TK.ADMIN, tk, 'getWebInfor', [])
                assert.deepStrictEqual(outputOf(r1), { state: 'error', msg: 'errUserIdMissing' }, `${tk} 為本體 token 不得執行函數, 實得 ${r1.text}`)
                let r2 = await postMain(tk, TK.ADMIN, 'getWebInfor', [])
                assert.strictEqual(r2.obj && r2.obj.error, 'permission denied', `${tk} 為標頭 token 應被連線閘拒, 實得 ${r2.text}`)
                let r3 = await httpAs(tk, 'GET', '/api/getChannels')
                assert.deepStrictEqual([r3.state, r3.msg], ['error', keyHttp], `${tk} 之 HTTP 路由, 實得 ${JSON.stringify(r3)}`)
            }
        })

        it('C3-07 連線閘只認 Bearer 方案(不分大小寫、方案名後一個以上空白): Basic / Token / 缺憑證被拒, bearer / 多空白放行', async function() {
            let call = async (authorization) => {
                let res = await fetch(`${apiBaseUrl}/api/main`, {
                    method: 'POST',
                    headers: { 'Authorization': authorization, 'Content-Type': 'application/octet-stream' },
                    body: Buffer.from(obj2u8arr({ func: 'getWebInfor', input: { __sysInputArgs__: [], __sysToken__: TK.ADMIN } })),
                })
                return u8arr2obj(new Uint8Array(await res.arrayBuffer()))
            }
            for (let bad of [`Basic ${TK.ADMIN}`, `Token ${TK.ADMIN}`, `Bearersys`, 'Bearer', 'Bearer ', `XBearer ${TK.ADMIN}`, TK.ADMIN]) {
                let o = await call(bad)
                assert.strictEqual(o && o.error, 'permission denied', `「${bad}」應被拒, 實得 ${JSON.stringify(o)}`)
            }
            for (let good of [`Bearer ${TK.ADMIN}`, `bearer ${TK.ADMIN}`, `BEARER   ${TK.ADMIN}`]) {
                let o = await call(good)
                assert.ok(o && o.success && o.success.output && o.success.output.state === 'success', `「${good}」應放行, 實得 ${JSON.stringify(o)}`)
            }
        })

        it('C3-08 部署方鉤子改寫傳入之使用者物件(把 id / isAdmin 改成系統管理者)不影響角色與身分: 資料通道與 HTTP 皆以驗證當下之原物件為準', async function() {
            //外審 opus#6 / sol#2: 鉤子只能再收緊、不能放寬; 部署方 srv.mjs 之 id-for-hookmut 於 verifyClientUser / verifyAppUser 內嘗試改寫傳入之物件後放行
            let tk = '{token-for-hookmut}'
            let name = nm('hookmut')
            let r1 = await postMain(tk, tk, 'getWebInfor', [])
            assert.strictEqual(outputOf(r1) && outputOf(r1).state, 'success', `鉤子放行者可呼叫一般函數, 實得 ${r1.text}`)
            let r2 = await postMain(tk, tk, 'saveChannel', [{ name }])
            assert.deepStrictEqual(outputOf(r2), { state: 'error', msg: 'errUserNotAdmin' }, `鉤子改寫 isAdmin 不得使資料通道之管理類放行, 實得 ${r2.text}`)
            assert.strictEqual(await channelByName(name), 0, '被拒者零寫入')
            let r3 = await httpAs(tk, 'POST', '/api/postMessage', {}, { channelId: CH.A, content: 'hookmut should not post' })
            assert.deepStrictEqual([r3.state, r3.msg], ['error', 'errChannelNotMember'], `鉤子改寫 id / isAdmin 不得使 HTTP 路由放行, 實得 ${JSON.stringify(r3)}`)
            let r4 = await httpAs(tk, 'GET', '/api/getChannels')
            assert.deepStrictEqual([r4.state, r4.msg], ['success', []], `HTTP 之清單須依原使用者(非成員)收斂, 實得 ${JSON.stringify(r4)}`)
        })
    })
})
