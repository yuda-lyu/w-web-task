import fs from 'fs'
import path from 'path'
import ot from 'dayjs'
import get from 'lodash-es/get.js'
import filter from 'lodash-es/filter.js'
import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import cint from 'wsemi/src/cint.mjs'
import cbol from 'wsemi/src/cbol.mjs'
import nowms2str from 'wsemi/src/nowms2str.mjs'
import { digestRow, pickWriteRow, getRejectKey } from 'w-serv-orm/src/baseline.mjs'
import channelsContract from '../src/schema/contracts/channels.mjs'
import getMembersContract from '../src/schema/contracts/channelMembers.mjs'


//dbf: 圖台檔案實體儲存目錄 (id 無副檔名). 啟動時確保存在.
let dbfDir = './dbf'


//後台清單 API 與其他寫入 channels / channelMembers 者共用之表鎖集合 (withTabLocks 內依表名碼元序取鎖: channelMembers < channels).
//鎖序恆為 lockSave(不排隊之雙擊占位) → 表鎖 → 實體鎖(task:<id> / channelMember:<c>:<m>); 表鎖不可重入, 同一呼叫鏈勿巢狀取鎖 (規格 §7).
const TABS_CH = ['channelMembers', 'channels']


//核心業務 (channel / member / message / task CRUD + 任務生命週期).
//所有寫入用 woItems 直接操作 (insert / save / del), 不走 procOrm (避免 clearXSS 改動 markdown content / result);
//稽核欄位手動處理: insert 用 ds[t].funNew({ ..., userId }) 產生; save 傳 { id, ..., timeUpdate, userIdUpdate }.
//所有業務函式第一參數為 userId (操作者身分, 來自 token). 錯誤一律 return Promise.reject('errKey') (procLang 有定義).
//併發控制三種(皆由 WWebTask 建立後注入, procCore 本身不建 timer): kmx 為 wsemi pmKeyMutex(同 key 序列化, 用於須原子之讀改寫);
//lockSave 為雙擊防護(見 lockSave.mjs, spec D16; 同一操作者之同一操作或同一列處理中再送出即 reject, 不排隊);
//withTabLocks / guardWrite 為 w-serv-orm 之表鎖與「取鎖 → 新鮮讀取 → 基準比對 → 寫入」原子防護 (多人同時編輯, 原則 10; 規格 dspec/多人同時編輯之寫入契約.md).
//多人同時編輯: channels / channelMembers 兩表之寫入者一律取表鎖; 後台清單 API (saveChannels / deleteChannels / saveChannelMembers / deleteChannelMembers)
//帶載入時之基準 (opt.baseline), 不符即整次拒收零寫入; 不帶基準者為外部呼叫 (後者蓋前者, 但只改不增、刪除未命中回 rowNotFound).
//寫入分段執行並存前像, 中途硬失敗 (非競爭, 如磁碟滿) 依序補償還原 (比照 w-web-perm cascadeWrite); 補償亦失敗回 saveWriteFail 並記 log.
function procCore(deps = {}) {

    //deps
    let { woItems, procOrm, ds, srLog, kmx, lockSave, withTabLocks, guardWrite } = deps

    //check: 表鎖與原子防護為多人同時編輯之必要依賴 (WServOrm 回傳物件含之), 缺則 fail-fast, 不以無鎖狀態運作
    if (!isfun(withTabLocks) || !isfun(guardWrite)) {
        throw new Error('invalid deps of procCore, need withTabLocks and guardWrite from WServOrm')
    }


    //確保 dbf 圖台目錄存在 (檔案實體寫入落點)
    if (!fs.existsSync(dbfDir)) {
        fs.mkdirSync(dbfDir, { recursive: true })
    }


    //toArr: ORM 結果正規化為陣列 (lmdb 之 save / del 回與輸入等長之陣列, insert 回聚合物件)
    let toArr = (r) => {
        return isarr(r) ? r : [r]
    }


    //chkWrite: woItems 之 insert / save / del 結果檢查. ORM 對單筆失敗不 reject 而回 ok:0, 此處一律視為失敗而拋出;
    //needHit 為 true 時要求每筆 n>=1 (只改不增 / 刪除須命中; 表鎖內已確認存在, 未命中代表鎖紀律被破壞)
    let chkWrite = (res, label, needHit = false) => {
        for (let r of toArr(res)) {
            if (!iseobj(r) || r.ok !== 1) {
                throw new Error(`${label}: orm result is not ok`)
            }
            if (needHit && !(r.n >= 1)) {
                throw new Error(`${label}: orm result is not hit`)
            }
        }
        return res
    }


    //opInsert / opModify / opDelete: 可補償之寫入單元 { redo, undo }. 寫入前存前像 (pre), 補償皆為冪等 (失敗中之那一步亦會補償)
    let opInsert = (tab, row) => {
        return {
            redo: async () => {
                chkWrite(await woItems[tab].insert(row), `${tab}.insert`)
            },
            undo: async () => {
                chkWrite(await woItems[tab].del({ id: row.id }), `${tab}.del`)
            },
        }
    }
    let opModify = (tab, id, w, pre, lockKey = '') => {
        //還原只寫回本次改動之鍵 (合併寫入), 不整列覆寫: 其他欄位 (如 ack 同時推進之 lastSeenMessageId) 不被前像回寫.
        //客戶端欄位皆已驗為字串 (chkFieldTypes), 合併寫入 (lmdb 為深度合併) 可精確還原
        let restore = {}
        for (let k of Object.keys(w)) {
            restore[k] = pre[k] === undefined ? '' : pre[k]
        }
        let write = async () => {
            chkWrite(await woItems[tab].save({ id, ...w }, { autoInsert: false }), `${tab}.save`, true)
        }
        return {
            //lockKey: 成員列改 memberId (列之身分改變) 時, 於實體鎖 (與 ackChannel 更新路徑同一把) 內寫入, 使進行中之 ack 先完成, 不把某成員之游標寫進已換人之列
            redo: async () => {
                if (lockKey) {
                    await kmx(lockKey, write)
                }
                else {
                    await write()
                }
            },
            undo: async () => {
                chkWrite(await woItems[tab].save({ id, ...restore }, { autoInsert: false }), `${tab}.save`)
            },
        }
    }
    let opDelete = (tab, pre) => {
        return {
            redo: async () => {
                chkWrite(await woItems[tab].del({ id: pre.id }), `${tab}.del`, true)
            },
            undo: async () => {
                chkWrite(await woItems[tab].insert(pre), `${tab}.insert`)
            },
        }
    }
    //opDeleteMember: 刪除成員列. 於實體鎖 (與 ackChannel 更新路徑同一把 channelMember:<c>:<m>; 先表鎖後實體鎖) 內重讀前像再刪:
    //ack 於「前像取得後、刪除前」推進之游標納入前像, 後續補償 (重新 insert) 不會撤銷已成功之 ack
    let opDeleteMember = (pre) => {
        let cur = pre
        return {
            redo: async () => {
                await kmx(`channelMember:${pre.channelId}:${pre.memberId}`, async () => {
                    let rs = await woItems.channelMembers.select({ id: pre.id })
                    if (iseobj(get(rs, '0'))) {
                        cur = rs[0]
                    }
                    chkWrite(await woItems.channelMembers.del({ id: pre.id }), 'channelMembers.del', true)
                })
            },
            undo: async () => {
                chkWrite(await woItems.channelMembers.insert(cur), 'channelMembers.insert')
            },
        }
    }


    //opMoveTask: 刪頻道時將該頻道之一筆任務 (任何狀態) 移入冷表 tasksArchive (D12 之封存表; 格式與熱表完全相同, 原列整份複製).
    //於 task:<id> 實體鎖內重讀再搬 (鎖序: 表鎖 → 實體鎖; 與 claimTask / respondTask / resetTask / archiveSweep 互斥): 搬走後它們於鎖內重讀得 errTaskNotFound, 不會回寫已離開熱表之列.
    //列已不在熱表 (已被封存掃描搬走) → 略過. 先 upsert 冷表、再刪熱表 (冷表 save 為 upsert, 重跑冪等).
    //補償 (亦於同一把 task:<id> 鎖內, 與搬移對稱): 熱表補回前像 (鎖內重讀所得, 已存在則略過); 刪冷表複本——僅當冷表於搬移前原無該 id 之列 (中斷後重試遇「冷熱並存」之殘留者不刪原有冷表列, 以免補償使其遺失;
    //該殘留列之內容已被熱表前像覆寫, 為中斷之中間態). 補償置於鎖內: 否則封存掃描可於「熱表補回後、冷表複本刪除前」取鎖搬走該任務, 其後補償刪掉冷表複本, 任務兩表皆無.
    //stat.tasks 累計實際搬移筆數 (供 log)
    let opMoveTask = (taskId, stat) => {
        let cur = null
        let archExisted = false
        return {
            redo: async () => {
                await kmx('task:' + taskId, async () => {
                    let rs = await woItems.tasks.select({ id: taskId })
                    if (!iseobj(get(rs, '0'))) {
                        return
                    }
                    let ex = await woItems.tasksArchive.select({ id: taskId })
                    archExisted = ex.length > 0
                    cur = rs[0]
                    chkWrite(await woItems.tasksArchive.save(cur), 'tasksArchive.save')
                    chkWrite(await woItems.tasks.del({ id: taskId }), 'tasks.del', true)
                    stat.tasks += 1
                })
            },
            undo: async () => {
                if (!cur) {
                    return
                }
                await kmx('task:' + taskId, async () => {
                    chkWrite(await woItems.tasks.insert(cur), 'tasks.insert')
                    if (!archExisted) {
                        chkWrite(await woItems.tasksArchive.del({ id: cur.id }), 'tasksArchive.del')
                    }
                })
            },
        }
    }
    //opMoveMessages: 刪頻道時將該頻道全部訊息 (含 task / taskReply) 移入冷表 messagesArchive. 排在該頻道全部任務搬完之後, 且於執行時才讀取訊息:
    //任務搬走後 respondTask 得 errTaskNotFound (不再新增 taskReply), 發訊被 channels 表鎖擋在刪除之外, 故此時讀到之集合即最終集合 (含搬任務前才完成之 taskReply).
    //一次 upsert 冷表 (整批)、再整批刪熱表; 補償: 熱表補回 (已存在則略過)、刪冷表複本 (僅本次新增者, 冷表搬移前已有之同 id 列不刪).
    //搬移與補償皆於 msgarch:<channelId> 鎖內, 與封存掃描之訊息階段 (archiveSweep 依頻道分組取同一把鎖) 互斥: 否則掃描可於「冷表已寫、熱表尚未刪」之間與補償 (補回熱表、刪冷表複本) 交錯, 使該則訊息兩表皆無.
    //鎖序: 表鎖 → msgarch 鎖 (封存掃描只取 msgarch 鎖, 不取表鎖, 無倒置).
    let opMoveMessages = (channelId, stat) => {
        let moved = []
        let archIds = new Set()
        let key = 'msgarch:' + channelId
        return {
            redo: async () => {
                await kmx(key, async () => {
                    let hot = await woItems.messages.select({ channelId })
                    if (hot.length === 0) {
                        return
                    }
                    let ex = await woItems.messagesArchive.select({ channelId })
                    archIds = new Set(ex.map((m) => m.id))
                    moved = hot
                    chkWrite(await woItems.messagesArchive.save(hot), 'messagesArchive.save')
                    chkWrite(await woItems.messages.del(hot.map((m) => ({ id: m.id }))), 'messages.del')
                    stat.messages += hot.length
                })
            },
            undo: async () => {
                if (moved.length === 0) {
                    return
                }
                await kmx(key, async () => {
                    chkWrite(await woItems.messages.insert(moved), 'messages.insert')
                    let ids = moved.filter((m) => !archIds.has(m.id)).map((m) => ({ id: m.id }))
                    if (ids.length > 0) {
                        chkWrite(await woItems.messagesArchive.del(ids), 'messagesArchive.del')
                    }
                })
            },
        }
    }
    //buildChannelDeleteOps: 刪除一個頻道之全部寫入單元 (清單存檔之刪除集合與清單刪除、單筆刪除共用). 回 { ops, last, stat }:
    //ops 為搬移與成員列刪除, 順序 任務 (逐筆) → 訊息 (整批) → 成員列; last 為頻道列刪除, 由呼叫端排在**全部頻道之 ops 之後** (頻道列最後刪):
    //中途中斷 (如行程崩潰, 補償來不及) 時, 本次請求涉及之頻道皆仍在, 原請求重送即可補完 (搬移冪等), 不會留下「頻道已刪而訊息 / 任務仍在熱表」之孤兒, 多頻道亦同.
    //stat 於執行後為實際搬移筆數. 頻道之訊息與任務移入封存表 (使用者 2026-10-23 裁示 Q2: 不直接刪除、不留孤兒); 來源頻道已刪除由封存列之 channelId 不在 channels 表得知 (ID 為 UUID 不重用), 不增 schema 欄
    let buildChannelDeleteOps = async (ch) => {
        let stat = { tasks: 0, messages: 0 }
        let ops = []
        let ts = await woItems.tasks.select({ channelId: ch.id })
        for (let t of ts) {
            ops.push(opMoveTask(t.id, stat))
        }
        ops.push(opMoveMessages(ch.id, stat))
        let ms = await woItems.channelMembers.select({ channelId: ch.id })
        for (let m of ms) {
            ops.push(opDeleteMember(m))
        }
        return { ops, last: opDelete('channels', ch), stat }
    }
    //logArchived: 刪頻道成功後記每個頻道實際移入封存表之任務 / 訊息筆數 (審計用; 只記頻道 id 與筆數)
    let logArchived = (stats) => {
        for (let { channelId, stat } of stats) {
            srLog.info({ event: 'channelArchived', channelId, tasksMoved: stat.tasks, messagesMoved: stat.messages })
        }
    }


    //runOps: 依序執行寫入單元; 任一失敗則反向補償 (含失敗中之那一步). 全部補償成功回 'saveRolledBack', 補償亦失敗回 'saveWriteFail' (部分資料可能已寫入); 皆記 log
    let runOps = async (event, ops) => {
        let done = []
        let cur = null
        try {
            for (let op of ops) {
                cur = op
                await op.redo()
                done.push(op)
            }
        }
        catch (err) {
            let msg = (err && err.message) || String(err)
            let ok = true
            let undos = [cur, ...done.slice().reverse()]
            for (let op of undos) {
                try {
                    await op.undo()
                }
                catch (err2) {
                    ok = false
                    srLog.error({ event: `${event}-rollback-fail`, err: 'saveWriteFail', msg: (err2 && err2.message) || String(err2) })
                }
            }
            let key = ok ? 'saveRolledBack' : 'saveWriteFail'
            srLog.error({ event, err: key, msg })
            return Promise.reject(key)
        }
    }


    //guarded: guardWrite 之拒收鍵轉本套件語系鍵. 一律以 getRejectKey 取鍵 (procOrm / read 之字串 reject 與 guardWrite 之 Error 皆可): baselineMismatch → saveStale,
    //rowNotFound → errRowNotFound, baselineFormat → errBaselineFormat (皆為畫面資料過期, 提示重新載入); rowsInvalid 為伺服端資料錯誤 (庫內主鍵重複或缺漏), 記 log. 其餘原樣轉出
    let guarded = async (event, p) => {
        try {
            return await guardWrite(p)
        }
        catch (err) {
            let key = getRejectKey(err)
            if (key === 'baselineMismatch') {
                return Promise.reject('saveStale')
            }
            if (key === 'rowNotFound') {
                return Promise.reject('errRowNotFound')
            }
            if (key === 'baselineFormat') {
                return Promise.reject('errBaselineFormat')
            }
            if (key === 'rowsInvalid') {
                srLog.error({ event, err: 'errRowsInvalid' })
                return Promise.reject('errRowsInvalid')
            }
            return Promise.reject(err)
        }
    }


    //okShapeSave / okShapeDel: 單筆 API 成功時維持原 ORM 結果之形狀 (外部呼叫端相容; 保留 API 之回傳契約不變): 新增 { n, nInserted, ok } (聚合物件), 修改 [{ n, nInserted, nModified, ok }], 刪除 [{ n, nDeleted, ok }]
    //(核心已逐筆檢查 ok 與命中, 成功即此形狀)
    let okShapeSave = (r) => {
        if (r.inserted.length > 0) {
            return { n: 1, nInserted: 1, ok: 1 }
        }
        return [{ n: 1, nInserted: 0, nModified: 1, ok: 1 }]
    }
    let okShapeDel = () => {
        return [{ n: 1, nDeleted: 1, ok: 1 }]
    }


    //pickBaseline: opt 只取 baseline 一鍵 (其餘鍵一律忽略, 客戶端不得藉 opt 影響寫入); 未給 → undefined (不帶基準之外部呼叫); 給了即交 guardWrite 檢查格式 (不識即拒收, 不降級為未帶)
    let pickBaseline = (opt) => {
        if (opt === undefined || opt === null) {
            return undefined
        }
        if (!isobj(opt)) {
            return null //非物件之 opt: 視為格式不識, 交 guardWrite 以 baselineFormat 拒收 (null 非 undefined)
        }
        return opt.baseline
    }


    //pickSelected: 刪除入口之被選列 (庫內新鮮讀取中 id 屬 ids 者). 庫內讀出之列主鍵重複 (伺服端資料錯誤) → rowsInvalid (errRowsInvalid 並記 log, 與存檔入口一致; 不誤報為 rowNotFound);
    //被選列未全數存在 → rowNotFound
    let pickSelected = (all, ids) => {
        let kp = new Set(ids)
        let sub = filter(all, (r) => kp.has(r.id))
        if (new Set(sub.map((r) => r.id)).size !== sub.length) {
            return Promise.reject('rowsInvalid')
        }
        if (sub.length !== ids.length) {
            return Promise.reject('rowNotFound')
        }
        return sub
    }


    //hasOwn
    let hasOwn = (o, k) => {
        return Object.prototype.hasOwnProperty.call(o, k)
    }


    //chkFieldTypes: 客戶端欄位 (契約 fields) 若有帶, 須為字串. 本檔寫入不經 procOrm (不轉型、不消毒), 非字串值 (物件 / 陣列 / 數字 / null) 一律拒收:
    //lmdb 之 save 為深度合併, 物件 / 陣列欄位無法以合併寫入精確還原 (補償會殘留新增之鍵), 且各欄位於 schema 皆為 STRING
    let chkFieldTypes = (row, contract) => {
        for (let k of contract.fields) {
            if (hasOwn(row, k) && row[k] !== undefined && typeof row[k] !== 'string') {
                return false
            }
        }
        return true
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


    //saveChannelsCore: 頻道清單存檔之共用核心 (清單 API 與單筆 API 皆經此). baseline 為 undefined 表不帶基準 (外部呼叫).
    //表鎖內: 新鮮讀取 → (有基準時)比對 → 驗證全部 → 依序寫 (新增 → 修改 → 補主責 agent 成員列 → 刪除含連帶清理成員列); 驗證在任何寫入之前, 任一不符即零寫入.
    //帶基準: 送出列 id ∈ 基準者以摘要比對, 相同不寫 (不蓋稽核欄), 不同才修改; 無 id 者新增; 刪除集合＝基準內 − 送出 (不得為「庫內全部 − 送出」, 會刪掉他人載入後新增者).
    //不帶基準: 有 id 者只改不增 (列不存在 → rowNotFound, 整次零寫入), 無 id 者新增, 無刪除集合; 修改只寫列上有帶之 fields (容許部分欄位).
    //存檔只採用契約 fields (客戶端欄位); userId / timeCreate / isActive / order 等伺服器專有欄位不採用客戶端值 (修 O6); 名稱必填且不重複於寫入後之結果驗證 (修 O5, 原則 4).
    let saveChannelsCore = async (userId, rows, baseline) => {

        let hasBase = baseline !== undefined

        return await guarded('saveChannels', {
            tables: TABS_CH,
            read: () => woItems.channels.select({}),
            baseline,
            contract: channelsContract,
            write: async (cur) => {

                //kpCur, kpBase
                let kpCur = new Map(cur.map((r) => [r.id, r]))
                let kpBase = hasBase ? new Map(baseline) : null

                //分類送出列
                let ins = []
                let mods = []
                let unchanged = 0
                let kpSeen = new Set()
                for (let row of rows) {
                    if (!iseobj(row) || !chkFieldTypes(row, channelsContract)) {
                        return Promise.reject('errChannelRowInvalid')
                    }
                    let hasId = hasOwn(row, 'id') && row.id !== undefined && row.id !== null && row.id !== ''
                    if (!hasId) {
                        ins.push(row)
                        continue
                    }
                    if (!isestr(row.id) || kpSeen.has(row.id)) {
                        return Promise.reject('errChannelRowInvalid')
                    }
                    kpSeen.add(row.id)
                    if (hasBase) {
                        if (!kpBase.has(row.id)) {
                            return Promise.reject('errBaselineFormat') //送出列宣稱之 id 不在基準內
                        }
                        let dg = ''
                        try {
                            dg = digestRow(row, channelsContract)
                        }
                        catch (err) {
                            return Promise.reject('errChannelRowInvalid')
                        }
                        if (dg === kpBase.get(row.id)) {
                            unchanged++
                            continue
                        }
                        mods.push({ row, pre: kpCur.get(row.id) })
                    }
                    else {
                        let pre = kpCur.get(row.id)
                        if (!pre) {
                            return Promise.reject('rowNotFound') //只改不增: 列已不存在 (含從未存在) 不復活
                        }
                        mods.push({ row, pre })
                    }
                }

                //dels: 刪除集合＝基準內 − 送出 (比對已通過, 保證仍存在)
                let dels = []
                if (hasBase) {
                    for (let id of kpBase.keys()) {
                        if (!kpSeen.has(id)) {
                            dels.push(kpCur.get(id))
                        }
                    }
                }

                //寫入用之列: 只含契約 pk 與 fields (客戶端欄位)
                let tsNow = nowms2str()
                let insRows = []
                for (let row of ins) {
                    let w = pickWriteRow(row, channelsContract)
                    delete w.id
                    insRows.push(ds.channels.funNew({ ...w, userId }))
                }
                let modRows = []
                for (let { row, pre } of mods) {
                    let w = pickWriteRow(row, channelsContract)
                    delete w.id
                    w.timeUpdate = tsNow
                    w.userIdUpdate = userId
                    modRows.push({ id: pre.id, w, pre })
                }

                //寫入後之結果驗證: 頻道名稱必填且不重複 (原則 4: 所有入口一致; 前端 errItemsByName 僅為提示)
                let kpDel = new Set(dels.map((r) => r.id))
                let kpMod = new Map(modRows.map((m) => [m.id, m]))
                let kpName = new Set()
                let finals = []
                for (let r of cur) {
                    if (kpDel.has(r.id)) {
                        continue
                    }
                    let m = kpMod.get(r.id)
                    finals.push({ id: r.id, name: (m && hasOwn(m.w, 'name')) ? m.w.name : r.name, agentId: (m && hasOwn(m.w, 'agentId')) ? m.w.agentId : r.agentId })
                }
                for (let o of insRows) {
                    finals.push({ id: o.id, name: o.name, agentId: o.agentId })
                }
                for (let f of finals) {
                    if (!isestr(f.name)) {
                        return Promise.reject('errChannelNameInvalid')
                    }
                    if (kpName.has(f.name)) {
                        return Promise.reject('errChannelNameDuplicate')
                    }
                    kpName.add(f.name)
                }

                //確保主責 agent 有對應 channelMembers 列 (memberType='agent'): 新增 / 修改之頻道, agentId 非空且該 (channelId, memberId) 無有效列才補建 (表鎖內, 不與 ack 缺列路徑重複建列)
                let ops = []
                for (let o of insRows) {
                    ops.push(opInsert('channels', o))
                }
                for (let m of modRows) {
                    ops.push(opModify('channels', m.id, m.w, m.pre))
                }
                let kpAgentChk = new Set()
                for (let f of finals) {
                    let isChg = insRows.some((o) => o.id === f.id) || kpMod.has(f.id)
                    if (!isChg || !isestr(f.agentId)) {
                        continue
                    }
                    let kk = `${f.id}\u0000${f.agentId}`
                    if (kpAgentChk.has(kk)) {
                        continue
                    }
                    kpAgentChk.add(kk)
                    let ms = await woItems.channelMembers.select({ channelId: f.id, memberId: f.agentId, isActive: 'y' })
                    if (!iseobj(get(ms, '0'))) {
                        ops.push(opInsert('channelMembers', ds.channelMembers.funNew({ channelId: f.id, memberId: f.agentId, memberType: 'agent', userId })))
                    }
                }

                //刪除頻道: 成員列連帶刪除、訊息與任務移入封存表 (原則 6: 被刪除時所有引用連帶清理; 使用者 2026-10-23 裁示 Q2: 移入封存表而非直接刪除), 與上列寫入同一次補償範圍
                let stats = []
                let lasts = []
                for (let ch of dels) {
                    let b = await buildChannelDeleteOps(ch)
                    ops.push(...b.ops)
                    lasts.push(b.last)
                    stats.push({ channelId: ch.id, stat: b.stat })
                }
                ops.push(...lasts) //頻道列最後刪 (全部頻道之搬移與成員列刪除之後)

                await runOps('saveChannels', ops)
                logArchived(stats)

                let rowsNew = await woItems.channels.select({})
                return {
                    inserted: insRows.map((o) => o.id),
                    modified: modRows.map((m) => m.id),
                    deleted: dels.map((r) => r.id),
                    unchanged,
                    rows: rowsNew,
                }
            },
        })
    }


    //deleteChannelsCore: 頻道刪除之共用核心. baseline 只含被選取列 (逐列粒度: 刪除是針對特定列之命令, 他列被改不應擋; 先刪先贏).
    //表鎖內: 被選列須全部仍存在 (任一不存在 → rowNotFound, 含不帶基準者) → (有基準時)比對 → 該頻道之任務與訊息移入封存表 → 成員列連帶刪除 → 刪頻道 (同一次補償範圍; 見 buildChannelDeleteOps).
    let deleteChannelsCore = async (userId, ids, baseline) => {

        return await guarded('deleteChannels', {
            tables: TABS_CH,
            read: async () => {
                let all = await woItems.channels.select({})
                return pickSelected(all, ids)
            },
            baseline,
            contract: channelsContract,
            write: async (sub) => {
                let ops = []
                let lasts = []
                let stats = []
                for (let ch of sub) {
                    let b = await buildChannelDeleteOps(ch)
                    ops.push(...b.ops)
                    lasts.push(b.last)
                    stats.push({ channelId: ch.id, stat: b.stat })
                }
                ops.push(...lasts) //頻道列最後刪 (全部頻道之搬移與成員列刪除之後)
                await runOps('deleteChannels', ops)
                logArchived(stats)
                return { deleted: sub.map((r) => r.id) }
            },
        })
    }


    //checkIds: 刪除用 id 清單 — 非空陣列、元素皆非空字串且不重複 (重複者整次拒收, 不靜默去重)
    let checkIds = (ids) => {
        if (!isarr(ids) || ids.length === 0) {
            return false
        }
        let kp = new Set()
        for (let id of ids) {
            if (!isestr(id) || kp.has(id)) {
                return false
            }
            kp.add(id)
        }
        return true
    }


    //saveChannels: 頻道清單存檔 (後台整表編輯頁一次提交整份清單; 取代前端逐列迴圈). opt.baseline 為載入時之基準 (w-serv-orm buildBaseline).
    //回 { inserted, modified, deleted, unchanged, rows }: rows 為寫入後表鎖內之新鮮讀取, 供前端取新基準 (不得以送出值當新基準, 寫入時 clearXSS 等可能改寫字串).
    let saveChannels = async (userId, rows, opt) => {

        //check
        if (!isarr(rows)) {
            return Promise.reject('errChannelRowInvalid')
        }
        let baseline = pickBaseline(opt)

        //雙擊防護(後端): 同一操作者之清單存檔處理中再送出即 reject 'saveInProgress' (見 lockSave, D16)
        return await lockSave('saveChannels', `${userId}`, async () => {
            return await saveChannelsCore(userId, rows, baseline)
        })
    }


    //deleteChannels: 頻道清單刪除 (ids 為被選取列之 id; opt.baseline 只含被選取列).
    let deleteChannels = async (userId, ids, opt) => {

        //check
        if (!checkIds(ids)) {
            return Promise.reject('errChannelIdInvalid')
        }
        let baseline = pickBaseline(opt)

        //雙擊防護(後端): 同一操作者之清單刪除處理中再送出即 reject 'deleteInProgress' (見 lockSave, D16)
        return await lockSave('deleteChannels', `${userId}`, async () => {
            return await deleteChannelsCore(userId, ids, baseline)
        }, { errKey: 'deleteInProgress' })
    }


    //saveChannel: 新增 / 變更單一頻道 (單筆 API, 前端不再呼叫; 外部呼叫屬不帶基準之寫入). 與清單 API 共用核心: 修改只改不增 (列已刪 → rowNotFound), 不採用伺服器專有欄位.
    let saveChannel = async (userId, row) => {

        //check
        if (!iseobj(row)) {
            return Promise.reject('errChannelRowInvalid')
        }

        //rowKey: 本次寫入之列識別 — 既有列以 id, 新列(未帶 id, 由後端 funNew 產生 id)以 name
        let rowKey = isestr(row.id) ? row.id : get(row, 'name', '')

        //雙擊防護(後端): 同一操作者對同一列之儲存處理中再送出即 reject 'saveInProgress'; 只擋同一列之連發，同批其他列不受影響 (見 lockSave, D16)
        return await lockSave('saveChannel', `${userId}:${rowKey}`, async () => {
            let r = await saveChannelsCore(userId, [row], undefined)
            return okShapeSave(r)
        })
    }


    //deleteChannel: 刪除單一頻道 (單筆 API; 成員列連帶刪除, 訊息與任務移入封存表, 見 buildChannelDeleteOps). 列不存在 → rowNotFound (修 O2).
    let deleteChannel = async (userId, id) => {

        //check
        if (!isestr(id)) {
            return Promise.reject('errChannelIdInvalid')
        }

        //雙擊防護(後端): 同一操作者對同一列之刪除處理中再送出即 reject 'deleteInProgress' (見 lockSave, D16)
        return await lockSave('deleteChannel', `${userId}:${id}`, async () => {
            await deleteChannelsCore(userId, [id], undefined)
            return okShapeDel()
        }, { errKey: 'deleteInProgress' })
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


    //saveMembersCore: 成員清單存檔之共用核心 (範圍＝該頻道有效成員; 契約由工廠 getMembersContract(channelId) 取得). 規則同 saveChannelsCore, 另:
    //每列 channelId 須等於參數 (否則 errMemberChannelMismatch); 新列 channelId 取參數; 頻道須存在 (否則 errChannelNotFound, 不對已刪頻道新增成員);
    //(channelId, memberId) 唯一以「寫入後之結果」驗證 (允許系統管理者於同一次存檔刪掉既有重複者; 否則 errMemberDuplicate; 修 O4/Q5);
    //修改只寫 memberId / memberType / role 與稽核欄 (合併寫入, 不整列覆寫): lastSeenMessageId 為 ackChannel 專有 (修 E3), ack 於存檔期間推進之游標不被回寫.
    let saveMembersCore = async (userId, channelId, rows, baseline) => {

        let hasBase = baseline !== undefined
        let contract = getMembersContract(channelId)

        return await guarded('saveChannelMembers', {
            tables: TABS_CH,
            read: async () => {
                let chs = await woItems.channels.select({ id: channelId })
                if (!iseobj(get(chs, '0'))) {
                    return Promise.reject('errChannelNotFound')
                }
                return await woItems.channelMembers.select({ channelId, isActive: 'y' })
            },
            baseline,
            contract,
            write: async (cur) => {

                //kpCur, kpBase
                let kpCur = new Map(cur.map((r) => [r.id, r]))
                let kpBase = hasBase ? new Map(baseline) : null

                //分類送出列
                let ins = []
                let mods = []
                let unchanged = 0
                let kpSeen = new Set()
                for (let row of rows) {
                    if (!iseobj(row) || !chkFieldTypes(row, contract)) {
                        return Promise.reject('errMemberRowInvalid')
                    }
                    if (hasOwn(row, 'channelId') && row.channelId !== undefined && row.channelId !== null && row.channelId !== '' && row.channelId !== channelId) {
                        return Promise.reject('errMemberChannelMismatch')
                    }
                    let hasId = hasOwn(row, 'id') && row.id !== undefined && row.id !== null && row.id !== ''
                    if (!hasId) {
                        ins.push(row)
                        continue
                    }
                    if (!isestr(row.id) || kpSeen.has(row.id)) {
                        return Promise.reject('errMemberRowInvalid')
                    }
                    kpSeen.add(row.id)
                    if (hasBase) {
                        if (!kpBase.has(row.id)) {
                            return Promise.reject('errBaselineFormat')
                        }
                        let dg = ''
                        try {
                            dg = digestRow(row, contract)
                        }
                        catch (err) {
                            return Promise.reject('errMemberRowInvalid')
                        }
                        if (dg === kpBase.get(row.id)) {
                            unchanged++
                            continue
                        }
                        mods.push({ row, pre: kpCur.get(row.id) })
                    }
                    else {
                        let pre = kpCur.get(row.id)
                        if (!pre) {
                            return Promise.reject('rowNotFound')
                        }
                        mods.push({ row, pre })
                    }
                }

                //dels: 刪除集合＝基準內 − 送出
                let dels = []
                if (hasBase) {
                    for (let id of kpBase.keys()) {
                        if (!kpSeen.has(id)) {
                            dels.push(kpCur.get(id))
                        }
                    }
                }

                //寫入用之列: 只含契約 pk 與 fields; 修改不寫 channelId (成員不得搬頻道)
                let tsNow = nowms2str()
                let insRows = []
                for (let row of ins) {
                    let w = pickWriteRow(row, contract)
                    delete w.id
                    insRows.push(ds.channelMembers.funNew({ ...w, channelId, userId }))
                }
                let modRows = []
                for (let { row, pre } of mods) {
                    let w = pickWriteRow(row, contract)
                    delete w.id
                    delete w.channelId
                    w.timeUpdate = tsNow
                    w.userIdUpdate = userId
                    modRows.push({ id: pre.id, w, pre })
                }

                //寫入後之結果驗證: (channelId, memberId) 唯一
                let kpDel = new Set(dels.map((r) => r.id))
                let kpMod = new Map(modRows.map((m) => [m.id, m]))
                let kpMember = new Set()
                let memberIds = []
                for (let r of cur) {
                    if (kpDel.has(r.id)) {
                        continue
                    }
                    let m = kpMod.get(r.id)
                    memberIds.push((m && hasOwn(m.w, 'memberId')) ? m.w.memberId : r.memberId)
                }
                for (let o of insRows) {
                    memberIds.push(o.memberId)
                }
                for (let mid of memberIds) {
                    if (kpMember.has(mid)) {
                        return Promise.reject('errMemberDuplicate')
                    }
                    kpMember.add(mid)
                }

                let ops = []
                for (let o of insRows) {
                    ops.push(opInsert('channelMembers', o))
                }
                for (let m of modRows) {
                    let isRename = hasOwn(m.w, 'memberId') && m.w.memberId !== m.pre.memberId
                    ops.push(opModify('channelMembers', m.id, m.w, m.pre, isRename ? `channelMember:${m.pre.channelId}:${m.pre.memberId}` : ''))
                }
                for (let m of dels) {
                    ops.push(opDeleteMember(m))
                }

                await runOps('saveChannelMembers', ops)

                let rowsNew = await woItems.channelMembers.select({ channelId, isActive: 'y' })
                return {
                    inserted: insRows.map((o) => o.id),
                    modified: modRows.map((m) => m.id),
                    deleted: dels.map((r) => r.id),
                    unchanged,
                    rows: rowsNew,
                }
            },
        })
    }


    //deleteMembersCore: 成員刪除之共用核心 (範圍＝該頻道有效成員; 被選列須全部仍在該頻道內, 否則 rowNotFound; baseline 只含被選取列).
    let deleteMembersCore = async (userId, channelId, ids, baseline) => {

        return await guarded('deleteChannelMembers', {
            tables: TABS_CH,
            read: async () => {
                let all = await woItems.channelMembers.select({ channelId, isActive: 'y' })
                return pickSelected(all, ids)
            },
            baseline,
            contract: getMembersContract(channelId),
            write: async (sub) => {
                let ops = []
                for (let m of sub) {
                    ops.push(opDeleteMember(m))
                }
                await runOps('deleteChannelMembers', ops)
                return { deleted: sub.map((r) => r.id) }
            },
        })
    }


    //saveChannelMembers: 成員清單存檔 (後台成員頁一次提交該頻道整份清單; 取代前端逐列迴圈). opt.baseline 為載入時之基準 (契約工廠 getMembersContract(channelId)).
    //回 { inserted, modified, deleted, unchanged, rows }: rows 為寫入後表鎖內之新鮮讀取 (該頻道有效成員), 供前端取新基準.
    let saveChannelMembers = async (userId, channelId, rows, opt) => {

        //check
        if (!isestr(channelId)) {
            return Promise.reject('errChannelIdInvalid')
        }
        if (!isarr(rows)) {
            return Promise.reject('errMemberRowInvalid')
        }
        let baseline = pickBaseline(opt)

        //雙擊防護(後端): 同一操作者對同一頻道之成員清單存檔處理中再送出即 reject 'saveInProgress' (見 lockSave, D16)
        return await lockSave('saveChannelMembers', `${userId}:${channelId}`, async () => {
            return await saveMembersCore(userId, channelId, rows, baseline)
        })
    }


    //deleteChannelMembers: 成員清單刪除 (ids 為被選取列之 id; opt.baseline 只含被選取列).
    let deleteChannelMembers = async (userId, channelId, ids, opt) => {

        //check
        if (!isestr(channelId)) {
            return Promise.reject('errChannelIdInvalid')
        }
        if (!checkIds(ids)) {
            return Promise.reject('errMemberIdInvalid')
        }
        let baseline = pickBaseline(opt)

        //雙擊防護(後端): 同一操作者對同一頻道之成員清單刪除處理中再送出即 reject 'deleteInProgress' (見 lockSave, D16)
        return await lockSave('deleteChannelMembers', `${userId}:${channelId}`, async () => {
            return await deleteMembersCore(userId, channelId, ids, baseline)
        }, { errKey: 'deleteInProgress' })
    }


    //saveChannelMember: 新增 / 變更單一成員 (單筆 API, 前端不再呼叫; 外部呼叫屬不帶基準之寫入). 與清單 API 共用核心: 修改只改不增 (列已刪 → rowNotFound), 不採用伺服器專有欄位.
    let saveChannelMember = async (userId, row) => {

        //check
        if (!iseobj(row)) {
            return Promise.reject('errMemberRowInvalid')
        }

        //rowKey: 本次寫入之列識別 — 既有列以 id, 新列(未帶 id, 由後端 funNew 產生 id)以「頻道:成員」
        let rowKey = isestr(row.id) ? row.id : `${get(row, 'channelId', '')}:${get(row, 'memberId', '')}`

        //雙擊防護(後端): 同一操作者對同一列之儲存處理中再送出即 reject 'saveInProgress'; 只擋同一列之連發，同批其他列不受影響 (見 lockSave, D16)
        return await lockSave('saveChannelMember', `${userId}:${rowKey}`, async () => {

            //channelId: 既有列取庫內之值 (列不存在 → rowNotFound, 不復活); 新列取列上之 channelId
            let channelId = ''
            if (isestr(row.id)) {
                let ms = await woItems.channelMembers.select({ id: row.id })
                if (!iseobj(get(ms, '0'))) {
                    return Promise.reject('errRowNotFound')
                }
                channelId = ms[0].channelId
            }
            else {
                channelId = row.channelId
            }
            if (!isestr(channelId)) {
                return Promise.reject('errChannelIdInvalid')
            }

            let r = await saveMembersCore(userId, channelId, [row], undefined)
            return okShapeSave(r)
        })
    }


    //deleteChannelMember: 刪除單一成員 (單筆 API). 列不存在 → rowNotFound (修 O2).
    let deleteChannelMember = async (userId, id) => {

        //check
        if (!isestr(id)) {
            return Promise.reject('errMemberIdInvalid')
        }

        //雙擊防護(後端): 同一操作者對同一列之刪除處理中再送出即 reject 'deleteInProgress' (見 lockSave, D16)
        return await lockSave('deleteChannelMember', `${userId}:${id}`, async () => {

            let ms = await woItems.channelMembers.select({ id })
            if (!iseobj(get(ms, '0'))) {
                return Promise.reject('errRowNotFound')
            }

            await deleteMembersCore(userId, ms[0].channelId, [id], undefined)
            return okShapeDel()
        }, { errKey: 'deleteInProgress' })
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

        //頻道須存在 (原則 6: 引用不得指向已刪除之頻道; 對已刪頻道發訊會留下懸空引用, 修 O7)
        let chs = await woItems.channels.select({ id: channelId })
        if (!iseobj(get(chs, '0'))) {
            return Promise.reject('errChannelNotFound')
        }

        //雙擊防護(後端): 同一操作者對同一頻道之送出處理中再送出即 reject 'sendInProgress'(不排隊); 依序再送為使用者之新訊息, 不擋 (見 lockSave, D16).
        //lockSave 包在 kmx 之外層: kmx 仍序列化不同操作者對同頻道之發訊
        return await lockSave('postMessage', `${userId}:${channelId}`, async () => {

            //channels 表鎖 (鎖序: lockSave → 表鎖 → 實體鎖): 頻道存在之檢查與訊息 / 任務之新增在同一互斥範圍, 發訊通過檢查後不會被刪頻道插入 (刪頻道持 channels 表鎖)
            return await withTabLocks(['channels'], async () => {

                let chs2 = await woItems.channels.select({ id: channelId })
                if (!iseobj(get(chs2, '0'))) {
                    return Promise.reject('errChannelNotFound')
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
                        }, { autoInsert: false })
                        message.taskId = task.id

                        return { message, task }
                    }

                    return { message }
                })

            })

        }, { errKey: 'sendInProgress' })
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

            //save: pending→running (只改不增: 鎖內已確認存在, 不因競態復活已刪之列)
            await woItems.tasks.save({
                id: taskId,
                state: 'running',
                assigneeId: userId,
                timeClaim: nowms2str(),
                timeUpdate: nowms2str(),
                userIdUpdate: userId,
            }, { autoInsert: false })

            //回更新後 task
            let rs2 = await woItems.tasks.select({ id: taskId })
            return get(rs2, '0')
        })
    }


    //respondTask: 回應任務 (唯一終態入口; running→done/error; 寫 result + 發 taskReply). kmx 鎖內守衛 state==='running'.
    //多段寫入 (taskReply 訊息 → 任務終態) 之冪等與補償 (修 O8): 寫前查「本輪認領後建立、尚未被任務引用」之既有 taskReply (前次第二段失敗之殘留), 有則沿用並更新內容, 重試不產生重複 taskReply;
    //第二段失敗則補償 (新建者刪除、沿用者還原內容), 補償亦失敗回 saveWriteFail 並記 log. 狀態機轉移規則 (state 守衛) 不變.
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

            //既有 taskReply: 同任務、建立時間不早於本輪認領者 (較早者為前一輪 reset 前之歷史回覆, 不可沿用); 取最後一則
            let reps = await woItems.messages.select({ taskId, kind: 'taskReply' })
            let repsCur = filter(reps, (m) => isestr(t.timeClaim) && isestr(m.timeCreate) && m.timeCreate >= t.timeClaim)
            let prev = get(repsCur, repsCur.length - 1)

            let ops = []
            let msgId = ''
            if (iseobj(prev)) {
                //沿用: 更新內容為本次 result
                msgId = prev.id
                ops.push(opModify('messages', prev.id, {
                    senderId: userId,
                    senderType,
                    content: result,
                    timeUpdate: nowms2str(),
                    userIdUpdate: userId,
                }, prev))
            }
            else {
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
                msgId = message.id
                ops.push(opInsert('messages', message))
            }

            //save task: 終態
            ops.push(opModify('tasks', taskId, {
                result,
                state,
                errorKey: errorKey || '',
                resultMessageId: msgId,
                timeDone: nowms2str(),
                timeUpdate: nowms2str(),
                userIdUpdate: userId,
            }, t))

            await runOps('respondTask', ops)

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

            //save: 清空殘留欄位給空字串 '' (lodash merge 不清 undefined), 設 pending (只改不增: 鎖內已確認存在)
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
            }, { autoInsert: false })

            //回更新後 task
            let rs2 = await woItems.tasks.select({ id: taskId })
            return get(rs2, '0')
        })
    }


    //ackChannel: 推進呼叫者 (agent) 在該頻道之已讀游標. 缺列者 upsert. 兩段式鎖 (修 O3):
    //第一段更新路徑 (熱路徑, agent 輪詢頻繁): 只取實體鎖 channelMember:<c>:<u>, 以 autoInsert:false 只改不增 (列已被後台刪除 → 未命中, 不復活殘缺列), 只寫 lastSeenMessageId 與稽核欄 (與清單存檔寫入之欄位不重疊, lmdb 單列合併寫入原子);
    //第二段缺列路徑: 先釋放實體鎖再取表鎖 (避免實體鎖 → 表鎖倒置), 鎖內檢查頻道仍存在、重查 (他人剛建者改更新游標, 不新增重複列), 仍缺才 insert.
    //allowInsert: 缺列時是否可建列 (預設 true = 修前行為, 供 unit 與系統管理者); 入口邊界 (access.mjs) 對一般使用者傳 false:
    //一般使用者之成員資格已於授權檢查通過 (列存在), 若其後該列被系統管理者移除, 第一段查無列, 此時**不得**重新建列 (否則被移除者藉競態自我加回, 外審 opus#1), 回 errChannelNotMember.
    let ackChannel = async (userId, channelId, lastMessageId, allowInsert = true) => {

        //check
        if (!isestr(channelId)) {
            return Promise.reject('errChannelIdInvalid')
        }
        if (!isestr(lastMessageId)) {
            return Promise.reject('errLastMessageIdInvalid')
        }

        //第一段: 查 member 列後 save 以 kmx 包成原子 (同一呼叫者並行 ack 同頻道不互相覆寫)
        let hit = await kmx(`channelMember:${channelId}:${userId}`, async () => {

            //查 member 列 (只認有效列: 與 getChannelsList 讀游標之條件一致, 既有資料若有停用之舊列, 不把游標寫到讀取端看不到之列)
            let ms = await woItems.channelMembers.select({ channelId, memberId: userId, isActive: 'y' })
            let m = get(ms, '0')
            if (!iseobj(m)) {
                return false
            }

            //有則 save 推進游標 (只改不增)
            let r = await woItems.channelMembers.save({
                id: m.id,
                lastSeenMessageId: lastMessageId,
                timeUpdate: nowms2str(),
                userIdUpdate: userId,
            }, { autoInsert: false })
            chkWrite(r, 'channelMembers.save')
            return toArr(r)[0].n >= 1
        })
        if (hit) {
            return { ok: true }
        }
        if (!allowInsert) {
            return Promise.reject('errChannelNotMember')
        }

        //第二段: 缺列路徑
        return await withTabLocks(TABS_CH, async () => {

            //頻道須存在 (不對已刪頻道建成員列, 原則 6)
            let chs = await woItems.channels.select({ id: channelId })
            if (!iseobj(get(chs, '0'))) {
                return Promise.reject('errChannelNotFound')
            }

            //鎖內重查 (同第一段, 只認有效列)
            let ms = await woItems.channelMembers.select({ channelId, memberId: userId, isActive: 'y' })
            let m = get(ms, '0')

            if (iseobj(m)) {
                //他人剛建: 更新游標
                chkWrite(await woItems.channelMembers.save({
                    id: m.id,
                    lastSeenMessageId: lastMessageId,
                    timeUpdate: nowms2str(),
                    userIdUpdate: userId,
                }, { autoInsert: false }), 'channelMembers.save', true)
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
                chkWrite(await woItems.channelMembers.insert(o), 'channelMembers.insert')
            }

            return { ok: true }
        })
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
    //scope: 頻道 id 集合 (Set); 給定時只計這些頻道 (一般使用者只計所屬頻道, 由入口邊界 access.mjs 決定), 未給 (null) 為全系統.
    let getStats = async (userId, scope = null) => {

        let channels = await woItems.channels.select({ isActive: 'y' })
        let messages = await woItems.messages.select({ isActive: 'y' })
        let tasksAll = await woItems.tasks.select({ isActive: 'y' })
        if (scope !== null) {
            channels = filter(channels, (r) => scope.has(r.id))
            messages = filter(messages, (r) => scope.has(r.channelId))
            tasksAll = filter(tasksAll, (r) => scope.has(r.channelId))
        }

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
    //逐筆任務取 task:<id> 鎖後重讀再搬 (修 E2): 掃描期間若該任務已被 resetTask 重置 (回 pending) 或已不在, 鎖內重讀不符條件即略過, 不搬、不刪, 不使成功重置之任務消失;
    //訊息守衛之熱表任務集合取自「實際搬走」之任務 (略過者仍視為熱表任務, 其訊息不搬).
    //archiveAfterDays<=0 視為停用. 回 { tasksMoved, messagesMoved }.
    let archiveSweep = async (archiveAfterDays) => {

        //nd
        let nd = cint(archiveAfterDays)
        if (nd <= 0) {
            return { tasksMoved: 0, messagesMoved: 0 }
        }

        //cutoff (timemsTZ 字串, 與資料同格式可字典序比較)
        let cutoff = ot().subtract(nd, 'day').format('YYYY-MM-DDTHH:mm:ss.SSSZ')

        //isArchivable: 終態且 timeDone 早於 cutoff
        let isArchivable = (t) => {
            let b1 = t.state === 'done' || t.state === 'error'
            let b2 = isestr(t.timeDone) && t.timeDone < cutoff
            return b1 && b2
        }

        //tasks: 終態且 timeDone 早於 cutoff → 搬冷表 (候選; 逐筆鎖內重讀確認)
        let ts = await woItems.tasks.select({ isActive: 'y' })
        let tsOld = filter(ts, isArchivable)
        let kpMoved = {}
        for (let t0 of tsOld) {
            let moved = await kmx('task:' + t0.id, async () => {
                let rs = await woItems.tasks.select({ id: t0.id })
                let t = get(rs, '0')
                if (!iseobj(t) || !isArchivable(t)) {
                    return false //已被重置 / 刪除 / 非終態: 略過
                }
                chkWrite(await woItems.tasksArchive.save(t), 'tasksArchive.save') //upsert, 重跑冪等
                try {
                    chkWrite(await woItems.tasks.del({ id: t.id }), 'tasks.del')
                }
                catch (err) {
                    //熱表刪除失敗: 撤回冷表複本 (否則熱表仍在、冷表又有舊終態複本, 系統管理者其後重置熱表任務即留下矛盾資料, 重跑掃描亦不會自行修正)
                    try {
                        chkWrite(await woItems.tasksArchive.del({ id: t.id }), 'tasksArchive.del')
                    }
                    catch (err2) {
                        srLog.error({ event: 'archiveSweep-undo-fail', err: 'saveWriteFail', msg: (err2 && err2.message) || String(err2) })
                    }
                    throw err
                }
                return true
            })
            if (moved) {
                kpMoved[t0.id] = true
            }
        }
        let tasksMoved = Object.keys(kpMoved).length

        //熱表殘留任務 id 集合 (封存後重算: 初始熱表 − 實際搬走), 供訊息守衛
        let kpHotTask = {}
        for (let t of ts) {
            if (kpMoved[t.id] !== true) {
                kpHotTask[t.id] = true
            }
        }

        //messages: timeCreate 早於 cutoff → 搬冷表; 任務相關訊息其任務仍在熱表者保留
        let ms = await woItems.messages.select({ isActive: 'y' })
        let msOld = filter(ms, (m) => {
            let b1 = isestr(m.timeCreate) && m.timeCreate < cutoff
            let bTaskKind = (m.kind === 'task' || m.kind === 'taskReply') && isestr(m.taskId)
            let bGuard = bTaskKind && kpHotTask[m.taskId] === true //其任務仍在熱表 → 不搬
            return b1 && !bGuard
        })
        //依頻道分組, 逐組於 msgarch:<channelId> 鎖內「先 upsert 冷表、再逐筆刪熱表」: 與刪頻道之訊息搬移 / 補償 (opMoveMessages) 互斥,
        //避免掃描於「冷表已寫、熱表尚未刪」之間與補償 (補回熱表、刪冷表複本) 交錯而使該則訊息兩表皆無. 掃描只取此鎖 (不取表鎖), 與刪頻道之鎖序 (表鎖 → msgarch 鎖) 無倒置.
        //冷表複本逐筆檢查 (ORM 對單筆失敗回 ok:0 而不 reject): 任一筆未成功即拋出, 不刪熱表 (否則失敗那筆冷熱皆無); 重跑冪等
        let kpCh = new Map()
        for (let m of msOld) {
            let arr = kpCh.get(m.channelId)
            if (!arr) {
                arr = []
                kpCh.set(m.channelId, arr)
            }
            arr.push(m)
        }
        for (let [cid, arr] of kpCh) {
            await kmx('msgarch:' + cid, async () => {
                chkWrite(await woItems.messagesArchive.save(arr), 'messagesArchive.save')
                for (let m of arr) {
                    chkWrite(await woItems.messages.del({ id: m.id }), 'messages.del')
                }
            })
        }

        return { tasksMoved, messagesMoved: msOld.length }
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
        saveChannels,
        deleteChannels,
        saveChannel,
        deleteChannel,
        getChannelMembers,
        saveChannelMembers,
        deleteChannelMembers,
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
