import messages from './messages.mjs'


//messagesArchive: messages 之封存冷表 (schema/funNew 與 messages 完全一致, 僅表名不同).
//封存機制見 spec/設計要點與取捨.md D12: 過齡舊訊息由 archiveSweep 搬入, 熱表僅留活躍資料.
let tab = {
    ...messages,
    keyTable: 'messagesArchive',
    tableNameCht: '訊息(封存)',
    tableNameEng: 'MessagesArchive',
}


export default tab
