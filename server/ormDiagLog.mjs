import isfun from 'wsemi/src/isfun.mjs'


//ormDiagLog: w-serv-orm 診斷輸出(opt.funLog(label, safe, detail), w-serv-orm ≥ 1.1.20, R-DIAG-01)導入本套件 srLog (spec/設計要點與取捨.md D21).
//w-serv-orm 預設把診斷輸出寫 console (行程標準輸出常被 pm2 / 容器收集); 給 funLog 後 w-serv-orm 不再寫 console, 診斷輸出只交給它.
//本檔只把 label 與 safe 寫入 srLog.warn({ event:'orm-diag', label, safe }), 第 3 引數 detail (含主鍵、email、錯誤原文) 不取用、不寫入:
//  srLog 不記權杖與上游原文 (rulebook_security: srLog 不記上游原文); safe 已含表名與操作、失敗筆數與位置、錯誤類別與機器代碼 (w-serv-orm README〈Diagnostic output〉), 足供診斷;
//  詳細原文已隨 procOrm 之拒收值交給呼叫端 (procCore 之 runOps 記 err key), 本檔不另落地.
//日誌寫入失敗 (srLog.warn 拋錯) 一律吞下: 診斷輸出不得影響 procOrm 之 resolve / reject.


const EVENT = 'orm-diag'

//有界: 即使 w-serv-orm 日後於 safe 帶入較大結構, 日誌也不被撐大 (字串 200 字、陣列與物件至多 20 項、深度至多 3 層)
const MAX_STR = 200
const MAX_ITEMS = 20
const MAX_DEPTH = 3


let clipStr = (s) => {
    return s.length > MAX_STR ? `${s.slice(0, MAX_STR)}...(len=${s.length})` : s
}


//clip: 轉為可 JSON 序列化之有界純資料; 函數 / Symbol / bigint 等以型別標記取代, 超過深度以 '[...]' 取代, 超過項數以 '[n more]' 收尾
let clip = (v, depth = 0) => {
    if (v === null || v === undefined || typeof v === 'boolean') {
        return v
    }
    if (typeof v === 'string') {
        return clipStr(v)
    }
    if (typeof v === 'number') {
        return Number.isFinite(v) ? v : String(v)
    }
    if (typeof v !== 'object') {
        return `(${typeof v})`
    }
    if (depth >= MAX_DEPTH) {
        return '[...]'
    }
    if (Array.isArray(v)) {
        let r = v.slice(0, MAX_ITEMS).map((x) => clip(x, depth + 1))
        if (v.length > MAX_ITEMS) {
            r.push(`[${v.length - MAX_ITEMS} more]`)
        }
        return r
    }
    let ks = Object.keys(v)
    let r = {}
    let set = (k, x) => {
        Object.defineProperty(r, k, { value: x, enumerable: true, writable: true, configurable: true }) //不用 r[k]=: 鍵為 __proto__ 時會改到原型
    }
    for (let k of ks.slice(0, MAX_ITEMS)) {
        set(clipStr(k), clip(v[k], depth + 1))
    }
    if (ks.length > MAX_ITEMS) {
        set('[more]', ks.length - MAX_ITEMS)
    }
    return r
}


/**
 * 產生交 w-serv-orm 之 opt.funLog 的函數
 *
 * @param {Object} srLog 輸入後端 log 物件, 須具 warn 函數
 * @returns {Function} 回傳 (label, safe, detail) => undefined; detail 不取用
 */
function genOrmFunLog(srLog) {

    //check
    if (!isfun(srLog && srLog.warn)) {
        throw new Error('invalid srLog')
    }

    return (label, safe) => {
        try {
            let o = { event: EVENT, label: clipStr(String(label)) }
            if (safe !== undefined) {
                o.safe = clip(safe)
            }
            srLog.warn(o) //每次取用 srLog.warn (不於建構時固定), 與其他 srLog 呼叫點一致
        }
        catch (err) {
            //日誌寫入失敗不得影響原流程
        }
    }
}


export default genOrmFunLog
