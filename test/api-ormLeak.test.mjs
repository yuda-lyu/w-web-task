//api-ormLeak: 上游 (w-serv-orm 或驅動) 未遮罩之錯誤原文,經真實 WWebTask 之外來值出口 (runApi、getFile、資料通道 wrapErrLog、封存掃描 catch) 離開本套件前須經 diag 遮罩之契約測試 (子行程起真實服務, 不需 browser)
//對應 dspec〈診斷輸出與遮罩〉D3「回給遠端之錯誤訊息、寫入日誌之錯誤值不含憑證; 固定詞彙 reject 不經遮罩」; spec/設計要點與取捨.md D21; 規則帳本 R-ORMDIAG-07
//  OL-01「HTTP REST 之失敗 msg (runApi) 不含憑證」→ getFileInfo 讀檔案表失敗: 回應 msg 與 srLog (event api/getFileInfo) 皆不含網址整串、密碼 (含 password= 與裸密碼), 保留非秘密字樣
//  OL-02「getFile 之 404 回應 msg 不含憑證」→ 同上, event api/getFile
//  OL-03「資料通道之失敗 (wrapErrLog) 不含憑證」→ 回應 output.msg 與 srLog (event kpfun-getFileInfo) 之 err 皆不含憑證
//  OL-04「固定詞彙不包」→ 檔案不存在之 key (errFileNotFound) 於三條出口皆原樣 (回應與 srLog)
//  OL-05「封存掃描失敗 (catch 出口) 之 srLog msg 不含憑證」→ event archiveSweep-error
//  OL-06「成功資料不遮」→ 頻道名稱恰含密碼字樣者,成功回應(資料通道 saveChannel 成功、REST getChannels 原樣含該名稱)
//  OL-07「全域: srLog 全文、stdout / stderr、失敗回應皆不含網址整串與密碼」
//子行程: test/tools/ormLeakChild.mjs (真實 WWebTask + 真實 lmdb + 真實 srLog; 工作目錄 test/_tmp/ormLeak/, 測試自己清)
//  上游未遮罩之模擬: 子行程之 WOrm 替身在 procCore 直接取用之表 (files.select、tasks.select) 拋含憑證之 Error; w-serv-orm 對 procOrm / kpExec 之遮罩不涵蓋 procCore 直取之 woItems, 故此為本套件自己的出口職責
//port: 11309 固定 (≥ 8000、不隨機; harness 另用 11108 / 8091 / 11208, api-ormDiag 用 11308; 子行程一次性, 結束即釋放)
//封存掃描首掃固定於啟動後 30 秒 (WWebTask 內), 子行程以事件 (srLog 出現 archiveSweep-error) 結束, 上限 70 秒
//跑法: npx mocha test/api-ormLeak.test.mjs --timeout 180000(須持測試鎖)
import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { parseRecords } from './tools/apiProbe.mjs'


const __dir = path.dirname(fileURLToPath(import.meta.url))
const DIR = path.resolve(__dir, '_tmp', 'ormLeak')
const CHILD = path.resolve(__dir, 'tools', 'ormLeakChild.mjs')
const PORT = 11309
const PW = 'Zx9Lk-leak41' //虛構密碼 (須與 tools/ormLeakChild.mjs 一致)
const URL_CRED = `postgres://admin:${PW}@db.example.com:5432/app`


//runChild: 起子行程, 收 stdout / stderr, 逾時即終止; 回 { code, out, results }
function runChild() {
    return new Promise((resolve, reject) => {
        let child = spawn(process.execPath, [CHILD, DIR, String(PORT)], { cwd: DIR, windowsHide: true })
        let out = ''
        child.stdout.on('data', (d) => {
            out += d
        })
        child.stderr.on('data', (d) => {
            out += d
        })
        let t = setTimeout(() => {
            child.kill()
            reject(new Error(`子行程逾時, 輸出: ${out}`))
        }, 120000)
        child.on('exit', (code) => {
            clearTimeout(t)
            let results = out.split(/\r?\n/).filter((l) => l.startsWith('RESULT:')).map((l) => JSON.parse(l.slice('RESULT:'.length)))
            resolve({ code, out, results })
        })
    })
}


//readLogs: 子行程工作目錄下 srLog 全文與逐筆記錄
function readLogs() {
    let dirLog = path.join(DIR, 'logs')
    let text = fs.readdirSync(dirLog).filter((fn) => fn.endsWith('.log')).sort().map((fn) => fs.readFileSync(path.join(dirLog, fn), 'utf8')).join('\n')
    return { text, recs: parseRecords(text) }
}


//assertMasked: 文字不含網址整串與密碼, 但保留非秘密字樣並有遮罩標記 (遮罩而非整段丟棄)
function assertMasked(text, label) {
    assert.ok(!text.includes(PW), `${label} 不得含密碼, 實得 ${text}`)
    assert.ok(!text.includes(URL_CRED), `${label} 不得含連線字串, 實得 ${text}`)
    assert.ok(text.includes('ECONNREFUSED'), `${label} 應保留非秘密字樣, 實得 ${text}`)
    assert.ok(text.includes('***'), `${label} 應含遮罩標記, 實得 ${text}`)
}


//textOf: srLog 記錄欄位 (字串或 pino 序列化之 err 物件) 轉全文
let textOf = (v) => (typeof v === 'string' ? v : JSON.stringify(v))


describe('api-ormLeak(真實 WWebTask: 上游未遮罩之錯誤原文於外來值出口遮罩, D3)', function() {
    this.timeout(180000)

    let r = null //子行程結果
    let lg = null //srLog
    let step = (name) => r.results.find((x) => x.step === name).r

    before(async function() {
        fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
        fs.mkdirSync(DIR, { recursive: true })
        r = await runChild()
        lg = readLogs()
    })

    after(function() {
        fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
        try {
            fs.rmdirSync(path.join(__dir, '_tmp')) //空才移除(與 harness 並存時不動)
        }
        catch (err) {}
    })

    it('OL-00 子行程正常結束且各步皆有回應', function() {
        assert.strictEqual(r.code, 0, `子行程應正常結束, 輸出: ${r.out}`)
        assert.deepStrictEqual(r.results.map((x) => x.step), ['rest-info-leak', 'rest-file-leak', 'rpc-info-leak', 'rest-info-fixed', 'rest-file-fixed', 'rpc-info-fixed', 'rpc-channel-ok', 'rest-channels-ok'])
    })

    it('OL-01 HTTP REST getFileInfo 讀檔案表失敗 (runApi 出口): 回應 msg 與 srLog 皆已遮罩', function() {
        let x = step('rest-info-leak')
        assert.strictEqual(x.status, 200)
        let body = JSON.parse(x.text)
        assert.strictEqual(body.state, 'error')
        assertMasked(body.msg, '回應 msg')
        let rec = lg.recs.filter((o) => o.event === 'api/getFileInfo' && o.level === 50)
        assert.strictEqual(rec.length, 2, `api/getFileInfo 之 error 記錄應 2 筆 (leak 與 fixed), 實得 ${JSON.stringify(rec)}`)
        assertMasked(textOf(rec[0].err), 'srLog err')
    })

    it('OL-02 HTTP REST getFile 讀檔案表失敗 (getFile catch 出口): 404 回應 msg 與 srLog 皆已遮罩', function() {
        let x = step('rest-file-leak')
        assert.strictEqual(x.status, 404)
        let body = JSON.parse(x.text)
        assert.strictEqual(body.state, 'error')
        assertMasked(body.msg, '回應 msg')
        let rec = lg.recs.filter((o) => o.event === 'api/getFile' && o.level === 50)
        assert.strictEqual(rec.length, 2)
        assertMasked(textOf(rec[0].err), 'srLog err')
    })

    it('OL-03 資料通道 getFileInfo 讀檔案表失敗 (wrapErrLog 出口): 回應 output.msg 與 srLog 之 err 皆已遮罩', function() {
        let out = step('rpc-info-leak').success.output
        assert.strictEqual(out.state, 'error')
        assertMasked(textOf(out.msg), 'output.msg')
        let rec = lg.recs.filter((o) => o.event === 'kpfun-getFileInfo' && o.level === 50)
        assert.strictEqual(rec.length, 2)
        assertMasked(textOf(rec[0].err), 'srLog err')
    })

    it('OL-04 固定詞彙不包: 檔案不存在之 key (errFileNotFound) 於三條出口之回應與 srLog 皆原樣', function() {
        let a = JSON.parse(step('rest-info-fixed').text)
        assert.deepStrictEqual(a, { state: 'error', msg: 'errFileNotFound' })
        let bx = step('rest-file-fixed')
        assert.strictEqual(bx.status, 404)
        assert.deepStrictEqual(JSON.parse(bx.text), { state: 'error', msg: 'errFileNotFound' })
        assert.deepStrictEqual(step('rpc-info-fixed').success.output, { state: 'error', msg: 'errFileNotFound' })
        for (let ev of ['api/getFileInfo', 'api/getFile', 'kpfun-getFileInfo']) {
            let rec = lg.recs.filter((o) => o.event === ev && o.level === 50)
            assert.strictEqual(rec[1].err, 'errFileNotFound', `${ev} 之 srLog err 應為固定 key, 實得 ${JSON.stringify(rec[1])}`)
        }
    })

    it('OL-05 封存掃描失敗 (catch 出口): srLog msg 已遮罩', function() {
        let rec = lg.recs.filter((o) => o.event === 'archiveSweep-error')
        assert.ok(rec.length >= 1, `應有 archiveSweep-error 記錄, 實得 ${JSON.stringify(lg.recs.map((o) => o.event))}`)
        assertMasked(rec[0].msg, 'archiveSweep-error msg')
    })

    it('OL-06 成功資料不遮: 頻道名稱恰含密碼字樣時, 成功回應 (資料通道與 HTTP REST) 原樣含之 (遮罩只作用於失敗值)', function() {
        //dspec D3「只處理外來值之錯誤」: 成功資料是業務資料, 不是錯誤值
        let a = step('rpc-channel-ok').success.output
        assert.strictEqual(a.state, 'success') //資料通道 saveChannel 回 { n, nInserted, ok } (不含列), 名稱由下列 REST 查詢取回
        let b = JSON.parse(step('rest-channels-ok').text)
        assert.strictEqual(b.state, 'success')
        assert.ok(JSON.stringify(b.msg).includes(`ch-ok-${PW}`), `REST 成功回應應原樣含頻道名稱, 實得 ${JSON.stringify(b)}`)
    })

    it('OL-07 全域: srLog 全文、stdout / stderr、失敗回應皆不含網址整串與密碼 (成功資料對照步驟除外)', function() {
        let fails = r.results.filter((x) => !['rpc-channel-ok', 'rest-channels-ok'].includes(x.step))
        for (let [label, text] of [['srLog 全文', lg.text], ['stdout/stderr', r.out.split(/\r?\n/).filter((l) => !l.startsWith('RESULT:')).join('\n')], ['失敗與固定詞彙回應', JSON.stringify(fails)]]) {
            assert.ok(!text.includes(PW), `${label} 不得含密碼`)
            assert.ok(!text.includes(URL_CRED), `${label} 不得含連線字串`)
        }
    })

})
