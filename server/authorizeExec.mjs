import get from 'lodash-es/get.js'
import isestr from 'wsemi/src/isestr.mjs'
import isearr from 'wsemi/src/isearr.mjs'
import isfun from 'wsemi/src/isfun.mjs'


/**
 * 資料通道表操作之授權函數(交 w-serv-hapi / w-serv-webdata 之 opt.authorizeExec; spec D17 決策 2)
 *
 * w-serv-webdata 1.1.7 起 useDbOrm=true 時必填, 前端呼叫表操作(如同步之 channels.select)時於 operOrm 之前呼叫,
 * 回傳嚴格等於 true 才放行, 其他值一律回應 'permission denied' 且不呼叫 operOrm.
 * 本套件之資料通道只開放 methodsExec 所列方法(['select'], 供前端同步); 寫入一律經 kpFunExt(D16 lockSave、確保成員列 kmx、D7 游標身分皆在其內).
 * 放行: userId 為非空字串, 且 methodName 屬 methodsExec; 回傳一律為布林.
 * 拒絕: 回 false 並記 srLog.error({ event: 'authorizeExec', err, tableName, methodName }), userId 缺為 'errUserIdMissing', 方法不在清單為 'errUserNoPermission'.
 * getUserIdByToken 已 fail-closed 且 w-serv-webdata 只綁定 methodsExec 之方法, 故兩個拒絕分支於正常呼叫不會發生, 屬縱深防護.
 *
 * @param {Object} opt 輸入設定物件
 * @param {Array} opt.methodsExec 輸入允許之表操作方法陣列(須與交 w-serv-hapi 之 methodsExec 為同一陣列), 須為非空陣列
 * @param {Object} opt.srLog 輸入後端 log 物件, 須具 error 函數
 * @returns {Function} 回傳 ({ userId, tableName, methodName }) => Boolean
 */
function createAuthorizeExec(opt = {}) {

    //methodsExec
    let methodsExec = get(opt, 'methodsExec')
    if (!isearr(methodsExec)) {
        throw new Error('invalid opt.methodsExec')
    }

    //srLog
    let srLog = get(opt, 'srLog')
    if (!isfun(get(srLog, 'error'))) {
        throw new Error('invalid opt.srLog')
    }

    let authorizeExec = ({ userId, tableName, methodName } = {}) => {

        //check userId
        if (!isestr(userId)) {
            srLog.error({ event: 'authorizeExec', err: 'errUserIdMissing', tableName, methodName })
            return false
        }

        //check methodName
        if (!methodsExec.includes(methodName)) {
            srLog.error({ event: 'authorizeExec', err: 'errUserNoPermission', tableName, methodName })
            return false
        }

        return true
    }

    return authorizeExec
}


export default createAuthorizeExec
