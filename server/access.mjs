import get from 'lodash-es/get.js'
import filter from 'lodash-es/filter.js'
import isarr from 'wsemi/src/isarr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isfun from 'wsemi/src/isfun.mjs'


//呼叫者身分、角色與成員檢查之單一擁有者 (身分驗證責任 C2 / C2b; 規格: dspec/使用者身分驗證原則.md 二.4、w-web呼叫者身分驗證.md C2、spec/設計要點與取捨.md D20).
//procCore 只信任第一參數 userId 為操作者身分 (來自 token), 不做授權; 授權全在本模組, 且只在 WWebTask 的入口邊界套用一次:
//資料通道 (kpFunExt、表 select) 與對外 HTTP REST (apis) 共用 createGuardedFuncs 產生之同一組函數, 不各寫一份.
//
//角色: 系統管理員 ＝ token 經部署方 getUserByToken 所回使用者之 isAdmin 嚴格等於 'y' (自有屬性; 其餘值一律視為一般使用者).
//  本套件無自有使用者表 (D3 認證委外 SSO), 故以 token 反查之 isAdmin 為權威 (同 w-web-api; w-web-perm 以自身 users 表為權威).
//  應用系統 token: 使用者用途 (綁定使用者) 於 sso 反查回所綁使用者之實際資料, 其 isAdmin 即所綁使用者者, 與使用者 token 相同; 系統服務用途 (不綁使用者)
//  反查回 id 'app:<金鑰主鍵>'、isAdmin 'y', 即系統管理員等級. 本套件不分辨用途 (不讀 isApp), 一律以 isAdmin 判等級.
//頻道管理者: 本套件不設. channelMembers.role 為後台可編之自由文字欄 (owner / member), channels.ownerId 亦為後台可編欄, 皆無強制語意, 不得作為授權依據;
//  管理類 (頻道與成員之建立、修改、刪除) 一律限系統管理員.
//頻道成員: channelMembers 中 (channelId, memberId = 呼叫者 id, isActive = 'y') 之列; 判準僅此一處 (isMemberOf / memberChannelIds).
//
//規則 (分類 → 呼叫者): user 任一已驗證者 | admin 限系統管理員 | channel 限系統管理員或該頻道成員 | task 限系統管理員或該任務所屬頻道成員 | participant 限系統管理員或任一頻道之成員.
//  user 類之清單與統計只回呼叫者有權看之頻道之資料 (非管理員只見所屬頻道).


//拒絕鍵 (procLang 有 eng / cht)
const KEY_NOT_ADMIN = 'errUserNotAdmin'
const KEY_NOT_MEMBER = 'errChannelNotMember'
const KEY_TASK_NOT_FOUND = 'errTaskNotFound' //非成員取用任務一律回 errTaskNotFound, 不洩漏任務存在與否
const KEY_ID_MISSING = 'errUserIdMissing'

//呼叫者登錄之有效期: 資料通道每個函數呼叫前皆先經 getUserIdByToken 完整驗證並刷新登錄, 登錄只供其後毫秒級之同一呼叫使用, 逾期一律拒絕 (fail-closed)
const CALLER_TTL_MS = 60 * 1000
const CALLER_PRUNE_SIZE = 1000
const CALLER_PRUNE_GAP_MS = 5 * 1000


function createAccess({ woItems, srLog, now = Date.now }) {

    if (!iseobj(woItems) || !iseobj(srLog)) {
        throw new Error('invalid deps of access, need woItems and srLog')
    }


    //isAdminUser: 系統管理員判準之單一擁有者. 只認自有屬性 isAdmin 嚴格等於 'y'
    let isAdminUser = (user) => {
        return iseobj(user) && Object.prototype.hasOwnProperty.call(user, 'isAdmin') && user.isAdmin === 'y'
    }


    //callerOfUser: 已驗證之使用者物件 → 呼叫者 (HTTP 路由用; id 已由 getTokenUser 驗為非空字串)
    let callerOfUser = (user) => {
        return { id: get(user, 'id', ''), isAdmin: isAdminUser(user) }
    }


    //kpCaller: userId → { isAdmin, at }. 資料通道之函數只收 userId (w-serv-webdata 將 getUserIdByToken 之回傳值交給函數), 角色須在 getUserIdByToken 完整驗證當下登錄,
    //供其後同一呼叫查回. 只有 remember (由 getUserIdByToken 驗證通過後呼叫) 會寫入; 無登錄或逾期者 callerOf 一律拒絕.
    let kpCaller = new Map()
    let seqNow = 0
    let tPrune = 0

    //nextSeq: 驗證開始時取序號 (單調遞增), 供 remember 辨別驗證之先後. 同一 userId 之並行驗證可能顛倒完成順序 (上游反查耗時不一),
    //若角色恰於其間變更, 晚完成但較早開始之驗證不得蓋掉較晚開始者之結果 (外審 opus#7)
    let nextSeq = () => {
        seqNow += 1
        return seqNow
    }

    //remember(user, seq): 只接受不舊於現有登錄之序號; 被忽略者其函數仍會讀到較新之登錄 (角色降級時偏嚴, 升級時為現況)
    let remember = (user, seq = nextSeq()) => {
        let id = get(user, 'id', '')
        if (!isestr(id)) {
            return
        }
        let o = kpCaller.get(id)
        if (o !== undefined && o.seq > seq) {
            return
        }
        let t = now()
        kpCaller.set(id, { isAdmin: isAdminUser(user), at: t, seq })
        if (kpCaller.size > CALLER_PRUNE_SIZE && t - tPrune >= CALLER_PRUNE_GAP_MS) { //清除逾期登錄: 至多每 CALLER_PRUNE_GAP_MS 掃一次, 避免登錄多時每次寫入皆 O(n)
            tPrune = t
            for (let [k, v] of kpCaller) {
                if (t - v.at > CALLER_TTL_MS) {
                    kpCaller.delete(k)
                }
            }
        }
    }

    let callerOf = async (userId) => {
        let o = isestr(userId) ? kpCaller.get(userId) : undefined
        if (o === undefined || now() - o.at > CALLER_TTL_MS) {
            srLog.error({ event: 'callerOf', err: KEY_ID_MISSING })
            return Promise.reject(KEY_ID_MISSING)
        }
        return { id: userId, isAdmin: o.isAdmin }
    }


    //deny: 拒絕並記 srLog (只記函數名、呼叫者 id 與 key; 不記 token)
    let deny = (func, caller, key) => {
        srLog.warn({ event: 'access-denied', func, userId: get(caller, 'id', ''), err: key })
        return Promise.reject(key)
    }


    //成員查詢 (判準之單一處)
    let isMemberOf = async (callerId, channelId) => {
        if (!isestr(callerId) || !isestr(channelId)) {
            return false
        }
        let ms = await woItems.channelMembers.select({ channelId, memberId: callerId, isActive: 'y' })
        return isarr(ms) && ms.length > 0
    }

    let memberChannelIds = async (callerId) => {
        let ids = new Set()
        if (!isestr(callerId)) {
            return ids
        }
        let ms = await woItems.channelMembers.select({ memberId: callerId, isActive: 'y' })
        for (let m of (isarr(ms) ? ms : [])) {
            ids.add(m.channelId)
        }
        return ids
    }


    //requireAdmin: 管理類 → 限系統管理員
    let requireAdmin = async (func, caller) => {
        if (!caller.isAdmin) {
            return deny(func, caller, KEY_NOT_ADMIN)
        }
    }

    //requireChannel: 頻道內容 → 限系統管理員或該頻道成員 (channelId 非字串者, 管理員交由業務函式回 errChannelIdInvalid, 一般使用者一律拒絕)
    let requireChannel = async (func, caller, channelId) => {
        if (caller.isAdmin) {
            return
        }
        if (!(await isMemberOf(caller.id, channelId))) {
            return deny(func, caller, KEY_NOT_MEMBER)
        }
    }

    //requireTask: 任務 → 限系統管理員或該任務所屬頻道之成員; 一般使用者查無任務與非成員同回 errTaskNotFound
    let requireTask = async (func, caller, taskId) => {
        if (caller.isAdmin) {
            return
        }
        if (!isestr(taskId)) {
            return deny(func, caller, KEY_TASK_NOT_FOUND)
        }
        let rs = await woItems.tasks.select({ id: taskId })
        let t = get(rs, '0')
        if (!iseobj(t) || !(await isMemberOf(caller.id, t.channelId))) {
            return deny(func, caller, KEY_TASK_NOT_FOUND)
        }
    }

    //requireParticipant: 檔案 → 限系統管理員或任一頻道之有效成員 (檔案不屬單一頻道; 無任何頻道者無使用理由)
    let requireParticipant = async (func, caller) => {
        if (caller.isAdmin) {
            return
        }
        let ids = await memberChannelIds(caller.id)
        if (ids.size === 0) {
            return deny(func, caller, KEY_NOT_MEMBER)
        }
    }


    //scopeIds: 呼叫者有權看之頻道集合; 管理員回 null (不限)
    let scopeIds = async (caller) => {
        if (caller.isAdmin) {
            return null
        }
        return await memberChannelIds(caller.id)
    }

    //scopeChannels: 頻道清單 → 只留呼叫者有權看之頻道
    let scopeChannels = async (caller, rows) => {
        let ids = await scopeIds(caller)
        if (ids === null) {
            return rows
        }
        return filter(isarr(rows) ? rows : [], (r) => ids.has(r.id))
    }

    //scopeSelect: 資料通道之表 select (同步用) → 一般使用者只得所屬頻道之列; 非 select 或非陣列結果對一般使用者回空陣列 (fail-closed)
    let scopeSelect = async (caller, tableName, methodName, rows) => {
        if (caller.isAdmin) {
            return rows
        }
        if (methodName !== 'select' || !isarr(rows)) {
            return []
        }
        let ids = await memberChannelIds(caller.id)
        if (tableName === 'channels') {
            return filter(rows, (r) => ids.has(r.id))
        }
        if (tableName === 'channelMembers') {
            return filter(rows, (r) => ids.has(r.channelId))
        }
        return []
    }


    return {
        isAdminUser,
        callerOfUser,
        nextSeq,
        remember,
        callerOf,
        callerCount: () => kpCaller.size, //登錄筆數(測試用: 驗逾期登錄之清除)
        isMemberOf,
        memberChannelIds,
        requireAdmin,
        requireChannel,
        requireTask,
        requireParticipant,
        scopeIds,
        scopeChannels,
        scopeSelect,
    }
}


//createGuardedFuncs: 全部對外入口函數 (資料通道 kpFunExt 與 HTTP REST 共用) 與其規則之單一表; 每個函數收 (caller, ...args), 先過規則再呼叫 procCore.
//新增入口函數須加於此表 (kpFunExt 與 apis 皆經此表取得函數, 結構上不可能繞過規則)
function createGuardedFuncs({ access, pc, getWebInfor }) {

    if (!iseobj(access) || !iseobj(pc) || !isfun(getWebInfor)) {
        throw new Error('invalid deps of createGuardedFuncs')
    }

    let a = access
    let f = {}

    //user: 任一已驗證者
    f.getWebInfor = async (c) => getWebInfor(c.id)

    //清單與統計: 只回呼叫者有權看之頻道之資料
    f.getChannelsList = async (c, agentId) => a.scopeChannels(c, await pc.getChannelsList(c.id, agentId))
    f.getStats = async (c) => pc.getStats(c.id, await a.scopeIds(c))

    //admin: 管理類
    let admin = (name, fn) => {
        f[name] = async (c, ...args) => {
            await a.requireAdmin(name, c)
            return await fn(c.id, ...args)
        }
    }
    admin('saveChannels', pc.saveChannels)
    admin('deleteChannels', pc.deleteChannels)
    admin('saveChannel', pc.saveChannel)
    admin('deleteChannel', pc.deleteChannel)
    admin('saveChannelMembers', pc.saveChannelMembers)
    admin('deleteChannelMembers', pc.deleteChannelMembers)
    admin('saveChannelMember', pc.saveChannelMember)
    admin('deleteChannelMember', pc.deleteChannelMember)

    //channel: 第 1 個參數為 channelId
    let byChannel = (name, fn) => {
        f[name] = async (c, channelId, ...args) => {
            await a.requireChannel(name, c, channelId)
            return await fn(c.id, channelId, ...args)
        }
    }
    byChannel('getChannelMembers', pc.getChannelMembers)
    byChannel('getMessages', pc.getMessages)
    byChannel('postMessage', pc.postMessage)
    byChannel('getTasks', pc.getTasks)
    byChannel('getArchivedTasks', pc.getArchivedTasks)
    byChannel('getArchivedMessages', pc.getArchivedMessages)
    //ackChannel: 缺列時只有管理員可建列 (allowInsert); 一般使用者之成員列於授權檢查後若被移除, 不得藉缺列路徑重新加回 (見 procCore.ackChannel); 固定三個參數, 不轉傳呼叫者多給之參數
    f.ackChannel = async (c, channelId, lastMessageId) => {
        await a.requireChannel('ackChannel', c, channelId)
        return await pc.ackChannel(c.id, channelId, lastMessageId, c.isAdmin)
    }

    //task: 第 1 個參數為 taskId
    let byTask = (name, fn) => {
        f[name] = async (c, taskId, ...args) => {
            await a.requireTask(name, c, taskId)
            return await fn(c.id, taskId, ...args)
        }
    }
    byTask('getTask', pc.getTask)
    byTask('claimTask', pc.claimTask)
    byTask('respondTask', pc.respondTask)
    byTask('resetTask', pc.resetTask)

    //participant: 檔案
    let byParticipant = (name, fn) => {
        f[name] = async (c, ...args) => {
            await a.requireParticipant(name, c)
            return await fn(c.id, ...args)
        }
    }
    byParticipant('uploadFile', pc.saveFile)
    byParticipant('getFileInfo', pc.getFileInfo)
    f.getFile = async (c, id) => { //HTTP 串流用: 回 { buf, info }
        await a.requireParticipant('getFile', c)
        return await pc.readFile(id)
    }

    return f
}


export { createAccess, createGuardedFuncs, KEY_NOT_ADMIN, KEY_NOT_MEMBER }
