//e2e／api harness 之 OS 層 helper：純函式＋可注入依賴，import 無副作用
//（供 test/tools/harnessLifecycle.mjs、test/tools/e2e-setup.mjs 與 test/unit-harnessProc.test.mjs 共用）。
//所有權規則（詳 test/tools/e2e-setup.mjs 檔頭）：只殺自建且仍存活之 child；絕不以 port 監聽者、命令列或映像名比對殺任何行程。
//本檔之命令列查詢（describeProcs／findNodeProcsByCommandLine）只讀，僅供錯誤訊息指認行程。
//2026-09-28 起：parseListenerPids、listenerPids、isChildAlive、waitChildExit、pidExists、sleepSync、killOwnTree 七個原語改由 e2e 共用設施
//（當時為 w-web-sso 之 srcPack，2026-09-29 起為 w-package-tools-e2e 1.0.2；經 ./e2eLib.mjs 引用）提供——該版即逐行移植自本檔、依賴注入之選項鍵相同；
//本檔轉出以維持既有 import 與單元測試不變。
//netstat 解析規則：只取 TCP 監聽列（外部位址 0.0.0.0:0／[::]:0／*:* 或狀態 LISTENING，前者與顯示語言無關）且本地位址以 `:${port}` 結尾者；
//不可加 -p TCP（只列 IPv4，會漏掉以 :: 雙堆疊監聽之 [::]:port，srv.mjs 即如此）；查無回 []、工具不可用回 null（呼叫端不得把 null 當成無人）。
import { execSync, spawn } from 'child_process'
import net from 'net'
import fs from 'fs'
import path from 'path'
import { parseListenerPids, listenerPids, isChildAlive, waitChildExit, pidExists, sleepSync, killOwnTree } from './e2eLib.mjs'
export { parseListenerPids, listenerPids, isChildAlive, waitChildExit, pidExists, sleepSync, killOwnTree }


//同步指令一律帶逾時與隱藏視窗：在 exit／signal 處理器內卡住會使行程無法結束
const EXEC_OPT = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000, windowsHide: true }


//TCP 連線探測 port 是否有人監聽（同 Playwright webServer 之 isPortUsed：127.0.0.1 與 ::1 任一可連即是）。
//與 HTTP 健康與否無關（佔用者回 5xx 或不回應仍算佔用）；連線逾時亦視為佔用（fail-closed）。
export function isPortListening(port, opts = {}) {
    const { hosts = ['127.0.0.1', '::1'], timeoutMs = 1500, connect = (p, h) => net.connect(p, h) } = opts
    const probe = (host) => new Promise((resolve) => {
        let done = false
        let sock = null
        const fin = (v) => {
            if (done) return
            done = true
            clearTimeout(timer)
            try { if (sock) sock.destroy() } catch (e) {}
            resolve(v)
        }
        const timer = setTimeout(() => fin(true), timeoutMs)
        try { sock = connect(port, host) }
        catch (e) { fin(false); return }
        sock.once('connect', () => fin(true))
        sock.once('error', () => fin(false))
    })
    return Promise.all(hosts.map(probe)).then((rs) => rs.some(Boolean))
}


//port 之監聽者集合是否恰為 {ownPid}（至少一個且無他者；他者只綁 127.0.0.1、自建綁 :: 時亦判為否）
export function isOwnedBy(pids, ownPid) {
    const own = String(ownPid)
    return Array.isArray(pids) && pids.length > 0 && pids.every((p) => String(p) === own)
}


//isChildAlive（'exit' 事件尚未發生）、waitChildExit（以 exit 事件判定、逾時回 false）、pidExists（同步、EPERM 視為存在）、
//sleepSync（Atomics.wait）、killOwnTree（只殺自建且仍存活者之整棵樹；Windows 同步 taskkill /F /T，回驗由呼叫端）：見檔頭，由 w-package-tools-e2e 提供。


//把目錄整個 rename 到 trashPath（非破壞性之持有者探測）：目錄內任一檔案被其他行程持有時，Windows 之 rename 整體失敗且不動任何檔案
//（2026-09-27 本機實測：lmdb 被持有時 rename 拋 EPERM、14 檔之清單與大小不變；持有者結束後第 1 次即成功）。
//對暫時性錯誤重試至截止時間（涵蓋剛被殺之行程尚未釋放檔案）；目錄不存在回 moved=false；逾時或非暫時性錯誤拋 EHELD。
const TRANSIENT_FS_CODES = ['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY']
export async function moveAwayDir(dir, trashPath, opts = {}) {
    const {
        rename = (a, b) => fs.renameSync(a, b),
        exists = fs.existsSync,
        mkdir = (d) => fs.mkdirSync(d, { recursive: true }),
        sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
        now = Date.now,
        deadlineMs = 8000,
        intervalMs = 500,
    } = opts
    if (!exists(dir)) return { moved: false, attempts: 0, waitedMs: 0 }
    mkdir(path.dirname(trashPath))
    const t0 = now()
    let attempts = 0
    let lastErr = null
    for (;;) {
        attempts++
        try {
            rename(dir, trashPath)
            return { moved: true, attempts, waitedMs: now() - t0 }
        }
        catch (e) {
            lastErr = e
            if (!TRANSIENT_FS_CODES.includes(e && e.code)) break
        }
        if (now() - t0 >= deadlineMs) break
        await sleep(intervalMs)
    }
    const why = lastErr ? `${lastErr.code || ''} ${lastErr.message || lastErr}`.trim() : '未知原因'
    const err = new Error(`無法移開 ${dir}（${why}；已試 ${attempts} 次、${now() - t0}ms）`)
    err.code = 'EHELD'
    err.attempts = attempts
    throw err
}


//盡力刪除目錄（失敗不拋錯，回傳是否已不存在）
export function rmDirBestEffort(dir, opts = {}) {
    const { rm = (d) => fs.rmSync(d, { recursive: true, force: true }), exists = fs.existsSync } = opts
    try { rm(dir) }
    catch (e) {}
    return !exists(dir)
}


//子行程輸出緩衝：保留開頭與結尾供錯誤訊息（編譯錯誤多在前段）。先去 ANSI 控制碼，再濾除 webpack 進度列（「[3%] setup …」）
//與「Build finished at …」雜訊行，免得灌滿結尾（2026-09-27 實測 vue-cli-service serve 以管線輸出時之格式）。
//recent() 為結尾段。
export function stripAnsi(s) {
    return String(s).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
}
export function makeOutBuf(opts = {}) {
    const { headMax = 2000, tailMax = 4000 } = opts
    let head = ''
    let tail = ''
    let total = 0
    return {
        push(d) {
            const s = stripAnsi(d).replace(/\r(?!\n)/g, '\n').split('\n')
                .filter((l) => !/^\s*\[?\d{1,3}%\]?\s/.test(l) && !/^Build finished at /.test(l))
                .join('\n')
            total += s.length
            if (head.length < headMax) { head += s.slice(0, headMax - head.length) }
            tail = (tail + s).slice(-tailMax)
        },
        recent() {
            return tail
        },
        text() {
            return total <= tailMax ? tail : `${head}\n……（中略）……\n${tail}`
        },
    }
}


//執行子行程直到 stdout 出現 marker：見到即結束該子行程（lmdb 會卡住 event loop 使其不自行結束），並等它真正關閉（釋放 lmdb）才 resolve（回傳輸出尾段）。
//failMarkers：腳本自行 catch 例外後印出之字樣（如 'initialData catch'），見到即判失敗，不空等逾時。
//未見 marker 即結束、逾時、無法啟動、完成後未能關閉皆 reject 並附輸出尾段；計時器一律清除（不拖住呼叫端行程）。
//onSpawn(child)：供呼叫端登記子行程，使 cleanup 在種子執行中也殺得到它。
export function runUntilMarker(cmd, args, opts = {}) {
    const { cwd, env, marker = 'finish.', failMarkers = [], timeoutMs = 60000, closeTimeoutMs = 10000, label = cmd, spawnFn = spawn, onSpawn = () => {} } = opts
    return new Promise((resolve, reject) => {
        let child = null
        let tail = ''
        let sawMarker = false
        let settled = false
        let timer = null
        let closeTimer = null
        const stopChild = () => { if (child && isChildAlive(child)) { try { child.kill() } catch (e) {} } }
        const settle = (err) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            clearTimeout(closeTimer)
            if (err) reject(err)
            else resolve(tail)
        }
        timer = setTimeout(() => {
            stopChild()
            settle(new Error(`${label} 逾時 ${timeoutMs}ms 未見「${marker}」；輸出尾段：\n${tail}`))
        }, timeoutMs)
        try { child = spawnFn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }) }
        catch (e) { settle(e); return }
        onSpawn(child)
        const onData = (d) => {
            tail = (tail + String(d)).slice(-2000)
            if (sawMarker) return
            const bad = failMarkers.find((m) => tail.includes(m))
            if (bad) {
                stopChild()
                settle(new Error(`${label} 失敗（輸出含「${bad}」）；輸出尾段：\n${tail}`))
                return
            }
            if (tail.includes(marker)) {
                sawMarker = true
                clearTimeout(timer)
                stopChild()
                closeTimer = setTimeout(() => settle(new Error(`${label} 已完成但子行程 ${closeTimeoutMs}ms 內未結束（PID ${child.pid}）`)), closeTimeoutMs)
            }
        }
        child.stdout.on('data', onData)
        child.stderr.on('data', onData)
        child.on('error', (e) => settle(new Error(`${label} 無法啟動：${e.message}`)))
        child.on('close', (code, sig) => {
            if (sawMarker) settle()
            else settle(new Error(`${label} 已結束（code=${code}, signal=${sig}）但未見「${marker}」；輸出尾段：\n${tail}`))
        })
    })
}


//以 PowerShell CIM 讀行程命令列（只讀）；PowerShell 以 UTF-8 輸出 JSON（-EncodedCommand 免跳脫；路徑含「開源」等非 ASCII 亦正確）。失敗回 null。
function queryProcsWin(filter, exec) {
    const script = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process -Filter "${filter}" | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress`
    try {
        const out = String(exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}`, { ...EXEC_OPT, timeout: 15000 })).trim()
        return out ? [].concat(JSON.parse(out)) : []
    }
    catch (e) {
        return null
    }
}


//以 PID 描述行程，僅供錯誤訊息（盡力而為）：Windows 取命令列（例「PID 1234 node srv.mjs …」），
//CIM 不可用時退回 tasklist 映像名，再不行只附 PID。
export function describeProcs(pids, opts = {}) {
    const { exec = execSync, platform = process.platform } = opts
    const list = (pids || []).map(String)
    if (list.length === 0) return ''
    if (platform !== 'win32') return list.map((p) => `PID ${p}`).join('、')
    const rows = queryProcsWin(list.map((p) => `ProcessId=${p}`).join(' OR '), exec)
    return list.map((p) => {
        const r = rows && rows.find((x) => String(x && x.ProcessId) === p)
        if (r) return `PID ${p} ${r.CommandLine || r.Name || ''}`.trim()
        try {
            const out = String(exec(`tasklist /FI "PID eq ${p}" /FO CSV /NH`, EXEC_OPT))
            const m = out.match(/^"([^"]+)","(\d+)"/m)
            return (m && m[2] === p) ? `PID ${p} ${m[1]}` : `PID ${p}`
        }
        catch (e) { return `PID ${p}` }
    }).join('、')
}


//列出命令列含指定字串（如測試實例之目錄）之 node 行程，僅供錯誤訊息指認疑似持有者（只讀；不據此殺任何行程）。不可用回 null。
export function findNodeProcsByCommandLine(fragment, opts = {}) {
    const { exec = execSync, platform = process.platform, excludePids = [] } = opts
    if (platform !== 'win32') return null
    const rows = queryProcsWin("name='node.exe'", exec)
    if (!rows) return null
    const f = String(fragment).toLowerCase()
    const ex = excludePids.map(String)
    return rows
        .filter((r) => r && typeof r.CommandLine === 'string' && r.CommandLine.toLowerCase().includes(f) && !ex.includes(String(r.ProcessId)))
        .map((r) => `PID ${r.ProcessId} ${r.CommandLine}`)
}


//跨行程互斥（同一專案同時只允許一個 harness）：本行程監聽 127.0.0.1:<port>（unref，不拖住 event loop）。
//已被佔用即拋 ELOCKED（附持有者描述）；行程死亡時由 OS 釋放，不像鎖檔會殘留。
export function acquirePortLock(port, opts = {}) {
    const { host = '127.0.0.1', createServer = () => net.createServer(), describeHolder = () => '' } = opts
    return new Promise((resolve, reject) => {
        const srv = createServer()
        srv.once('error', (e) => {
            if (e && e.code === 'EADDRINUSE') {
                const err = new Error(`另一個 e2e／api harness 正在本專案執行（互斥 port ${port} 已被佔用：${describeHolder() || '持有者不明'}）；`
                    + '同時執行會互刪測試資料庫、互搶 port。請等其結束後再跑；若該行程不是 harness，請確認後回報')
                err.code = 'ELOCKED'
                reject(err)
                return
            }
            reject(e)
        })
        srv.listen(port, host, () => {
            srv.unref()
            resolve(srv)
        })
    })
}


//釋放跨行程互斥
export function releasePortLock(srv) {
    try { if (srv) srv.close() }
    catch (e) {}
}
