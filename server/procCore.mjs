import fs from 'fs'
import path from 'path'
import ot from 'dayjs'
import get from 'lodash-es/get.js'
import filter from 'lodash-es/filter.js'
import pick from 'lodash-es/pick.js'
import isarr from 'wsemi/src/isarr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import cint from 'wsemi/src/cint.mjs'
import cbol from 'wsemi/src/cbol.mjs'
import nowms2str from 'wsemi/src/nowms2str.mjs'


//dbf: 圖台檔案實體儲存目錄 (id 無副檔名). 啟動時確保存在.
let dbfDir = './dbf'


//核心業務 (channel / member / message / task CRUD + 任務生命週期).
//所有寫入用 woItems 直接操作 (insert / save / del), 不走 procOrm (避免 clearXSS 改動 markdown content / result);
//稽核欄位手動處理: insert 用 ds[t].funNew({ ..., userId }) 產生; save 傳 { id, ..., timeUpdate, userIdUpdate }.
//所有業務函式第一參數為 userId (操作者身分, 來自 token). 錯誤一律 return Promise.reject('errKey') (procLang 有定義).
function procCore(deps = {}) {

    //deps
    let { woItems, procOrm, ds, srLog, kmx } = deps


    //確保 dbf 圖台目錄存在 (檔案實體寫入落點)
    if (!fs.existsSync(dbfDir)) {
        fs.mkdirSync(dbfDir, { recursive: true })
    }


    //getChannelsList: 頻道清單 (時序遞增, UUIDv7 已是時序). agentId 非空時依主責 agent 過濾, 並掛「呼叫者」游標.
    //【游標讀寫對稱 (D7/D8)】游標一律以「呼叫者 token 身分 userId」為 key 讀取, 與 ackChannel 之寫入 (memberId=userId)
    //對稱; agentId 僅為「過濾出哪些頻道由此 agent 主責」之查詢參數, 不作為游標 key. 故即使部署時 channel.agentId
    //為友善名稱 (≠ SSO 解析之 user.id), 游標讀(userId)與寫(userId)仍命中同一列, 不會出現「游標永不前進、訊息每輪重讀」.
    let getChannelsList = async (userId, agentId = '') => {

        let rs = await woItems.channels.select({ isActive: 'y' })

        //依主責 agent 過濾, 並對每筆掛 lastSeenMessageId 游標 (以呼叫者 userId 為 key)
        if (isestr(agentId) && agentId) {
            rs = filter(rs, (r) => r.agentId === agentId)
            //一次取回呼叫者全部 member 列, 記憶體建 channelId→lastSeenMessageId 對照, 避免逐頻道 N+1 查詢
            let ms = await woItems.channelMembers.select({ memberId: userId, isActive: 'y' })
            let kp = {}
            for (let m of ms) {
                kp[m.channelId] = get(m, 'lastSeenMessageId', '')
            }
            for (let r of rs) {
                r.lastSeenMessageId = kp[r.id] || ''
            }
        }

        return rs
    }


    //saveChannel: 新增 / 變更頻道. 設 agentId 時確保有對應 agent member 列.
    let saveChannel = async (userId, row) => {

        //check
        if (!iseobj(row)) {
            return Promise.reject('errChannelRowInvalid')
        }

        //save / insert
        let r
        let channelId
        if (isestr(row.id)) {
            //更新: 只存 row 實際帶入之 schema 欄位 + 稽核, 避免 funNew 補 '' 覆寫既有值
            let o = pick(row, ds.channels.keys)
            o.id = row.id
            o.timeUpdate = nowms2str()
            o.userIdUpdate = userId
            r = await woItems.channels.save([o])
            channelId = row.id
        }
        else {
            //新筆: funNew 產完整列後 insert
            let o = ds.channels.funNew({ ...row, userId })
            r = await woItems.channels.insert(o)
            channelId = o.id
        }

        //確保主責 agent 有對應 channelMembers 列 (memberType='agent'), 僅 row.agentId 有帶且非空時執行
        if (isestr(row.agentId) && row.agentId) {
            let ms = await woItems.channelMembers.select({ channelId, memberId: row.agentId, isActive: 'y' })
            if (!iseobj(get(ms, '0'))) {
                let m = ds.channelMembers.funNew({ channelId, memberId: row.agentId, memberType: 'agent', userId })
                await woItems.channelMembers.insert(m)
            }
        }

        return r
    }


    //deleteChannel: 刪除頻道 (不連帶刪訊息 / 任務, 軟性即可).
    let deleteChannel = async (userId, id) => {

        //check
        if (!isestr(id)) {
            return Promise.reject('errChannelIdInvalid')
        }

        let r = await woItems.channels.del({ id })

        return r
    }


    //getChannelMembers: 成員清單.
    let getChannelMembers = async (userId, channelId) => {

        //check
        if (!isestr(channelId)) {
            return Promise.reject('errChannelIdInvalid')
        }

        let rs = await woItems.channelMembers.select({ channelId, isActive: 'y' })

        return rs
    }


    //saveChannelMember: 新增 / 變更成員.
    let saveChannelMember = async (userId, row) => {

        //check
        if (!iseobj(row)) {
            return Promise.reject('errMemberRowInvalid')
        }

        //save / insert
        let r
        if (isestr(row.id)) {
            //更新: 只存 row 實際帶入之 schema 欄位 + 稽核, 避免 funNew 補 '' 覆寫既有值
            let o = pick(row, ds.channelMembers.keys)
            o.id = row.id
            o.timeUpdate = nowms2str()
            o.userIdUpdate = userId
            r = await woItems.channelMembers.save([o])
        }
        else {
            //新筆: funNew 產完整列後 insert
            let o = ds.channelMembers.funNew({ ...row, userId })
            r = await woItems.channelMembers.insert(o)
        }

        return r
    }


    //deleteChannelMember: 刪除成員.
    let deleteChannelMember = async (userId, id) => {

        //check
        if (!isestr(id)) {
            return Promise.reject('errMemberIdInvalid')
        }

        let r = await woItems.channelMembers.del({ id })

        return r
    }


    //getMessages: 頻道訊息 (時序 asc). afterId 給定則回該 id 之後全部新訊息 (上限 500); 否則回最近 n 筆.
    let getMessages = async (userId, channelId, n = 20, afterId = '') => {

        //check
        if (!isestr(channelId)) {
            return Promise.reject('errChannelIdInvalid')
        }

        //正規化 n
        let nn = cint(n)
        if (nn < 1) { nn = 20 }
        nn = Math.min(nn, 500)

        let rs = await woItems.messages.select({ channelId, isActive: 'y' })

        //afterId
        if (isestr(afterId) && afterId) {
            rs = filter(rs, (r) => r.id > afterId).slice(0, 500) //時序 asc, 上限 500
        }
        else {
            rs = rs.slice(-nn) //最近 nn, 時序 asc
        }

        return rs
    }


    //postMessage: 傳訊至頻道 (asTask=true 同時開任務). senderId 一律取自 token 身分.
    let postMessage = async (userId, channelId, content, opt = {}) => {

        //check
        if (!isestr(channelId)) {
            return Promise.reject('errChannelIdInvalid')
        }
        //content 與 attachments 至少一者非空 (v2: 允許「純圖訊息」— 貼圖不打字直接送; 對應 spec §10.2 可貼多圖)
        let attachmentsArrChk = get(opt, 'attachments')
        let hasAttachments = isarr(attachmentsArrChk) && attachmentsArrChk.length > 0
        if (!isestr(content) && !hasAttachments) {
            return Promise.reject('errContentInvalid')
        }
        //content 正規化為字串 (純圖訊息 content 可為空; 避免 funNew 寫入非字串或 title 取首行 .split 於 null 出錯)
        if (!isestr(content)) {
            content = ''
        }

        //kmx: 同頻道發訊序列化 (asTask 原子寫 message + task)
        return await kmx('postMessage:' + channelId, async () => {

            let asTask = cbol(get(opt, 'asTask', false))
            let senderType = get(opt, 'senderType', 'human')

            //attachments: opt.attachments 為陣列 (file id 清單) 時存 JSON 字串, 否則 '[]'
            let attachmentsArr = get(opt, 'attachments')
            let attachments = isarr(attachmentsArr) ? JSON.stringify(attachmentsArr) : '[]'

            //insert message
            let message = ds.messages.funNew({
                channelId,
                senderId: userId,
                senderType,
                kind: asTask ? 'task' : 'text',
                content,
                attachments,
                userId,
            })
            await woItems.messages.insert(message)

            //asTask: 開任務
            if (asTask) {

                //title: 缺省取 content 首行 (截斷至 100)
                let title = get(opt, 'title', '') || content.split(/\r?\n/)[0].slice(0, 100)

                //insert task
                let task = ds.tasks.funNew({
                    channelId,
                    messageId: message.id,
                    title,
                    payload: content,
                    state: 'pending',
                    userId,
                })
                await woItems.tasks.insert(task)

                //save message: 回指 task.id
                await woItems.messages.save({
                    id: message.id,
                    taskId: task.id,
                    timeUpdate: nowms2str(),
                    userIdUpdate: userId,
                })
                message.taskId = task.id

                return { message, task }
            }

            return { message }
        })
    }


    //getTasks: 頻道任務. state 過濾; order='asc' 取最舊優先 (FIFO), 'desc' 取最近優先 (預設).
    let getTasks = async (userId, channelId, n = 20, state = '', order = 'desc') => {

        //check
        if (!isestr(channelId)) {
            return Promise.reject('errChannelIdInvalid')
        }

        //正規化 n
        let nn = cint(n)
        if (nn < 1) { nn = 20 }
        nn = Math.min(nn, 500)

        //query
        let q = { channelId, isActive: 'y' }
        if (isestr(state) && state) {
            q.state = state
        }

        let rs = await woItems.tasks.select(q) //時序 asc

        //order
        if (order === 'asc') {
            rs = rs.slice(0, nn) //最舊 nn, asc
        }
        else {
            rs = rs.slice(-nn).reverse() //最近 nn, desc
        }

        return rs
    }


    //getTask: 單一任務詳情.
    let getTask = async (userId, taskId) => {

        //check
        if (!isestr(taskId)) {
            return Promise.reject('errTaskIdInvalid')
        }

        let rs = await woItems.tasks.select({ id: taskId })
        let t = get(rs, '0')

        //check
        if (!iseobj(t)) {
            return Promise.reject('errTaskNotFound')
        }

        return t
    }


    //claimTask: 認領任務 (pending→running). assigneeId = token 身分. kmx 鎖內守衛 state==='pending'.
    let claimTask = async (userId, taskId) => {

        //check
        if (!isestr(taskId)) {
            return Promise.reject('errTaskIdInvalid')
        }

        //kmx: 同任務序列化, 鎖內守衛
        return await kmx('task:' + taskId, async () => {

            let rs = await woItems.tasks.select({ id: taskId })
            let t = get(rs, '0')

            //check
            if (!iseobj(t)) {
                return Promise.reject('errTaskNotFound')
            }
            if (t.state !== 'pending') {
                return Promise.reject('errTaskAlreadyClaimed')
            }

            //save: pending→running
            await woItems.tasks.save({
                id: taskId,
                state: 'running',
                assigneeId: userId,
                timeClaim: nowms2str(),
                timeUpdate: nowms2str(),
                userIdUpdate: userId,
            })

            //回更新後 task
            let rs2 = await woItems.tasks.select({ id: taskId })
            return get(rs2, '0')
        })
    }


    //respondTask: 回應任務 (唯一終態入口; running→done/error; 寫 result + 發 taskReply). kmx 鎖內守衛 state==='running'.
    let respondTask = async (userId, taskId, result, state = 'done', errorKey = '', senderType = 'agent') => {

        //check
        if (!isestr(taskId)) {
            return Promise.reject('errTaskIdInvalid')
        }
        if (!isestr(result)) {
            return Promise.reject('errResultInvalid')
        }
        if (state !== 'done' && state !== 'error') {
            return Promise.reject('errStateInvalid')
        }

        //kmx: 同任務序列化, 鎖內守衛
        return await kmx('task:' + taskId, async () => {

            let rs = await woItems.tasks.select({ id: taskId })
            let t = get(rs, '0')

            //check
            if (!iseobj(t)) {
                return Promise.reject('errTaskNotFound')
            }
            if (t.state !== 'running') {
                return Promise.reject('errTaskNotRunning')
            }

            //insert message: taskReply (鏡射至頻道時間軸)
            let message = ds.messages.funNew({
                channelId: t.channelId,
                senderId: userId,
                senderType,
                kind: 'taskReply',
                content: result,
                taskId: taskId,
                userId,
            })
            await woItems.messages.insert(message)

            //save task: 終態
            await woItems.tasks.save({
                id: taskId,
                result,
                state,
                errorKey: errorKey || '',
                resultMessageId: message.id,
                timeDone: nowms2str(),
                timeUpdate: nowms2str(),
                userIdUpdate: userId,
            })

            //回更新後 task
            let rs2 = await woItems.tasks.select({ id: taskId })
            return get(rs2, '0')
        })
    }


    //resetTask: 重置任務 (error/running→pending; 清殘留欄位). kmx 鎖內守衛 state∈{error,running}.
    let resetTask = async (userId, taskId) => {

        //check
        if (!isestr(taskId)) {
            return Promise.reject('errTaskIdInvalid')
        }

        //kmx: 同任務序列化, 鎖內守衛
        return await kmx('task:' + taskId, async () => {

            let rs = await woItems.tasks.select({ id: taskId })
            let t = get(rs, '0')

            //check
            if (!iseobj(t)) {
                return Promise.reject('errTaskNotFound')
            }
            if (t.state !== 'error' && t.state !== 'running') {
                return Promise.reject('errTaskNotResettable')
            }

            //save: 清空殘留欄位給空字串 '' (lodash merge 不清 undefined), 設 pending
            await woItems.tasks.save({
                id: taskId,
                state: 'pending',
                result: '',
                errorKey: '',
                assigneeId: '',
                timeClaim: '',
                timeDone: '',
                resultMessageId: '',
                timeUpdate: nowms2str(),
                userIdUpdate: userId,
            })

            //回更新後 task
            let rs2 = await woItems.tasks.select({ id: taskId })
            return get(rs2, '0')
        })
    }


    //ackChannel: 推進呼叫者 (agent) 在該頻道之已讀游標. 缺列者 upsert.
    let ackChannel = async (userId, channelId, lastMessageId) => {

        //check
        if (!isestr(channelId)) {
            return Promise.reject('errChannelIdInvalid')
        }
        if (!isestr(lastMessageId)) {
            return Promise.reject('errLastMessageIdInvalid')
        }

        //查 member 列
        let ms = await woItems.channelMembers.select({ channelId, memberId: userId })
        let m = get(ms, '0')

        if (iseobj(m)) {
            //有則 save 推進游標
            await woItems.channelMembers.save({
                id: m.id,
                lastSeenMessageId: lastMessageId,
                timeUpdate: nowms2str(),
                userIdUpdate: userId,
            })
        }
        else {
            //無則 insert (memberType='agent')
            let o = ds.channelMembers.funNew({
                channelId,
                memberId: userId,
                memberType: 'agent',
                role: 'member',
                lastSeenMessageId: lastMessageId,
                userId,
            })
            await woItems.channelMembers.insert(o)
        }

        return { ok: true }
    }


    //saveFile: 上傳檔案至圖台. inp={name,type,dataBase64}. 寫 ./dbf/<id> 實體 + insert files, 回 {id,name,type,size}.
    let saveFile = async (userId, inp) => {

        //check
        if (!iseobj(inp)) {
            return Promise.reject('errFileRowInvalid')
        }
        let name = get(inp, 'name')
        let type = get(inp, 'type')
        if (!isestr(name) || !isestr(type)) {
            return Promise.reject('errFileRowInvalid')
        }
        let dataBase64 = get(inp, 'dataBase64')
        if (!isestr(dataBase64)) {
            return Promise.reject('errUploadInvalid')
        }

        //buf
        let buf = Buffer.from(dataBase64, 'base64')

        //ext: 由原始檔名末尾 .xxx 取得 (無則 '')
        let ext = name.includes('.') ? name.split('.').pop() : ''

        //funNew 產生 row (取得 id)
        let row = ds.files.funNew({ name, type, ext, userId })

        //寫實體 bytes 至 ./dbf/<id> (無副檔名)
        fs.writeFileSync(path.join(dbfDir, row.id), buf)

        //size 由實際 bytes 長度寫入
        row.size = buf.length

        //insert files
        await woItems.files.insert([row])

        return { id: row.id, name: row.name, type: row.type, size: row.size }
    }


    //getFileInfo: 查檔案 metadata.
    let getFileInfo = async (userId, id) => {

        //check
        if (!isestr(id)) {
            return Promise.reject('errFileIdInvalid')
        }

        let rs = await woItems.files.select({ id })
        let f = get(rs, '0')

        //check
        if (!iseobj(f)) {
            return Promise.reject('errFileNotFound')
        }

        return f
    }


    //readFile: 內部用 (供 HTTP getFile 串流二進位). 回 { buf, info }. metadata 檢查統一走 getFileInfo (單點維護).
    let readFile = async (id) => {

        //getFileInfo (含 id 檢查與 errFileNotFound 守衛)
        let f = await getFileInfo('', id)

        //實體檔案落點
        let fp = path.join(dbfDir, id)
        if (!fs.existsSync(fp)) {
            return Promise.reject('errFileNotFound')
        }

        return { buf: fs.readFileSync(fp), info: f }
    }


    //getStats: 系統統計. 回 { channels, messages, tasks:{pending,running,done,error,total} }. tasks 單次掃描後記憶體分態計數.
    let getStats = async (userId) => {

        let channels = await woItems.channels.select({ isActive: 'y' })
        let messages = await woItems.messages.select({ isActive: 'y' })
        let tasksAll = await woItems.tasks.select({ isActive: 'y' })

        let kn = { pending: 0, running: 0, done: 0, error: 0 }
        for (let t of tasksAll) {
            if (kn[t.state] !== undefined) {
                kn[t.state] += 1
            }
        }

        return {
            channels: channels.length,
            messages: messages.length,
            tasks: {
                pending: kn.pending,
                running: kn.running,
                done: kn.done,
                error: kn.error,
                total: tasksAll.length,
            },
        }
    }


    //archiveSweep: 封存掃描 (spec D12 方向②: 冷熱分離). 將「終態 (done/error) 且 timeDone 早於 cutoff」之任務
    //與「timeCreate 早於 cutoff」之舊訊息, 自熱表搬至 tasksArchive/messagesArchive 冷表.
    //守衛: 任務相關訊息 (kind='task'/'taskReply') 若其任務仍在熱表則不搬 (訊息不早於其任務離開熱表, 時間軸與任務詳情一致).
    //搬移順序「先 upsert 冷表、再刪熱表」→ 中斷重跑冪等 (冷表 save 為 upsert, 重複執行無害).
    //archiveAfterDays<=0 視為停用. 回 { tasksMoved, messagesMoved }.
    let archiveSweep = async (archiveAfterDays) => {

        //nd
        let nd = cint(archiveAfterDays)
        if (nd <= 0) {
            return { tasksMoved: 0, messagesMoved: 0 }
        }

        //cutoff (timemsTZ 字串, 與資料同格式可字典序比較)
        let cutoff = ot().subtract(nd, 'day').format('YYYY-MM-DDTHH:mm:ss.SSSZ')

        //tasks: 終態且 timeDone 早於 cutoff → 搬冷表
        let ts = await woItems.tasks.select({ isActive: 'y' })
        let tsOld = filter(ts, (t) => {
            let b1 = t.state === 'done' || t.state === 'error'
            let b2 = isestr(t.timeDone) && t.timeDone < cutoff
            return b1 && b2
        })
        if (tsOld.length > 0) {
            await woItems.tasksArchive.save(tsOld) //upsert, 重跑冪等
            for (let t of tsOld) {
                await woItems.tasks.del({ id: t.id })
            }
        }

        //熱表殘留任務 id 集合 (封存後重算), 供訊息守衛
        let kpHotTask = {}
        for (let t of ts) {
            kpHotTask[t.id] = true
        }
        for (let t of tsOld) {
            delete kpHotTask[t.id]
        }

        //messages: timeCreate 早於 cutoff → 搬冷表; 任務相關訊息其任務仍在熱表者保留
        let ms = await woItems.messages.select({ isActive: 'y' })
        let msOld = filter(ms, (m) => {
            let b1 = isestr(m.timeCreate) && m.timeCreate < cutoff
            let bTaskKind = (m.kind === 'task' || m.kind === 'taskReply') && isestr(m.taskId)
            let bGuard = bTaskKind && kpHotTask[m.taskId] === true //其任務仍在熱表 → 不搬
            return b1 && !bGuard
        })
        if (msOld.length > 0) {
            await woItems.messagesArchive.save(msOld) //upsert, 重跑冪等
            for (let m of msOld) {
                await woItems.messages.del({ id: m.id })
            }
        }

        return { tasksMoved: tsOld.length, messagesMoved: msOld.length }
    }


    //getArchivedTasks: 冷表任務查詢 (後台/稽核用). order='asc' 最舊優先, 'desc' 最近優先 (預設).
    let getArchivedTasks = async (userId, channelId, n = 20, order = 'desc') => {

        //check
        if (!isestr(channelId)) {
            return Promise.reject('errChannelIdInvalid')
        }

        //正規化 n
        let nn = cint(n)
        if (nn < 1) { nn = 20 }
        nn = Math.min(nn, 500)

        let rs = await woItems.tasksArchive.select({ channelId, isActive: 'y' }) //時序 asc

        //order
        if (order === 'asc') {
            rs = rs.slice(0, nn)
        }
        else {
            rs = rs.slice(-nn).reverse()
        }

        return rs
    }


    //getArchivedMessages: 冷表訊息查詢 (稽核用). 回最近 n 筆 (時序 asc).
    let getArchivedMessages = async (userId, channelId, n = 20) => {

        //check
        if (!isestr(channelId)) {
            return Promise.reject('errChannelIdInvalid')
        }

        //正規化 n
        let nn = cint(n)
        if (nn < 1) { nn = 20 }
        nn = Math.min(nn, 500)

        let rs = await woItems.messagesArchive.select({ channelId, isActive: 'y' })

        return rs.slice(-nn) //最近 nn, 時序 asc
    }


    return {
        getChannelsList,
        saveChannel,
        deleteChannel,
        getChannelMembers,
        saveChannelMember,
        deleteChannelMember,
        getMessages,
        postMessage,
        getTasks,
        getTask,
        claimTask,
        respondTask,
        resetTask,
        ackChannel,
        saveFile,
        getFileInfo,
        readFile,
        getStats,
        archiveSweep,
        getArchivedTasks,
        getArchivedMessages,
    }
}


export default procCore
