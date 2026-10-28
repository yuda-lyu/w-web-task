//ormDiagChild: api-ormDiag 之子行程 (非測試檔): 以真實 WWebTask (真實 lmdb、真實 srLog、真實資料通道) 在指定 port 起服務,
//其 WOrm 為包一層之替身: channels.select 的條件 name 以 'od-trigger' 開頭者拋 Error (原文含條件值, 模擬資料庫讀取失敗), 其餘照常.
//之後以 HTTP 打資料通道 (/api/main) 做三次呼叫, 於 stdout 印 'RESULT:<json>' 供父行程斷言; 等 srLog 落檔後結束.
//用法: node ormDiagChild.mjs <工作目錄(cwd 亦為此)> <port> <marker>
//  工作目錄下: db/ (lmdb)、logs/ (srLog)、dbf、uploadTemp、tableTags 等皆落此 (父行程負責清除)
import fs from 'fs'
import path from 'path'
import obj2u8arr from 'wsemi/src/obj2u8arr.mjs'
import u8arr2obj from 'wsemi/src/u8arr2obj.mjs'
import WOrm from 'w-orm-lmdb/src/WOrmLmdb.mjs'
import WWebTask from '../../server/WWebTask.mjs'


const [dir, portStr, marker] = process.argv.slice(2)
const port = Number(portStr)
const TOKEN = 'tk-od'
const base = `http://127.0.0.1:${port}`
const logDir = path.join(dir, 'logs')


//WOrmFail: 包一層 w-orm-lmdb, 只改 channels 表之 select 對特定條件之行為
function WOrmFail(opt) {
    let wo = new WOrm(opt)
    if (opt.cl === 'channels') {
        let select = wo.select.bind(wo)
        wo.select = async (find) => {
            if (find && typeof find.name === 'string' && find.name.startsWith('od-trigger')) {
                throw new Error(`disk read failed: ${find.name}`)
            }
            return select(find)
        }
    }
    return wo
}


let user = { id: 'id-for-admin', name: 'tester', email: 'admin@example.com', isAdmin: 'y' }
let getUserByToken = async (token) => (token === TOKEN ? { ...user } : {})
let verify = () => true


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


try {
    fs.mkdirSync(path.join(dir, 'db'), { recursive: true })
    let inst = WWebTask(WOrmFail, path.join(dir, 'db'), 'wtask', getUserByToken, verify, verify, {
        serverPort: port,
        logFd: logDir,
        archiveAfterDays: 0,
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

    //1) select 失敗 (條件值含 marker): 預期 w-serv-orm 的 select catch 診斷輸出
    console.log('RESULT:' + JSON.stringify({ step: 'select-fail', r: await postMain('channels.select', [{ name: `od-trigger-${marker}` }]) }))
    //2) 無效 find (非物件, 含 marker): 預期被 w-serv-webdata 的白名單先擋下, 不到 w-serv-orm
    console.log('RESULT:' + JSON.stringify({ step: 'invalid-find', r: await postMain('channels.select', [marker]) }))
    //3) 正常讀取: 預期成功且無診斷
    let r3 = await postMain('channels.select', [])
    console.log('RESULT:' + JSON.stringify({ step: 'select-ok', state: r3 && r3.success && r3.success.output && r3.success.output.state }))

    //等 srLog (pino worker) 落檔: 見到 select catch 的記錄後再多等一小段收尾端
    for (let k = 0; k < 100 && !logText().includes('orm-diag'); k++) {
        await sleep(100)
    }
    await sleep(800)
    console.log('CHILD-DONE')
    process.exit(0)
}
catch (err) {
    console.log('CHILD-ERROR', err && err.message)
    process.exit(1)
}
