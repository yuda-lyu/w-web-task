# 累積經驗

本檔為執行工作時特有之累積經驗,留給後續之嘗試、執行與判斷,由agent自行編列、擴充與維護.

體例: 每一事件一節, 標題附絕對日期; 內容以 徵狀 → 成因(附 `file:line` 或實測)→ 判別 → 教訓 為序. 規則本身記於 `sgud/rule/rulebook.md`, 處理流程記於 `sgud/proc/process.md`, 決策記於 `spec/設計要點與取捨.md`.

## 權杖外洩修正(2026-09-25, D15; 四 repo 方案見 w-web-sso ADR-068)

- **範圍**: 四個注入函數(`getUserByToken` / `verifyClientUser` / `verifyAppUser` / 選填 `getUserById`; 第四個於 2026-10-14 隨 w-serv-orm 移除, 改於入口拒絕, 見下方 D17 一節)改經 `server/wrapInjected.mjs` 包裝(失敗只回自家 key)、印權杖改經 `server/maskLog.mjs`、`getUserIdByToken` 改 fail-closed; 新增 `unit-maskLog`(24)、`unit-wrapInjected`(16)、`api-tokenLeak`(10), 皆先紅後綠.
- **紅燈要能重現外洩, 先備好夾具**: 本 repo 預設 `ssoAppToken` 空, 未知 token 只回 `{}`, 回應與 srLog 本來就不含秘密——直接跑新測試會「修正前即綠」. 須先在 `srv.mjs` 加測試權杖(`{token-for-reject}` 以舊版 sso helper 形狀之字串 reject、`{token-for-verify-throw}` 使 verify 系拋錯, 皆受 `NODE_ENV` 守門), 再對未改之 `server/` 跑紅.
- **包裝與 fail-closed 必須成對**: 只加 `wrapInjected`(失敗 → `null`)而不改 `getUserIdByToken`, 會從「偶然 fail-closed(例外中斷)」變成「`userId=''` 照樣執行」(fail-open). 驗 fail-closed 之紅燈要用「查無」(回 `{}`)之 token.
- **外部因素**: 驗證期間 e2e 一度 25 / 26(E2E-008 eng 之後端消失)——同機 w-web-perm 之測試框架重建種子時殺掉整台機器命令列含 `srv.mjs` 之 node; 不改碼、不放寬斷言, 重跑 26 / 26. 同型之「harness 越權殺行程」於 2026-09-27 被正式回報後, 本專案據以盤查並重寫自身 harness(下節).

## e2e / api harness 行程所有權重寫(2026-09-27; 規則見 rulebook「e2e harness 行程所有權」)

- **起因**: 業主轉述他 agent 記下之待修缺陷「e2e-setup.mjs 在重建種子資料時, 會殺掉整台機器所有 srv.mjs」, 要求查本專案是否也如此. 處理不是只查「殺全機」這一句, 而是把 harness 對行程之五類入口(啟動 / 沿用 / 重建種子 / 重啟 / 清理)兩個方向(越權殺他人 / 失職留殘留)全部列表盤查; 方案先對標 sso / perm / api 之既有作法, 經三方獨立複審後定案實作(own 政策: 只用自建、port 被佔即拋錯、跨行程互斥).
- **殭屍後端使健康檢查假陽性**: `srv.mjs` 之 listen 失敗(EADDRINUSE)只印錯誤不退出(15 秒後仍存活), 且已持有 lmdb; 舊 harness 以「TCP 可連」判就緒, 而 port 其實由先前之實例回應. 教訓: 就緒須核對 LISTENING PID 屬自建 child, 並以輸出字樣判綁定失敗(`test/tools/harnessLifecycle.mjs:16-21`).
- **lmdb 被持有時 rm 只刪一部分**: 對開著的 `./db` 執行 `rmSync(recursive, force)` 會 EPERM 但非全部失敗——實測某表整個被刪、其餘留存, 種子因此非 hermetic 卻只印警告照跑. 教訓: 整個目錄先 rename 移開(有人持有即整體失敗、不動任何檔), 移不開就拋錯, 不警告續跑.
- **非同步殺行程後立即退出會留孫行程**: `spawn('cmd', ['/c', 'taskkill', …])` 為非同步, exit / SIGINT 路徑殺完即 `process.exit()`, 前端孫行程(npm → vue-cli-service)4 秒後仍監聽. 教訓: 結束路徑之殺行程一律同步並回驗.
- **vue-cli-service 三個判讀陷阱**: ①portfinder 見 port 被佔會靜默改綁下一個空 port, 實際 port 以輸出之 `Local: http://…:<port>/` 為準; ②編譯失敗(`Failed to compile`)時 dev server 照樣回應 HTTP, 就緒須等 `App running at` / `Compiled with N warning`(本專案有 1 個 warning, 不會出現 `Compiled successfully`); ③以 `spawn('node')` 經 PATH 會受 shim 影響 PID 與版本, 改用 `process.execPath` 且直接跑 `vue-cli-service.js`(不經 npm / shell), 使前端為本行程之直接子行程.

## e2e 改用 w-web-sso srcPack 與全量重產(2026-09-28)

- **徵狀(盤點發現)**: 本專案 e2e 為裸 `chromium.launch`(無確定性渲染旗標)、無 `strict` 截圖、紅框為 DOM 注入之 position:fixed 框(技能 §8.3 / §8.4 缺口); `waitUntilExist` 有 6 處(E2E-008 / 012)傳入 async 判斷式.
- **async 判斷式從未等待**: `page.waitForFunction` 把 async 函數回傳之 Promise 當 truthy, 立即放行——這 6 處自寫成以來實際沒有等到後端狀態. srcPack `waitUntilExist` 改以 `AsyncFunction` 判別、逐次 `page.evaluate` 輪詢後才真正生效. 教訓: 等待 helper 要測「條件不成立時確實會等」, 不能只測成立時會過.
- **紅框框進大片空白**: 全量重產後審圖發現頻道樹、時間軸、後台表格之框為「整個面板 / 整個表格外框」, 列少時框進大片空白(技能 §7.3-2); 改以 `itemsUnionBox`(樹之 `.tnode, .chan`、時間軸之 `.day, .msg`)與 `gridContentBox`(標頭＋可見資料列)框實際內容. 此類缺陷促成 srcPack `auditBoxes` 之空白框掃描; 複掃本專案 30 張無框 0, `cut` / `touch` 旗標經逐類目視皆為元素本身貼框.
- **「每步兩張」第 1 期**: E2E-002 / 004 / 005 改點擊前(`-1-click-*`)與點擊後(`-2-*`)兩張, 舊鍵圖刪除; 第 2 期見 rulebook「已知缺口」.

## 搬入 `test/tools/` 後臨時資料落錯位置(2026-09-28 搬移, 2026-09-29 修正)

- **徵狀**: `npm test` 跑完後出現 `test/tools/_tmp/`(未 gitignore, `git status` 可見).
- **成因**: `e2e-setup.mjs` 由 `test/` 搬入 `test/tools/` 時, `TMP_DIR` 沿用 `join(__dir, '_tmp')`, 實際落點變成 `test/tools/_tmp`; `seed-archived-task.mjs` 之相對 import 同樣少一層.
- **修正**: `TMP_DIR = join(__dir, '..', '_tmp')`(`e2e-setup.mjs:63`)、seed 腳本 import 改 `../../`; 再跑 `npm test` 確認 `test/tools/_tmp` 不再出現.
- **教訓**: 搬移檔案時, 所有以 `__dir` / `import.meta.url` 組出之路徑與相對 import 都要逐一重算並實跑確認落點(全域 §11.4); 另 `git grep` 不搜未追蹤之檔, 搬移後未提交前以 Grep 工具盤查.

## 固定等待盤點(2026-09-29)

- srcPack `tools/auditWaits.mjs` 掃出本專案 26 處 `waitForTimeout`(A17 / L2 / D3 / R1 / E3; 2026-09-29 重跑相同), 逐一判讀: A 類為偵測後之 settle、L 為輪詢間隔、E 三處為 ag-grid 編輯器掛載 settle、Enter 提交後 settle、`openApp` 遇 context destroyed 之重試前等待——前一動作到預期狀態之間皆已有偵測或屬技能 §4.4 允許之 settle, 不需改.

## 後台任務詳情面板開啟時整頁溢出 25px(2026-09-28 觀察, 2026-09-29 修正)

- **徵狀**: E2E-012 標準圖(兩語系)頂端之 rail 圖示與頁面標題被裁、底部出現 25px 白條——整頁被捲動 25px; 其餘 28 張 rail 底部皆無白條(掃描 rail x=10 之深色最低列).
- **處置之錯**: 2026-09-28 審圖時已看到此現象, 卻記為「觀察, 本輪不改產品」. 這是使用者可見之缺陷(照圖操作之讀者會看到裁切與白條, 實機則出現整頁捲軸), 依業主「潛在缺陷都修、該改圖的就改」應當輪修正; 不得以「不在本輪範圍」擱置.
- **成因**: `src/components/LayoutContentTasks.vue:119`(修正後 `:120`)詳情面板以計算值 `detailHeight`(＝面板總高 − 頭部 − 清單)設 `height`, 同一 style 又帶 `padding:12px 18px` 與 `border-top:1px`, 且未設 `box-sizing:border-box`(全站無全域 box-sizing)——實際高度多出 12＋12＋1＝25px, 與溢出量相等. 同型問題本 repo 已修過兩處(`Composer.vue:513`、`ChannelTree.vue:315` 之 `box-sizing: border-box`).
- **實測(探測腳本, 以 harness 起測試實例, 1440×900 / 1280×720 / 1024×768 / 390×844 × 三筆任務)**: 修正前面板設定高 389px、實高 414px、底緣 925 > 視窗 900(各尺寸皆多 25px; 窄版 390×844 底緣 869); 文件本身不捲動(`scrollHeight − clientHeight` = 0), 故一般使用下是**面板內捲動區最末 25px 永遠看不到**; e2e 之紅框 helper 對面板 `scrollIntoView` 時把隱藏溢出之容器捲了 25px, 才在圖上呈現 rail 被裁與底部白條. 修正後 12 個狀態之實高皆等於設定高、底緣皆等於視窗高.
- **修正與改圖**: `LayoutContentTasks.vue` 詳情面板之 style 補 `box-sizing:border-box`; 以 `--baseline --names E2E-012` 重產兩語系(其餘 28 張 mtime 未動). 新舊圖比對: 新圖面板以上區域與舊圖平移 25px 後, 679,680 像素中僅 5 點不同(皆為舊圖被裁切之 logo 邊緣列), 即舊圖之差異純為整頁被捲; 新圖 rail 延伸到底、頁首完整、紅框恰框整個面板(505～896)、兩語系框位相同.
- **判別**: 以計算高度排版之容器, 只要 style 同時有 padding / border, 就要 `box-sizing:border-box`; 盤點指令 `git grep -n 'height:\${' -- src`, 逐一看同一 style 是否帶 padding / border(2026-09-29 全站只有此一處). 另: 文件層 `scrollHeight` 為 0 不代表沒溢出——`overflow:hidden` 之祖先會把溢出藏起來, 要量元素底緣是否超出視窗.

## E2E-007 補圖與假時鐘(2026-09-29, 業主裁示補圖)

- **原載理由拆開看**: E2E-007 原為語意-only, 理由兩條——「送出後訊息帶即時時間戳」與「已消毒與未消毒之像素無從區辨」. 前者不是不拍之理由(技能 §7.1: 非決定性以假時鐘處理); 後者仍成立, 但只代表「安全性要由語意斷言判定」, 不代表手冊不需要圖. 改為三張: 輸入前(框輸入框整顆)、輸入後兼作送出前(框發訊區)、送出後(框新訊息).
- **假時鐘放在寫入函數層**: 追寫入點——畫面時間欄全由本專案經 `wsemi/src/nowms2str.mjs` 寫入(`server/procCore.mjs`、`src/schema/tables/*.mjs`), 後端依賴套件原始碼無 `new Date()`. 以 Node 模組解析 hook(`node --import test/tools/fakeNow/register.mjs`, 內以 `module.register` 註冊)只把「本專案 `server/` 與 `src/` 所 import 之該模組」導向替身, 比攔全域 `Date` 範圍精準: srLog 時間與套件內部照常; 替身讀標記檔決定是否固定, 可逐案開啟.
- **hook 之比對細節**: parentURL 為 percent-encoded 之 file URL(路徑含中文時 `開源` 會編碼), 比對前綴以 `pathToFileURL` 產生並一律轉小寫(磁碟機代號大小寫); 替身自身 import 真實版時 parentURL 在 `test/tools/fakeNow/`, 不會被再導向.
- **標記檔之生命週期**: 開啟於送出前、`finally` 關閉; 另於 `startServersOnce()` 與 `reseedBackend()` 開頭再關一次——前次被中斷之執行可能留下標記檔(harness 目錄只在正常收尾時刪), 不關就會讓 api 測試與後續案例意外吃到固定時間.
- **就緒訊號兼驗假時鐘**: 送出後等「時間軸出現錨點字串」再截圖; hook 若失效, 此等待逾時即拋錯, 不會把真實時間凍進標準圖.

## 按鈕雙擊防護補齊(2026-09-29, D16; 四專案同一原則見 w-web-sso ADR-074)

- **「前端層已擋雙擊」之舊判斷不成立**: rulebook 原記「前端層(promiseUnlock + loading)已擋雙擊」, 但 handler 第一行即 `pm.resolve()` 使按鈕鎖立即解除, 全頁 loading 與確認 / 結果框又不搶焦點, 焦點留在按鈕時鍵盤連按照樣送出(w-web-sso 以同一元件庫實測). 教訓: 「某層已擋」須以滑鼠與鍵盤兩種輸入各驗一次, 不以滑鼠雙擊被遮罩擋下就推論全擋.
- **cacheSt 不可建於 procCore**: wsemi `cacheSt()` 內含未 unref 之 `setInterval`(TTL 偵測), 建於 procCore 會使 unit 測試建構後 mocha 不結束(本專案 `test` 無 `--exit`), 且違反 D12「procCore 不放 timer」. 改於 `WWebTask.mjs` 建立後經 deps 注入(同 kmx); unit 測試自建並於 `after` 呼叫 `clear()`.
- **同一列之兩個「確保存在」路徑要共用同一把鎖**: `saveChannel` 確保主責 agent 成員列與 `ackChannel` 缺列 insert 寫同一 (channelId, memberId) 列; 各自加鎖(不同 key)仍會並行各建一列. 以「修正前等價依賴」(kmx 不序列化、lockSave 直接執行)重跑 6 個並行情境, 全部重複建列(2 列)且無一被拒——含「saveChannel 設 agentId 與該 agent 之 ack 並行」, 故採共用 key `channelMember:<channelId>:<memberId>`.
- **並行單元測試要結果確定**: 兩次呼叫於同一同步區段發起(`Promise.allSettled([f(), f()])`), lockSave 之占位於呼叫當下同步取得, 故第 2 次必被拒; 「先 select 後 insert」之競態以慢速 mock 表(每次存取讓出 5ms)使窗口必定重疊, 未序列化即重複建列. 如此先紅後綠不依賴機器快慢.
- **unit-procCore 須以專案根為 cwd**: procCore 建構時以 cwd 相對路徑確保 `./dbf`; 自他處(如姊妹專案)以絕對路徑跑 mocha 會在該處建出 `dbf/`. 以 `spawnSync(..., { cwd: 專案根 })` 執行, 不用 cd.
- **訊息框單例**: `Common/CheckYesNo.vue` 與 `Common/CheckYes.vue` 皆為單例, 修正前 `show()` 直接覆寫 pm, 被取代之流程永不 settle. WConfirm 以 header slot 覆寫掉 WDialog 預設標頭(無關閉鈕)、`isModal` 預設 true(點背景只振動)、無 ESC 處理, 故單一框之 pm 只由按鈕 settle; 但訊息框開啟中若另一流程開框(鍵盤 Enter 可觸發背後另一按鈕), 前一流程即永久等待、其 runSubmit 占位永不釋放. 教訓: 流程狀態涵蓋到對話框關閉時, 單例對話框必須在 `show()` 開頭先 settle 前一個等待者(結果框視同按確定、確認框視同選否, 2026-09-29 與 w-web-sso 同步修正); 「單一框只由按鈕 settle」不足以推論「包進 runSubmit 不會懸置」, 要把「框被另一框取代」也列入終止路徑.

## 相依升版使後端無法啟動; 資料通道授權閘與 w-serv-orm 三鍵清理(2026-10-14, D17)

- **徵狀**: 主控更新自有相依(w-serv-hapi 1.1.6、w-serv-webdata 1.1.12、w-serv-orm 1.1.10 等)後 `npm test` 181 passing / 6 failing, 6 筆皆為 api 四檔與 e2e 兩語系之 `before all`: 測試後端起不來, 73 案未執行.
- **成因**: w-serv-webdata 1.1.7 起 `useDbOrm: true` 時 `authorizeExec` 必填, w-serv-hapi 1.1.6 起整包同步轉交 → WWebTask 建構即拋 `invalid opt.authorizeExec when useDbOrm=true`. 同輪之 w-serv-orm 三鍵與之無關; 由 w-serv-orm 端寫之建議書只看 w-serv-orm, 判「建構照常」只對 w-serv-orm 成立.
- **判別**: harness 錯誤附帶之後端輸出即有拋錯堆疊(套件層級一目了然); 升版查核要用真實入口實際啟動, 只比對我方傳入之 opt 鍵看不到下游新增之必填鍵(process「自有套件升級之查核」).
- **遮蔽之失敗**: 修正前無從得知被阻斷之 73 案是否另有失敗. 以修正原型實跑全套: 原型放 `./tmp/`(由現行碼以腳本產生, 相對 import 改指真實模組), 以 `NODE_OPTIONS=--import=<註冊檔>` 之模組解析 hook 只把 `srv.mjs` 所 import 之 `./server/WWebTask.mjs` 導向原型, harness 起之後端經 env 繼承同一 hook, 假時鐘 hook 照常作用. 結果 254 / 254, 確認無其他遮蔽之失敗——不改受追蹤檔即可回答「修好阻斷後還會不會壞」.
- **資料通道之兩個授權缺口(以真實 WServHapiClient 探針實證)**: ①表操作開 insert / save / del, 已認證者可直寫 / 直刪 channels、channelMembers, 繞過同表 kpFunExt 路徑之 D16 lockSave、確保成員列 kmx 與 D7 游標身分(直刪頻道後成員列成孤兒); 前端與 agent 從不使用直寫. ②連線閘只認證, 被 verifyClientUser 拒絕者 UI 進不去, 卻可經資料通道呼叫全部 kpFunExt(含寫入). 修正: 表操作只開 select + `server/authorizeExec.mjs`; 連線閘於 getTokenUser 之後呼叫已包裝之 verifyClientUser. 教訓: 「授權屬套件使用者責任」之註解要對照部署方提供之授權函數**實際作用於哪些入口**; 同一張表有兩條寫入路徑時, 規則(占位、鎖、身分)必須兩條都有, 否則關掉其一.
- **修前紅燈之取得**: 現行碼因阻斷起不來, api 測試之紅燈成因不對; 以 B2(authorizeExec 恆 true、methodsExec 不變 = 升版前之授權面)為修前對照之暫態, 快照至 `./tmp/run03/s1/` 以 hook 執行, 工作樹同時推進至最終態, 不需在受追蹤檔留中間態.
- **C1 之連帶**: verifyClientUser 改為每次資料通道請求皆呼叫(前端每 2 秒輪詢), 參考入口 `srv.mjs` 原於其內 `console.log` 使用者物件 → 每 2 秒洗版並印個資; 比照 w-web-perm 之 `srv.mjs` 註解掉(verifyAppUser 對稱同改).
- **建構失敗之副作用**: 原轉交給 WServOrm 拒絕時 srLog 已初始化(pino transport worker), 行程結束前建出 log 目錄與檔、並多印一次 `WServOrm init failed`; 改於入口 `checkOptRemoved` 後零副作用. 單元測試以子行程建構失敗後檢查工作目錄為空(`unit-optRemoved` UNIT-OR-019), 修前紅、修後綠.
- **打包產物**: 以 w-package-tools 之 rollupFile 打包至 `./tmp` 後 `require` 即拋 TDZ(`Cannot access '…' before initialization`), 已發布之 1.0.32 dist 亦然; 成因在 w-syslog(`src/WSyslog.mjs` 頂層宣告 `__filename` 遮蔽 rollup 之 `import.meta.url` CJS 墊片), 已轉 w-syslog 另案. (2026-10-14 補記: w-syslog 1.0.33 已修正, 見下「dist 冒煙」.)
- **工具**: TaskStop 停止背景 bash 時, 內層 `bash <script>.sh` 可能未被終止(停止後仍續寫 log); 以 `Get-CimInstance Win32_Process` 依命令列找出 PID 後 `taskkill /F /T` 並回驗. 持測試鎖之腳本須有等待上限與 EXIT / INT / TERM 時釋放自己之鎖.
- **測試鎖之排程**(2026-10-14; 同日稍後改為兩槽 `web-tests` / `web-tests-b` 取其一, 腳本依序試取): 多個 w-web-* 套件共用測試鎖時, 不開瀏覽器之 unit / api 不必持鎖(派工規則, 同日更正), 先跑完取得修前紅 / 修後綠; 需持鎖者(全套 `npm test`、真實入口 + 真瀏覽器驗收)串成一條背景鏈, 各一取一放, 鎖空出時兩項約 7.5 分鐘完成. 更正前之規則為所有測試指令皆持鎖, 他套件持鎖約 1.5 小時(03:40–05:19)期間本套件之驗證全數停擺.
- **以 dev server 驗收之非管理者導向**: 非管理者於 dev server(8080)下被導向字面字串 `{urlRedirect}`——`public/index.html:20` 為樣板, 只在後端提供已建置頁面時替換(`server/WWebTask.mjs:459`); 既有行為, 非回歸. 判「進不了站」看頻道樹不可見與 `/api/getUserByToken` 回 `errUserNoPermission`, 不看導向網址.

## 發布前升級輪: dist 冒煙與驗收之計時陷阱(2026-10-14, w-syslog 1.0.33 等)

- **dist 冒煙**(`tmp/run05/dist-build.mjs`、`dist-smoke-run.mjs`、`dist-smoke-child.mjs`, 用畢可刪, 作法如下): ①讀 `toolg/gDistRollup.mjs` 原文, 只把 `let fdTar = './dist'` 換成 `./tmp/...`(斷言恰一處)另存後以 node 執行, 設定與發布時完全相同; ②子行程以暫存資料夾為 cwd(WWebTask 建構會寫 cwd 相對之 `dist/index.html`、db、dbf、uploadTemp、logs), `require` 產物後比照 `srv.mjs` 以相對 `./db`、`./logs` 建構; ③送會寫 log 之請求(空權杖與非管理者之資料通道、登入檢查、kpFunExt 讀寫、函數清單、直寫), 輪詢讀 log 檔至預期記錄齊備; ④WWebTask 無停止介面, 寫完結果檔即 `process.exit(0)`; 父行程回驗子行程已不存在、埠已釋放. 結果 19 / 19.
- **產物經 terser 壓縮**: 字串標記要容許引號與空白之改寫(`err:"errUserNoPermission"`), 以原始碼寫法比對會誤判為「不含」. rollup 對 `module`、`http`、`worker_threads` 警告後視為外部模組, Node 下可用(w-syslog 修正報告之建議亦為可不加).
- **驗收之計時陷阱**: 以 repo 之 `settings.json`(`archiveAfterDays: 30`)起真實入口, 種子訊息時間戳固定為 2026-01-01(`g.initialData.mjs:21`), 後端啟動 30 秒後首次封存(`server/WWebTask.mjs:264`)即把歡迎訊息搬冷表. run04 前端編譯 5 秒、30 秒內做完而通過; run05 相依變動使 webpack 快取失效、前端重編 25 秒, 點頻道時已在封存之後 → 等歡迎訊息逾時(後端 `getMessages` 全成功、無任何錯誤). 驗收比照 harness(`test/tools/e2e-settings.json`)設 `archiveAfterDays: 0`. 教訓: 驗收腳本之通過不能依賴「做得夠快」; 先比對兩輪 log 之事件計數(本例多一筆 `archiveSweep`)即可定位.

## 專案文件混入姊妹專案範本內容(2026-09-27 發現)

- 舊版專案 `CLAUDE.md` 之「按鈕雙擊防護」附 w-web-sso 之具體範例(`procCore.mjs:79` 建 kmx、`:85` 建 `cacheSt`、key 為 `adminResetUserPassword` 等)與「Email 模板存放」整節(`server/template/…`), 本 repo 皆不存在(本專案 kmx 建於 `server/WWebTask.mjs:226`, key 為 `task:<id>` / `postMessage:<channelId>`; 無寄信流程). 教訓: 讀到專案文件之具體 `file:line`、函數名或目錄, 先核對本 repo 是否真的存在, 不因「寫在專案文件裡」就當事實.

## 多人同時編輯第二波實作(2026-10-23, task-run01; 規則見 `rulebook_concurrency.md`, 決策見 `spec/設計要點與取捨.md` D18)

- **修前紅之取得**: 新測試對 HEAD 之 `server/` 副本跑(`git archive HEAD server src | tar -x -C ./tmp/...`, 再補入新增之契約檔與測試檔; 不 checkout、不 stash)。夾具建資料若只用新 API, HEAD 上會因「函式不存在」而假紅, 看不出舊行為之缺陷; 測試之建資料 helper 加「無清單 API 時退回單筆 API」之分支, 使其餘斷言對舊行為判紅(HEAD 副本 5 綠 42 紅, 其中 E2 / O3 / O5 / O8 為行為紅)。另以 inv01 探測腳本(`agent-out/inv01-probes/`)於修前重跑一次作基準證據。
- **ORM 單筆失敗不 reject**: `woItems.X.save / del` 對單筆失敗回逐筆 `ok:0`(insert 為聚合物件 `ok`), 不拋錯; 一律檢查結果(`chkWrite`), 命中檢查另看 `n >= 1`。變異「拿掉 ok 檢查」第一次仍存活——因測試之 stub 回 `n:0`, 被「須命中」之檢查擋下; 要把 stub 寫成 `n:1, ok:0` 才單獨守住 `ok` 之檢查。教訓: 同一 if 內併列之兩個條件, 測試要各自獨立能觸發。
- **補償須含「失敗中那一步」**: 單次 ORM 呼叫拋錯時可能已部分生效(如批次寫入第 k 筆失敗); 只還原已完成之步驟會殘留。測試用「寫入已生效才拋錯」之注入(`installFaults` 之 `afterWrite`)才抓得到「補償漏掉失敗中那一步」之變異。補償次序(是否反向)因資料庫無外鍵,終態不可觀察, 屬等價變異, 不為它造測試。
- **grid 程式化換列亦觸發 `rowsChange`**: WAggridVue 於 `agRowDataUpdated`(換 `opt.rows` 後)呼叫 `rowsChange`, 故「`rowsChange` 一律設 `isModified = true`」在存檔成功後換成伺服端列、刪除後移除列時會誤設為已修改(原碼靠「先移除列 → 等 API → 再設 false」之時序碰巧避開)。改為以內容相對凍結基準判定(`mDraft.isDirty`), 與時序無關; 使用者改回原值亦自動回到未修改。
- **有副作用之 computed 不宜承載「重建」**: 原頁以 `:changeParams="changeParams"` 綁定之計算屬性在渲染時重建整張表, 草稿保護需區分「推播 / 切編輯模式 / 自身存檔」三種觸發, 改為 `watch`(`immediate`)+ 明確方法(`applyRows` / `rebuildFromStore` / `onStorePush`)。
- **基準範圍必須與伺服端新鮮讀取範圍一致**: 頻道基準為整表(`select({})`, 含種子頻道), 測試夾具只以自己建之列(名稱前綴過濾)算基準, 伺服端比對即判 `saveStale`(多出種子列)。api 測試之 `loadAllChannels` 取整表算基準、只修改自己之列。
- **刪除成功後有草稿時之新基準**: 不可取伺服端新列(會掩蓋他人於載入後之修改, 使之後存檔誤蓋), 只從凍結基準去掉被刪之 id; 存檔成功則整份草稿已落實, 以回傳之 `rows` 取新基準。
- **e2e 新案例首跑即過之原因**: 先以 `E2E_BASELINE_OUT_DIR` 導向暫存目錄試產(只經 `runBaselineCase`, 語意斷言全過才寫), 逐張目視後才把圖複製進 `test/pics/`, 再以 compare 模式跑第二次驗證穩定(既有 005 / 008 / 010 標準圖 0 張改變)。「另一位管理員」以頁面既有連線呼叫後端(不帶基準之外部呼叫)模擬, 並開固定時鐘使他人寫入之 `timeUpdate` 確定; 屬 arrange(未走 UI), 已在 spec flow 註明。
- **外審派工(beam / opencode)**: opencode 非互動時 `bash:'ask'` 一律自動拒絕, 模型被拒一次後常直接結束(離開碼 0、stdout 空、`validate` 失敗), 同一提示詞連敗 3 次; 專案外路徑(`C:\opensrcOper\…`)亦被 `external_directory` 拒。處置: 把外部文件複製進專案內 `./tmp/…/refs/`, 提示詞明寫「不要呼叫 bash、不需要 wc、以 Read 的 offset/limit 分段讀」並列起手步驟, 第 4 次完成。
- **web 測試鎖**: 兩槽曾被 `w-web-perm` 之已不存在之 pid 占用(`quiet-run` 印「殘留鎖」提示, 不自動移除); 等待約 1～10 分鐘後仍取得。api 層測試(無瀏覽器)不加 `--lock`。外審修補輪再排隊時兩槽由他專案之長時間 e2e 占用(pid 皆存活), 取鎖為輪詢、非先進先出: 把「UI 探測 + e2e 子集」包成同一支腳本於同一次持鎖內依序跑(`quiet-run --lock -- node run-seq.mjs`), 不為每個小驗證各排一次隊。
- **外審後第二輪修補之教訓(sol / beam, 2026-10-23)**: ①**前像須在持鎖後重讀**: `opDeleteMember` 原於表鎖內讀前像、其後才取實體鎖刪除, 期間 `ackChannel` 推進之游標被補償(重新 insert 前像)撤銷; 前像改於實體鎖內重讀。②**改身分欄位(成員改名)與同列的實體鎖寫入者(ack)須同一把鎖**, 否則 ack 之 save 會落在已換人之列。③**ack 讀寫條件須與讀取端一致**: 只認 `isActive:'y'`; `ds.X.funNew` 會固定 `isActive:'y'`, 造停用舊列之測試資料要在 funNew 後另設。④**存在檢查與新增須在同一互斥範圍**: `postMessage` 之頻道存在檢查移入 `channels` 表鎖內重查(刪頻道持該表鎖)。⑤**單筆保留 API 之成功回傳形狀不可改**(外部呼叫端相容): 核心逐筆檢查後以 `okShapeSave / okShapeDel` 還原為 ORM 形狀。⑥**lmdb `save` 為深度合併**: 物件 / 陣列型客戶端欄位無法以合併寫入精確還原, 故存檔前驗契約 `fields` 皆為字串(`chkFieldTypes`)。⑦**草稿中刪除其他列**須同時把被刪之 id 移出重建來源快照(`membersLocal`), 否則「改回原值 → 無修改 → 切編輯模式」自舊快照重建會帶回已刪之列, 存檔時被當新列新增; 移除快照時不可觸發其 watcher(會丟草稿), 故成員頁改為不監看 `membersLocal`、重建一律明確呼叫。⑧**WTextSelect 取消切換**無法還原顯示, 但 `:key` 遞增重掛即可(原記「無法還原」不成立)。⑨**載入世代 `loadSeq`**: 只比頻道 id 擋不住 A→B→A 之舊回應。⑩**物件字面量當計數表**遇 `'constructor'` / `'__proto__'` 等合法字串識別碼會取到原型成員, 用 `Map`。⑪**變異腳本之 mocha 須加 `--exit`**: 注入死鎖 / 逾時之變異會留下開啟之 lmdb 句柄使行程不退出, 腳本卡住; 同理 `spawnSync` 加 `timeout`。⑫測試標題宣稱之範圍須與斷言一致(sol #20): 以閘門(gate)證明「第二請求在第一請求停住時即被占位鍵拒絕」才算驗到 `lockSave`, 靠名稱重複等他因拒收的案不算。

## 刪頻道移入封存表與編輯器開啟中視同草稿(2026-10-23, task-run02; 規則見 `rulebook_concurrency.md` R-CONC-15 / 9.8, 決策見 D19)

- **搬移比刪除難在「鎖序與讀取時機」**: 任務逐筆在 `task:<id>` 鎖內重讀再搬(與 claim / respond / reset / archiveSweep 互斥); **訊息要在全部任務搬完之後才讀**——任務搬走後 respondTask 得 `errTaskNotFound`、不再新增 taskReply, 此時讀到之訊息集合才是最終集合. 若在建立寫入單元時就讀(或先搬訊息), 等任務鎖期間完成之 respondTask 所寫 taskReply 會漏搬, 熱表留孤兒; 此兩種錯誤變異(`msgs-prefetch-at-build`、`msgs-before-tasks`)皆須「respondTask 進行中停住 taskReply 寫入、同時刪頻道」之閘門測試才抓得到, 單純「先造資料再刪」抓不到.
- **頻道列放最後刪**: 補償靠 `runOps`, 但行程崩潰時補償不會執行; 頻道列最後刪則中斷後頻道仍在、重試補完(搬移冪等). 此性質只能以「硬失敗且補償亦失敗(`arm(k, true)`)→ 頻道列仍在 → 重試補完」測, 補償矩陣測不到(補償成功即全部還原).
- **封存表寫入與熱表刪除皆檢查結果**: woItems 對單筆失敗回 `ok:0` 而不 reject; 搬移若不檢查, 封存複本沒寫成而熱表已刪 = 資料遺失. 熱表任務刪除要求命中(`needHit`): 鎖內已確認存在, 未命中代表鎖紀律被破壞, 不可當成功.
- **進行中任務之判定**: 不拒絕刪除(後台 UI 只能人工回應 `running`, `pending` 無 UI 可結案, 拒絕會使頻道永遠無法刪)、不改寫狀態(屬狀態機規則)、原樣搬入並在刪除確認框提示; 見 D19 第 4 點. 不增 schema 欄(封存表與熱表同構, 已刪除可由 `channelId` 不在頻道清單得知).
- **ag-grid 之編輯器狀態不在列資料**: 已輸入未按 Enter 之文字只在編輯器 DOM, `isModified`(以列內容相對基準判定)看不到, 故「無草稿 → 重建」會把編輯器關掉. 判定用公開 API `getEditingCells()`, 關閉用 `cellEditingStopped`; `stopEditing` 先寫入列資料(`setDataValue`)才發停止事件, 故監聽內可直接以 `isDirty(opt.rows)` 重算(不必等 `rowsChange`). 變異「關閉時不重算 isModified」存活(`rowsChange` 先於停止事件回呼), 屬防禦性冗餘, 保留以防事件順序改變; 但 ag-grid 之事件以 `setTimeout` 非同步派送, 「列資料已寫、編輯器已關、`rowsChange` 與停止事件尚未回呼」之空窗內到達之推播只看旗標會重建丟稿 —— 外審發現, 以 `resolveModified`(依列內容重算)補, 該空窗 e2e 無決定性重現, 僅 unit 守純邏輯.
- **自判「已知不修」之資料遺失窗須先試「同一把鎖」**(外審 sol 教訓): 初版把「補償與封存掃描交錯可使訊息兩表皆無」列已知不修(理由: 消除須令掃描取表鎖阻擋發訊), 外審指出任務部分只需補償持 `task:<id>` 鎖, 訊息部分可用「頻道粒度之 `msgarch` 鎖」由掃描依頻道分組取得, 不必表鎖——修後取消該條. 規則: **補償之鎖範圍須與正向寫入對稱**(redo 持鎖、undo 亦持同一把), 否則補償本身就是競態來源; 補償亦不可刪「搬移前原就存在」之列(記搬移前存在與否).
- **頻道列最後刪要跨頻道**: 每個頻道各自「搬移後即刪頻道列」會使多頻道請求中斷時前者已刪、後者半搬, 原請求無法重送(`pickSelected` 因頻道不存在而整次拒); 改為全部頻道之搬移與成員列刪除完成後才刪各頻道列. 測試之故障點須落在「第二個頻道之搬移」(不是第一個頻道列之刪除), 否則抓不到此變異.
- **成員頁之現況**: 成員頁本就不隨推播重建(快照), 故編輯器不丟; 修前缺的是「提示」(`onStorePush` 於無未存修改時直接清除提示條)——修前紅(E2E-017)為「提示條不出現」而非「編輯器被關」, 與頻道頁(E2E-016)之紅不同.
- **前端 e2e 之負向觀察窗**: 驗「未被重建」須在推播進 store 後給一段觀察時間再驗編輯器仍在(以 store 內容為終態訊號偵測推播已到, 再固定 0.5 秒); 此為觀察「沒發生」之必要等待, 非同步手段.
- **swap 式修前紅**: 前端修前紅以 `cp` 把 HEAD 版元件換進 `src/`(備份在 `tmp/`)再 `cmp` 驗證與還原; 不用腳本改寫 repo 檔, 變異驗證之前端變異以 Edit 工具逐一施加與還原, 每輪結束 `cmp` 比對備份.

## 呼叫者身分驗證與存取矩陣(2026-10-25, task-run01; 規則見 `rulebook_security.md` R-AUTHZ-01～10, 決策見 `spec/設計要點與取捨.md` D20)

- **先建矩陣再修**: 修前以真後端實測入口 × 呼叫者, 初版 70 案中 65 案紅、102 格不符(一般使用者可建 / 刪頻道與成員、任一通過連線閘者可讀寫任一頻道、`getChannelsList` / `getStats` / `channels.select` 回整表、檔案無關卡、`[sys:polling]` 無 token 放行)。**意料之外的一格**: `ackChannel` 缺列路徑會替任何通過連線閘者(含非成員)自動建立成員列, 即「自我加入任何頻道」——修前矩陣中它甚至會污染其後各格(非成員變成成員), 故 ack 兩列置最後。
- **資料通道函數只收 `userId`**: w-serv-webdata 的 `execFun` 只把 `getUserIdByToken` 的回傳值交給函數, 函數內無從得知角色。本套件以「驗證通過當下登錄 userId → 角色(60 秒、單行程記憶體)」解(同 w-web-perm 的 `kpSystemAppIds` 作法), 並讓 `callerOf` 在無登錄 / 逾期時一律拒絕。**不要**用 AsyncLocalStorage `enterWith` 從 `getUserIdByToken` 帶出去: 被 `await` 的 async 函數內 `enterWith` 不會回到呼叫端的後續延續。
- **`sysFuncsPublic` 在本套件的實際效果**: `execFun` 先呼叫 `getUserIdByToken` 才處理 `[sys:getFuncList]`, 而本套件的 `getUserIdByToken` 對空 token fail-closed, 故函數呼叫路徑本來就沒有匿名可通; 且 `verifyConn` 已拒無 `Authorization`。真正新增的防線只有**輪詢**: `genPollingGate` 對「缺 `__sysToken__` 鍵」(已發布的舊前端元件)以無身分處理, 預設公開時放行——收緊後「標頭 token 有效、本體缺 / 空 token」的輪詢被拒。測試要用這個形狀(裸封包 `{ clientId }`)才分得出紅綠。
- **`npm run build` 會清掉 `dist/` 內 `index.tmp` 與 `w-web-task.umd.js`**: 完整產物須再跑 `node toolg/genEntry.mjs`(index.html → index.tmp)與 `node toolg/gDistRollup.mjs`(後端 umd, 順便驗證新模組可被 rollup 打包); 不跑 `cleanFolder`(會清 `docs/`)、不碰 `script.txt` 之發布步驟。
- **變異腳本**(`mutate.mjs`, 暫存檔不在 repo, 備份於任務報告資料夾 `task-run01-evidence/`; 執行時外層已持測試鎖者須設 `MUTATE_NOLOCK=1`, 否則內層再取鎖會死等; 變異之 `from` 字串於程式改版後可能不再恰出現一次而被略過, 腳本會印 SKIP——程式改動後務必核對所有變異皆實際施加): 對 `server/access.mjs` / `server/WWebTask.mjs` 逐一單點替換 → 持測試鎖跑 `unit-access` + `api-callerMatrix` → 立即還原 → 全程結束以 SHA-256 回驗與原檔相同。**變異期間不得編輯這兩個檔**(會被還原覆蓋); 變異的 `from` 字串須在檔內恰出現一次(腳本先驗)。
- **e2e 全跑偶發 `page.goto: net::ERR_NO_BUFFER_SPACE`**(Windows 網路緩衝耗盡, 與程式無關; 34 案中第 1 案 cht E2E-001 一次, 同一案其後重跑通過): 屬環境暫時性, 先看錯誤字樣再判斷, 不要當成程式迴歸。
- **外審 C 類(Claude API 額度)的金鑰**: 技能根的 `w-dispatch-ai` 1.0.55 的 `dispatchClaude` 無 `key` 參數(僅 `env`); 於 Claude Code session 內派出的子程序會繼承 `CLAUDE_CODE_*` 等連結變數而沿用訂閱。作法: 派工腳本(detached)在呼叫前自 `process.env` 刪除 `CLAUDE*` / `ANTHROPIC*` / `AI_AGENT` / `MCP_CONNECTION_NONBLOCKING`, 再以 `env: { ANTHROPIC_API_KEY }` 傳金鑰, stream-json 的 init 事件 `apiKeySource` 確認為 `ANTHROPIC_API_KEY`; 金鑰只在記憶體, 輸出以 `[KEY]` 取代後才落檔。
- **外審(opus-5.5〔API 額度〕+ gpt-6.1-sol)後之補修**: ①**授權檢查與執行之空窗在「會寫出持久權限」之入口不可當毫秒級忽略**——`ackChannel` 缺列路徑會建成員列, 授權通過後成員列被管理員移除, 缺列路徑即把被移除者永久加回; 修法是能力旗標(`allowInsert`, 一般使用者不得建列)而非加鎖, 測試以「閘門停在授權檢查之後、移除成員列、放行」之人為交錯(`unit-access` A11)。②**交給部署方鉤子之物件一律淺拷貝, 且是所有站點**(連線閘 / 執行身分 / HTTP `verifyAppUser`)——第一輪只做了前兩者, HTTP 路由漏掉, 被兩位審查者同時指出; 檢查「同型站點是否對稱」要用 grep 列全集而非憑記憶。③**登記角色之表要帶驗證開始序號**: 同 userId 並行驗證之完成順序可顛倒。④登入檢查回應與認證失敗 console 一律經 `pickUser` 白名單(部署方物件可能夾帶機密欄位; 前端 `userSelf` 只讀 id / name / isAdmin)。⑤連線閘須驗 `Bearer` 方案(原無條件刪前 7 字元)。⑥**變異驗證不等於測試完整**: 18 個變異全被抓到之後, 兩位審查者仍找出 4 個測試漏洞(冷表無內容、游標值、修改既有列、clientId 綁定)——變異集合只涵蓋我想到之改動, 外審補的是我沒想到之改動。⑦**snapshot 時點**: 審查快照早於其後之文件補寫, 審查者會誤報已補之處(如 R-AUTHZ-10); 評分表須註明快照時點。
- **測試以「基準先綠才跑變異」**: 變異以「有測試失敗」判被抓到, 基準本身已紅(例如新加之測試案有誤)時每個變異都「被抓到」而無意義; 變異腳本之外層(`run-all`)於基準未全綠時略過變異。另: **測試之人為交錯須有上限**——A11 把閘門停在授權檢查之後, 若授權檢查被略過(變異), 停點落在 ack 之實體鎖內而與刪除成員互鎖, 測試會懸置至 mocha 逾時(每個變異 600 秒); 改為各等待設上限、逾時即斷言失敗。
- **外審快照**: 審查者讀「快照」而非工作樹(`tmp/task-run01/review/snap/`, 由腳本複製並把註解 / 文件中的敏感字樣中性化、另附 `changes.diff`); 變異腳本與審查可並行而不互相影響。
- **unit 層以專案根為 cwd 呼叫真 `procCore.saveFile` 會在專案根 `./dbf`(git 忽略)落檔**(`procCore.mjs:16` / `:534`): 測試只清「已知 id」不夠——被測碼錯誤放行(如變異驗證、或日後迴歸)時,「本應被拒」之上傳反而成功、斷言在取得 id 之前中止, 檔案即殘留。作法: 在 `finally` 以 `./dbf` 目錄「測前 / 測後」差集刪除本案新增之檔(`unit-access` A7); 全套(含變異)跑完後以 `ls -A dbf` 回驗為 0。矩陣(`api-callerMatrix`)走 harness 實例, 檔案寫在 `test/_tmp/e2e-harness/root/dbf` 隨 harness 清除, 不受影響。

## 工具使用要點

- **w-screenctl 調 RWD 須 `viewport=null`**: 以 `viewport:{width,height}` 開瀏覽器會把 content 尺寸釘死, 拖拉視窗無法改變寬高; 要驗 RWD 時不傳 viewport, 讓 content 跟隨 OS 視窗大小.
- **tooltip 與截圖**: w-component-vue 按鈕帶 tooltip 時, 點擊後以 `mouse.move(0,0)` 移開觸發 mouseleave 即消失; 點擊即彈全屏遮罩之 dialog 者亦同(遮罩不擋 mouseleave, w-web-sso `spec/evidence/2026-09-29-tooltip-mouseleave-repro.mjs`). ~~原載「遮罩擋住滑鼠移動訊息, tooltip 留在圖上屬可接受」~~ 不成立(2026-09-29 更正, 2026-09-30 補記此處漏改): park 後仍在之提示框即缺陷——曾見成因為 w-component-vue ≤2.5.23 之 WButtonCircle 以 `v-if` 換掉游標下之圖示, 2.5.24 已修正; `captureStable` 截圖前以 `probeStuckTooltip` 偵測任何仍顯示之 hover 型提示框即判失敗. 絕不以合成事件強清.
- **自訂底色之按鈕要一併給焦點色**(2026-09-30): WButtonCircle 點擊後取得焦點, 焦點外觀用 `backgroundColorFocus` / `iconColorFocus`(預設淡灰底 `rgb(230,230,230)`、深灰圖示); 只給一般與 hover 色之紅色儲存鈕點擊後即變灰, 看似停用. 紅底鈕之焦點色取 hover 色、圖示白(同 w-web-sso IP / 金鑰清單之既有設定); 白底工具列鈕落回預設灰底即比 hover 深一階, 合乎元件「一般→hover→焦點」逐級加深之慣例, 不必另給.
- **ag-grid 整列框選**: 一列跨 center 與 pinned-left 兩容器(勾選框在 pinned-left), 單一 `.ag-row` 選擇器只命中其一; 以 `rowBoxSel` 取兩容器聯集.
- **`openApp` 不先開無 token 之頁**: 端點為 `127.0.0.1` 時 w-ui-loginout 之 `isDev()` 為 false, 無 token 登入失敗即轉址, 會毀掉正在執行之 `page.evaluate`(偶發 "Execution context was destroyed"); per-case 全新 context 本無殘留 token, 直接 `goto(?token=sys)`.
