//寫入契約: channels (多人同時編輯, 原則 10; 規格見 C:\opensrcOper\dspec\多人同時編輯之寫入契約.md §3、§4)
//前後端 import 同一檔: 前端對畫面所見之列自算基準 (buildBaseline), 後端於表鎖內對新鮮讀取重算比對.
//fields 明列 (不以「排除系統欄位」推得): 後台整表編輯頁可編輯之 5 欄 (LayoutContentChannels.vue 之 kpCellEditable); 存檔採用客戶端值.
//serverOnly: 只由伺服器寫, 不入基準, 存檔不採用客戶端值. 無雙方欄位 (後台可改之 5 欄從無系統路徑改寫其值).
//無 orderKey: 存檔不依列序重編 order (order 為種子值, 現無編輯入口). 無 scope: 整表 (資料通道 select 全撈, 前端不過濾 isActive).
export default {
    table: 'channels',
    pk: 'id',
    fields: ['name', 'description', 'agentId', 'levels', 'ownerId'],
    serverOnly: ['order', 'userId', 'timeCreate', 'userIdUpdate', 'timeUpdate', 'isActive'],
}
