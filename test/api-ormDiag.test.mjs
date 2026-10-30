//api-ormDiag: w-serv-orm 診斷輸出(opt.funLog, w-serv-orm ≥ 1.1.22)經 wsemi genDiagFunLog 於真實 WWebTask 導入本套件 srLog 之契約測試(子行程起真實服務, 不需 browser)
//對應 spec/設計要點與取捨.md D21; sgud/rule/rulebook_backend.md R-ORMDIAG-01～05; 規則本體 wsemi R-DIAG-01
//  OD-API-01「ORM 診斷輸出交 srLog(label + safe), 不含條件值、錯誤原文與憑證; console 無輸出」
//        → 資料通道 channels.select 時資料庫讀取失敗(替身 WOrm 拋 Error, 原文含條件值標記與連線字串憑證): 回傳契約不變(failed to select data, 固定詞彙原樣),
//          srLog 恰 1 筆 { level:40, event:'orm-diag', label:'channels.select catch', safe:{ errType:'Error' } }, 記錄全文不含標記、錯誤原文與憑證,
//          子行程之 stdout / stderr 與全部回應不含該診斷標籤、標記與憑證(修前 w-serv-orm 預設會印 console)
//  OD-API-02「站點事實: 無效 find 由 w-serv-webdata 白名單先擋, 不到 w-serv-orm」→ 回 invalid find[notObject], 無 orm-diag, srLog 不含條件值
//  OD-API-03「正常讀取不產生診斷記錄」→ 無條件 select 成功, 全程 orm-diag 只有 OD-API-01 那 1 筆
//子行程: test/tools/ormDiagChild.mjs (真實 WWebTask + 真實 lmdb + 真實 srLog; 工作目錄 test/_tmp/ormDiag/, 測試自己清)
//port: 11308 固定 (≥ 8000、不隨機; harness 另用 11108 / 8091 / 11208; 子行程一次性, 結束即釋放)
//跑法: npx mocha test/api-ormDiag.test.mjs --timeout 180000(須持測試鎖)
import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { parseRecords } from './tools/apiProbe.mjs'


const __dir = path.dirname(fileURLToPath(import.meta.url))
const DIR = path.resolve(__dir, '_tmp', 'ormDiag')
const CHILD = path.resolve(__dir, 'tools', 'ormDiagChild.mjs')
const PORT = 11308
const MARK = 'victim-od@example.com' //模擬使用者識別 / email: 只應出現在請求與替身錯誤原文, 不得出現在日誌與 console
const ERR_TEXT = 'disk read failed' //替身錯誤原文之固定字樣
const PW = 'S3cr3tPw-od' //替身錯誤原文內之連線字串憑證 (須與 tools/ormDiagChild.mjs 一致)


//runChild: 起子行程, 收 stdout / stderr, 逾時即終止; 回 { code, out, results }
function runChild() {
    return new Promise((resolve, reject) => {
        let child = spawn(process.execPath, [CHILD, DIR, String(PORT), MARK], { cwd: DIR, windowsHide: true })
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
        }, 90000)
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


describe('api-ormDiag(真實 WWebTask: w-serv-orm 診斷輸出導入 srLog、不含個資, D21)', function() {
    this.timeout(180000)

    let r = null //子行程結果
    let lg = null //srLog

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

    it('OD-API-00 子行程正常結束且三次呼叫皆有回應', function() {
        assert.strictEqual(r.code, 0, `子行程應正常結束, 輸出: ${r.out}`)
        assert.deepStrictEqual(r.results.map((x) => x.step), ['select-fail', 'invalid-find', 'select-ok'])
    })

    it('OD-API-01 資料庫讀取失敗: 回傳契約不變; srLog 恰 1 筆 orm-diag(label + safe); 記錄全文不含標記與錯誤原文; console 無輸出', function() {
        //回傳契約不變: 前端取得固定拒收字串
        let out = r.results[0].r.success.output
        assert.deepStrictEqual(out, { state: 'error', msg: 'failed to select data' })
        //spec「ORM 診斷輸出交 srLog」: 恰 1 筆, 等級 warn(40), event orm-diag, label 帶表名與操作, safe 只有錯誤類別
        let ds = lg.recs.filter((x) => x.event === 'orm-diag')
        assert.strictEqual(ds.length, 1, `應恰 1 筆 orm-diag, 實得 ${JSON.stringify(lg.recs)}`)
        assert.strictEqual(ds[0].level, 40)
        assert.strictEqual(ds[0].label, 'channels.select catch')
        assert.deepStrictEqual(ds[0].safe, { errType: 'Error' })
        //spec「不含 id / email / 錯誤原文」
        assert.ok(!lg.text.includes(MARK), `srLog 不得含標記(條件值 / 錯誤原文中之資料值), 實得 ${lg.text}`)
        assert.ok(!lg.text.includes(ERR_TEXT), 'srLog 不得含錯誤原文')
        assert.ok(!lg.text.includes(PW), 'srLog 不得含連線字串憑證')
        //spec「回應不含憑證」: 全部回應(RESULT 行)與 stdout / stderr 皆無憑證
        assert.ok(!JSON.stringify(r.results).includes(PW), '回應不得含連線字串憑證')
        assert.ok(!r.out.includes(PW), 'console 不得出現連線字串憑證')
        //spec「console 不多出輸出」: 子行程 stdout / stderr 不含診斷標籤、標記與錯誤原文(未接 funLog 時 w-serv-orm 預設會把標籤與摘要印 console)
        assert.ok(!r.out.includes('channels.select catch'), `console 不得出現 w-serv-orm 診斷標籤, 實得 ${r.out}`)
        assert.ok(!r.out.replace(/RESULT:.*/g, '').includes(MARK), 'console 不得出現標記(RESULT 行為測試用回報, 不計)')
        assert.ok(!r.out.includes(ERR_TEXT), 'console 不得出現錯誤原文')
    })

    it('OD-API-02 無效 find 由 w-serv-webdata 白名單先擋(不到 w-serv-orm): 回 invalid find[notObject]; 無 orm-diag; srLog 不含條件值', function() {
        let out = r.results[1].r.success.output
        assert.deepStrictEqual(out, { state: 'error', msg: 'invalid find[notObject]' })
        assert.strictEqual(lg.recs.filter((x) => x.event === 'orm-diag').length, 1, '全程 orm-diag 只應有 OD-API-01 那 1 筆')
        assert.ok(!lg.text.includes(MARK))
    })

    it('OD-API-03 正常讀取成功且不產生診斷記錄: 全程 orm-diag 只有 1 筆, 且無 error 等級之 ORM 記錄', function() {
        assert.strictEqual(r.results[2].state, 'success')
        let ds = lg.recs.filter((x) => x.event === 'orm-diag')
        assert.strictEqual(ds.length, 1)
        assert.strictEqual(ds[0].label, 'channels.select catch', '唯一一筆應是 OD-API-01 之讀取失敗')
    })

})
