//E2E-013 專用種子腳本: 於封存冷表 tasksArchive 寫入一筆固定種子封存任務（供「顯示封存」切換測試）。
//
//為何獨立 process spawn（比照 g.initialData.mjs 之寫法）: messages/tasks/archive 表未列入前端 ORM 直通,
//無法由前端 RPC 寫入; 且封存冷表無任何「產生封存」之 RPC（archiveSweep 為後端排程, e2e-settings 設 archiveAfterDays=0 停用）。
//故封存種子只能直寫 lmdb。為避免多 process 共用 lmdb（skill 警示之陳舊快照風險）, 由 e2e-setup 之
//reseedBackend({ withArchivedTask:true }) 在「backend 已殺、尚未重啟」之視窗內 spawn 本腳本, 寫完即被殺,
//全程僅單一 process 持有 lmdb（與 seedDb→g.initialData 同一安全模型）。
//時間欄位以固定值覆寫確保 pixel baseline 穩定（比照 g.initialData 之固定時間戳處理）。
import ds from '../src/schema/index.mjs'
import { woItems } from '../g.mOrm.mjs'


let TSA = '2026-01-01T00:00:00.000+08:00' //固定基準時間戳（跨次 seed 一致 → baseline 穩定）


async function seedArchivedTask() {
    let t = ds.tasksArchive.funNew({
        channelId: 'id-for-channel-demo',
        title: 'Archived quarterly summary',
        payload: 'Summarize the archived quarterly report.',
        state: 'done',
        assigneeId: 'agent-demo',
        result: 'Archived summary completed.',
        errorKey: '',
        resultMessageId: '',
        userId: 'id-for-admin',
    })
    t.id = 'id-for-task-arch-demo' //釘死 id 便於測試定位
    t.timeCreate = TSA
    t.timeUpdate = TSA
    t.timeClaim = TSA
    t.timeDone = TSA
    await woItems.tasksArchive.insert(t)
    console.log('finish.') //spawner 偵測此字串後 kill（避免 lmdb 卡 event loop）
}


seedArchivedTask().catch((err) => { console.log('seedArchivedTask catch', err) })
