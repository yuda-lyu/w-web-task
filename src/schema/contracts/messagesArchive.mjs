//寫入契約: messagesArchive (冷表; messages 之複本, 僅 archiveSweep 搬入). 不適用基準, 說明同 messages.mjs.
export default {
    table: 'messagesArchive',
    pk: 'id',
    fields: [],
    serverOnly: ['channelId', 'senderId', 'senderType', 'kind', 'content', 'taskId', 'attachments', 'userId', 'timeCreate', 'userIdUpdate', 'timeUpdate', 'isActive'],
}
