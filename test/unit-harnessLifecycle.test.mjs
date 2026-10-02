//unit-harnessLifecycle：test/tools/harnessLifecycle.mjs（e2e／api harness 生命週期編排工廠）單元測試（不需 server/browser）。
//以「假世界」注入依賴（port 監聽表、行程表、假時鐘、可延遲之種子），逐格驗證真機難以製造之情境；
//每案註明對應之需求（R1 不越權、R2 清理、R3 重建種子、R4 合跑、R5 對稱、R6 可診斷）與全盤矩陣格。
//不碰真實 port 與行程（npm test 中本檔於 e2e 之後執行，此時 harness 之服務仍在）。
import assert from 'assert'
import { EventEmitter } from 'events'
import { createHarness, Cancelled } from './tools/harnessLifecycle.mjs'
import { waitChildExit } from './tools/harnessProc.mjs'


const BACKEND = 11108
const FRONTEND = 8091
const E2E = 'E2E.json'
const tick = () => new Promise((r) => setImmediate(r))


//假世界：ports（port → [{ pid, ready }]）、procs（pid → 行程紀錄）、假時鐘、呼叫紀錄
function makeWorld() {
    let clock = 0
    let nextPid = 5000
    const ports = new Map()
    const procs = new Map()
    const calls = []
    const logs = []
    const deferred = {}
    const w = { calls, logs, ports, procs, dbHeld: false, holders: [], lockTaken: false, netstatNull: false, seedPlan: {}, backendPlan: [], frontendPlan: [], settingsPorts: {}, env: {}, onKill: null, onSleep: null }

    function listen(port, pid, ready = true) {
        const l = ports.get(port) || []
        l.push({ pid: String(pid), ready })
        ports.set(port, l)
    }
    function unlistenPid(pid) {
        for (const [p, l] of [...ports]) {
            const r = l.filter((x) => x.pid !== String(pid))
            if (r.length) { ports.set(p, r) }
            else { ports.delete(p) }
        }
    }
    function makeChild(kind) {
        const pid = nextPid++
        const c = Object.assign(new EventEmitter(), { pid, exitCode: null, signalCode: null, stdout: new EventEmitter(), stderr: new EventEmitter() })
        const rec = { alive: true, unkillable: false, lingerMs: 0, kind, child: c }
        procs.set(String(pid), rec)
        c.die = (code, sig) => {
            if (!rec.alive) return
            rec.alive = false
            c.exitCode = sig ? null : code
            c.signalCode = sig || null
            if (!rec.lingerMs) { unlistenPid(pid) }
            setImmediate(() => c.emit('exit', c.exitCode, c.signalCode))
        }
        return c
    }
    w.listen = listen
    w.unlistenPid = unlistenPid
    w.foreign = (port, pid = 777, ready = true) => {
        procs.set(String(pid), { alive: true, foreign: true })
        listen(port, pid, ready)
    }
    w.childOf = (kind) => [...procs.values()].filter((r) => r.kind === kind).map((r) => r.child)
    w.release = (kind) => { if (deferred[kind]) { deferred[kind]() } }
    w.now = () => clock

    w.deps = {
        spawnBackend(settings) {
            calls.push(['spawnBackend', settings])
            const plan = w.backendPlan.shift() || 'ok'
            const c = makeChild('backend')
            const rec = procs.get(String(c.pid))
            if (plan === 'crash') {
                setImmediate(() => { c.stdout.emit('data', 'boom: crash at startup\n'); c.die(1) })
            }
            else if (plan === 'bindfail' || (plan === 'ok' && ports.has(BACKEND))) {
                //搶不到 port：印 EADDRINUSE 但不退出（同 srv.mjs 之實測）
                setImmediate(() => c.stdout.emit('data', 'Error: listen EADDRINUSE: address already in use :::11108\n'))
            }
            else if (plan === 'never-ready') { listen(BACKEND, c.pid, false) }
            else if (plan === 'co-listen') { listen(BACKEND, c.pid); w.foreign(BACKEND, 888) }
            else {
                listen(BACKEND, c.pid)
                if (plan === 'unkillable') { rec.unkillable = true }
                if (plan === 'linger') { rec.lingerMs = 600 }
            }
            return c
        },
        spawnFrontend() {
            calls.push(['spawnFrontend'])
            const plan = w.frontendPlan.shift() || 'ok'
            const c = makeChild('frontend')
            if (plan === 'drift') {
                listen(8092, c.pid)
                setImmediate(() => c.stdout.emit('data', 'App running at:\n  - Local:   http://localhost:8092/\n'))
            }
            else if (plan === 'compile-fail') {
                //dev server 編譯失敗仍回應（瀏覽器顯示錯誤 overlay）；輸出於 spawn 之後非同步到達
                listen(FRONTEND, c.pid)
                setImmediate(() => c.stdout.emit('data', '\u001b[2K\u001b[G[98%] after emitting\n ERROR  Failed to compile with 1 error\n'))
            }
            else if (plan === 'no-marker') {
                //已回應 HTTP 但輸出沒有編譯完成字樣（模擬輸出格式變動）
                listen(FRONTEND, c.pid)
            }
            else {
                //實測格式（2026-09-27）：編譯完成字樣可能跨 chunk 到達、夾 ANSI 控制碼，且可能晚於 HTTP 回應
                listen(FRONTEND, c.pid)
                setImmediate(() => {
                    c.stdout.emit('data', ' WARNING  Compiled with 1 warning\n\u001b[2K\u001b[1A  App run')
                    c.stdout.emit('data', 'ning at:\n  - Local:   http://localhost:8091/ \n')
                })
            }
            return c
        },
        async runSeed(kind, { onSpawn }) {
            calls.push(['seed', kind])
            const c = makeChild('seed')
            onSpawn(c)
            const plan = w.seedPlan[kind] || 'ok'
            if (plan === 'deferred') { await new Promise((r) => { deferred[kind] = r }) }
            c.die(0)
            await tick()
            if (plan === 'fail') { throw new Error(`${kind} 失敗（輸出含「initialData catch」）`) }
            return 'finish.\n'
        },
        async httpOk(url) {
            const port = Number(url.match(/:(\d+)\//)[1])
            const l = ports.get(port)
            return !!l && l.some((x) => x.ready)
        },
        listenerPids(port) {
            if (w.netstatNull) return null
            const l = ports.get(port)
            return l ? [...new Set(l.map((x) => x.pid))] : []
        },
        async isPortListening(port) { return ports.has(port) },
        killOwnTree(child) {
            calls.push(['kill', String(child.pid)])
            const rec = procs.get(String(child.pid))
            if (!rec || !rec.alive) return false
            if (w.onKill) { w.onKill(child) }
            if (!rec.unkillable) { child.die(null, 'SIGKILL') }
            return true
        },
        waitChildExit,
        pidExists(pid) {
            const r = procs.get(String(pid))
            return !!r && r.alive
        },
        async sleep(ms) {
            clock += ms
            if (w.onSleep) { w.onSleep(clock) }
            await tick()
        },
        sleepSync(ms) {
            clock += ms
            if (w.onSleep) { w.onSleep(clock) }
        },
        now: () => clock,
        async moveAwayDir(dir) {
            calls.push(['moveDb', dir])
            if (w.dbHeld) {
                const e = new Error('無法移開 ROOT/db（EPERM operation not permitted；已試 17 次、8000ms）')
                e.code = 'EHELD'
                throw e
            }
            return { moved: true, attempts: 1, waitedMs: 0 }
        },
        rmDirBestEffort(dir) {
            calls.push(['rm', dir])
            return true
        },
        describeProcs(pids) { return pids.map((p) => `PID ${p} fake-cmd`).join('、') },
        findHolders() { return w.holders },
        async acquireLock() {
            calls.push(['lock'])
            if (w.lockTaken) {
                const e = new Error('另一個 e2e／api harness 正在本專案執行（互斥 port 11208 已被佔用：PID 4242 node mocha）')
                e.code = 'ELOCKED'
                throw e
            }
        },
        releaseLock() { calls.push(['unlock']) },
        readSettingsPort(p) {
            const v = w.settingsPorts[p]
            if (v === 'ENOENT') { throw new Error(`ENOENT: no such file or directory, open '${p}'`) }
            return v === undefined ? BACKEND : v
        },
        afterCleanup() { calls.push(['afterCleanup']) },
        log(msg) { logs.push(msg) },
        env: w.env,
    }
    return w
}

function makeHarness(w, budgets = {}) {
    return createHarness({
        backendPort: BACKEND,
        frontendPort: FRONTEND,
        backendUrl: `http://127.0.0.1:${BACKEND}/`,
        frontendUrl: `http://127.0.0.1:${FRONTEND}/`,
        defaultSettings: E2E,
        dbDir: 'ROOT/db',
        trashDir: 'TRASH',
        makeTrashPath: () => 'TRASH/db-1',
        budgets: { killMs: 30, rebindWaitMs: 1000, backendReadyMs: 5000, frontendReadyMs: 5000, verifyMs: 500, ...budgets },
    }, w.deps)
}

const names = (calls) => calls.map((c) => c[0])
const count = (calls, name) => calls.filter((c) => c[0] === name).length
const aliveOwn = (w, kind) => w.childOf(kind).filter((c) => c.exitCode === null && c.signalCode === null)


describe('unit-harnessLifecycle（e2e／api harness 生命週期編排）', function() {
    this.timeout(20000)


    // ── 啟動（E1／E2）──────────────────────────────────────────────────────────────
    describe('startServersOnce', function() {

        it('冷啟動：互斥→移開測試資料庫→種子→起後端（預設設定）→起前端；監聽者恰為自建 PID（M1-1）', async function() {
            let w = makeWorld()
            let h = makeHarness(w)
            await h.startServersOnce()
            assert.deepStrictEqual(names(w.calls).filter((n) => n !== 'rm'), ['lock', 'moveDb', 'seed', 'spawnBackend', 'spawnFrontend'])
            assert.deepStrictEqual(w.calls.find((c) => c[0] === 'spawnBackend'), ['spawnBackend', E2E])
            let st = h.state()
            assert.deepStrictEqual(st.spawned.map((s) => s.name), ['backend', 'frontend'])
            assert.strictEqual(st.lockHeld, true)
        })

        it('R4：先 backendOnly 再完整呼叫，前端仍會啟動；重複呼叫不重起（M1-7）', async function() {
            //舊碼單一 started 旗標：api 檔以 backendOnly 先呼叫後，e2e 檔之呼叫直接返回，前端永不啟動
            let w = makeWorld()
            let h = makeHarness(w)
            await h.startServersOnce({ backendOnly: true })
            assert.strictEqual(count(w.calls, 'spawnFrontend'), 0)
            await h.startServersOnce()
            assert.strictEqual(count(w.calls, 'spawnFrontend'), 1)
            await h.startServersOnce()
            assert.strictEqual(count(w.calls, 'spawnBackend'), 1)
            assert.strictEqual(count(w.calls, 'spawnFrontend'), 1)
        })

        it('並發呼叫共用同一次啟動（C4）', async function() {
            let w = makeWorld()
            let h = makeHarness(w)
            await Promise.all([h.startServersOnce({ backendOnly: true }), h.startServersOnce({ backendOnly: true })])
            assert.strictEqual(count(w.calls, 'spawnBackend'), 1)
        })

        it('R1：後端 port 被非自建行程佔用 → 立即拋錯（附其描述），不殺、不沿用、不動資料庫（M1-4／M1-5）', async function() {
            let w = makeWorld()
            w.foreign(BACKEND, 777)
            let h = makeHarness(w)
            await assert.rejects(h.startServersOnce({ backendOnly: true }), (e) => /非本 harness 啟動之行程佔用/.test(e.message) && /PID 777 fake-cmd/.test(e.message) && /勿自行殺除/.test(e.message))
            assert.ok(!w.calls.some((c) => c[0] === 'kill'), '不得殺佔用者')
            assert.strictEqual(count(w.calls, 'moveDb'), 0, '不得動資料庫')
            assert.strictEqual(count(w.calls, 'spawnBackend'), 0)
            assert.strictEqual(w.now(), 0, '見到非自建監聽者不等待（同 Playwright）')
        })

        it('R1：佔用者回 5xx（HTTP 不健康但有監聽）亦判為佔用（A-1 Sol）', async function() {
            let w = makeWorld()
            w.foreign(BACKEND, 778, false)
            let h = makeHarness(w)
            await assert.rejects(h.startServersOnce({ backendOnly: true }), /PID 778/)
            assert.strictEqual(count(w.calls, 'moveDb'), 0)
        })

        it('R1：前端 port 被非自建行程佔用 → 拋錯、不殺、不沿用（前端亦只用自建者）', async function() {
            let w = makeWorld()
            w.foreign(FRONTEND, 779)
            let h = makeHarness(w)
            await assert.rejects(h.startServersOnce(), (e) => /port 8091/.test(e.message) && /PID 779/.test(e.message))
            assert.ok(!w.calls.some((c) => c[0] === 'kill' && c[1] === '779'))
            assert.strictEqual(count(w.calls, 'spawnFrontend'), 0)
        })

        it('失敗為黏著：同行程再呼叫得到同一錯誤、不重跑；cleanup 後才重新偵測（M1-13／M1-8）', async function() {
            //舊碼先設 started=true 才 await：失敗後再呼叫直接「成功」返回但沒有後端
            let w = makeWorld()
            w.foreign(BACKEND, 777)
            let h = makeHarness(w)
            let e1 = await h.startServersOnce({ backendOnly: true }).catch((e) => e)
            let n = w.calls.length
            let e2 = await h.startServersOnce({ backendOnly: true }).catch((e) => e)
            assert.strictEqual(e2, e1, '應為同一錯誤物件')
            assert.strictEqual(w.calls.length, n, '不重跑任何步驟')
            h.cleanup()
            w.unlistenPid(777)
            await h.startServersOnce({ backendOnly: true })
            assert.strictEqual(count(w.calls, 'spawnBackend'), 1)
        })

        it('cleanup 後再起：只對「cleanup 殺掉、仍在結束中」之自建 PID 等待，釋放後照常啟動（C2）', async function() {
            let w = makeWorld()
            w.backendPlan = ['linger']
            let h = makeHarness(w)
            await h.startServersOnce({ backendOnly: true })
            let old = w.childOf('backend')[0]
            h.cleanup()
            //cleanup 已殺，但 port 殘留至假時鐘推進 600ms 後才釋放
            let killedAt = w.now()
            w.onSleep = (t) => { if (t - killedAt >= 600) { w.unlistenPid(old.pid) } }
            await h.startServersOnce({ backendOnly: true })
            assert.strictEqual(count(w.calls, 'spawnBackend'), 2)
            assert.ok(w.now() - killedAt >= 600, '應等到舊自建 PID 釋放')
        })

        it('NODE_ENV=production：拒絕執行（測試權杖停用），不取互斥、不起任何行程', async function() {
            let w = makeWorld()
            w.env.NODE_ENV = 'production'
            let h = makeHarness(w)
            await assert.rejects(h.startServersOnce(), /NODE_ENV=production/)
            assert.strictEqual(w.calls.length, 0)
        })

        it('跨行程互斥被佔 → 拋錯（附持有者），不起任何行程（M1-12）', async function() {
            let w = makeWorld()
            w.lockTaken = true
            let h = makeHarness(w)
            await assert.rejects(h.startServersOnce(), (e) => e.code === 'ELOCKED' && /PID 4242/.test(e.message))
            assert.deepStrictEqual(names(w.calls), ['lock'])
        })

        it('netstat 不可用：TCP 可連即 fail-closed（不當成無人）；port 空則照常啟動並警告無法確認 PID（D-2／D-5）', async function() {
            let w = makeWorld()
            w.netstatNull = true
            w.foreign(BACKEND, 777)
            let h = makeHarness(w)
            await assert.rejects(h.startServersOnce({ backendOnly: true }), /PID 無法取得/)
            let w2 = makeWorld()
            w2.netstatNull = true
            let h2 = makeHarness(w2)
            await h2.startServersOnce({ backendOnly: true })
            assert.ok(w2.logs.some((l) => /無法查詢 port 11108 之監聽者 PID/.test(l)))
        })

        it('種子失敗 → 拋錯，不起後端（M1-9／X2）', async function() {
            let w = makeWorld()
            w.seedPlan.base = 'fail'
            let h = makeHarness(w)
            await assert.rejects(h.startServersOnce({ backendOnly: true }), /initialData catch/)
            assert.strictEqual(count(w.calls, 'spawnBackend'), 0)
        })

    })


    // ── 自建服務之啟動失敗（X3／X3′／X4）────────────────────────────────────────────────────
    describe('啟動失敗之偵測（R3／R6）', function() {

        it('後端啟動即崩潰 → 立即拋錯，附結束碼與輸出（M1-10）', async function() {
            let w = makeWorld()
            w.backendPlan = ['crash']
            let h = makeHarness(w)
            await assert.rejects(h.startServersOnce({ backendOnly: true }), (e) => /行程已結束/.test(e.message) && /code=1/.test(e.message) && /boom: crash at startup/.test(e.message))
            assert.deepStrictEqual(h.state().spawned, [], '已結束者移出記錄')
            assert.deepStrictEqual(h.state().unexpectedExits, [], '啟動中之失敗直接拋錯，不重複記為非預期結束')
        })

        it('後端輸出 EADDRINUSE 而不退出（殭屍）→ 由輸出判定、殺自建並立即拋錯，不等逾時（M1-11／D-3）', async function() {
            let w = makeWorld()
            w.backendPlan = ['bindfail']
            let h = makeHarness(w)
            await assert.rejects(h.startServersOnce({ backendOnly: true }), (e) => /綁定 port 失敗/.test(e.message) && /EADDRINUSE/.test(e.message))
            assert.strictEqual(aliveOwn(w, 'backend').length, 0, '自建殭屍應被殺')
            assert.ok(w.now() < 5000, '不應等到就緒逾時')
        })

        it('後端逾時未就緒 → 殺自建並拋錯（X4）', async function() {
            let w = makeWorld()
            w.backendPlan = ['never-ready']
            let h = makeHarness(w)
            await assert.rejects(h.startServersOnce({ backendOnly: true }), /逾時 5000ms/)
            assert.strictEqual(aliveOwn(w, 'backend').length, 0)
        })

        it('就緒後 port 監聽者不只自建者 → 殺自建並拋錯，不殺他者（集合相等，D-2／D-3）', async function() {
            let w = makeWorld()
            w.backendPlan = ['co-listen']
            let h = makeHarness(w)
            await assert.rejects(h.startServersOnce({ backendOnly: true }), (e) => /不是（或不只是）剛啟動之自建行程/.test(e.message) && /PID 888/.test(e.message))
            assert.strictEqual(aliveOwn(w, 'backend').length, 0)
            assert.ok(!w.calls.some((c) => c[0] === 'kill' && c[1] === '888'), '不得殺他者')
        })

        it('前端改綁他 port（portfinder 漂移）→ 殺自建並拋錯（A-4 Opus B）', async function() {
            let w = makeWorld()
            w.frontendPlan = ['drift']
            let h = makeHarness(w)
            await assert.rejects(h.startServersOnce(), /前端未綁在 8091（實際 8092/)
            assert.strictEqual(aliveOwn(w, 'frontend').length, 0)
        })

        it('前端編譯失敗（dev server 仍回應 HTTP，失敗字樣晚於回應到達）→ 拋錯附輸出（A-11 Opus A）', async function() {
            let w = makeWorld()
            w.frontendPlan = ['compile-fail']
            let h = makeHarness(w)
            await assert.rejects(h.startServersOnce(), (e) => /前端編譯失敗/.test(e.message) && /Failed to compile with 1 error/.test(e.message))
            assert.strictEqual(aliveOwn(w, 'frontend').length, 0)
        })

        it('前端就緒須見編譯完成字樣（跨 chunk、夾 ANSI 亦認得）；已回應但久未見字樣 → 警告後放行，不無限等待', async function() {
            let w = makeWorld()
            let h = makeHarness(w)
            await h.startServersOnce()
            assert.ok(!w.logs.some((l) => /未見編譯完成字樣/.test(l)), '正常格式不應警告')
            let w2 = makeWorld()
            w2.frontendPlan = ['no-marker']
            let h2 = makeHarness(w2, { frontendMarkerWaitMs: 2000 })
            await h2.startServersOnce()
            assert.ok(w2.logs.some((l) => /未見編譯完成字樣/.test(l)))
            assert.ok(w2.now() >= 2000)
        })

    })


    // ── 重建種子與重啟（E3／E4／E5）────────────────────────────────────────────────────────
    describe('reseedBackend／restartBackend', function() {

        it('reseed：殺自建並以 exit 回驗→移開→種子→以目前設定起新後端（M3-1）', async function() {
            let w = makeWorld()
            let h = makeHarness(w)
            await h.startServersOnce({ backendOnly: true })
            let old = w.childOf('backend')[0]
            w.calls.length = 0
            await h.reseedBackend()
            assert.deepStrictEqual(names(w.calls).filter((n) => n !== 'rm'), ['kill', 'moveDb', 'seed', 'spawnBackend'])
            assert.strictEqual(w.calls[0][1], String(old.pid))
            assert.strictEqual(old.signalCode, 'SIGKILL')
            assert.deepStrictEqual(h.state().unexpectedExits, [], '被 reseed 殺掉屬預期')
        })

        it('reseed withArchivedTask：base 之後再寫封存種子（M3-5）', async function() {
            let w = makeWorld()
            let h = makeHarness(w)
            await h.startServersOnce({ backendOnly: true })
            w.calls.length = 0
            await h.reseedBackend({ withArchivedTask: true })
            assert.deepStrictEqual(w.calls.filter((c) => c[0] === 'seed').map((c) => c[1]), ['base', 'archived'])
        })

        it('R1：殺掉自建後端後、查 port 前有他者搶佔 → 拋錯，不殺他者、不動資料庫（M3-4）', async function() {
            let w = makeWorld()
            let h = makeHarness(w)
            await h.startServersOnce({ backendOnly: true })
            w.onKill = () => { w.onKill = null; w.foreign(BACKEND, 999) }
            w.calls.length = 0
            await assert.rejects(h.reseedBackend(), (e) => /非本 harness 啟動之行程佔用/.test(e.message) && /PID 999/.test(e.message))
            assert.ok(!w.calls.some((c) => c[0] === 'kill' && c[1] === '999'))
            assert.strictEqual(count(w.calls, 'moveDb'), 0)
        })

        it('R1：查 port 之後、起新後端之前才有他者搶佔（競態）→ 由就緒後之所有權驗證攔下，殺自建、不殺他者（M3-4′）', async function() {
            let w = makeWorld()
            let h = makeHarness(w)
            await h.startServersOnce({ backendOnly: true })
            w.seedPlan.base = 'deferred'
            w.calls.length = 0
            let p = h.reseedBackend()
            for (let i = 0; i < 20 && !w.calls.some((c) => c[0] === 'seed'); i++) { await tick() }
            w.foreign(BACKEND, 998)
            w.release('base')
            await assert.rejects(p, (e) => /PID 998/.test(e.message))
            assert.ok(!w.calls.some((c) => c[0] === 'kill' && c[1] === '998'), '不得殺他者')
            assert.strictEqual(aliveOwn(w, 'backend').length, 0, '搶不到 port 之自建後端應被殺（不留殭屍）')
        })

        it('R1（資料）：測試資料庫被持有 → 拋錯並指認疑似持有者，未刪任何檔、不種子、不起後端（A-1 Opus B）', async function() {
            let w = makeWorld()
            let h = makeHarness(w)
            await h.startServersOnce({ backendOnly: true })
            w.dbHeld = true
            w.holders = ['PID 31 node C:\\P\\srv.mjs x']
            w.calls.length = 0
            await assert.rejects(h.reseedBackend(), (e) => /未刪除任何檔案/.test(e.message) && /PID 31 node/.test(e.message))
            assert.strictEqual(count(w.calls, 'seed'), 0)
            assert.strictEqual(count(w.calls, 'spawnBackend'), 0)
        })

        it('X5：自建後端殺不掉 → 拋錯且保留記錄；之後佔用訊息指明為自建殘留而非他者（A-6 Opus A／A-3 Sol）', async function() {
            let w = makeWorld()
            w.backendPlan = ['unkillable']
            let h = makeHarness(w)
            await h.startServersOnce({ backendOnly: true })
            await assert.rejects(h.reseedBackend(), /殺後 30ms 仍未結束/)
            assert.strictEqual(h.state().spawned.length, 1, '殺不掉者保留記錄')
            await assert.rejects(h.reseedBackend(), /殺後 30ms 仍未結束/)
        })

        it('R5：restartBackend(自訂設定) 之後 reseed 沿用該設定；restartBackend() 還原 e2e 預設（A-14 Opus A）', async function() {
            let w = makeWorld()
            let h = makeHarness(w)
            await h.startServersOnce({ backendOnly: true })
            await h.restartBackend('custom.json')
            await h.reseedBackend()
            await h.restartBackend()
            let spawns = w.calls.filter((c) => c[0] === 'spawnBackend').map((c) => c[1])
            assert.deepStrictEqual(spawns, [E2E, 'custom.json', 'custom.json', E2E])
            assert.strictEqual(count(w.calls, 'seed'), 2, 'restart 不重建種子；首次啟動與 reseed 各一次')
        })

        it('restartBackend：設定檔之 serverPort 與 harness port 不符、或讀不到 → 拋錯且不殺現有後端（D-13 Opus A）', async function() {
            let w = makeWorld()
            w.settingsPorts = { 'other-port.json': 11008, 'missing.json': 'ENOENT' }
            let h = makeHarness(w)
            await h.startServersOnce({ backendOnly: true })
            w.calls.length = 0
            await assert.rejects(h.restartBackend('other-port.json'), /serverPort=11008 與 harness 後端 port 11108 不符/)
            await assert.rejects(h.restartBackend('missing.json'), /ENOENT/)
            assert.ok(!w.calls.some((c) => c[0] === 'kill'))
        })

        it('序列化：兩次 reseed 並發時不交錯，後者於前者起好後端之後才開始殺（A-2／A-3／D-3）', async function() {
            let w = makeWorld()
            let h = makeHarness(w)
            await h.startServersOnce({ backendOnly: true })
            w.calls.length = 0
            w.seedPlan.base = 'deferred'
            let p1 = h.reseedBackend()
            let p2 = h.reseedBackend()
            for (let i = 0; i < 20 && !w.calls.some((c) => c[0] === 'seed'); i++) { await tick() }
            assert.strictEqual(count(w.calls, 'kill'), 1, '後者尚未開始')
            w.release('base')
            for (let i = 0; i < 40 && count(w.calls, 'seed') < 2; i++) { await tick() }
            w.release('base')
            await Promise.all([p1, p2])
            let seq = names(w.calls).filter((n) => n !== 'rm')
            assert.deepStrictEqual(seq, ['kill', 'moveDb', 'seed', 'spawnBackend', 'kill', 'moveDb', 'seed', 'spawnBackend'])
        })

        it('cleanup 中止進行中之 reseed：種子子行程被殺，cleanup 之後不再起任何行程（A-2 Opus B／A-3 Opus A）', async function() {
            let w = makeWorld()
            let h = makeHarness(w)
            await h.startServersOnce({ backendOnly: true })
            w.seedPlan.base = 'deferred'
            w.calls.length = 0
            let p = h.reseedBackend()
            for (let i = 0; i < 20 && !w.calls.some((c) => c[0] === 'seed'); i++) { await tick() }
            assert.ok(w.calls.some((c) => c[0] === 'seed'), '應已進行到種子步驟')
            let seedChild = w.childOf('seed').slice(-1)[0]
            let before = count(w.calls, 'spawnBackend')
            h.cleanup()
            assert.ok(w.calls.some((c) => c[0] === 'kill' && c[1] === String(seedChild.pid)), '種子子行程納入 cleanup')
            w.release('base')
            await assert.rejects(p, (e) => e instanceof Cancelled)
            assert.strictEqual(count(w.calls, 'spawnBackend'), before, 'cleanup 之後不得再起後端')
        })

    })


    // ── 非預期結束與收尾（T1-T5、R2）──────────────────────────────────────────────────────
    describe('非預期結束、cleanup、teardown', function() {

        it('自建後端於就緒後非預期結束 → 記錄並警告；下次 startServersOnce 重建；teardown 判失敗（A-7 Sol／A-13 Opus A）', async function() {
            let w = makeWorld()
            let h = makeHarness(w)
            await h.startServersOnce({ backendOnly: true })
            w.childOf('backend')[0].die(3)
            await tick()
            assert.strictEqual(h.state().unexpectedExits.length, 1)
            assert.ok(w.logs.some((l) => /非預期結束（code=3/.test(l)))
            await h.startServersOnce({ backendOnly: true })
            assert.strictEqual(count(w.calls, 'spawnBackend'), 2)
            await assert.rejects(h.teardown(), /於測試期間非預期結束（code=3/)
        })

        it('cleanup：同步殺全部自建（含前端）、重置狀態、釋放互斥、清中介檔；teardown 回驗通過（M5-1）', async function() {
            let w = makeWorld()
            let h = makeHarness(w)
            await h.startServersOnce()
            w.calls.length = 0
            await h.teardown()
            assert.strictEqual(count(w.calls, 'kill'), 2)
            assert.ok(names(w.calls).includes('unlock'))
            assert.ok(names(w.calls).includes('afterCleanup'))
            let st = h.state()
            assert.deepStrictEqual(st.spawned, [])
            assert.strictEqual(st.lockHeld, false)
            assert.strictEqual(st.activeSettings, E2E)
        })

        it('cleanup：殺不掉之自建行程於同步回驗上限後警告殘留（R2 回驗，D-8 Opus B）；teardown 判失敗', async function() {
            let w = makeWorld()
            w.backendPlan = ['unkillable']
            let h = makeHarness(w)
            await h.startServersOnce({ backendOnly: true })
            await assert.rejects(h.teardown(), /未結束/)
            assert.ok(w.logs.some((l) => /cleanup 後 500ms 仍有殘留/.test(l)))
        })

        it('cleanup 冪等：無自建行程時不殺任何行程、不報錯', function() {
            let w = makeWorld()
            let h = makeHarness(w)
            h.cleanup()
            h.cleanup()
            assert.strictEqual(count(w.calls, 'kill'), 0)
        })

    })

})
