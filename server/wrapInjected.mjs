import isestr from 'wsemi/src/isestr.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isErr from 'wsemi/src/isErr.mjs'


//wrapInjected: 部署方注入函數 (getUserByToken / verifyClientUser / verifyAppUser) 之包裝 (W 契約, 見 spec/設計要點與取捨.md D15).
//why: 部署方常把 w-web-sso 之 helper 直接注入, 其失敗值 (舊版為「已代入介接權杖與使用者權杖之完整網址」) 若原樣上拋,
//會經 HTTP 回應、srLog、console 與 error 事件外流. 包裝後上游失敗一律視同否定結果 (查無 / 無權限), 走各呼叫點既有分支回自家 key,
//失敗原文不上拋、不入 log.


//keysUpstream: 上游 (w-web-sso 對外 helper) 之 reject key 白名單 = sso K 契約之 14 個 key.
//【同步點】sso 之 helper 增刪 reject key 時須同步此處 (盤點指令見 D15).
let keysUpstream = [
    'invalidUrl',
    'invalidTokenSelf',
    'invalidTokenTar',
    'invalidUserIdTar',
    'noTokenKeyValueInUrl',
    'noTokenKeyUserIdInUrl',
    'noTokenInUrl',
    'cannotGetUserByUrl',
    'cannotGetUsersByUrl',
    'cannotGetUserDataByUrl',
    'cannotGetUsersDataByUrl',
    'noUserDataByUrl',
    'noUsersDataByUrl',
    'noUserDataAfterConvert',
]


//rName: Error.name 只收名稱形狀 (同 sso K 契約 console 之 errName 判準); Error.name 可被任意改寫, 不符形狀者不記
let rName = /^[A-Za-z]{1,40}$/


/**
 * 描述上游失敗 (供 log), 絕不含失敗原文
 *
 * - reject 值 (或 Error.message) 屬 sso K 契約之 14 個 key → { upstream: key }
 * - 否則 → { upstreamType, upstreamName }: upstreamType 為 'string'、'error'、'null'、'array' 或 typeof 值; upstreamName 為名稱形狀之 Error.name, 其餘為 ''
 *
 * @param {*} err 輸入上游之 reject 值或拋出值
 * @returns {Object} 回傳描述物件
 */
let describeUpstream = (err) => {
    try {
        let v = isErr(err) ? err.message : err
        if (isestr(v) && keysUpstream.includes(v)) {
            return { upstream: v }
        }
        let upstreamType = ''
        let upstreamName = ''
        if (err === null) {
            upstreamType = 'null'
        }
        else if (isarr(err)) {
            upstreamType = 'array'
        }
        else if (isErr(err)) {
            upstreamType = 'error'
            let name = err.name
            if (typeof name === 'string' && rName.test(name)) {
                upstreamName = name
            }
        }
        else {
            upstreamType = typeof err
        }
        return { upstreamType, upstreamName }
    }
    catch (e) {
        //取 message / name 時拋錯 (getter), 仍不可讓 log 路徑中斷
        return { upstreamType: 'unknown', upstreamName: '' }
    }
}


/**
 * 包裝注入函數: 同步拋錯或 reject 時回 failValue (視同否定結果), 並以 describeUpstream 之結果呼叫 onFail (不含原文)
 *
 * @param {Function} fn 輸入注入函數, 可為 sync 或 async
 * @param {Object} [opt={}] 輸入設定物件
 * @param {*} [opt.failValue=null] 輸入失敗時之回傳值, getUserByToken 用 null (查無), verifyClientUser / verifyAppUser 用 false (無權限)
 * @param {Function} [opt.onFail=null] 輸入失敗時之回呼, 傳入 describeUpstream(err) 之結果; 回呼本身拋錯不影響回傳 failValue
 * @returns {Function} 回傳包裝後之 async 函數, 成功時原樣回傳 fn 之結果
 */
let wrapInjected = (fn, opt = {}) => {
    if (!isfun(fn)) {
        throw new Error('invalid fn')
    }
    let failValue = (opt && ('failValue' in opt)) ? opt.failValue : null
    let onFail = opt ? opt.onFail : null
    return async (...args) => {
        try {
            return await fn(...args)
        }
        catch (err) {
            if (isfun(onFail)) {
                try {
                    onFail(describeUpstream(err))
                }
                catch (e) {}
            }
            return failValue
        }
    }
}


export { wrapInjected, describeUpstream }
