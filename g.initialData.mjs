import fs from 'fs'
import map from 'lodash-es/map.js'
import { pathToFileURL } from 'url'
import ds from './src/schema/index.mjs'
import { woItems } from './g.mOrm.mjs'


//dbf: v2 圖台檔案實體目錄 (與 procCore 一致); 重建 DB 時一併清理避免孤兒
let dbfDir = './dbf'


//基本測試數據 (頻道 / 成員 / 訊息 / 任務) 原始定義 — 為 g.initialData 重建 DB 與 e2e setup 的單一真理來源.
//e2e 各測試 setup 階段透過 buildBaseChannels() / buildBaseMembers() / buildBaseMessages() / buildBaseTasks()
//重建這批基本數據, 確保每個 e2e 都從相同已知 DB 狀態起跑, 不受其他 e2e 非預期殘留影響.
//
//【e2e baseline 確定性關鍵】UI 會顯示 timeCreate / timeDone / timeClaim 等時間戳; funNew 預設以 nowms2str()
//填當下時間, 每次 seed 不同 → pixel baseline 永遠 mismatch. 故 demo 種子之時間欄位一律以下方固定字串覆蓋
//(在 funNew 之後強制覆寫, 比照既有 id 覆寫方式), 使每次 seed 顯示之時間戳完全相同 → baseline 穩定.
//訊息 / 任務之 id 仍保留 funNew 產生之 UUIDv7 (UI 不顯示 id, 但其字典序=時序, 決定時間軸排序與任務清單排序);
//以插入順序遞增確保 demo 資料之相對時序固定.
let TS = '2026-01-01T00:00:00.000+08:00'  //demo 種子固定基準時間戳 (各列以遞增小時錯開, 仍為固定值)
function tsAt(hh) {
    //回傳固定時間戳字串 (僅小時遞增, 其餘固定) — 供 demo 各列錯開顯示時間但跨次 seed 完全一致
    let h = String(hh).padStart(2, '0')
    return `2026-01-01T${h}:00:00.000+08:00`
}


let baseChannelsRaw = [
    {
        id: 'id-for-channel-demo',
        order: 0,
        name: '訂單服務',
        description: 'A demonstration channel for task dispatch.',
        agentId: 'agent-demo',
        levels: '電商平台改版.後端組',
        ownerId: 'id-for-admin',
        userId: 'id-for-admin',
    },
    {
        id: 'id-for-channel-pay',
        order: 1,
        name: '金流串接',
        description: 'Payment gateway integration channel.',
        agentId: 'agent-demo',
        levels: '電商平台改版.後端組',
        ownerId: 'id-for-admin',
        userId: 'id-for-admin',
    },
    {
        id: 'id-for-channel-etl',
        order: 2,
        name: 'ETL 管線',
        description: 'Data pipeline (ETL) channel.',
        agentId: 'agent-etl',
        levels: '數據平台',
        ownerId: 'id-for-admin',
        userId: 'id-for-admin',
    },
    {
        id: 'id-for-channel-report',
        order: 3,
        name: '報表產製',
        description: 'Report generation channel.',
        agentId: 'agent-etl',
        levels: '數據平台',
        ownerId: 'id-for-admin',
        userId: 'id-for-admin',
    },
]


//基本測試數據 (成員) 原始定義
let baseMembersRaw = [
    {
        id: 'id-for-member-demo-agent',
        order: 0,
        channelId: 'id-for-channel-demo',
        memberId: 'agent-demo',
        memberType: 'agent',
        role: 'member',
        lastSeenMessageId: '',
        userId: 'id-for-admin',
    },
]


//基本測試數據 (訊息) 原始定義 — 依時間軸顯示順序排列 (插入序=id 時序=顯示序).
//注意: 訊息 id 不釘死字面值, 一律由 funNew 產生 UUIDv7 (時序遞增).
//原因: 訊息查詢與 afterId 游標依賴 id 字典序=時序; 若釘死如 'id-for-message-demo-1' (字首 'i' > UUIDv7 字首 '0')
//會永遠排在所有執行期訊息之後, 破壞時間軸排序與游標比較.
//demo 訊息覆蓋四種呈現: 人類一般對話(text) / agent 一般對話(text) / 開任務(task) / 任務回應(taskReply).
let baseMessagesRaw = [
    {
        channelId: 'id-for-channel-demo',
        senderId: 'id-for-admin',
        senderType: 'human',
        kind: 'text',
        content: 'Welcome to the demo channel.',
        taskId: '',
        userId: 'id-for-admin',
        timeFixed: tsAt(1),
    },
    {
        channelId: 'id-for-channel-demo',
        senderId: 'agent-demo',
        senderType: 'agent',
        kind: 'text',
        content: 'Agent online and ready to take tasks.',
        taskId: '',
        userId: 'id-for-admin',
        timeFixed: tsAt(2),
    },
    {
        channelId: 'id-for-channel-demo',
        senderId: 'id-for-admin',
        senderType: 'human',
        kind: 'task',
        content: 'Please summarize the quarterly report.',
        taskId: 'id-for-task-demo-done',
        userId: 'id-for-admin',
        timeFixed: tsAt(3),
    },
    {
        channelId: 'id-for-channel-demo',
        senderId: 'agent-demo',
        senderType: 'agent',
        kind: 'taskReply',
        content: 'Summary completed: revenue grew 12% QoQ.',
        taskId: 'id-for-task-demo-done',
        userId: 'id-for-admin',
        timeFixed: tsAt(4),
    },
]


//基本測試數據 (任務) 原始定義 — 涵蓋三種終態/中間態以呈現狀態色: done(綠) / pending(灰) / error(紅).
//任務 id 釘死字面值, 因任務清單以 id desc 排序顯示, 且詳情面板以 id 選取; 釘死可確保排序固定 + 測試可定位.
//清單顯示順序 (id desc): error > pending > done (字面比較 'id-for-task-demo-error' > '...-pending' > '...-done').
let baseTasksRaw = [
    {
        id: 'id-for-task-demo-done',
        channelId: 'id-for-channel-demo',
        messageId: '',  //起源訊息 id 在 buildBaseMessages 後無法預知 (UUIDv7); demo 不需嚴格回指, 留空
        title: 'Summarize quarterly report',
        payload: 'Please summarize the quarterly report.',
        state: 'done',
        assigneeId: 'agent-demo',
        result: 'Summary completed: revenue grew 12% QoQ.',
        errorKey: '',
        resultMessageId: '',
        timeClaimFixed: tsAt(3),
        timeDoneFixed: tsAt(4),
        timeFixed: tsAt(3),
        userId: 'id-for-admin',
    },
    {
        id: 'id-for-task-demo-pending',
        channelId: 'id-for-channel-demo',
        messageId: '',
        title: 'Draft the release notes',
        payload: 'Draft the release notes for version 2.0.',
        state: 'pending',
        assigneeId: '',
        result: '',
        errorKey: '',
        resultMessageId: '',
        timeClaimFixed: '',
        timeDoneFixed: '',
        timeFixed: tsAt(5),
        userId: 'id-for-admin',
    },
    {
        id: 'id-for-task-demo-error',
        channelId: 'id-for-channel-demo',
        messageId: '',
        title: 'Fetch external metrics',
        payload: 'Fetch metrics from the external analytics API.',
        state: 'error',
        assigneeId: 'agent-demo',
        result: 'The external API returned HTTP 503.',
        errorKey: 'errTaskExternalServiceUnavailable',
        resultMessageId: '',
        timeClaimFixed: tsAt(6),
        timeDoneFixed: tsAt(7),
        timeFixed: tsAt(6),
        userId: 'id-for-admin',
    },
]


//建立基本頻道 records (funNew 補齊欄位, 並重存會被重產的 id)
//時間欄位以固定值覆寫: 頻道清單 grid 顯示 timeUpdate, 若為 funNew 之 nowms2str() 每次 seed 不同 → E2E-001 baseline 永遠 mismatch.
function buildBaseChannels() {
    return map(baseChannelsRaw, (c) => {
        let v = ds.channels.funNew({
            ...c,
        })
        v.id = c.id //id會重產故須重存
        v.timeCreate = TS //固定基準時間戳, 確保頻道清單顯示之 timeUpdate 跨次 seed 一致 → baseline 穩定
        v.timeUpdate = TS
        return v
    })
}


//建立基本成員 records
//時間欄位以固定值覆寫: 成員管理 grid (E2E-008) 顯示 timeUpdate, 若為 funNew 之 nowms2str() 每次 seed 不同 → baseline 永遠 mismatch (比照頻道/訊息/任務之固定時間戳處理)。
function buildBaseMembers() {
    return map(baseMembersRaw, (m) => {
        let v = ds.channelMembers.funNew({
            ...m,
        })
        v.id = m.id //id會重產故須重存
        v.timeCreate = TS //固定基準時間戳, 確保成員 grid 顯示之 timeUpdate 跨次 seed 一致 → baseline 穩定
        v.timeUpdate = TS
        return v
    })
}


//建立基本訊息 records — 訊息 id 保留 funNew 之 UUIDv7 (時序); 時間欄位以固定值覆寫 (baseline 確定性).
function buildBaseMessages() {
    return map(baseMessagesRaw, (m) => {
        let { timeFixed, ...rest } = m
        let v = ds.messages.funNew({
            ...rest,
        })
        //訊息 id 不重存, 保留 funNew 產生之 UUIDv7 (時序), 確保時間軸與 afterId 游標正確
        //時間欄位以固定值覆寫, 使 UI 顯示之時間戳跨次 seed 完全一致 → pixel baseline 穩定
        v.timeCreate = timeFixed
        v.timeUpdate = timeFixed
        return v
    })
}


//建立基本任務 records — id 釘死 (清單排序固定 + 測試可定位); 時間欄位以固定值覆寫 (baseline 確定性).
function buildBaseTasks() {
    return map(baseTasksRaw, (t) => {
        let { timeClaimFixed, timeDoneFixed, timeFixed, ...rest } = t
        let v = ds.tasks.funNew({
            ...rest,
        })
        v.id = t.id //id 釘死故須重存
        //時間欄位以固定值覆寫, 使 UI 顯示之時間戳跨次 seed 完全一致 → pixel baseline 穩定
        v.timeCreate = timeFixed
        v.timeUpdate = timeFixed
        v.timeClaim = timeClaimFixed
        v.timeDone = timeDoneFixed
        return v
    })
}


//重建整個資料庫為基本測試數據 (清空四張表後插入基本種子). 供 node g.initialData.mjs 用. 冪等.
async function initialData() {
    await woItems.channels.delAll()
    await woItems.channels.insert(buildBaseChannels())

    await woItems.channelMembers.delAll()
    await woItems.channelMembers.insert(buildBaseMembers())

    await woItems.messages.delAll()
    await woItems.messages.insert(buildBaseMessages())

    await woItems.tasks.delAll()
    await woItems.tasks.insert(buildBaseTasks())

    //v2 圖台: 清空 files metadata 表 + ./dbf 實體檔 (避免反覆 seed/測試後 files 表與 dbf 累積孤兒; 不 seed files)
    await woItems.files.delAll()
    try {
        if (fs.existsSync(dbfDir)) {
            fs.rmSync(dbfDir, { recursive: true, force: true })
        }
        fs.mkdirSync(dbfDir, { recursive: true })
    }
    catch (err) {
        console.log('clear dbf warn', err.message)
    }

    console.log('finish.')
}


export { baseChannelsRaw, baseMembersRaw, baseMessagesRaw, baseTasksRaw, buildBaseChannels, buildBaseMembers, buildBaseMessages, buildBaseTasks, initialData }


//main-guard: 僅在「直接以 node g.initialData.mjs 執行」時重建 DB; 被 import 時不執行 (避免副作用)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    initialData()
        .catch((err) => {
            console.log('initialData catch', err)
        })
}


//重建資料庫
//node g.initialData.mjs
