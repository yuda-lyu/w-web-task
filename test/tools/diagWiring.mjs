//diagWiring: 取出 server/WWebTask.mjs 實際傳給 WServOrm 的 funLog 運算式並以其自身之 import 求值, 使接線測試跑的是正式站點之運算式而非測試內另寫的一份.
//  正式站點(server/WWebTask.mjs): WServOrm(ds, WOrm, url, db, { funLog: <運算式> }); 運算式內用到的識別字(如 genDiagFunLog)取自 WWebTask.mjs 的 default import, srLog 為參數.
//  loadWiring() 回 { expr, call, make }: expr 為原文; make(srLog) 回運算式之值(正式為 funLog 函數); call(srLog) 回去掉結尾 .funLog 之值(wsemi genDiagFunLog 之 { funLog, close }, 供語料驅動).
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

    //運算式用到的 default import
    let imps = {}
    for (let im of src.matchAll(/^import (\w+) from '([^']+)'/gm)) {
        imps[im[1]] = im[2]
    }
    let names = Object.keys(imps).filter((n) => new RegExp(`\\b${n}\\b`).test(expr))
    let mods = []
    for (let n of names) {
        let spec = imps[n]
        let url = spec.startsWith('.') ? pathToFileURL(path.resolve(SERVER, spec)).href : spec
        let mod = await import(url)
        mods.push(mod.default)
    }

    let mk = (e) => {
        let fn = new Function('srLog', ...names, `return (${e})`)
        return (srLog) => fn(srLog, ...mods)
    }
    let make = mk(expr)
    let call = null
    if (expr.endsWith('.funLog')) {
        call = mk(expr.slice(0, -'.funLog'.length))
    }
    else {
        call = () => {
            throw new Error(`wiring does not end with .funLog: ${expr}`)
        }
    }
    return { expr, make, call }
}


export { loadWiring }
