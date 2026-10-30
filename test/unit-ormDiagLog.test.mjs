//unit-ormDiagLog: w-serv-orm 診斷輸出(opt.funLog, w-serv-orm ≥ 1.1.22)經 wsemi genDiagFunLog 導入本套件 srLog 之接線測試
//  (server/WWebTask.mjs 之 funLog 運算式; spec/設計要點與取捨.md D21; 規則帳本 R-ORMDIAG-01～05; 規則本體 wsemi R-DIAG-01、dspec 診斷輸出與遮罩)
//  形態類案(label 控制字元、safe 之 bigint / 循環 / 上限、rejected promise、write 同步拋錯)由 wsemi 共用語料 _diagCases 之 genDiagFunLog 組(A01～A10)驅動, 經正式站點之運算式執行;
//  本檔其餘為接線案: 運算式本身(OD-S)、以 srLog 呼叫(OD-U)、真實 w-serv-orm + lmdb 之端到端(OD-I)、srLog 寫入失敗(OD-W).
//  R-ORMDIAG-01「funLog 只把 label 與 safe 寫入 srLog.warn({ event:'orm-diag', label, safe }); 不寫 console」→ OD-U-01、OD-U-03、OD-I-01～07 之 console 零輸出
//  R-ORMDIAG-02「detail(含主鍵、email、錯誤原文、憑證)不取用、不寫入日誌」→ OD-U-02、OD-U-09; OD-I-01～07 以真實 w-serv-orm 觸發, 日誌全文不含標記、錯誤原文與憑證
//  R-ORMDIAG-03「日誌寫入失敗不得影響原流程(含 srLog.warn 回傳 rejected promise 不成未處理拒絕)」→ OD-U-06、OD-W-01、OD-I-08、語料 A04、A06
//  R-ORMDIAG-04「不改 w-serv-orm 之其他選項與行為」→ OD-I-01～07 之 procOrm 拒收值與未帶 funLog 之實例逐項相同
//  R-ORMDIAG-05「事件名 orm-diag、等級 warn; label / safe 之正規化與上限由 wsemi 單一擁有」→ OD-U-01、OD-U-04、語料 A02、A03、A09、A10; srLog 缺 warn 不再於建構時拋錯(Breaking)→ OD-U-07
//  站點接線(WWebTask 實際傳入 funLog)由 api-ormDiag(真實後端)與 OD-S-01～02(原始碼接線)守
//資料庫: 真實 lmdb, 落 test/_tmp/ormDiagLog/ (全域 §4), 測試自己清
import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import WOrm from 'w-orm-lmdb/src/WOrmLmdb.mjs'
import WServOrm from 'w-serv-orm/src/WServOrm.mjs'
import getDiag from 'wsemi/src/getDiag.mjs'
import diagCorpus from 'wsemi/src/_diagCases.mjs'
import ds from '../src/schema/index.mjs'
import { loadWiring } from './tools/diagWiring.mjs'


const __dir = path.dirname(fileURLToPath(import.meta.url))
const projRoot = path.resolve(__dir, '..')
const ROOT = path.resolve(__dir, '_tmp', 'ormDiagLog')
const EXPR = 'genDiagFunLog((o) => srLog.warn(o)).funLog' //正式站點之運算式(server/WWebTask.mjs)

//標記: 模擬使用者識別(email)、錯誤原文中之資料值與憑證, 須只出現在 detail / 拒收訊息, 不得出現在日誌
const MARK = 'victim-od@example.com'
const PW = 'S3cr3tPw-od'
const ERR_TEXT = 'disk full secret-od-detail'
const ERR_CRED = `connect postgres://admin:${PW}@db.example.com:5432/x password=${PW} failed`


//mkSrLog: 記憶體 srLog, 收各等級記錄
function mkSrLog() {
    let rec = { warns: [], infos: [], errors: [] }
    let srLog = {
        warn(o) {
            rec.warns.push(o)
        },
        info(o) {
            rec.infos.push(o)
        },
        error(o) {
            rec.errors.push(o)
        },
    }
    return { srLog, rec }
}


//spyConsole: 執行 fn 期間攔截 console.log; 回 { out(fn 結果或拋出值), threw, calls }
async function spyConsole(fn) {
    let calls = []
    let orig = console.log
    console.log = (...a) => {
        calls.push(a)
    }
    let out = null
    let threw = false
    try {
        out = await fn()
    }
    catch (err) {
        threw = true
        out = err
    }
    finally {
        console.log = orig
    }
    return { out, threw, calls }
}


//detail 替身: 任何存取(讀鍵、列舉、探測、取原型)皆計數並回無害值 (OD-U-02); 不拋錯, 使外洩變異時失敗訊息仍能正常呈現
function mkTrapDetail() {
    let touched = { n: 0 }
    let count = (v) => () => {
        touched.n++
        return v
    }
    let detail = new Proxy({}, { get: count(undefined), has: count(false), ownKeys: count([]), getOwnPropertyDescriptor: count(undefined), getPrototypeOf: count(null) })
    return { detail, touched }
}


//tick: 讓已排入之 microtask / unhandledRejection 通知先跑完(同 wsemi diagCaseRunner)
let tick = () => new Promise((resolve) => setImmediate(() => setImmediate(resolve)))


describe('unit-ormDiagLog(w-serv-orm 診斷輸出經 genDiagFunLog 導入 srLog, D21)', function() {
    this.timeout(60000)

    let wiring = null
    let nUnhandled = 0
    let onUnhandled = () => {
        nUnhandled++
    }

    before(async function() {
        wiring = await loadWiring()
        process.on('unhandledRejection', onUnhandled)
    })

    after(function() {
        process.off('unhandledRejection', onUnhandled)
    })


    describe('站點接線(原始碼)', function() {

        it('OD-S-01 server/WWebTask.mjs 建立 WServOrm 時傳入 funLog: genDiagFunLog((o) => srLog.warn(o)).funLog, 取自 wsemi, 且 srLog 先於 WServOrm 建立; 舊轉接檔 server/ormDiagLog.mjs 已刪', function() {
            let src = fs.readFileSync(path.join(projRoot, 'server', 'WWebTask.mjs'), 'utf8')
            assert.ok(/import genDiagFunLog from 'wsemi\/src\/genDiagFunLog\.mjs'/.test(src), '應 import wsemi 之 genDiagFunLog')
            assert.strictEqual(wiring.expr, EXPR, `funLog 運算式應為 ${EXPR}`)
            let iLog = src.indexOf('let srLog = srLogInit(opt)')
            let iOrm = src.indexOf('WServOrm(ds, WOrm, url, db')
            assert.ok(iLog > 0 && iOrm > iLog, 'srLog 須先於 WServOrm 建立')
            assert.strictEqual(fs.existsSync(path.join(projRoot, 'server', 'ormDiagLog.mjs')), false, '舊轉接檔不得存在(D1 單一實作)')
            assert.ok(!/ormDiagLog|genOrmFunLog/.test(src), 'WWebTask.mjs 不得再引用舊轉接')
        })

        it('OD-S-02 server/ 全部程式碼(去註解)中 funLog 只出現於上述接線一處, 事件名 orm-diag 不在本套件程式碼內(由 wsemi 預設供給)', function() {
            let dir = path.join(projRoot, 'server')
            let hits = []
            for (let fn of fs.readdirSync(dir).filter((x) => x.endsWith('.mjs'))) {
                let lines = fs.readFileSync(path.join(dir, fn), 'utf8').split(/\r?\n/)
                lines.forEach((ln, i) => {
                    let code = ln.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '').replace(/^\s*\/\*.*$/, '')
                    if (/funLog/.test(code)) {
                        hits.push(`${fn}:${i + 1}`)
                    }
                    assert.ok(!/orm-diag/.test(code), `${fn}:${i + 1} 不得自寫事件名 orm-diag`)
                })
            }
            assert.deepStrictEqual(hits.map((x) => x.split(':')[0]), ['WWebTask.mjs'], `funLog 只應在 WWebTask.mjs 一處, 實得 ${hits}`)
        })

    })


    describe('funLog 本身(假 srLog, 正式運算式)', function() {

        it('OD-U-01 轉交 label 與 safe: 呼叫 srLog.warn 恰 1 次, 記錄為 { event:"orm-diag", label, safe }; 不呼叫 info / error; 不寫 console; 回傳 undefined', async function() {
            let { srLog, rec } = mkSrLog()
            let funLog = wiring.make(srLog)
            assert.strictEqual(typeof funLog, 'function')
            let { out, threw, calls } = await spyConsole(() => funLog('channels.save fail', { n: 2, ks: [0, 3] }))
            assert.strictEqual(threw, false)
            assert.strictEqual(out, undefined, 'funLog 回傳值應為 undefined(不回 promise, 避免被當成非同步)')
            assert.deepStrictEqual(rec.warns, [{ event: 'orm-diag', label: 'channels.save fail', safe: { n: 2, ks: [0, 3] } }])
            assert.deepStrictEqual(rec.infos, [])
            assert.deepStrictEqual(rec.errors, [])
            assert.deepStrictEqual(calls, [], 'console 不得有輸出')
        })

        it('OD-U-02 detail(第 3 引數)不取用、不寫入: 任何存取皆計數之替身未被碰觸, 記錄不含其內容', function() {
            let { srLog, rec } = mkSrLog()
            let funLog = wiring.make(srLog)
            let { detail, touched } = mkTrapDetail()
            funLog('channels.save catch', { errType: 'Error' }, detail)
            assert.strictEqual(touched.n, 0, 'detail 不得被讀取、列舉或探測')
            assert.deepStrictEqual(rec.warns, [{ event: 'orm-diag', label: 'channels.save catch', safe: { errType: 'Error' } }])
            //含標記與憑證之一般物件 detail: 記錄全文不含
            funLog('channels.save fail', { n: 1, ks: [0] }, [{ k: 0, id: MARK, err: ERR_TEXT, cred: ERR_CRED }])
            let all = JSON.stringify(rec.warns)
            assert.ok(!all.includes(MARK), '記錄不得含主鍵(email)')
            assert.ok(!all.includes(ERR_TEXT), '記錄不得含錯誤原文')
            assert.ok(!all.includes(PW), '記錄不得含憑證')
        })

        it('OD-U-03 只有標籤者(w-serv-orm 之 safe 為 undefined): 寫入之記錄 safe 為 undefined(序列化後無 safe 鍵)', function() {
            let { srLog, rec } = mkSrLog()
            wiring.make(srLog)('channels.save row not found')
            assert.strictEqual(rec.warns.length, 1)
            assert.strictEqual(rec.warns[0].event, 'orm-diag')
            assert.strictEqual(rec.warns[0].label, 'channels.save row not found')
            assert.strictEqual(rec.warns[0].safe, undefined)
            assert.deepStrictEqual(JSON.parse(JSON.stringify(rec.warns[0])), { event: 'orm-diag', label: 'channels.save row not found' })
        })

        it('OD-U-04 w-serv-orm 1.1.22 實有之 safe 形狀原樣轉交: { table }、{ msgs }、{ type }、{ keys, nOther }、{ reason }、{ n, ks }、{ errType, errCode }、{ ok }', function() {
            let { srLog, rec } = mkSrLog()
            let funLog = wiring.make(srLog)
            let shapes = [
                ['backup...', { table: 'channels' }],
                ['channels.save data has unsupported key', { msgs: ['failed to save data, has __proto__: data[0]'] }],
                ['ds', { type: 'object' }],
                ['getSettings', { keys: ['a'], nOther: 2 }],
                ['channels.select invalid find', { reason: 'invalid find of select, need an object' }],
                ['channels.save fail', { n: 1, ks: [0] }],
                ['channels.save catch', { errType: 'Error', errCode: 'ENOSPC' }],
                ['channels.insert fail', { ok: 0 }],
            ]
            for (let [label, safe] of shapes) {
                funLog(label, safe)
            }
            assert.deepStrictEqual(rec.warns, shapes.map(([label, safe]) => ({ event: 'orm-diag', label, safe })))
        })

        it('OD-U-06 日誌寫入失敗不影響原流程: srLog.warn 拋錯、回 rejected promise、或事後被換成非函數皆不拋, 回傳 undefined, 不成未處理拒絕', async function() {
            let { srLog } = mkSrLog()
            let funLog = wiring.make(srLog)
            let base = nUnhandled
            srLog.warn = () => {
                throw new Error('log write failed')
            }
            assert.strictEqual(funLog('channels.save fail', { n: 1, ks: [0] }), undefined)
            srLog.warn = () => Promise.reject(new Error('async log write failed')) //回傳 rejected promise 者: 轉接器標記已處理
            assert.strictEqual(funLog('channels.save fail', { n: 1, ks: [0] }), undefined)
            srLog.warn = null
            assert.strictEqual(funLog('channels.save fail', { n: 1, ks: [0] }), undefined)
            await tick()
            assert.strictEqual(nUnhandled - base, 0, 'srLog.warn 回傳之 rejected promise 不得成為未處理拒絕')
        })

        it('OD-U-10 每次取用 srLog.warn(不於建構時固定): 建構之後換掉 srLog.warn, 其後的記錄寫進新函數', function() {
            let { srLog, rec } = mkSrLog()
            let funLog = wiring.make(srLog)
            funLog('first', { n: 1 })
            let got = []
            srLog.warn = (o) => {
                got.push(o)
            }
            funLog('second', { n: 2 })
            assert.deepStrictEqual(rec.warns.map((o) => o.label), ['first'])
            assert.deepStrictEqual(got, [{ event: 'orm-diag', label: 'second', safe: { n: 2 } }])
        })

        it('OD-U-07 srLog 缺 warn 函數(Breaking): 建構不再拋錯, funLog 為安靜無效(寫入失敗被吞); 舊版此處拋 invalid srLog', function() {
            for (let bad of [undefined, null, {}, { warn: 1 }, 'x']) {
                let funLog = null
                assert.doesNotThrow(() => {
                    funLog = wiring.make(bad)
                }, `srLog=${String(bad)} 建構不得拋錯`)
                assert.strictEqual(typeof funLog, 'function')
                assert.doesNotThrow(() => funLog('x', { n: 1 }))
            }
        })

        it('OD-U-08 safe 含自有 __proto__ 鍵時記錄保留其為自有鍵、不改寫記錄物件之原型', function() {
            let { srLog, rec } = mkSrLog()
            let safe = JSON.parse('{"__proto__":{"polluted":1},"n":1}') //JSON.parse 產生自有 __proto__ 鍵
            wiring.make(srLog)('x', safe)
            let s = rec.warns[0].safe
            assert.strictEqual(Object.getPrototypeOf(s), Object.prototype, '原型不得被改寫')
            assert.deepStrictEqual(Object.keys(s), ['__proto__', 'n'])
            assert.strictEqual(s.polluted, undefined)
        })

        it('OD-U-09 經 getDiag 使用(同 w-serv-orm): funLog 帶 noDetail, getDetail 0 次, safe 白名單外之鍵(含 password)不入記錄', function() {
            let { srLog, rec } = mkSrLog()
            let funLog = wiring.make(srLog)
            assert.strictEqual(funLog.noDetail, true, '正式 funLog 須帶 noDetail===true, 使產生端不取細節')
            let n = 0
            let diag = getDiag({ funLog }, { safeKeys: ['mode'] })
            diag('lb', { mode: 'm', password: PW }, () => {
                n++
                return { id: MARK, cred: ERR_CRED }
            })
            assert.strictEqual(n, 0, 'getDetail 不得被呼叫')
            assert.deepStrictEqual(rec.warns, [{ event: 'orm-diag', label: 'lb', safe: { mode: 'm' } }])
            assert.ok(!JSON.stringify(rec.warns).includes(PW))
        })

    })


    describe('語料子集(wsemi _diagCases 之 genDiagFunLog 組, 經正式運算式執行)', function() {

        //本套件只直接呼叫 wsemi 之 genDiagFunLog(其餘 7 個函數由 w-serv-orm 等產生端使用, 其形態語料屬產生端之接線測試與 wsemi 自身測試)
        //不適用: A07 以 opt.event 驗事件名(本套件不傳 opt, 事件名由 OD-U-01 驗預設 orm-diag); A08 驗 write 非函數建構即拋(本套件 write 恆為箭頭函數; 缺 srLog.warn 之行為見 OD-U-07)
        const NA = { A07: '本套件不傳 opt.event', A08: '本套件 write 恆為函數(缺 warn 見 OD-U-07)' }

        let cases = diagCorpus.cases.filter((c) => c.fn === 'genDiagFunLog')

        it('OD-C-00 語料之 genDiagFunLog 組至少含 A01～A10, 不適用者皆登錄理由', function() {
            let ids = cases.map((c) => c.id)
            for (let id of ['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09', 'A10']) {
                assert.ok(ids.includes(id), `語料缺 ${id}`)
            }
            for (let id of Object.keys(NA)) {
                assert.ok(ids.includes(id), `不適用清單之 ${id} 不在語料`)
            }
        })

        for (let c of cases.filter((x) => !NA[x.id])) {
            it(`OD-C ${c.id} ${c.label}`, async function() {
                //api: genDiagFunLog 為正式運算式去掉 .funLog 之值(srLog.warn 即案例自帶之 write), 其餘函數取自 wsemi
                let api = {
                    getDiag,
                    genDiagFunLog: (write) => wiring.call({ warn: write }),
                }
                let ctx = diagCorpus.mkCtx({
                    util: typeof process.getBuiltinModule === 'function',
                    unhandled: () => nUnhandled,
                    tick,
                })
                let out = await c.call(api, ctx)
                assert.strictEqual(diagCorpus.verify(c, out, ctx), null)
            })
        }

    })


    describe('真實 w-serv-orm(lmdb)', function() {

        let A = null //帶 funLog 之實例(同 WWebTask: WServOrm(ds, WOrm, url, db, { funLog }))
        let B = null //未帶 funLog 之實例(對照: 預設行為)
        let logA = null

        //patch: 換掉某表某方法(兩實例同換, 以相同之後端行為比對); 回還原函數
        let patchBoth = (tab, m, fn) => {
            let origs = [A.wp.woItems[tab][m], B.wp.woItems[tab][m]]
            A.wp.woItems[tab][m] = fn
            B.wp.woItems[tab][m] = fn
            return () => {
                A.wp.woItems[tab][m] = origs[0]
                B.wp.woItems[tab][m] = origs[1]
            }
        }

        before(function() {
            fs.rmSync(ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
            fs.mkdirSync(path.join(ROOT, 'a'), { recursive: true })
            fs.mkdirSync(path.join(ROOT, 'b'), { recursive: true })
            logA = mkSrLog()
            A = { wp: WServOrm(ds, WOrm, path.join(ROOT, 'a'), 'worm', { funLog: wiring.make(logA.srLog) }) }
            B = { wp: WServOrm(ds, WOrm, path.join(ROOT, 'b'), 'worm') }
        })

        after(async function() {
            await A.wp.closeAll()
            await B.wp.closeAll()
            fs.rmSync(ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
            try {
                fs.rmdirSync(path.join(__dir, '_tmp')) //空才移除(與 harness 並存時不動)
            }
            catch (err) {}
        })

        beforeEach(function() {
            logA.rec.warns.length = 0
        })

        //共同斷言: A 與 B 對同一呼叫之拒收值相同(R-ORMDIAG-04); A 的 console 零輸出, B 的 console 有輸出(對照, 證明攔截有效且舊行為會印);
        //A 的日誌恰 1 筆且 label / safe 如期; 日誌全文不含標記、錯誤原文與憑證; 回傳 A 的拒收值供個案另驗
        let runCase = async (call, label, safe) => {
            let ra = await spyConsole(() => call(A.wp.procOrm))
            let rb = await spyConsole(() => call(B.wp.procOrm))
            assert.strictEqual(ra.threw, true, 'A 應被拒收')
            assert.strictEqual(rb.threw, true, 'B 應被拒收')
            assert.strictEqual(ra.out, rb.out, `A 與 B 的拒收值應相同(不改 w-serv-orm 行為), A=${ra.out} B=${rb.out}`)
            assert.deepStrictEqual(ra.calls, [], `帶 funLog 時 console 不得有輸出, 實得 ${JSON.stringify(ra.calls)}`)
            assert.ok(rb.calls.length >= 1, '對照: 未帶 funLog 時 w-serv-orm 預設仍印 console(攔截有效)')
            assert.deepStrictEqual(logA.rec.warns, [{ event: 'orm-diag', label, safe }])
            let all = JSON.stringify(logA.rec)
            assert.ok(!all.includes(MARK), `日誌不得含主鍵 / email, 實得 ${all}`)
            assert.ok(!all.includes(ERR_TEXT), `日誌不得含錯誤原文, 實得 ${all}`)
            assert.ok(!all.includes(PW), `日誌不得含憑證, 實得 ${all}`)
            return ra.out
        }

        it('OD-I-01 save 的列不是物件(整批拒收): 日誌 channels.save data is not an object + { n, ks }', async function() {
            await runCase((p) => p('u', 'channels', 'save', [MARK]), 'channels.save data is not an object', { n: 1, ks: [0] })
        })

        it('OD-I-02 wo.save 拋錯(原文含標記與憑證): 日誌 channels.save catch + { errType }, 拒收值為固定詞彙 failed to save data(原樣)', async function() {
            let restore = patchBoth('channels', 'save', async () => {
                throw new Error(`${ERR_TEXT} ${MARK} ${ERR_CRED}`)
            })
            try {
                let rej = await runCase((p) => p('u', 'channels', 'save', [{ id: MARK, name: 'n' }]), 'channels.save catch', { errType: 'Error' })
                assert.strictEqual(rej, 'failed to save data')
            }
            finally {
                restore()
            }
        })

        it('OD-I-03 wo.save 逐筆失敗(逐筆 err 含標記與憑證): 日誌 channels.save fail + { n, ks }(無主鍵、無 err); 拒收訊息(回傳契約)仍含主鍵, 證明標記確實流經系統', async function() {
            let restore = patchBoth('channels', 'save', async () => [{ ok: 0, n: 0, err: `${ERR_TEXT} ${MARK} ${ERR_CRED}` }])
            try {
                let rej = await runCase((p) => p('u', 'channels', 'save', [{ id: MARK, name: 'n' }]), 'channels.save fail', { n: 1, ks: [0] })
                assert.ok(String(rej).includes(MARK), `拒收訊息(回傳契約)應含主鍵, 實得 ${rej}`)
                assert.ok(!String(rej).includes(PW), `拒收訊息不得含逐筆 err 內之憑證, 實得 ${rej}`)
            }
            finally {
                restore()
            }
        })

        it('OD-I-04 wo.insert 回聚合 ok 0: 日誌 channels.insert fail + { ok: 0 }, 拒收值為固定詞彙 failed to insert data(原樣)', async function() {
            let restore = patchBoth('channels', 'insert', async () => ({ ok: 0, n: 0, err: `${ERR_TEXT} ${MARK} ${ERR_CRED}` }))
            try {
                let rej = await runCase((p) => p('u', 'channels', 'insert', [{ id: MARK, name: 'n' }]), 'channels.insert fail', { ok: 0 })
                assert.strictEqual(rej, 'failed to insert data')
            }
            finally {
                restore()
            }
        })

        it('OD-I-05 select 條件為非物件(含標記): 日誌 channels.select invalid find + { reason }, 不含條件值', async function() {
            let rej = await runCase((p) => p('u', 'channels', 'select', MARK), 'channels.select invalid find', { reason: 'invalid find of select, need an object' })
            assert.strictEqual(rej, 'invalid find of select, need an object')
        })

        it('OD-I-06 wo.select 拒絕(字串原文含標記與憑證): 日誌 channels.select catch + { errType: "string" }, 拒收值為固定詞彙 failed to select data(原樣)', async function() {
            let restore = patchBoth('channels', 'select', () => Promise.reject(`${ERR_TEXT} ${MARK} ${ERR_CRED}`))
            try {
                let rej = await runCase((p) => p('u', 'channels', 'select', {}), 'channels.select catch', { errType: 'string' })
                assert.strictEqual(rej, 'failed to select data')
            }
            finally {
                restore()
            }
        })

        it('OD-I-07 wo.save 拒絕且帶機器代碼(Error.code): 日誌 safe 含 errType 與 errCode(白名單內), 不含訊息文字', async function() {
            let restore = patchBoth('channels', 'save', async () => {
                let e = new Error(`${ERR_TEXT} ${MARK} ${ERR_CRED}`)
                e.code = 'ENOSPC'
                throw e
            })
            try {
                await runCase((p) => p('u', 'channels', 'save', [{ id: MARK, name: 'n' }]), 'channels.save catch', { errType: 'Error', errCode: 'ENOSPC' })
            }
            finally {
                restore()
            }
        })

        it('OD-I-08 日誌寫入失敗不影響 procOrm: srLog.warn 拋錯時, 拒收值與未帶 funLog 之實例相同、不多拋', async function() {
            let origWarn = logA.srLog.warn
            logA.srLog.warn = () => {
                throw new Error('log write failed')
            }
            let restore = patchBoth('channels', 'save', async () => {
                throw new Error(`${ERR_TEXT} ${MARK}`)
            })
            try {
                let ra = await spyConsole(() => A.wp.procOrm('u', 'channels', 'save', [{ id: MARK, name: 'n' }]))
                let rb = await spyConsole(() => B.wp.procOrm('u', 'channels', 'save', [{ id: MARK, name: 'n' }]))
                assert.strictEqual(ra.threw, true)
                assert.strictEqual(ra.out, 'failed to save data')
                assert.strictEqual(ra.out, rb.out)
                assert.deepStrictEqual(ra.calls, [])
            }
            finally {
                restore()
                logA.srLog.warn = origWarn
            }
        })

        it('OD-W-01 srLog.warn 回 rejected promise 時, 真實 w-serv-orm 流程不產生未處理拒絕, procOrm 拒收值不變', async function() {
            let origWarn = logA.srLog.warn
            let base = nUnhandled
            logA.srLog.warn = () => Promise.reject(new Error('async log write failed'))
            let restore = patchBoth('channels', 'save', async () => {
                throw new Error(`${ERR_TEXT} ${MARK}`)
            })
            try {
                let ra = await spyConsole(() => A.wp.procOrm('u', 'channels', 'save', [{ id: MARK, name: 'n' }]))
                await tick()
                assert.strictEqual(ra.threw, true)
                assert.strictEqual(ra.out, 'failed to save data')
                assert.strictEqual(nUnhandled - base, 0, 'srLog.warn 回傳之 rejected promise 不得成為未處理拒絕')
            }
            finally {
                restore()
                logA.srLog.warn = origWarn
            }
        })

    })

})
