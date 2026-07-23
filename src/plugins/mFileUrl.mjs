import get from 'lodash-es/get.js'


//組圖台檔案串流 URL (GET /api/getFile)。vo 為元件實例 (自 store 取 userToken, 以當前 origin/path 為 base)。
//ChatView 與 Composer 共用, token 與路徑組裝邏輯單點維護。
function buildFileUrl(vo, fileId) {
    let token = get(vo, '$store.state.userToken', '')
    let base = `${window.location.origin}${window.location.pathname}`
    return `${base}api/getFile?token=${encodeURIComponent(token)}&id=${encodeURIComponent(fileId)}`
}


export default buildFileUrl
