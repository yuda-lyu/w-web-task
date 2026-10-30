//ormLeakChild: api-ormLeak 之子行程 (非測試檔): 以真實 WWebTask (真實 lmdb、真實 srLog、真實資料通道與 HTTP REST) 在指定 port 起服務,
//連線位址 (url) 為含帳密之虛構連線字串; 其 WOrm 為包一層之替身, 模擬「上游 (w-serv-orm 或驅動) 未遮罩」: procCore 直接取用之 woItems 表,
//  files.select 的條件 id 以 'od-leak' 開頭者拋 Error (原文含連線字串、password= 與裸密碼三種形態), 供 getFileInfo / getFile 之三條出口 (runApi、getFile、資料通道 wrapErrLog) 驗證遮罩;
//  tasks.select({ isActive:'y' }) 於 sweepLeak 旗標啟用後拋同型 Error, 供封存掃描 (啟動後 30 秒首掃) 之 catch 出口驗證遮罩.
//之後以 HTTP 打各出口, 於 stdout 印 'RESULT:<json>' 供父行程斷言; 等 srLog 落檔 (含封存掃描記錄) 後結束.
//用法: node ormLeakChild.mjs <工作目錄(cwd 亦為此)> <port>
//  工作目錄下: db/ (lmdb)、logs/ (srLog)、dbf、uploadTemp、tableTags 等皆落此 (父行程負責清除)
import fs from 'fs'
import path from 'path'
import obj2u8arr from 'wsemi/src/obj2u8arr.mjs'
import u8arr2obj from 'wsemi/src/u8arr2obj.mjs'
import WOrm from 'w-orm-lmdb/src/WOrmLmdb.mjs'
import WWebTask from '../../server/WWebTask.mjs'


const [dir, portStr] = process.argv.slice(2)
const port = Number(portStr)
const TOKEN = 'tk-leak'
const PW = 'Zx9Lk-leak41' //虛構密碼 (須與 api-ormLeak.test.mjs 一致): 不得出現在日誌、console 與回應
const URL_CRED = `postgres://admin:${PW}@db.example.com:5432/app`
const LEAK_TEXT = `ECONNREFUSED connect ${URL_CRED} failed; password=${PW}; auth rejected for ${PW}`
const base = `http://127.0.0.1:${port}`
const logDir = path.join(dir, 'logs')
const dbDir = path.join(dir, 'db')
let sweepLeak = false


//WOrmLeak: 包一層 w-orm-lmdb. 資料實體固定落 dbDir (忽略 url: url 在本測試只作為秘密來源, 非檔案位置)
function WOrmLeak(opt) {
    let wo = new WOrm({ ...opt, url: dbDir })
    if (opt.cl === 'files') {
        let select = wo.select.bind(wo)
        wo.select = async (find) => {
            if (find && typeof find.id === 'string' && find.id.startsWith('od-leak')) {
                throw new Error(LEAK_TEXT)
            }
            return select(find)
        }
    }
    if (opt.cl === 'tasks') {
        let select = wo.select.bind(wo)
        wo.select = async (find) => {
            if (sweepLeak && find && find.isActive === 'y' && Object.keys(find).length === 1) {
                throw new Error(LEAK_TEXT)
            }
            return select(find)
        }
    }
    return wo
}


let user = { id: 'id-for-admin', name: 'tester', email: 'admin@example.com', isAdmin: 'y' }
let getUserByToken = async (token) => (token === TOKEN ? { ...user } : {})
let verify = () => true


let get = async (pathQs) => {
    let res = await fetch(`${base}${pathQs}`)
    return { status: res.status, text: await res.text() }
}


let postMain = async (func, args) => {
    let payload = { func, input: { __sysInputArgs__: args, __sysToken__: TOKEN } }
    let res = await fetch(`${base}/api/main`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/octet-stream' },
        body: Buffer.from(obj2u8arr(payload)),
    })
    let u8a = new Uint8Array(await res.arrayBuffer())
    return u8arr2obj(u8a)
}


let sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))


let logText = () => {
    if (!fs.existsSync(logDir)) {
        return ''
    }
    return fs.readdirSync(logDir).filter((fn) => fn.endsWith('.log')).map((fn) => fs.readFileSync(path.join(logDir, fn), 'utf8')).join('\n')
}


let result = (step, r) => {
    console.log('RESULT:' + JSON.stringify({ step, r }))
}


try {
    fs.mkdirSync(dbDir, { recursive: true })
    let inst = WWebTask(WOrmLeak, URL_CRED, 'wtask', getUserByToken, verify, verify, {
        serverPort: port,
        logFd: logDir,
        archiveAfterDays: 1, //啟用封存掃描: 啟動後 30 秒首掃 (WWebTask 內固定), 見 sweepLeak
        language: 'eng',
    })
    inst.on('error', (err) => {
        console.log('CHILD-SERVER-ERROR', err)
    })

    //等服務就緒
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

    //1) HTTP REST getFileInfo (runApi 出口): 上游例外
    result('rest-info-leak', await get(`/api/getFileInfo?token=${TOKEN}&id=od-leak-1`))
    //2) HTTP REST getFile (getFile catch 出口): 上游例外
    result('rest-file-leak', await get(`/api/getFile?token=${TOKEN}&id=od-leak-2`))
    //3) 資料通道 getFileInfo (wrapErrLog 出口): 上游例外
    result('rpc-info-leak', await postMain('getFileInfo', ['od-leak-3']))
    //4) 對照: 固定詞彙 (檔案不存在) 三條出口皆原樣
    result('rest-info-fixed', await get(`/api/getFileInfo?token=${TOKEN}&id=no-such-file`))
    result('rest-file-fixed', await get(`/api/getFile?token=${TOKEN}&id=no-such-file`))
    result('rpc-info-fixed', await postMain('getFileInfo', ['no-such-file']))

    //5) 對照: 成功資料不遮 (資料內容恰含密碼字樣者, 如頻道名稱, 於 runApi 之成功回應與資料通道之成功回應皆原樣; 遮罩只作用於失敗值)
    result('rpc-channel-ok', await postMain('saveChannel', [{ name: `ch-ok-${PW}` }]))
    result('rest-channels-ok', await get(`/api/getChannels?token=${TOKEN}`))

    //6) 封存掃描 (首掃於啟動後 30 秒): 啟用旗標後 tasks.select({ isActive:'y' }) 拋同型 Error, 等 srLog 見 archiveSweep-error (至多 70 秒)
    sweepLeak = true
    for (let k = 0; k < 350 && !logText().includes('archiveSweep-error'); k++) {
        await sleep(200)
    }
    await sleep(800)
    console.log('CHILD-DONE')
    process.exit(0)
}
catch (err) {
    console.log('CHILD-ERROR', err && err.message)
    process.exit(1)
}
