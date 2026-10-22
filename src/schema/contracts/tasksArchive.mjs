//寫入契約: tasksArchive (冷表; tasks 之複本, 僅 archiveSweep 搬入). 不適用基準, 說明同 tasks.mjs.
export default {
    table: 'tasksArchive',
    pk: 'id',
    fields: [],
    serverOnly: ['channelId', 'messageId', 'title', 'payload', 'state', 'assigneeId', 'result', 'errorKey', 'resultMessageId', 'timeClaim', 'timeDone', 'userId', 'timeCreate', 'userIdUpdate', 'timeUpdate', 'isActive'],
}
