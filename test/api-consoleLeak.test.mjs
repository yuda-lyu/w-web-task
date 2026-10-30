//api-consoleLeak: console 輸出站點之不變式 —— 以同一組含識別值之測資觸發各站點, 斷言 console 輸出不含該值 (真實 WWebTask / 真實 srv.mjs 之程式碼; 不需 browser)
//對應 dspec〈診斷輸出與遮罩〉D2「預設不輸出資料值」(使用者 2026-10-29 裁示)、〈輸入參數之檢測機制〉§6 V20; 主控裁定: console 診斷只印鍵名、型別或固定詞彙, 權杖經 maskTok 照舊;
//spec/設計要點與取捨.md D22; 規則帳本 R-CONSOLE-02、R-CONSOLE-03; 站點全集之結構守衛見 unit-consoleSites
//測資: 識別值 S = 'ZZ-secret-9317' 置於 使用者物件(各欄位與額外欄位)、請求本體(JSON 陣列 / 長字串)、查詢參數、建構參數(WOrm / url / db / 三個注入函數)、後端錯誤原文(ORM 初始化失敗、SSO 回傳值、種子腳本之資料庫與檔案錯誤)
//斷言: ①每個站點之 console 輸出段含固定詞彙與預期之安全形態(證明站點確實觸發且輸出為鍵名 / 型別 / 摘要); ②全部 console 輸出(stdout + stderr)不含 S、其頭尾片段 ('ZZ-s'、'9317')、使用者信箱網域與堆疊框;
//      ③回應與擲出之行為與修前相同 (key 不變; 建構無效參數仍同步拋錯)
//  CL-A  server/WWebTask.mjs 之全部 console 站點 (子行程 tools/consoleLeakChild.mjs: 真實 WWebTask + 真實 lmdb + 真實 HTTP 與資料通道; 以 '@@SITE <id>' 標記切分輸出)
//  CL-B  srv.mjs 之 console 站點 (srv.mjs 之副本, 只改兩行 import: 設定改指本測試之假 SSO、WWebTask 改以絕對路徑載入; 其餘一字不動)
//  CL-C  g.initialData.mjs 之 console 站點 (副本, 只改 import 與測資注入點; 以 node 直接執行副本使其 main-guard 成立)
//port: 11310 (CL-A)、11311 (CL-B 之 srv)、11312 (CL-B 之假 SSO) 固定 (≥ 8000、不隨機; harness 另用 11108 / 8091 / 11208, api-ormDiag 11308, api-ormLeak 11309; 子行程一次性, 結束即釋放)
//工作目錄 test/_tmp/consoleLeak/ (測試自己清)
//跑法: npx mocha test/api-consoleLeak.test.mjs --timeout 180000(須持測試鎖)
import assert from 'assert'
import fs from 'fs'
import http from 'http'
import path from 'path'
import { spawn } from 'child_process'
import { fileURLToPath, pathToFileURL } from 'url'


const __dir = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dir, '..')
const DIR = path.resolve(__dir, '_tmp', 'consoleLeak')
const CHILD_A = path.resolve(__dir, 'tools', 'consoleLeakChild.mjs')
const PORT_A = 11310
const PORT_SRV = 11311
const PORT_SSO = 11312
const S = 'ZZ-secret-9317' //須與 tools/consoleLeakChild.mjs 一致


let sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))


//runNode: 起子行程收 stdout / stderr; 逾時即終止; 回 { code, out, err }
function runNode(args, opt = {}, ms = 120000) {
    return new Promise((resolve, reject) => {
        let child = spawn(process.execPath, args, { windowsHide: true, ...opt })
        let out = ''
        let err = ''
        child.stdout.on('data', (d) => {
            out += d
        })
        child.stderr.on('data', (d) => {
            err += d
        })
        let t = setTimeout(() => {
            child.kill()
            reject(new Error(`子行程逾時, stdout: ${out}, stderr: ${err}`))
        }, ms)
        child.on('exit', (code) => {
            clearTimeout(t)
            resolve({ code, out, err })
        })
    })
}


//segments: 以 '@@SITE <id>' 標記切分 stdout; 回 { id: 該段文字 }
function segments(out) {
    let seg = {}
    let cur = '(pre)'
    seg[cur] = []
    for (let line of out.split(/\r?\n/)) {
        let m = line.match(/^@@SITE (\S+)$/)
        if (m) {
            cur = m[1]
            seg[cur] = []
        }
        else {
            seg[cur].push(line)
        }
    }
    let r = {}
    for (let k of Object.keys(seg)) {
        r[k] = seg[k].join('\n')
    }
    return r
}


//assertNoValue: 文字不含識別值、其頭尾片段、使用者信箱網域與堆疊框 (maskTok 契約露出之頭尾字元亦不得含識別值之片段)
function assertNoValue(text, label) {
    assert.ok(!text.includes(S), `${label} 不得含識別值, 實得:\n${text}`)
    assert.ok(!text.includes('ZZ-s') && !text.includes('9317'), `${label} 不得含識別值之頭尾片段, 實得:\n${text}`)
    assert.ok(!text.includes('example.com'), `${label} 不得含使用者信箱, 實得:\n${text}`)
    assert.ok(!/^\s+at .+\(.+\)$/m.test(text) && !/^\s+at file:/m.test(text), `${label} 不得含堆疊框, 實得:\n${text}`)
}


//readResults: 子行程之 results.ndjson → { step: record }
function readResults(dir) {
    let rs = {}
    for (let line of fs.readFileSync(path.join(dir, 'results.ndjson'), 'utf8').split(/\r?\n/).filter(Boolean)) {
        let o = JSON.parse(line)
        rs[o.step] = o
    }
    return rs
}


//patch: 副本之置換; 每個 from 必須恰出現一次 (否則來源已變動, 明確失敗而非靜默略過)
function patch(src, pairs) {
    let r = src
    for (let [from, to] of pairs) {
        let n = r.split(from).length - 1
        assert.strictEqual(n, 1, `來源應恰有 1 處「${from}」, 實得 ${n} 處 (來源變動時須同步本測試之副本置換)`)
        r = r.replace(from, () => to)
    }
    return r
}


describe('api-consoleLeak(console 輸出站點: 含識別值之測資觸發全部站點, console 不含該值; D2)', function() {
    this.timeout(240000)

    before(function() {
        fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
        fs.mkdirSync(DIR, { recursive: true })
    })

    after(function() {
        fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
        try {
            fs.rmdirSync(path.join(__dir, '_tmp')) //空才移除(與 harness 並存時不動)
        }
        catch (err) {}
    })


    // ── CL-A: server/WWebTask.mjs ─────────────────────────────────────────
    describe('CL-A server/WWebTask.mjs 之 console 站點(真實 WWebTask)', function() {
        let dirA = path.join(DIR, 'a')
        let r = null //子行程結果 { code, out, err }
        let seg = null //stdout 分段
        let rs = null //results.ndjson

        before(async function() {
            fs.mkdirSync(dirA, { recursive: true })
            r = await runNode([CHILD_A, dirA, String(PORT_A)], { cwd: dirA })
            seg = segments(r.out)
            rs = readResults(dirA)
        })

        //site: 斷言某站點之 console 段含預期之固定詞彙 / 安全形態, 且不含識別值
        let site = (id, expects, forbids = []) => {
            assert.ok(seg[id] !== undefined, `應有站點段 ${id}, 實得 ${Object.keys(seg).join(', ')}`)
            for (let e of expects) {
                assert.ok(seg[id].includes(e), `${id} 應含「${e}」, 實得:\n${seg[id]}`)
            }
            for (let f of forbids) {
                assert.ok(!seg[id].includes(f), `${id} 不得含「${f}」, 實得:\n${seg[id]}`)
            }
            assertNoValue(seg[id], id)
        }

        it('CL-A-00 子行程正常結束, 各站點皆已觸發(有段)', function() {
            assert.strictEqual(r.code, 0, `子行程應正常結束, stdout: ${r.out}, stderr: ${r.err}`)
            for (let id of ['C01-invalid-WOrm', 'C02-invalid-url', 'C03-invalid-db', 'C04-invalid-getUserByToken', 'C05-invalid-verifyClientUser', 'C06-invalid-verifyAppUser', 'C07-orm-init-failed', 'C08-entry-generate', 'R01-checkUser-id', 'R02-checkUser-email', 'R03-checkUser-name', 'R04-checkUser-role', 'R05-client-denied', 'R06-app-denied', 'R07a-payload-array', 'R07b-payload-string', 'R07c-payload-nonjson', 'R08a-query-no-token', 'R08b-query-token-array', 'R09-user-not-found', 'R10-verifyConn-invalid-token', 'R11a-getUserId-not-found', 'R11b-getUserId-denied', 'R11c-getUserId-incomplete', 'END']) {
                assert.ok(seg[id] !== undefined, `缺站點段 ${id}`)
            }
        })

        // 建構參數無效: 傳入值 (物件含帳密欄位、字串) 不得入 console, 只印型別; 仍同步拋錯 (行為不變)
        for (let [id, label, ty] of [
            ['C01-invalid-WOrm', 'invalid WOrm', 'object'],
            ['C02-invalid-url', 'invalid url', 'object'],
            ['C03-invalid-db', 'invalid db', 'object'],
            ['C04-invalid-getUserByToken', 'invalid getUserByToken', 'string'],
            ['C05-invalid-verifyClientUser', 'invalid verifyClientUser', 'object'],
            ['C06-invalid-verifyAppUser', 'invalid verifyAppUser', 'string'],
        ]) {
            it(`CL-A-${id.slice(0, 3)} 建構參數無效(${label}): console 只印型別 (typeof ${ty}), 不含傳入值; 仍同步拋錯`, function() {
                site(id, [`${label} (typeof ${ty})`])
                assert.strictEqual(rs[id].threw, true, '建構無效參數仍須拋錯')
            })
        }

        it('CL-A-C07 ORM 初始化失敗(後端錯誤原文含識別值與連線字串帳密): console 只印錯誤類別摘要, 不含原文與堆疊; 仍拋錯', function() {
            site('C07-orm-init-failed', ['WServOrm init failed', `errType: 'Error'`], ['postgres://', 'password=', 'db.example.com'])
            assert.strictEqual(rs['C07-orm-init-failed'].threw, true)
        })

        it('CL-A-C08 靜態檔入口不存在: console 印部署路徑與固定詞彙, 錯誤只印類別摘要(無訊息文字、無堆疊); 服務照常啟動', function() {
            site('C08-entry-generate', ['fpEntryIn', 'can not generate index.html', `errType: 'Error'`], ['invalid fpEntryIn'])
            assert.ok(seg['C08-end'] !== undefined, '建構完成且服務就緒(子行程印出 C08-end 標記)')
        })

        // 使用者物件: 欄位值與額外欄位皆含識別值; console 只印鍵名, 回應之 key 不變
        for (let [id, expects, key] of [
            ['R01-checkUser-id', ['invalid user (keys: id,name,email,isAdmin,note)', 'can not get the userId'], 'errUserIdMissing'],
            ['R02-checkUser-email', ['invalid user (keys: id,name,email,isAdmin,note)', 'can not get the email of user'], 'errUserEmailMissing'],
            ['R03-checkUser-name', ['invalid user (keys: id,name,email,isAdmin,note)', 'can not get userName'], 'errUserNameMissing'],
            ['R04-checkUser-role', ['invalid user (keys: id,name,email,isAdmin,note)', 'user.isAdmin is not y or n (typeof string)', 'can not get the role of user'], 'errUserRoleMissing'],
            ['R05-client-denied', ['denied user (keys: id,name,email,isAdmin,note)', 'user does not have permission'], 'errUserNoPermission'],
            ['R06-app-denied', ['denied user (keys: id,name,email,isAdmin,note)', 'user does not have permission'], 'errUserNoPermission'],
        ]) {
            it(`CL-A-${id.slice(0, 3)} 使用者物件(${id.slice(4)}): console 只印鍵名, 不含欄位值與額外欄位值; 回應 key 為 ${key}`, function() {
                site(id, expects)
                let body = JSON.parse(rs[id].text)
                assert.strictEqual(body.state, 'error')
                assert.strictEqual(body.msg, key)
            })
        }

        // 請求本體: 無效本體 (JSON 陣列、長字串) 不得入 console (含 maskTok 之頭尾字元), 只印型別
        it('CL-A-R07 無效請求本體(JSON 陣列、JSON 字串字面值、非 JSON 長字串; 皆含識別值): console 只印型別, 不含本體之任何片段(含 maskTok 之頭尾字元); 回應 key 不變', function() {
            //R07a: application/json 之陣列 → (typeof array); R07b: text/plain 之 JSON 字串字面值 → (typeof string); R07c: text/plain 之非 JSON 長字串 → j2o 回 {} → (typeof object)
            //(修前 maskTok: 陣列與字串印頭尾字元 'ZZ-s...9317(len=42)', 非 JSON 印 '(object)')
            site('R07a-payload-array', ['payload (typeof array)', 'invalid payload in req'])
            site('R07b-payload-string', ['payload (typeof string)', 'invalid payload in req'])
            site('R07c-payload-nonjson', ['payload (typeof object)', 'invalid payload in req'])
            for (let id of ['R07a-payload-array', 'R07b-payload-string', 'R07c-payload-nonjson']) {
                assert.strictEqual(JSON.parse(rs[id].text).msg, 'errPayloadInvalid', id)
            }
        })

        // 查詢參數: 整包 query 不得原樣印出 (非 token 鍵之值含識別值), 只印鍵名; token 經 maskTok 照舊
        it('CL-A-R08 /api/getUserByToken 無效 token 分支: console 之 query 只印鍵名; token(含重複 ?token= 之陣列)經 maskTok 照舊; 回應 key 不變', function() {
            site('R08a-query-no-token', ['req.query (keys: agentId,note)', '[API]getUserByToken/check token: invalid token'])
            site('R08b-query-token-array', ['req.query (keys: token,agentId)', 't...x(len=14)', '[API]getUserByToken/check token: invalid token'])
            assert.strictEqual(JSON.parse(rs['R08a-query-no-token'].text).msg, 'errTokenNoPermission')
            assert.strictEqual(JSON.parse(rs['R08b-query-token-array'].text).msg, 'errTokenNoPermission')
        })

        // 權杖類: maskTok 照舊 (主控裁定)
        it('CL-A-R09 token 查無使用者: console 之 token 經 maskTok(頭尾字元與長度), 固定詞彙照舊; 回應 errUserNotFound', function() {
            site('R09-user-not-found', ['token tk...xx(len=19)', 'can not find the user from token'])
            assert.strictEqual(JSON.parse(rs['R09-user-not-found'].text).msg, 'errUserNotFound')
        })

        it('CL-A-R10 連線閘 Authorization 非 Bearer(值含識別值): console 之 authorization 經 maskTok, apiType 為路由表之固定字面; 不含識別值全值與片段', function() {
            site('R10-verifyConn-invalid-token', ['apiType main', 'authorization Basi...tion(len=', 'invalid token'])
        })

        it('CL-A-R11 執行身分 getUserIdByToken(本體 token 查無 / 授權不通過 / 欄位不齊): console 之 token 經 maskTok, 使用者物件只印鍵名', function() {
            site('R11a-getUserId-not-found', ['token tk...xx(len=19)', 'can not get the userId from token'])
            site('R11b-getUserId-denied', ['token t...d(len=9)', 'user does not have permission for execution'])
            site('R11c-getUserId-incomplete', ['invalid user (keys: id,name,email,isAdmin,note)', 'can not get the userId', 'can not get the userId from token'])
        })

        it('CL-A-G 全域: 全部 console 輸出(stdout + stderr)不含識別值、頭尾片段、使用者信箱與堆疊框', function() {
            assertNoValue(r.out, 'stdout')
            assertNoValue(r.err, 'stderr')
        })
    })


    // ── CL-B: srv.mjs ──────────────────────────────────────────────────────
    describe('CL-B srv.mjs 之 console 站點(srv.mjs 副本 + 假 SSO)', function() {
        let dirB = path.join(DIR, 'b')
        let sso = null
        let child = null
        let out = ''
        let err = ''

        //假 SSO: value 為 sso-state → 回 state 與 msg 皆含識別值之 JSON (200); sso-500 → HTTP 500 且本文含識別值
        before(async function() {
            fs.mkdirSync(dirB, { recursive: true })
            sso = http.createServer((req, res) => {
                let value = new URL(req.url, 'http://x').searchParams.get('value')
                if (value === 'sso-500') {
                    res.writeHead(500, { 'Content-Type': 'application/json' })
                    res.end(JSON.stringify({ state: 'error', msg: `${S} backend failure` }))
                    return
                }
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ state: S, msg: S }))
            })
            await new Promise((resolve, reject) => {
                sso.once('error', reject)
                sso.listen(PORT_SSO, '127.0.0.1', resolve)
            })

            //srv.mjs 副本: 只改兩行 import (設定改指假 SSO 並帶 app token; WWebTask 以絕對路徑載入), 其餘一字不動
            let src = fs.readFileSync(path.join(ROOT, 'srv.mjs'), 'utf8')
            src = patch(src, [
                [`import getSettings from './g.getSettings.mjs'`, `let getSettings = () => ({ dbUrl: './db', dbName: 'wtask', ssoBaseUrl: 'http://127.0.0.1:${PORT_SSO}', ssoAppToken: 'app-${S}', ssoLoginUrl: 'http://localhost:11007/' })`],
                [`from './server/WWebTask.mjs'`, `from '${pathToFileURL(path.join(ROOT, 'server', 'WWebTask.mjs')).href}'`],
            ])
            fs.writeFileSync(path.join(dirB, 'srvCopy.mjs'), src, 'utf8')
            fs.writeFileSync(path.join(dirB, 'settings.json'), JSON.stringify({ serverPort: PORT_SRV, logFd: './logs', archiveAfterDays: 0, language: 'eng' }), 'utf8')

            child = spawn(process.execPath, [path.join(dirB, 'srvCopy.mjs'), path.join(dirB, 'settings.json')], { cwd: dirB, windowsHide: true })
            child.stdout.on('data', (d) => {
                out += d
            })
            child.stderr.on('data', (d) => {
                err += d
            })
            let ready = false
            for (let k = 0; k < 200 && !ready; k++) {
                ready = await fetch(`http://127.0.0.1:${PORT_SRV}/`).then((x) => x.status > 0).catch(() => false)
                if (!ready) {
                    await sleep(100)
                }
            }
            assert.ok(ready, `srv 副本未就緒, stdout: ${out}, stderr: ${err}`)
        })

        after(async function() {
            if (child) {
                child.kill()
                await new Promise((resolve) => {
                    child.once('exit', resolve)
                    setTimeout(resolve, 5000)
                })
            }
            if (sso) {
                await new Promise((resolve) => sso.close(resolve))
            }
        })

        //hit: 發出請求, 等其 console 輸出(以固定前綴同步; 修前修後相同)出現並靜止後, 回該請求新增之輸出
        let hit = async (fire, prefix) => {
            let from = out.length
            await fire()
            let t0 = Date.now()
            while (!out.slice(from).includes(prefix) && Date.now() - t0 < 10000) {
                await sleep(25)
            }
            let last = -1
            while (out.length !== last) { //靜止: 連續兩次取樣長度不變 (否定斷言之短暫觀察窗)
                last = out.length
                await sleep(150)
            }
            return out.slice(from)
        }

        it('CL-B-01 SSO 回傳 state 非 success(state 與 msg 含識別值): console 只印固定詞彙, 不含後端回傳值', async function() {
            let seg = await hit(() => fetch(`http://127.0.0.1:${PORT_SRV}/api/getUserByToken?token=sso-state`), 'SSO getSsoUserInfor')
            assert.ok(seg.includes('SSO getSsoUserInfor 失敗'), `應印固定詞彙, 實得:\n${seg}`)
            assertNoValue(seg, 'srv SSO state 站點')
        })

        it('CL-B-02 SSO 請求例外(HTTP 500, 回應本文含識別值): console 只印錯誤類別摘要與整數狀態碼, 不含本文與訊息', async function() {
            let seg = await hit(() => fetch(`http://127.0.0.1:${PORT_SRV}/api/getUserByToken?token=sso-500`), 'SSO getSsoUserInfor')
            assert.ok(seg.includes('SSO getSsoUserInfor error') && seg.includes(`errType: 'Error'`) && seg.includes('httpStatus: 500'), `應印錯誤類別與狀態碼, 實得:\n${seg}`)
            assertNoValue(seg, 'srv SSO error 站點')
        })

        it(`CL-B-03 WWebTask 之 'error' 事件: console 只印錯誤類別摘要(不印事件原文)`, async function() {
            //連線閘 verifyConn 認證失敗 → w-converhp 發出 error 事件 (其原文為「verifyConn error for apiType[main]: <key>」)
            let seg = await hit(() => fetch(`http://127.0.0.1:${PORT_SRV}/api/main`, { method: 'POST', headers: { 'Authorization': 'Bearer sso-state', 'Content-Type': 'application/octet-stream' }, body: Buffer.from([0]) }), 'verifyConn error for apiType[main]')
            assert.ok(seg.includes(`WWebTask error event { errType: 'string' }`), `應印事件之類別摘要, 實得:\n${seg}`)
        })

        it('CL-B-G 全域: srv 副本之全部 console 輸出(stdout + stderr)不含識別值、頭尾片段、使用者信箱與堆疊框', function() {
            assertNoValue(out, 'srv stdout')
            assertNoValue(err, 'srv stderr')
        })
    })


    // ── CL-C: g.initialData.mjs ────────────────────────────────────────────
    describe('CL-C g.initialData.mjs 之 console 站點(副本; 資料庫與檔案之錯誤原文含識別值)', function() {
        let dirC = path.join(DIR, 'c')

        //副本只改: 資料庫 import(改為替身), 種子 schema 之相對路徑(改絕對), 以及(CL-C-02)檔案目錄為含 NUL 與識別值之路徑 (fs 錯誤訊息內含該路徑)
        let makeCopy = (name, woItemsExpr, dbfExpr) => {
            let src = fs.readFileSync(path.join(ROOT, 'g.initialData.mjs'), 'utf8')
            let pairs = [
                [`import { woItems } from './g.mOrm.mjs'`, `const woItems = ${woItemsExpr}`],
                [`from './src/schema/index.mjs'`, `from '${pathToFileURL(path.join(ROOT, 'src', 'schema', 'index.mjs')).href}'`],
            ]
            if (dbfExpr) {
                pairs.push([`let dbfDir = './dbf'`, `let dbfDir = ${dbfExpr}`])
            }
            let f = path.join(dirC, `${name}.mjs`)
            fs.writeFileSync(f, patch(src, pairs), 'utf8')
            return f
        }

        before(function() {
            fs.mkdirSync(dirC, { recursive: true })
        })

        it('CL-C-01 種子寫入失敗(後端錯誤原文含識別值與連線字串帳密): console 只印錯誤類別摘要, 不含原文與堆疊', async function() {
            let f = makeCopy('giFail', `new Proxy({}, { get: () => ({ delAll: async () => { throw new Error('write failed ${S} postgres://admin:${S}@db.example.com:5432/x') }, insert: async () => {} }) })`)
            let r = await runNode([f], { cwd: dirC })
            assert.ok(r.out.includes('initialData catch') && r.out.includes(`errType: 'Error'`), `應印錯誤類別摘要, 實得:\n${r.out}\n${r.err}`)
            assert.ok(!r.out.includes('postgres://') && !r.out.includes('db.example.com'), `不得含連線字串, 實得:\n${r.out}`)
            assertNoValue(r.out, 'gi stdout')
            assertNoValue(r.err, 'gi stderr')
        })

        it('CL-C-02 清空 dbf 失敗(檔案系統錯誤訊息含路徑, 路徑含識別值): console 只印錯誤類別摘要, 不含 err.message', async function() {
            let f = makeCopy('giDbf', `new Proxy({}, { get: () => ({ delAll: async () => {}, insert: async () => {} }) })`, `'${path.join(dirC, S).split('\\').join('/')}\\u0000bad'`)
            let r = await runNode([f], { cwd: dirC })
            assert.ok(r.out.includes('clear dbf warn') && r.out.includes(`errType: 'TypeError'`) && r.out.includes('finish.'), `應印錯誤類別摘要並照常結束, 實得:\n${r.out}\n${r.err}`)
            assertNoValue(r.out, 'gi stdout')
            assertNoValue(r.err, 'gi stderr')
        })
    })

})
