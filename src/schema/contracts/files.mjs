//寫入契約: files (多人同時編輯, 原則 10). 僅 saveFile 新增 (無修改、無刪除路徑) → 不適用基準: fields 為空、10 欄全為伺服器專有, 說明同 messages.mjs.
export default {
    table: 'files',
    pk: 'id',
    fields: [],
    serverOnly: ['name', 'type', 'size', 'ext', 'userId', 'timeCreate', 'userIdUpdate', 'timeUpdate', 'isActive'],
}
