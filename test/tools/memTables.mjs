//記憶體版資料表替身與表鎖: 供 unit 測試在不起 lmdb 下執行 procCore.
//makeTable / makeSlowTable: 語意對齊 w-orm-lmdb —— save / del 回與輸入等長之逐筆結果陣列 {n,nInserted,nModified,ok} / {n,nDeleted,ok},
//save 支援 { autoInsert: false } (未命中 n=0 且不新增), insert 回聚合物件 {n,nInserted,ok}, 重複 id 略過.
//mkLocks: 以真實 WServOrm (w-serv-orm) 取得 withTabLocks / guardWrite (表鎖與基準比對為共用核心之真實實作, 不另寫替身), 表則換成上述記憶體表.
import WServOrm from 'w-serv-orm/src/WServOrm.mjs'
import ds from '../../src/schema/index.mjs'


//makeTable: 每張表一個 Map<id,row>
function makeTable() {
    const map = new Map()
    return {
        //select: 回全表列，過濾 q 中各 key 等值條件，依 id 字典序排序（模擬 lmdb getRange 時序）。
        async select(q) {
            let rows = Array.from(map.values())
            if (q && typeof q === 'object') {
                for (const [k, v] of Object.entries(q)) {
                    rows = rows.filter((r) => r[k] === v)
                }
            }
            rows = [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
            return rows.map((r) => ({ ...r }))
        },
        //insert: rows 陣列（或單筆物件），重複 id 略過。
        async insert(rows) {
            const arr = Array.isArray(rows) ? rows : [rows]
            let nInserted = 0
            for (const row of arr) {
                if (!map.has(row.id)) {
                    map.set(row.id, { ...row })
                    nInserted++
                }
            }
            return { n: arr.length, nInserted, ok: 1 }
        },
        //save: rows 陣列（或單筆物件），merge 到既有列（空字串覆寫，對齊 lodash merge 對 '' 之行為）; autoInsert:false 時未命中不新增 (n=0)。
        async save(rows, opt = {}) {
            const arr = Array.isArray(rows) ? rows : [rows]
            const autoInsert = opt.autoInsert !== false
            return arr.map((row) => {
                const hit = map.has(row.id)
                if (!hit && !autoInsert) {
                    return { n: 0, nInserted: 0, nModified: 0, ok: 1 }
                }
                const existing = map.get(row.id) || {}
                map.set(row.id, { ...existing, ...row })
                return { n: hit ? 1 : 0, nInserted: hit ? 0 : 1, nModified: hit ? 1 : 0, ok: 1 }
            })
        },
        //del: 刪 q.id（單筆或陣列），回逐筆 {n,nDeleted,ok}。
        async del(q) {
            const arr = Array.isArray(q) ? q : [q]
            return arr.map((v) => {
                const hit = map.delete(v.id)
                return { n: hit ? 1 : 0, nDeleted: hit ? 1 : 0, ok: 1 }
            })
        },
        //delAll: 清表。
        async delAll() {
            const n = map.size
            map.clear()
            return { n, nDeleted: n, ok: 1 }
        },
        //取得整個 map（測試用）
        _map: map,
    }
}


//makeSlowTable：同 makeTable，但 select / insert / save / del 先讓出 ms 毫秒再執行 —— 使並行呼叫之「先 select 後 insert」競態窗必定重疊
//（未以 kmx 包成原子者即重複建列）。供「雙擊防護 / 並行 (D16)」用。
function makeSlowTable(ms = 5) {
    const t = makeTable()
    const wait = () => new Promise((resolve) => setTimeout(resolve, ms))
    return {
        async select(q) {
            await wait()
            return t.select(q)
        },
        async insert(rows) {
            await wait()
            return t.insert(rows)
        },
        async save(rows, opt) {
            await wait()
            return t.save(rows, opt)
        },
        async del(q) {
            await wait()
            return t.del(q)
        },
        async delAll() {
            return t.delAll()
        },
        _map: t._map,
    }
}


//mkLocks: 取得與 woItems 對應之 withTabLocks / guardWrite (共用核心真實實作; woItems 為 { 表名: 記憶體表 }, 缺之表以空物件補)
function mkLocks(woItems) {
    class MemOrm {
        constructor(opt) {
            return woItems[opt.cl] || {}
        }
    }
    let wp = WServOrm(ds, MemOrm, 'mem://locks', 'mem')
    return { withTabLocks: wp.withTabLocks, guardWrite: wp.guardWrite }
}


export { makeTable, makeSlowTable, mkLocks }
