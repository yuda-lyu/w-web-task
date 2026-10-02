//unit-harnessProc：test/tools/harnessProc.mjs（e2e／api harness 之 OS 層 helper）單元測試（不需 server/browser）。
//對應 harness 行程所有權規則（test/tools/e2e-setup.mjs 檔頭；test/tools/harnessLifecycle.mjs）：
//  R1 不越權：只殺自建且仍存活之 child；判定 port 佔用以監聽列與 TCP 連線為準；不毀損他人持有之資料（先移開、有人持有即整體失敗）。
//  R2 不失職（清理）：殺行程為同步 taskkill /F /T（exit／SIGINT／SIGTERM 路徑才殺得完），以 exit 事件或 PID 回驗。
//  R3 不失職（重建種子）：種子子行程須印完成標記並真正關閉；catch 字樣即失敗；計時器不拖住行程。
//  R6 可診斷：錯誤訊息含 PID 與命令列（或映像名）、子行程輸出（開頭＋結尾）。
//除「isPortListening 真實 socket」「runUntilMarker 真實子行程」「acquirePortLock 真實 socket」外皆以注入之假依賴執行，
//不碰 harness 使用中之 port 與行程（npm test 中本檔於 e2e 之後執行，此時 harness 之服務仍在）。
//模組以 before 動態載入：模組不存在時各案各自失敗（紅燈可逐列辨識），而非整檔載入錯誤。
import assert from 'assert'
import http from 'http'
import net from 'net'
import { EventEmitter } from 'events'
import { spawn } from 'child_process'


//netstat -ano 樣本（資料列取自本機實測格式；表頭於中文 Windows 為 cp950 在地化文字，以 utf8 讀入即為亂碼）
const NETSTAT = [
    '',
    '\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD',
    '',
    '  \uFFFD\uFFFD\uFFFD   \uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD               \uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD               \uFFFD\uFFFD\uFFFD\uFFFD            PID',
    '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1412',
    '  TCP    0.0.0.0:11108          0.0.0.0:0              LISTENING       15816',
    '  TCP    0.0.0.0:21108          0.0.0.0:0              LISTENING       2222',
    '  TCP    127.0.0.1:53211        127.0.0.1:11108        ESTABLISHED     3333',
    '  TCP    127.0.0.1:11108        127.0.0.1:53211        ESTABLISHED     15816',
    '  TCP    [::]:11108             [::]:0                 LISTENING       15816',
    '  TCP    [::1]:8091             [::]:0                 LISTENING       4444',
    '  TCP    [fe80::1%12]:9100      [::]:0                 LISTENING       6666',
    '  TCP    0.0.0.0:9200           0.0.0.0:0              ABHÖREN         7777',
    '  UDP    0.0.0.0:11108          *:*                                    5555',
].join('\r\n')


describe('unit-harnessProc（e2e／api harness 之 OS 層 helper）', function() {
    this.timeout(30000)

    let m = null
    let loadErr = null
    before(async function() {
        try {
            m = await import('./tools/harnessProc.mjs')
        }
        catch (err) {
            loadErr = err
        }
    })

    //fn: 取模組之具名匯出；模組不存在或無此匯出即以明確訊息失敗
    let fn = (name) => {
        assert.ok(m, `test/tools/harnessProc.mjs 無法載入: ${loadErr && (loadErr.code || loadErr.name)}`)
        assert.strictEqual(typeof m[name], 'function', `test/tools/harnessProc.mjs 應匯出函數 ${name}`)
        return m[name]
    }

    //假 child：只帶 isChildAlive／killOwnTree 用得到之欄位
    let fakeChild = (o = {}) => {
        let c = Object.assign(new EventEmitter(), { pid: 123, exitCode: null, signalCode: null, killed: [], ...o })
        c.kill = (sig) => { c.killed.push(sig) }
        return c
    }

    //記錄呼叫之假 exec
    let makeExec = (impl) => {
        let calls = []
        let exec = (cmd, opt) => {
            calls.push(cmd)
            return impl(cmd, opt)
        }
        return { exec, calls }
    }


    // ── parseListenerPids（R1：只認本地位址為該 port 之監聽列；監聽之判定不依賴在地化狀態字）──────
    describe('parseListenerPids', function() {

        it('IPv4 與 IPv6 之監聽列皆取到，同一 PID 去重', function() {
            //後端以 :: 雙堆疊監聽（2026-09-27 實測 EADDRINUSE 訊息為 :::port），須涵蓋 0.0.0.0:port 與 [::]:port
            assert.deepStrictEqual(fn('parseListenerPids')(NETSTAT, 11108), ['15816'])
        })

        it('外部位址為 :port 之連線列、其他 port、UDP 列皆不算', function() {
            let pids = fn('parseListenerPids')(NETSTAT, 11108)
            assert.ok(!pids.includes('3333'), '外部位址 :11108 之連線列（client 端）不可算')
            assert.ok(!pids.includes('2222'), ':21108 不可算')
            assert.ok(!pids.includes('5555'), 'UDP 列不可算')
        })

        it('IPv6 迴路位址、zone id、在地化狀態字（以外部位址判定監聽）皆取得到', function() {
            assert.deepStrictEqual(fn('parseListenerPids')(NETSTAT, 8091), ['4444'])
            assert.deepStrictEqual(fn('parseListenerPids')(NETSTAT, 9100), ['6666'])
            assert.deepStrictEqual(fn('parseListenerPids')(NETSTAT, 9200), ['7777'], '狀態字被在地化（ABHÖREN）時仍以外部位址 0.0.0.0:0 判定為監聽')
        })

        it('在地化表頭、空字串、undefined 回 []', function() {
            assert.deepStrictEqual(fn('parseListenerPids')(NETSTAT, 9999), [])
            assert.deepStrictEqual(fn('parseListenerPids')('', 11108), [])
            assert.deepStrictEqual(fn('parseListenerPids')(undefined, 11108), [])
        })

    })


    // ── listenerPids（無人回 []、工具不可用回 null，兩者須可區分）──────────────────────────
    describe('listenerPids', function() {

        it('win32：以 netstat -ano（不加 -p TCP）取得並解析，且帶逾時', function() {
            let opts = []
            let { exec, calls } = makeExec((cmd, opt) => { opts.push(opt); return NETSTAT })
            assert.deepStrictEqual(fn('listenerPids')(11108, { exec, platform: 'win32' }), ['15816'])
            assert.deepStrictEqual(calls, ['netstat -ano'])
            assert.ok(opts[0].timeout > 0, 'execSync 須帶 timeout（exit 處理器內卡住會使行程無法結束）')
        })

        it('win32：netstat 失敗回 null（非 []）', function() {
            let { exec } = makeExec(() => { throw new Error('ENOENT') })
            assert.strictEqual(fn('listenerPids')(11108, { exec, platform: 'win32' }), null)
        })

        it('posix：lsof 輸出之 PID 去重；exit 1（查無）回 []，其他失敗回 null', function() {
            let { exec, calls } = makeExec(() => '123\n456\n123\n')
            assert.deepStrictEqual(fn('listenerPids')(11108, { exec, platform: 'linux' }), ['123', '456'])
            assert.strictEqual(calls[0], 'lsof -nP -iTCP:11108 -sTCP:LISTEN -t')
            let e1 = Object.assign(new Error('exit 1'), { status: 1 })
            let e127 = Object.assign(new Error('not found'), { status: 127 })
            assert.deepStrictEqual(fn('listenerPids')(11108, { exec: () => { throw e1 }, platform: 'linux' }), [])
            assert.strictEqual(fn('listenerPids')(11108, { exec: () => { throw e127 }, platform: 'linux' }), null)
        })

    })


    // ── isPortListening（R1／R3：以 TCP 連線判定有無監聽，與 HTTP 健康無關；逾時視為佔用）──────
    describe('isPortListening', function() {

        let makeConnect = (plan) => {
            let calls = []
            let connect = (port, host) => {
                calls.push(`${host}:${port}`)
                let s = new EventEmitter()
                s.destroy = () => {}
                let what = plan[host]
                if (what === 'connect') { setImmediate(() => s.emit('connect')) }
                else if (what === 'refused') { setImmediate(() => s.emit('error', Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }))) }
                return s
            }
            return { connect, calls }
        }

        it('127.0.0.1 或 ::1 任一可連即為監聽中；兩者皆拒絕即為無人', async function() {
            let a = makeConnect({ '127.0.0.1': 'refused', '::1': 'connect' })
            assert.strictEqual(await fn('isPortListening')(11108, { connect: a.connect }), true)
            assert.deepStrictEqual(a.calls.sort(), ['127.0.0.1:11108', '::1:11108'])
            let b = makeConnect({ '127.0.0.1': 'refused', '::1': 'refused' })
            assert.strictEqual(await fn('isPortListening')(11108, { connect: b.connect }), false)
        })

        it('連線逾時（佔用者不 accept）視為佔用', async function() {
            let c = makeConnect({ '127.0.0.1': 'hang', '::1': 'refused' })
            assert.strictEqual(await fn('isPortListening')(11108, { connect: c.connect, timeoutMs: 100 }), true)
        })

        it('真實 socket：回 500 之 HTTP 服務仍判定為監聽中；關閉後判定為無人', async function() {
            //舊碼以 httpOk（status<500）判定 port 空：佔用者回 5xx 會被當成空 port 而先刪庫
            let srv = http.createServer((q, s) => { s.statusCode = 500; s.end('err') })
            await new Promise((r) => srv.listen(0, '127.0.0.1', r))
            let port = srv.address().port
            assert.strictEqual(await fn('isPortListening')(port), true)
            await new Promise((r) => srv.close(r))
            assert.strictEqual(await fn('isPortListening')(port), false)
        })

    })


    // ── isOwnedBy（R3：port 之監聽者集合須恰為自建 PID）──────────────────────────────────────
    describe('isOwnedBy', function() {

        it('只有自建 PID 才算；混有他者、空清單、null 皆不算', function() {
            let own = fn('isOwnedBy')
            assert.strictEqual(own(['15816'], 15816), true)
            assert.strictEqual(own(['15816', '15816'], '15816'), true)
            assert.strictEqual(own(['15816', '9148'], 15816), false, '他者綁 127.0.0.1、自建綁 :: 並存時，打 127.0.0.1 可能落到他者')
            assert.strictEqual(own([], 15816), false)
            assert.strictEqual(own(null, 15816), false)
        })

    })


    // ── isChildAlive / waitChildExit / pidExists（R2：以事件或 PID 回驗真的結束）──────────────
    describe('isChildAlive／waitChildExit／pidExists', function() {

        it('isChildAlive：exitCode 與 signalCode 皆為 null 才算存活', function() {
            let alive = fn('isChildAlive')
            assert.strictEqual(alive(fakeChild()), true)
            assert.strictEqual(alive(fakeChild({ exitCode: 0 })), false)
            assert.strictEqual(alive(fakeChild({ signalCode: 'SIGKILL' })), false)
            assert.strictEqual(alive(null), false)
        })

        it('waitChildExit：已結束者立即 true；存活者待 exit 事件；逾時回 false 且不留 listener', async function() {
            let wait = fn('waitChildExit')
            assert.strictEqual(await wait(fakeChild({ exitCode: 0 }), 50), true)
            let c = fakeChild()
            setTimeout(() => { c.exitCode = 1; c.emit('exit', 1, null) }, 30)
            assert.strictEqual(await wait(c, 1000), true)
            let d = fakeChild()
            assert.strictEqual(await wait(d, 50), false, '殺不掉者須回 false，呼叫端據此拋錯而不當成已釋放')
            assert.strictEqual(d.listenerCount('exit'), 0)
        })

        it('pidExists：kill(pid,0) 成功為存在、ESRCH 為不存在、EPERM 為存在（無權限）', function() {
            let exists = fn('pidExists')
            assert.strictEqual(exists(1, { kill: () => true }), true)
            assert.strictEqual(exists(1, { kill: () => { throw Object.assign(new Error('x'), { code: 'ESRCH' }) } }), false)
            assert.strictEqual(exists(1, { kill: () => { throw Object.assign(new Error('x'), { code: 'EPERM' }) } }), true)
            assert.strictEqual(exists(process.pid), true, '本行程存在')
        })

    })


    // ── killOwnTree（R1：只殺自建且存活者；R2：同步樹狀殺）─────────────────────────────────────
    describe('killOwnTree', function() {

        it('已結束或無 PID 之 child 不下殺（其 PID 可能已被回收給無關行程）', function() {
            let { exec, calls } = makeExec(() => '')
            assert.strictEqual(fn('killOwnTree')(fakeChild({ exitCode: 0 }), { exec, platform: 'win32' }), false)
            assert.strictEqual(fn('killOwnTree')(fakeChild({ pid: undefined }), { exec, platform: 'win32' }), false)
            assert.deepStrictEqual(calls, [])
        })

        it('win32：存活者以同步 taskkill /F /T /PID <自建 pid> 殺整棵樹，且帶逾時', function() {
            let opts = []
            let { exec, calls } = makeExec((cmd, opt) => { opts.push(opt); return '' })
            assert.strictEqual(fn('killOwnTree')(fakeChild({ pid: 777 }), { exec, platform: 'win32' }), true)
            assert.deepStrictEqual(calls, ['taskkill /F /T /PID 777'])
            assert.ok(opts[0].timeout > 0)
        })

        it('win32：taskkill 失敗不拋錯（由呼叫端回驗）', function() {
            let { exec } = makeExec(() => { throw new Error('128') })
            assert.strictEqual(fn('killOwnTree')(fakeChild(), { exec, platform: 'win32' }), true)
        })

        it('posix：先殺行程群組，失敗再退回 child.kill(SIGKILL)', function() {
            let groups = []
            let ok = fakeChild({ pid: 55 })
            fn('killOwnTree')(ok, { platform: 'linux', killGroup: (pid) => { groups.push(pid) } })
            assert.deepStrictEqual(groups, [55])
            assert.deepStrictEqual(ok.killed, [])
            let fallback = fakeChild({ pid: 66 })
            fn('killOwnTree')(fallback, { platform: 'linux', killGroup: () => { throw new Error('ESRCH') } })
            assert.deepStrictEqual(fallback.killed, ['SIGKILL'])
        })

    })


    // ── moveAwayDir／rmDirBestEffort（R1：不毀損他人持有之資料；R3：刪不掉即大聲失敗）──────────
    describe('moveAwayDir／rmDirBestEffort', function() {

        //假檔案系統＋假時鐘：plan 依序決定每次 rename 之結果（'ok'／'eperm'／'einval'）；sleep 推進假時鐘
        let makeFs = (plan, present = true) => {
            let renames = 0
            let sleeps = []
            let clock = 0
            let mkdirs = []
            let rename = () => {
                let step = plan[Math.min(renames, plan.length - 1)]
                renames++
                if (step === 'ok') { present = false; return }
                throw Object.assign(new Error(`${step.toUpperCase()}, fake`), { code: step.toUpperCase() })
            }
            return {
                rename,
                exists: () => present,
                mkdir: (d) => { mkdirs.push(d) },
                sleep: async (ms) => { sleeps.push(ms); clock += ms },
                now: () => clock,
                get renames() { return renames },
                sleeps,
                mkdirs,
            }
        }

        it('目錄不存在：不移動、不等待', async function() {
            let f = makeFs(['ok'], false)
            let r = await fn('moveAwayDir')('X:/root/db', 'X:/trash/db-1', f)
            assert.deepStrictEqual(r, { moved: false, attempts: 0, waitedMs: 0 })
            assert.strictEqual(f.renames, 0)
        })

        it('首次即移開：建立 trash 父目錄、不等待', async function() {
            let f = makeFs(['ok'])
            let r = await fn('moveAwayDir')('X:/root/db', 'X:/trash/db-1', f)
            assert.strictEqual(r.moved, true)
            assert.strictEqual(r.attempts, 1)
            assert.deepStrictEqual(f.sleeps, [])
            assert.strictEqual(f.mkdirs.length, 1)
        })

        it('持有者釋放前 EPERM，釋放後成功：重試到成功並回報次數', async function() {
            //剛被殺之後端尚未釋放 lmdb 時 rename 失敗；重試不具破壞性（rename 失敗不動任何檔案，2026-09-27 實測）
            let f = makeFs(['eperm', 'eperm', 'ok'])
            let r = await fn('moveAwayDir')('X:/root/db', 'X:/trash/db-1', { ...f, intervalMs: 500 })
            assert.strictEqual(r.moved, true)
            assert.strictEqual(r.attempts, 3)
            assert.strictEqual(r.waitedMs, 1000)
        })

        it('持續 EPERM：到截止時間拋 EHELD，訊息含目錄與錯誤碼', async function() {
            let f = makeFs(['eperm'])
            await assert.rejects(
                fn('moveAwayDir')('X:/root/db', 'X:/trash/db-1', { ...f, deadlineMs: 1000, intervalMs: 500 }),
                (err) => err.code === 'EHELD' && /X:\/root\/db/.test(err.message) && /EPERM/.test(err.message) && err.attempts === 3,
            )
        })

        it('非暫時性錯誤：不重試，立即拋 EHELD', async function() {
            let f = makeFs(['einval'])
            await assert.rejects(fn('moveAwayDir')('X:/root/db', 'X:/trash/db-1', f), (err) => err.code === 'EHELD' && /EINVAL/.test(err.message))
            assert.strictEqual(f.renames, 1)
        })

        it('rmDirBestEffort：刪除失敗不拋錯，回傳是否已不存在', function() {
            assert.strictEqual(fn('rmDirBestEffort')('X:/t', { rm: () => { throw new Error('EPERM') }, exists: () => true }), false)
            assert.strictEqual(fn('rmDirBestEffort')('X:/t', { rm: () => {}, exists: () => false }), true)
        })

    })


    // ── makeOutBuf（R6：錯誤訊息保留開頭與結尾，濾除 webpack 進度列）─────────────────────────
    describe('makeOutBuf', function() {

        it('去 ANSI 控制碼；濾除 webpack 進度列（[N%] …）與 Build finished 雜訊行（2026-09-27 實測格式）', function() {
            let b = fn('makeOutBuf')()
            b.push(' INFO  Starting development server...\n\u001b[2K\u001b[1A\u001b[2K\u001b[G[3%] setup (watch run)\n\u001b[2K\u001b[1A\u001b[2K\u001b[G[98%] after emitting\n')
            b.push('Build finished at 17:36:01 by 0.000s\n WARNING  Compiled with 1 warning\n  App running at:\n  - Local:   http://localhost:8091/ \n')
            let t = b.text()
            assert.ok(!/\u001b/.test(t), 'ANSI 控制碼應被去除')
            assert.ok(!/\[3%\]|\[98%\]/.test(t), '進度列應被濾除')
            assert.ok(!/Build finished/.test(t), '雜訊行應被濾除')
            assert.ok(/Starting development server/.test(t))
            assert.ok(/Local:\s+http:\/\/localhost:8091/.test(b.recent()))
        })

        it('長輸出保留開頭與結尾（中間省略）', function() {
            let b = fn('makeOutBuf')({ headMax: 10, tailMax: 20 })
            b.push('HEAD-START' + 'x'.repeat(100) + 'TAIL-END')
            let t = b.text()
            assert.ok(t.startsWith('HEAD-START'))
            assert.ok(t.endsWith('TAIL-END'))
            assert.ok(/中略/.test(t))
        })

    })


    // ── runUntilMarker（R3：未見完成標記即結束／catch 字樣／逾時皆失敗；完成後等關閉、清計時器）────
    describe('runUntilMarker（真實子行程）', function() {

        let spawnSpy = () => {
            let children = []
            let spawnFn = (cmd, args, opt) => {
                let c = spawn(cmd, args, opt)
                children.push(c)
                return c
            }
            return { spawnFn, children }
        }

        it('印出 finish. 後結束子行程，且等它真正關閉才完成（回傳輸出尾段）；onSpawn 收到 child', async function() {
            //種子子行程須真正關閉（釋放 lmdb）後才輪到下一個 DB 使用者；不得只送出 kill 就放行
            let s = spawnSpy()
            let seen = []
            let tail = await fn('runUntilMarker')(process.execPath, ['-e', 'console.log("clear dbf warn x"); console.log("finish."); setInterval(() => {}, 1000)'], { spawnFn: s.spawnFn, timeoutMs: 10000, onSpawn: (c) => seen.push(c) })
            let c = s.children[0]
            assert.ok(c.exitCode !== null || c.signalCode !== null, 'resolve 當下子行程應已結束')
            assert.strictEqual(seen[0], c)
            assert.ok(/clear dbf warn/.test(tail), '回傳輸出尾段，供呼叫端檢查警告字樣')
        })

        it('完成標記分兩段輸出也認得', async function() {
            await fn('runUntilMarker')(process.execPath, ['-e', 'process.stdout.write("fin"); setTimeout(() => { process.stdout.write("ish.\\n") }, 200); setInterval(() => {}, 1000)'], { timeoutMs: 10000 })
        })

        it('未印 finish. 即結束（崩潰）：reject，訊息含結束碼與輸出尾段', async function() {
            //舊碼 seedDb 於子行程結束即 resolve，崩潰被當成功而以空庫起後端
            await assert.rejects(
                fn('runUntilMarker')(process.execPath, ['-e', 'console.log("boom-tail"); process.exit(3)'], { timeoutMs: 10000, label: 'seedDb' }),
                (err) => /seedDb/.test(err.message) && /code=3/.test(err.message) && /boom-tail/.test(err.message),
            )
        })

        it('腳本自行 catch 後不退出（印 catch 字樣）：立即 reject，不空等逾時', async function() {
            //g.initialData.mjs 與 seed-archived-task.mjs 之 catch 只印字、lmdb 卡住 event loop 不退出
            let t0 = Date.now()
            await assert.rejects(
                fn('runUntilMarker')(process.execPath, ['-e', 'console.log("initialData catch", "x"); setInterval(() => {}, 1000)'], { timeoutMs: 20000, failMarkers: ['initialData catch'] }),
                /initialData catch/,
            )
            assert.ok(Date.now() - t0 < 10000, '應立即失敗')
        })

        it('逾時：reject 並結束子行程', async function() {
            let s = spawnSpy()
            await assert.rejects(
                fn('runUntilMarker')(process.execPath, ['-e', 'console.log("waiting"); setInterval(() => {}, 1000)'], { spawnFn: s.spawnFn, timeoutMs: 800 }),
                (err) => /逾時/.test(err.message) && /waiting/.test(err.message),
            )
            await new Promise((r) => { let c = s.children[0]; if (c.exitCode !== null || c.signalCode !== null) r(); else c.on('exit', r) })
        })

        it('指令不存在：reject（無法啟動）', async function() {
            await assert.rejects(fn('runUntilMarker')('no-such-command-zz-e2e', [], { timeoutMs: 5000 }), /無法啟動|ENOENT/)
        })

        it('完成後不留計時器拖住呼叫端（舊碼之 60 秒計時器未清除，直跑行程於重建種子後最多再拖 60 秒）', async function() {
            let modUrl = new URL('./tools/harnessProc.mjs', import.meta.url).href
            let child = spawn(process.execPath, ['--input-type=module', '-e', [
                `import { runUntilMarker } from ${JSON.stringify(modUrl)}`,
                'let t0 = Date.now()',
                "await runUntilMarker(process.execPath, ['-e', 'console.log(\"finish.\"); setInterval(() => {}, 1000)'], { timeoutMs: 60000 })",
                "process.on('exit', () => console.log('EXITMS=' + (Date.now() - t0)))",
            ].join('\n')], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] })
            let out = ''
            child.stdout.on('data', (d) => { out += d })
            child.stderr.on('data', (d) => { out += d })
            await new Promise((r) => child.on('close', r))
            let mm = out.match(/EXITMS=(\d+)/)
            assert.ok(mm, `子行程應正常結束並印出耗時：${out}`)
            assert.ok(Number(mm[1]) < 10000, `完成後應立即可結束（實際 ${mm[1]}ms）`)
        })

    })


    // ── describeProcs／findNodeProcsByCommandLine（R6：錯誤訊息指認行程；只讀）─────────────────
    describe('describeProcs／findNodeProcsByCommandLine', function() {

        let cimJson = (rows) => JSON.stringify(rows.length === 1 ? rows[0] : rows)

        it('win32：以 CIM 取命令列（UTF-8 JSON），單筆與多筆皆可', function() {
            let { exec, calls } = makeExec(() => cimJson([
                { ProcessId: 1234, Name: 'node.exe', CommandLine: 'node srv.mjs C:\\開源\\x\\test\\e2e-settings.json' },
                { ProcessId: 5678, Name: 'node.exe', CommandLine: 'node vue-cli-service.js serve' },
            ]))
            let d = fn('describeProcs')(['1234', '5678'], { exec, platform: 'win32' })
            assert.strictEqual(d, 'PID 1234 node srv.mjs C:\\開源\\x\\test\\e2e-settings.json、PID 5678 node vue-cli-service.js serve')
            assert.ok(/^powershell -NoProfile -NonInteractive -EncodedCommand /.test(calls[0]), '以 EncodedCommand 傳腳本（免跳脫）')
        })

        it('win32：CIM 失敗時退回 tasklist 映像名；再失敗只附 PID', function() {
            let exec = (cmd) => {
                if (cmd.startsWith('powershell')) throw new Error('CIM unavailable')
                if (cmd.includes('PID eq 1234')) return '"node.exe","1234","Console","1","45,000 K"\r\n'
                throw new Error('fail')
            }
            assert.strictEqual(fn('describeProcs')(['1234', '5678'], { exec, platform: 'win32' }), 'PID 1234 node.exe、PID 5678')
        })

        it('posix 與空清單', function() {
            assert.strictEqual(fn('describeProcs')(['9'], { platform: 'linux' }), 'PID 9')
            assert.strictEqual(fn('describeProcs')([], { platform: 'win32' }), '')
        })

        it('findNodeProcsByCommandLine：只列命令列含指定字串者（不分大小寫），排除指定 PID；非 win32 回 null', function() {
            let { exec } = makeExec(() => cimJson([
                { ProcessId: 11, Name: 'node.exe', CommandLine: 'node C:\\P\\srv.mjs C:\\P\\test\\_tmp\\e2e-harness\\settings.json' },
                { ProcessId: 22, Name: 'node.exe', CommandLine: 'node other-project\\srv.mjs' },
                { ProcessId: 33, Name: 'node.exe', CommandLine: 'node C:\\P\\TEST\\_tmp\\E2E-HARNESS\\x' },
            ]))
            let r = fn('findNodeProcsByCommandLine')('c:\\p\\test\\_tmp\\e2e-harness', { exec, platform: 'win32', excludePids: [33] })
            assert.deepStrictEqual(r, ['PID 11 node C:\\P\\srv.mjs C:\\P\\test\\_tmp\\e2e-harness\\settings.json'])
            assert.strictEqual(fn('findNodeProcsByCommandLine')('x', { platform: 'linux' }), null)
        })

    })


    // ── acquirePortLock／releasePortLock（跨行程互斥：同專案同時只允許一個 harness；行程死亡由 OS 釋放）──
    describe('acquirePortLock／releasePortLock（真實 socket）', function() {

        it('port 已被佔用即拋 ELOCKED（附持有者描述）；釋放後可再取得', async function() {
            //以 OS 配發之空 port 模擬「另一個 harness 持有互斥 port」
            let other = net.createServer()
            await new Promise((r) => other.listen(0, '127.0.0.1', r))
            let port = other.address().port
            await assert.rejects(
                fn('acquirePortLock')(port, { describeHolder: () => 'PID 999 node mocha' }),
                (err) => err.code === 'ELOCKED' && /PID 999 node mocha/.test(err.message) && new RegExp(String(port)).test(err.message),
            )
            await new Promise((r) => other.close(r))
            let lock = await fn('acquirePortLock')(port)
            await assert.rejects(fn('acquirePortLock')(port), (err) => err.code === 'ELOCKED', '持有期間第二次取得亦失敗')
            fn('releasePortLock')(lock)
            await new Promise((r) => setTimeout(r, 50))
            let again = await fn('acquirePortLock')(port)
            fn('releasePortLock')(again)
        })

    })

})
