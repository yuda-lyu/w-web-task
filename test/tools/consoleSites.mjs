//consoleSites: console 輸出站點之結構掃描 (非測試檔; 供 unit-consoleSites 使用, 規則 R-CONSOLE-01)
//以 espree 解析原始碼 (eslint 之相依, 本套件 devDependencies 已宣告 eslint), 找出全部 console.<log|warn|error|info|debug|trace|dir|table>(...) 呼叫,
//逐一檢查每個引數是否屬「不輸出資料值」之形態 (dspec〈診斷輸出與遮罩〉D2「預設不輸出資料值」; 主控裁定: console 只印鍵名、型別或固定詞彙, 權杖經 maskTok):
//  1. 字面值 (字串、數字等) —— 固定詞彙
//  2. 無運算式之樣板字面, 或運算式皆為 allowIdents 之識別字之樣板字面
//  3. 識別字且在 allowIdents (該檔明列之非資料值: 如 w-converhp 路由表之 apiType、部署路徑)
//  4. 呼叫之被呼叫者為 allowFns 之函數 (maskTok / maskQuery / describeKeys / describeType / getDiagBriefErr 等遮罩或摘要函數; 其引數不限)
//其餘 (使用者物件、請求本體、傳入參數、後端回傳值、錯誤物件、`.message` 之讀取) 一律判為違規.
//不處理: 註解內之 console (非執行); console 之別名 (如 let log = console.log) —— 以 hasConsoleAlias 另掃
import fs from 'fs'
import path from 'path'
import * as espree from 'espree'


const METHODS = ['log', 'warn', 'error', 'info', 'debug', 'trace', 'dir', 'table']


//parse: 解析為 AST (含位置)
function parse(src) {
    return espree.parse(src, { ecmaVersion: 'latest', sourceType: 'module', loc: true, range: true })
}


//walk: 遞迴走訪全部節點
function walk(node, fn) {
    if (!node || typeof node.type !== 'string') {
        return
    }
    fn(node)
    for (let k of Object.keys(node)) {
        if (k === 'loc' || k === 'range') {
            continue
        }
        let v = node[k]
        if (Array.isArray(v)) {
            v.forEach((x) => walk(x, fn))
        }
        else if (v && typeof v === 'object') {
            walk(v, fn)
        }
    }
}


//isConsoleCall: node 是否為 console.<method>(...) 呼叫
function isConsoleCall(node) {
    if (node.type !== 'CallExpression') {
        return false
    }
    let c = node.callee
    return c.type === 'MemberExpression' && !c.computed && c.object.type === 'Identifier' && c.object.name === 'console' && c.property.type === 'Identifier' && METHODS.includes(c.property.name)
}


//checkArg: 單一引數是否合規; 回 { ok, kind, reason }
function checkArg(node, src, allow) {
    let text = src.slice(node.range[0], node.range[1])
    if (node.type === 'Literal') {
        return { ok: true, kind: 'literal', text }
    }
    if (node.type === 'TemplateLiteral') {
        let bad = node.expressions.filter((e) => !(e.type === 'Identifier' && allow.idents.includes(e.name)))
        return bad.length === 0 ? { ok: true, kind: 'template', text } : { ok: false, kind: 'template', text, reason: '樣板字面含非明列識別字之運算式' }
    }
    if (node.type === 'Identifier') {
        return allow.idents.includes(node.name) ? { ok: true, kind: 'ident', text } : { ok: false, kind: 'ident', text, reason: `識別字 ${node.name} 未明列為非資料值` }
    }
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier') {
        return allow.fns.includes(node.callee.name) ? { ok: true, kind: 'call', text } : { ok: false, kind: 'call', text, reason: `函數 ${node.callee.name} 非遮罩或摘要函數` }
    }
    return { ok: false, kind: node.type, text, reason: `${node.type} 可能輸出資料值` }
}


/**
 * 掃描一段原始碼之 console 站點
 *
 * @param {String} src 原始碼
 * @param {Object} [allow={}] 輸入 { fns: 允許之函數名陣列, idents: 允許之識別字陣列 }
 * @returns {Array} 回傳站點陣列 [{ line, method, args: [{ ok, kind, text, reason? }], ok }]
 */
function scanSource(src, allow = {}) {
    let al = { fns: allow.fns || [], idents: allow.idents || [] }
    let ast = parse(src)
    let sites = []
    walk(ast, (node) => {
        if (isConsoleCall(node)) {
            let args = node.arguments.map((a) => checkArg(a, src, al))
            sites.push({ line: node.loc.start.line, method: node.callee.property.name, args, ok: args.every((a) => a.ok) })
        }
    })
    sites.sort((a, b) => a.line - b.line)
    return sites
}


/**
 * 原始碼是否含 console 別名 (如 let log = console.log; const { log } = console; console['log'](..)): 這些寫法繞過站點掃描, 一律視為違規
 *
 * @param {String} src 原始碼
 * @returns {Array} 回傳別名站點之行號陣列
 */
function findConsoleAlias(src) {
    let ast = parse(src)

    //accepted: 合規之 console 識別字 = console.<method>(...) 呼叫之 callee.object
    let accepted = new Set()
    walk(ast, (node) => {
        if (isConsoleCall(node)) {
            accepted.add(node.callee.object)
        }
    })

    //其餘對 console 之參照 (賦值、解構、傳參、computed 成員、未呼叫之 console.log) 皆為別名; 屬性名與物件鍵不算參照
    let lines = []
    let visit = (node, parent) => {
        if (!node || typeof node.type !== 'string') {
            return
        }
        if (node.type === 'Identifier' && node.name === 'console' && !accepted.has(node)) {
            let isPropName = parent && parent.type === 'MemberExpression' && parent.property === node && !parent.computed
            let isKey = parent && parent.type === 'Property' && parent.key === node && !parent.computed && !parent.shorthand
            if (!isPropName && !isKey) {
                lines.push(node.loc.start.line)
            }
        }
        for (let k of Object.keys(node)) {
            if (k === 'loc' || k === 'range') {
                continue
            }
            let v = node[k]
            if (Array.isArray(v)) {
                v.forEach((x) => visit(x, node))
            }
            else if (v && typeof v === 'object') {
                visit(v, node)
            }
        }
    }
    visit(ast, null)
    return [...new Set(lines)].sort((a, b) => a - b)
}


//listFiles: 遞迴列出資料夾下之 .mjs / .js 檔 (不含 node_modules)
function listFiles(dir) {
    let out = []
    for (let ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.name === 'node_modules') {
            continue
        }
        let p = path.join(dir, ent.name)
        if (ent.isDirectory()) {
            out.push(...listFiles(p))
        }
        else if (/\.(mjs|js)$/.test(ent.name)) {
            out.push(p)
        }
    }
    return out
}


export { scanSource, findConsoleAlias, listFiles }
