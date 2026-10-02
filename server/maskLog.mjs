import isestr from 'wsemi/src/isestr.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'


//maskLog: 寫 console / srLog 前之權杖遮罩 (M 契約; 與 w-web-sso server/srLog.mjs 之 maskToken、w-web-perm / w-web-api 之 maskLog 同一組測資,
//見 test/unit-maskLog.test.mjs 與 spec/設計要點與取捨.md D15). 印權杖一律經本檔, 不另寫第二份遮罩.


//safeChars: 露出之字元中, 控制字元 \u0000-\u001f 與 \u007f 一律換成 '?' (防 log 注入: 權杖夾換行即可偽造 log 行)
let safeChars = (s) => {
    return s.split('').map((c) => {
        let code = c.charCodeAt(0)
        return (code <= 0x1f || code === 0x7f) ? '?' : c
    }).join('')
}


/**
 * 遮罩權杖 (M 契約)
 *
 * - undefined / null / '' → ''
 * - 陣列 → 逐元素遮罩 (Hapi 對重複之 query 參數給陣列)
 * - 字串 (長度 n≥1): k=min(4, floor(n/8)); k=0 → '(len=n)'; 否則 → '前k...後k(len=n)', 露出字元中之控制字元換成 '?'
 * - 其他型別 → '(typeof)', 例如 '(object)'、'(number)', 絕不輸出原值
 *
 * @param {*} t 輸入權杖 (任意型別)
 * @returns {String|Array} 回傳遮罩後字串, 輸入為陣列時回傳逐元素遮罩之陣列
 * @example
 * maskTok('0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b') // => '0199...4a5b(len=36)'
 * maskTok('abcdefg') // => '(len=7)'
 * maskTok(['abcdefghijklmnop', 'x']) // => ['ab...op(len=16)', '(len=1)']
 */
let maskTok = (t) => {
    if (t === undefined || t === null || t === '') {
        return ''
    }
    if (isarr(t)) {
        return t.map(maskTok)
    }
    if (typeof t !== 'string') {
        return `(${typeof t})`
    }
    let n = t.length
    let k = Math.min(4, Math.floor(n / 8))
    if (k === 0) {
        return `(len=${n})`
    }
    return `${safeChars(t.slice(0, k))}...${safeChars(t.slice(n - k))}(len=${n})`
}


/**
 * 遮罩查詢參數物件: 淺拷貝, 鍵名小寫為 'token' 者以 maskTok 處理, 其餘鍵原樣; 不修改原物件
 *
 * 非物件輸入依 M 契約遮罩 (不原樣輸出).
 *
 * @param {Object} q 輸入查詢參數物件, 例如 Hapi 之 req.query (null-prototype 物件亦可)
 * @returns {Object|String|Array} 回傳遮罩後之新物件
 */
let maskQuery = (q) => {
    if (!isobj(q)) {
        return maskTok(q)
    }
    let r = { ...q }
    for (let k of Object.keys(r)) {
        if (k.toLowerCase() === 'token') {
            r[k] = maskTok(r[k])
        }
    }
    return r
}


/**
 * 遮罩網址: http(s) 只留 origin + pathname (捨棄 query、fragment、userinfo); 語意同 M 契約之來源實作 w-web-sso src/maskUrl.mjs
 *
 * - 陣列 → 逐元素 maskUrl
 * - undefined / null / '' → ''; 其他非字串 → '(typeof)'
 * - 無法解析 → '(invalid-url)'
 * - 非 http(s) 之網址 (如 data: / javascript:, 其 pathname 即內容) → 只回 protocol
 *
 * @param {String} u 輸入網址 (例如 Referer 或已代入權杖之 helper 網址)
 * @returns {String|Array} 回傳遮罩後網址
 */
let maskUrl = (u) => {
    if (isarr(u)) {
        return u.map(maskUrl)
    }
    if (u === undefined || u === null || u === '') {
        return ''
    }
    if (!isestr(u)) {
        return `(${typeof u})`
    }
    let o = null
    try {
        o = new URL(u)
    }
    catch (err) {
        return '(invalid-url)'
    }
    if (o.protocol !== 'http:' && o.protocol !== 'https:') {
        return o.protocol
    }
    return o.origin + o.pathname
}


export { maskTok, maskQuery, maskUrl }
