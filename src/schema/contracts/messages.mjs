//寫入契約: messages (多人同時編輯, 原則 10). 無後台整表編輯頁 (純新增 + 系統搬移) → 不適用基準: fields 為空、13 欄全為伺服器專有.
//本物件不交給 w-serv-orm 之 checkContract (其要求 fields 非空); 只供「欄位全集 = fields ∪ serverOnly ∪ pk」之一致檢查 (test/unit-contracts) 與日後擴充.
//誰能寫哪些欄位、經哪把鎖: 見 sgud/rule/rulebook_concurrency.md 之寫入站點全集 (postMessage / respondTask 新增、archiveSweep 搬移).
export default {
    table: 'messages',
    pk: 'id',
    fields: [],
    serverOnly: ['channelId', 'senderId', 'senderType', 'kind', 'content', 'taskId', 'attachments', 'userId', 'timeCreate', 'userIdUpdate', 'timeUpdate', 'isActive'],
}
