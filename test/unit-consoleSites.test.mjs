//unit-consoleSites: console 輸出站點之結構不變式 + describeKeys / describeType 之單元測試 (不需 server / browser)
//對應 dspec〈診斷輸出與遮罩〉D2「預設不輸出資料值」(使用者 2026-10-29 裁示)、〈輸入參數之檢測機制〉§6 V20「訊息與 throw / reject 前之 console 皆不含輸入值」;
//spec/設計要點與取捨.md D22 (取代 D15 之「不做: console 印使用者物件 (N7)」); 規則帳本 R-CONSOLE-01～03
//  CS-R「掃描器本身」: 合成原始碼逐形態判定 (違規形態被抓、合規形態放行、console 別名被抓) —— 守「規則能抓」, 避免掃描器壞掉而全綠
//  CS-S「站點全集 + 逐站合規」: 掃 server/ + 根目錄 *.mjs + toolg/ + src/schema/ 之全部 console 呼叫:
//        每檔站點數須等於下表 (新增或刪除站點即失敗, 須先歸類後改表); 每個引數須為字面值、固定詞彙樣板、明列之非資料值識別字或遮罩 / 摘要函數之呼叫
//        (使用者物件、請求本體、傳入參數、後端回傳值、錯誤物件、.message 之讀取一律違規); 全部檔案無 console 別名
//  CS-H「describeKeys / describeType」: 只輸出型別或鍵名 (有界、控制字元換 ?), 絕不讀值、不執行 getter、永不拋錯
//跑法: npx mocha test/unit-consoleSites.test.mjs --timeout 180000(須持測試鎖)
import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { scanSource, findConsoleAlias, listFiles } from './tools/consoleSites.mjs'


const __dir = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dir, '..')


//ALLOW_BASE: 遮罩 / 摘要函數 (其引數不限; 輸出契約由 CS-H 與 unit-maskLog 守)
const ALLOW_BASE = { fns: ['maskTok', 'maskQuery', 'maskUrl', 'describeKeys', 'describeType', 'getDiagBriefErr'], idents: [] }

//ALLOW_FILE: 各檔明列之非資料值 (每項附依據; 新增須先歸類)
//  server/WWebTask.mjs  apiType: w-converhp routeSpec 表之固定字面 ('main' / 'upload-controller' …, 非請求值; node_modules/w-converhp/src/routeSpec.mjs)
//                       fpEntryIn / fnEntryOut: 靜態檔入口之部署路徑與固定檔名 (由 'dist' 與常數組成, 不含任何傳入參數或請求值)
//  srv.mjs              briefSsoErr: srv.mjs 內之 SSO 例外摘要函數 (只輸出 getDiagBriefErr 之 errType / errCode 與整數 HTTP 狀態碼)
const ALLOW_FILE = {
    'server/WWebTask.mjs': { fns: [], idents: ['apiType', 'fpEntryIn', 'fnEntryOut'] },
    'srv.mjs': { fns: ['briefSsoErr'], idents: [] },
}

//EXPECT_COUNT: 各檔 console 站點數 (活碼; 註解不計). 未列之檔為 0
const EXPECT_COUNT = {
    'server/WWebTask.mjs': 39,
    'srv.mjs': 4,
    'g.initialData.mjs': 3,
}


//filesScanned: 掃描範圍 (相對專案根; 斜線)
function filesScanned() {
    let abs = [
        ...listFiles(path.join(ROOT, 'server')),
        ...listFiles(path.join(ROOT, 'toolg')),
        ...listFiles(path.join(ROOT, 'src', 'schema')),
        ...fs.readdirSync(ROOT).filter((fn) => /\.mjs$/.test(fn)).map((fn) => path.join(ROOT, fn)),
    ]
    return abs.map((p) => path.relative(ROOT, p).split(path.sep).join('/')).sort()
}


describe('unit-consoleSites(console 輸出站點之結構不變式; D2 預設不輸出資料值)', function() {
    this.timeout(60000)


    // ── CS-R: 掃描器本身 ─────────────────────────────────────────────────
    describe('CS-R 掃描器本身(合成原始碼)', function() {

        let allow = { fns: ['maskTok', 'describeKeys'], idents: ['apiType'] }
        let bad = (src) => scanSource(src, allow).filter((s) => !s.ok).length
        let n = (src) => scanSource(src, allow).length

        it('CS-R-01 違規形態被抓: 使用者物件、請求本體、傳入參數、後端回傳值、錯誤物件、.message、成員讀取、拼接、未明列函數之呼叫', function() {
            assert.strictEqual(bad(`console.log('user', user)`), 1)
            assert.strictEqual(bad(`console.log('payload', payload)`), 1)
            assert.strictEqual(bad(`console.log('invalid url', url)`), 1)
            assert.strictEqual(bad(`console.log('state', state)`), 1)
            assert.strictEqual(bad(`console.log(err)`), 1)
            assert.strictEqual(bad(`console.log('x', err.message)`), 1)
            assert.strictEqual(bad(`console.log('x', user.isAdmin)`), 1)
            assert.strictEqual(bad(`console.log('x' + user.id)`), 1)
            assert.strictEqual(bad(`console.log('x', pickUser(user))`), 1)
            assert.strictEqual(bad(`console.log('x', get(err, 'name', ''))`), 1)
            assert.strictEqual(bad(`console.log(\`id[\${user.id}]\`)`), 1)
            assert.strictEqual(bad(`console.log(\`id[\${id}]\`)`), 1)
            assert.strictEqual(bad(`console.log('x', { a: 1 })`), 1)
            assert.strictEqual(bad(`console.log('x', ...args)`), 1)
        })

        it('CS-R-02 合規形態放行: 字面值、固定詞彙樣板、明列識別字、遮罩 / 摘要函數(引數不限)', function() {
            assert.strictEqual(bad(`console.log('invalid user')`), 0)
            assert.strictEqual(bad(`console.log('n', 12, true, null)`), 0)
            assert.strictEqual(bad(`console.log(\`fixed text\`)`), 0)
            assert.strictEqual(bad(`console.log('apiType', apiType)`), 0)
            assert.strictEqual(bad(`console.log(\`type[\${apiType}]\`)`), 0)
            assert.strictEqual(bad(`console.log('token', maskTok(token))`), 0)
            assert.strictEqual(bad(`console.log('user', describeKeys(user))`), 0)
        })

        it('CS-R-03 全部 console.<方法> 皆計入(log / warn / error / info / debug / trace / dir / table); 註解內之 console 不計', function() {
            for (let m of ['log', 'warn', 'error', 'info', 'debug', 'trace', 'dir', 'table']) {
                assert.strictEqual(n(`console.${m}('x')`), 1, m)
                assert.strictEqual(bad(`console.${m}(user)`), 1, m)
            }
            assert.strictEqual(n(`// console.log('x', user)\n/* console.log(user) */ let a = 1`), 0)
            assert.strictEqual(n(`let s = "console.log(user)"`), 0)
        })

        it('CS-R-04 巢狀(callback / catch / 箭頭函數內)之站點亦計入, 行號為呼叫所在行', function() {
            let src = `a.catch((err) => {\n    console.log('x', err)\n})\nlet f = () => console.error('y')`
            let sites = scanSource(src, allow)
            assert.deepStrictEqual(sites.map((s) => [s.line, s.method, s.ok]), [[2, 'log', false], [4, 'error', true]])
        })

        it('CS-R-05 console 別名被抓(賦值、解構、傳參、computed、未呼叫之成員): 繞過站點掃描之寫法一律違規; window.console 之屬性名與物件鍵不算', function() {
            assert.deepStrictEqual(findConsoleAlias(`let log = console.log\nlog(user)`), [1])
            assert.deepStrictEqual(findConsoleAlias(`const { log } = console`), [1])
            assert.deepStrictEqual(findConsoleAlias(`f(console)`), [1])
            assert.deepStrictEqual(findConsoleAlias(`console['log'](user)`), [1])
            assert.deepStrictEqual(findConsoleAlias(`let o = { console: 1 }; window.console.x`), [])
            assert.deepStrictEqual(findConsoleAlias(`console.log('a'); console.warn('b')`), [])
        })

    })


    // ── CS-S: 站點全集與逐站合規 ───────────────────────────────────────────
    describe('CS-S 站點全集與逐站合規(server/、根目錄 *.mjs、toolg/、src/schema/)', function() {

        let files = filesScanned()
        let table = {} //file → sites
        before(function() {
            for (let f of files) {
                let src = fs.readFileSync(path.join(ROOT, f), 'utf8')
                let a = ALLOW_FILE[f] || {}
                table[f] = scanSource(src, { fns: [...ALLOW_BASE.fns, ...(a.fns || [])], idents: [...ALLOW_BASE.idents, ...(a.idents || [])] })
            }
        })

        it('CS-S-00 掃描範圍含 server/WWebTask.mjs、srv.mjs、g.initialData.mjs(範圍不得悄悄縮小)', function() {
            for (let f of ['server/WWebTask.mjs', 'server/maskLog.mjs', 'srv.mjs', 'g.initialData.mjs', 'g.mOrm.mjs']) {
                assert.ok(files.includes(f), `掃描範圍應含 ${f}, 實得 ${files.join(', ')}`)
            }
        })

        it('CS-S-01 站點全集: 各檔 console 站點數等於登錄表(新增或刪除站點須先歸類後改 EXPECT_COUNT)', function() {
            let got = {}
            for (let f of files) {
                if (table[f].length > 0) {
                    got[f] = table[f].length
                }
            }
            assert.deepStrictEqual(got, EXPECT_COUNT)
        })

        it('CS-S-02 逐站合規: 每個 console 引數皆為字面值、固定詞彙樣板、明列識別字或遮罩 / 摘要函數之呼叫', function() {
            let viol = []
            for (let f of files) {
                for (let s of table[f]) {
                    for (let a of s.args) {
                        if (!a.ok) {
                            viol.push(`${f}:${s.line} console.${s.method}(… ${a.text.slice(0, 60)} …) → ${a.reason}`)
                        }
                    }
                }
            }
            assert.deepStrictEqual(viol, [], `違規站點:\n${viol.join('\n')}`)
        })

        it('CS-S-03 無 console 別名(let log = console.log、解構、傳參、computed 成員皆繞過 CS-S-02)', function() {
            let viol = []
            for (let f of files) {
                let src = fs.readFileSync(path.join(ROOT, f), 'utf8')
                for (let line of findConsoleAlias(src)) {
                    viol.push(`${f}:${line}`)
                }
            }
            assert.deepStrictEqual(viol, [])
        })

        it('CS-S-04 明列之非資料值識別字確有其用(未使用之放行項須自表中移除, 不留空白支票)', function() {
            for (let f of Object.keys(ALLOW_FILE)) {
                let used = new Set()
                for (let s of table[f]) {
                    for (let a of s.args) {
                        for (let id of ALLOW_FILE[f].idents || []) {
                            if (new RegExp(`\\b${id}\\b`).test(a.text)) {
                                used.add(id)
                            }
                        }
                        for (let fn of ALLOW_FILE[f].fns || []) {
                            if (new RegExp(`\\b${fn}\\(`).test(a.text)) {
                                used.add(fn)
                            }
                        }
                    }
                }
                let all = [...(ALLOW_FILE[f].idents || []), ...(ALLOW_FILE[f].fns || [])]
                assert.deepStrictEqual(all.filter((x) => !used.has(x)), [], `${f} 之放行項未被使用`)
            }
        })

    })


    // ── CS-H: describeKeys / describeType ─────────────────────────────────
    describe('CS-H describeKeys / describeType(只輸出型別或鍵名; 有界; 永不拋錯)', function() {

        let m = null
        let loadErr = null
        before(async function() {
            try {
                m = await import('../server/maskLog.mjs')
            }
            catch (err) {
                loadErr = err
            }
        })
        let fn = (name) => {
            assert.ok(m, `server/maskLog.mjs 無法載入: ${loadErr && (loadErr.code || loadErr.name)}`)
            assert.strictEqual(typeof m[name], 'function', `server/maskLog.mjs 應匯出函數 ${name}`)
            return m[name]
        }

        it('CS-H-01 describeType: 型別描述為固定詞彙 (typeof 名稱; null / array 另列), 不含任何值', function() {
            let describeType = fn('describeType')
            let rows = [
                [undefined, '(typeof undefined)'],
                [null, '(typeof null)'],
                ['ZZ-secret-9317', '(typeof string)'],
                ['', '(typeof string)'],
                [12345, '(typeof number)'],
                [true, '(typeof boolean)'],
                [10n, '(typeof bigint)'],
                [Symbol('ZZ-secret-9317'), '(typeof symbol)'],
                [() => 'ZZ-secret-9317', '(typeof function)'],
                [['ZZ-secret-9317'], '(typeof array)'],
                [{ a: 'ZZ-secret-9317' }, '(typeof object)'],
                [new Date(0), '(typeof object)'],
            ]
            for (let [inp, exp] of rows) {
                assert.strictEqual(describeType(inp), exp)
            }
        })

        it('CS-H-02 describeKeys: 物件只列自有可列舉字串鍵名, 不含任何值; 非物件 / 陣列 / null 回 describeType 之結果', function() {
            let describeKeys = fn('describeKeys')
            assert.strictEqual(describeKeys({ id: 'ZZ-secret-9317', name: 'ZZ-secret-9317', email: 'ZZ-secret-9317@x', isAdmin: 'y' }), '(keys: id,name,email,isAdmin)')
            assert.strictEqual(describeKeys({}), '(no keys)')
            assert.strictEqual(describeKeys(['ZZ-secret-9317']), '(typeof array)')
            assert.strictEqual(describeKeys(null), '(typeof null)')
            assert.strictEqual(describeKeys('ZZ-secret-9317'), '(typeof string)')
            assert.strictEqual(describeKeys(undefined), '(typeof undefined)')
            assert.strictEqual(describeKeys(() => 1), '(typeof function)')
        })

        it('CS-H-03 describeKeys: 不讀值、不執行 getter (getter 內拋錯或有副作用皆不觸發); Symbol 鍵與不可列舉鍵不列; null-prototype 物件(Hapi req.query 之型態)可處理', function() {
            let describeKeys = fn('describeKeys')
            let hit = 0
            let o = {
                get secret() {
                    hit++
                    throw new Error('ZZ-secret-9317')
                },
                plain: 1,
                [Symbol('ZZ-secret-9317')]: 2,
            }
            Object.defineProperty(o, 'hidden', { value: 'ZZ-secret-9317', enumerable: false })
            assert.strictEqual(describeKeys(o), '(keys: secret,plain)')
            assert.strictEqual(hit, 0, 'getter 不得被執行')
            let q = Object.create(null)
            q.token = 'x'
            q.agentId = 'ZZ-secret-9317'
            assert.strictEqual(describeKeys(q), '(keys: token,agentId)')
        })

        it('CS-H-04 describeKeys: 鍵名中之控制字元換成 ? (防 log 注入); 單一鍵名超過 32 字元截斷; 超過 20 個鍵只列前 20 個並註記其餘個數', function() {
            let describeKeys = fn('describeKeys')
            assert.strictEqual(describeKeys({ 'a\nFAKE log line\r\u0000b': 1 }), '(keys: a?FAKE log line??b)')
            let long = 'k'.repeat(40)
            assert.strictEqual(describeKeys({ [long]: 1 }), `(keys: ${'k'.repeat(32)}...)`)
            let many = {}
            for (let i = 1; i <= 25; i++) {
                many[`k${i}`] = i
            }
            let first20 = Array.from({ length: 20 }, (_, i) => `k${i + 1}`).join(',')
            assert.strictEqual(describeKeys(many), `(keys: ${first20},...+5)`)
        })

        it('CS-H-05 永不拋錯: 會拋錯之 Proxy(ownKeys / getOwnPropertyDescriptor 陷阱)與已撤銷之 Proxy 回型別描述', function() {
            let describeKeys = fn('describeKeys')
            let describeType = fn('describeType')
            let trap = new Proxy({}, {
                ownKeys() {
                    throw new Error('ZZ-secret-9317')
                },
            })
            assert.strictEqual(describeKeys(trap), '(typeof object)')
            let { proxy, revoke } = Proxy.revocable({}, {})
            revoke()
            assert.doesNotThrow(() => describeKeys(proxy))
            assert.doesNotThrow(() => describeType(proxy))
            assert.ok(!describeKeys(proxy).includes('ZZ-secret'))
        })

        it('CS-H-06 以含識別值之測資(使用者物件、查詢參數物件、請求本體)呼叫, 輸出不含該值與其片段', function() {
            let describeKeys = fn('describeKeys')
            let describeType = fn('describeType')
            let S = 'ZZ-secret-9317'
            let outs = [
                describeKeys({ id: S, name: S, email: `${S}@example.com`, isAdmin: S, extra: { deep: S } }),
                describeKeys({ agentId: S, token: S }),
                describeType(`${S}:request-body:${S}`),
                describeType([S, S]),
                describeType({ a: S }),
            ]
            for (let o of outs) {
                assert.ok(!o.includes(S) && !o.includes('ZZ-s') && !o.includes('9317'), `輸出不得含識別值或片段, 實得 ${o}`)
            }
        })

    })

})
