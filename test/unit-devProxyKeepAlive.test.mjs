//測試 dev server 之 /api proxy 重用連線(規則帳本 R-E2E-PROXY-01; 排程第 347 項, 2026-11-07 pt347)
//
//受測: vue.config.js 之 devServer.proxy['/api'], 經與實際 dev server 相同之建構路徑——@vue/cli-service 之 prepareProxy(合併預設值) →
//      http-proxy-middleware 之 createProxyMiddleware(context, config)(webpack-dev-server lib/Server.js 同法)——掛在本機 http 服務上。
//背景: http-proxy 未給 agent 時以 agent:false 每個請求新開一條至後端之連線並送 Connection: close(http-proxy lib/http-proxy/common.js:62-73),
//      後端回應之 connection: close 又被原樣轉回瀏覽器(web-outgoing.js:42-47), 使每個 /api 請求於「瀏覽器→dev server」「dev server→後端」兩段各新開一條連線、
//      各留一個 TIME_WAIT(伺服端先關者其「本機埠」為服務埠, 看 TIME_WAIT 須本機埠與遠端埠兩欄都看)。
//契約(R-E2E-PROXY-01):
//  1. 連續 N 個經 proxy 之請求, 後端只建立 1 條連線(dev server→後端重用), 不是每請求 1 條。
//  2. 回給瀏覽器之回應不帶 Connection: close, 瀏覽器端(以 keep-alive 用戶端模擬)N 個請求只用 1 條連線。
//  3. 請求照常抵達後端、回應內容不變: 路徑(含 /api 前綴與查詢字串)、方法、狀態碼、內文逐一相同。
//埠: 後端與 proxy 皆 listen(0)(作業系統配發), 不用寫死之埠; vue.config.js 之 target 預設 11008 / 環境變數 WTASK_DEV_PROXY_TARGET 不在受測範圍(本測試改指自建後端, 其餘選項原樣)。
//跑法: node C:/opensrcOper/tools/quiet-run.mjs --name devProxy --lock -- npx mocha test/unit-devProxyKeepAlive.test.mjs --timeout 60000
import http from 'http'
import path from 'path'
import assert from 'assert'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'

const A = assert.strict
const require = createRequire(import.meta.url)
const fdTest = path.dirname(fileURLToPath(import.meta.url))
const projRoot = path.join(fdTest, '..')
const N = 20

//以 dev server 之實際建構路徑取得 /api 之 proxy 設定(target 改指本測試之後端, 其餘選項原樣)
function loadApiProxyConfig(target) {
    let fp = path.join(projRoot, 'vue.config.js')
    delete require.cache[require.resolve(fp)]
    let vueConfig = require(fp)
    let prepareProxy = require('@vue/cli-service/lib/util/prepareProxy.js')
    let entries = prepareProxy(vueConfig.devServer.proxy, path.join(projRoot, 'public'))
    let e = entries.find((x) => typeof x.context === 'function' && x.context('/api/x', { method: 'GET', headers: {} }))
    A.ok(e, 'vue.config.js 須有 /api 之 proxy 設定')
    return { ...e, target }
}

function listen(srv) {
    return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv.address().port)))
}

function closeServer(srv) {
    return new Promise((resolve) => {
        srv.close(() => resolve())
        srv.closeAllConnections()
    })
}

//以 keep-alive 用戶端(瀏覽器同為 keep-alive)依序送 N 個請求
function getVia(agent, port, p) {
    return new Promise((resolve, reject) => {
        let req = http.request({ host: '127.0.0.1', port, path: p, method: 'GET', agent }, (res) => {
            let chunks = []
            res.on('data', (c) => chunks.push(c))
            res.on('end', () => resolve({ status: res.statusCode, connection: res.headers.connection, body: Buffer.concat(chunks).toString('utf8') }))
        })
        req.on('error', reject)
        req.end()
    })
}

describe('dev server /api proxy 重用連線 (R-E2E-PROXY-01)', function() {
    let backend = null
    let front = null
    let cfg = null
    let clientAgent = null
    let nBackendConn = 0
    let nFrontConn = 0
    let res = []

    before(async function() {
        let { createProxyMiddleware } = require('http-proxy-middleware')
        backend = http.createServer((req, resp) => {
            resp.setHeader('content-type', 'application/json')
            resp.end(JSON.stringify({ url: req.url, method: req.method }))
        })
        backend.on('connection', () => {
            nBackendConn++
        })
        let pb = await listen(backend)
        cfg = loadApiProxyConfig(`http://127.0.0.1:${pb}`)
        let mw = createProxyMiddleware(cfg.context, cfg)
        front = http.createServer((req, resp) => {
            mw(req, resp, () => {
                resp.statusCode = 404
                resp.end('not proxied')
            })
        })
        front.on('connection', () => {
            nFrontConn++
        })
        let pf = await listen(front)
        clientAgent = new http.Agent({ keepAlive: true, maxSockets: 1 })
        for (let i = 0; i < N; i++) {
            res.push(await getVia(clientAgent, pf, `/api/getChannelsList?i=${i}`))
        }
    })

    after(async function() {
        if (clientAgent) {
            clientAgent.destroy()
        }
        if (cfg && cfg.agent && typeof cfg.agent.destroy === 'function') {
            cfg.agent.destroy()
        }
        if (front) {
            await closeServer(front)
        }
        if (backend) {
            await closeServer(backend)
        }
    })

    it('PX-001 [契約1] N 個經 proxy 之請求, 後端只建立 1 條連線', function() {
        A.equal(nBackendConn, 1, `後端連線數 ${nBackendConn}(請求 ${N} 個); 每請求一條即 proxy 未重用連線`)
    })

    it('PX-002 [契約2] 回給瀏覽器之回應不帶 Connection: close, 用戶端 N 個請求只用 1 條連線', function() {
        let closes = res.filter((r) => String(r.connection || '').toLowerCase() === 'close').length
        A.equal(closes, 0, `${closes}/${N} 個回應帶 Connection: close`)
        A.equal(nFrontConn, 1, `用戶端至 dev server 之連線數 ${nFrontConn}(請求 ${N} 個)`)
    })

    it('PX-003 [契約3] 請求照常抵達後端, 路徑、方法、狀態碼、內文不變', function() {
        A.equal(res.length, N)
        res.forEach((r, i) => {
            A.equal(r.status, 200, `第 ${i} 個狀態碼`)
            A.deepEqual(JSON.parse(r.body), { url: `/api/getChannelsList?i=${i}`, method: 'GET' }, `第 ${i} 個內文`)
        })
    })
})
