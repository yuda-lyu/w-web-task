//consoleLeakChild: api-consoleLeak 之子行程 (非測試檔): 以真實 WWebTask (真實 lmdb、真實 srLog、真實 HTTP 與資料通道) 觸發 server/WWebTask.mjs 之全部 console 站點,
//每個觸發點前於 stdout 印標記行 '@@SITE <id>' (父行程據以切分各站點之 console 輸出); 觸發所得之回應與擲出之錯誤寫入工作目錄之 results.ndjson (不經 stdout, 以免與被檢驗之 console 輸出混雜).
//測資: 同一個識別值 S = 'ZZ-secret-9317' 置於 使用者物件之各欄位與額外欄位、請求本體(JSON 陣列 / 長字串)、查詢參數、建構參數 (WOrm / url / db / 三個注入函數) 與 WOrm 之建構錯誤原文.
//  權杖類 (Authorization 標頭、?token=) 之 console 經 maskTok (主控裁定: 照舊), 以 S 為值者僅要求全值不出現 (maskTok 契約露出頭尾字元).
//用法: node consoleLeakChild.mjs <工作目錄(cwd 亦為此)> <port>
//  工作目錄下: db/ (lmdb)、logs/ (srLog)、results.ndjson (父行程負責清除)
import fs from 'fs'
import path from 'path'
import obj2u8arr from 'wsemi/src/obj2u8arr.mjs'
import u8arr2obj from 'wsemi/src/u8arr2obj.mjs'
import WOrm from 'w-orm-lmdb/src/WOrmLmdb.mjs'
import WWebTask from '../../server/WWebTask.mjs'


const [dir, portStr] = process.argv.slice(2)
const port = Number(portStr)
const S = 'ZZ-secret-9317' //測資之識別值: 不得出現在 console (須與 api-consoleLeak.test.mjs 一致)
const base = `http://127.0.0.1:${port}`
const dbDir = path.join(dir, 'db')
const fileResults = path.join(dir, 'results.ndjson')


let record = (step, o) => {
    fs.appendFileSync(fileResults, JSON.stringify({ step, ...o }) + '\n')
}


let site = (id) => {
    process.stdout.write(`@@SITE ${id}\n`)
}


//使用者表: token → 使用者物件 (欄位值與額外欄位皆含 S); 各 token 對應一個 checkUser / verify 之失敗形態
let kpUser = {
    'tk-admin': { id: 'id-for-admin', name: 'Admin', email: 'admin@example.com', isAdmin: 'y' },
    'tk-noid': { id: '', name: S, email: `${S}@example.com`, isAdmin: 'y', note: S }, //checkUser: id 缺
    'tk-noemail': { id: S, name: S, email: '', isAdmin: 'y', note: S }, //email 缺
    'tk-noname': { id: S, name: '', email: `${S}@example.com`, isAdmin: 'y', note: S }, //name 缺
    'tk-badrole': { id: S, name: S, email: `${S}@example.com`, isAdmin: S, note: S }, //isAdmin 非 y / n
    'tk-denied': { id: S, name: S, email: `${S}@example.com`, isAdmin: 'y', note: S }, //欄位齊備但 verifyClientUser / verifyAppUser 拒絕
}
let getUserByToken = async (token) => (Object.prototype.hasOwnProperty.call(kpUser, token) ? { ...kpUser[token] } : {})
let verify = (user) => user.id !== S //id 為 S 者拒絕 (tk-denied)
let allow = () => true


//WOrmReal: 真實 lmdb; 資料實體固定落 dbDir
function WOrmReal(opt) {
    return new WOrm({ ...opt, url: dbDir })
}

//WOrmThrow: 建構即拋 (原文含識別值、連線字串帳密與 password= 三種形態), 模擬 ORM 初始化失敗之後端錯誤原文
function WOrmThrow() {
    throw new Error(`init failed ${S} postgres://admin:${S}@db.example.com:5432/x password=${S}`)
}


//construct: 以給定之參數建構 WWebTask 並記錄結果 (擲出之錯誤只記訊息長度與是否擲出, 不入 stdout)
let construct = (id, args, optObj) => {
    site(id)
    let threw = false
    let inst = null
    try {
        inst = WWebTask(...args, optObj)
    }
    catch (err) {
        threw = true
    }
    record(id, { threw })
    return inst
}


let optBase = { serverPort: port, logFd: path.join(dir, 'logs'), archiveAfterDays: 0, language: 'eng' }


let get = async (id, pathQs, headers = {}) => {
    site(id)
    let res = await fetch(`${base}${pathQs}`, { headers })
    record(id, { status: res.status, text: await res.text() })
}


let post = async (id, pathQs, body, contentType) => {
    site(id)
    let res = await fetch(`${base}${pathQs}`, { method: 'POST', headers: { 'Content-Type': contentType }, body })
    record(id, { status: res.status, text: await res.text() })
}


//postMain: 資料通道 /api/main; auth 為 Authorization 標頭之完整值, sysToken 為本體之 __sysToken__
let postMain = async (id, auth, sysToken) => {
    site(id)
    let payload = { func: 'getWebInfor', input: { __sysInputArgs__: [], __sysToken__: sysToken } }
    let res = await fetch(`${base}/api/main`, {
        method: 'POST',
        headers: { 'Authorization': auth, 'Content-Type': 'application/octet-stream' },
        body: Buffer.from(obj2u8arr(payload)),
    })
    let u8a = new Uint8Array(await res.arrayBuffer())
    let r = null
    try {
        r = u8arr2obj(u8a)
    }
    catch (err) {}
    record(id, { status: res.status, r })
}


let sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))


try {
    fs.mkdirSync(dbDir, { recursive: true })

    //C01～C06: 建構參數無效 (值皆含 S; 其餘參數有效); 修前 console 印傳入值本身
    construct('C01-invalid-WOrm', [{ password: S }, dbDir, 'wtask', getUserByToken, allow, allow], optBase)
    construct('C02-invalid-url', [WOrmReal, { host: 'db.example.com', user: 'admin', password: S }, 'wtask', getUserByToken, allow, allow], optBase)
    construct('C03-invalid-db', [WOrmReal, dbDir, { name: S }, getUserByToken, allow, allow], optBase)
    construct('C04-invalid-getUserByToken', [WOrmReal, dbDir, 'wtask', S, allow, allow], optBase)
    construct('C05-invalid-verifyClientUser', [WOrmReal, dbDir, 'wtask', getUserByToken, { k: S }, allow], optBase)
    construct('C06-invalid-verifyAppUser', [WOrmReal, dbDir, 'wtask', getUserByToken, allow, S], optBase)

    //C07: ORM 初始化失敗 (後端錯誤原文含 S 與連線字串帳密); 修前 console 印整個錯誤物件
    construct('C07-orm-init-failed', [WOrmThrow, dbDir, 'wtask', getUserByToken, allow, allow], optBase)

    //主服務 (工作目錄無 dist/, 建構時走「靜態檔入口不存在」之 console 站點: fpEntryIn、err、can not generate)
    site('C08-entry-generate')
    let inst = WWebTask(WOrmReal, dbDir, 'wtask', getUserByToken, verify, verify, optBase)
    inst.on('error', () => {
        record('error-event', {})
    })
    let ready = false
    for (let k = 0; k < 100 && !ready; k++) {
        ready = await fetch(`${base}/`).then((r) => r.status > 0).catch(() => false)
        if (!ready) {
            await sleep(100)
        }
    }
    if (!ready) {
        throw new Error('server not ready')
    }
    site('C08-end')

    //R01～R04: checkUser 之四個失敗分支 (經 /api/getUserByToken)
    await get('R01-checkUser-id', '/api/getUserByToken?token=tk-noid')
    await get('R02-checkUser-email', '/api/getUserByToken?token=tk-noemail')
    await get('R03-checkUser-name', '/api/getUserByToken?token=tk-noname')
    await get('R04-checkUser-role', '/api/getUserByToken?token=tk-badrole')

    //R05: 登入檢查授權不通過 (getAndVerifyClientUser); R06: app 路由授權不通過 (getAndVerifyAppUser)
    await get('R05-client-denied', '/api/getUserByToken?token=tk-denied')
    await get('R06-app-denied', '/api/getChannels?token=tk-denied')

    //R07: 無效請求本體 (JSON 陣列、JSON 字串字面值、非 JSON 之長字串; 皆含 S)
    await post('R07a-payload-array', '/api/postMessage?token=tk-admin', JSON.stringify([`${S}:request-body:${S}`]), 'application/json')
    await post('R07b-payload-string', '/api/postMessage?token=tk-admin', JSON.stringify(`${S}:request-body:${S}`), 'text/plain')
    await post('R07c-payload-nonjson', '/api/postMessage?token=tk-admin', `${S}:request-body:${S}`, 'text/plain')

    //R08: /api/getUserByToken 無效 token 分支 (整包 query: 其他鍵之值含 S; token 重複時為陣列)
    await get('R08a-query-no-token', `/api/getUserByToken?agentId=${S}&note=${S}`)
    await get('R08b-query-token-array', `/api/getUserByToken?token=tkA-xxxxxxxxxx&token=tkB-xxxxxxxxxx&agentId=${S}`)

    //R09: token 查無使用者 (getUserByToken 回 {})
    await get('R09-user-not-found', '/api/getUserByToken?token=tk-unknown-xxxxxxxx')

    //R10: 連線閘 verifyConn: Authorization 非 Bearer 方案 (值含 S) → invalid token
    await postMain('R10-verifyConn-invalid-token', `Basic ${S}-authorization`, 'tk-admin')

    //R11: 執行身分 getUserIdByToken: 本體 token 查無 / 授權不通過 / 欄位不齊 (欄位含 S)
    await postMain('R11a-getUserId-not-found', 'Bearer tk-admin', 'tk-unknown-xxxxxxxx')
    await postMain('R11b-getUserId-denied', 'Bearer tk-admin', 'tk-denied')
    await postMain('R11c-getUserId-incomplete', 'Bearer tk-admin', 'tk-noid')

    site('END')
    await sleep(500)
    process.exit(0)
}
catch (err) {
    record('child-error', { message: String(err && err.message) })
    process.exit(1)
}
