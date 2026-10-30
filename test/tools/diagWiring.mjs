//diagWiring: 取出 server/WWebTask.mjs 實際傳給 WServOrm 的 funLog 運算式並以其自身之 import 求值, 使接線測試跑的是正式站點之運算式而非測試內另寫的一份.
//  正式站點(server/WWebTask.mjs): WServOrm(ds, WOrm, url, db, { funLog: <運算式> }); 運算式內用到的識別字(如 genDiagFunLog、SAFE_KEYS)取自 WWebTask.mjs 的 default / 具名 import, srLog 為參數.
//  loadWiring() 回 { expr, call, callOpt, make }: expr 為原文; make(srLog) 回運算式之值(正式為 funLog 函數); call(srLog) 回去掉結尾 .funLog 之值(wsemi genDiagFunLog 之 { funLog, close });
//  callOpt(srLog, opt) 同 call 但第 2 引數(opt)換成指定值(供語料驅動: 各案自帶 opt, 正式之 safeKeys 不適用於其任意鍵名).
//  運算式不符預期形狀(找不到、結尾不是 .funLog)即拋 Error, 使接線被改掉時測試明確失敗而不是靜默跳過.
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'


const __dir = path.dirname(fileURLToPath(import.meta.url))
const SERVER = path.resolve(__dir, '..', '..', 'server')
const FP = path.join(SERVER, 'WWebTask.mjs')


async function loadWiring() {
    let src = fs.readFileSync(FP, 'utf8')
    let m = src.match(/WServOrm\(ds, WOrm, url, db, \{ funLog: (.+) \}\)\s*$/m) //該呼叫獨佔一行, 運算式內可含 ' })'
    if (!m) {
        throw new Error('wiring not found: WServOrm(ds, WOrm, url, db, { funLog: ... })')
    }
    let expr = m[1]

    //運算式用到的 import: default import(import x from '...')與具名 import(import { x, y as z } from '...'), 識別字 → { spec, exp }
    let imps = {}
    for (let im of src.matchAll(/^import (\w+) from '([^']+)'/gm)) {
        imps[im[1]] = { spec: im[2], exp: 'default' }
    }
    for (let im of src.matchAll(/^import \{([^}]+)\} from '([^']+)'/gm)) {
        for (let part of im[1].split(',')) {
            let [exp, local] = part.trim().split(/\s+as\s+/)
            if (exp) {
                imps[local || exp] = { spec: im[2], exp }
            }
        }
    }
    let names = Object.keys(imps).filter((n) => new RegExp(`\\b${n}\\b`).test(expr))
    let mods = []
    for (let n of names) {
        let { spec, exp } = imps[n]
        let url = spec.startsWith('.') ? pathToFileURL(path.resolve(SERVER, spec)).href : spec
        let mod = await import(url)
        mods.push(mod[exp])
    }

    let mk = (e) => {
        let fn = new Function('srLog', ...names, `return (${e})`)
        return (srLog) => fn(srLog, ...mods)
    }
    let make = mk(expr)
    let call = null
    let callOpt = null
    if (expr.endsWith('.funLog')) {
        let base = expr.slice(0, -'.funLog'.length)
        call = mk(base)
        //callOpt(srLog, opt): 正式站點之寫入接線 `(o) => srLog.warn(o)` 不變, 僅把第 2 引數(正式為 { safeKeys: SAFE_KEYS })換成指定之 opt; 供 wsemi 共用語料(各案自帶 opt)經正式寫入接線執行.
        //  正式之 opt 另由 OD-S-01(原文)、OD-U-11、OD-U-12、OD-K-01(行為)守. 運算式不符 genDiagFunLog((o) => srLog.warn(o)[, { … }]) 之形即拋
        let mm = base.match(/^(genDiagFunLog\(\(o\) => srLog\.warn\(o\))(?:, \{[^}]*\})?\)$/)
        if (mm) {
            let fn2 = new Function('srLog', '__opt', ...names, `return (${mm[1]}, __opt))`)
            callOpt = (srLog, opt) => fn2(srLog, opt, ...mods)
        }
    }
    if (!call) {
        call = () => {
            throw new Error(`wiring does not end with .funLog: ${expr}`)
        }
    }
    if (!callOpt) {
        callOpt = () => {
            throw new Error(`wiring is not genDiagFunLog((o) => srLog.warn(o)[, { … }]).funLog: ${expr}`)
        }
    }
    return { expr, make, call, callOpt }
}


export { loadWiring }
