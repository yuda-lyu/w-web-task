//servOrmImports: 掃描本套件自有原始碼對 w-serv-orm 之 import(規則帳本 R-ORMDIAG-08), 回 { 相對路徑: [被 import 之 w-serv-orm 模組, 如 'src/baseline.mjs'] }.
//  掃描範圍: 專案根之程式檔與 server、src、test、toolg 遞迴, 略過 node_modules、dist、docs、tmp、.git、testPending、logs、sgud、spec 與 test/_tmp、test/pics(皆為產物或文件, 非自有原始碼);
//  副檔名 .mjs / .js / .cjs / .vue; 只認真實的 import / dynamic import / require 語法(from '…'、import('…')、require('…'), 行首 import '…'), 註解與字串中的描述不計(本檔與測試檔的比對式不得寫成這些語法的字面).
//  路徑一律由 fileURLToPath 衍生並經 path.resolve(場景 B), 輸出相對路徑以 / 分隔.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'


const __dir = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dir, '..', '..')
const SKIP_DIRS = new Set(['node_modules', 'dist', 'docs', 'tmp', '.git', 'testPending', 'logs', 'sgud', 'spec', '_tmp', 'pics'])
const EXTS = new Set(['.mjs', '.js', '.cjs', '.vue'])
const RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)(['"])(w-serv-orm(?:\/[^'"]*)?)\1/gm


function walk(dir, out) {
    for (let ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.isDirectory()) {
            if (!SKIP_DIRS.has(ent.name)) {
                walk(path.join(dir, ent.name), out)
            }
        }
        else if (ent.isFile() && EXTS.has(path.extname(ent.name))) {
            out.push(path.join(dir, ent.name))
        }
    }
    return out
}


function scanServOrmImports() {
    let table = {}
    //範圍: 專案根之程式檔(不遞迴, 如 srv.mjs、g.mOrm.mjs)＋自有原始碼目錄 server、src、test、toolg(資料目錄 db、uploadTemp、user_data 等不掃)
    let files = fs.readdirSync(ROOT, { withFileTypes: true }).filter((ent) => ent.isFile() && EXTS.has(path.extname(ent.name))).map((ent) => path.join(ROOT, ent.name))
    for (let d of ['server', 'src', 'test', 'toolg']) {
        walk(path.join(ROOT, d), files)
    }
    for (let fp of files.sort()) {
        let text = fs.readFileSync(fp, 'utf8')
        let mods = []
        for (let m of text.matchAll(RE)) {
            mods.push(m[2].replace(/^w-serv-orm\/?/, '') || '(main)')
        }
        if (mods.length > 0) {
            table[path.relative(ROOT, fp).split(path.sep).join('/')] = [...new Set(mods)].sort()
        }
    }
    return table
}


export { scanServOrmImports }
