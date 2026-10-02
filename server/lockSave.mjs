import get from 'lodash-es/get.js'
import isestr from 'wsemi/src/isestr.mjs'


/**
 * 有副作用之寫入路徑(如清單儲存 updateUsersList / updateTokensList / updateIpsList)之雙擊防護(後端, D16)
 *
 * 以「操作:操作者 id」於 wsemi cacheSt 原子占位執行 fn, 同一操作者之同一操作處理中再送出即 reject 錯誤 key
 * (預設 'saveInProgress', 可以 opt.errKey 指定; 皆為 i18n key, 見 procLang); 不同操作者、不同操作互不影響;
 * fn 之 reject 原樣 bubble; fn 結束(含失敗)即釋放.
 * 第 2 次不排隊執行: 其內容與第 1 次相同, 排隊後再寫一次會把第 1 次剛建立之列當修改覆寫
 * (依序重送另由各專案之資料層檢查擋, 如 SSO procCore.updateTabItems 之新增列檢查回 'saveNewRowExists').
 * operatorId 可為操作者 id 或「操作者 id + 列識別」(只擋同一列之連發, 同批其他列不受影響).
 *
 * @param {Object} cst 輸入 wsemi cacheSt 實例
 * @returns {Function} 回傳 async (op, operatorId, fn, opt = {}) => fn 之結果, opt.errKey 為占位衝突時 reject 之 key
 */
function createLockSave(cst) {

    let lockSave = async (op, operatorId, fn, opt = {}) => {

        //errKey
        let errKey = get(opt, 'errKey', '')
        if (!isestr(errKey)) {
            errKey = 'saveInProgress'
        }

        let key = `${op}:${operatorId}`
        return await cst.setWithFree([key], fn)
            .catch((err) => {
                //remap setWithFree 之占位衝突 → i18n key; fn 內之 reject 原樣 bubble
                if (err === `setWithFree: key in use: ${key}`) {
                    return Promise.reject(errKey)
                }
                return Promise.reject(err)
            })
    }

    return lockSave
}


export default createLockSave
