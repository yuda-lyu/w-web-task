//unit-ormDiagLog: w-serv-orm 診斷輸出(opt.funLog, w-serv-orm ≥ 1.1.23)經 wsemi genDiagFunLog 導入本套件 srLog 之接線測試
//  (server/WWebTask.mjs 之 funLog 運算式; spec/設計要點與取捨.md D21; 規則帳本 R-ORMDIAG-01～05、08; 規則本體 wsemi R-DIAG-01、w-serv-orm R-DIAG-02、dspec 診斷輸出與遮罩)
//  形態類案(label 控制字元、safe 之 bigint / 循環 / 上限、rejected promise、write 同步拋錯)由 wsemi 共用語料 _diagCases 之 genDiagFunLog 組(A01～A10)驅動, 經正式站點之運算式執行;
//  本檔其餘為接線案: 運算式本身(OD-S)、以 srLog 呼叫(OD-U)、真實 w-serv-orm + lmdb 之端到端(OD-I)、srLog 寫入失敗(OD-W).
//  R-ORMDIAG-01「funLog 只把 label 與 safe 寫入 srLog.warn({ event:'orm-diag', label, safe }); 不寫 console」→ OD-U-01、OD-U-03、OD-I-01～07 之 console 零輸出
//  R-ORMDIAG-02「detail(含主鍵、email、錯誤原文、憑證)不取用、不寫入日誌」→ OD-U-02、OD-U-09; OD-I-01～07 以真實 w-serv-orm 觸發, 日誌全文不含標記、錯誤原文與憑證
//  R-ORMDIAG-03「日誌寫入失敗不得影響原流程(含 srLog.warn 回傳 rejected promise 不成未處理拒絕)」→ OD-U-06、OD-W-01、OD-I-08、語料 A04、A06
//  R-ORMDIAG-04「不改 w-serv-orm 之其他選項與行為」→ OD-I-01～07 之 procOrm 拒收值與未帶 funLog 之實例逐項相同
//  R-ORMDIAG-05「事件名 orm-diag、等級 warn; label / safe 之正規化與上限由 wsemi 單一擁有」→ OD-U-01、OD-U-04、語料 A02、A03、A09、A10; srLog 缺 warn 不再於建構時拋錯(Breaking)→ OD-U-07
//  R-ORMDIAG-08「轉接器傳 safeKeys: SAFE_KEYS(w-serv-orm 公開, 單一來源), 白名單外之鍵不入 srLog; 本套件不 import w-serv-orm 之內部檔」→ OD-S-01、OD-S-03、OD-U-11、OD-U-12、OD-K-01
//  站點接線(WWebTask 實際傳入 funLog)由 api-ormDiag(真實後端)與 OD-S-01～03(原始碼接線)守
//資料庫: 真實 lmdb, 落 test/_tmp/ormDiagLog/ (全域 §4), 測試自己清
import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import WOrm from 'w-orm-lmdb/src/WOrmLmdb.mjs'
import WServOrm from 'w-serv-orm/src/WServOrm.mjs'
import { SAFE_KEYS } from 'w-serv-orm/src/safeKeys.mjs'
import getDiag from 'wsemi/src/getDiag.mjs'
import diagCorpus from 'wsemi/src/_diagCases.mjs'
import ds from '../src/schema/index.mjs'
import { loadWiring } from './tools/diagWiring.mjs'
import { scanServOrmImports } from './tools/servOrmImports.mjs'


const __dir = path.dirname(fileURLToPath(import.meta.url))
const projRoot = path.resolve(__dir, '..')
const ROOT = path.resolve(__dir, '_tmp', 'ormDiagLog')
const EXPR = 'genDiagFunLog((o) => srLog.warn(o), { safeKeys: SAFE_KEYS }).funLog' //正式站點之運算式(server/WWebTask.mjs)

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

        it('OD-S-01 server/WWebTask.mjs 建立 WServOrm 時傳入 funLog: genDiagFunLog((o) => srLog.warn(o), { safeKeys: SAFE_KEYS }).funLog, 轉接器取自 wsemi、SAFE_KEYS 取自 w-serv-orm 公開入口, 且 srLog 先於 WServOrm 建立; 舊轉接檔 server/ormDiagLog.mjs 已刪', function() {
            //R-ORMDIAG-08「safeKeys 為單一來源(w-serv-orm 公開之 SAFE_KEYS), 不另抄一份名單」
            let src = fs.readFileSync(path.join(projRoot, 'server', 'WWebTask.mjs'), 'utf8')
            assert.ok(/import genDiagFunLog from 'wsemi\/src\/genDiagFunLog\.mjs'/.test(src), '應 import wsemi 之 genDiagFunLog')
            assert.ok(/^import \{ SAFE_KEYS \} from 'w-serv-orm\/src\/safeKeys\.mjs'$/m.test(src), '應自 w-serv-orm 公開入口 import SAFE_KEYS')
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

        it('OD-S-03 w-serv-orm 之 import 全表: 本套件自有原始碼只 import 公開入口(WServOrm.mjs 主入口、safeKeys.mjs、baseline.mjs 公開子模組)與已登錄之既有例外(checkOptRemoved.mjs, 僅 WWebTask.mjs, D17), 不 import 其他內部檔(如 getDiagBrief.mjs)', function() {
            //R-ORMDIAG-08「除公開入口外不 import w-serv-orm 之內部檔」; 公開與否之依據: w-serv-orm README〈公開 SAFE_KEYS〉〈純函數子模組 baseline.mjs〉, 主入口 src/WServOrm.mjs
            const PUBLIC = ['src/WServOrm.mjs', 'src/safeKeys.mjs', 'src/baseline.mjs']
            const EXCEPT = { 'server/WWebTask.mjs': ['src/checkOptRemoved.mjs'] } //既有例外: D17 於入口拒絕 w-serv-orm 已移除之三鍵, 規則與訊息由 w-serv-orm 單一擁有, 本套件不另寫; w-serv-orm 未列為公開 → 待 w-serv-orm 公開或另裁示
            let table = scanServOrmImports()
            //全表(含測試檔): 每項皆為公開入口或已登錄之例外
            let bad = []
            for (let [fn, mods] of Object.entries(table)) {
                for (let m of mods) {
                    if (!PUBLIC.includes(m) && !(EXCEPT[fn] || []).includes(m)) {
                        bad.push(`${fn} → ${m}`)
                    }
                }
            }
            assert.deepStrictEqual(bad, [], `不得 import w-serv-orm 之內部檔: ${bad.join('; ')}`)
            //正式程式碼(server、src、根目錄腳本)之站點全集逐字固定: 新增或換路徑須先歸類後改此表
            let prod = {}
            for (let [fn, mods] of Object.entries(table)) {
                if (!fn.startsWith('test/')) {
                    prod[fn] = mods
                }
            }
            assert.deepStrictEqual(prod, {
                'g.mOrm.mjs': ['src/WServOrm.mjs'],
                'server/WWebTask.mjs': ['src/WServOrm.mjs', 'src/checkOptRemoved.mjs', 'src/safeKeys.mjs'],
                'server/procCore.mjs': ['src/baseline.mjs'],
                'src/plugins/mDraft.mjs': ['src/baseline.mjs'],
            })
            //診斷相關: 本套件任何檔不得 import w-serv-orm 之 getDiagBrief.mjs(1.1.23 已刪 getUrlSecrets, 分類改用 wsemi 之 getDiagSecrets)
            assert.deepStrictEqual(Object.entries(table).filter(([, mods]) => mods.includes('src/getDiagBrief.mjs')), [])
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

        it('OD-U-08 safe 含自有 __proto__ 鍵時(不在白名單): 該鍵被丟棄、記錄物件之原型不被改寫(Breaking: 舊版無白名單時保留為自有鍵; 白名單含 __proto__ 時保留為自有鍵之行為由語料 A13 守)', function() {
            let { srLog, rec } = mkSrLog()
            let safe = JSON.parse('{"__proto__":{"polluted":1},"n":1}') //JSON.parse 產生自有 __proto__ 鍵
            wiring.make(srLog)('x', safe)
            let s = rec.warns[0].safe
            assert.strictEqual(Object.getPrototypeOf(s), Object.prototype, '原型不得被改寫')
            assert.deepStrictEqual(Object.keys(s), ['n'])
            assert.strictEqual(s.polluted, undefined)
            assert.strictEqual({}.polluted, undefined, '全域 Object.prototype 不得被污染')
        })

        it('OD-U-09 經 getDiag 使用(同 w-serv-orm): funLog 帶 noDetail, getDetail 0 次, safe 白名單外之鍵(含 password)不入記錄; 產生端白名單較寬時, 轉接器之 SAFE_KEYS 為第二道防線', function() {
            let { srLog, rec } = mkSrLog()
            let funLog = wiring.make(srLog)
            assert.strictEqual(funLog.noDetail, true, '正式 funLog 須帶 noDetail===true, 使產生端不取細節')
            let n = 0
            let diag = getDiag({ funLog }, { safeKeys: ['n'] }) //'n' 在 SAFE_KEYS 內
            diag('lb', { n: 1, password: PW }, () => {
                n++
                return { id: MARK, cred: ERR_CRED }
            })
            assert.strictEqual(n, 0, 'getDetail 不得被呼叫')
            assert.deepStrictEqual(rec.warns, [{ event: 'orm-diag', label: 'lb', safe: { n: 1 } }])
            assert.ok(!JSON.stringify(rec.warns).includes(PW))
            //產生端 getDiag 放行、但不在 SAFE_KEYS 內之鍵('mode'): 第一道(產生端)過了, 第二道(轉接器)仍丟棄
            rec.warns.length = 0
            getDiag({ funLog }, { safeKeys: ['n', 'mode'] })('lb2', { n: 2, mode: 'm', password: PW })
            assert.deepStrictEqual(rec.warns, [{ event: 'orm-diag', label: 'lb2', safe: { n: 2 } }])
        })

        it('OD-U-11 第二道防線(safeKeys: SAFE_KEYS): safe 含白名單外之鍵(password、token、巢狀物件、自有 __proto__)時, srLog 只收 SAFE_KEYS 內之鍵與 errType、errCode', function() {
            //R-ORMDIAG-08; 修前(未給 safeKeys)白名單外之鍵會原樣寫入 srLog
            let { srLog, rec } = mkSrLog()
            let funLog = wiring.make(srLog)
            let safe = JSON.parse(`{"n":1,"ks":[0],"password":"${PW}","token":"tok-od","nested":{"password":"${PW}","n":2},"errType":"Error","errCode":"ENOSPC","extra":["a"],"__proto__":{"polluted":1}}`)
            funLog('channels.save fail', safe)
            assert.strictEqual(rec.warns.length, 1)
            let got = rec.warns[0].safe
            assert.deepStrictEqual(Object.keys(got).sort(), ['errCode', 'errType', 'ks', 'n'], `只應剩白名單內之鍵與 errType、errCode, 實得 ${JSON.stringify(got)}`)
            assert.deepStrictEqual(got, { n: 1, ks: [0], errType: 'Error', errCode: 'ENOSPC' })
            let all = JSON.stringify(rec.warns)
            assert.ok(!all.includes(PW), '記錄不得含白名單外之 password 值')
            assert.ok(!all.includes('tok-od') && !all.includes('nested') && !all.includes('extra'), `記錄不得含白名單外之鍵, 實得 ${all}`)
        })

        it('OD-U-12 SAFE_KEYS 內每一個鍵都能通過轉接器, 名單外之鍵一律丟棄: 轉接器用的是 w-serv-orm 公開之那份名單, 不是空名單或另抄的一份', function() {
            //R-ORMDIAG-08; 與 OD-U-11 互補: 避免「全丟」(空名單 fail-closed)也被當成通過
            assert.ok(Object.isFrozen(SAFE_KEYS) && SAFE_KEYS.length > 0, 'w-serv-orm 公開之 SAFE_KEYS 應為凍結且非空之陣列')
            let { srLog, rec } = mkSrLog()
            let funLog = wiring.make(srLog)
            let safe = {}
            for (let k of SAFE_KEYS) {
                safe[k] = 1
            }
            for (let k of ['zzzNotListed', 'password', 'detail', 'id']) {
                safe[k] = 1
            }
            funLog('x', safe)
            assert.deepStrictEqual(Object.keys(rec.warns[0].safe).sort(), [...SAFE_KEYS].sort(), 'SAFE_KEYS 內之鍵全數保留且僅此')
            //errType、errCode 不在 SAFE_KEYS 內仍恆保留(wsemi 恆含)
            assert.ok(!SAFE_KEYS.includes('errType') && !SAFE_KEYS.includes('errCode'), 'w-serv-orm 之 SAFE_KEYS 不列 errType、errCode(wsemi 恆含)')
            funLog('y', { errType: 'Error', errCode: 'ENOSPC', password: PW })
            assert.deepStrictEqual(rec.warns[1].safe, { errType: 'Error', errCode: 'ENOSPC' })
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
                //api: genDiagFunLog 為正式運算式去掉 .funLog 之值, 其寫入接線 (o) => srLog.warn(o) 不變(srLog.warn 即案例自帶之 write), 第 2 引數(opt)換成案例自帶者
                //  (語料各案用任意鍵名, 正式之 safeKeys: SAFE_KEYS 會把它們丟棄; 正式之 safeKeys 由 OD-S-01、OD-U-11、OD-U-12、OD-K-01 守), 其餘函數取自 wsemi
                let api = {
                    getDiag,
                    genDiagFunLog: (write, opt) => wiring.callOpt({ warn: write }, opt),
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
        let C = null //帶「原始」funLog 之實例(對照: 只記下 w-serv-orm 產出之 label 與 safe, 未經轉接器; OD-K)
        let logA = null
        let rawC = [] //C 收到之 { label, safe }

        //patch: 換掉某表某方法(三實例同換, 以相同之後端行為比對); 回還原函數
        let patchBoth = (tab, m, fn) => {
            let origs = [A.wp.woItems[tab][m], B.wp.woItems[tab][m], C.wp.woItems[tab][m]]
            A.wp.woItems[tab][m] = fn
            B.wp.woItems[tab][m] = fn
            C.wp.woItems[tab][m] = fn
            return () => {
                A.wp.woItems[tab][m] = origs[0]
                B.wp.woItems[tab][m] = origs[1]
                C.wp.woItems[tab][m] = origs[2]
            }
        }

        before(function() {
            fs.rmSync(ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
            fs.mkdirSync(path.join(ROOT, 'a'), { recursive: true })
            fs.mkdirSync(path.join(ROOT, 'b'), { recursive: true })
            fs.mkdirSync(path.join(ROOT, 'c'), { recursive: true })
            logA = mkSrLog()
            A = { wp: WServOrm(ds, WOrm, path.join(ROOT, 'a'), 'worm', { funLog: wiring.make(logA.srLog) }) }
            B = { wp: WServOrm(ds, WOrm, path.join(ROOT, 'b'), 'worm') }
            let rawFunLog = Object.assign((label, safe) => {
                rawC.push({ label, safe })
            }, { noDetail: true })
            C = { wp: WServOrm(ds, WOrm, path.join(ROOT, 'c'), 'worm', { funLog: rawFunLog }) }
        })

        after(async function() {
            await A.wp.closeAll()
            await B.wp.closeAll()
            await C.wp.closeAll()
            fs.rmSync(ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
            try {
                fs.rmdirSync(path.join(__dir, '_tmp')) //空才移除(與 harness 並存時不動)
            }
            catch (err) {}
        })

        beforeEach(function() {
            logA.rec.warns.length = 0
            rawC.length = 0
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

        it('OD-K-01 w-serv-orm 實際產出之診斷經轉接(safeKeys: SAFE_KEYS)後鍵不被丟失: 8 種失敗情境下, 轉接前(w-serv-orm 原始 funLog)與轉接後(srLog 記錄)逐筆 label 與 safe 頂層鍵相同, 且皆在 SAFE_KEYS 與 errType、errCode 內', async function() {
            //R-ORMDIAG-08「第二道防線不丟 w-serv-orm 自己產出之鍵」; 情境同 OD-I-01～07 並加一種 msgs; 修前(未給 safeKeys)此案亦綠(未給時不過濾), 故與 OD-U-11(丟得掉)互補成雙向約束
            const boom = () => new Error(`${ERR_TEXT} ${MARK} ${ERR_CRED}`)
            const coded = () => Object.assign(boom(), { code: 'ENOSPC' })
            const throwBoom = async () => {
                throw boom()
            }
            const throwCoded = async () => {
                throw coded()
            }
            let scenarios = [
                { name: 'save 列非物件', call: (p) => p('u', 'channels', 'save', [MARK]) },
                { name: 'save 拋錯', patch: ['channels', 'save', throwBoom], call: (p) => p('u', 'channels', 'save', [{ id: MARK, name: 'n' }]) },
                { name: 'save 逐筆失敗', patch: ['channels', 'save', async () => [{ ok: 0, n: 0, err: `${ERR_TEXT} ${MARK} ${ERR_CRED}` }]], call: (p) => p('u', 'channels', 'save', [{ id: MARK, name: 'n' }]) },
                { name: 'insert 聚合 ok 0', patch: ['channels', 'insert', async () => ({ ok: 0, n: 0, err: `${ERR_TEXT} ${MARK} ${ERR_CRED}` })], call: (p) => p('u', 'channels', 'insert', [{ id: MARK, name: 'n' }]) },
                { name: 'select 條件非物件', call: (p) => p('u', 'channels', 'select', MARK) },
                { name: 'select 拒絕(字串)', patch: ['channels', 'select', () => Promise.reject(`${ERR_TEXT} ${MARK} ${ERR_CRED}`)], call: (p) => p('u', 'channels', 'select', {}) },
                { name: 'save 拒絕帶 errCode', patch: ['channels', 'save', throwCoded], call: (p) => p('u', 'channels', 'save', [{ id: MARK, name: 'n' }]) },
                { name: 'save 列含 __proto__ 鍵', call: (p) => p('u', 'channels', 'save', [JSON.parse('{"__proto__":{"x":1},"name":"n"}')]) },
            ]
            let seen = new Set()
            let allowed = new Set([...SAFE_KEYS, 'errType', 'errCode'])
            for (let sc of scenarios) {
                logA.rec.warns.length = 0
                rawC.length = 0
                let restore = sc.patch ? patchBoth(...sc.patch) : () => {}
                try {
                    for (let t of [A, C]) {
                        await spyConsole(() => sc.call(t.wp.procOrm)) //拒收為預期, 不論結果
                    }
                }
                finally {
                    restore()
                }
                assert.ok(rawC.length >= 1, `${sc.name}: w-serv-orm 應產出診斷`)
                assert.strictEqual(logA.rec.warns.length, rawC.length, `${sc.name}: 轉接後筆數應與轉接前相同`)
                rawC.forEach((raw, i) => {
                    let out = logA.rec.warns[i]
                    assert.strictEqual(out.label, raw.label, `${sc.name}: label`)
                    let kRaw = raw.safe === undefined ? [] : Object.keys(raw.safe).sort()
                    let kOut = out.safe === undefined ? [] : Object.keys(out.safe).sort()
                    assert.deepStrictEqual(kOut, kRaw, `${sc.name} [${raw.label}]: 轉接後之 safe 鍵應與 w-serv-orm 產出相同(不丟失、不多出)`)
                    for (let k of kRaw) {
                        assert.ok(allowed.has(k), `${sc.name} [${raw.label}]: w-serv-orm 產出之鍵 ${k} 不在 SAFE_KEYS 與 errType、errCode 內`)
                        seen.add(k)
                    }
                })
            }
            //涵蓋門檻: 8 種情境實際產出之鍵至少含下列(避免情境失效而空轉)
            for (let k of ['errCode', 'errType', 'ks', 'msgs', 'n', 'ok', 'reason']) {
                assert.ok(seen.has(k), `情境應實際產出鍵 ${k}, 實得 ${[...seen].sort()}`)
            }
        })

    })

})
