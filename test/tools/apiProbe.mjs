//api 測試共用之探測工具(非測試檔): 資料通道 /api/main 之 w-converhp 封包、HTTP GET、本次後端 srLog 之快照與逐筆讀取
//單一定義處: api-tokenLeak / api-dataChannel / api-doubleclick 皆由此引用, 不在測試檔內另寫近似實作(CLAUDE_rulebook.md「輔助工具」)
//封包格式(w-converhp 2.1.9 / w-serv-webdata 1.1.12 實跑仍成立, 2026-10-14):
//  request  body = obj2u8arr({ func, input: { __sysInputArgs__: [args...], __sysToken__: token } }), Authorization: Bearer <token>(verifyConn 驗此權杖; __sysToken__ 由 getUserIdByToken 驗)
//  response u8arr2obj → { success: { func, output: { state, msg } } }(函數已執行或被 execFun 拒絕) 或 { error: <msg> }(verifyConn 未通過等, 如 'permission denied')
import fs from 'fs'
import path from 'path'
import obj2u8arr from 'wsemi/src/obj2u8arr.mjs'
import u8arr2obj from 'wsemi/src/u8arr2obj.mjs'
import { apiBaseUrl, backendLogDir } from './e2e-setup.mjs'


//httpGet: 自建 Hapi 路由(apis)之 GET, 回 { status, text, body(JSON 解析失敗為 null) }
async function httpGet(pathQs) {
    let res = await fetch(`${apiBaseUrl}${pathQs}`)
    let text = await res.text()
    let body = null
    try {
        body = JSON.parse(text)
    }
    catch (err) {}
    return { status: res.status, text, body }
}


//postMain: 直打資料通道 /api/main; authToken 走 verifyConn, sysToken 走 getUserIdByToken; 回 { status, text, obj }
async function postMain(authToken, sysToken, func = 'getWebInfor', args = []) {
    let payload = { func, input: { __sysInputArgs__: args, __sysToken__: sysToken } }
    let res = await fetch(`${apiBaseUrl}/api/main`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/octet-stream' },
        body: Buffer.from(obj2u8arr(payload)),
    })
    let u8a = new Uint8Array(await res.arrayBuffer())
    let text = Buffer.from(u8a).toString('utf8')
    let obj = u8arr2obj(u8a)
    return { status: res.status, text, obj }
}


//callRpc: 直打前端資料通道之 kpFunExt(POST /api/main); Authorization 與 __sysToken__ 皆為同一權杖(本專案 verifyConn 驗前者、getUserIdByToken 驗後者)
//回傳 { state, msg }(與 HTTP REST 同形); kpFunExt 之 reject key 即 msg; verifyConn 未通過等無 execute 輸出者 → { state:'error', msg:<error> }
//(api-doubleclick / api-concurrency 共用; 原定義於 api-doubleclick, 2026-10-23 收斂至此)
async function callRpc(func, args, token) {
    const r = await postMain(token, token, func, args)
    const o = r.obj
    if (o && typeof o === 'object' && 'error' in o) {
        return { state: 'error', msg: String(o.error) }
    }
    const out = o && o.success && o.success.output
    if (out && typeof out === 'object') {
        return { state: out.state, msg: out.msg }
    }
    return { state: 'error', msg: `unparseable response: ${r.text}` }
}


//outputOf: postMain 結果之 execute 輸出({ state, msg }); verifyConn 未通過等無 execute 輸出者回 null
function outputOf(r) {
    let out = r && r.obj && r.obj.success && r.obj.success.output
    return (out && typeof out === 'object') ? out : null
}


//srLog 讀取: 以「各 log 檔當下位元組數」為快照, 只讀快照之後新增之內容(本案之記錄); 目錄為本次後端之 logFd(harness 匯出, 與開發用 ./logs 分離)
function snapshotLogs(logDir = backendLogDir) {
    let snap = {}
    if (fs.existsSync(logDir)) {
        for (let fn of fs.readdirSync(logDir)) {
            if (fn.endsWith('.log')) {
                snap[fn] = fs.statSync(path.join(logDir, fn)).size
            }
        }
    }
    return snap
}


function readNewText(snap, logDir = backendLogDir) {
    let out = ''
    if (!fs.existsSync(logDir)) {
        return out
    }
    for (let fn of fs.readdirSync(logDir).sort()) { //檔名為 YYYY-MM-DDTHH.log, 字典序即時間序(跨小時亦正確)
        if (!fn.endsWith('.log')) {
            continue
        }
        let buf = fs.readFileSync(path.join(logDir, fn))
        let from = snap[fn] || 0
        if (buf.length > from) {
            out += buf.subarray(from).toString('utf8')
        }
    }
    return out
}


function parseRecords(text) {
    return text.split(/\r?\n/).filter((l) => l.trim() !== '').map((l) => {
        try {
            return JSON.parse(l)
        }
        catch (err) {
            return { _raw: l }
        }
    })
}


//proj: 記錄之比對投影(level + event + 語意欄位; 略去 time / pid / hostname 等環境欄位)
function proj(r) {
    let o = { level: r.level, event: r.event }
    for (let k of ['err', 'upstream', 'upstreamType', 'upstreamName', 'tableName', 'methodName', '_raw']) {
        if (k in r) {
            o[k] = r[k]
        }
    }
    return o
}


//waitRecords: pino 經 worker thread 非同步落檔, 輪詢至新增記錄數達 n(或逾時)後再多等一小段收齊尾端記錄
async function waitRecords(snap, n, timeoutMs = 8000, logDir = backendLogDir) {
    let t0 = Date.now()
    while (Date.now() - t0 < timeoutMs) {
        if (parseRecords(readNewText(snap, logDir)).length >= n) {
            break
        }
        await new Promise((resolve) => setTimeout(resolve, 200))
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
    let text = readNewText(snap, logDir)
    return { text, recs: parseRecords(text) }
}


export {
    httpGet,
    postMain,
    callRpc,
    outputOf,
    snapshotLogs,
    readNewText,
    parseRecords,
    proj,
    waitRecords
}
