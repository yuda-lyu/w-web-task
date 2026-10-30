//unit-ormDiagMask: 外來值遮罩出口 diag (server/genDiag.mjs, wsemi getDiag 實例) 之接線測試 (規則帳本 R-ORMDIAG-07; dspec〈診斷輸出與遮罩〉D3; spec/設計要點與取捨.md D21)
//  外來值＝後端、驅動、使用端回呼之錯誤 (原文可能含連線字串、帳密、權杖); 離開本套件前 (回遠端之 msg、對外 reject / throw、寫入 srLog 之 msg 與 err) 經 diag.err / diag.mask;
//  本套件自身以固定詞彙組成之 reject (i18n key 字面) 不經遮罩. 形態類案 (網址整串、密碼、帳:密、查詢秘密值、Error 保型、有界) 由 wsemi 共用語料 _diagCases 與 wsemi 自身測試負責, 本檔只測接線:
//  OM-S 站點接線 (原始碼: 工廠宣告、遮罩站點全集與其文字、固定詞彙不包、外來值讀取皆有歸屬、缺 diag 即拋)
//  OM-F 工廠 genDiag(url): 秘密來源 (連線字串列網址、檔案位置列路徑不遮對外值、無明列秘密時樣式規則仍作用)
//  OM-P procCore 之出口 (假 woItems 直接拋含憑證之 Error, 模擬 w-serv-orm 或驅動未遮罩之上游): runOps msg (補償失敗與原因)、guarded 轉拋、archiveSweep 補償失敗 msg 與 throw
//  OM-L lockSave 之轉拋
//  WWebTask 層之出口 (runApi、getFile、wrapErrLog、封存掃描 catch) 由 api-ormLeak 之真實後端守
//測試數據: 密碼與網址為虛構值 (無真實主機); 不寫 ./tmp、不起 server
import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import cacheSt from 'wsemi/src/cacheSt.mjs'
import getDiag from 'wsemi/src/getDiag.mjs'
import getDiagSecrets from 'wsemi/src/getDiagSecrets.mjs'
import pmKeyMutex from 'wsemi/src/pmKeyMutex.mjs'
import procCore from '../server/procCore.mjs'
import createLockSave from '../server/lockSave.mjs'
import genDiag from '../server/genDiag.mjs'
import ds from '../src/schema/index.mjs'
import { makeTable, mkLocks } from './tools/memTables.mjs'


const __dir = path.dirname(fileURLToPath(import.meta.url))
const SERVER = path.resolve(__dir, '..', 'server')

//虛構憑證: 以三種形態出現在上游錯誤原文 (網址帳密、password= 鍵值、裸密碼); 裸密碼只有「秘密來源」能遮, 樣式規則遮不到
const PW = 'Zx9Lk-leak41'
const URL_CRED = `postgres://admin:${PW}@db.example.com:5432/app`
const LEAK_TEXT = `ECONNREFUSED connect ${URL_CRED} failed; password=${PW}; auth rejected for ${PW}`
const leakErr = () => new Error(LEAK_TEXT)

const USER = 'id-for-human'
const AGENT = 'id-for-agent'


//stripCode: 去掉整行註解與行尾註解 (行尾以「空白＋//」判定, 本檔掃描之行不含 URL 字面)
function codeLines(file) {
    let text = fs.readFileSync(path.join(SERVER, file), 'utf8')
    let r = []
    let inBlock = false
    for (let ln of text.split(/\r?\n/)) {
        let t = ln.trim()
        if (inBlock) {
            if (t.includes('*/')) {
                inBlock = false
            }
            continue
        }
        if (t.startsWith('/*')) {
            inBlock = !t.includes('*/')
            continue
        }
        if (t.startsWith('//') || t.startsWith('*')) {
            continue
        }
        let k = t.indexOf(' //')
        r.push(k >= 0 ? t.slice(0, k).trimEnd() : t)
    }
    return r
}


//serverFiles: server/ 下全部 .mjs
function serverFiles() {
    return fs.readdirSync(SERVER).filter((fn) => fn.endsWith('.mjs')).sort()
}


//passDiag: 不遮罩之替身 diag (只用於隔離): 讓 lockSave 這一層不遮罩, 才看得出 procCore 自己的轉拋站是否已遮 (否則 lockSave 之轉拋站會把漏遮補上, 使 procCore 站點漏包測不出)
const passDiag = Object.assign((v) => v, { err: (v) => v, mask: (v) => v })


//mkEnv: 假 woItems (記憶體表, 可個別改成拋含憑證之 Error) + 真實 guardWrite / withTabLocks (w-serv-orm) + 真實 lockSave + 記憶體 srLog; diag 可指定, lockDiag 為 lockSave 所用之 diag (缺省同 diag)
function mkEnv(diag, lockDiag = diag) {
    let woItems = {
        channels: makeTable(),
        channelMembers: makeTable(),
        messages: makeTable(),
        messagesArchive: makeTable(),
        tasks: makeTable(),
        tasksArchive: makeTable(),
        files: makeTable(),
    }
    let errors = []
    let srLog = {
        info() {},
        warn() {},
        error(o) {
            errors.push(o)
        },
    }
    let cst = cacheSt()
    let lockSave = createLockSave(cst, lockDiag)
    let pc = procCore({ woItems, procOrm: null, ds, srLog, kmx: pmKeyMutex(), lockSave, diag, ...mkLocks(woItems) })
    return { pc, woItems, errors, close: () => cst.clear() }
}


//assertNoLeak: 文字不含網址整串、密碼、password= 之密碼值; 但保留非秘密之診斷字樣 (遮罩不是整段丟棄)
function assertNoLeak(text, label) {
    assert.ok(!text.includes(PW), `${label} 不得含密碼, 實得 ${text}`)
    assert.ok(!text.includes(URL_CRED), `${label} 不得含連線字串, 實得 ${text}`)
    assert.ok(text.includes('ECONNREFUSED'), `${label} 應保留非秘密之診斷字樣(遮罩非整段丟棄), 實得 ${text}`)
    assert.ok(text.includes('***'), `${label} 應含遮罩標記, 實得 ${text}`)
}


//seedChannel: 一筆頻道 (供 archiveSweep 與頻道寫入用)
async function seedChannel(woItems) {
    let ch = ds.channels.funNew({ name: 'Demo Channel', agentId: AGENT, ownerId: USER, userId: USER })
    ch.id = 'id-for-channel-om'
    await woItems.channels.insert(ch)
    return ch
}


describe('unit-ormDiagMask(外來值遮罩出口 diag 之接線, R-ORMDIAG-07, dspec D3)', function() {
    this.timeout(30000)

    // ── OM-S 站點接線 ──────────────────────────────────────────────────────────
    describe('OM-S 站點接線(原始碼)', function() {

        it('OM-S-01 server/genDiag.mjs 之宣告: wsemi getDiag({}, { secrets: getDiagSecrets({ conns: [url] }) }), 秘密分類取自 wsemi 單一定義(getDiagSecrets 之 conns), 不 import w-serv-orm 之任何檔, 不另寫遮罩', function() {
            //R-ORMDIAG-07「遮罩一律由 wsemi 單一擁有, 本套件只宣告秘密來源」; R-ORMDIAG-08「不 import w-serv-orm 之內部檔」(w-serv-orm 1.1.23 已刪 getUrlSecrets)
            let src = fs.readFileSync(path.join(SERVER, 'genDiag.mjs'), 'utf8')
            let code = codeLines('genDiag.mjs').join('\n')
            assert.ok(/^import getDiag from 'wsemi\/src\/getDiag\.mjs'$/m.test(src))
            assert.ok(/^import getDiagSecrets from 'wsemi\/src\/getDiagSecrets\.mjs'$/m.test(src))
            assert.ok(code.includes('return getDiag({}, { secrets: getDiagSecrets({ conns: [url] }) })'), `宣告不符: ${code}`)
            assert.ok(!/w-serv-orm|getUrlSecrets|getDiagBrief/.test(code), `genDiag 不得再取用 w-serv-orm 之內部檔或已刪之 getUrlSecrets: ${code}`)
            //不自寫遮罩: 無 RegExp 字面量遮蔽、無 replace、無 '***' 字面
            assert.ok(!/\.replace\(|\*\*\*|new RegExp/.test(code), `genDiag 不得自寫遮罩: ${code}`)
        })

        it('OM-S-02 遮罩站點全集: server/*.mjs 中 diag.err( / diag.mask( 之呼叫恰為下列 8 行 (新增或漏包站點即失敗, 須先歸類後改此表)', function() {
            //R-ORMDIAG-07 站點全集: 外來值出口 7 站 (含 errMsg 共用 3 站) + 轉拋 4 站
            let got = []
            for (let fn of serverFiles()) {
                for (let ln of codeLines(fn)) {
                    if (/\bdiag\.(err|mask)\(/.test(ln)) {
                        got.push(`${fn}: ${ln}`)
                    }
                }
            }
            let want = [
                //WWebTask.mjs: runApi 失敗 msg (回遠端 + srLog)、wrapErrLog (srLog + 轉出之 reject)、封存掃描 catch (srLog msg)、getFile catch (404 回應 + srLog)
                `WWebTask.mjs: r.msg = diag.mask(r.msg)`,
                `WWebTask.mjs: let e = diag.err(err)`,
                `WWebTask.mjs: srLog.error({ event: 'archiveSweep-error', msg: diag.mask(String((typeof err === 'string') ? err : ((err && err.message) || 'unknown'))) })`,
                `WWebTask.mjs: let key = diag.mask(isestr(err) ? err : get(err, 'message', 'errFileNotFound'))`,
                //lockSave.mjs: fn 之 reject 轉出
                `lockSave.mjs: return Promise.reject(diag.err(err))`,
                //procCore.mjs: errMsg (runOps 原因與補償失敗、archiveSweep 補償失敗之 msg)、guarded 轉出、archiveSweep 補償後轉拋
                `procCore.mjs: return diag.mask(String((e && e.message) || e))`,
                `procCore.mjs: return Promise.reject(diag.err(err))`,
                `procCore.mjs: throw diag.err(err)`,
            ]
            assert.deepStrictEqual(got.sort(), want.sort())
        })

        it('OM-S-03 errMsg 之使用站恰 3 處 (runOps 原因與補償失敗、archiveSweep 補償失敗), srLog 之 msg 不再直接取 .message', function() {
            let all = codeLines('procCore.mjs')
            assert.strictEqual(all.filter((ln) => ln === 'let errMsg = (e) => {').length, 1, 'errMsg 應恰 1 個定義')
            let lines = all.filter((ln) => /\berrMsg\(/.test(ln))
            assert.strictEqual(lines.length, 3, `errMsg 應 3 處使用, 實得 ${JSON.stringify(lines)}`)
            assert.strictEqual(lines.filter((ln) => /msg: errMsg\(err2\)/.test(ln)).length, 2)
            assert.strictEqual(lines.filter((ln) => ln === 'let msg = errMsg(err)').length, 1)
        })

        it('OM-S-04 固定詞彙不包: 無 diag.err / diag.mask 之引數為字串或樣板字面', function() {
            //dspec D3「套件自身以固定詞彙組成之 reject 不經遮罩」
            let bad = []
            for (let fn of serverFiles()) {
                for (let ln of codeLines(fn)) {
                    if (/\bdiag\.(err|mask)\(\s*['"`]/.test(ln)) {
                        bad.push(`${fn}: ${ln}`)
                    }
                }
            }
            assert.deepStrictEqual(bad, [])
        })

        it('OM-S-05 外來值讀取皆有歸屬: server/ 下讀取 .message 之行與原樣轉出 (throw / Promise.reject 帶變數) 之行恰為下列已歸類者', function() {
            //R-ORMDIAG-07「新增外來值出口須先歸類 (遮罩 / 固定詞彙 / 上游已遮)」: 此表為站點全集之反向盤點
            let msgs = []
            let raw = []
            for (let fn of serverFiles()) {
                for (let ln of codeLines(fn)) {
                    if (/\.message\b/.test(ln)) {
                        msgs.push(`${fn}: ${ln}`)
                    }
                    if (/\bPromise\.reject\((err\d?|e)\)|\bthrow (err\d?|e)\s*$/.test(ln)) {
                        raw.push(`${fn}: ${ln}`)
                    }
                }
            }
            //.message 讀取: runApi 把 Error 轉 message 後緊接 diag.mask (OM-S-02 固定); 封存掃描 catch 與 errMsg 已在 OM-S-02 逐字固定 (getFile 用 get(err, 'message') 讀取, 同在 OM-S-02);
            //wrapInjected 之 .message 只用於比對 key 集合 (describeUpstream 只回型別與合格名稱, 不含原文)
            assert.deepStrictEqual(msgs.sort(), [
                `WWebTask.mjs: r.msg = r.msg.message`,
                `WWebTask.mjs: srLog.error({ event: 'archiveSweep-error', msg: diag.mask(String((typeof err === 'string') ? err : ((err && err.message) || 'unknown'))) })`,
                `procCore.mjs: return diag.mask(String((e && e.message) || e))`,
                `wrapInjected.mjs: let v = isErr(err) ? err.message : err`,
            ].sort())
            //原樣轉出: WServOrm 初始化失敗 (上游 w-serv-orm 於丟出前已遮罩) 與 wrapErrLog 轉出遮罩後之 e
            assert.deepStrictEqual(raw.sort(), [
                `WWebTask.mjs: return Promise.reject(e)`,
                `WWebTask.mjs: throw err`,
            ])
        })

        it('OM-S-06 缺 diag 即拋 (不以未遮罩狀態運作): createLockSave 與 procCore', function() {
            let cst = cacheSt()
            try {
                assert.throws(() => createLockSave(cst), /invalid diag/)
                assert.throws(() => createLockSave(cst, null), /invalid diag/)
                assert.throws(() => createLockSave(cst, () => {}), /invalid diag/) //缺 err
                let woItems = { channels: makeTable() }
                let base = { woItems, procOrm: null, ds, srLog: { info() {}, warn() {}, error() {} }, kmx: pmKeyMutex(), lockSave: createLockSave(cst, genDiag('./db')), ...mkLocks(woItems) }
                assert.throws(() => procCore(base), /need diag/)
                assert.throws(() => procCore({ ...base, diag: () => {} }), /need diag/) //缺 err、mask
                let half = () => {}
                half.err = (v) => v
                assert.throws(() => procCore({ ...base, diag: half }), /need diag/) //缺 mask
                assert.doesNotThrow(() => procCore({ ...base, diag: genDiag('./db') }))
            }
            finally {
                cst.clear()
            }
        })

    })


    // ── OM-F 工廠 ─────────────────────────────────────────────────────────────
    describe('OM-F 工廠 genDiag(url)', function() {

        it('OM-F-01 連線字串列為網址: 網址整串、密碼 (含裸密碼)、password= 皆遮 (diag.mask 與 diag.err)', function() {
            let diag = genDiag(URL_CRED)
            assertNoLeak(diag.mask(LEAK_TEXT), 'diag.mask')
            let e = diag.err(leakErr())
            assert.ok(e instanceof Error, 'diag.err 保型')
            assertNoLeak(e.message, 'diag.err message')
        })

        it('OM-F-02 檔案位置 (lmdb、lowdb 等) 列為儲存路徑: 對外值不遮路徑 (dspec Q3), 憑證形態仍遮', function() {
            let diag = genDiag('./db')
            assert.strictEqual(diag.mask('open ./db failed'), 'open ./db failed')
            let m = diag.mask('open ./db failed password=abcd1234')
            assert.ok(m.includes('./db') && !m.includes('abcd1234'), m)
            assert.strictEqual(genDiag('D:/data/db').mask('open D:/data/db failed'), 'open D:/data/db failed')
        })

        it('OM-F-03 無明列秘密時樣式規則仍作用: 網址帳密、password=、Bearer 皆遮', function() {
            let diag = genDiag('./db')
            let m = diag.mask('x postgres://u:p4ss1234@h:5432/db password=abcd1234 Bearer abc.def-123456 ./db')
            assert.ok(!m.includes('p4ss1234') && !m.includes('abcd1234') && !m.includes('abc.def-123456'), m)
            assert.ok(m.includes('./db'))
        })

        it('OM-F-04 無應遮者回原物件 (身分不變); 固定 key 原樣', function() {
            let diag = genDiag(URL_CRED)
            let e = new Error('plain failure')
            assert.strictEqual(diag.err(e), e)
            assert.strictEqual(diag.err('saveStale'), 'saveStale')
            assert.strictEqual(diag.mask('errFileNotFound'), 'errFileNotFound')
        })

        it('OM-F-06 連線位址分類(dspec 規則: 含 :// 或 @ 者列網址, 其餘列儲存路徑): genDiag(url) 與依該規則明列 urls / paths 者遮罩結果逐字相同', function() {
            //getDiagSecrets 之 conns 取代 w-serv-orm 已刪之 getUrlSecrets(結果相同, wsemi 語料 U22); 此處以測試端明列之分類規則作獨立對照, 不經 genDiag
            let addrs = [
                URL_CRED,
                'mongodb://h.example.com:27017/db',
                'svc-user:Qw8Rt-conn77@h.example.com',
                './db',
                'D:/data/db',
                'C:\\data\\db02',
                '/var/lib/worm-db',
                './my db dir',
            ]
            for (let u of addrs) {
                let isConn = u.includes('://') || u.includes('@')
                let ref = getDiag({}, { secrets: getDiagSecrets(isConn ? { urls: [u] } : { paths: [u] }) })
                let text = `open ${u} failed; password=abcd1234; tail ${u}`
                assert.strictEqual(genDiag(u).mask(text), ref.mask(text), `mask 不一致: ${u}`)
                let e = new Error(text)
                assert.strictEqual(genDiag(u).err(e).message, ref.err(e).message, `err 不一致: ${u}`)
            }
            //確實有分兩類: 連線字串之整串被遮, 檔案位置不被遮
            assert.ok(!genDiag(URL_CRED).mask(`x ${URL_CRED}`).includes(PW))
            assert.ok(genDiag('./db').mask('x ./db').includes('./db'))
        })

        it('OM-F-05 永不拋錯: url 為非字串、空字串、物件時仍回可用之 diag', function() {
            for (let u of [undefined, null, 123, '', {}, []]) {
                let diag = genDiag(u)
                assert.strictEqual(typeof diag.err, 'function')
                assert.strictEqual(typeof diag.mask, 'function')
                assert.doesNotThrow(() => diag.err(leakErr()))
                assert.doesNotThrow(() => diag.mask(LEAK_TEXT))
            }
        })

    })


    // ── OM-P procCore ─────────────────────────────────────────────────────────
    describe('OM-P procCore 之出口(上游未遮罩之情境)', function() {

        let env = null
        afterEach(function() {
            if (env) {
                env.close()
                env = null
            }
        })

        it('OM-P-01 runOps 寫入失敗且補償亦失敗: 回固定 key saveWriteFail; srLog 之原因 msg 與補償失敗 msg 皆已遮罩', async function() {
            //E2 (runOps 原因 msg)、E1 (補償失敗 msg); 對呼叫者之 reject 仍為固定 key 且經 guarded 轉出後不變
            env = mkEnv(genDiag(URL_CRED))
            env.woItems.channels.insert = async () => {
                throw leakErr()
            }
            env.woItems.channels.del = async () => {
                throw leakErr()
            }
            await assert.rejects(() => env.pc.saveChannel(USER, { name: 'om-leak' }), (e) => {
                assert.strictEqual(e, 'saveWriteFail')
                return true
            })
            let ev = env.errors.filter((o) => o.event === 'saveChannels' || o.event === 'saveChannels-rollback-fail')
            assert.deepStrictEqual(ev.map((o) => o.event).sort(), ['saveChannels', 'saveChannels-rollback-fail'])
            for (let o of ev) {
                assert.strictEqual(o.err, 'saveWriteFail')
                assertNoLeak(o.msg, `${o.event}.msg`)
            }
            assert.ok(!JSON.stringify(env.errors).includes(PW))
        })

        it('OM-P-02 runOps 寫入失敗、補償成功: 回固定 key saveRolledBack; 原因 msg 已遮罩', async function() {
            env = mkEnv(genDiag(URL_CRED))
            env.woItems.channels.insert = async () => {
                throw leakErr()
            }
            await assert.rejects(() => env.pc.saveChannel(USER, { name: 'om-leak' }), (e) => {
                assert.strictEqual(e, 'saveRolledBack')
                return true
            })
            assert.strictEqual(env.errors.length, 1)
            assert.strictEqual(env.errors[0].event, 'saveChannels')
            assertNoLeak(env.errors[0].msg, 'saveChannels.msg')
        })

        it('OM-P-03 guarded 轉拋: guardWrite 之新鮮讀取拋含憑證之 Error → 對外 reject 為遮罩後之同型 Error', async function() {
            //T1 (guarded 其餘分支來源不明, 轉出前 diag.err); lockSave 以 passDiag 隔離, 使漏包時不被 lockSave 之轉拋站補上
            env = mkEnv(genDiag(URL_CRED), passDiag)
            env.woItems.channels.select = async () => {
                throw leakErr()
            }
            await assert.rejects(() => env.pc.saveChannel(USER, { name: 'om-leak' }), (e) => {
                assert.ok(e instanceof Error, `應為 Error, 實得 ${typeof e}`)
                assertNoLeak(e.message, 'reject.message')
                return true
            })
        })

        it('OM-P-09 guarded 轉拋: 遮罩副本保型 (自訂錯誤類別、name、code 不變, 只換 message)', async function() {
            //dspec D2「maskDiagErr 回保型副本 (Reflect.construct)」: 呼叫端依 instanceof / name / code 判斷驅動錯誤者不受影響
            class DriverErr extends Error {
                constructor(m) {
                    super(m)
                    this.name = 'DriverErr'
                    this.code = '28P01'
                }
            }
            env = mkEnv(genDiag(URL_CRED), passDiag)
            env.woItems.channels.select = async () => {
                throw new DriverErr(LEAK_TEXT)
            }
            await assert.rejects(() => env.pc.saveChannel(USER, { name: 'om-leak' }), (e) => {
                assert.ok(e instanceof DriverErr, `應保持自訂類別, 實得 ${e && e.constructor && e.constructor.name}`)
                assert.strictEqual(e.name, 'DriverErr')
                assert.strictEqual(e.code, '28P01')
                assertNoLeak(e.message, 'reject.message')
                return true
            })
        })

        it('OM-P-10 guarded 之固定 key 不包: 秘密恰等於 errRowNotFound 時, 刪除不存在之頻道仍原樣 reject errRowNotFound', async function() {
            //guarded 把 guardWrite 之拒收鍵 rowNotFound 轉為本套件語系鍵 'errRowNotFound' (字面 reject): 若被誤包 diag.err 即成 '***'; lockSave 以 passDiag 隔離
            env = mkEnv(genDiag('postgres://admin:errRowNotFound@db.example.com:5432/app'), passDiag)
            await assert.rejects(() => env.pc.deleteChannel(USER, 'no-such-channel'), (e) => {
                assert.strictEqual(e, 'errRowNotFound')
                return true
            })
        })

        it('OM-P-04 guarded 轉拋: 無應遮者之 Error 身分不變 (不多做副本)', async function() {
            env = mkEnv(genDiag(URL_CRED), passDiag)
            let plain = new Error('plain failure')
            env.woItems.channels.select = async () => {
                throw plain
            }
            await assert.rejects(() => env.pc.saveChannel(USER, { name: 'om-leak' }), (e) => {
                assert.strictEqual(e, plain)
                return true
            })
        })

        it('OM-P-05 固定詞彙不包: 秘密恰等於某固定 key 時, 字面 reject 仍原樣 (誤包即變 ***)', async function() {
            //url 密碼 = 'errFileNotFound' → 若 getFileInfo 之字面 reject 被誤包 diag.err 即成 '***'
            env = mkEnv(genDiag('postgres://admin:errFileNotFound@db.example.com:5432/app'))
            await assert.rejects(() => env.pc.getFileInfo(USER, 'no-such-file'), (e) => {
                assert.strictEqual(e, 'errFileNotFound')
                return true
            })
            //另一固定 key (無輸入): 同樣原樣
            await assert.rejects(() => env.pc.getFileInfo(USER, 123), (e) => {
                assert.strictEqual(e, 'errFileIdInvalid')
                return true
            })
        })

        it('OM-P-06 getFileInfo 外來值: files.select 拋含憑證之 Error 時 procCore 原樣上拋 (遮罩於 WWebTask 出口, 見 api-ormLeak)', async function() {
            //站點事實: getFileInfo 非 procCore 之出口站, 外來值經 WWebTask 之 runApi / getFile / wrapErrLog 遮罩 (OM-S-02 站點全集)
            env = mkEnv(genDiag(URL_CRED))
            env.woItems.files.select = async () => {
                throw leakErr()
            }
            await assert.rejects(() => env.pc.getFileInfo(USER, 'id-x'), (e) => {
                assert.strictEqual(e.message, LEAK_TEXT)
                return true
            })
        })

        it('OM-P-07 archiveSweep: 熱表刪除失敗且撤回冷表複本亦失敗 → srLog 補償失敗 msg 已遮罩; 對外 throw 為遮罩後之 Error', async function() {
            //E3 (補償失敗 msg)、T2 (補償後轉拋)
            env = mkEnv(genDiag(URL_CRED))
            await seedChannel(env.woItems)
            let t = ds.tasks.funNew({ channelId: 'id-for-channel-om', title: 't-old', payload: 'p', state: 'done', userId: USER })
            t.id = 't-old-om'
            t.timeDone = '2020-01-01T00:00:00.000+08:00'
            await env.woItems.tasks.insert(t)
            env.woItems.tasks.del = async () => {
                throw leakErr()
            }
            env.woItems.tasksArchive.del = async () => {
                throw leakErr()
            }
            await assert.rejects(() => env.pc.archiveSweep(30), (e) => {
                assert.ok(e instanceof Error)
                assertNoLeak(e.message, 'archiveSweep throw')
                return true
            })
            let ev = env.errors.filter((o) => o.event === 'archiveSweep-undo-fail')
            assert.strictEqual(ev.length, 1)
            assert.strictEqual(ev[0].err, 'saveWriteFail')
            assertNoLeak(ev[0].msg, 'archiveSweep-undo-fail.msg')
        })

        it('OM-P-08 archiveSweep: 熱表刪除失敗、撤回冷表複本成功 → 不記補償失敗; 對外 throw 為遮罩後之 Error', async function() {
            env = mkEnv(genDiag(URL_CRED))
            await seedChannel(env.woItems)
            let t = ds.tasks.funNew({ channelId: 'id-for-channel-om', title: 't-old', payload: 'p', state: 'done', userId: USER })
            t.id = 't-old-om'
            t.timeDone = '2020-01-01T00:00:00.000+08:00'
            await env.woItems.tasks.insert(t)
            env.woItems.tasks.del = async () => {
                throw leakErr()
            }
            await assert.rejects(() => env.pc.archiveSweep(30), (e) => {
                assertNoLeak(e.message, 'archiveSweep throw')
                return true
            })
            assert.strictEqual(env.errors.filter((o) => o.event === 'archiveSweep-undo-fail').length, 0)
        })

    })


    // ── OM-L lockSave ─────────────────────────────────────────────────────────
    describe('OM-L lockSave 之轉拋', function() {

        let cst = null
        afterEach(function() {
            if (cst) {
                cst.clear()
                cst = null
            }
        })

        it('OM-L-01 fn 之 reject 為含憑證之 Error → 轉出遮罩後之同型 Error', async function() {
            //T3 (fn 之 reject 來源不明)
            cst = cacheSt()
            let lockSave = createLockSave(cst, genDiag(URL_CRED))
            await assert.rejects(() => lockSave('op', 'u1', async () => {
                throw leakErr()
            }), (e) => {
                assert.ok(e instanceof Error)
                assertNoLeak(e.message, 'lockSave reject')
                return true
            })
        })

        it('OM-L-04 遮罩副本保型: 自訂錯誤類別、name、code 不變, 只換 message', async function() {
            cst = cacheSt()
            let lockSave = createLockSave(cst, genDiag(URL_CRED))
            class DriverErr extends Error {
                constructor(m) {
                    super(m)
                    this.name = 'DriverErr'
                    this.code = '28P01'
                }
            }
            await assert.rejects(() => lockSave('op', 'u6', async () => {
                throw new DriverErr(LEAK_TEXT)
            }), (e) => {
                assert.ok(e instanceof DriverErr)
                assert.strictEqual(e.name, 'DriverErr')
                assert.strictEqual(e.code, '28P01')
                assertNoLeak(e.message, 'lockSave reject')
                return true
            })
        })

        it('OM-L-02 fn 之 reject 為字串 (含憑證) → 轉出遮罩後之字串; 為固定 key 原樣', async function() {
            cst = cacheSt()
            let lockSave = createLockSave(cst, genDiag(URL_CRED))
            await assert.rejects(() => lockSave('op', 'u2', async () => Promise.reject(LEAK_TEXT)), (e) => {
                assert.strictEqual(typeof e, 'string')
                assertNoLeak(e, 'lockSave string reject')
                return true
            })
            await assert.rejects(() => lockSave('op', 'u3', async () => Promise.reject('errChannelNotFound')), (e) => e === 'errChannelNotFound')
        })

        it('OM-L-03 占位衝突之固定 key (預設 saveInProgress 與 opt.errKey) 不包: 秘密恰等於該 key 時仍原樣', async function() {
            //url 密碼 = 'saveInProgress' / 'myBusyKey' → 若 remap 後之字面 reject 被誤包 diag.err 即成 '***'
            //第 1 次以受控 deferred 持有占位 (不依賴時序), 第 2 次同一操作者同一操作即被拒
            let mkHold = () => {
                let release = null
                let p = new Promise((resolve) => {
                    release = resolve
                })
                return { p, release }
            }
            cst = cacheSt()
            let lockSave = createLockSave(cst, genDiag('postgres://admin:saveInProgress@db.example.com:5432/app'))
            let h1 = mkHold()
            let first = lockSave('op', 'u4', async () => await h1.p)
            await assert.rejects(() => lockSave('op', 'u4', async () => 1), (e) => e === 'saveInProgress')
            h1.release()
            await first
            cst.clear()
            cst = cacheSt()
            let lockSave2 = createLockSave(cst, genDiag('postgres://admin:myBusyKey@db.example.com:5432/app'))
            let h2 = mkHold()
            let first2 = lockSave2('op', 'u5', async () => await h2.p, { errKey: 'myBusyKey' })
            await assert.rejects(() => lockSave2('op', 'u5', async () => 1, { errKey: 'myBusyKey' }), (e) => e === 'myBusyKey')
            h2.release()
            await first2
        })

    })

})
