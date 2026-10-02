//模組解析 hook(由 ./register.mjs 註冊): 本專案 server/ 與 src/ 內之 import 'wsemi/src/nowms2str.mjs' 改解析為 ./nowms2str.mjs;
//其餘(含 ./nowms2str.mjs 自身引用真實版、node_modules 內之引用)照常解析.
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

let dirHere = path.dirname(fileURLToPath(import.meta.url))
let projRoot = path.resolve(dirHere, '..', '..', '..') //本檔在 test/tools/fakeNow/
let prefixes = ['server', 'src'].map((d) => pathToFileURL(path.join(projRoot, d) + path.sep).href.toLowerCase())
let urlFake = pathToFileURL(path.join(dirHere, 'nowms2str.mjs')).href

export async function resolve(specifier, context, nextResolve) {
    let parent = String(context.parentURL || '').toLowerCase()
    if (specifier === 'wsemi/src/nowms2str.mjs' && prefixes.some((p) => parent.startsWith(p))) {
        return { url: urlFake, shortCircuit: true }
    }
    return nextResolve(specifier, context)
}
