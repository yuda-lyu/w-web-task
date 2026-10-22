//寫入契約: tasks (多人同時編輯, 原則 10). 狀態機 (claimTask / respondTask / resetTask) + 系統搬移, 無整表存檔 → 不適用基準:
//fields 為空、17 欄全為伺服器專有; 競爭由 kmx('task:<id>') 鎖內 state 守衛處理 (D6), 說明同 messages.mjs.
export default {
    table: 'tasks',
    pk: 'id',
    fields: [],
    serverOnly: ['channelId', 'messageId', 'title', 'payload', 'state', 'assigneeId', 'result', 'errorKey', 'resultMessageId', 'timeClaim', 'timeDone', 'userId', 'timeCreate', 'userIdUpdate', 'timeUpdate', 'isActive'],
}
