import tasks from './tasks.mjs'


//tasksArchive: tasks 之封存冷表 (schema/funNew 與 tasks 完全一致, 僅表名不同).
//封存機制見 spec/設計要點與取捨.md D12: 終態且過齡之任務由 archiveSweep 搬入, 熱表僅留活躍資料.
let tab = {
    ...tasks,
    keyTable: 'tasksArchive',
    tableNameCht: '任務(封存)',
    tableNameEng: 'TasksArchive',
}


export default tab
