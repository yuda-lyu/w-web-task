//unit-ormDiagLog: w-serv-orm 診斷輸出(opt.funLog, w-serv-orm ≥ 1.1.20)導入本套件 srLog (server/ormDiagLog.mjs; spec/設計要點與取捨.md D21; 規則帳本 R-ORMDIAG-01～05)
//  R-ORMDIAG-01「funLog 只把 label 與 safe 寫入 srLog.warn({ event:'orm-diag', label, safe }); 不寫 console」→ OD-U-01、OD-U-03、OD-I-01～07 之 console 零輸出
//  R-ORMDIAG-02「detail(含主鍵、email、錯誤原文)不取用、不寫入日誌」→ OD-U-02; OD-I-01～07 以真實 w-serv-orm 觸發, 日誌全文不含標記與錯誤原文
//  R-ORMDIAG-03「日誌寫入失敗不得影響原流程」→ OD-U-06、OD-I-08
//  R-ORMDIAG-04「不改 w-serv-orm 之其他選項與行為」→ OD-I-01～07 之 procOrm 拒收值與未帶 funLog 之實例逐項相同
//  R-ORMDIAG-05「記錄有界(字串 200、項數 20、深度 3), 不使日誌被撐大」→ OD-U-05
//  站點接線(WWebTask 實際傳入 funLog)由 api-ormDiag(真實後端)與 OD-S-01(原始碼接線)守
//資料庫: 真實 lmdb, 落 test/_tmp/ormDiagLog/ (全域 §4), 測試自己清
import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import WOrm from 'w-orm-lmdb/src/WOrmLmdb.mjs'
import WServOrm from 'w-serv-orm/src/WServOrm.mjs'
import ds from '../src/schema/index.mjs'
import genOrmFunLog from '../server/ormDiagLog.mjs'


const __dir = path.dirname(fileURLToPath(import.meta.url))
const projRoot = path.resolve(__dir, '..')
const ROOT = path.resolve(__dir, '_tmp', 'ormDiagLog')

//標記: 模擬使用者識別(email)與錯誤原文中之資料值, 須只出現在 detail / 拒收訊息, 不得出現在日誌
const MARK = 'victim-od@example.com'
const ERR_TEXT = 'disk full secret-od-detail'


//mkSrLog: 記憶體 srLog, 收各等級記錄; warn 可換成拋錯版(OD-U-06、OD-I-08)
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


describe('unit-ormDiagLog(w-serv-orm 診斷輸出導入 srLog, D21)', function() {
    this.timeout(60000)

    describe('funLog 本身(假 srLog)', function() {

        it('OD-U-01 轉交 label 與 safe: 呼叫 srLog.warn 恰 1 次, 記錄為 { event:"orm-diag", label, safe }; 不呼叫 info / error; 不寫 console', async function() {
            let { srLog, rec } = mkSrLog()
            let funLog = genOrmFunLog(srLog)
            let { out, threw, calls } = await spyConsole(() => funLog('channels.save fail', { n: 2, ks: [0, 3] }))
            assert.strictEqual(threw, false)
            assert.strictEqual(out, undefined, 'funLog 回傳值應為 undefined(不回 promise, 避免被當成非同步)')
            assert.deepStrictEqual(rec.warns, [{ event: 'orm-diag', label: 'channels.save fail', safe: { n: 2, ks: [0, 3] } }])
            assert.deepStrictEqual(rec.infos, [])
            assert.deepStrictEqual(rec.errors, [])
            assert.deepStrictEqual(calls, [], 'console 不得有輸出')
        })

        it('OD-U-02 detail(第 3 引數)不取用、不寫入: 任何存取皆拋錯之替身未被碰觸, 記錄不含其內容', async function() {
            let { srLog, rec } = mkSrLog()
            let funLog = genOrmFunLog(srLog)
            let { detail, touched } = mkTrapDetail()
            funLog('channels.save catch', { errType: 'Error' }, detail)
            assert.strictEqual(touched.n, 0, 'detail 不得被讀取、列舉或探測')
            assert.deepStrictEqual(rec.warns, [{ event: 'orm-diag', label: 'channels.save catch', safe: { errType: 'Error' } }])
            //含標記之一般物件 detail: 記錄全文不含標記與錯誤原文
            funLog('channels.save fail', { n: 1, ks: [0] }, [{ k: 0, id: MARK, err: ERR_TEXT }])
            let all = JSON.stringify(rec.warns)
            assert.ok(!all.includes(MARK), '記錄不得含主鍵(email)')
            assert.ok(!all.includes(ERR_TEXT), '記錄不得含錯誤原文')
        })

        it('OD-U-03 只有標籤者(w-serv-orm 之 safe 為 undefined): 記錄無 safe 鍵', function() {
            let { srLog, rec } = mkSrLog()
            genOrmFunLog(srLog)('channels.save row not found')
            assert.strictEqual(rec.warns.length, 1)
            assert.deepStrictEqual(rec.warns[0], { event: 'orm-diag', label: 'channels.save row not found' })
            assert.ok(!Object.prototype.hasOwnProperty.call(rec.warns[0], 'safe'))
        })

        it('OD-U-04 w-serv-orm 實有之 safe 形狀原樣轉交: 字串(表名)、字串陣列(固定句型)、{ type }、{ keys, nOther }', function() {
            let { srLog, rec } = mkSrLog()
            let funLog = genOrmFunLog(srLog)
            let shapes = [
                ['backup...', 'channels'],
                ['channels.save data has unsupported key', ['failed to save data, has __proto__: data[0]']],
                ['ds', { type: 'object' }],
                ['getSettings', { keys: ['a'], nOther: 2 }],
                ['channels.select invalid find', { reason: 'invalid find of select, need an object' }],
            ]
            for (let [label, safe] of shapes) {
                funLog(label, safe)
            }
            assert.deepStrictEqual(rec.warns, shapes.map(([label, safe]) => ({ event: 'orm-diag', label, safe })))
        })

        it('OD-U-05 記錄有界: 長字串截為 200 字、陣列至多 20 項、物件至多 20 鍵、深度至多 3 層, 非 JSON 值以型別標記; 全程不拋', function() {
            let { srLog, rec } = mkSrLog()
            let funLog = genOrmFunLog(srLog)
            let long = 'x'.repeat(5000)
            let circ = { a: 1 }
            circ.self = circ
            let big = {}
            for (let k = 0; k < 100; k++) {
                big[`k${k}`] = k
            }
            funLog(long, { s: long, arr: Array.from({ length: 100 }, (_, k) => k), big, deep: { a: { b: { c: { d: 1 } } } }, fn: () => 1, sym: Symbol('s'), circ })
            assert.strictEqual(rec.warns.length, 1)
            let r = rec.warns[0]
            assert.ok(r.label.length < 300 && r.label.startsWith('x'.repeat(200)), `label 應被截斷, 長度 ${r.label.length}`)
            assert.ok(r.safe.s.length < 300 && r.safe.s.startsWith('x'.repeat(200)))
            assert.ok(r.safe.arr.length <= 21, `陣列至多 20 項(+ 1 筆餘量標記), 實得 ${r.safe.arr.length}`)
            assert.ok(Object.keys(r.safe.big).length <= 21)
            assert.strictEqual(typeof r.safe.fn, 'string')
            assert.strictEqual(typeof r.safe.sym, 'string')
            //可被 JSON 序列化(含循環參照者已被截斷)
            assert.doesNotThrow(() => JSON.stringify(r))
            //深度: safe(0) → deep(1) → a(2) → b(3)=標記; 循環參照: circ(1) → self(2) → self(3)=標記
            assert.deepStrictEqual(r.safe.deep, { a: { b: '[...]' } }, '超過深度之層以標記取代')
            assert.deepStrictEqual(r.safe.circ, { a: 1, self: { a: 1, self: '[...]' } })
            assert.strictEqual(r.safe.arr[20], '[80 more]')
            assert.strictEqual(r.safe.big['[more]'], 80)
        })

        it('OD-U-08 safe 含自有 __proto__ 鍵時記錄保留其為自有鍵、不改寫記錄物件之原型', function() {
            let { srLog, rec } = mkSrLog()
            let safe = JSON.parse('{"__proto__":{"polluted":1},"n":1}') //JSON.parse 產生自有 __proto__ 鍵
            genOrmFunLog(srLog)('x', safe)
            let s = rec.warns[0].safe
            assert.strictEqual(Object.getPrototypeOf(s), Object.prototype, '原型不得被改寫')
            assert.deepStrictEqual(Object.keys(s), ['__proto__', 'n'])
            assert.strictEqual(s.polluted, undefined)
        })

        it('OD-U-06 日誌寫入失敗不影響原流程: srLog.warn 拋錯、或 srLog.warn 不是函數(事後被換掉)皆不拋, 回傳 undefined, 不回 rejected promise', async function() {
            let { srLog } = mkSrLog()
            let funLog = genOrmFunLog(srLog)
            srLog.warn = () => {
                throw new Error('log write failed')
            }
            assert.strictEqual(funLog('channels.save fail', { n: 1, ks: [0] }), undefined)
            srLog.warn = () => Promise.reject(new Error('async log write failed')) //回傳 rejected promise 者: 由 w-serv-orm 之 swallow 吞下; 本函數不回傳它
            assert.strictEqual(funLog('channels.save fail', { n: 1, ks: [0] }), undefined)
            srLog.warn = null
            assert.strictEqual(funLog('channels.save fail', { n: 1, ks: [0] }), undefined)
            await new Promise((resolve) => setTimeout(resolve, 20)) //若有 unhandledRejection, mocha 會在此回合報錯
        })

        it('OD-U-07 建構時 fail-fast: srLog 缺 warn 函數即拋 Error(同 createAuthorizeExec 之 invalid opt.srLog 慣例)', function() {
            for (let bad of [undefined, null, {}, { warn: 1 }, 'x']) {
                assert.throws(() => genOrmFunLog(bad), /invalid srLog/)
            }
        })

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
            A = { wp: WServOrm(ds, WOrm, path.join(ROOT, 'a'), 'worm', { funLog: genOrmFunLog(logA.srLog) }) }
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
        //A 的日誌恰 1 筆且 label / safe 如期; 日誌全文不含標記與錯誤原文; 回傳 A 的拒收值供個案另驗
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
            return ra.out
        }

        it('OD-I-01 save 的列不是物件(整批拒收): 日誌 channels.save data is not an object + { n, ks }', async function() {
            await runCase((p) => p('u', 'channels', 'save', [MARK]), 'channels.save data is not an object', { n: 1, ks: [0] })
        })

        it('OD-I-02 wo.save 拋錯(原文含標記): 日誌 channels.save catch + { errType }, 拒收值為 failed to save data', async function() {
            let restore = patchBoth('channels', 'save', async () => {
                throw new Error(`${ERR_TEXT} ${MARK}`)
            })
            try {
                let rej = await runCase((p) => p('u', 'channels', 'save', [{ id: MARK, name: 'n' }]), 'channels.save catch', { errType: 'Error' })
                assert.strictEqual(rej, 'failed to save data')
            }
            finally {
                restore()
            }
        })

        it('OD-I-03 wo.save 逐筆失敗: 日誌 channels.save fail + { n, ks }(無主鍵); 拒收訊息(回傳契約)仍含主鍵, 證明標記確實流經系統', async function() {
            let restore = patchBoth('channels', 'save', async () => [{ ok: 0, n: 0, err: `${ERR_TEXT} ${MARK}` }])
            try {
                let rej = await runCase((p) => p('u', 'channels', 'save', [{ id: MARK, name: 'n' }]), 'channels.save fail', { n: 1, ks: [0] })
                assert.ok(String(rej).includes(MARK), `拒收訊息(回傳契約)應含主鍵, 實得 ${rej}`)
            }
            finally {
                restore()
            }
        })

        it('OD-I-04 wo.insert 回聚合 ok 0: 日誌 channels.insert fail + { ok: 0 }, 拒收值為 failed to insert data', async function() {
            let restore = patchBoth('channels', 'insert', async () => ({ ok: 0, n: 0, err: `${ERR_TEXT} ${MARK}` }))
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

        it('OD-I-06 wo.select 拒絕(字串原文含標記): 日誌 channels.select catch + { errType: "string" }, 拒收值為 failed to select data', async function() {
            let restore = patchBoth('channels', 'select', () => Promise.reject(`${ERR_TEXT} ${MARK}`))
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
                let e = new Error(`${ERR_TEXT} ${MARK}`)
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

    })


    describe('站點接線(原始碼)', function() {

        it('OD-S-01 server/WWebTask.mjs 建立 WServOrm 時傳入 funLog: genOrmFunLog(srLog), 且 srLog 先於 WServOrm 建立', function() {
            let src = fs.readFileSync(path.join(projRoot, 'server', 'WWebTask.mjs'), 'utf8')
            assert.ok(/import genOrmFunLog from '\.\/ormDiagLog\.mjs'/.test(src), '應 import ormDiagLog')
            assert.ok(/WServOrm\(ds, WOrm, url, db, \{ funLog: genOrmFunLog\(srLog\) \}\)/.test(src), 'WServOrm 呼叫應帶 { funLog: genOrmFunLog(srLog) }')
            let iLog = src.indexOf('let srLog = srLogInit(opt)')
            let iOrm = src.indexOf('WServOrm(ds, WOrm, url, db')
            assert.ok(iLog > 0 && iOrm > iLog, 'srLog 須先於 WServOrm 建立')
        })

    })

})
