import get from 'lodash-es/get.js'


//前端依 getUserByToken 結果(store 之 userSelf)之 isAdmin 決定是否顯示管理入口 (後台入口、成員視窗之編輯開關).
//便利性而非授權: 授權以後端為準 (server/access.mjs; 管理類函數限系統管理者, 一般使用者呼叫回 errUserNotAdmin), 前端隱藏不是授權.
//只在確知為非系統管理者 ('n') 時隱藏: 使用者資料尚未取得 (登入檢查完成前之空物件) 或欄位缺漏時不隱藏, 避免管理入口於首繪閃現後消失;
//與後端不同, 前端不以 'y' 嚴格比對, 因為判錯方向無安全後果 (後端仍拒絕) 而判錯隱藏會使系統管理者失去入口.
function canManage(userSelf) {
    return get(userSelf, 'isAdmin', '') !== 'n'
}


export { canManage }
