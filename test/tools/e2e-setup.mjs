//e2e／api 共用設施：啟動本 harness 專屬之隔離測試實例（後端 11108＋前端 8091）、DB 種子、cleanup、captureStable。
//測試實例與 3 srv（後端 11008／前端 8080）分離、可並存：
//  - 後端：以 test/tools/e2e-settings.json（serverPort 11108、archiveAfterDays=0）啟動，工作目錄為 test/_tmp/e2e-harness/root，
//    故 db／dbf／logs／uploadTemp／tableTags 皆落該處，不動開發用之 ./db 等（2026-09-27 實測正式 ./db 之檔案與 mtime 不變）。
//  - 前端：以 node 直接執行 vue-cli-service serve --port 8091（即 npm run serve 之 script 內容），使 dev server 為本行程之直接子行程
//    （可以 PID 確認為自建；本行程被外力終止時由 Windows job 一併帶走）；/api 經 WTASK_DEV_PROXY_TARGET 指向 11108（vue.config.js）。
//行程所有權（他專案曾以命令列含 srv.mjs 比對殺掉整台機器之後端；本 harness 絕不以命令列、映像名或 port 監聽者殺行程）：
//  - 前後端只用本 harness 自建者；port 被非自建行程佔用即拋錯（附命令列），不沿用、不殺。偏離 e2e 技能 C2「port 已佔用即 reuse」之依據：
//    每案重建種子須能殺掉並重啟後端，而 CLAUDE.md 只允許重啟自己所創建的 PID；沿用他人之服務會使重建種子靜默失效。
//  - 只殺自建且仍存活之 child（同步 taskkill /F /T）並回驗；重建種子前先把測試資料庫整個移開（有人持有即整體失敗、不動任何檔案）。
//  - 同一專案同時只允許一個 harness（互斥 port 11208）；NODE_ENV=production 拒跑（srv.mjs 之測試權杖停用）。
//  - 規則之實作與單元測試：test/tools/harnessLifecycle.mjs（編排）、test/tools/harnessProc.mjs（OS 層）；本檔只負責組裝與註冊收尾。
//  - 本檔與 e2e-settings.json、seed-archived-task.mjs 於 2026-09-28 自 test/ 頂層移入 test/tools/（全域 §16.4：輔助工具放 test/tools/）。
//  - cleanup 兩個觸發來源：mocha root after() hook（框架環境；殺完回驗、未通過即失敗）＋各直跑 baseline 腳本末顯式呼叫 cleanup()；
//    exit／SIGINT／SIGTERM／SIGHUP 為備援（同步殺，處理器內亦能殺完）。
//瀏覽端點一律 127.0.0.1（§6.3 避 IPv6 happy-eyeballs）；登入帶 ?token=sys（w-ui-loginout 以 admin 驗證，不依賴 isDev）。
//2026-09-28 起截圖／比對／啟動改組裝自 e2e 共用設施（當時為 w-web-sso 之 srcPack；2026-09-29 起為 devDependency w-package-tools-e2e 1.0.2，
//同名同行為，2026-09-30 起 1.0.3，下文「套件」即指它；經 ./e2eLib.mjs 引用）：
//  launchBrowser（確定性渲染六旗標）、captureStable（strict、<img> SMIL 頁面座標處理）、captureStableWithBox（紅框截圖後以 sharp 合成，不再注入 DOM）、
//  assertBaselineMatch、waitUntilExist、getE2eMode（診斷閘門）、registerCleanupHooks；行程所有權之 harness（own 政策）仍為本專案 ./harnessLifecycle.mjs。

import { spawn } from 'child_process'
import http from 'http'
import JSON5 from 'json5'
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join } from 'path'
import { createHarness } from './harnessLifecycle.mjs'
import { listenerPids, isPortListening, killOwnTree, waitChildExit, pidExists, sleepSync, moveAwayDir, rmDirBestEffort, runUntilMarker, describeProcs, findNodeProcsByCommandLine, acquirePortLock, releasePortLock } from './harnessProc.mjs'
import {
    getE2eMode,
    launchBrowser as pkgLaunchBrowser,
    captureStable as pkgCaptureStable,
    captureStableWithBox as pkgCaptureStableWithBox,
    waitColResizeOverlay,
    waitDrawerReady,
    resetAgGridScroll,
    rowBoxSel as pkgRowBoxSel,
    assertBaselineMatch as pkgAssertBaselineMatch,
    waitUntilExist as pkgWaitUntilExist,
    registerCleanupHooks,
    probeStuckTooltip as pkgProbeStuckTooltip
} from './e2eLib.mjs'

//REGEN 診斷閘門守則（全域技能 role-coder-for-test-e2e references/pixel-mismatch-diagnosis.md §6）：
//診斷 env（E2E_BARE / E2E_DIAG）生效時絕不可寫入正式 baseline（getE2eMode 於此拋錯）。
getE2eMode()

const __dir = dirname(fileURLToPath(import.meta.url))
const projRoot = join(__dir, '..', '..') //本檔在 test/tools/

//測試實例之設定（JSON5）：後端 port、log 目錄、停用封存等皆以此檔為唯一來源
const E2E_SETTINGS = join(__dir, 'e2e-settings.json')
const e2eSettings = JSON5.parse(fs.readFileSync(E2E_SETTINGS, 'utf8'))
//11108：與 3 srv 之 11008 分離（vue.config.js 之 proxy 預設仍為 11008，harness 以 WTASK_DEV_PROXY_TARGET 改指此 port）
const BACKEND_PORT = e2eSettings.serverPort
//task e2e 前端用獨立的 8091（避開 3 srv 與其他專案常駐於 8080 之 dev server），以 --port 顯式指定確保確定性
const FRONTEND_PORT = 8091
//跨行程互斥 port：同一專案同時只允許一個 harness（行程死亡時由 OS 釋放）
const LOCK_PORT = 11208
//測試中介資料（test/_tmp 已 gitignore；cleanup 時整個刪除）
//本檔在 test/tools/，須上一層才是 test/_tmp（2026-09-29 修正：搬入 tools/ 時沿用 join(__dir, '_tmp')，實際落在未 gitignore 之 test/tools/_tmp）
const TMP_DIR = join(__dir, '..', '_tmp')
const HARNESS_DIR = join(TMP_DIR, 'e2e-harness')
const ROOT_DIR = join(HARNESS_DIR, 'root') //後端與種子腳本之工作目錄（db／dbf／logs／uploadTemp／tableTags 皆落此）
const TRASH_DIR = join(HARNESS_DIR, 'trash') //重建種子時移開之舊測試資料庫
const SETTINGS_DIR = join(HARNESS_DIR, 'settings') //genTempSettings 之臨時設定
const FILES_DIR = join(HARNESS_DIR, 'files') //tmpFile 之測試用暫存檔
//假時鐘（e2e 技能契約 C15）：測試後端一律以 --import 載入 ./fakeNow/register.mjs，把本專案寫入時間欄之 nowms2str 導向替身；
//替身只在標記檔存在時回傳固定之執行期錨點，標記檔由 setFakeNow() 逐案開啟、clearFakeNow()／reseedBackend() 關閉（未開啟者為真時鐘）。
const FAKE_NOW_REGISTER = pathToFileURL(join(__dir, 'fakeNow', 'register.mjs')).href
const FAKE_NOW_FILE = join(HARNESS_DIR, 'fake-now.json')
//執行期錨點：晚於種子（2026-01-01 當日各時段）之次日，使測試中新增之資料一眼可辨
export const FAKE_NOW_RUNTIME = '2026-01-02T09:00:00.000+08:00'
//vue-cli-service 入口（package.json 之 "serve": "vue-cli-service serve"）
const VUE_CLI_SERVICE = join(projRoot, 'node_modules', '@vue', 'cli-service', 'bin', 'vue-cli-service.js')

export const apiBaseUrl = `http://127.0.0.1:${BACKEND_PORT}`
export const baseUrl = `http://127.0.0.1:${FRONTEND_PORT}`
//帶 ?token=sys 讓 w-ui-loginout 以系統管理者(admin)登入；dev/prod build 皆確定登入。
export const appUrl = `${baseUrl}/?token=sys`
//本次測試後端之 srLog 目錄（api-tokenLeak 據此只讀本次後端之記錄）
export const backendLogDir = path.resolve(ROOT_DIR, e2eSettings.logFd || './logs')

function httpOk(url, timeoutMs = 2500) {
    return new Promise((resolve) => {
        const req = http.get(url, (res) => {
            res.resume()
            resolve(typeof res.statusCode === 'number' && res.statusCode > 0 && res.statusCode < 500)
        })
        req.on('error', () => resolve(false))
        req.setTimeout(timeoutMs, () => { req.destroy(); resolve(false) })
    })
}

//以 node 直接起後端：srv.mjs 與設定檔一律絕對路徑（命令列可辨識為本專案之測試實例），工作目錄為測試實例目錄；
//另載入假時鐘 hook（見 FAKE_NOW_REGISTER），標記檔路徑以環境變數交給替身
function spawnBackend(settingsPath) {
    fs.mkdirSync(ROOT_DIR, { recursive: true })
    return spawn(process.execPath, ['--import', FAKE_NOW_REGISTER, join(projRoot, 'srv.mjs'), path.resolve(projRoot, settingsPath)], {
        cwd: ROOT_DIR,
        env: { ...process.env, WTASK_E2E_FAKE_NOW_FILE: FAKE_NOW_FILE },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
    })
}

//開啟假時鐘：此後測試後端寫入之時間欄（訊息 timeCreate 等）皆為 now（預設執行期錨點），直到 clearFakeNow() 或下一次 reseedBackend()
export function setFakeNow(now = FAKE_NOW_RUNTIME) {
    fs.mkdirSync(HARNESS_DIR, { recursive: true })
    fs.writeFileSync(FAKE_NOW_FILE, JSON.stringify({ now }))
}

//關閉假時鐘（冪等）
export function clearFakeNow() {
    fs.rmSync(FAKE_NOW_FILE, { force: true })
}

//以 node 直接起前端 dev server（不經 shell／npm，使其為本行程之直接子行程）；/api proxy 指向本次之測試後端
function spawnFrontend() {
    return spawn(process.execPath, [VUE_CLI_SERVICE, 'serve', '--port', String(FRONTEND_PORT)], {
        cwd: projRoot,
        env: { ...process.env, WTASK_DEV_PROXY_TARGET: apiBaseUrl },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
    })
}

//種子腳本（以測試實例目錄為工作目錄，g.getSettings 之 './db' 即測試資料庫）：見 stdout 'finish.' 即結束該子行程並等它關閉（lmdb 會卡 event loop）；
//腳本自行 catch 例外時只印字不退出，見字即判失敗。base＝g.initialData（demo channel/messages/tasks）；
//archived＝test/tools/seed-archived-task.mjs（一筆 tasksArchive 封存種子，供 E2E-013；僅於重建種子之視窗、後端重啟前執行）。
const SEEDS = {
    base: { script: join(projRoot, 'g.initialData.mjs'), label: 'seedDb(g.initialData.mjs)', failMarkers: ['initialData catch'] },
    archived: { script: join(projRoot, 'test', 'tools', 'seed-archived-task.mjs'), label: 'seedArchivedTask', failMarkers: ['seedArchivedTask catch'] },
}
async function runSeed(kind, { onSpawn }) {
    const s = SEEDS[kind]
    fs.mkdirSync(ROOT_DIR, { recursive: true })
    const tail = await runUntilMarker(process.execPath, [s.script], { cwd: ROOT_DIR, label: s.label, failMarkers: s.failMarkers, timeoutMs: 20000, closeTimeoutMs: 5000, onSpawn })
    if (/clear dbf warn/.test(tail)) {
        console.log(`[e2e-setup] 警告：${s.label} 未能清空測試實例之 dbf（files 表已清，孤兒實體檔不影響以 files 表為準之查詢）；輸出尾段：\n${tail}`)
    }
    return tail
}

let lockServer = null
let trashSeq = 0

const harness = createHarness({
    backendPort: BACKEND_PORT,
    frontendPort: FRONTEND_PORT,
    backendUrl: `${apiBaseUrl}/`,
    frontendUrl: `${baseUrl}/`,
    defaultSettings: E2E_SETTINGS,
    dbDir: join(ROOT_DIR, 'db'),
    trashDir: TRASH_DIR,
    makeTrashPath: () => join(TRASH_DIR, `db-${process.pid}-${trashSeq++}`),
}, {
    spawnBackend,
    spawnFrontend,
    runSeed,
    httpOk,
    listenerPids: (port) => listenerPids(port),
    isPortListening: (port) => isPortListening(port),
    killOwnTree: (child) => killOwnTree(child),
    waitChildExit,
    pidExists: (pid) => pidExists(pid),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    sleepSync,
    now: () => Date.now(),
    moveAwayDir: (dir, trash) => moveAwayDir(dir, trash),
    rmDirBestEffort: (dir) => rmDirBestEffort(dir),
    describeProcs: (pids) => describeProcs(pids),
    //疑似持有測試資料庫者（只讀、僅供錯誤訊息）：本 harness 以絕對路徑起之行程，其命令列含專案根目錄
    findHolders: () => findNodeProcsByCommandLine(projRoot, { excludePids: [process.pid] }),
    acquireLock: async () => {
        lockServer = await acquirePortLock(LOCK_PORT, { describeHolder: () => describeProcs(listenerPids(LOCK_PORT) || []) })
    },
    releaseLock: () => {
        releasePortLock(lockServer)
        lockServer = null
    },
    //srv.mjs 未設 serverPort 時預設 11008（srv.mjs 之 get(stApp, 'serverPort', 11008)）
    readSettingsPort: (p) => {
        const st = JSON5.parse(fs.readFileSync(path.resolve(projRoot, p), 'utf8'))
        return st.serverPort === undefined ? 11008 : Number(st.serverPort)
    },
    //行程皆已殺並回驗後，刪除整個測試中介資料目錄。同刪庫原則：先整個 rename 移開（其中有檔案被其他行程持有即整體失敗、不動任何檔案），
    //成功才刪；失敗則保留，下次開場時測試資料庫以移開方式處理、其餘檔案於下次 cleanup 一併刪除（直接遞迴刪除會把他人持有之資料庫刪掉一部分）。
    afterCleanup: () => {
        if (!fs.existsSync(HARNESS_DIR)) return
        const doomed = `${HARNESS_DIR}-deleting-${process.pid}`
        try {
            fs.renameSync(HARNESS_DIR, doomed)
        }
        catch (e) {
            console.log(`[e2e-setup] 警告：測試中介資料目錄 ${HARNESS_DIR} 仍有檔案被持有（${e.code}），本次不刪除、留待下次清理`)
            return
        }
        rmDirBestEffort(doomed)
        try {
            const fdTmp = TMP_DIR
            for (const n of fs.readdirSync(fdTmp)) {
                if (n.startsWith('e2e-harness-deleting-')) { rmDirBestEffort(join(fdTmp, n)) } //先前刪不掉之殘留（已移開、無人持有）
            }
            if (fs.readdirSync(fdTmp).length === 0) { fs.rmdirSync(fdTmp) }
        }
        catch (e) {}
    },
})

//啟動（或沿用本行程已起之）自建測試實例。API 契約測試傳 backendOnly 只起後端，省去前端 webpack 首編；e2e 不傳→照起前端。
//就緒 promise 依服務分拆：api 檔以 backendOnly 先呼叫時，同一 mocha 行程（npm test）後跑之 e2e 檔仍會起前端（w-web-perm 2026-07-10 同型殷鑑）。
export async function startServersOnce(opts = {}) {
    clearFakeNow() //前次中斷殘留之假時鐘標記檔不帶入本次（api 測試不經 reseedBackend）
    await harness.startServersOnce(opts)
}

//—— 測試中介檔：一律落 test/_tmp/e2e-harness/（gitignore），cleanup 時整個刪除 ——
//不用專案 ./tmp/：後者為 AI 代理暫存區，隨時可能被整個清除，測試途中被刪即假失敗（e2e 技能 §9.2）。
//回傳 test/_tmp/e2e-harness/files/<name> 之絕對路徑（並建立目錄）；檔案由呼叫端寫入。
export function tmpFile(name) {
    fs.mkdirSync(FILES_DIR, { recursive: true })
    return join(FILES_DIR, name)
}

//—— init 等「需注入不同語系/設定」測試專用：genTempSettings + restartBackend（對齊 SSO）——
//產生臨時 settings：以 test/tools/e2e-settings.json(JSON5) 為底 + overrides → 寫 test/_tmp/e2e-harness/settings/ 回傳絕對路徑。
//以 e2e 設定為底（含 archiveAfterDays=0 停用封存；測試封存本身時可用 overrides 開回），停用封存之規則只寫在該檔一處。
//不可覆寫 serverPort／logFd：harness 只管理固定 port 之測試實例，api-tokenLeak 亦依固定之 log 目錄讀記錄。
let tmpSettingsSeq = 0
export function genTempSettings(overrides = {}) {
    for (const k of ['serverPort', 'logFd']) {
        if (k in overrides) { throw new Error(`[e2e-setup] genTempSettings 不可覆寫 ${k}（harness 只管理固定 port 與 log 目錄之測試實例）`) }
    }
    const merged = { ...e2eSettings, ...overrides }
    fs.mkdirSync(SETTINGS_DIR, { recursive: true })
    const p = join(SETTINGS_DIR, `settings-e2e-${process.pid}-${tmpSettingsSeq++}.json`)
    fs.writeFileSync(p, JSON.stringify(merged, null, 2))
    return p
}

//以指定 settings 重啟自建後端（不重建種子）；之後之 reseedBackend 沿用此設定，直到再呼叫 restartBackend() 還原 e2e 預設設定。
//用法：before restartBackend(genTempSettings({ language }))，after restartBackend() 還原。
//設定檔之 serverPort 須為測試實例之 port；只殺本 harness 自建之後端，port 被他者佔用即拋錯。
export async function restartBackend(pathSettings) {
    await harness.restartBackend(pathSettings)
}

//重置 DB 為 pristine demo 種子（hermetic reset）：殺自建後端並回驗 → 確認 port 釋放 → 移開測試資料庫（有人持有即整體失敗）
//→ g.initialData 重建含 demo channel/messages/tasks 之固定種子 → 以目前生效之設定重起後端並確認由它監聽。
//用途：messages / tasks 未列入 ORM 直通（tableNamesExec 僅 channels/channelMembers），無法由前端 RPC 清；
//帶副作用之 case（如發訊）跑完後須以本函式還原 DB，確保跨語系 / 跨 run baseline 之確定性。
//opts.withArchivedTask=true 時, 於 base 種子後、後端重啟前額外寫入一筆 tasksArchive 封存種子
//（供 E2E-013 之封存檢視測試; 該視窗後端未持有 lmdb → 直寫安全）。此封存種子於下一 case 之 reseedBackend()
//（移開測試資料庫重建 pristine）自動清除, 不殘留（同 E2E-003/006 副作用之清理機制）。
//每案重建種子時一併關閉假時鐘（上一案開啟者或中斷殘留之標記檔不帶入下一案）
export async function reseedBackend(opts = {}) {
    clearFakeNow()
    await harness.reseedBackend(opts)
}

//同步殺本 harness 自建之全部行程（含執行中之種子子行程）並於上限內回驗，釋放互斥、刪除測試中介資料；冪等
export function cleanup() {
    harness.cleanup()
}

//全專案唯一 launch 出口（技能 §3 C1）：套件 launchBrowser 帶確定性渲染六旗標（--disable-gpu、--force-color-profile=srgb、--disable-lcd-text、
//--disable-font-subpixel-positioning、--disable-skia-runtime-opts、--disable-partial-raster）。2026-09-28 前本專案為裸 launch（技能 §8.4 缺口），
//加旗標＝全量重產標準圖（技能 §7.9）。
export async function launchBrowser() {
    return await pkgLaunchBrowser()
}

//開乾淨頁（全新 context 無殘留 token，直接以 ?token=sys 進入），回傳已可互動的 page。
export async function openApp(browser, opts = {}) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts })
    const page = await context.newPage()
    //per-case 為全新 context（localStorage/cookie 本就空），故不需先到 baseUrl 清 localStorage。
    //【flake 修正】先前先 goto baseUrl(不帶 token) 再 evaluate(localStorage.clear)：但端點為 127.0.0.1 使
    //w-ui-loginout 之 isDev() 為 false（href 不含 'localhost'）→ 無 token 登入失敗 → App.vue loginError 觸發
    //轉址，轉址在 localStorage.clear 之 evaluate 執行時毀掉 execution context（intermittent「context destroyed
    //by navigation」）。fresh context 無殘留 token，直接帶 ?token=sys 進入即登入成功、不轉址、context 穩定。
    await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 120000 })
    //等登入完成 + 譯文就緒才回傳。kpText 在 UpdateWebInfor 後才由 ui.setLang(null) 重算（main.js），
    //故不能只等 webInfor truthy；直接等 $t 譯出非 key 值（且 syncState 完成）確保 kpText 已載入。
    //防禦性 retry：極少數情況 readiness poll 期間若遇 SPA 內部 navigation 致 context destroyed，settle 後重試一次。
    let waitReady = () => page.waitForFunction(() => {
        const vo = window.$vo
        const st = vo && vo.$store && vo.$store.state
        return !!(st && st.connState === 'csLogin' && st.webInfor && st.syncState === true && vo.$t && vo.$t('mmChannels') !== 'mmChannels')
    }, null, { timeout: 60000 })
    try {
        await waitReady()
    }
    catch (err) {
        if (String(err && err.message).includes('Execution context was destroyed')) {
            await page.waitForTimeout(800)
            await waitReady()
        }
        else {
            throw err
        }
    }
    return page
}

//pixel baseline 截圖統一 helper（套件 captureStable，與 sso / perm / api 同一實作）。順序：park mouse → 初始等待 1500ms →
//settle：WDrawer 拖曳分隔條 overlay opacity=1（waitColResizeOverlay）、抽屜 [state] 皆為 opened/hidden（waitDrawerReady，事件驅動）→
//凍結 inline SVG SMIL → 等字型 → 連拍前 ag-grid 水平捲動歸零並等 300ms（resetAgGridScroll，本專案原步驟）→
//<img> 內 SVG 動畫區截圖後貼靜態影格（套件 imgSmilFill 預設 'static'：以區外左側像素色填底，再貼上去掉動畫元素之 SVG 算繪；
//頁面座標）→ 連拍至相鄰兩張相同。（2026-09-29 更正註解：原寫「填黑」，為共用設施 2026-09-28 改預設前之行為）
//strict（2026-09-28 補上，原缺）：opts.strict 為布林值時依之，否則讀 E2E_STRICT_CAPTURE（generateBaseline() 於迴圈前設 '1'）：
//產製端未 settle 即拋錯、拒絕寫入未穩定畫面；比對端回傳最後一張交由比對揭露真實 flake。
//【park mouse + tooltip 處理原則 — 只用使用者可達操作】（各 agent 改 e2e 時依循）
//  · park mouse（mouse.move(0,0)＝使用者真實移開游標）會觸發 mouseleave → tooltip 消失 → 截圖穩定；單純出現 dialog 遮罩時亦同（最小重現）。
//  · park 後提示框仍在即缺陷，不是可接受狀態（2026-09-29 更正原載「dialog 全屏遮蔽層擋住 mouseleave，截圖含 tooltip 視為可接受」）。
//    曾見成因：w-component-vue ≤2.5.23 之 WButtonCircle 於點擊時以 v-if 換掉游標下之圖示（promiseUnlock 載入圖示），接著出現 dialog 遮罩時
//    mouseleave 未送達觸發區（Playwright ≤1.62 預設停用「命中節點被移除後以最近祖先為目標」）；2.5.24 起圖示層與停用遮罩 pointer-events:none 已修正。
//    截圖前以 probeStuckTooltip 守門：再出現即拋錯使該案失敗（不凍結為標準圖）。
//  · 絕不以合成事件（dispatchEvent mouseleave 等）強清 tooltip——那非使用者可達操作（L5），違反 e2e act 須 user-facing。
export async function captureStable(page, opts = {}) {
    return await pkgCaptureStable(page, { settle: [waitColResizeOverlay, waitDrawerReady], ...opts, beforeShots: [probeStuckTooltip, ...(opts.beforeShots || [resetAgGridScroll])] })
}

//probeStuckTooltip: 提示框殘留之回歸守門（技能 role-coder-for-test-e2e §10〈提示框／hover 殘留〉；spec D16）。captureStable 已將游標移至 (0,0)
//並等待 ≥1.5 秒，此時仍顯示之 hover 型提示框（WTooltip mode='tooltip'，文字不限：儲存、刪除、對話框 Save 等）必為殘留，拋錯使該案失敗
//（2026-09-30 起；元件修正前為只認 saveChanges 之 knownDefect pending）。點開型浮層（mode='popup'：WPopup、下拉清單）為刻意開啟，不在此列；
//判斷由套件 probeStuckTooltip 執行（1.0.3 起；原四專案各自手寫之同一實作收斂至套件，未給 rootSel 時頁內邏輯與原實作相同）：
//以 WTooltip 內部結構辨識（$refs.divTrigger／divContent、props.mode、data.valueTrans），根實例取 window.$vo（App.vue 掛上），無則取 body 直屬元素之 __vue__。
//元件改寫會使其找不到提示框而一律通過（靜默失效），升級 w-component-vue 時須以真元件頁複驗（規則帳本）。本檔只注入錯誤訊息（指出成因與先查何處）。
async function probeStuckTooltip(page) {
    return await pkgProbeStuckTooltip(page, {
        createError: (texts) => new Error(`游標已移開，提示框「${texts.join('」「')}」仍顯示（提示框殘留；w-component-vue 2.5.24 已修正 WButtonCircle 之成因，再現即回歸，先確認已安裝之 WButtonCircle.vue 圖示層仍帶 pointer-events:none）`),
    })
}

//整張全頁截圖 + 在「此 e2e 要比對/觀看的區塊」外圍畫紅框（#f26、5px）標注，讓報表/審查委員一眼看出本
//case 主要觀看哪一區，截圖仍為完整畫面、保留 UI 脈絡，不裁切成小片。移植自 w-web-api test/e2e-setup.mjs。
//target：CSS selector 字串 / 字串陣列 / Playwright Locator / 以上混合陣列（多個取聯集框成一個框）。
//  ——欄位列須依 label 文字定位時用 Locator（如 page.locator(...).filter({ hasText: '名稱' })）。
//fold 以下的目標會先把第一個 scrollIntoView 捲進視窗再框（同組目標應在同一捲動位置）。
//紅框於截圖後以 sharp 合成（套件 captureStableWithBox；2026-09-28 前為 DOM 注入之 position:fixed 框，技能 §8.3 列缺口：
//插入後又移除之暫時 DOM 偶發使整頁光柵化偏 1px，量測工具不得改動被測頁）。幾何同原 DOM 版：聯集 rect ±6 外擴、四邊夾在截圖當下之視窗內（M=3，
//clampTo:'viewport'）、5px #f26 框線、圓角 4px；目標與捲動量皆在截圖「之前」量。
export async function captureStableWithBox(page, target, opts = {}) {
    return await pkgCaptureStableWithBox(page, target, { clampTo: 'viewport', guardSmall: false, ...opts, capture: captureStable })
}

//框「整列」用 selector：ag-grid 一列跨 center + pinned-left 兩容器（勾選框欄在 pinned-left），
//回傳兩選擇器供 captureStableWithBox 取聯集，框出涵蓋整列（含勾選框）的紅框；單一 .ag-row 選擇器
//只會 querySelector 到其中一個容器、漏掉另一半（殷鑑：勾選框在 pinned-left）。順序 center 在前（套件 rowBoxSel 之 order 指定）。
export function rowBoxSel(rowIndex) {
    return pkgRowBoxSel(rowIndex, { order: ['center', 'pinned-left'] })
}

//baseline 比對 + fail 時保留證據到 ./testPending (不覆蓋), 供事後 pixel diff 定位 flake/破壞.
//
//比對採 pixelmatch (反鋸齒感知) + maxDiffPixels 容差, 取代舊的 buf.equals (byte-exact):
//- pixelmatch includeAA:false (預設) 會自動偵測並「忽略反鋸齒邊緣像素」(YIQ 感知色差 + AA slope 偵測),
//  專治 SVG icon / 字型邊緣之次像素 raster 差異 (跨 browser session 不決定性), 不再因此 flake.
//- maxDiffPixels: 允許之最大「真不同」像素數 (預設 100). 反鋸齒殘留遠低於此 (個位數~數十); 真 regression
//  (icon 換 / 版面位移 / 顏色變) 動輒數百~數千 px 遠超此 → 仍被抓到. 業界標準, 同 Playwright toHaveScreenshot.
//- 尺寸不同 = 必為真差異 (版面/裁切變) → 直接 fail.
//- pixel baseline 為補強層, 每 case 仍須語意斷言為主 (全域規範 §6.2): 容差只放輔助層, 主驗證仍嚴.
//
//pass: 靜默通過. fail: 將「當次 capture」「baseline」「diff 標紅圖」存檔 (帶 timestamp 不覆蓋) 後 throw.
//  (./testPending 帶 timestamp 保留, 任何 fail 當次證據都留存可 diff; 已 gitignore, 不進 repo.)
//label: 給檔名用之可讀標籤 (如 'task-cht-E2E-003-claim'); 省略則用 baseline 檔名.
//opts.maxDiffPixels / opts.threshold: 可由呼叫端覆寫 (預設 100 / 0.1), 供個別 case 需更嚴/更鬆時用.
//套件 assertBaselineMatch (同步函數, 與原實作同判準、同證據檔名格式 <label>__<ms 時間戳>[-N]__{capture,baseline,diff}.png).
export function assertBaselineMatch(buf, baselinePath, label, opts = {}) {
    return pkgAssertBaselineMatch(buf, baselinePath, label, opts)
}


//等待 DOM 條件（每步驟先偵測再操作，取代 fixed sleep）；套件 waitUntilExist，本專案預設逾時 15000ms（沿用原值）。
export async function waitUntilExist(page, label, fn, opts = {}) {
    await pkgWaitUntilExist(page, label, fn, { timeout: 15000, ...opts })
}


//收尾（套件 registerCleanupHooks）：mocha root teardown hook（框架環境自動觸發）改呼叫 harness.teardown()——同步殺自建行程後，
//以 exit 事件與 port 回驗；測試期間自建服務非預期結束亦判失敗。非框架/中斷時備援（cleanup 為同步殺，於 exit／signal 處理器內亦能殺完）。
//Windows 上他行程送來之 SIGTERM／SIGINT 實為強制終止、處理器不會執行（同外力終止）：此時自建前後端為直接子行程，由 job 一併帶走。
registerCleanupHooks(cleanup, {
    afterTimeoutMs: 60000,
    teardown: () => harness.teardown(),
    signals: { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 },
})
