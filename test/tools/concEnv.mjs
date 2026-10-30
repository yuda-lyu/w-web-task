//多人同時編輯測試共用: 以「與 WWebTask.mjs 相同之組裝」建立真實 lmdb ORM + 真實 procCore (kmx / lockSave / withTabLocks / guardWrite / ds 皆真實).
//資料庫落在 test/_tmp/concurrency/<name> (全域 §4: 測試臨時檔放 test/_tmp/<案名>/, 測試自己清); 路徑一律由 fileURLToPath 衍生並經 path.resolve (場景 B).
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import pmKeyMutex from 'wsemi/src/pmKeyMutex.mjs'
import cacheSt from 'wsemi/src/cacheSt.mjs'
import WOrm from 'w-orm-lmdb/src/WOrmLmdb.mjs'
import WServOrm from 'w-serv-orm/src/WServOrm.mjs'
import { buildBaseline } from 'w-serv-orm/src/baseline.mjs'
import ds from '../../src/schema/index.mjs'
import channelsContract from '../../src/schema/contracts/channels.mjs'
import getMembersContract from '../../src/schema/contracts/channelMembers.mjs'
import procCore from '../../server/procCore.mjs'
import createLockSave from '../../server/lockSave.mjs'
import genDiag from '../../server/genDiag.mjs'
import genDiagFunLog from 'wsemi/src/genDiagFunLog.mjs'


const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '_tmp', 'concurrency')


//mkEnv: 建立一個獨立資料庫之環境. 回 { pc, woItems, wp, kmx, logs, infos, warns, close }; logs 收 srLog.error 之記錄 (供斷言補償失敗有記 log), infos 收 srLog.info 之記錄 (供斷言審計 log), warns 收 srLog.warn 之記錄 (含 w-serv-orm 診斷輸出 orm-diag)
async function mkEnv(name) {
    let dir = path.join(ROOT, name)
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })

    let logs = []
    let infos = []
    let warns = []
    let srLog = {
        info(o) {
            infos.push(o)
        },
        warn(o) {
            warns.push(o)
        },
        error(o) {
            logs.push(o)
        }
    }

    //與 WWebTask.mjs 相同: WServOrm(ds, WOrm, url, db, { funLog: genDiagFunLog((o) => srLog.warn(o)).funLog }); useCache 未給(false)
    let wp = WServOrm(ds, WOrm, dir, 'worm', { funLog: genDiagFunLog((o) => srLog.warn(o)).funLog })
    let { woItems, withTabLocks, guardWrite } = wp
    let kmx = pmKeyMutex()
    let cst = cacheSt()
    let diag = genDiag(dir) //與 WWebTask.mjs 相同: genDiag(url)
    let lockSave = createLockSave(cst, diag)
    let pc = procCore({ woItems, procOrm: wp.procOrm, ds, srLog, kmx, lockSave, withTabLocks, guardWrite, diag })

    let close = async () => {
        cst.clear()
        await wp.closeAll()
        fs.rmSync(dir, { recursive: true, force: true })
    }
    return { pc, woItems, wp, kmx, logs, infos, warns, close, dir }
}


//cleanRoot: 測試結束清掉整個 test/_tmp/concurrency
function cleanRoot() {
    fs.rmSync(ROOT, { recursive: true, force: true })
}


//前端等價: 對「畫面所見之列」自算基準 (與 LayoutContent*.vue 同一模組同一契約)
function baselineOfChannels(rows) {
    return buildBaseline(rows, channelsContract)
}
function baselineOfMembers(rows, channelId) {
    return buildBaseline(rows, getMembersContract(channelId))
}


//sleep
let sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))


//gate: 可手動放行之閘門 (人為延遲, 不依賴機器快慢)
function gate() {
    let open = null
    let promise = new Promise((resolve) => {
        open = resolve
    })
    return { promise, open }
}


//pauseOnce: 在 woItems[tab][method] 第一次符合 match 之呼叫前停住 (人為延遲; 以閘門放行). 回 { reached, release, restore }
function pauseOnce(env, tab, method, match = () => true) {
    let g = gate()
    let reached = gate()
    let t = env.woItems[tab]
    let orig = t[method]
    let hit = false
    t[method] = async (...a) => {
        if (!hit && match(...a)) {
            hit = true
            reached.open()
            await g.promise
        }
        return orig.apply(t, a)
    }
    return {
        reached: reached.promise,
        release: g.open,
        restore: () => {
            t[method] = orig
        }
    }
}


//rejKey: 取 reject 之值 (procCore 一律 reject 字串鍵); 未 reject 回 null
async function rejKey(fn) {
    try {
        await fn()
        return null
    }
    catch (e) {
        return (typeof e === 'string') ? e : `Error:${(e && e.message) || e}`
    }
}


//snapshot: 全部資料表之列 (依 id 排序), 供「零寫入 / 完全還原」之深度比對
async function snapshot(woItems) {
    let o = {}
    for (let k of Object.keys(woItems)) {
        let rs = await woItems[k].select({})
        o[k] = rs.map((r) => ({ ...r })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    }
    return o
}


//installFaults: 在 woItems 各表之 insert / save / del 上安裝可程式化的硬失敗 (模擬磁碟滿等非競爭失敗).
//arm(k): 自此起算第 k 次寫入拋錯; rollbackFail 為 true 時, 失敗後之所有寫入 (含補償) 皆拋錯;
//afterWrite 為 true 時, 第 k 次寫入「已實際寫入後」才拋錯 (模擬單次呼叫已部分生效, 補償須含失敗中那一步). 回 { arm, st, restore }
function installFaults(woItems, tabs = ['channels', 'channelMembers', 'messages', 'tasks', 'messagesArchive', 'tasksArchive']) {
    let st = { n: 0, failAt: 0, failSet: null, rollbackFail: false, afterWrite: false, failed: false, calls: [] }
    let origs = []
    for (let tab of tabs) {
        for (let m of ['insert', 'save', 'del']) {
            let orig = woItems[tab][m].bind(woItems[tab])
            origs.push([tab, m, woItems[tab][m]])
            woItems[tab][m] = async (...a) => {
                st.n++
                st.calls.push(`${tab}.${m}`)
                let hit = (st.failAt > 0 && (st.n === st.failAt || (st.rollbackFail && st.failed && st.n > st.failAt))) || (st.failSet !== null && st.failSet.has(st.n))
                if (hit) {
                    let first = !st.failed
                    st.failed = true
                    if (st.afterWrite && first) {
                        await orig(...a) //已寫入, 再拋錯
                    }
                    throw new Error('INJECTED_FAILURE')
                }
                return orig(...a)
            }
        }
    }
    return {
        arm: (k, rollbackFail = false, afterWrite = false) => {
            st.n = 0; st.failAt = k; st.failSet = null; st.rollbackFail = rollbackFail; st.afterWrite = afterWrite; st.failed = false; st.calls = []
        },
        //armSet: 自此起算, 第 ks 中任一次寫入拋錯 (其餘寫入皆成功; 供「只有部分補償步驟失敗」之案例)
        armSet: (ks, afterWrite = false) => {
            st.n = 0; st.failAt = 0; st.failSet = new Set(ks); st.rollbackFail = false; st.afterWrite = afterWrite; st.failed = false; st.calls = []
        },
        disarm: () => {
            st.failAt = 0; st.failSet = null
        },
        st,
        restore: () => {
            for (let [tab, m, f] of origs) {
                woItems[tab][m] = f
            }
        },
    }
}


export { ds, mkEnv, cleanRoot, baselineOfChannels, baselineOfMembers, sleep, gate, pauseOnce, rejKey, snapshot, installFaults, channelsContract, getMembersContract }
