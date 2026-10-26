# 重要處理要點

本檔為特有之重要處理要點,為業務端之特化要求事項與處理流程,包含事項、關聯什麼、怎麼判斷與處理方式等,由agent自行編列、擴充與維護.

體例: 每一事項一節, 固定三欄——**關聯**(牽涉哪些檔案 / 機制 / 文件)、**判斷**(何時適用、怎麼分辨)、**處理**(照做的步驟與禁止事項). 指令與測試檔清單不重抄, 一律指向 `sgud/rule/rulebook.md`「測試配置」; 決策緣由指向 `spec/設計要點與取捨.md` 之 D / L 編號; 根因史指向 `sgud/exp/experience.md`; 開發服務 port 見 `CLAUDE_settings.md`.

## 開發服務(3 srv)與測試實例分離

- **關聯**: 開發 3 srv(後端 `node srv.mjs`、前端 `npm run serve`、w-screenctl; port 見 settings); 測試 harness(`test/tools/e2e-setup.mjs` + `harnessLifecycle.mjs`)自建之測試實例: 後端 11108、前端 8091、互斥 11208, 工作目錄 `test/_tmp/e2e-harness/root`; `vue.config.js` 之 proxy 目標由 `WTASK_DEV_PROXY_TARGET` 覆寫(預設 11008).
- **判斷**: 開發 3 srv 與測試實例可同時存在、互不干擾——跑測試**不必也不應**先關 3 srv; 跑測試也不會動到開發用之 `./db`、`./dbf`、`./logs`. w-screenctl 探索開發畫面仍用 3 srv. 開發前端改用 dev server(熱重載), 不以後端 serve `dist` 取代.
- **處理**: 開發服務被佔用另選 port 時**不選 8091 / 11108 / 11208**(測試專用; harness 見其被非自建行程佔用即拋錯); harness 報「port 被非本 harness 啟動之行程佔用」時, 看附帶之命令列——是自己先前起而殘留者確認後自行關, 他人之行程回報使用者, 不殺; 不為了讓測試過而改 harness 之 port 或放寬所有權檢查.

## 資料初始化與測試 seed

- **關聯**: `g.initialData.mjs`(demo 種子單一真理來源: 頻道 / 成員 / 訊息 / 任務; 時間戳固定為 `2026-01-01T…+08:00` 起逐小時遞增; 同時清空 `files` 表與 `./dbf`); harness 之 `reseedBackend()`; E2E-013 封存種子 `test/tools/seed-archived-task.mjs`.
- **判斷**: 開發用 `./db` 之重建(`node g.initialData.mjs`)**只在使用者明確要求時做**——它會清掉開發中新增之頻道、訊息與上傳檔. 測試之 hermetic 種子由 harness 每案自動重建(移開測試資料庫 → 種子 → 重起後端), 不需也不應手動介入. demo 種子時間戳必須維持固定值——e2e 標準圖之穩定性依賴它(改成 `nowms2str()` 會使含時間欄之圖全部漂移).
- **處理**: 不主動重跑開發種子; 改 `g.initialData.mjs` 之種子內容 = 標準圖受影響(頻道樹、時間軸、後台三表、統計卡片), 依「標準圖重產」處理; 測試中資料異常先確認 11108 只由本 harness 自建之後端監聽, 再查種子.

## 跑測試: 統一入口與自身驗證分流

- **關聯**: `package.json` scripts 之 `test`(全域 §16.5 標準字串); 各層指令見 rulebook「測試配置」; e2e 單檔約 5～6 分鐘、`npm test` 全套約 6 分鐘(2026-09-29).
- **判斷**: `npm test` 是跨套件批次維護、確認套件能完整測試之統一入口, **字串固定不得改、不加測試類 scripts 變體**(本專案屬自有計畫, `serve` / `build` / `lint` / `deploy` 照留); agent 自身要驗證什麼一律自編指令. 同一專案同時只能跑一個 harness(互斥 11208)——第二條鏈會立即拋錯, 不是 flake.
- **處理**: 超過 2 分鐘 `run_in_background` 等完成通知; 跑前 `netstat -ano | grep -E ":(11108|8091|11208) " | grep LISTENING` 應為空. 收尾判準不只綠: 11108 / 8091 / 11208 皆釋放、`test/_tmp/` 與 `test/tools/_tmp/` 皆不存在、`./testPending/` 本輪無新增(或已分析)、無殘留 node / chrome. 臨時檔只落 `test/_tmp/`(harness cleanup 整個刪), 失敗三聯組落 `./testPending/` 不自動刪.

## 改動 `src/` / `server/` / `test/tools/` 後之驗證範圍

- **關聯**: rulebook「spec → 測試對照」; D10(渲染消毒、檔案白名單)、D13(RWD)、D15(W / M 契約).
- **判斷**: 改 `server/procCore.mjs` → `unit-procCore` + `api-agent`; 改 `server/WWebTask.mjs` 之路由 / 認證 → `api-*` 三檔(`api-tokenLeak` 驗 srLog 逐筆); 改注入函數或 log → `unit-wrapInjected` / `unit-maskLog` + `api-tokenLeak`; 改 UI 元件 → e2e(對照受影響之 E2E-NNN); 改 `ChatView.vue` / `LayoutContentTasks.vue` 之 markdown 渲染 → E2E-007 必跑; 改 `Layout.vue` 斷點邏輯 → `unit-rwd` + e2e(寬版逐像素不變); 改 `test/tools/` → `unit-harness*` + e2e 單檔 + `npm test`.
- **處理**: 開發中改 `server/` 後, 3 srv 之後端自動 kill 重啟並回驗(`CLAUDE.md`); 測試實例由 harness 每次自起, 不受影響. **測試進行中不改 `server/`**——reseed 會重新 spawn 後端而載入半成品. e2e 紅先開 `./testPending/` 之 `__diff.png` 定位差異區, 再分辨 baseline 過期 vs 真回歸; 不改測試遷就現狀.

## 標準圖重產

- **關聯**: `test/pics/channeltask/`; 直跑 `node test/e2e-channeltask.test.mjs --baseline [--names …] [--langs …] [--write-mode missing|changed]`(截圖前篩選, 規格見 `node_modules/w-package-tools-e2e/README.md` §2.2); env `E2E_BASELINE_OUT_DIR` 導向暫存目錄做等價驗證; 全域技能 §7.6 / §7.9.
- **判斷**: 先取得使用者授權, 只重產受影響之案例. `--names` 可給階段圖鍵(只寫該張)或案例鍵 / 編號前綴(如 `E2E-005` 寫該案全部階段); 不符任何鍵即報錯; E2E-007 為語意-only 不產圖, 指定之即於產製結束報「未產出任何圖」. 重產與 mocha 共用 harness(互斥 11208), 只能單鏈.
- **處理**: ①先跑受影響案例之 mocha 取失敗三聯組, 判定差異只落在預期區域; ②授權後以 `--names` 手術式重產, 或先 `E2E_BASELINE_OUT_DIR=test/_tmp/<案名>` 產到暫存目錄比對後再寫正式目錄(harness cleanup 只刪 `test/_tmp/e2e-harness`, 該暫存目錄比對完自行刪); `--write-mode changed` 只寫超過容差者; ③產後 `git diff --stat test/pics`, 逐張依下節審圖; ④審畢跑 mocha 全檔與一案 `--grep` 單跑, 結果一致才回報.

## 標準圖之審查與判定由 agent 先行(2026-09-28 起)

- **關聯**: 業主 2026-09-27 於 w-web-sso 授權「e2e 標準圖皆由你先行檢查與做出判定與審查」; 2026-09-28 經三方獨立複審定案擴及 sso / perm / api / task(紀錄: w-web-sso `spec/設計要點與取捨.md` ADR-072 決定 4⑧).
- **判斷**: 標準圖之逐張審查與「可否凍結為 baseline」之判定由 agent 負責, 審畢即可跑 mocha, 不必等業主審圖; 產圖本身(重產 / 新產)仍須授權(技能 §7.9). 業主裁示限於設計取捨或產品介面變更; 紅框「亂框、亂壓以致遮蔽有效資訊或使用者誤解」一律屬缺陷、直接修, 不列裁示(2026-09-28 業主明示).
- **處理**: 以使用者視角判斷「照圖能否操作、畫面有無被改壞」: ①與 git HEAD 版逐像素比, 差異須落在預期區域; ②逐張目視對照 spec 框住句與操作順序(點擊前框要點之元素整顆、點擊後框反應); ③紅框掃描(每張恰一框, 同色連續 ≥ 20px)、框內外留白與兩語系對稱; ④抽張重產逐位元比對; ⑤審圖紀錄落檔供業主隨時查閱, 需裁示者列首節.

## 登入、SSO 與 agent 身分

- **關聯**: `srv.mjs` 之 `getUserByToken`(測試權杖清單見 rulebook「權杖外洩防護」)、`verifyClientUser` / `verifyAppUser`(放行 `isAdmin === 'y'`; 2026-10-25 起另放行測試用一般使用者 `id-for-member` / `id-for-outsider`, 供 `api-callerMatrix` 測本套件自身之角色與成員檢查, 見 rulebook_security R-AUTHZ-09); settings 之 `ssoBaseUrl` / `ssoAppToken`; 前端 w-ui-loginout 之 `urlRedirect` 導向 SSO 登入頁; D3(認證委外 SSO)、D8(身分取自 token)、D15.
- **判斷**: 開發與測試以 `?token=sys` 登入(身分 `id-for-admin`); agent 以 `agent-demo`(種子頻道之主責 agent)或 `agent-api` / `agent-sso` / `agent-perm` / `agent-task`(外部執行 agent 之測試頻道)呼叫 REST; `ssoAppToken` 為空時不打 SSO、直接回 `{}`(查無). 端點用 `127.0.0.1` 時 w-ui-loginout 之 `isDev()` 為 false, 不會自動帶 `sys`——未帶 token 即導向 SSO. 本套件不存 users / tokens, token 時效與撤銷全交 SSO.
- **授權門檻(2026-10-14 起, D17)**: 瀏覽使用者之門檻為部署方之 verifyClientUser, 同時作用於登入檢查與前端資料通道之每次請求(連線閘; 前端每 2 秒輪詢皆經過, 故參考入口不於其內印 log); agent 之 HTTP REST 經 verifyAppUser. 資料通道之表操作只開 select, 頻道與成員之寫入只經 kpFunExt. 驗「被拒者」用測試權杖 `{token-for-nonadmin}`(isAdmin='n', 受 `NODE_ENV` 守門).
- **處理**: 探測與手動驗收一律帶 `?token=sys`, 必要時以 `context.route` 只放行本專案 port, 避免被導向 SSO 登入頁(可能正被 sso 之 e2e 使用); 正式部署設 `NODE_ENV=production` 即停用全部測試權杖, 並改提供真實 `getUserByToken`; agent 之寫入身分一律取自 token, 不因呼叫端自帶 agentId / senderId 而改(D8).

## 呼叫者角色與成員檢查: 新增 / 修改入口函數之流程(2026-10-25, D20)

- **關聯**: `server/access.mjs`(`createAccess` 原語、`createGuardedFuncs` 入口函數表)、`server/WWebTask.mjs`(`authToken`、`kp`、`operOrm`、HTTP 路由、`sysFuncsPublic`)、`test/api-callerMatrix.test.mjs`、`test/unit-access.test.mjs`、rulebook_security R-AUTHZ-01～10、`spec/設計要點與取捨.md` D20。
- **判斷**: 凡新增或改動「對外入口」(資料通道 `kpFunExt`、表 select、HTTP 路由、系統函數)皆適用。授權只在入口函數表套用一次, procCore 不做授權、不得在 WWebTask 內直呼 `pc.<業務函數>(`(`grep -nE "\bpc\.[a-zA-Z]+\(" server/WWebTask.mjs` 應只剩 `pc.archiveSweep`)。
- **處理**: ①先決定規則分類(`admin` / `byChannel` / `byTask` / `byParticipant` / `user`)並加於 `createGuardedFuncs`; 管理類(寫頻道 / 成員)一律限系統管理者, 頻道內容限成員或系統管理者, 不另建「頻道管理者」判準(`role` / `ownerId` 為後台可編欄)。②`kpFunExt` 以 `kp(name, (c, …) => gf.<名>(c, …))` 掛上(保持原參數個數), HTTP 路由以 `gf.<名>(access.callerOfUser(user), …)`。③加入 `api-callerMatrix` 之 `ops`(`api-callerMatrix`「入口全集」案與 `unit-access` A6 會在漏加時紅); 清單類入口須回「有權看之頻道」而非整表。④檢查之值須即使用之值(同一個 `channelId` / `taskId` 傳給檢查與業務函式); 非字串一律拒。⑤改完跑變異腳本(見 experience「呼叫者身分驗證」)抽驗: 拿掉該入口之規則須被測試抓到。⑥新增之測試權杖放 `srv.mjs` 並受 `NODE_ENV !== 'production'` 守門。
- **注意**: 修改 `server/access.mjs` / `server/WWebTask.mjs` 時不要同時跑變異腳本(會被還原覆蓋); e2e 進行中不改 `server/` 與 `src/`(後端重起與 dev server 重編會使案例失敗)。

## 語系注入

- **關聯**: 後端啟動時以 settings `language` 取代 `dist` 進入點之 `{language}`(`server/WWebTask.mjs:428-450`: `index.tmp` → `index.html`, 本機無 `index.tmp` 時改用 `index.html`)→ `window.___pmwtask___.language`; `showLanguage` 控語系選單顯隱; `server/procLang.mjs`.
- **判斷**: 只有後端 serve 之 build 才有注入; dev server(8080 / harness 8091)服務未取代之模板, `window.___pmwtask___.language` 為字面 `{language}`, 經 `src/plugins/mUI.mjs:80-86` 之 `validLang` 落回 `eng`. 本專案前端**不讀網址語系參數**(無 `?lang=`), 語系只來自注入值、store 與右下頭像選單. e2e 以 `setLang` 切語系(eng 亦走以補等量 settle), **未**設「初始語系注入」之 e2e 案例(與 perm / api 之 e2e-init 不同).
- **處理**: 要驗初始語系注入須打後端 serve 之 build(`dist`), 不能用 dev server; 新增可見文字一律 `$t('key')` 並於 `procLang.mjs` 同時加 eng 與 cht.

## e2e 共用設施(w-package-tools-e2e)

- **關聯**: devDependency `w-package-tools-e2e`(2026-09-29 起 `^1.0.2`, 2026-09-30 起 `^1.0.3`, 2026-10-01 起 `^1.0.6`; 規格見其 README); 單一橋接 `test/tools/e2eLib.mjs`(53 個匯出); `test/tools/harnessProc.mjs` 之七個 OS 原語亦經此轉自套件. 沿革: 2026-09-28 起引用 w-web-sso 之 `./srcPack`(抽提種子), 2026-09-29 套件發布 1.0.2 後改指套件, srcPack 刪除.
- **判斷**: 套件由其主責者審計、擴充、發布, 本專案不改套件內容; 本專案之行程所有權 harness(`harnessLifecycle.mjs`, own 政策)不在套件內, 留在本專案. 在本專案遇到共用設施之缺陷或需擴充之功能, 整理成「徵狀、重現步驟、建議修法與測試」回報業主, 由套件端改版——不在本專案另寫 patch 或複製模組回來改(四專案共用).
- **處理**: 套件升版時先以 `npm pack w-package-tools-e2e@<版>` 取 tarball 與已安裝版逐檔 diff, 列出行為差異清單(只改註解 / 排版者不算), 再四專案同步 `npm install -D w-package-tools-e2e@<版>`; **驗證範圍依差異清單決定, 不預設重跑全套**——無行為差異 → 橋接檔載入檢查＋抽查一檔; 有差異 → 只跑用到該模組之測試(截圖 / 紅框 / 遮罩 / 管線之變更會動到標準圖, 見套件 README「改版須知」); **差異清單要含依賴**: 套件之 `dependencies` 升 playwright 即換截圖用之 Chromium(先比 `node_modules/playwright-core/browsers.json` 之 chromium revision), 不同即全部 e2e 比對(1.0.6 實例: src 不變, playwright 1.62.1 → 1.63.0、Chromium 151 → 153, 本專案 26 / 26 通過、無逼近容差者); 盤點 CLI 為 `node node_modules/w-package-tools-e2e/tools/auditBoxes.mjs test/pics/channeltask`、`… /auditWaits.mjs .`.

## 跨套件改動須經業主同意

- **關聯**: 姊妹套件 w-web-sso / w-web-perm / w-web-api(各自獨立 repo 與發版); 本套件消費 sso 之對外 helper(K 契約白名單同步點, rulebook「權杖外洩防護」).
- **判斷**: 業主明示未經同意不得同步改其他套件; 本專案任務之授權只及於本套件. 查出姊妹套件有同型缺陷, 亦不構成修改授權.
- **處理**: 同型問題只查證(`file:line` 或實測)並列入回報, 附建議與代價, 逐套件詢問; 同意後才動. 不在姊妹套件跑會改寫其 `dist` / DB / 追蹤檔之測試.

## 自有套件(wsemi / w-*)升級之查核

- **關聯**: `package.json` 之 `w-serv-hapi` / `w-serv-orm` / `w-ui-loginout` / `w-component-vue` / `w-aggrid-vue` / `w-syslog` / `wsemi` 等; `server/WWebTask.mjs` 傳給 `WServHapiServer` 之 opt; `src/main.js` 傳給 `WServHapiClient` 之 opt.
- **判斷**: 自有套件無 CHANGELOG, 版號跳動不代表相容; **改名類變更傳舊名不報錯、只靜默失效**(w-serv-hapi 之 `showLog` → `useShowLog`、`fnTableTags` → `fpTableTags` 為先例, sso ADR-061), 測試綠燈抓不到. 本專案 `WWebTask.mjs` 原傳舊名 `fnTableTags`, 靠 w-serv-hapi 之相容層生效(`node_modules/w-serv-hapi/src/WServHapiServer.mjs` 註明「相容舊名 fnTableTags」), 2026-09-29 改為 `fpTableTags`(相容層哪天移除, 舊名會靜默落回預設檔名 `tableTags.json`).
- **處理**: 升版時比對我方傳入之 opt 鍵與新版 JSDoc `@param [opt.xxx]`(或 `npm pack <pkg>@<舊版>` 取舊碼逐檔 diff), 找改名 / 移除 / 新增; 確認 import 之 `wsemi/src/*.mjs` 仍存在; 跑 `npm test` 與真瀏覽器探測(登入、頻道樹與時間軸載入、無 `pageerror`). 依賴出問題由套件端統一改版, 不在專案端補裝或繞道(全域 §7).
  - **下游新增之必填選項與已移除之選項**(2026-10-14 實例, D17): 只比對「我方傳入之鍵」看不到下游新增之必填鍵——w-serv-webdata 1.1.7 起 `useDbOrm: true` 須給 `authorizeExec`, 缺則建構即拋, `npm test` 只呈現為 api / e2e 之 `before all` 失敗. 故升版後**先以真實入口實際啟動後端**(`node srv.mjs`, 或讀 harness 錯誤所附之後端輸出), 再跑測試; 上游移除之鍵(w-serv-orm 三鍵)不轉交、入口以上游之 `checkOptRemoved` 拒絕.
  - **被阻斷時找遮蔽之失敗**: 阻斷使大批案例未執行, 修正前看不出其後是否另有升版所致之失敗. 以修正原型實跑全套: 原型放 `./tmp/`, 以 `NODE_OPTIONS=--import=<hook 註冊檔>` 之模組解析 hook 只把 `srv.mjs` 所 import 之 `./server/WWebTask.mjs` 導向原型(harness 起之後端經 env 繼承), 不改受追蹤檔; 原型之相對 import 改指真實模組, 使假時鐘 hook 照常作用於 `server/procCore.mjs`(作法見 `sgud/exp/experience.md`「相依升版使後端無法啟動」).
  - **打包產物**: 自有相依升版會改變發布時打進 `dist/w-web-task.umd.js` 之內容(`toolg/gDistRollup.mjs` 只外部化 hapi、pino 與 node 內建, w-syslog / w-serv-* / wsemi 皆打入). 驗證以 repo 之 rollup 設定只改 fdTar 打包至 `./tmp`(不寫入 `dist/`), `require` 後**實際建構並送會寫 log 之請求、讀 log 檔確認落地**——`require` 成功只是必要條件. 建構之 cwd 須為暫存資料夾: WWebTask 建構時把 `index.html` 寫入 cwd 相對之 `dist/`(或 `./node_modules/w-web-task/dist`, `server/WWebTask.mjs:436-461`), 在 repo 根執行即寫入 repo 之 `dist/`; db、dbf、uploadTemp、logs 亦落 cwd. 2026-10-14 原載「已發布之 dist 因 w-syslog 之 TDZ 缺陷無法 `require`」→ w-syslog 1.0.33 已修正, 以之打包之產物冒煙 19 / 19(建構、A1 入口拒絕、logFd 不可建立之同步拋錯、資料通道拒絕與放行、log 落地、埠與行程回收); 已發布之 1.0.32 dist 待下次發布重建. 腳本範本見 `sgud/exp/experience.md`「dist 冒煙」.

## 執行期產物

- **關聯**: 開發用 `./db`(LMDB)、`./dbf`(上傳檔實體, `server/procCore.mjs:16` / `:534`)、`./logs`、`./uploadTemp`、`tableTags-web-task.json`(w-serv-hapi 寫出)、`dist/index.html`(後端啟動時由 `index.tmp` 產出); 測試用皆在 `test/_tmp/e2e-harness/root` 下.
- **判斷**: 皆為執行期產生, 不當成待辦、不入版控; `dist` 由發布流程(`script.txt` / `toolg/`)產製, 需要時自行 build.
- **處理**: `tableTags-web-task.json` 勿手動編輯; 上傳檔實體 `./dbf` 目前未列於 `.gitignore` / `.npmignore`(見 rulebook「已知缺口」), 提交或發布前確認其內無開發時上傳之檔案.
