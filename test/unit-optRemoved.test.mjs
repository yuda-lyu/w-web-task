import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { fileURLToPath, pathToFileURL } from 'url'
import WWebTask from '../server/WWebTask.mjs'


//
// UNIT-OR-001～019: w-serv-orm 已移除之設定鍵於 WWebTask 入口拒絕 (spec/設計要點與取捨.md D17 決策 1; CLAUDE_rulebook.md D17-1)
//   D17-1「給予非 undefined / null / false 之值即同步拋 w-serv-orm 之原文訊息」→ UNIT-OR-001～018 (3 鍵 × 6 值, 比對訊息全文與 Error 型別)
//   D17-1「於任何副作用之前: 不建 log 目錄與檔、不開資料庫」→ UNIT-OR-019 (子行程建構失敗後自然結束, 工作目錄下無 logFd 與資料庫目錄)
//   拒絕路徑於建構 WServHapiServer 之前即拋, 不起伺服器、不開埠; 暫存落 test/_tmp/unit-optRemoved/, after 刪除
// 跑法: npx mocha test/unit-optRemoved.test.mjs --timeout 60000
//


let __dir = path.dirname(fileURLToPath(import.meta.url))
let projRoot = path.resolve(__dir, '..')
let tmpDir = path.join(__dir, '_tmp', 'unit-optRemoved')

//w-serv-orm 之原文訊息(node_modules/w-serv-orm/src/checkOptRemoved.mjs:10-21; spec D17 背景逐字引用)
let msgAuth = 'procOrm does not authorize users, authorize where procOrm is exposed to clients'
let msgExpected = {
    useCheckUser: `opt.useCheckUser has been removed, ${msgAuth}`,
    getUserById: `opt.getUserById has been removed, ${msgAuth}`,
    useExcludeWhenNotAdmin: 'opt.useExcludeWhenNotAdmin has been removed, procOrm does not filter select results by user, use addFunPostProcessing if needed',
}

//被拒之值: undefined / null / false 以外者(D17-1); 函數對應原 getUserById 之用法
let valuesRejected = [
    ['true', true],
    ['字串 n', 'n'],
    ['0', 0],
    ['空字串', ''],
    ['物件', {}],
    ['函數', async () => ({ id: 'u', isAdmin: 'y', isActive: 'y' })],
]

//WWebTask 之其他參數: 皆為合法值, 使拒絕只來自已移除之鍵; WOrm 不會被呼叫(拒絕先於 WServOrm 建構)
let worm = () => {}
let fnUser = async () => ({ id: 'u', email: 'u@example.com', name: 'u', isAdmin: 'y' })
let fnVerify = () => true


describe('unit-optRemoved(w-serv-orm 已移除之設定鍵於入口拒絕, D17-1)', function() {

    before(function() {
        fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
        fs.mkdirSync(tmpDir, { recursive: true })
    })

    after(function() {
        fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
        //test/_tmp 為空(本檔單獨執行時)即一併移除, 使收尾判準「test/_tmp 不存在」成立; 非空(harness 之 e2e-harness 仍在)時不動
        try {
            fs.rmdirSync(path.join(__dir, '_tmp'))
        }
        catch (err) {}
    })

    let n = 0
    for (let k of Object.keys(msgExpected)) {
        for (let [tag, v] of valuesRejected) {
            n++
            let id = `UNIT-OR-${String(n).padStart(3, '0')}`
            it(`${id} opt.${k} 給予${tag} → 同步拋 Error, 訊息為 w-serv-orm 原文`, function() {
                let logFd = path.join(tmpDir, `logs-${id}`)
                let url = path.join(tmpDir, `db-${id}`)
                assert.throws(
                    () => WWebTask(worm, url, 'wtask', fnUser, fnVerify, fnVerify, { [k]: v, logFd, archiveAfterDays: 0 }),
                    (err) => {
                        assert.ok(err instanceof Error, `應為 Error, 實得 ${typeof err}`)
                        assert.strictEqual(err.message, msgExpected[k])
                        return true
                    },
                )
            })
        }
    }

    it('UNIT-OR-019 拒絕於任何副作用之前: 子行程建構失敗後自然結束, 工作目錄下無 logFd 目錄與資料庫目錄', async function() {
        this.timeout(30000)
        let cwd = path.join(tmpDir, 'cwd')
        fs.mkdirSync(cwd, { recursive: true })
        //子行程: 以預設 logFd('./logs')與相對資料庫路徑建構, catch 後印出訊息; 不呼叫 process.exit, 以驗證無殘留之計時器或 worker 拖住行程
        let urlWWebTask = pathToFileURL(path.join(projRoot, 'server', 'WWebTask.mjs')).href
        let code = [
            `import WWebTask from '${urlWWebTask}'`,
            `try {`,
            `    WWebTask(() => {}, './db', 'wtask', async () => ({}), () => true, () => true, { useCheckUser: true, archiveAfterDays: 0 })`,
            `    console.log('NO-THROW')`,
            `}`,
            `catch (err) {`,
            `    console.log('THREW:' + err.message)`,
            `}`,
        ].join('\n')
        let r = await new Promise((resolve) => {
            let child = spawn(process.execPath, ['--input-type=module', '-e', code], { cwd })
            let out = ''
            child.stdout.on('data', (d) => {
                out += d
            })
            child.stderr.on('data', (d) => {
                out += d
            })
            let t = setTimeout(() => {
                child.kill()
            }, 20000)
            child.on('exit', (exitCode, signal) => {
                clearTimeout(t)
                resolve({ exitCode, signal, out })
            })
        })
        assert.strictEqual(r.signal, null, `子行程應自然結束(未被逾時終止), 輸出: ${r.out}`)
        assert.strictEqual(r.exitCode, 0, `子行程應正常結束, 輸出: ${r.out}`)
        assert.ok(r.out.includes(`THREW:${msgExpected.useCheckUser}`), `應拋 w-serv-orm 原文訊息, 實得: ${r.out}`)
        assert.deepStrictEqual(fs.readdirSync(cwd), [], `工作目錄下不得留下任何檔案或目錄(logFd、資料庫、上傳暫存等), 實得: ${fs.readdirSync(cwd).join(', ')}`)
    })

})
