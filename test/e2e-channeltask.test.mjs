//頻道任務調度 e2e（v2 聊天式工作區 UI）。對應 spec/流程_頻道任務調度.md。
//雙模式：
//  - 產 baseline：node test/e2e-channeltask.test.mjs --baseline （寫 test/pics/channeltask/）
//  - 驗證（mocha）：npx mocha test/e2e-channeltask.test.mjs --reporter list （pixelmatch 反鋸齒感知 + maxDiffPixels 容差，非 byte-exact）
//act 走 user-facing input（rail nav 真實滑鼠座標點擊 / 頻道列真實點擊 / Pattern D 鍵盤輸入）；
//assert = UI 語意斷言 + pixel baseline（§6.2 / §6.3）。
//
//baseline 確定性：demo 種子之 messages / tasks / channels 時間欄位皆為固定字串（見 g.initialData.mjs），
//UI 顯示之時間戳跨次 seed 完全一致 → pixel baseline 穩定。頻道名 / levels 為資料（恆中文），雙語下相同；
//雙語 baseline 之差異僅在 i18n chrome（rail 標籤 / 標題 / pills / 按鈕 / grid 表頭）。
//唯一帶 live 時間戳之 case 為 E2E-003（真實發訊），其視覺 baseline 改框「composer 發訊區」並於送出前截圖（避開 live 時間戳區）。
//
//DB 採 per-case reseed（§role-code-for-test-e2e「DB = per-case」hermetic 標準）：每 case beforeEach 還原 pristine demo 種子，
//故 E2E-003 發訊副作用不會污染後續 case（如 E2E-004 stats 之訊息計數），spec bullet 順序 / 檔案排序 / 執行順序三者一致且安全。
import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { PNG } from 'pngjs'
import { startServersOnce, reseedBackend, cleanup, launchBrowser, openApp, captureStableWithBox, waitUntilExist, assertBaselineMatch } from './e2e-setup.mjs'

const PICS_DIR = './test/pics/channeltask'
const LANGS = ['eng', 'cht']
const isBaseline = process.argv.includes('--baseline')

//E2E-006 上傳用之本地暫存 PNG（setup 階段準備之檔案; act 為點附圖鈕觸發 file input 後以 setInputFiles 選此檔）。
//內容為確定性圖樣（固定 48×48 對角漸層）, 但其 file id / 時間戳於上傳後為 live 值, 故不對含此 img 之時間軸做 pixel baseline。
const UPLOAD_PNG = './tmp/e2e-up.png'
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
const SEL_TREE = '[data-fmid="channel-tree"]'          //左2 頻道階層樹（含標題 + 搜尋 + 樹）
const SEL_TIMELINE = '[data-fmid="chat-timeline"]'     //聊天時間軸（訊息氣泡）
const SEL_COMPOSER = '[data-fmid="composer"]'          //底部 composer 發訊區（textarea + 工具列 + 送出鈕）
const SEL_STATS_OVERVIEW = '[data-fmid="stats-overview"]' //統計 OVERVIEW 卡片區（CHANNELS/MESSAGES/TASKS）
const SEL_GRID = '.ag-root-wrapper'                    //後台 Channels ag-grid
const SEL_MEMBERS_DIALOG = '[data-fmid="channel-members-dialog"]' //本頻道成員管理 dialog（成員清單 grid）
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
async function clickRail(page, key) {
    let sel = `[data-fmid="rail-nav-${key}"]`
    await waitUntilExist(page, `rail nav「${key}」就緒`, (s) => {
        let e = document.querySelector(s)
        if (!e) { return false }
        let r = e.getBoundingClientRect()
        return r.width > 0 && r.height > 0
    }, { timeout: 15000, arg: sel })
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

//case 定義：run(page,lang) 走流程並回傳截圖 buffer（或多階段 [{name,buf}]）；mocha 模式再加語意斷言。
const CASES = [
    {
        //E2E-001：登入後預設停在頻道區, 階層頻道樹顯示專案 > 群組 > #頻道
        name: 'E2E-001-channels-tree',
        run: async (page) => {
            await waitTreeReady(page) //預設 section=channels, 等樹渲染到位
            return await captureStableWithBox(page, SEL_TREE) //觀看區：頻道階層樹
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
        name: 'E2E-002-chat-view',
        run: async (page) => {
            await gotoChat(page)
            return await captureStableWithBox(page, SEL_TIMELINE) //觀看區：訊息時間軸
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
        name: 'E2E-004-stats',
        run: async (page) => {
            await clickRail(page, 'stats') //真實點擊 rail 之 Stats nav
            await waitUntilExist(page, '統計 OVERVIEW 區就緒', () => {
                let e = document.querySelector('[data-fmid="stats-overview"]')
                if (!e) { return false }
                let r = e.getBoundingClientRect()
                return r.width > 0
            }, { timeout: 20000 })
            await page.waitForTimeout(500)
            return await captureStableWithBox(page, SEL_STATS_OVERVIEW) //觀看區：OVERVIEW 卡片區
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
        name: 'E2E-005-admin-channels',
        run: async (page) => {
            await clickRail(page, 'admin') //真實點擊 rail 之 Admin nav
            //預設子頁為 Channels（AdminView subKey='mmChannels' → LayoutContentChannels）, 等 grid 列出現
            await waitUntilExist(page, '後台頻道 grid 列載入', () => document.querySelectorAll('.ag-row').length > 0, { timeout: 20000 })
            await page.waitForTimeout(500)
            return await captureStableWithBox(page, SEL_GRID) //觀看區：後台頻道 grid
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
        //語意-only（run 回 [] 不產 baseline）：消毒為 DOM 語意性質, 視覺上「已消毒」與「未消毒」之純文字渲染無從以 pixel 區辨,
        //且發訊後訊息帶 live 時間戳無穩定視覺可比; composer/時間軸之視覺 baseline 已由 E2E-002/E2E-003 覆蓋。
        //eng/cht 皆跑（消毒與語系無關, 兩語系下皆須成立）。
        name: 'E2E-007-xss-sanitized',
        run: async (page) => {
            await gotoChat(page)
            await page.evaluate(() => { window.__xss7 = undefined }) //清旗標, 供「onerror 是否執行」判定
            //惡意 payload：onerror 於 <img src=x> 載入失敗時觸發 → 未消毒則 window.__xss7=1; 'hello-xss-text' 為內容保留之探針
            let payload = '<img src=x onerror="window.__xss7=1">hello-xss-text'
            await typeIntoTextarea(page, payload) //Pattern D 真實鍵盤輸入（含角括號之原始 HTML）
            await page.locator('[data-fmid="composer-textarea"]').first().click()
            await page.keyboard.press('Enter') //真實 Enter 送出
            await waitUntilExist(page, '惡意訊息之文字探針渲染進時間軸', () => (document.body.innerText || '').includes('hello-xss-text'), { timeout: 15000 })
            await page.waitForTimeout(600) //予 img 載入失敗 + (若未消毒) onerror 觸發之時間窗, 確保負向斷言有效
            return [] //語意-only, 不產 baseline
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
        run: async (page, lang) => {
            await gotoChat(page)
            //act(R)：真實點擊標題列「成員」入口 → 開本頻道成員管理 dialog
            await page.locator('[data-fmid="chat-head-members-btn"]').first().click()
            await waitUntilExist(page, '成員 dialog + agent-demo 列載入', () => {
                let el = document.querySelector('[data-fmid="channel-members-dialog"]')
                return !!el && (el.innerText || '').includes('agent-demo')
            }, { timeout: 20000 })
            await page.waitForTimeout(400)
            //視覺 baseline：view 模式之成員 dialog（agent-demo 一列; 觀看區紅框）
            let shot = await captureStableWithBox(page, SEL_MEMBERS_DIALOG)

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
        run: async (page) => {
            await clickRail(page, 'admin') //真實點擊 rail 之 Admin nav
            await waitUntilExist(page, '後台任務子頁鈕就緒', () => !!document.querySelector('[data-fmid="admin-sub-mmTasks"]'), { timeout: 20000 })
            await page.locator('[data-fmid="admin-sub-mmTasks"]').first().click() //真實點擊「任務」子頁
            await waitUntilExist(page, '後台任務 grid 種子任務載入', () => (document.body.innerText || '').includes('Summarize quarterly report'), { timeout: 20000 })
            await page.waitForTimeout(500)
            return await captureStableWithBox(page, SEL_GRID) //觀看區：後台任務 grid
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
        run: async (page) => {
            await clickRail(page, 'admin') //真實點擊 rail 之 Admin nav
            await waitUntilExist(page, '後台成員子頁鈕就緒', () => !!document.querySelector('[data-fmid="admin-sub-mmMembers"]'), { timeout: 20000 })
            await page.locator('[data-fmid="admin-sub-mmMembers"]').first().click() //真實點擊「成員」子頁
            await waitUntilExist(page, '後台成員 grid 載入 agent-demo', () => (document.body.innerText || '').includes('agent-demo'), { timeout: 20000 })
            await page.waitForTimeout(500)
            return await captureStableWithBox(page, SEL_GRID) //觀看區：後台成員 grid
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
        //  直寫一筆固定種子封存任務（'Archived quarterly summary', 見 test/seed-archived-task.mjs）。此前置在 openApp 前執行,
        //  故 arrange hook 置於 it()/generateBaseline 之 openApp 之前; 封存種子於下一 case reseed(rm ./db) 自動清除。
        //視覺 baseline 對「後台任務 grid（顯示封存啟用態, 列封存任務）」截圖（種子時間戳固定 → 穩定）。
        //清理：唯讀切換無資料副作用; arrange 寫入之封存種子由 per-case reseed 還原。
        name: 'E2E-013-tasks-archived',
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
            //視覺：後台任務 grid（顯示封存啟用態, 列封存任務）
            return await captureStableWithBox(page, SEL_GRID)
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
]

//手術式重產（§6.3）：--names a,b,c 只產指定 case；--langs eng,cht 只產指定語系。截圖「前」就 gate（省截圖成本）。
function argList(flag) {
    let i = process.argv.indexOf(flag)
    if (i >= 0 && process.argv[i + 1]) { return process.argv[i + 1].split(',').map((s) => s.trim()).filter(Boolean) }
    return null
}
function nameMatch(list, caseName) { return list.some((nm) => caseName === nm || caseName.startsWith(nm)) }

async function generateBaseline() {
    console.log('=== 產製 channeltask baseline 開始 ===')
    let onlyNames = argList('--names')
    let onlyLangs = argList('--langs')
    ensureUploadPng() //E2E-006 上傳用之本地暫存 PNG（setup 階段準備）
    await startServersOnce()
    fs.mkdirSync(PICS_DIR, { recursive: true })
    for (let lang of LANGS) {
        if (onlyLangs && !nameMatch(onlyLangs, lang)) { continue } //§6.3 手術式：跳過未指定語系
        for (let c of CASES) {
            if (onlyNames && !nameMatch(onlyNames, c.name)) { continue } //§6.3 手術式：截圖前 gate
            await reseedBackend() //per-case reseed：還原 pristine demo 種子, 消除 E2E-003 發訊副作用對後續 case 之污染
            if (c.arrange) { await c.arrange() } //case 專屬前置（如 E2E-013 封存種子; 須在 openApp 前, backend 重啟不影響尚未連線之 browser）
            //per-case fresh browser（每 case 全新 browser 進程, 消 cross-case GPU/font/CSS cache 累積差異）
            let browser = await launchBrowser()
            let page = await openApp(browser)
            await setLang(page, lang) //eng 也走（symmetric, 補等同 cht setLang 之 settle）
            let shots = await c.run(page, lang)
            if (Buffer.isBuffer(shots)) { shots = [{ name: c.name, buf: shots }] }
            for (let s of shots) {
                fs.writeFileSync(picPath(lang, s.name), s.buf)
                console.log('wrote', picPath(lang, s.name), s.buf.length, 'bytes')
            }
            await browser.close()
        }
    }
    cleanup() //【必】非 mocha 環境須顯式呼叫, 否則 process 不退
    console.log('=== 產製 channeltask baseline 完成 ===')
}

if (isBaseline) {
    generateBaseline().catch((err) => { console.log('baseline 例外', err); cleanup(); process.exit(1) })
}
else {
    for (let lang of LANGS) {
        describe(`e2e-channeltask (${lang})`, function() {
            this.timeout(180000)
            let browser = null
            before(async function() {
                this.timeout(220000)
                ensureUploadPng() //E2E-006 上傳用之本地暫存 PNG（setup 階段準備）
                await startServersOnce() //port 已起→reuse；DB 由 startServersOnce 之 seedDb 重建為 base seed
            })
            //per-case fresh browser + per-case reseed（§role-code-for-test-e2e: browser/DB 皆 per-case）
            beforeEach(async function() {
                this.timeout(90000)
                await reseedBackend() //per-case 還原 pristine demo 種子（消 E2E-003 發訊副作用; 確保任一 case 單跑 / 全跑一致）
                browser = await launchBrowser()
            })
            afterEach(async function() { if (browser) { await browser.close(); browser = null } })
            for (let c of CASES) {
                it(c.name, async () => {
                    if (c.arrange) { await c.arrange() } //case 專屬前置（如 E2E-013 封存種子; 在 openApp 前執行, backend 重啟不影響尚未連線之 browser）
                    let page = await openApp(browser)
                    await setLang(page, lang)
                    let shots = await c.run(page, lang)
                    if (c.semantic) { await c.semantic(page, lang) }
                    if (Buffer.isBuffer(shots)) { shots = [{ name: c.name, buf: shots }] }
                    for (let s of shots) {
                        assertBaselineMatch(s.buf, picPath(lang, s.name), `channeltask-${lang}-${s.name}`)
                    }
                })
            }
        })
    }
}
