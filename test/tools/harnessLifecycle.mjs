//e2e／api harness 之服務生命週期編排：可注入依賴之工廠
//（test/tools/e2e-setup.mjs 以真實依賴組裝；test/unit-harnessLifecycle.test.mjs 以假依賴逐格驗證）。
//所有權與生命週期規則（本檔為唯一實作處）：
//  - 前後端只用本 harness 自建者；port 被非自建行程佔用即拋錯（附命令列），不沿用、不殺。
//  - 殺：只殺自建且仍存活之 child（同步樹狀殺）；非同步路徑以 exit 事件回驗，殺不掉即拋錯。
//  - 重建種子：先把測試資料庫整個移開（有人持有即整體失敗、不動任何檔案）→ 種子 → 起後端 → 確認 port 只由自建者監聽。
//  - 後端之生命週期操作一律排隊（序列化）；cleanup 使進行中之操作於下個 await 後中止，不會在 cleanup 之後又起行程。
//  - 就緒 promise 依服務分拆（api 以 backendOnly 先呼叫不影響之後起前端）；失敗為黏著（同一錯誤），直到 cleanup 重置。
//  - 自建服務於測試期間非預期結束：記錄並於下次 startServersOnce 重建；teardown 時判為失敗。
//  - 跨行程互斥：同一專案同時只允許一個 harness（互斥由 deps.acquireLock 提供）。
import { isChildAlive, isOwnedBy, makeOutBuf, stripAnsi } from './harnessProc.mjs'


export class Cancelled extends Error {}

//輸出判定字樣（2026-09-27 實測）：
//  - srv.mjs 之 listen 失敗只印錯誤不退出（EADDRINUSE 後 15 秒仍存活），須由輸出判定綁定失敗
//  - vue-cli-service serve 編譯完成印「App running at:」（本專案有 1 個 warning，故為「Compiled with 1 warning」而非「Compiled successfully」）；
//    編譯失敗印「Failed to compile」但 dev server 照樣回應 HTTP，故前端就緒須等到完成字樣
//  - vue-cli-service 以 portfinder 自動改用下一個空 port，「Local: http://localhost:<port>/」為實際綁定之 port
const BIND_FAIL = /EADDRINUSE|EACCES|address already in use/i
const FE_OK = /App running at|Compiled successfully|Compiled with \d+ warning/i
const FE_FAIL = /Failed to compile/i
const FE_PORT = /Local:\s+https?:\/\/[^\s/:]+:(\d+)/


export function createHarness(cfg, deps) {
    const { backendPort, frontendPort, backendUrl, frontendUrl, defaultSettings, dbDir, trashDir, makeTrashPath } = cfg
    const budgets = { killMs: 5000, rebindWaitMs: 5000, backendReadyMs: 20000, frontendReadyMs: 150000, frontendMarkerWaitMs: 20000, verifyMs: 5000, ...(cfg.budgets || {}) }
    const {
        spawnBackend, spawnFrontend, runSeed, httpOk, listenerPids, isPortListening, killOwnTree, waitChildExit, pidExists,
        sleep, sleepSync, now, moveAwayDir, rmDirBestEffort, describeProcs, findHolders, acquireLock, releaseLock, readSettingsPort,
        afterCleanup = () => {}, log = (m) => console.log(m), env = process.env,
    } = deps

    let spawned = [] //{ name: 'backend'|'frontend'|'seed', port, child, out, expected, starting, spawnError }：本 harness 自建之行程（只殺這些）
    let backendReady = null //後端最近一次（含進行中）生命週期操作之 promise
    let frontendReady = null
    let chain = Promise.resolve() //後端生命週期操作之佇列
    let epoch = 0 //cleanup 世代；進行中之操作於每個 await 後比對，已變即中止
    let activeSettings = defaultSettings //目前生效之後端設定檔（restartBackend 改、reseedBackend 沿用、cleanup 還原）
    const killedPids = new Set() //cleanup 同步殺掉之自建 PID（可能仍在結束中）：再次啟動時只對這些等待，其餘監聽者立即拋錯
    let unexpectedExits = []
    let lockHeld = false

    const fail = (msg) => new Error(`[e2e-setup] ${msg}`)

    function guard(my) {
        if (my !== epoch) { throw new Cancelled('[e2e-setup] harness 已 cleanup，中止進行中之作業') }
    }

    function checkEnv() {
        if (env.NODE_ENV === 'production') {
            throw fail('NODE_ENV=production 時 srv.mjs 之測試權杖停用，e2e／api 測試無法登入；請勿以 production 環境執行測試')
        }
    }

    async function ensureLock() {
        if (lockHeld) return
        await acquireLock()
        lockHeld = true
    }

    function dropLock() {
        if (!lockHeld) return
        lockHeld = false
        releaseLock()
    }

    function serial(fn) {
        const run = chain.then(() => fn(), () => fn())
        chain = run.then(() => {}, () => {})
        return run
    }

    function track(name, port, child) {
        const e = { name, port, child, out: makeOutBuf(), expected: false, starting: true, spawnError: null, win: '', flags: { ok: false, fail: false, bind: '', port: 0 } }
        //輸出之判定字樣以跨 chunk 之滾動視窗偵測並設為黏著旗標（不受輸出與 HTTP 回應之先後、或結尾段被後續輸出擠掉影響）
        const onData = (d) => {
            e.out.push(d)
            e.win = (e.win + stripAnsi(d)).slice(-800)
            if (!e.flags.bind) {
                const mb = e.win.match(BIND_FAIL)
                if (mb) { e.flags.bind = mb[0] }
            }
            if (FE_FAIL.test(e.win)) { e.flags.fail = true }
            if (FE_OK.test(e.win)) { e.flags.ok = true }
            const mp = e.win.match(FE_PORT)
            if (mp) { e.flags.port = Number(mp[1]) }
        }
        if (child.stdout) { child.stdout.on('data', onData) }
        if (child.stderr) { child.stderr.on('data', onData) }
        child.on('error', (err) => {
            e.spawnError = err
            e.out.push(`[spawn error] ${err.message}\n`)
        })
        child.on('exit', (code, signal) => {
            if (e.expected || e.starting || name === 'seed') return //啟動中之失敗由 spawnOwn 直接拋錯，不重複記錄
            unexpectedExits.push({ name, pid: child.pid, code, signal })
            log(`[e2e-setup] 警告：自建 ${name}（PID ${child.pid}）於測試期間非預期結束（code=${code}, signal=${signal}）；輸出：\n${e.out.text()}`)
        })
        spawned.push(e)
        return e
    }

    function ownAlive(name) {
        const e = spawned.find((x) => x.name === name)
        return !!e && isChildAlive(e.child)
    }

    function portBusyError(port, label, pids) {
        const ownPids = spawned.map((e) => String(e.child.pid))
        const stuck = (pids || []).filter((p) => ownPids.includes(String(p)))
        if (stuck.length > 0) {
            return fail(`${label}：port ${port} 仍由本 harness 先前啟動、但未能結束之行程監聽（${describeProcs(stuck)}）；請手動確認該行程`)
        }
        const who = pids && pids.length > 0 ? describeProcs(pids) : 'PID 無法取得'
        return fail(`${label}：port ${port} 被非本 harness 啟動之行程佔用（${who}）。`
            + `harness 只使用自己啟動之測試實例（後端 ${backendPort}、前端 ${frontendPort}），不沿用也不殺非自己啟動之行程（CLAUDE.md「只能重啟自己所創建的 PID 服務」）。`
            + '若該行程是你（或本工作階段）先前啟動而殘留，確認後自行關閉再重跑；若是他人之行程，請回報使用者，勿自行殺除')
    }

    //port 須無人監聽。只在監聽者全為「cleanup 同步殺掉、仍在結束中」之自建 PID，或 netstat 暫未列出時稍候重查；
    //見到其他監聽者立即拋錯（同 Playwright 對已佔用 port 不等待）。netstat 不可用（null）而 TCP 可連時 fail-closed。
    async function ensurePortFree(port, label, my) {
        const t0 = now()
        for (;;) {
            guard(my)
            const pids = listenerPids(port)
            const busy = (!!pids && pids.length > 0) || (await isPortListening(port))
            guard(my)
            if (!busy) return
            const onlyDying = !!pids && pids.length > 0 && pids.every((p) => killedPids.has(String(p)))
            const notListedYet = !!pids && pids.length === 0
            if ((!onlyDying && !notListedYet) || now() - t0 >= budgets.rebindWaitMs) {
                throw portBusyError(port, label, pids)
            }
            await sleep(200)
        }
    }

    async function killOwnService(name) {
        for (const e of spawned.filter((x) => x.name === name)) {
            e.expected = true
            killOwnTree(e.child)
            if (!(await waitChildExit(e.child, budgets.killMs))) {
                throw fail(`自建 ${name}（${describeProcs([String(e.child.pid)]) || `PID ${e.child.pid}`}）殺後 ${budgets.killMs}ms 仍未結束；請手動確認該行程`)
            }
            spawned = spawned.filter((x) => x !== e)
        }
    }

    //非破壞性刪庫：先把測試資料庫整個移開（有任一檔被其他行程持有即整體失敗、不動任何檔案），移開後才刪（刪不掉留待下次）
    async function wipeDb(label) {
        rmDirBestEffort(trashDir) //前次未能刪除之殘留
        const trash = makeTrashPath()
        let r = null
        try {
            r = await moveAwayDir(dbDir, trash)
        }
        catch (e) {
            const holders = findHolders()
            const hs = holders === null ? '無法查詢' : (holders.length > 0 ? holders.join('；') : '查無（可能已結束，可重跑）')
            throw fail(`${label}：無法移開測試資料庫 ${dbDir}，未刪除任何檔案（${e.message}）。疑似持有者：${hs}。`
                + '可能原因：本 harness 先前之後端或種子尚未結束、或有人以測試實例目錄為工作目錄啟動了後端或種子腳本')
        }
        if (r.moved && r.attempts > 1) { log(`[e2e-setup] 測試資料庫於第 ${r.attempts} 次才移開（等待持有者釋放 ${r.waitedMs}ms）`) }
        if (r.moved) { rmDirBestEffort(trash) }
    }

    async function seed(kind, my) {
        guard(my)
        await runSeed(kind, {
            onSpawn: (child) => {
                const e = track('seed', null, child)
                e.expected = true
            },
        })
        spawned = spawned.filter((x) => !(x.name === 'seed' && !isChildAlive(x.child)))
        guard(my)
    }

    function startFailure(isBackend, e) {
        if (isBackend) { return e.flags.bind ? `綁定 port 失敗（輸出含 ${e.flags.bind}）` : '' }
        if (e.flags.fail) return '前端編譯失敗（輸出含 Failed to compile）'
        if (e.flags.port && e.flags.port !== frontendPort) return `前端未綁在 ${frontendPort}（實際 ${e.flags.port}，${frontendPort} 應已被他者佔用）`
        return ''
    }

    //啟動自建服務並等就緒：自建行程先結束、無法啟動、輸出含啟動失敗字樣、逾時、或 port 監聽者不只自建者 → 殺自建並拋錯（附輸出）。
    //前端須 HTTP 有回應且輸出已見編譯完成字樣；已回應但久未見字樣（輸出格式變動）則警告後放行，不無限等待。
    async function spawnOwn(name, my) {
        guard(my)
        const isBackend = name === 'backend'
        const port = isBackend ? backendPort : frontendPort
        const url = isBackend ? backendUrl : frontendUrl
        const budget = isBackend ? budgets.backendReadyMs : budgets.frontendReadyMs
        const child = isBackend ? spawnBackend(activeSettings) : spawnFrontend()
        const e = track(name, port, child)
        const failNow = async (why) => {
            e.expected = true
            if (isChildAlive(child)) {
                killOwnTree(child)
                await waitChildExit(child, budgets.killMs)
            }
            spawned = spawned.filter((x) => x !== e)
            return fail(`${name}（port ${port}）啟動失敗：${why}；輸出：\n${e.out.text()}`)
        }
        const t0 = now()
        let respondedAt = null
        for (;;) {
            guard(my)
            if (e.spawnError) { throw await failNow(`無法啟動（${e.spawnError.message}）`) }
            if (!isChildAlive(child)) { throw await failNow(`行程已結束（code=${child.exitCode}, signal=${child.signalCode}）`) }
            const bad = startFailure(isBackend, e)
            if (bad) { throw await failNow(bad) }
            if (await httpOk(url)) {
                if (isBackend || e.flags.ok) break
                if (respondedAt === null) { respondedAt = now() }
                if (now() - respondedAt >= budgets.frontendMarkerWaitMs) {
                    log(`[e2e-setup] 警告：${name} 已回應 HTTP，但 ${budgets.frontendMarkerWaitMs}ms 內未見編譯完成字樣（輸出格式可能已變），照常放行；輸出：\n${e.out.text()}`)
                    break
                }
            }
            if (now() - t0 >= budget) { throw await failNow(`等待 ${url} 逾時 ${budget}ms`) }
            await sleep(500)
        }
        const bad = startFailure(isBackend, e)
        if (bad) { throw await failNow(bad) }
        const pids = listenerPids(port)
        if (pids === null) {
            log(`[e2e-setup] 警告：無法查詢 port ${port} 之監聽者 PID（netstat／lsof 不可用），僅以「啟動前 port 為空＋自建行程存活」為據`)
        }
        else if (!isOwnedBy(pids, child.pid)) {
            throw await failNow(`port ${port} 由 ${describeProcs(pids) || '無人'} 監聽，不是（或不只是）剛啟動之自建行程（PID ${child.pid}）；可能有其他行程同時搶用此 port`)
        }
        e.starting = false
    }

    async function startBackendOp() {
        const my = epoch
        checkEnv()
        await ensureLock()
        guard(my)
        await ensurePortFree(backendPort, 'startServersOnce（後端）', my)
        await wipeDb('startServersOnce（後端）')
        guard(my)
        await seed('base', my)
        await spawnOwn('backend', my)
    }

    async function startFrontendOp() {
        const my = epoch
        checkEnv()
        await ensureLock()
        guard(my)
        await ensurePortFree(frontendPort, 'startServersOnce（前端）', my)
        await spawnOwn('frontend', my)
    }

    async function ensureBackend() {
        if (!backendReady) { backendReady = serial(startBackendOp) }
        await backendReady //進行中者共用；失敗者黏著（同一錯誤），直到 cleanup 重置
        if (!ownAlive('backend')) {
            //已就緒過但自建後端已不在（非預期結束已記錄，teardown 時判失敗）：重建
            backendReady = serial(startBackendOp)
            await backendReady
        }
    }

    async function ensureFrontend() {
        if (!frontendReady) { frontendReady = startFrontendOp() }
        await frontendReady
        if (!ownAlive('frontend')) {
            frontendReady = startFrontendOp()
            await frontendReady
        }
    }

    //殺自建後端並回驗 → 確認 port 釋放（見非自建監聽者即拋錯）→（reseed 時）移開並重建測試資料庫 → 啟動自建後端並確認由它監聽
    function respawnBackend({ settingsPath, reseed, withArchivedTask, label }) {
        backendReady = serial(async () => {
            const my = epoch
            checkEnv()
            await ensureLock()
            guard(my)
            if (settingsPath) {
                const p = readSettingsPort(settingsPath)
                if (p !== backendPort) {
                    throw fail(`${label}：設定檔 ${settingsPath} 之 serverPort=${p} 與 harness 後端 port ${backendPort} 不符（harness 只管理固定 port 之測試實例）`)
                }
                activeSettings = settingsPath
            }
            await killOwnService('backend')
            guard(my)
            await ensurePortFree(backendPort, label, my)
            if (reseed) {
                await wipeDb(label)
                guard(my)
                await seed('base', my)
                if (withArchivedTask) { await seed('archived', my) }
            }
            await spawnOwn('backend', my)
        })
        return backendReady
    }

    //同步殺本 harness 自建之全部行程（exit／signal 處理器內亦能殺完），並於上限內同步回驗；重置狀態、釋放互斥
    function cleanup() {
        epoch++
        const own = spawned.slice()
        for (const e of own) {
            e.expected = true
            if (killOwnTree(e.child)) { killedPids.add(String(e.child.pid)) }
        }
        spawned = []
        backendReady = null
        frontendReady = null
        chain = Promise.resolve()
        activeSettings = defaultSettings
        const t0 = now()
        let leftover = []
        for (;;) {
            leftover = []
            for (const e of own) {
                if (e.child.pid && pidExists(e.child.pid)) { leftover.push(`${e.name} PID ${e.child.pid} 仍存在`) }
                if (e.port) {
                    const pids = listenerPids(e.port)
                    if (pids && pids.length > 0) { leftover.push(`port ${e.port} 仍被 PID ${pids.join(',')} 監聽`) }
                }
            }
            if (leftover.length === 0 || now() - t0 >= budgets.verifyMs) break
            sleepSync(100)
        }
        if (leftover.length > 0) { log(`[e2e-setup] 警告：cleanup 後 ${budgets.verifyMs}ms 仍有殘留：${leftover.join('；')}`) }
        dropLock()
        afterCleanup()
        return { own, leftover }
    }

    //mocha root after 用：cleanup 後再以 exit 事件與 port 回驗；另將測試期間之非預期結束判為失敗
    async function teardown() {
        const { own } = cleanup()
        const problems = []
        for (const e of own) {
            if (!(await waitChildExit(e.child, budgets.killMs))) { problems.push(`自建 ${e.name}（PID ${e.child.pid}）未結束`) }
        }
        for (const e of own) {
            if (!e.port) continue
            const pids = listenerPids(e.port)
            if (pids && pids.length > 0) { problems.push(`port ${e.port} 仍被 ${describeProcs(pids)} 監聽`) }
        }
        for (const u of unexpectedExits) {
            problems.push(`自建 ${u.name}（PID ${u.pid}）於測試期間非預期結束（code=${u.code}, signal=${u.signal}）`)
        }
        unexpectedExits = []
        if (problems.length > 0) { throw fail(`收尾回驗未通過：\n${problems.join('\n')}`) }
    }

    return {
        async startServersOnce(opts = {}) {
            const { backendOnly = false } = opts
            await ensureBackend()
            //API 契約測試只需 backend，省去 frontend webpack 首編；e2e 不傳此旗標→照起前端
            if (backendOnly) return
            await ensureFrontend()
        },
        reseedBackend(opts = {}) {
            const { withArchivedTask = false } = opts
            return respawnBackend({ settingsPath: null, reseed: true, withArchivedTask, label: 'reseedBackend' })
        },
        restartBackend(settingsPath = defaultSettings) {
            return respawnBackend({ settingsPath, reseed: false, withArchivedTask: false, label: 'restartBackend' })
        },
        cleanup,
        teardown,
        //單元測試與診斷用之唯讀快照
        state() {
            return {
                spawned: spawned.map((e) => ({ name: e.name, pid: e.child.pid, port: e.port })),
                epoch,
                activeSettings,
                lockHeld,
                unexpectedExits: unexpectedExits.slice(),
            }
        },
    }
}
