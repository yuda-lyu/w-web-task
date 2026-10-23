//頻道任務調度 e2e（v2 聊天式工作區 UI）。對應 spec/流程_頻道任務調度.md。
//使用方式：
//  1. 先產生標準圖：node test/e2e-channeltask.test.mjs --baseline （寫 test/pics/channeltask/）
//  2. 跑測試比對：npx mocha test/e2e-channeltask.test.mjs --reporter list （pixelmatch 反鋸齒感知 + maxDiffPixels 容差，非 byte-exact）
//  手術式重產（截圖前篩選, 規格詳 w-package-tools-e2e 之 README.md §2.2）: --names <項,...> 每項可帶語系前綴（eng-/cht-）, 不帶則兩語系皆產;
//    階段圖鍵只寫該張, 案例鍵或編號前綴（如 E2E-005）寫該案全部階段, 不符任何鍵即報錯; --langs; --write-mode missing|changed;
//    env E2E_BASELINE_OUT_DIR=<dir> 寫到暫存目錄（等價驗證用）。
//    本檔多數案例單張（圖鍵＝案例鍵）; E2E-002/004/005 為兩階段（點擊前 -1-click-*、點擊後 -2-*，2026-09-28 E 第 1 期試點）;
//    E2E-007 為三階段（輸入前 -1-type-payload、輸入後 -2-payload-typed、送出後 -3-sanitized; 2026-09-29 補圖, 原為語意-only）。
//  產製端與比對端呼叫同一案例管線（runBaselineCase）: 每案 reseedBackend（E2E-013 另加封存種子）→ fresh browser → openApp → setLang
//    → 流程（截圖）→ 語意斷言 → 寫檔 / 比對; 產製端另設 E2E_STRICT_CAPTURE=1（captureStable 未 settle 即拋錯, 不寫未穩定畫面）。
//act 走 user-facing input（rail nav 真實滑鼠座標點擊 / 頻道列真實點擊 / Pattern D 鍵盤輸入）；
//assert = UI 語意斷言 + pixel baseline（全域 §16.1 / §16.2）。
//
//baseline 確定性：demo 種子之 messages / tasks / channels 時間欄位皆為固定字串（見 g.initialData.mjs），
//UI 顯示之時間戳跨次 seed 完全一致 → pixel baseline 穩定。頻道名 / levels 為資料（恆中文），雙語下相同；
//雙語 baseline 之差異僅在 i18n chrome（rail 標籤 / 標題 / pills / 按鈕 / grid 表頭）。
//唯一帶 live 時間戳之 case 為 E2E-003（真實發訊），其視覺 baseline 改框「composer 發訊區」並於送出前截圖（避開 live 時間戳區）。
//
//DB 採 per-case reseed（技能 role-coder-for-test-e2e §6「每 case 隔離：fresh browser + DB 重置」hermetic 標準）：每 case 於 runCase 之 prepare（產製端與比對端同）還原 pristine demo 種子，
//故 E2E-003 發訊副作用不會污染後續 case（如 E2E-004 stats 之訊息計數），spec bullet 順序 / 檔案排序 / 執行順序三者一致且安全。
import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { PNG } from 'pngjs'
import { startServersOnce, reseedBackend, cleanup, tmpFile, launchBrowser, openApp, captureStableWithBox, waitUntilExist, assertBaselineMatch, setFakeNow, clearFakeNow, FAKE_NOW_RUNTIME } from './tools/e2e-setup.mjs'
import { runBaselineCase, createBaselineGate, gridContentBox, itemsUnionBox } from './tools/e2eLib.mjs'

const PICS_DIR = './test/pics/channeltask'
const LANGS = ['eng', 'cht']
const isBaseline = process.argv.includes('--baseline')

//E2E-006 上傳用之本地暫存 PNG（setup 階段準備之檔案; act 為點附圖鈕觸發 file input 後以 setInputFiles 選此檔）。
//內容為確定性圖樣（固定 48×48 對角漸層）, 但其 file id / 時間戳於上傳後為 live 值, 故不對含此 img 之時間軸做 pixel baseline。
//落點為 harness 之測試中介檔目錄（test/_tmp/e2e-harness/files/, gitignore; cleanup 時刪除）, 不用 AI 暫存區 ./tmp/（隨時可能被清除）。
const UPLOAD_PNG = tmpFile('e2e-up.png')
function ensureUploadPng() {
    if (fs.existsSync(UPLOAD_PNG)) { return }
    fs.mkdirSync(path.dirname(UPLOAD_PNG), { recursive: true })
    let w = 48, h = 48
    let png = new PNG({ width: w, height: h })
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let i = (w * y + x) << 2
            png.data[i] = (x * 5) & 255
            png.data[i + 1] = (y * 5) & 255
            png.data[i + 2] = 160
            png.data[i + 3] = 255
        }
    }
    fs.writeFileSync(UPLOAD_PNG, PNG.sync.write(png))
}

//demo 頻道（id-for-channel-demo, 名「訂單服務」, levels「電商平台改版.後端組」）為流程主角
const CH_DEMO_ID = 'id-for-channel-demo'
const CH_DEMO_NAME = '訂單服務'

//紅框標注目標（captureStableWithBox）：本 case 主要觀看區（皆為穩定 data-fmid / ag-grid 容器）
//框「實際有內容之項目」而非整欄 / 整區（技能 role-coder-for-test-e2e §7.2、§7.3-2；2026-09-28 改：原框整個樹面板、整個時間軸、整個表格外框，
//列少時框進大片空白）：樹與時間軸以 itemsUnionBox 取可見項目之聯集、表格以 gridContentBox 取標頭＋可見資料列
const SEL_TREE_LIST = '[data-fmid="channel-tree-list"]' //左2 頻道階層樹之列表區（群組列 .tnode ＋ 頻道列 .chan）
const SEL_TIMELINE = '[data-fmid="chat-timeline"]'     //聊天時間軸（日期分隔 .day ＋ 訊息列 .msg）
const SEL_COMPOSER = '[data-fmid="composer"]'          //底部 composer 發訊區（textarea + 工具列 + 送出鈕）
const SEL_STATS_OVERVIEW = '[data-fmid="stats-overview"]' //統計 OVERVIEW 卡片區（CHANNELS/MESSAGES/TASKS）
const SEL_GRID = '.ag-root-wrapper'                    //後台資料表（ag-grid 外框; 紅框經 gridContentBox 取標頭＋可見資料列）
const SEL_MEMBERS_DIALOG = '[data-fmid="channel-members-dialog"]' //本頻道成員管理 dialog 之內容區（成員清單 grid）
const SEL_DIALOG_PANEL = 'div[style*="overscroll-behavior"] div[tabindex="0"] > div' //WDialog 面板（標題列＋內容; 與 w-web-perm SEL_MODAL 同）
const SEL_TASK_DETAIL = '[data-fmid="task-detail"]'   //後台任務子頁之任務詳情面板（payload/result + 回應/重試入口）

function picPath(lang, name) { return `${PICS_DIR}/channeltask-${lang}-${name}.png` }

//case-insensitive includes：部分 UI 文字以 CSS text-transform:uppercase 顯示（任務徽章 kbadge / 統計卡標題），
//Playwright innerText 回傳「已套用 text-transform 之 rendered text」(eng 之 'Task'→'TASK'、'Channels'→'CHANNELS')，
//CJK 不受影響故 cht 無差。i18n 來源值才是真理（'Task'/'Channels'），uppercase 純屬顯示層 → 以 CI 比對驗語意。
function incCI(haystack, needle) {
    return String(haystack).toLowerCase().includes(String(needle).toLowerCase())
}

//設定語系（test setup 層, 非 act-under-test; 對齊雙語覆蓋維度）。
//openApp 預設為 webInfor.language（eng）; cht 走 setLang。eng 亦補等同 settle buffer, 治 eng-vs-cht 收斂不對稱。
//註：rail 右下角頭像選單內有語系切換 UI, 但語系切換非本流程 act-under-test（本流程驗的是「檢視/發訊」),
//故以 setLang 於 setup 階段設定語系, 並等 $t 更新（mmStats 譯出非 key 值）確保 kpText 已重算。
async function setLang(page, lang) {
    if (lang !== 'eng') {
        await page.evaluate((l) => { window.$vo.$ui.setLang(l, 'e2e-setLang') }, lang)
    }
    await waitUntilExist(page, `語系 ${lang} 之 $t 就緒`, (l) => {
        let vo = window.$vo
        if (!vo || !vo.$t) { return false }
        //mmStats 譯出非 key 值, 且 cht 時須為中文（避免 eng 殘留）
        let t = vo.$t('mmStats')
        if (t === 'mmStats') { return false }
        if (l === 'cht') { return t === '統計' }
        return t === 'Stats'
    }, { timeout: 15000, arg: lang })
    await page.waitForTimeout(300)
}

//真實滑鼠點擊左1 rail 之 nav item（user-facing L2 絕對座標, 取元素 boundingBox 中心）。
//以 data-fmid="rail-nav-{key}" 精準定位（避免 getByText 誤命中頻道樹標題「Channels」h2 等同字元素）。
async function waitRail(page, key) {
    let sel = `[data-fmid="rail-nav-${key}"]`
    await waitUntilExist(page, `rail nav「${key}」就緒`, (s) => {
        let e = document.querySelector(s)
        if (!e) { return false }
        let r = e.getBoundingClientRect()
        return r.width > 0 && r.height > 0
    }, { timeout: 15000, arg: sel })
    return sel
}
async function clickRail(page, key) {
    let sel = await waitRail(page, key)
    let box = await page.locator(sel).first().boundingBox()
    if (!box) { throw new Error(`找不到 rail nav item「${key}」boundingBox`) }
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

//等頻道樹渲染到位（樹內出現 demo 頻道葉節點, bounding box > 0）。
async function waitTreeReady(page) {
    let sel = `[data-fmid="channel-item-${CH_DEMO_ID}"]`
    await waitUntilExist(page, '頻道樹 demo 葉節點就緒', (s) => {
        let e = document.querySelector(s)
        if (!e) { return false }
        let r = e.getBoundingClientRect()
        return r.width > 0
    }, { timeout: 20000, arg: sel })
    await page.waitForTimeout(300)
}

//真實點擊頻道樹中之 demo 頻道列（user-facing L3, 點使用者可見之頻道列, 觸發 onClickChannel）。
async function clickChannelDemo(page) {
    await waitTreeReady(page)
    await page.locator(`[data-fmid="channel-item-${CH_DEMO_ID}"]`).first().click()
}

//進對話（點 demo 頻道）並等時間軸載入四則種子訊息。
async function gotoChat(page) {
    await clickChannelDemo(page)
    await waitUntilExist(page, '對話時間軸種子訊息載入', () => {
        let t = document.body.innerText || ''
        return t.includes('Welcome to the demo channel.') && t.includes('Summary completed: revenue grew 12% QoQ.')
    }, { timeout: 20000 })
    await page.waitForTimeout(500)
}

//Pattern D（Vue v-model 之 <textarea>）：偵測 → settle → insertText 一次注入 → 驗證 → retry × 3。
async function typeIntoTextarea(page, value) {
    let ta = page.locator('[data-fmid="composer-textarea"]').first()
    await ta.waitFor({ state: 'visible', timeout: 5000 })
    await page.waitForTimeout(800) //v-model binding settle
    for (let attempt = 1; attempt <= 3; attempt++) {
        await ta.click()
        await page.waitForFunction((el) => document.activeElement === el, await ta.elementHandle(), { timeout: 3000 })
        let cur = await ta.inputValue()
        if (cur) { await page.keyboard.press('End'); for (let k = 0; k < cur.length + 2; k++) { await page.keyboard.press('Backspace') } }
        await page.keyboard.insertText(value)
        await page.waitForTimeout(200)
        if ((await ta.inputValue()) === value) { return }
        await page.waitForTimeout(400)
    }
    throw new Error('typeIntoTextarea 3 次仍漏字')
}

//Pattern D 泛用版（Vue v-model / controlled input/textarea）：偵測 → settle → insertText 一次注入 → 驗證 → retry × 3。
//供 E2E-011 之 composer 任務標題輸入、E2E-012 之任務詳情代回 WTextarea（皆 Vue controlled, keyboard.type 會逐字 race 漏字）。
async function typeIntoLocator(page, locator, value) {
    await locator.waitFor({ state: 'visible', timeout: 5000 })
    await page.waitForTimeout(800) //v-model binding settle
    for (let attempt = 1; attempt <= 3; attempt++) {
        await locator.click()
        await page.waitForFunction((el) => document.activeElement === el, await locator.elementHandle(), { timeout: 3000 })
        let cur = await locator.inputValue()
        if (cur) { await page.keyboard.press('End'); for (let k = 0; k < cur.length + 2; k++) { await page.keyboard.press('Backspace') } }
        await page.keyboard.insertText(value)
        await page.waitForTimeout(200)
        if ((await locator.inputValue()) === value) { return }
        await page.waitForTimeout(400)
    }
    throw new Error('typeIntoLocator 3 次仍漏字')
}

//讀後台任務 grid 中「標題為 title 之列」其狀態欄之 rendered innerText（在地化狀態值, 供 UI 語意斷言）。
//title 欄為 kpHeadFixLeft（pinned-left）之 <button>; state 欄在 center 容器同 row-index → 以 row-index 對映取值。
async function taskRowStateText(page, title) {
    return await page.evaluate((ttl) => {
        let btns = [...document.querySelectorAll('.ag-root-wrapper button')]
        let b = btns.find((x) => (x.innerText || '').trim() === ttl)
        if (!b) { return null }
        let row = b.closest('.ag-row')
        let ri = row && row.getAttribute('row-index')
        if (ri === null || ri === undefined) { return null }
        let sc = document.querySelector(`.ag-center-cols-container .ag-row[row-index="${ri}"] [col-id="state"]`)
            || document.querySelector(`.ag-root-wrapper .ag-row[row-index="${ri}"] [col-id="state"]`)
        return sc ? (sc.innerText || '').trim() : null
    }, title)
}

//點後台任務 grid 中「標題為 title 之列」之標題 <button>（真實點擊 → onClickTaskTitle 開詳情面板）。
async function clickTaskTitle(page, title) {
    await waitUntilExist(page, `任務列標題「${title}」就緒`, (t) => {
        let btns = [...document.querySelectorAll('.ag-root-wrapper button')]
        return btns.some((x) => (x.innerText || '').trim() === t)
    }, { timeout: 20000, arg: title })
    await page.locator('.ag-root-wrapper button', { hasText: title }).first().click()
    await waitUntilExist(page, `任務詳情面板開啟（${title}）`, () => {
        let e = document.querySelector('[data-fmid="task-detail"]')
        return !!e && (e.innerText || '').length > 0
    }, { timeout: 10000 })
    await page.waitForTimeout(300)
}

//進後台任務子頁（點 Admin rail → 點「任務」子頁）並等熱表種子任務載入。
async function gotoAdminTasks(page) {
    await clickRail(page, 'admin')
    await waitUntilExist(page, '後台任務子頁鈕就緒', () => !!document.querySelector('[data-fmid="admin-sub-mmTasks"]'), { timeout: 20000 })
    await page.locator('[data-fmid="admin-sub-mmTasks"]').first().click()
    await waitUntilExist(page, '後台任務 grid 種子任務載入', () => (document.body.innerText || '').includes('Summarize quarterly report'), { timeout: 20000 })
    await page.waitForTimeout(400)
}

//=== E2E-008 成員管理 CRUD 用之 helper（走真實 UI: ag-grid cell 編輯 Pattern B / checkbox 選取 / WConfirm modal）===

const SEL_MEMBERS_DLG = '[data-fmid="channel-members-dialog"]'

//以後端 $fapi 讀 demo 頻道成員（assert 用之權威狀態; 屬「觀察後端副作用」補強, 非取代 UI 語意）。
async function membersOf(page, channelId) {
    return await page.evaluate(async (cid) => {
        let r = await window.$vo.$fapi.getChannelMembers(cid)
        return (r || []).map((m) => ({ memberId: m.memberId, role: m.role, memberType: m.memberType }))
    }, channelId)
}

//點 WConfirm modal 之按鈕（div[role=button]）: txt 為該語系之 $t('ok')/$t('yes')。
async function clickConfirmBtn(page, txt) {
    let loc = page.locator('div[role="button"]:visible', { hasText: txt }).last()
    await loc.waitFor({ state: 'visible', timeout: 8000 })
    await loc.click()
    await page.waitForTimeout(300)
}

//等成員 grid 重繪出「非 agent-demo」之新列後, 回其 row-index。
//必要性 + 競態修正: 儲存後 grid 由 membersLocal reload 非同步重繪; 重繪瞬間新 cell 之文字已在 DOM (故僅比文字之等待會提早通過),
//但該 cell 可能尚未掛入 .ag-row (closest 回 null → row-index 取到 undefined)。故等待條件與取值皆要求「cell 位於具 row-index 之 .ag-row 內」。
async function waitNewMemberRowIndex(page) {
    let isNew = (c) => {
        let t = (c.innerText || '').trim()
        if (!t || t === 'agent-demo' || /member id/i.test(t)) { return false }
        let row = c.closest('.ag-row')
        return !!(row && row.getAttribute('row-index') !== null)
    }
    await waitUntilExist(page, '成員 grid 重繪出非 agent-demo 且已具 row-index 之新列', () => {
        let cells = [...document.querySelectorAll('[data-fmid="channel-members-dialog"] [col-id="memberId"]')]
        return cells.some((c) => {
            let t = (c.innerText || '').trim()
            if (!t || t === 'agent-demo' || /member id/i.test(t)) { return false }
            let row = c.closest('.ag-row')
            return !!(row && row.getAttribute('row-index') !== null)
        })
    }, { timeout: 10000 })
    await page.waitForTimeout(400)
    let rid = await page.evaluate((d) => {
        let cells = [...document.querySelectorAll(`${d} [col-id="memberId"]`)]
        let hit = cells.find((c) => {
            let t = (c.innerText || '').trim()
            if (!t || t === 'agent-demo' || /member id/i.test(t)) { return false }
            let row = c.closest('.ag-row')
            return !!(row && row.getAttribute('row-index') !== null)
        })
        return hit ? hit.closest('.ag-row').getAttribute('row-index') : null
    }, SEL_MEMBERS_DLG)
    if (rid === null) { throw new Error('waitNewMemberRowIndex 未取得有效 row-index') }
    return rid
}

//Pattern B：編輯成員 grid 指定 row 之 role cell（role 欄無 checkbox、無自訂 renderer, 為乾淨可編欄）。
async function editRoleCell(page, rowIndex, value) {
    let cell = page.locator(`${SEL_MEMBERS_DLG} .ag-row[row-index="${rowIndex}"] [col-id="role"]`).first()
    await cell.scrollIntoViewIfNeeded()
    await cell.dblclick()
    await page.waitForTimeout(900) //editor mount settle
    let editor = page.locator(`${SEL_MEMBERS_DLG} .ag-cell-inline-editing input:not(.ag-checkbox-input)`).first()
    await editor.waitFor({ state: 'visible', timeout: 5000 })
    let cur = await editor.inputValue().catch(() => '')
    if (cur) { await page.keyboard.press('End'); for (let k = 0; k < cur.length + 2; k++) { await page.keyboard.press('Backspace') } }
    await page.keyboard.insertText(value)
    await page.waitForTimeout(200)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)
}

//=== E2E-014 / E2E-015（多人同時編輯: 後台清單頁之草稿保護與舊畫面存檔被拒）用之 helper ===

//取後台 grid 中「colId 欄文字等於 text」之列 row-index（name / memberId 欄為 pinned-left, 與 center 容器同 row-index）。
async function rowIndexByText(page, colId, text) {
    let rid = await page.evaluate(({ c, t }) => {
        let cells = [...document.querySelectorAll(`.ag-root-wrapper [col-id="${c}"]`)].filter((e) => e.closest('.ag-row'))
        let hit = cells.find((e) => (e.innerText || '').trim() === t)
        return hit ? hit.closest('.ag-row').getAttribute('row-index') : null
    }, { c: colId, t: text })
    if (rid === null) { throw new Error(`rowIndexByText 找不到 ${colId}=「${text}」之列`) }
    return rid
}

//Pattern B：就地編輯後台 grid 指定 row 之 colId 儲存格（同 editRoleCell, 範圍為整頁 grid 而非成員視窗）。
async function editGridCell(page, rowIndex, colId, value) {
    let cell = page.locator(`.ag-center-cols-container .ag-row[row-index="${rowIndex}"] [col-id="${colId}"]`).first()
    await cell.scrollIntoViewIfNeeded()
    await cell.dblclick()
    await page.waitForTimeout(900) //editor mount settle
    let editor = page.locator('.ag-cell-inline-editing input:not(.ag-checkbox-input)').first()
    await editor.waitFor({ state: 'visible', timeout: 5000 })
    let cur = await editor.inputValue().catch(() => '')
    if (cur) { await page.keyboard.press('End'); for (let k = 0; k < cur.length + 2; k++) { await page.keyboard.press('Backspace') } }
    await page.keyboard.insertText(value)
    await page.waitForTimeout(200)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)
}

//讀後台 grid 指定 row 之 colId 儲存格 rendered innerText。
async function gridCellText(page, rowIndex, colId) {
    return await page.evaluate(({ r, c }) => {
        let e = document.querySelector(`.ag-center-cols-container .ag-row[row-index="${r}"] [col-id="${c}"]`)
        return e ? (e.innerText || '').trim() : null
    }, { r: rowIndex, c: colId })
}

//選擇後台成員頁頻道選擇器（WTextSelect）之頻道（頻道名為資料文字, 不隨語系）: 點觸發區（`div[_tabindex="0"]`, 容器橫跨整列, 點容器中心會落在空白處）展開下拉
//→ 清單為 teleport 至 body 之浮層（.WPopperFix, position:fixed）, 項目為 `div[tabindex="0"]` → 點清單項（作法同姊妹專案 w-web-perm 之 setDialogModeWithShots）。
async function selectMembersChannel(page, name) {
    await page.locator('[data-fmid="members-channel-selector"] div[_tabindex="0"]').first().click()
    let item = page.locator('.WPopperFix div[tabindex="0"]').filter({ hasText: new RegExp(`^\\s*${name}\\s*$`) }).first()
    await item.waitFor({ state: 'visible', timeout: 10000 })
    await page.waitForTimeout(400)
    await item.click()
    await item.waitFor({ state: 'hidden', timeout: 10000 })
    await page.waitForTimeout(800)
}

//另一位管理員之寫入（arrange, 未走 UI）: 以頁面既有連線呼叫後端業務函式（不帶基準之外部呼叫）; 寫入前開啟測試實例之固定時鐘使 timeUpdate 確定, 寫入後關閉。
async function otherAdminCall(page, fnName, args) {
    setFakeNow()
    try {
        return await page.evaluate(async ({ f, a }) => { return await window.$vo.$fapi[f](...a) }, { f: fnName, a: args })
    }
    finally {
        clearFakeNow()
    }
}

//等「資料已被他人更新」提示條出現, 並回其文字
async function waitStaleNotice(page) {
    await waitUntilExist(page, '草稿保護提示條出現', () => !!document.querySelector('[data-fmid="draft-stale-notice"]'), { timeout: 25000 })
    await page.waitForTimeout(500)
    return await page.evaluate(() => document.querySelector('[data-fmid="draft-stale-notice"]').innerText || '')
}

//點「儲存」後等被拒之訊息框（內含 expectText）出現, 回其面板 locator
async function waitRejectDialog(page, expectText) {
    await waitUntilExist(page, '存檔被拒訊息框出現', (t) => (document.body.innerText || '').includes(t), { timeout: 15000, arg: expectText })
    await page.waitForTimeout(400)
    return page.locator(SEL_DIALOG_PANEL).filter({ hasText: expectText }).last()
}

//=== E2E-016 / E2E-017（儲存格編輯器開啟中、已輸入未按 Enter 時收到他人推播: 輸入不丟、視同草稿）用之 helper ===

//Pattern B 的前半: 雙擊進入編輯器、清空、一次注入 value, 不按 Enter（輸入尚未提交進列資料）; 回前驗編輯器內容等於 value。
async function typeGridCellKeepEditing(page, rowIndex, colId, value) {
    let cell = page.locator(`.ag-center-cols-container .ag-row[row-index="${rowIndex}"] [col-id="${colId}"]`).first()
    await cell.scrollIntoViewIfNeeded()
    await cell.dblclick()
    await page.waitForTimeout(900) //editor mount settle
    let editor = page.locator('.ag-cell-inline-editing input:not(.ag-checkbox-input)').first()
    await editor.waitFor({ state: 'visible', timeout: 5000 })
    let cur = await editor.inputValue().catch(() => '')
    if (cur) { await page.keyboard.press('End'); for (let k = 0; k < cur.length + 2; k++) { await page.keyboard.press('Backspace') } }
    await page.keyboard.insertText(value)
    await page.waitForTimeout(200)
    let got = await editor.inputValue()
    if (got !== value) { throw new Error(`typeGridCellKeepEditing 編輯器內容應為「${value}」, 實得「${got}」`) }
}

//目前是否有儲存格編輯器開啟（使用者觀察: 格內有輸入框）及其內容。
async function gridEditorState(page) {
    return await page.evaluate(() => {
        let el = document.querySelector('.ag-cell-inline-editing input:not(.ag-checkbox-input)')
        return { open: !!el, value: el ? el.value : null }
    })
}

//case 定義：run(page,lang) 走流程並回傳截圖 buffer（或多階段 [{name,buf}]）；semantic(page,lang) 於產製端與比對端皆在寫檔／比對前執行（runCase）。
//stages＝該案產出之圖鍵（多數單張, 圖鍵＝案例鍵; E2E-002/004/005 兩階段; E2E-007 三階段）; 陣列順序＝mocha it 順序＝產製順序。
const CASES = [
    {
        //E2E-001：登入後預設停在頻道區, 階層頻道樹顯示專案 > 群組 > #頻道
        name: 'E2E-001-channels-tree',
        stages: ['E2E-001-channels-tree'],
        run: async (page) => {
            await waitTreeReady(page) //預設 section=channels, 等樹渲染到位
            return await captureStableWithBox(page, itemsUnionBox('.tnode, .chan', { within: SEL_TREE_LIST })) //結果: 頻道階層樹列出專案、群組與頻道(框住樹之各列)
        },
        semantic: async (page) => {
            let txt = await page.evaluate(() => document.body.innerText)
            //spec E2E-001：樹顯示階層（群組節點 + 頻道葉節點, 皆為資料中文）
            assert.ok(txt.includes(CH_DEMO_NAME), `頻道樹應含頻道「${CH_DEMO_NAME}」`)
            assert.ok(txt.includes('數據平台'), '頻道樹應含專案群組「數據平台」')
            assert.ok(txt.includes('電商平台改版'), '頻道樹應含專案群組「電商平台改版」')
            assert.ok(txt.includes('ETL 管線'), '頻道樹應含頻道「ETL 管線」')
        },
    },
    {
        //E2E-002：點頻道 → 右側聊天時間軸顯示四則種子訊息（text/text/task/taskReply）+ 任務 pills
        //每個操作兩張（技能 §7.1；E 第 1 期試點 2026-09-28）：點擊前框頻道列 → 點擊後框時間軸。
        //本案之「點頻道列」兩張兼作 E2E-003/006/007/008/011/012 首步之共用圖（技能 §7.8 型①，見 spec 各案驗證 bullet）
        name: 'E2E-002-chat-view',
        stages: ['E2E-002-1-click-channel', 'E2E-002-2-chat-view'],
        run: async (page) => {
            await waitTreeReady(page)
            let s1 = await captureStableWithBox(page, `[data-fmid="channel-item-${CH_DEMO_ID}"]`) //點擊前: 框住頻道樹「訂單服務」列整列
            await gotoChat(page)
            let s2 = await captureStableWithBox(page, itemsUnionBox('.day, .msg', { within: SEL_TIMELINE })) //結果: 時間軸顯示種子訊息(框住日期分隔與四則訊息)
            return [{ name: 'E2E-002-1-click-channel', buf: s1 }, { name: 'E2E-002-2-chat-view', buf: s2 }]
        },
        semantic: async (page) => {
            let txt = await page.evaluate(() => document.body.innerText)
            //spec E2E-002：時間軸含四則種子訊息
            assert.ok(txt.includes('Welcome to the demo channel.'), '時間軸應含人類歡迎語')
            assert.ok(txt.includes('Agent online and ready to take tasks.'), '時間軸應含 agent 上線語')
            assert.ok(txt.includes('Please summarize the quarterly report.'), '時間軸應含開任務訊息')
            assert.ok(txt.includes('Summary completed: revenue grew 12% QoQ.'), '時間軸應含任務回應訊息')
            //spec E2E-002：task / taskReply 另以類型徽章標示（kindTask / kindTaskReply 之 i18n 值）
            //徽章 kbadge 帶 CSS text-transform:uppercase（eng innerText 回 'TASK'）→ 以 CI 比對驗語意
            let kTask = await page.evaluate(() => window.$vo.$t('kindTask'))
            let kReply = await page.evaluate(() => window.$vo.$t('kindTaskReply'))
            assert.ok(incCI(txt, kTask), `時間軸應含任務徽章文字（${kTask}）`)
            assert.ok(incCI(txt, kReply), `時間軸應含任務回應徽章文字（${kReply}）`)
            //spec E2E-002：標題列任務 pills（statPending/statRunning/statDone 之 i18n 值）
            let pPending = await page.evaluate(() => window.$vo.$t('statPending'))
            let pDone = await page.evaluate(() => window.$vo.$t('statDone'))
            assert.ok(txt.includes(pPending), `標題列應含待處理 pill（${pPending}）`)
            assert.ok(txt.includes(pDone), `標題列應含已完成 pill（${pDone}）`)
        },
    },
    {
        //E2E-003：點頻道 → composer 真鍵盤輸入文字 → Enter 送出 → 新訊息出現於時間軸 + textarea 清空
        //視覺 baseline 對「composer 發訊區」於送出前（內容填妥）截圖, 避開新訊息之 live 時間戳區。
        name: 'E2E-003-chat-send',
        stages: ['E2E-003-chat-send'],
        run: async (page, lang) => {
            await gotoChat(page)
            let msg = `e2e post message ${lang}`
            await typeIntoTextarea(page, msg) //Pattern D 真實鍵盤輸入
            //視覺：composer 發訊區（內容填妥、送出前；避開 live 時間戳）
            let shot = await captureStableWithBox(page, SEL_COMPOSER)
            //act：真實鍵盤 Enter 送出（Composer @keydown Enter → doSend）
            await page.locator('[data-fmid="composer-textarea"]').first().click()
            await page.keyboard.press('Enter')
            //等新訊息渲染進時間軸（語意鏈終點）
            await waitUntilExist(page, '新訊息出現於時間軸', (m) => (document.body.innerText || '').includes(m), { timeout: 15000, arg: msg })
            return shot
        },
        semantic: async (page, lang) => {
            let msg = `e2e post message ${lang}`
            let txt = await page.evaluate(() => document.body.innerText)
            //spec E2E-003：送出後時間軸含剛輸入之訊息內容
            assert.ok(txt.includes(msg), `送出後時間軸應含剛輸入之訊息「${msg}」`)
            //spec E2E-003：送出後 textarea 清空
            let taVal = await page.locator('[data-fmid="composer-textarea"]').first().inputValue()
            assert.strictEqual(taVal, '', '送出後 composer textarea 應清空')
        },
    },
    {
        //E2E-004：切 Stats → 儀表板 OVERVIEW 顯示 CHANNELS/MESSAGES/TASKS 計數
        //每個操作兩張（E 第 1 期試點 2026-09-28）：點擊前框 rail「統計」項整顆 → 點擊後框 OVERVIEW 卡片區
        name: 'E2E-004-stats',
        stages: ['E2E-004-1-click-stats', 'E2E-004-2-stats'],
        run: async (page) => {
            await waitTreeReady(page) //進站落地（頻道區）就緒
            let s1 = await captureStableWithBox(page, await waitRail(page, 'stats')) //點擊前: 框住左1 rail 之「統計」項整顆（圖示與文字）
            await clickRail(page, 'stats') //真實點擊 rail 之 Stats nav
            await waitUntilExist(page, '統計 OVERVIEW 區就緒', () => {
                let e = document.querySelector('[data-fmid="stats-overview"]')
                if (!e) { return false }
                let r = e.getBoundingClientRect()
                return r.width > 0
            }, { timeout: 20000 })
            await page.waitForTimeout(500)
            let s2 = await captureStableWithBox(page, SEL_STATS_OVERVIEW) //結果: OVERVIEW 卡片區
            return [{ name: 'E2E-004-1-click-stats', buf: s1 }, { name: 'E2E-004-2-stats', buf: s2 }]
        },
        semantic: async (page) => {
            //scope 到 OVERVIEW 卡片區 innerText（避免 body 其他數字干擾計數斷言）
            let ov = await page.evaluate(() => {
                let e = document.querySelector('[data-fmid="stats-overview"]')
                return e ? (e.innerText || '') : ''
            })
            //spec E2E-004：OVERVIEW 三卡標題之 i18n 值（卡標題帶 CSS text-transform:uppercase, eng innerText 回 'CHANNELS' → 以 CI 比對驗語意）
            let lChannels = await page.evaluate(() => window.$vo.$t('statChannels'))
            let lMessages = await page.evaluate(() => window.$vo.$t('statMessages'))
            let lTasks = await page.evaluate(() => window.$vo.$t('statTasks'))
            assert.ok(incCI(ov, lChannels), `OVERVIEW 應含頻道數卡（${lChannels}）`)
            assert.ok(incCI(ov, lMessages), `OVERVIEW 應含訊息數卡（${lMessages}）`)
            assert.ok(incCI(ov, lTasks), `OVERVIEW 應含任務數卡（${lTasks}）`)
            //spec E2E-004：計數值（pristine 種子固定：頻道 4 / 訊息 4 / 任務 3）
            assert.ok(/\b4\b/.test(ov), 'OVERVIEW 應顯示頻道數 4（種子 4 頻道）')
            assert.ok(/\b3\b/.test(ov), 'OVERVIEW 應顯示任務數 3（種子 3 任務）')
        },
    },
    {
        //E2E-005：切 Admin → 預設 Channels 子頁 ag-grid 顯示 Levels 欄與頻道列
        //每個操作兩張（E 第 1 期試點 2026-09-28）：點擊前框 rail「後台」項整顆 → 點擊後框資料表。
        //本案之「點後台」點擊前圖兼作 E2E-009/010/013 首步之共用圖（技能 §7.8 型①）
        name: 'E2E-005-admin-channels',
        stages: ['E2E-005-1-click-admin', 'E2E-005-2-admin-channels'],
        run: async (page) => {
            await waitTreeReady(page) //進站落地（頻道區）就緒
            let s1 = await captureStableWithBox(page, await waitRail(page, 'admin')) //點擊前: 框住左1 rail 之「後台」項整顆（圖示與文字）
            await clickRail(page, 'admin') //真實點擊 rail 之 Admin nav
            //預設子頁為 Channels（AdminView subKey='mmChannels' → LayoutContentChannels）, 等 grid 列出現
            await waitUntilExist(page, '後台頻道 grid 列載入', () => document.querySelectorAll('.ag-row').length > 0, { timeout: 20000 })
            await page.waitForTimeout(500)
            let s2 = await captureStableWithBox(page, gridContentBox(SEL_GRID)) //結果: 後台頻道資料表(框住標頭與頻道列)
            return [{ name: 'E2E-005-1-click-admin', buf: s1 }, { name: 'E2E-005-2-admin-channels', buf: s2 }]
        },
        semantic: async (page) => {
            let txt = await page.evaluate(() => document.body.innerText)
            //spec E2E-005：grid 含 Levels 欄表頭（channelLevels 之 i18n 值）
            let lLevels = await page.evaluate(() => window.$vo.$t('channelLevels'))
            assert.ok(txt.includes(lLevels), `後台頻道 grid 應含階層欄表頭（${lLevels}）`)
            //spec E2E-005：grid 含頻道列（名稱 + levels 值）
            assert.ok(txt.includes(CH_DEMO_NAME), `後台頻道 grid 應含頻道「${CH_DEMO_NAME}」`)
            assert.ok(txt.includes('電商平台改版.後端組'), '後台頻道 grid 應含 levels 值「電商平台改版.後端組」')
        },
    },
    {
        //E2E-006：點頻道 → composer 經附圖鈕之隱藏 file input 上傳一張小圖 → 預覽縮圖出現 → 不打字直接送（純圖訊息修復）
        //→ 時間軸出現一則含附件 img（src 含 getFile）之新訊息; textarea 仍空。
        //視覺 baseline 對「composer 預覽縮圖區」於送出前截圖（避開時間軸之 live file id / 時間戳; 預覽縮圖渲染像素為固定來源圖 → 穩定）。
        name: 'E2E-006-chat-upload-image',
        stages: ['E2E-006-chat-upload-image'],
        run: async (page) => {
            await gotoChat(page)
            //act：點附圖鈕（使用者真實點擊, 真實情境會開檔案選取器）後, 以 setInputFiles 於隱藏 file input 選檔（檔案選取之 user-facing 路徑, 非 .fill/vm）
            await page.locator('[data-fmid="composer-attach"]').first().click()
            await page.locator('[data-fmid="composer"] input[type="file"]').first().setInputFiles(UPLOAD_PNG)
            //等上傳完成、預覽縮圖（已上傳完成者）出現於 composer 預覽列
            await waitUntilExist(page, 'composer 預覽縮圖出現', () => {
                let imgs = document.querySelectorAll('[data-fmid="composer"] .previews .thumb-img')
                return imgs.length > 0
            }, { timeout: 20000 })
            await page.waitForTimeout(500)
            //視覺：composer 預覽縮圖區（內容備妥、送出前；避開時間軸 live 值）
            let shot = await captureStableWithBox(page, SEL_COMPOSER)
            //act：不打字, 直接點「送出」按鈕（WButtonChip → div[role=button]）送出純圖訊息
            let sendLabel = await page.evaluate(() => window.$vo.$t('sendMessage'))
            await page.locator('[data-fmid="composer"] div[role="button"]', { hasText: sendLabel }).first().click()
            //等時間軸出現含附件 img（src 含 getFile）之新訊息（語意鏈終點）
            await waitUntilExist(page, '時間軸出現含附件 img 之新訊息', () => {
                let imgs = document.querySelectorAll('[data-fmid="chat-timeline"] img')
                return [...imgs].some((im) => (im.src || '').includes('getFile'))
            }, { timeout: 20000 })
            return shot
        },
        semantic: async (page) => {
            //spec E2E-006：送出後時間軸含一則附件 img（src 含 getFile）— 純圖訊息修復後可不打字直接送
            let hasGetFileImg = await page.evaluate(() => {
                let imgs = document.querySelectorAll('[data-fmid="chat-timeline"] img')
                return [...imgs].some((im) => (im.src || '').includes('getFile'))
            })
            assert.ok(hasGetFileImg, '送出後時間軸應含一則附件 img（src 含 getFile）')
            //spec E2E-006：純圖訊息送出後 textarea 仍空
            let taVal = await page.locator('[data-fmid="composer-textarea"]').first().inputValue()
            assert.strictEqual(taVal, '', '純圖訊息送出後 composer textarea 應為空')
        },
    },
    {
        //E2E-007：發送挾帶 HTML 之惡意訊息 → 時間軸渲染前經消毒 → onerror 不執行 / DOM 無 onerror 屬性 / 純文字保留。
        //安全回歸守衛（審計確認之儲存型 XSS 修復）：content 經 showdown→v-html 渲染, 若無 DOMPurify 消毒, <img onerror> 會於檢視者瀏覽器執行 JS。
        //安全性由語意斷言判定（「已消毒」與「未消毒」之像素無從區辨）; 三張圖為操作手冊之用（2026-09-29 業主裁示補圖, 原為語意-only）:
        //輸入一個欄位（輸入前、輸入後）＋按 Enter 鍵送出（輸入後之圖兼作送出前, 同一發訊區相鄰兼任）; 首步「點頻道列」共用 E2E-002 兩張。
        //送出後之新訊息帶時間戳 → 送出前開啟假時鐘（setFakeNow: 後端寫入之 timeCreate 固定為執行期錨點）, 送出後即關閉。
        //eng/cht 皆跑（消毒與語系無關, 兩語系下皆須成立）。
        name: 'E2E-007-xss-sanitized',
        stages: ['E2E-007-1-type-payload', 'E2E-007-2-payload-typed', 'E2E-007-3-sanitized'],
        run: async (page) => {
            await gotoChat(page)
            await page.evaluate(() => { window.__xss7 = undefined }) //清旗標, 供「onerror 是否執行」判定
            let ta = page.locator('[data-fmid="composer-textarea"]').first()
            let s1 = await captureStableWithBox(page, ta) //輸入前: 框住發訊區輸入框整顆
            //惡意 payload：onerror 於 <img src=x> 載入失敗時觸發 → 未消毒則 window.__xss7=1; 'hello-xss-text' 為內容保留之探針
            let payload = '<img src=x onerror="window.__xss7=1">hello-xss-text'
            await typeIntoTextarea(page, payload) //Pattern D 真實鍵盤輸入（含角括號之原始 HTML）
            let s2 = await captureStableWithBox(page, SEL_COMPOSER) //結果: 輸入框內為剛輸入之內容（框住發訊區: 輸入框＋工具列＋送出鈕; 兼作按 Enter 鍵之前圖）
            let s3
            setFakeNow(FAKE_NOW_RUNTIME) //新訊息之 timeCreate 固定, 使送出後之圖確定
            try {
                await ta.click()
                await page.keyboard.press('Enter') //真實 Enter 送出
                await waitUntilExist(page, '惡意訊息之文字探針渲染進時間軸', () => (document.body.innerText || '').includes('hello-xss-text'), { timeout: 15000 })
                await waitUntilExist(page, '新訊息之時間戳為假時鐘錨點', (t) => (document.body.innerText || '').includes(t), { timeout: 15000, arg: FAKE_NOW_RUNTIME })
                await page.waitForTimeout(600) //予 img 載入失敗 + (若未消毒) onerror 觸發之時間窗, 確保負向斷言有效
                //結果: 時間軸最下方出現該則訊息, 文字照常顯示、圖片標籤顯示為無法載入之圖片（框住該則訊息）
                s3 = await captureStableWithBox(page, itemsUnionBox(page.locator(`${SEL_TIMELINE} .msg`).last(), { fit: true }))
            }
            finally {
                clearFakeNow()
            }
            return [
                { name: 'E2E-007-1-type-payload', buf: s1 },
                { name: 'E2E-007-2-payload-typed', buf: s2 },
                { name: 'E2E-007-3-sanitized', buf: s3 },
            ]
        },
        semantic: async (page) => {
            //spec E2E-007（1）：onerror 未執行（DOMPurify 已剝離 inline event handler）
            let fired = await page.evaluate(() => window.__xss7)
            assert.ok(!fired, 'onerror 不應執行（DOMPurify 應已剝離 onerror handler）— 若為 1 表 XSS 復活')
            //spec E2E-007（2）：時間軸渲染後 DOM 不含 onerror 屬性
            let html = await page.evaluate(() => {
                let el = document.querySelector('[data-fmid="chat-timeline"]')
                return el ? el.innerHTML : ''
            })
            assert.ok(!/onerror/i.test(html), '時間軸渲染 HTML 不應含 onerror 屬性')
            //spec E2E-007（3）：消毒非清空 — 純文字內容仍保留
            let txt = await page.evaluate(() => document.body.innerText)
            assert.ok(txt.includes('hello-xss-text'), '消毒後純文字內容仍應保留（消毒只剝危險屬性, 不刪文字）')
        },
    },
    {
        //E2E-008：於頻道聊天頁標題列點「成員」→ 開啟本頻道成員管理 dialog（#6 入口），走完整成員 CRUD。
        //承接式 journey（單一 case 多階段, 狀態逐步推進, 無法乾淨 seed 中間點）:
        //  讀取(R) → 新增(C: 點新增+儲存) → 更新(U: 編輯 role cell+儲存) → 刪除(D: 勾選+刪除+確認)。
        //全程真實 UI: rail/頻道列點擊、編輯開關、ag-grid role cell 雙擊編輯(Pattern B)、選取 checkbox、WConfirm modal 按鈕點擊。
        //斷言: 每階段以後端 getChannelMembers 觀察真實副作用（成員增/改/刪）+ dialog UI 語意（在地化類型/選擇器隱藏）。
        //baseline 對「成員 dialog」於 view 模式（僅 agent-demo 一列, 種子時間戳固定 → 穩定）截圖; CRUD 階段帶動態 id 不另存視覺。
        //清理: 本案例最終刪除自身新增之成員, DB 回歸 pristine（agent-demo 一列）; per-case reseed 亦保底。
        name: 'E2E-008-channel-members-crud',
        stages: ['E2E-008-channel-members-crud'],
        run: async (page, lang) => {
            await gotoChat(page)
            //act(R)：真實點擊標題列「成員」入口 → 開本頻道成員管理 dialog
            await page.locator('[data-fmid="chat-head-members-btn"]').first().click()
            await waitUntilExist(page, '成員 dialog + agent-demo 列載入', () => {
                let el = document.querySelector('[data-fmid="channel-members-dialog"]')
                return !!el && (el.innerText || '').includes('agent-demo')
            }, { timeout: 20000 })
            await page.waitForTimeout(400)
            //視覺 baseline：view 模式之成員 dialog（agent-demo 一列）；結果: 成員視窗開啟(框住整個視窗含標題列; 2026-09-28 改: 原只框內容區, 漏標題列)
            let shot = await captureStableWithBox(page, page.locator(SEL_DIALOG_PANEL).filter({ has: page.locator(SEL_MEMBERS_DIALOG) }))

            let ok = await page.evaluate(() => window.$vo.$t('ok'))
            let yes = await page.evaluate(() => window.$vo.$t('yes'))
            let roleVal = `e2e-role-${lang}`

            //act(C 新增)：切編輯模式 → 點新增（出現一列 funNew 預設 memberType='human'）→ 點儲存 → 關成功 modal
            await page.locator('[data-fmid="members-edit-switch"]').first().click()
            await waitUntilExist(page, '編輯模式新增鈕就緒', () => !!document.querySelector('[data-fmid="members-add-btn"]'), { timeout: 8000 })
            await page.locator('[data-fmid="members-add-btn"]').first().click()
            await waitUntilExist(page, '新增後出現非 agent-demo 之新列', async () => {
                let cells = [...document.querySelectorAll('[data-fmid="channel-members-dialog"] [col-id="memberId"]')]
                return cells.some((c) => { let t = (c.innerText || '').trim(); return t && t !== 'agent-demo' && !/member id/i.test(t) })
            }, { timeout: 8000 })
            await page.waitForTimeout(300)
            await page.locator('[data-fmid="members-save-btn"]').first().click()
            await clickConfirmBtn(page, ok) //儲存成功 modal → 確定
            await waitUntilExist(page, '新增成員已寫入後端（成員數=2）', async () => {
                let r = await window.$vo.$fapi.getChannelMembers('id-for-channel-demo')
                return (r || []).length === 2
            }, { timeout: 10000 })
            //UI 斷言(Create)：grid 內出現非 agent-demo 之新列（使用者觀察; 後端數=2 為補強）。
            //以 closest('.ag-row') 過濾掉表頭 cell（跨語系安全, 表頭不在 .ag-row 內）。
            let hasNewRowUI = await page.evaluate((d) => {
                let cells = [...document.querySelectorAll(`${d} [col-id="memberId"]`)].filter((c) => c.closest('.ag-row'))
                return cells.some((c) => { let t = (c.innerText || '').trim(); return t && t !== 'agent-demo' })
            }, SEL_MEMBERS_DLG)
            assert.ok(hasNewRowUI, 'Create: 成員 grid 應出現非 agent-demo 之新列（UI 觀察）')

            //act(U 更新)：編輯新列 role cell → 儲存 → 關成功 modal（驗後端 role 已改）
            let ridU = await waitNewMemberRowIndex(page)
            await editRoleCell(page, ridU, roleVal)
            await page.locator('[data-fmid="members-save-btn"]').first().click()
            await clickConfirmBtn(page, ok)
            await waitUntilExist(page, '更新後端 role 生效', async (rv) => {
                let r = await window.$vo.$fapi.getChannelMembers('id-for-channel-demo')
                return (r || []).some((m) => m.role === rv)
            }, { timeout: 10000, arg: roleVal })
            //UI 斷言(Update)：新列 role 欄之 rendered innerText 等於輸入之新值（使用者觀察; 後端 role 為補強）。
            let roleCellUI = await page.evaluate((d) => {
                let cells = [...document.querySelectorAll(`${d} [col-id="memberId"]`)].filter((c) => c.closest('.ag-row'))
                let hit = cells.find((c) => { let t = (c.innerText || '').trim(); return t && t !== 'agent-demo' })
                if (!hit) { return null }
                let ri = hit.closest('.ag-row').getAttribute('row-index')
                if (ri === null) { return null }
                let rc = document.querySelector(`${d} .ag-row[row-index="${ri}"] [col-id="role"]`)
                return rc ? (rc.innerText || '').trim() : null
            }, SEL_MEMBERS_DLG)
            assert.strictEqual(roleCellUI, roleVal, 'Update: 新列 role 欄 innerText 應等於輸入之新值（UI 觀察）')

            //act(D 刪除)：勾選新列 checkbox → 刪除 → 確認 Yes → 關成功 modal（驗後端回 1 列）
            let ridD = await waitNewMemberRowIndex(page)
            await page.locator(`${SEL_MEMBERS_DLG} .ag-row[row-index="${ridD}"] .ag-selection-checkbox`).first().click()
            await waitUntilExist(page, '勾選後刪除鈕出現', () => !!document.querySelector('[data-fmid="members-delete-btn"]'), { timeout: 8000 })
            await page.locator('[data-fmid="members-delete-btn"]').first().click()
            await clickConfirmBtn(page, yes) //刪除確認 modal → 是
            await clickConfirmBtn(page, ok)  //刪除成功 modal → 確定
            await waitUntilExist(page, '刪除後端生效（成員數回 1）', async () => {
                let r = await window.$vo.$fapi.getChannelMembers('id-for-channel-demo')
                return (r || []).length === 1
            }, { timeout: 10000 })
            //UI 斷言(Delete)：grid 內僅剩 agent-demo 一列（使用者觀察; 後端數=1 為補強）。
            let onlyDemoUI = await page.evaluate((d) => {
                let cells = [...document.querySelectorAll(`${d} [col-id="memberId"]`)].filter((c) => c.closest('.ag-row'))
                let vals = cells.map((c) => (c.innerText || '').trim()).filter(Boolean)
                return vals.length === 1 && vals[0] === 'agent-demo'
            }, SEL_MEMBERS_DLG)
            assert.ok(onlyDemoUI, 'Delete: 成員 grid 應僅剩 agent-demo 一列（UI 觀察）')

            return shot
        },
        semantic: async (page, lang) => {
            //spec E2E-008（R）：dialog 綁定當前頻道 → 載入本頻道成員 agent-demo（開啟階段觀察, 見 run baseline）
            //spec E2E-008（item 1 在地化）：run 之新增列為 human, 其類型欄應曾顯示 memberHuman；agent-demo 顯示 memberAgent。
            //  （run 已於各階段以後端狀態斷言 C/U/D; 此處補「最終 DB 回 pristine」與「UI 在地化 + 選擇器隱藏」語意）
            let backend = await membersOf(page, 'id-for-channel-demo')
            //spec E2E-008（D 清理）：CRUD 後 DB 僅剩 agent-demo（新增之成員已被刪除, roundtrip 乾淨）
            assert.strictEqual(backend.length, 1, 'CRUD 完成後後端應僅剩 1 位成員（新增者已刪除）')
            assert.strictEqual(backend[0].memberId, 'agent-demo', '殘留成員應為原主責 agent-demo')
            //spec E2E-008（UI 在地化 + 綁定）：dialog 目前顯示 agent 之在地化類型, 且不顯示頻道選擇器
            let dlgText = await page.evaluate(() => {
                let el = document.querySelector('[data-fmid="channel-members-dialog"]')
                return el ? (el.innerText || '') : ''
            })
            let tAgent = await page.evaluate(() => window.$vo.$t('memberAgent'))
            assert.ok(dlgText.includes(tAgent), `agent 成員類型應在地化顯示（${tAgent}）`)
            let hasSelector = await page.evaluate(() => !!document.querySelector('[data-fmid="channel-members-dialog"] [data-fmid="members-channel-selector"]'))
            assert.ok(!hasSelector, '綁定當前頻道時不應顯示頻道選擇器（fixedChannelId → v-if 隱藏）')
        },
    },
    {
        //E2E-009：後台管理 → 任務子頁, 資料表顯示頻道任務清單（標題 / 狀態 / 認領者 / 時間）。
        //切後台後預設頻道子頁, 點「任務」子頁 → LayoutContentTasks 以頻道選擇器預設頻道（demo）載入其 3 筆種子任務。
        name: 'E2E-009-admin-tasks',
        stages: ['E2E-009-admin-tasks'],
        run: async (page) => {
            await clickRail(page, 'admin') //真實點擊 rail 之 Admin nav
            await waitUntilExist(page, '後台任務子頁鈕就緒', () => !!document.querySelector('[data-fmid="admin-sub-mmTasks"]'), { timeout: 20000 })
            await page.locator('[data-fmid="admin-sub-mmTasks"]').first().click() //真實點擊「任務」子頁
            await waitUntilExist(page, '後台任務 grid 種子任務載入', () => (document.body.innerText || '').includes('Summarize quarterly report'), { timeout: 20000 })
            await page.waitForTimeout(500)
            return await captureStableWithBox(page, gridContentBox(SEL_GRID)) //結果: 後台任務資料表(框住標頭與三筆任務列)
        },
        semantic: async (page) => {
            let gridTxt = await page.evaluate(() => {
                let e = document.querySelector('.ag-root-wrapper')
                return e ? (e.innerText || '') : ''
            })
            //spec E2E-009：任務 grid 含三筆種子任務標題
            assert.ok(gridTxt.includes('Summarize quarterly report'), '任務 grid 應含任務「Summarize quarterly report」')
            assert.ok(gridTxt.includes('Draft the release notes'), '任務 grid 應含任務「Draft the release notes」')
            assert.ok(gridTxt.includes('Fetch external metrics'), '任務 grid 應含任務「Fetch external metrics」')
            //spec E2E-009：狀態欄以 cell-render 在地化 + 上色顯示三態（種子含 done/pending/error 各一）
            let sDone = await page.evaluate(() => window.$vo.$t('taskStateDone'))
            let sPending = await page.evaluate(() => window.$vo.$t('taskStatePending'))
            let sError = await page.evaluate(() => window.$vo.$t('taskStateError'))
            assert.ok(gridTxt.includes(sDone), `狀態欄應含已完成之在地化值（${sDone}）`)
            assert.ok(gridTxt.includes(sPending), `狀態欄應含待認領之在地化值（${sPending}）`)
            assert.ok(gridTxt.includes(sError), `狀態欄應含失敗之在地化值（${sError}）`)
        },
    },
    {
        //E2E-010：後台管理 → 成員子頁, 資料表顯示頻道成員（含在地化類型）+ 頻道選擇器。
        //後台成員子頁之 LayoutContentMembers 無 fixedChannelId → 顯示頻道選擇器, 預設頻道（demo）載入其成員 agent-demo。
        //與 E2E-008（聊天頁入口, 綁定頻道 → 隱藏選擇器）互補: 同一元件於後台入口顯示選擇器、於頻道入口隱藏。
        name: 'E2E-010-admin-members',
        stages: ['E2E-010-admin-members'],
        run: async (page) => {
            await clickRail(page, 'admin') //真實點擊 rail 之 Admin nav
            await waitUntilExist(page, '後台成員子頁鈕就緒', () => !!document.querySelector('[data-fmid="admin-sub-mmMembers"]'), { timeout: 20000 })
            await page.locator('[data-fmid="admin-sub-mmMembers"]').first().click() //真實點擊「成員」子頁
            await waitUntilExist(page, '後台成員 grid 載入 agent-demo', () => (document.body.innerText || '').includes('agent-demo'), { timeout: 20000 })
            await page.waitForTimeout(500)
            return await captureStableWithBox(page, gridContentBox(SEL_GRID)) //結果: 後台成員資料表(框住標頭與成員列)
        },
        semantic: async (page) => {
            let gridTxt = await page.evaluate(() => {
                let e = document.querySelector('.ag-root-wrapper')
                return e ? (e.innerText || '') : ''
            })
            //spec E2E-010：成員 grid 含 agent-demo
            assert.ok(gridTxt.includes('agent-demo'), '成員 grid 應含成員 agent-demo')
            //spec E2E-010（item 1）：成員類型欄在地化顯示（agent → memberAgent）
            let tAgent = await page.evaluate(() => window.$vo.$t('memberAgent'))
            assert.ok(gridTxt.includes(tAgent), `成員類型應在地化顯示（${tAgent}）`)
            //spec E2E-010：後台成員子頁（無 fixedChannelId）→ 顯示頻道選擇器（與 E2E-008 綁定隱藏互補）
            let hasSelector = await page.evaluate(() => !!document.querySelector('[data-fmid="members-channel-selector"]'))
            assert.ok(hasSelector, '後台成員子頁應顯示頻道選擇器（無 fixedChannelId）')
        },
    },
    {
        //E2E-011：發訊區啟用「開成任務」→ 填任務標題 + 內容 → 送出 → 對話時間軸出現任務型訊息(kind=task, 帶任務徽章),
        //且後台任務子頁該頻道清單新增一筆待認領(pending)任務; 送出後 composer 內容/標題列清空、開成任務切回關閉態。
        //視覺 baseline 對「composer（開成任務 + 標題內容填妥）送出前」截圖, 避開新訊息之 live 時間戳區。
        //全程真實 UI: 頻道列點擊、toggle 點擊、Pattern D 鍵盤輸入(標題+內容)、送出鈕點擊、rail/子頁點擊。
        //清理: 新增之任務型訊息與 pending 任務由 per-case reseed（rm ./db 重建 pristine）還原（同 E2E-003 副作用機制）。
        name: 'E2E-011-compose-as-task',
        stages: ['E2E-011-compose-as-task'],
        run: async (page, lang) => {
            await gotoChat(page)
            let title = `e2e task title ${lang}`
            let body = `e2e task body ${lang}`
            //act：點「開成任務」toggle 啟用 → 上方出現任務標題輸入列
            await page.locator('[data-fmid="composer-astask"]').first().click()
            await waitUntilExist(page, '開成任務標題輸入列出現', () => !!document.querySelector('[data-fmid="composer-task-title"]'), { timeout: 8000 })
            //act：輸入任務標題（Pattern D, composer-task-title 為 Vue controlled input）
            await typeIntoLocator(page, page.locator('[data-fmid="composer-task-title"]').first(), title)
            //act：輸入訊息內容（Pattern D, composer-textarea）
            await typeIntoTextarea(page, body)
            //視覺：composer（開成任務 + 標題內容填妥, 送出前; 避開 live 時間戳）
            let shot = await captureStableWithBox(page, SEL_COMPOSER)
            //act：點「送出」按鈕（WButtonChip → div[role=button]）
            let sendLabel = await page.evaluate(() => window.$vo.$t('sendMessage'))
            await page.locator('[data-fmid="composer"] div[role="button"]', { hasText: sendLabel }).first().click()
            //等對話時間軸出現剛輸入之任務內容（語意鏈終點）
            await waitUntilExist(page, '任務型訊息出現於時間軸', (m) => (document.body.innerText || '').includes(m), { timeout: 15000, arg: body })
            return shot
        },
        semantic: async (page, lang) => {
            let title = `e2e task title ${lang}`
            let body = `e2e task body ${lang}`
            let txt = await page.evaluate(() => document.body.innerText)
            //spec E2E-011 驗證第1點：送出後對話時間軸含剛輸入之任務內容
            assert.ok(txt.includes(body), `時間軸應含任務內容「${body}」`)
            //spec E2E-011 驗證第1點：該訊息帶任務類型徽章（kindTask, uppercase 顯示 → CI 比對）
            let kTask = await page.evaluate(() => window.$vo.$t('kindTask'))
            assert.ok(incCI(txt, kTask), `時間軸應含任務徽章文字（${kTask}）`)
            //spec E2E-011 驗證第3點：送出後 composer 內容輸入框清空、任務標題列消失（開成任務切回關閉態）
            let taVal = await page.locator('[data-fmid="composer-textarea"]').first().inputValue()
            assert.strictEqual(taVal, '', '送出後 composer textarea 應清空')
            let hasTitleInput = await page.evaluate(() => !!document.querySelector('[data-fmid="composer-task-title"]'))
            assert.ok(!hasTitleInput, '送出後開成任務應切回關閉態（任務標題列消失）')
            //spec E2E-011 驗證第2點：切後台任務子頁, 該頻道任務清單新增一筆該標題之待認領任務（走 UI 導覽 + grid 觀察）
            await gotoAdminTasks(page)
            await waitUntilExist(page, '後台任務 grid 出現新任務標題', (t) => {
                let e = document.querySelector('.ag-root-wrapper')
                return !!e && (e.innerText || '').includes(t)
            }, { timeout: 20000, arg: title })
            let sPending = await page.evaluate(() => window.$vo.$t('taskStatePending'))
            let rowState = await taskRowStateText(page, title)
            assert.strictEqual(rowState, sPending, `新任務狀態欄應為待認領（${sPending}）`)
        },
    },
    {
        //E2E-012：後台任務詳情, 對執行中(running)任務人工代回(→done)、對失敗(error)任務重試(→pending), 狀態轉換並鏡射回應訊息。
        //承接式 journey（單一 case 多階段）: base seed 無 running 態, 前置以 app RPC 認領 pending 種子任務推進為 running 後承接。
        //  · arrange(前置, 非 act): $fapi.claimTask 將 'id-for-task-demo-pending' 推進 running。
        //    claimTask 為 agent 之 HTTP 行為, 無人工 UI 入口（人類不認領）→ 屬合法之測試資料前置(setup helper), 無對應 UI e2e。
        //  · act(代回): 點 running 任務標題 → 點「回應任務」→ Pattern D 輸入回應 → 點「送出回應」→ 成功 modal 確認。
        //  · act(重試): 點失敗任務標題 → 點「重試任務」→ 確認 modal 按確定 → 成功 modal 確認。
        //視覺 baseline 對「失敗任務詳情面板（顯示重試入口, 種子時間戳固定）」截圖。
        //  ★截圖時點：於認領後、代回前擷取——此時 grid 僅含固定種子時間戳; 代回會令原 pending 任務 timeDone 變 live
        //   → 破壞 grid 區之 pixel 穩定, 故提前至代回前擷取, 以符合 spec「種子時間戳固定 → 穩定」之前提（非改 spec, 為忠實其穩定性意圖）。
        //清理: 改動之任務狀態與新增之 taskReply 訊息由 per-case reseed 還原。
        name: 'E2E-012-task-detail',
        stages: ['E2E-012-task-detail'],
        run: async (page, lang) => {
            let RUNNING_TASK = 'id-for-task-demo-pending' //base seed pending, 前置認領推進為 running 供代回
            let ERROR_TASK = 'id-for-task-demo-error'      //base seed error, 供重試
            let respMsg = `e2e respond ${lang}`
            //arrange（前置, 非 act）：以 app RPC 認領 pending 種子任務推進為 running（見上方註解）
            await page.evaluate(async (tid) => { await window.$vo.$fapi.claimTask(tid) }, RUNNING_TASK)
            //進後台任務子頁（頻道選擇器預設「訂單服務」）
            await gotoAdminTasks(page)

            //視覺 baseline：先開「失敗任務」詳情面板（顯示重試入口）, 於代回前擷取（grid 僅含固定種子時間戳 → 穩定）
            await clickTaskTitle(page, 'Fetch external metrics')
            let shot = await captureStableWithBox(page, SEL_TASK_DETAIL)

            //act(代回)：開 running 任務詳情 → 點「回應任務」展開代回輸入區
            await clickTaskTitle(page, 'Draft the release notes')
            let respLabel = await page.evaluate(() => window.$vo.$t('respondTask'))
            await page.locator(`${SEL_TASK_DETAIL} div[role="button"]`, { hasText: respLabel }).first().click()
            await waitUntilExist(page, '代回輸入區出現', () => !!document.querySelector('[data-fmid="task-detail"] textarea'), { timeout: 8000 })
            //act：輸入回應內容（Pattern D, WTextarea 內 <textarea>）
            await typeIntoLocator(page, page.locator(`${SEL_TASK_DETAIL} textarea`).first(), respMsg)
            //act：點「送出回應」→ 成功 modal 確認
            let submitLabel = await page.evaluate(() => window.$vo.$t('respondTaskSubmit'))
            await page.locator(`${SEL_TASK_DETAIL} div[role="button"]`, { hasText: submitLabel }).first().click()
            let ok = await page.evaluate(() => window.$vo.$t('ok'))
            await clickConfirmBtn(page, ok) //代回成功 modal → 確認
            //progression gate：等 running 任務轉 done（後端）
            await waitUntilExist(page, '代回後任務轉 done（後端）', async (tid) => {
                let t = await window.$vo.$fapi.getTask(tid)
                return !!t && t.state === 'done'
            }, { timeout: 10000, arg: RUNNING_TASK })

            //act(重試)：開失敗任務詳情 → 點「重試任務」→ 確認 modal 按確定 → 成功 modal 確認
            await clickTaskTitle(page, 'Fetch external metrics')
            let retryLabel = await page.evaluate(() => window.$vo.$t('resetTask'))
            await page.locator(`${SEL_TASK_DETAIL} div[role="button"]`, { hasText: retryLabel }).first().click()
            let yes = await page.evaluate(() => window.$vo.$t('yes'))
            await clickConfirmBtn(page, yes) //重試確認 modal → 是
            await clickConfirmBtn(page, ok)  //重試成功 modal → 確認
            //progression gate：等失敗任務轉 pending（後端）
            await waitUntilExist(page, '重試後任務轉 pending（後端）', async (tid) => {
                let t = await window.$vo.$fapi.getTask(tid)
                return !!t && t.state === 'pending'
            }, { timeout: 10000, arg: ERROR_TASK })
            return shot
        },
        semantic: async (page, lang) => {
            let respMsg = `e2e respond ${lang}`
            //spec E2E-012 驗證第1點：人工代回後該任務狀態欄轉為已完成（grid UI 觀察; 後端為補強）
            let sDone = await page.evaluate(() => window.$vo.$t('taskStateDone'))
            let st1 = await taskRowStateText(page, 'Draft the release notes')
            assert.strictEqual(st1, sDone, `代回後任務狀態欄應顯示已完成（${sDone}）`)
            let beDone = await page.evaluate(async () => { let t = await window.$vo.$fapi.getTask('id-for-task-demo-pending'); return t ? t.state : '' })
            assert.strictEqual(beDone, 'done', '代回後端狀態應為 done（補強）')
            //spec E2E-012 驗證第3點：重試後失敗任務狀態欄轉為待認領（grid UI 觀察; 後端為補強）
            let sPending = await page.evaluate(() => window.$vo.$t('taskStatePending'))
            let st3 = await taskRowStateText(page, 'Fetch external metrics')
            assert.strictEqual(st3, sPending, `重試後任務狀態欄應顯示待認領（${sPending}）`)
            let bePending = await page.evaluate(async () => { let t = await window.$vo.$fapi.getTask('id-for-task-demo-error'); return t ? t.state : '' })
            assert.strictEqual(bePending, 'pending', '重試後端狀態應為 pending（補強）')
            //spec E2E-012 驗證第2點：該頻道對話時間軸新增一則任務回應鏡射訊息, 帶任務回應徽章（走 UI 導覽至頻道檢視時間軸）
            await clickRail(page, 'channels')
            await gotoChat(page)
            let txt = await page.evaluate(() => document.body.innerText)
            assert.ok(txt.includes(respMsg), `時間軸應含代回鏡射訊息內容「${respMsg}」`)
            let kReply = await page.evaluate(() => window.$vo.$t('kindTaskReply'))
            assert.ok(incCI(txt, kReply), `時間軸應含任務回應徽章文字（${kReply}）`)
        },
    },
    {
        //E2E-013：後台任務子頁切「顯示封存」→ 清單改列封存冷表(tasksArchive)且唯讀; 切回關閉恢復熱表活躍任務。
        //arrange：封存冷表無 base seed 種子, 由 reseedBackend({ withArchivedTask:true }) 於 backend 未持有 lmdb 之視窗
        //  直寫一筆固定種子封存任務（'Archived quarterly summary', 見 test/tools/seed-archived-task.mjs）。此前置在 openApp 前執行,
        //  故 arrange 由 runCase 之 prepare 於 reseedBackend() 之後、launch／openApp 之前呼叫（產製端與比對端同）; 封存種子於下一 case reseed(rm ./db) 自動清除。
        //視覺 baseline 對「後台任務 grid（顯示封存啟用態, 列封存任務）」截圖（種子時間戳固定 → 穩定）。
        //清理：唯讀切換無資料副作用; arrange 寫入之封存種子由 per-case reseed 還原。
        name: 'E2E-013-tasks-archived',
        stages: ['E2E-013-tasks-archived'],
        arrange: async () => { await reseedBackend({ withArchivedTask: true }) }, //封存種子前置（backend 未持有 lmdb 時直寫冷表）
        run: async (page) => {
            await gotoAdminTasks(page)
            //act：點「顯示封存」切換啟用 → 資料來源切為冷表
            await page.locator('[data-fmid="tasks-show-archived"]').first().click()
            //等封存冷表種子任務列出現
            await waitUntilExist(page, '封存任務載入', () => {
                let e = document.querySelector('.ag-root-wrapper')
                return !!e && (e.innerText || '').includes('Archived quarterly summary')
            }, { timeout: 20000 })
            await page.waitForTimeout(500)
            //視覺：後台任務 grid（顯示封存啟用態, 列封存任務）；結果: 清單改列封存任務(框住標頭與封存任務列)
            return await captureStableWithBox(page, gridContentBox(SEL_GRID))
        },
        semantic: async (page) => {
            //spec E2E-013 驗證第1點：切換啟用後清單列出封存冷表之已封存任務
            let gridTxt = await page.evaluate(() => { let e = document.querySelector('.ag-root-wrapper'); return e ? (e.innerText || '') : '' })
            assert.ok(gridTxt.includes('Archived quarterly summary'), '顯示封存後 grid 應含封存任務「Archived quarterly summary」')
            //spec E2E-013 驗證第1點（互補）：資料源已切冷表 → 熱表活躍任務不在清單
            assert.ok(!gridTxt.includes('Draft the release notes'), '封存檢視下不應含熱表活躍任務')
            //spec E2E-013 驗證第2點：點封存任務標題開詳情, 不顯示「回應任務」與「重試任務」入口（唯讀）
            await clickTaskTitle(page, 'Archived quarterly summary')
            let detailTxt = await page.evaluate(() => { let e = document.querySelector('[data-fmid="task-detail"]'); return e ? (e.innerText || '') : '' })
            let respLabel = await page.evaluate(() => window.$vo.$t('respondTask'))
            let retryLabel = await page.evaluate(() => window.$vo.$t('resetTask'))
            assert.ok(!detailTxt.includes(respLabel), '封存唯讀檢視詳情不應顯示「回應任務」入口')
            assert.ok(!detailTxt.includes(retryLabel), '封存唯讀檢視詳情不應顯示「重試任務」入口')
            //spec E2E-013 驗證第3點：切換關閉後清單恢復熱表三筆種子任務
            await page.locator('[data-fmid="tasks-show-archived"]').first().click()
            await waitUntilExist(page, '切回熱表', () => {
                let e = document.querySelector('.ag-root-wrapper')
                return !!e && (e.innerText || '').includes('Summarize quarterly report')
            }, { timeout: 20000 })
            let hotTxt = await page.evaluate(() => { let e = document.querySelector('.ag-root-wrapper'); return e ? (e.innerText || '') : '' })
            assert.ok(hotTxt.includes('Summarize quarterly report') && hotTxt.includes('Draft the release notes') && hotTxt.includes('Fetch external metrics'), '切回熱表應恢復三筆種子任務標題')
            assert.ok(!hotTxt.includes('Archived quarterly summary'), '切回熱表不應含封存任務')
        },
    },
    {
        //E2E-014：後台頻道頁切編輯模式並就地改了「訂單服務」描述（尚未儲存）, 此時另一位管理員改了別的頻道 → 畫面不丟草稿並出現「資料已被他人更新」提示;
        //按儲存被整次拒收（本次未儲存任何變更）, 草稿仍保留; 按提示條「重新載入」並確認後換成最新資料、草稿捨棄。
        //6 步真實 user path：①rail 點 Admin（預設頻道子頁）②點編輯模式開關 ③就地編輯「訂單服務」描述欄（Pattern B, 產生草稿）
        //  ④另一位管理員改「報表產製」描述（arrange, 未走 UI: 頁面既有連線呼叫 saveChannels, 不帶基準之外部呼叫）⑤見提示條 ⑥點儲存→被拒訊息框→確定 ⑦點重新載入→確認→最新資料。
        //修前（E7）: 步驟④推播即把整張表重建, 草稿靜默消失而儲存鈕仍亮; 本案例於步驟⑤驗草稿仍在。
        //清理：寫入皆在測試實例資料庫, 由 per-case reseed 還原; 固定時鐘於 arrange 後立即關閉。
        name: 'E2E-014-channels-draft-stale',
        stages: ['E2E-014-1-draft-stale', 'E2E-014-2-click-save', 'E2E-014-3-save-rejected', 'E2E-014-4-reloaded'],
        run: async (page, lang) => {
            let ok = await page.evaluate(() => window.$vo.$t('ok'))
            let yes = await page.evaluate(() => window.$vo.$t('yes'))
            let tStaleNotice = await page.evaluate(() => window.$vo.$t('draftStaleNotice'))
            let tSaveStale = await page.evaluate(() => window.$vo.$t('saveStale'))
            let draft = `draft-desc-${lang}`
            let otherDesc = `edited-by-other-admin-${lang}`

            //進後台頻道子頁（rail 點 Admin; 首步「點後台」共用 E2E-005-1-click-admin）→ 等頻道 grid 載入
            await clickRail(page, 'admin')
            await waitUntilExist(page, '後台頻道 grid 載入', () => (((document.querySelector('.ag-root-wrapper') || {}).innerText) || '').includes('訂單服務'), { timeout: 20000 })
            await page.waitForTimeout(500)
            let before = await page.evaluate(async () => { let r = await window.$vo.$fapi.getChannelsList(); return r.map((c) => ({ id: c.id, description: c.description })) })

            //act：切編輯模式 → 就地編輯「訂單服務」描述欄（草稿）
            await page.locator('[data-fmid="channels-edit-switch"]').first().click()
            await page.waitForTimeout(700)
            let riDemo = await rowIndexByText(page, 'name', CH_DEMO_NAME)
            await editGridCell(page, riDemo, 'description', draft)
            await waitUntilExist(page, '草稿成立: 儲存鈕出現', () => !!document.querySelector('[data-fmid="channels-save-btn"]'), { timeout: 8000 })
            assert.strictEqual(await gridCellText(page, riDemo, 'description'), draft, '前置: 草稿已在格內')

            //arrange（未走 UI）：另一位管理員改「報表產製」描述 → 資料通道推播整張 channels 表
            await otherAdminCall(page, 'saveChannels', [[{ id: 'id-for-channel-report', description: otherDesc }]])
            let noticeTxt = await waitStaleNotice(page)

            //spec E2E-014 驗證(1)：推播後草稿仍在格內、儲存鈕仍在、他人之變更不覆蓋草稿畫面; (2) 提示條文字
            assert.strictEqual(await gridCellText(page, riDemo, 'description'), draft, '有未存修改時推播不得重建編輯中之內容 (E7)')
            assert.ok(await page.locator('[data-fmid="channels-save-btn"]').count() > 0, '草稿仍在: 儲存鈕應仍顯示')
            assert.ok(noticeTxt.includes(tStaleNotice), `提示條應含「${tStaleNotice}」, 實得「${noticeTxt}」`)
            let riReport = await rowIndexByText(page, 'name', '報表產製')
            assert.notStrictEqual(await gridCellText(page, riReport, 'description'), otherDesc, '草稿期間畫面不顯示他人之新值 (不重建)')
            //視覺①：提示條整顆（草稿保留 + 他人已更新）
            let s1 = await captureStableWithBox(page, '[data-fmid="draft-stale-notice"]')

            //act：點儲存（視覺②點擊前: 框儲存鈕整顆）→ 整次被拒
            let s2 = await captureStableWithBox(page, '[data-fmid="channels-save-btn"]')
            await page.locator('[data-fmid="channels-save-btn"]').first().click()
            let dlg = await waitRejectDialog(page, tSaveStale)
            //視覺③：被拒訊息框整個面板
            let s3 = await captureStableWithBox(page, dlg)
            await clickConfirmBtn(page, ok)

            //spec E2E-014 驗證(3)：被拒後零寫入（後端「訂單服務」描述未變）、草稿與提示條保留
            let after = await page.evaluate(async () => { let r = await window.$vo.$fapi.getChannelsList(); return r.map((c) => ({ id: c.id, description: c.description })) })
            let dBefore = before.find((c) => c.id === CH_DEMO_ID).description
            let dAfter = after.find((c) => c.id === CH_DEMO_ID).description
            assert.strictEqual(dAfter, dBefore, '被拒後「訂單服務」描述不得被寫入')
            assert.strictEqual(await gridCellText(page, riDemo, 'description'), draft, '被拒後草稿仍保留')
            assert.ok(await page.locator('[data-fmid="draft-stale-notice"]').count() > 0, '被拒後提示條仍在')

            //act：點「重新載入」→ 確認 → 換成最新資料
            await page.locator('[data-fmid="draft-reload-btn"]').first().click()
            await clickConfirmBtn(page, yes)
            await waitUntilExist(page, '重新載入後見他人之新值', (d) => (((document.querySelector('.ag-root-wrapper') || {}).innerText) || '').includes(d), { timeout: 15000, arg: otherDesc })
            await waitUntilExist(page, '提示條與儲存鈕消失', () => !document.querySelector('[data-fmid="draft-stale-notice"]') && !document.querySelector('[data-fmid="channels-save-btn"]'), { timeout: 8000 })
            await page.waitForTimeout(500)
            //視覺④：重新載入後的資料表（標頭與四頻道列; 草稿已捨棄、他人之新值已顯示）
            let s4 = await captureStableWithBox(page, gridContentBox(SEL_GRID))

            //spec E2E-014 驗證(4)：草稿已捨棄
            let riDemo2 = await rowIndexByText(page, 'name', CH_DEMO_NAME)
            assert.strictEqual(await gridCellText(page, riDemo2, 'description'), dBefore || '', '重新載入後草稿應被捨棄, 回到後端值')

            //延伸驗證（外審補驗; 不增標準圖）：重新載入後之新基準取自伺服端 —— 再改一次描述並儲存須成功（基準不是推播時之草稿摘要, 也不是舊基準）
            let afterDesc = `after-reload-${lang}`
            await editGridCell(page, riDemo2, 'description', afterDesc)
            await waitUntilExist(page, '重新載入後再編輯: 儲存鈕出現', () => !!document.querySelector('[data-fmid="channels-save-btn"]'), { timeout: 8000 })
            await page.locator('[data-fmid="channels-save-btn"]').first().click()
            await waitUntilExist(page, '儲存成功訊息框', (t) => (document.body.innerText || '').includes(t), { timeout: 15000, arg: await page.evaluate(() => window.$vo.$t('saveChannelSuccess')) })
            await clickConfirmBtn(page, ok)
            let saved = await page.evaluate(async () => { let r = await window.$vo.$fapi.getChannelsList(); return r.map((c) => ({ id: c.id, description: c.description })) })
            assert.strictEqual(saved.find((c) => c.id === CH_DEMO_ID).description, afterDesc, '重新載入後以新基準存檔應成功')
            assert.ok(!(await page.locator('[data-fmid="channels-save-btn"]').count()), '存檔成功後儲存鈕消失')
            return [
                { name: 'E2E-014-1-draft-stale', buf: s1 },
                { name: 'E2E-014-2-click-save', buf: s2 },
                { name: 'E2E-014-3-save-rejected', buf: s3 },
                { name: 'E2E-014-4-reloaded', buf: s4 },
            ]
        },
        semantic: async (page) => {
            //spec E2E-014 驗證(5)：他人之寫入已生效（後端「報表產製」描述為他人所寫）、本人未存之草稿未寫入
            let rs = await page.evaluate(async () => { let r = await window.$vo.$fapi.getChannelsList(); return r.map((c) => ({ id: c.id, description: c.description })) })
            let report = rs.find((c) => c.id === 'id-for-channel-report')
            assert.ok(/^edited-by-other-admin-/.test(report.description), `他人之寫入應生效, 實得「${report.description}」`)
            let demo = rs.find((c) => c.id === CH_DEMO_ID)
            assert.ok(!/^draft-desc-/.test(demo.description || ''), '本人未存之草稿不得寫入')
        },
    },
    {
        //E2E-015：後台成員頁（預設頻道「訂單服務」）切編輯模式並就地改了 agent-demo 的角色（尚未儲存）, 此時另一位管理員為同頻道新增了成員 → 出現「資料已被他人更新」提示且草稿保留;
        //按儲存被整次拒收（本次未儲存任何變更, 他人新增之成員不受影響）, 按「重新載入」並確認後顯示含他人新增之最新成員清單。
        //6 步真實 user path：①rail 點 Admin→子選單「成員」②點編輯模式開關 ③就地編輯 agent-demo 之角色欄（Pattern B）
        //  ④另一位管理員新增成員（arrange, 未走 UI: saveChannelMembers 不帶基準之外部呼叫）⑤見提示條（成員頁以 store.channelMembers 推播比對基準）⑥點儲存→被拒→確定 ⑦點重新載入→確認→最新清單。
        //清理：同 E2E-014。
        name: 'E2E-015-members-stale-save',
        stages: ['E2E-015-1-draft-stale', 'E2E-015-2-click-save', 'E2E-015-3-save-rejected', 'E2E-015-4-reloaded'],
        run: async (page, lang) => {
            let ok = await page.evaluate(() => window.$vo.$t('ok'))
            let yes = await page.evaluate(() => window.$vo.$t('yes'))
            let tStaleNotice = await page.evaluate(() => window.$vo.$t('draftStaleNotice'))
            let tSaveStale = await page.evaluate(() => window.$vo.$t('saveStale'))
            let draftRole = `draft-role-${lang}`
            let otherMember = `added-by-other-${lang}`

            //進後台成員子頁（首步「點後台」共用 E2E-005-1-click-admin）
            await clickRail(page, 'admin')
            await waitUntilExist(page, '後台成員子頁鈕就緒', () => !!document.querySelector('[data-fmid="admin-sub-mmMembers"]'), { timeout: 20000 })
            await page.locator('[data-fmid="admin-sub-mmMembers"]').first().click()
            await waitUntilExist(page, '後台成員 grid 載入 agent-demo', () => (document.body.innerText || '').includes('agent-demo'), { timeout: 20000 })
            await page.waitForTimeout(500)
            let before = await page.evaluate(async (cid) => { let r = await window.$vo.$fapi.getChannelMembers(cid); return r.map((m) => ({ id: m.id, memberId: m.memberId, role: m.role })) }, CH_DEMO_ID)

            //act：切編輯模式 → 就地編輯 agent-demo 之角色欄（草稿）
            await page.locator('[data-fmid="members-edit-switch"]').first().click()
            await page.waitForTimeout(700)
            let riAgent = await rowIndexByText(page, 'memberId', 'agent-demo')
            await editGridCell(page, riAgent, 'role', draftRole)
            await waitUntilExist(page, '草稿成立: 儲存鈕出現', () => !!document.querySelector('[data-fmid="members-save-btn"]'), { timeout: 8000 })
            assert.strictEqual(await gridCellText(page, riAgent, 'role'), draftRole, '前置: 草稿已在格內')

            //arrange（未走 UI）：另一位管理員為同頻道新增成員 → 資料通道推播 channelMembers 表
            await otherAdminCall(page, 'saveChannelMembers', [CH_DEMO_ID, [{ memberId: otherMember, memberType: 'human', role: 'member' }]])
            let noticeTxt = await waitStaleNotice(page)

            //spec E2E-015 驗證(1)(2)：草稿仍在、儲存鈕仍在、提示條文字; 他人新增之成員尚未出現於畫面（不重建）
            assert.strictEqual(await gridCellText(page, riAgent, 'role'), draftRole, '有未存修改時畫面不得被重建')
            assert.ok(await page.locator('[data-fmid="members-save-btn"]').count() > 0, '草稿仍在: 儲存鈕應仍顯示')
            assert.ok(noticeTxt.includes(tStaleNotice), `提示條應含「${tStaleNotice}」, 實得「${noticeTxt}」`)
            assert.ok(!(await page.evaluate(() => document.querySelector('.ag-root-wrapper').innerText)).includes(otherMember), '草稿期間畫面不顯示他人新增之成員')
            let s1 = await captureStableWithBox(page, '[data-fmid="draft-stale-notice"]')

            //act：點儲存 → 整次被拒
            let s2 = await captureStableWithBox(page, '[data-fmid="members-save-btn"]')
            await page.locator('[data-fmid="members-save-btn"]').first().click()
            let dlg = await waitRejectDialog(page, tSaveStale)
            let s3 = await captureStableWithBox(page, dlg)
            await clickConfirmBtn(page, ok)

            //spec E2E-015 驗證(3)：被拒後零寫入——agent-demo 角色未變, 他人新增之成員仍在、未被覆蓋; 草稿與提示條保留
            let after = await page.evaluate(async (cid) => { let r = await window.$vo.$fapi.getChannelMembers(cid); return r.map((m) => ({ id: m.id, memberId: m.memberId, role: m.role })) }, CH_DEMO_ID)
            let rBefore = before.find((m) => m.memberId === 'agent-demo').role
            assert.strictEqual(after.find((m) => m.memberId === 'agent-demo').role, rBefore, '被拒後 agent-demo 角色不得被寫入')
            assert.ok(after.some((m) => m.memberId === otherMember), '他人新增之成員不受影響')
            assert.strictEqual(after.length, before.length + 1)
            assert.strictEqual(await gridCellText(page, riAgent, 'role'), draftRole, '被拒後草稿仍保留')
            assert.ok(await page.locator('[data-fmid="draft-stale-notice"]').count() > 0, '被拒後提示條仍在')

            //act：點「重新載入」→ 確認 → 最新清單
            await page.locator('[data-fmid="draft-reload-btn"]').first().click()
            await clickConfirmBtn(page, yes)
            await waitUntilExist(page, '重新載入後見他人新增之成員', (m) => (document.body.innerText || '').includes(m), { timeout: 15000, arg: otherMember })
            await waitUntilExist(page, '提示條與儲存鈕消失', () => !document.querySelector('[data-fmid="draft-stale-notice"]') && !document.querySelector('[data-fmid="members-save-btn"]'), { timeout: 8000 })
            await page.waitForTimeout(500)
            let s4 = await captureStableWithBox(page, gridContentBox(SEL_GRID))

            //spec E2E-015 驗證(4)：草稿已捨棄（agent-demo 角色回後端值）
            let riAgent2 = await rowIndexByText(page, 'memberId', 'agent-demo')
            assert.strictEqual(await gridCellText(page, riAgent2, 'role'), rBefore, '重新載入後草稿應被捨棄')

            //=== 延伸驗證（外審補驗; 不增標準圖）===
            //(a) 有未存修改時切換頻道須確認 (P5): 取消 → 原頻道與草稿維持; 選到同一頻道 → 無確認、草稿維持; 確定 → 換頻道並捨棄草稿
            let no = await page.evaluate(() => window.$vo.$t('no'))
            let tSwitch = await page.evaluate(() => window.$vo.$t('switchChannelDiscardConfirm'))
            let otherCh = '報表產製'
            await editGridCell(page, riAgent2, 'role', 'p5-draft')
            await waitUntilExist(page, 'P5 草稿成立: 儲存鈕出現', () => !!document.querySelector('[data-fmid="members-save-btn"]'), { timeout: 8000 })
            await selectMembersChannel(page, otherCh)
            await waitUntilExist(page, 'P5 切換頻道確認框出現', (t) => (document.body.innerText || '').includes(t), { timeout: 8000, arg: tSwitch })
            await clickConfirmBtn(page, no) //取消
            assert.ok((await page.evaluate(() => document.querySelector('.ag-root-wrapper').innerText)).includes('agent-demo'), 'P5: 取消後仍在原頻道')
            assert.strictEqual(await gridCellText(page, await rowIndexByText(page, 'memberId', 'agent-demo'), 'role'), 'p5-draft', 'P5: 取消後草稿維持')
            assert.ok(await page.locator('[data-fmid="members-save-btn"]').count() > 0, 'P5: 取消後儲存鈕仍在')
            assert.ok((await page.evaluate(() => document.querySelector('[data-fmid="members-channel-selector"]').innerText)).includes(CH_DEMO_NAME), 'P5: 取消後選擇器回到原頻道')
            await selectMembersChannel(page, CH_DEMO_NAME) //選到同一頻道
            assert.ok(!(await page.evaluate((t) => (document.body.innerText || '').includes(t), tSwitch)), 'P5: 選到同一頻道不應出現確認框')
            assert.strictEqual(await gridCellText(page, await rowIndexByText(page, 'memberId', 'agent-demo'), 'role'), 'p5-draft', 'P5: 選到同一頻道草稿維持')
            await selectMembersChannel(page, otherCh)
            await waitUntilExist(page, 'P5 切換頻道確認框再出現', (t) => (document.body.innerText || '').includes(t), { timeout: 8000, arg: tSwitch })
            await clickConfirmBtn(page, yes) //確定
            await waitUntilExist(page, 'P5 已換頻道且草稿捨棄', () => { let g = document.querySelector('.ag-root-wrapper'); return (!g || !(g.innerText || '').includes('agent-demo')) && !document.querySelector('[data-fmid="members-save-btn"]') }, { timeout: 10000 })
            let rolesAfterSwitch = await page.evaluate(async (cid) => (await window.$vo.$fapi.getChannelMembers(cid)).map((m) => m.role), CH_DEMO_ID)
            assert.ok(!rolesAfterSwitch.includes('p5-draft'), 'P5: 捨棄之草稿不得寫入')

            //(b) 草稿中刪除其他列後改回原值再切換編輯模式, 已刪之列不得復活 (舊快照重建 → 存檔時被當新列新增)
            await selectMembersChannel(page, CH_DEMO_NAME)
            await waitUntilExist(page, '回原頻道見 agent-demo', () => { let g = document.querySelector('.ag-root-wrapper'); return !!g && (g.innerText || '').includes('agent-demo') }, { timeout: 15000 })
            await otherAdminCall(page, 'saveChannelMembers', [CH_DEMO_ID, [{ memberId: 'victim-b', memberType: 'human', role: 'member' }]])
            await selectMembersChannel(page, otherCh) //無草稿: 直接切換 (重新載入成員清單的使用者動作)
            await waitUntilExist(page, '已換頻道', () => { let g = document.querySelector('.ag-root-wrapper'); return !g || !(g.innerText || '').includes('agent-demo') }, { timeout: 10000 })
            await selectMembersChannel(page, CH_DEMO_NAME)
            await waitUntilExist(page, '重載後見 victim-b', () => (document.querySelector('.ag-root-wrapper') ? (document.querySelector('.ag-root-wrapper').innerText || '') : '').includes('victim-b'), { timeout: 15000 })
            await page.waitForTimeout(500)
            let origRole = await gridCellText(page, await rowIndexByText(page, 'memberId', 'agent-demo'), 'role')
            await editGridCell(page, await rowIndexByText(page, 'memberId', 'agent-demo'), 'role', 'tmp-role')
            await waitUntilExist(page, '(b) 草稿成立', () => !!document.querySelector('[data-fmid="members-save-btn"]'), { timeout: 8000 })
            let riVictim = await rowIndexByText(page, 'memberId', 'victim-b')
            await page.locator(`.ag-row[row-index="${riVictim}"] .ag-selection-checkbox`).first().click()
            await waitUntilExist(page, '(b) 刪除鈕出現', () => !!document.querySelector('[data-fmid="members-delete-btn"]'), { timeout: 8000 })
            await page.locator('[data-fmid="members-delete-btn"]').first().click()
            await clickConfirmBtn(page, yes)
            await clickConfirmBtn(page, ok)
            let membersNow = await page.evaluate(async (cid) => (await window.$vo.$fapi.getChannelMembers(cid)).map((m) => m.memberId), CH_DEMO_ID)
            assert.ok(!membersNow.includes('victim-b'), '(b) 後端已刪 victim-b')
            assert.ok(!(await page.evaluate(() => document.querySelector('.ag-root-wrapper').innerText)).includes('victim-b'), '(b) 畫面已移除 victim-b')
            assert.ok(await page.locator('[data-fmid="members-save-btn"]').count() > 0, '(b) 刪除不丟草稿: 儲存鈕仍在')
            await editGridCell(page, await rowIndexByText(page, 'memberId', 'agent-demo'), 'role', origRole) //改回原值 → 無修改
            await waitUntilExist(page, '(b) 改回原值後儲存鈕消失', () => !document.querySelector('[data-fmid="members-save-btn"]'), { timeout: 8000 })
            await page.locator('[data-fmid="members-edit-switch"]').first().click() //關
            await page.waitForTimeout(800)
            await page.locator('[data-fmid="members-edit-switch"]').first().click() //開: 自快照重建
            await page.waitForTimeout(900)
            assert.ok(!(await page.evaluate(() => document.querySelector('.ag-root-wrapper').innerText)).includes('victim-b'), '(b) 切換編輯模式後已刪之列不得復活')
            assert.ok(!(await page.locator('[data-fmid="members-save-btn"]').count()), '(b) 無修改: 儲存鈕不應出現')

            //(c) 草稿中刪除後之基準仍有效: 再改一次角色並儲存須成功（基準為載入時凍結基準去掉被刪之列; 新基準取自伺服端）
            let afterRole = `after-reload-role-${lang}`
            await editGridCell(page, await rowIndexByText(page, 'memberId', 'agent-demo'), 'role', afterRole)
            await waitUntilExist(page, '(c) 草稿成立', () => !!document.querySelector('[data-fmid="members-save-btn"]'), { timeout: 8000 })
            await page.locator('[data-fmid="members-save-btn"]').first().click()
            await waitUntilExist(page, '(c) 儲存成功訊息框', (t) => (document.body.innerText || '').includes(t), { timeout: 15000, arg: await page.evaluate(() => window.$vo.$t('saveMemberSuccess')) })
            await clickConfirmBtn(page, ok)
            let rolesSaved = await page.evaluate(async (cid) => (await window.$vo.$fapi.getChannelMembers(cid)).map((m) => ({ memberId: m.memberId, role: m.role })), CH_DEMO_ID)
            assert.strictEqual(rolesSaved.find((m) => m.memberId === 'agent-demo').role, afterRole, '(c) 以新基準存檔應成功')
            assert.ok(!rolesSaved.some((m) => m.memberId === 'victim-b'), '(c) 已刪之 victim-b 不得因存檔被當新列新增')
            return [
                { name: 'E2E-015-1-draft-stale', buf: s1 },
                { name: 'E2E-015-2-click-save', buf: s2 },
                { name: 'E2E-015-3-save-rejected', buf: s3 },
                { name: 'E2E-015-4-reloaded', buf: s4 },
            ]
        },
        semantic: async (page) => {
            //spec E2E-015 驗證(5)：後端終態——兩位成員（agent-demo 角色為原值、他人新增者）, 本人未存之草稿角色未寫入
            let rs = await page.evaluate(async (cid) => { let r = await window.$vo.$fapi.getChannelMembers(cid); return r.map((m) => ({ memberId: m.memberId, role: m.role })) }, CH_DEMO_ID)
            assert.strictEqual(rs.length, 2)
            assert.ok(rs.every((m) => !/^draft-role-/.test(m.role || '')), '本人未存之草稿不得寫入')
        },
    },
    {
        //E2E-016：後台頻道頁切編輯模式、雙擊「訂單服務」描述欄並輸入文字但尚未按 Enter（編輯器開啟中、輸入尚未進列資料）, 此時另一位管理員改了別的頻道 →
        //編輯器與已輸入之文字不丟、出現「資料已被他人更新」提示（視同草稿）; 按 Esc 取消編輯後依一般規則換成最新資料（無未存修改）;
        //另一輪同樣情境改按 Enter 提交 → 成為草稿（儲存鈕出現、提示條保留、畫面仍不顯示他人新值）, 點儲存整次被拒（基準凍結, 未存任何變更）。
        //6 步真實 user path：①rail 點 Admin（預設頻道子頁）②點編輯模式開關 ③雙擊「訂單服務」描述欄並輸入（不按 Enter）
        //  ④另一位管理員改「報表產製」描述（arrange, 未走 UI: 頁面既有連線呼叫 saveChannels, 不帶基準之外部呼叫）⑤見提示條且編輯器仍開 ⑥按 Esc → 最新資料;
        //  再一輪③④⑤後按 Enter → 草稿 → 點儲存 → 被拒。
        //修前（task-verify01 N1）: 步驟④推播即把整張表重建, 編輯器被關閉、已輸入之文字靜默丟失（isModified 看不到未提交之輸入）。
        //清理：寫入皆在測試實例資料庫, 由 per-case reseed 還原; 固定時鐘於 arrange 後立即關閉。
        name: 'E2E-016-channels-editor-open-push',
        stages: ['E2E-016-1-editor-kept', 'E2E-016-2-after-esc'],
        run: async (page, lang) => {
            let ok = await page.evaluate(() => window.$vo.$t('ok'))
            let tStaleNotice = await page.evaluate(() => window.$vo.$t('draftStaleNotice'))
            let tSaveStale = await page.evaluate(() => window.$vo.$t('saveStale'))
            let draftA = `typed-not-entered-${lang}`
            let otherA = `edited-by-other-admin-A-${lang}`
            let draftB = `typed-then-enter-${lang}`
            let otherB = `edited-by-other-admin-B-${lang}`

            //進後台頻道子頁（首步「點後台」共用 E2E-005-1-click-admin）→ 切編輯模式
            await clickRail(page, 'admin')
            await waitUntilExist(page, '後台頻道 grid 載入', () => (((document.querySelector('.ag-root-wrapper') || {}).innerText) || '').includes('訂單服務'), { timeout: 20000 })
            await page.waitForTimeout(500)
            await page.locator('[data-fmid="channels-edit-switch"]').first().click()
            await page.waitForTimeout(700)
            let riDemo = await rowIndexByText(page, 'name', CH_DEMO_NAME)
            let origDesc = await gridCellText(page, riDemo, 'description')

            //=== 一、按 Esc 取消 ===
            //act：雙擊「訂單服務」描述欄並輸入, 不按 Enter（編輯器開啟中）
            await typeGridCellKeepEditing(page, riDemo, 'description', draftA)
            assert.ok(!(await page.locator('[data-fmid="channels-save-btn"]').count()), '前置: 輸入尚未提交, 不應有儲存鈕（尚無未存修改）')

            //arrange（未走 UI）：另一位管理員改「報表產製」描述 → 資料通道推播整張 channels 表
            await otherAdminCall(page, 'saveChannels', [[{ id: 'id-for-channel-report', description: otherA }]])
            await waitUntilExist(page, '前端 store 已收到他人推播', (d) => (window.$vo.$store.state.channels || []).some((c) => c.id === 'id-for-channel-report' && c.description === d), { timeout: 25000, arg: otherA })
            await page.waitForTimeout(500) //負向觀察窗: 推播處理後若被重建, 編輯器會在此期間消失

            //spec E2E-016 驗證(1)：推播後編輯器仍開啟、已輸入之文字仍在（修前: 整張表被重建, 編輯器關閉、輸入丟失）
            let st = await gridEditorState(page)
            assert.ok(st.open, 'N1: 編輯器開啟中收到推播不得關閉編輯器（修前整張表被重建）')
            assert.strictEqual(st.value, draftA, 'N1: 已輸入未按 Enter 之文字不得丟失')
            //(2) 提示條出現（視同草稿）, 文字等於 draftStaleNotice
            let noticeTxt = await waitStaleNotice(page)
            assert.ok(noticeTxt.includes(tStaleNotice), `提示條應含「${tStaleNotice}」, 實得「${noticeTxt}」`)
            //(3) 不重建: 他人之新值尚未顯示; 提示條出現使版面下移後編輯器仍在、文字仍在
            let riReport = await rowIndexByText(page, 'name', '報表產製')
            assert.notStrictEqual(await gridCellText(page, riReport, 'description'), otherA, '編輯器開啟中畫面不顯示他人之新值（不重建）')
            st = await gridEditorState(page)
            assert.ok(st.open && st.value === draftA, '提示條出現後編輯器與輸入仍在')
            //視覺①：提示條整顆（編輯器仍開啟於其下之表格內）
            let s1 = await captureStableWithBox(page, '[data-fmid="draft-stale-notice"]')

            //act：按 Esc 取消編輯 → 編輯器關閉、無未存修改 → 依一般規則換成最新資料
            await page.keyboard.press('Escape')
            await waitUntilExist(page, 'Esc 後見他人之新值（重建）', (d) => (((document.querySelector('.ag-root-wrapper') || {}).innerText) || '').includes(d), { timeout: 15000, arg: otherA })
            await waitUntilExist(page, '提示條消失', () => !document.querySelector('[data-fmid="draft-stale-notice"]'), { timeout: 8000 })
            await page.waitForTimeout(500)
            //(4) Esc 取消之文字不入列（回到原值）, 無儲存鈕, 編輯器已關
            let riDemo2 = await rowIndexByText(page, 'name', CH_DEMO_NAME)
            assert.strictEqual(await gridCellText(page, riDemo2, 'description'), origDesc, 'Esc 取消之輸入不得留在格內')
            assert.ok(!(await page.locator('[data-fmid="channels-save-btn"]').count()), 'Esc 取消後無未存修改: 不應有儲存鈕')
            assert.ok(!(await gridEditorState(page)).open, 'Esc 後編輯器已關閉')
            //視覺②：重建後的資料表（標頭與四個頻道列; 他人之新值已顯示）
            let s2 = await captureStableWithBox(page, gridContentBox(SEL_GRID))

            //=== 二、按 Enter 提交（延伸驗證, 不另拍標準圖）===
            await typeGridCellKeepEditing(page, riDemo2, 'description', draftB)
            await otherAdminCall(page, 'saveChannels', [[{ id: 'id-for-channel-report', description: otherB }]])
            await waitUntilExist(page, '前端 store 已收到他人第二次推播', (d) => (window.$vo.$store.state.channels || []).some((c) => c.id === 'id-for-channel-report' && c.description === d), { timeout: 25000, arg: otherB })
            await page.waitForTimeout(500)
            st = await gridEditorState(page)
            assert.ok(st.open && st.value === draftB, '(二) 編輯器開啟中收到推播: 編輯器與輸入仍在')
            await waitStaleNotice(page)
            await page.keyboard.press('Enter') //提交 → 草稿
            await waitUntilExist(page, 'Enter 後草稿成立: 儲存鈕出現', () => !!document.querySelector('[data-fmid="channels-save-btn"]'), { timeout: 8000 })
            await page.waitForTimeout(500)
            //(5) 提交後草稿保留（不因延後之推播重建而丟）、提示條保留、仍不顯示他人新值（基準凍結）
            assert.strictEqual(await gridCellText(page, await rowIndexByText(page, 'name', CH_DEMO_NAME), 'description'), draftB, '(二) Enter 提交之草稿不得被延後之推播重建丟掉')
            assert.ok(await page.locator('[data-fmid="draft-stale-notice"]').count() > 0, '(二) 草稿成立後提示條仍在')
            assert.notStrictEqual(await gridCellText(page, await rowIndexByText(page, 'name', '報表產製'), 'description'), otherB, '(二) 草稿期間畫面不顯示他人之新值')
            //(6) 基準凍結: 點儲存整次被拒, 未存任何變更
            await page.locator('[data-fmid="channels-save-btn"]').first().click()
            await waitRejectDialog(page, tSaveStale)
            await clickConfirmBtn(page, ok)
            let after = await page.evaluate(async () => { let r = await window.$vo.$fapi.getChannelsList(); return r.map((c) => ({ id: c.id, description: c.description })) })
            assert.strictEqual(after.find((c) => c.id === CH_DEMO_ID).description, origDesc, '(二) 被拒後「訂單服務」描述不得被寫入')
            assert.strictEqual(after.find((c) => c.id === 'id-for-channel-report').description, otherB, '(二) 他人之寫入保留')

            //=== 三、已有草稿 (上段之 draftB 被拒後保留) 時再開另一格之編輯器並收到推播; 點表格下方空白處使編輯器失焦關閉（延伸驗證, 不另拍標準圖）===
            let otherC = `edited-by-other-admin-C-${lang}`
            let draftC = `typed-over-draft-${lang}`
            let riEtl = await rowIndexByText(page, 'name', 'ETL 管線')
            await typeGridCellKeepEditing(page, riEtl, 'description', draftC)
            await otherAdminCall(page, 'saveChannels', [[{ id: 'id-for-channel-report', description: otherC }]])
            await waitUntilExist(page, '前端 store 已收到他人第三次推播', (d) => (window.$vo.$store.state.channels || []).some((c) => c.id === 'id-for-channel-report' && c.description === d), { timeout: 25000, arg: otherC })
            await page.waitForTimeout(500)
            st = await gridEditorState(page)
            assert.ok(st.open && st.value === draftC, '(三) 已有草稿時編輯器開啟中收到推播: 編輯器與輸入仍在')
            assert.strictEqual(await gridCellText(page, await rowIndexByText(page, 'name', CH_DEMO_NAME), 'description'), draftB, '(三) 既有草稿仍在')
            await page.mouse.click(900, 700) //表格下方空白處: 編輯器失焦 → 關閉並提交輸入
            await waitUntilExist(page, '(三) 失焦後編輯器關閉', () => !document.querySelector('.ag-cell-inline-editing'), { timeout: 8000 })
            await page.waitForTimeout(500)
            assert.strictEqual(await gridCellText(page, await rowIndexByText(page, 'name', 'ETL 管線'), 'description'), draftC, '(三) 失焦提交之輸入成為草稿, 不被延後之推播重建丟掉')
            assert.strictEqual(await gridCellText(page, await rowIndexByText(page, 'name', CH_DEMO_NAME), 'description'), draftB, '(三) 先前之草稿仍在')
            assert.ok(await page.locator('[data-fmid="channels-save-btn"]').count() > 0, '(三) 草稿仍在: 儲存鈕應仍顯示')
            assert.ok(await page.locator('[data-fmid="draft-stale-notice"]').count() > 0, '(三) 提示條仍在')
            assert.notStrictEqual(await gridCellText(page, await rowIndexByText(page, 'name', '報表產製'), 'description'), otherC, '(三) 草稿期間畫面不顯示他人之新值')
            return [
                { name: 'E2E-016-1-editor-kept', buf: s1 },
                { name: 'E2E-016-2-after-esc', buf: s2 },
            ]
        },
        semantic: async (page) => {
            //spec E2E-016 驗證(7)：後端終態——他人之寫入已生效, 本人輸入之文字（Esc 取消 / Enter 後存檔被拒）皆未寫入
            let rs = await page.evaluate(async () => { let r = await window.$vo.$fapi.getChannelsList(); return r.map((c) => ({ id: c.id, description: c.description })) })
            assert.ok(/^edited-by-other-admin-C-/.test(rs.find((c) => c.id === 'id-for-channel-report').description), '他人之寫入應生效 (最後一次為 C)')
            assert.ok(!/^typed-/.test(rs.find((c) => c.id === CH_DEMO_ID).description || ''), '本人輸入之文字不得寫入')
        },
    },
    {
        //E2E-017：後台成員頁（預設頻道「訂單服務」）切編輯模式、雙擊 agent-demo 之角色欄並輸入文字但尚未按 Enter, 此時另一位管理員為同頻道新增成員 →
        //編輯器與已輸入之文字不丟、出現「資料已被他人更新」提示（視同草稿）; 按 Esc 取消後提示條消失（無未存修改）;
        //另一輪同樣情境改按 Enter 提交 → 草稿（儲存鈕出現、提示條保留）, 點儲存整次被拒。
        //6 步真實 user path：①rail 點 Admin→子選單「成員」②點編輯模式開關 ③雙擊角色欄並輸入（不按 Enter）④另一位管理員新增成員（arrange, 未走 UI）⑤見提示條且編輯器仍開 ⑥按 Esc;
        //  再一輪③④⑤後按 Enter → 草稿 → 點儲存 → 被拒。
        //成員頁快照本不隨推播重建（既有行為, 見已知缺口）, 本案驗證重點為: 提示（修前編輯器開啟中不顯示提示條, 使用者不知畫面已過期）與按 Enter 提交後草稿保留、存檔被拒。
        //清理：同 E2E-016。
        name: 'E2E-017-members-editor-open-push',
        stages: ['E2E-017-1-editor-kept'],
        run: async (page, lang) => {
            let ok = await page.evaluate(() => window.$vo.$t('ok'))
            let tStaleNotice = await page.evaluate(() => window.$vo.$t('draftStaleNotice'))
            let tSaveStale = await page.evaluate(() => window.$vo.$t('saveStale'))
            let draftA = `typed-role-not-entered-${lang}`
            let otherA = `added-by-other-A-${lang}`
            let draftB = `typed-role-then-enter-${lang}`
            let otherB = `added-by-other-B-${lang}`

            //進後台成員子頁（首步「點後台」共用 E2E-005-1-click-admin）→ 切編輯模式
            await clickRail(page, 'admin')
            await waitUntilExist(page, '後台成員子頁鈕就緒', () => !!document.querySelector('[data-fmid="admin-sub-mmMembers"]'), { timeout: 20000 })
            await page.locator('[data-fmid="admin-sub-mmMembers"]').first().click()
            await waitUntilExist(page, '後台成員 grid 載入 agent-demo', () => (document.body.innerText || '').includes('agent-demo'), { timeout: 20000 })
            await page.waitForTimeout(500)
            await page.locator('[data-fmid="members-edit-switch"]').first().click()
            await page.waitForTimeout(700)
            let riAgent = await rowIndexByText(page, 'memberId', 'agent-demo')
            let origRole = await gridCellText(page, riAgent, 'role')

            //=== 一、按 Esc 取消 ===
            await typeGridCellKeepEditing(page, riAgent, 'role', draftA)
            assert.ok(!(await page.locator('[data-fmid="members-save-btn"]').count()), '前置: 輸入尚未提交, 不應有儲存鈕')
            await otherAdminCall(page, 'saveChannelMembers', [CH_DEMO_ID, [{ memberId: otherA, memberType: 'human', role: 'member' }]])
            await waitUntilExist(page, '前端 store 已收到他人推播', (m) => (window.$vo.$store.state.channelMembers || []).some((x) => x.memberId === m), { timeout: 25000, arg: otherA })
            await page.waitForTimeout(500) //負向觀察窗

            //spec E2E-017 驗證(1)：編輯器仍開啟、已輸入之文字仍在; (2) 提示條出現（修前: 無未存修改即不顯示提示）
            let st = await gridEditorState(page)
            assert.ok(st.open, 'N1: 編輯器開啟中收到推播不得關閉編輯器')
            assert.strictEqual(st.value, draftA, 'N1: 已輸入未按 Enter 之文字不得丟失')
            let noticeTxt = await waitStaleNotice(page)
            assert.ok(noticeTxt.includes(tStaleNotice), `提示條應含「${tStaleNotice}」, 實得「${noticeTxt}」`)
            //(3) 他人新增之成員尚未出現於畫面; 提示條出現使版面下移後編輯器與輸入仍在
            assert.ok(!(await page.evaluate(() => document.querySelector('.ag-root-wrapper').innerText)).includes(otherA), '畫面不顯示他人新增之成員（不重建）')
            st = await gridEditorState(page)
            assert.ok(st.open && st.value === draftA, '提示條出現後編輯器與輸入仍在')
            let s1 = await captureStableWithBox(page, '[data-fmid="draft-stale-notice"]')

            //act：按 Esc 取消編輯 → 無未存修改 → 提示條消失
            await page.keyboard.press('Escape')
            await waitUntilExist(page, 'Esc 後提示條消失（無未存修改）', () => !document.querySelector('[data-fmid="draft-stale-notice"]'), { timeout: 8000 })
            assert.strictEqual(await gridCellText(page, await rowIndexByText(page, 'memberId', 'agent-demo'), 'role'), origRole, 'Esc 取消之輸入不得留在格內')
            assert.ok(!(await page.locator('[data-fmid="members-save-btn"]').count()), 'Esc 取消後無未存修改: 不應有儲存鈕')

            //=== 二、按 Enter 提交（延伸驗證, 不另拍標準圖）===
            // 他人已新增 otherA 而本畫面未重載（成員頁不自動重載）→ 先「重新載入」取最新基準再做第二輪: 切換頻道再回來（無草稿, 無確認框）
            await selectMembersChannel(page, '報表產製')
            await waitUntilExist(page, '已換頻道', () => { let g = document.querySelector('.ag-root-wrapper'); return !g || !(g.innerText || '').includes('agent-demo') }, { timeout: 10000 })
            await selectMembersChannel(page, CH_DEMO_NAME)
            await waitUntilExist(page, '回原頻道見他人新增之成員', (m) => (((document.querySelector('.ag-root-wrapper') || {}).innerText) || '').includes(m), { timeout: 15000, arg: otherA })
            await page.waitForTimeout(500)
            let riAgent2 = await rowIndexByText(page, 'memberId', 'agent-demo')
            await typeGridCellKeepEditing(page, riAgent2, 'role', draftB)
            await otherAdminCall(page, 'saveChannelMembers', [CH_DEMO_ID, [{ memberId: otherB, memberType: 'human', role: 'member' }]])
            await waitUntilExist(page, '前端 store 已收到他人第二次推播', (m) => (window.$vo.$store.state.channelMembers || []).some((x) => x.memberId === m), { timeout: 25000, arg: otherB })
            await page.waitForTimeout(500)
            st = await gridEditorState(page)
            assert.ok(st.open && st.value === draftB, '(二) 編輯器開啟中收到推播: 編輯器與輸入仍在')
            await waitStaleNotice(page)
            await page.keyboard.press('Enter') //提交 → 草稿
            await waitUntilExist(page, 'Enter 後草稿成立: 儲存鈕出現', () => !!document.querySelector('[data-fmid="members-save-btn"]'), { timeout: 8000 })
            await page.waitForTimeout(500)
            assert.strictEqual(await gridCellText(page, await rowIndexByText(page, 'memberId', 'agent-demo'), 'role'), draftB, '(二) Enter 提交之草稿保留')
            assert.ok(await page.locator('[data-fmid="draft-stale-notice"]').count() > 0, '(二) 草稿成立後提示條仍在')
            assert.ok(!(await page.evaluate(() => document.querySelector('.ag-root-wrapper').innerText)).includes(otherB), '(二) 草稿期間畫面不顯示他人新增之成員')
            await page.locator('[data-fmid="members-save-btn"]').first().click()
            await waitRejectDialog(page, tSaveStale)
            await clickConfirmBtn(page, ok)
            let after = await page.evaluate(async (cid) => (await window.$vo.$fapi.getChannelMembers(cid)).map((m) => ({ memberId: m.memberId, role: m.role })), CH_DEMO_ID)
            assert.strictEqual(after.find((m) => m.memberId === 'agent-demo').role, origRole, '(二) 被拒後 agent-demo 角色不得被寫入')
            assert.ok(after.some((m) => m.memberId === otherB), '(二) 他人新增之成員保留')
            return [
                { name: 'E2E-017-1-editor-kept', buf: s1 },
            ]
        },
        semantic: async (page) => {
            //spec E2E-017 驗證(6)：後端終態——agent-demo 與他人兩次新增之成員共 3 位, 本人輸入之角色文字未寫入
            let rs = await page.evaluate(async (cid) => { let r = await window.$vo.$fapi.getChannelMembers(cid); return r.map((m) => ({ memberId: m.memberId, role: m.role })) }, CH_DEMO_ID)
            assert.strictEqual(rs.length, 3)
            assert.ok(rs.every((m) => !/^typed-role-/.test(m.role || '')), '本人輸入之角色文字不得寫入')
        },
    },
]

//單一案例管線（產製端與比對端共用, runBaselineCase）：
//  prepare（per-case reseedBackend → case 專屬 arrange）→ launch（per-case fresh browser）→ openPage（openApp）→ beforeRun（setLang）
//  → run（流程＋截圖）→ semantic（語意斷言, 寫檔／比對前必過）→ 產製端依 gate 寫檔 / 比對端 assertBaselineMatch → finally 關瀏覽器。
//前置順序以原產製端為準（reseedBackend → arrange → launchBrowser）; 原比對端為 beforeEach 之 reseedBackend → launchBrowser 後才於 it 內 arrange。
async function runCase(mode, lang, c, extra = {}) {
    return await runBaselineCase({
        mode,
        lang,
        name: c.name,
        run: c.run,
        stages: c.stages,
        allowEmpty: !!c.allowEmpty,
        semantic: c.semantic ? (ctx) => c.semantic(ctx.page, ctx.lang) : null,
        launch: launchBrowser, //per-case fresh browser（每 case 全新 browser 進程, 消 cross-case GPU/font/CSS cache 累積差異）
        openPage: (browser) => openApp(browser), //runBaselineCase 以 (browser, ctx) 呼叫; openApp 之第二參數為 newContext 選項, 不可傳入 ctx
        pathOf: picPath,
        labelOf: (lg, key) => `channeltask-${lg}-${key}`,
        match: assertBaselineMatch,
        prepare: async () => {
            await reseedBackend() //per-case reseed：還原 pristine demo 種子, 消除 E2E-003 發訊副作用對後續 case 之污染
            if (c.arrange) {
                await c.arrange() //case 專屬前置（如 E2E-013 封存種子; 須在 openApp 前, backend 重啟不影響尚未連線之 browser）
            }
        },
        beforeRun: async (ctx) => {
            await setLang(ctx.page, ctx.lang) //eng 也走（symmetric, 補等同 cht setLang 之 settle）
        },
        ...extra,
    })
}

async function generateBaseline() {
    console.log('=== 產製 channeltask baseline 開始 ===')
    process.env.E2E_STRICT_CAPTURE = '1' //產製端 captureStable 未 settle 即拋錯, 不寫未穩定畫面（比對端不設: 回傳最後一張交由比對揭露 flake）
    //截圖前篩選（--names / --langs / --write-mode / E2E_BASELINE_OUT_DIR）; 不符任何鍵即於此報錯（先於 ensureUploadPng 與 startServersOnce）
    let gate = createBaselineGate({ langs: LANGS, cases: CASES })
    console.log(gate.describe())
    ensureUploadPng() //E2E-006 上傳用之本地暫存 PNG（setup 階段準備）
    await startServersOnce()
    fs.mkdirSync(PICS_DIR, { recursive: true })
    for (let lang of gate.langs) {
        for (let c of gate.casesFor(lang)) {
            console.log(`  ${lang}-${c.name}`)
            let r = await runCase('regen', lang, c, { gate })
            console.log(`  ✔ ${lang}-${c.name} (寫出 ${r.written.length} 張, 略過 ${r.skipped.length}, 保留 ${r.kept.length})`)
        }
    }
    //--names 之任一項未產出即報錯（不靜默略過; 例: 指定之案例於本輪未產出任何圖）
    gate.finalize()
    cleanup() //【必】非 mocha 環境須顯式呼叫, 否則 process 不退
    console.log('=== 產製 channeltask baseline 完成 ===')
}

if (isBaseline) {
    generateBaseline().catch((err) => {
        console.log('baseline 例外', err)
        cleanup()
        process.exit(1)
    })
}
else {
    for (let lang of LANGS) {
        describe(`e2e-channeltask (${lang})`, function() {
            this.timeout(180000)
            before(async function() {
                this.timeout(220000)
                ensureUploadPng() //E2E-006 上傳用之本地暫存 PNG（setup 階段準備）
                await startServersOnce() //首次呼叫起本 harness 自建之測試實例並重建 base seed；本行程已起則沿用（port 被他者佔用即拋錯）
            })
            //per-case reseed + fresh browser + setLang 由 runCase 負責（原 beforeEach 之 reseedBackend／launchBrowser 與 afterEach 之 browser.close 已移入）,
            //確保 --grep 單跑與全跑一致; 語意斷言在比對標準圖之前（pixel baseline 為補強層）
            for (let c of CASES) {
                it(c.name, async function() {
                    await runCase('compare', lang, c, { onKnownDefect: () => this.skip() }) //已知缺陷協定: 標 pending(提示框殘留已由 w-component-vue 2.5.24 修正, 其偵測改為直接失敗, 見 e2e-setup probeStuckTooltip)
                })
            }
        })
    }
}
