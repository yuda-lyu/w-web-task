//寫入契約: channelMembers (多人同時編輯, 原則 10; 規格見 C:\opensrcOper\dspec\多人同時編輯之寫入契約.md §3、§4)
//基準之範圍隨頻道而變 (成員頁一次只編輯一個頻道) → 以契約工廠 getMembersContract(channelId) 回傳帶 scope 之契約物件 (主控複審 Q4).
//fields: 後台整表編輯頁可編輯之 3 欄 (memberId / memberType / role) + 範圍鍵 channelId (入摘要以偵測搬移; 清單 API 另驗每列 channelId = 參數).
//serverOnly: lastSeenMessageId 為 agent 已讀游標, 唯一合法寫入者為 ackChannel (規格 §4 伺服器專有), 存檔不採用客戶端值 (修 E3).
//無雙方欄位、無 orderKey.
const fields = ['channelId', 'memberId', 'memberType', 'role']
const serverOnly = ['order', 'lastSeenMessageId', 'userId', 'timeCreate', 'userIdUpdate', 'timeUpdate', 'isActive']


function getMembersContract(channelId) {
    return {
        table: 'channelMembers',
        pk: 'id',
        fields: [...fields],
        serverOnly: [...serverOnly],
        scope: (r) => r.channelId === channelId,
    }
}


export { getMembersContract }
export default getMembersContract
