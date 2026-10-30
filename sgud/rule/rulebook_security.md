# 規則帳本分冊:權杖外洩防護(w-web-task)

本檔為 `sgud/rule/rulebook.md` 之分冊(2026-10-22 依全域 §14 拆分): 以下各節自主檔原樣搬移, 節號與標題不變、不刪內容; 體例、盤點指令之 cwd 慣例、`git grep` 不搜未追蹤檔之注意事項同主檔。索引見 `rulebook.md`。

## 權杖外洩防護(D15; 對應 w-web-sso ADR-068 之 W / M / K 契約)

| 規則 | 站點全集 | 判準 | 盤點指令 |
|---|---|---|---|
| 注入函數(`getUserByToken` / `verifyClientUser` / `verifyAppUser`; 原第四個選填 `opt.getUserById` 隨 w-serv-orm 移除, 2026-10-14 起由 D17-1 於入口拒絕)只經 `wrapInjected`: srLog 初始化後以包裝版取代參數本身, 其後才有呼叫 | 包裝 `server/WWebTask.mjs` 之三行 `= wrapInjected(`; 呼叫點: getTokenUser(getUserByToken)、getAndVerifyClientUser 與 `p.checkToken`(verifyClientUser, 後者 2026-10-14 起, D17-3)、getAndVerifyAppUser(verifyAppUser)、getUserIdByToken(getUserByToken) | 已套(呼叫點行號皆大於包裝行) | `git grep -nE "\b(getUserByToken\|verifyClientUser\|verifyAppUser)\(" -- server/WWebTask.mjs` 之每筆呼叫行號須大於 `git grep -n "= wrapInjected(" -- server/WWebTask.mjs` |
| 上游拋錯 / reject 視同否定結果(getUserByToken → `null`; verify 系 → `false`); 失敗記 `srLog.warn({ event:'inject-<名>-fail', ... })`(`WWebTask.mjs:166`), 只含 K 契約白名單 key 或 `upstreamType` / `upstreamName`, 絕不記原文 | `server/wrapInjected.mjs` | 已套; 守 `unit-wrapInjected`、`api-tokenLeak` | — |
| **白名單同步點**: `keysUpstream`(`server/wrapInjected.mjs:15`)須與 w-web-sso K 契約之 14 key 一致; sso 增刪 helper 之 reject key 時同步改此處與 `test/unit-wrapInjected.test.mjs` 之 `KEYS_K` | `server/wrapInjected.mjs` ↔ w-web-sso `spec/設計要點與取捨.md` ADR-068 | 已套 | `git grep -n -A16 "let keysUpstream" -- server/wrapInjected.mjs` |
| 印權杖只經 `server/maskLog.mjs`(`maskTok` / `maskQuery` / `maskUrl`, 與 sso `maskToken`、perm / api `maskTok` 同一組測資); 錯誤只記名稱與代碼 〔2026-10-31: console 之整體規則改見 R-CONSOLE-01(D22); `srv.mjs` SSO 例外改印 `briefSsoErr` 摘要; `maskQuery` 本套件已不使用, 保留 M 契約匯出〕 | 後端 console 之權杖類參數 | 已套 | `git grep -nE "console\.(log\|error\|warn\|info)\(.*(token\|query\|authorization\|headers\|referer\|payload)" -- server srv.mjs`(權杖值參數須皆經 mask; 其餘為固定字串) |
| srLog 不記權杖與上游原文 | srLog 全站點: 無 token / authorization / query / headers / referer 欄; `err` 只為自家 key 或 `describeUpstream` 之結果(外來值——`woItems` / 驅動例外原文——出口 7 站與轉拋 4 站一律先經 `diag.mask` / `diag.err`, R-ORMDIAG-06); 另 `orm-diag`(wsemi `genDiagFunLog` 轉接, 只記 `label` 與 w-serv-orm 之 `safe`〔頂層鍵限 w-serv-orm 公開之 `SAFE_KEYS` 與 `errType`、`errCode`, R-ORMDIAG-08〕, 不記 `detail`; D21 / R-ORMDIAG-02; 舊 `server/ormDiagLog.mjs` 已於 2026-10-29 刪除) | 已套 | `git grep -nE "srLog\.(info\|warn\|error)\(" -- server` |
| 查無使用者單一出口 `getTokenUser` → `errUserNotFound`(`WWebTask.mjs:335`); `getUserIdByToken` **fail-closed**(查無 → `srLog.error` 後 reject `errUserIdMissing`, `:1002-1003`, 函數不執行) | `server/WWebTask.mjs` | 已套(2026-09-25; 行為變更見 D15) | `git grep -n "errUserNotFound\|errUserIdMissing" -- server/WWebTask.mjs` |
| 測試權杖只在非 production: `sys`、`agent-demo`、`agent-api` / `agent-sso` / `agent-perm` / `agent-task`、`{token-for-reject}`、`{token-for-verify-throw}`、`{token-for-nonadmin}`(2026-10-14 起; isAdmin='n' 之有效使用者, 供驗 D17-3 被 verifyClientUser 拒絕者) | `srv.mjs` 之 getUserByToken; 合成使用者 `id-for-verify-throw` 之拋錯分支在 verifyClientUser / verifyAppUser | 已套 | `git grep -n "NODE_ENV !== 'production'" -- srv.mjs`(每個測試權杖之條件行須含) |
| 前端 Referer 只送 origin | `public/index.html` `<meta name="referrer" content="strict-origin">` | 已套 | `git grep -n 'name="referrer"' -- public/index.html` |

測試對照: `test/unit-maskLog.test.mjs`(M 契約測資全表, 含 sso 同一組)、`test/unit-wrapInjected.test.mjs`(W 契約)、`test/api-tokenLeak.test.mjs`(回應 + 本次後端 srLog 逐筆; 後端 log 目錄 `backendLogDir`). stdout 不在 mocha 內, 以真實入口 `node srv.mjs` 之驗收探測確認.

## 呼叫者身分驗證與存取矩陣(D20; 2026-10-25 task-run01; 對應 dspec `使用者身分驗證原則.md` 二.1～二.8、`w-web呼叫者身分驗證.md` C2 / C2b / C3)

規則以「程式碼須長成什麼樣」為單位; 每條附站點全集、判準與可重跑盤點指令(cwd 為專案根; `server/access.mjs` 為新檔, `git grep` 不搜未追蹤檔, 以 Grep 工具或 `grep -n` 查, 提交後 `git grep` 亦可).

| 規則 | 站點全集 | 判準 | 盤點指令 |
|---|---|---|---|
| **R-AUTHZ-01 瀏覽使用者 token 完整驗證單一擁有者 `authToken`**(token 認證 `getTokenUser` ＋ 部署方 `verifyClientUser(淺拷貝, from)`): 連線閘 `p.checkToken`、登入檢查 `getAndVerifyClientUser`、執行身分 `getUserIdByToken`(`from` 固定 `'main'`)三者共用, 不另寫第二份 | `server/WWebTask.mjs` 之 `authToken` 定義與三個呼叫點 | 已套: 全檔 `verifyClientUser(` 只在 `authToken` 內呼叫 1 處(另 1 筆為註解); `getUserIdByToken` 不直接呼叫 `getUserByToken`; 認證失敗 / 授權不通過皆 reject `errUserIdMissing`, srLog `err` 分別為 `errUserIdMissing` / `errUserNoPermission`, 不含 token | `grep -n "verifyClientUser(" server/WWebTask.mjs`(應 1 處); `grep -n "authToken(" server/WWebTask.mjs`(定義 + 3 呼叫); `grep -n "getUserByToken(" server/WWebTask.mjs`(只在 `getTokenUser`) |
| **R-AUTHZ-02 授權只在入口邊界套用一次, 且全部對外入口經同一張入口函數表 `createGuardedFuncs`**: 資料通道 `kpFunExt`(經 `kp`)與 HTTP REST 路由(經 `gf.<名>(access.callerOfUser(user), …)`)皆不直呼 procCore 之業務函數; procCore 不做授權 | `server/WWebTask.mjs`(kpFunExt 24 個、apis 16 條路由中 15 條經入口函數表;第 16 條為登入檢查 `/api/getUserByToken`,直接走 `authToken` 並以 `pickUser` 只回 `id / name / email / isAdmin`)、`server/access.mjs` 之 `createGuardedFuncs`(25 個函數: kpFunExt 24 + `getFile`) | 已套: WWebTask 內 `pc.<名>(` 只剩 `pc.archiveSweep`(封存 timer, 非對外入口); 新增入口函數須先加於入口函數表, `api-callerMatrix`「入口全集」與 `unit-access` A6 守(漏加即紅) | `grep -nE "\bpc\.[a-zA-Z]+\(" server/WWebTask.mjs`(應只有 `pc.archiveSweep`); `grep -c "gf\." server/WWebTask.mjs` |
| **R-AUTHZ-03 角色判準單一擁有者 `access.isAdminUser`**: 自有屬性 `isAdmin` 嚴格等於 `'y'` 才是系統管理者(角色唯一來源: token 反查結果; 本套件無自有使用者表, 同 w-web-api; 不讀 `isApp`; 不設頻道管理者角色, `role` / `ownerId` 為後台可編自由欄位, 不作授權依據) | `server/access.mjs` 之 `isAdminUser`; `remember`(登錄)與 `callerOfUser`(HTTP)呼叫之 | 已套: `server/` 內除 `checkUser`(值域檢查 `'y'`/`'n'`)與 `access.mjs` 外無第二處判斷 `isAdmin` | `grep -n "isAdmin" server/*.mjs` |
| **R-AUTHZ-04 管理類限系統管理者**(`errUserNotAdmin`, 零寫入): `saveChannels` / `deleteChannels` / `saveChannel` / `deleteChannel` / `saveChannelMembers` / `deleteChannelMembers` / `saveChannelMember` / `deleteChannelMember`(資料通道; 無 HTTP 路由) | `server/access.mjs` 之 `admin(` 八處 | 已套 | `grep -n "^    admin('" server/access.mjs`(應 8 筆) |
| **R-AUTHZ-05 頻道內容 / 任務 / 檔案限成員**: ①`byChannel` 七個(`getChannelMembers` / `getMessages` / `postMessage` / `getTasks` / `getArchivedTasks` / `getArchivedMessages` / `ackChannel`)→ 系統管理者或該頻道成員, `errChannelNotMember`; ②`byTask` 四個(`getTask` / `claimTask` / `respondTask` / `resetTask`)→ 系統管理者或任務所屬頻道成員, 查無與非成員同回 `errTaskNotFound`; ③`byParticipant` 三個(`uploadFile` / `getFileInfo` / HTTP `getFile`)→ 系統管理者或任一頻道成員. **成員判準單一處** `access.isMemberOf` / `memberChannelIds`: `(channelId, memberId=呼叫者 id, isActive='y')`; 非字串 `channelId` / `taskId`(含物件條件)一律不通過 | `server/access.mjs` 之 `byChannel(` / `byTask(` / `byParticipant(` 與 `requireChannel` / `requireTask` / `requireParticipant` | 已套 | `grep -nE "^    by(Channel\|Task\|Participant)\(" server/access.mjs`(7 + 4 + 2〔`uploadFile`、`getFileInfo`; `getFile` 單獨寫〕); 對照 `channelMembers.select(` 只在 `access.mjs` 內(成員查詢單一處): `grep -rn "channelMembers.select" server/`(access.mjs 之 2 處為授權用之成員查詢; procCore 內為業務讀寫, 非授權) |
| **R-AUTHZ-06 清單 / 統計 / 表 select 只回有權看之頻道**: `getChannelsList`(含 HTTP `getChannels`, `agentId` 過濾後仍收斂)經 `scopeChannels`; `getStats` 帶 `scope`(`procCore.getStats(userId, scope)`); 資料通道 `channels.select` / `channelMembers.select` 經 `operOrm` 包裝 `scopeSelect`(系統管理者全部; 非 select / 非陣列結果對一般使用者回 `[]`); `authorizeExec`(只放行已識別者之 select)不變 | `server/access.mjs` 之 `scopeChannels` / `scopeIds` / `scopeSelect`; `server/WWebTask.mjs` 之 `operOrm`; `server/procCore.mjs` 之 `getStats` | 已套 | `grep -n "scopeSelect\|scopeChannels\|scopeIds" server/access.mjs server/WWebTask.mjs` |
| **R-AUTHZ-07 呼叫者登錄 fail-closed**: 資料通道函數只收 `userId`, 角色於 `getUserIdByToken` 通過當下 `access.remember` 登錄; 函數呼叫前 `access.callerOf(userId)` 查回, 無登錄 / 逾期(60 秒)/ userId 非字串一律 reject `errUserIdMissing`; 只有 `getUserIdByToken` 寫入登錄 | `server/access.mjs` 之 `kpCaller` / `remember` / `callerOf`; `server/WWebTask.mjs` 之 `kp`、`operOrm`、`getUserIdByToken` | 已套 | `grep -n "access.remember(\|access.callerOf(" server/WWebTask.mjs`(`remember` 1 處〔getUserIdByToken〕, `callerOf` 2 處〔`kp`、`operOrm`〕) |
| **R-AUTHZ-08 系統函數只公開 `[sys:getFuncList]`**(`sysFuncsPublic`; `[sys:polling]`、`[sys:getTableTags]` 須有效身分; 前端元件隨 w-serv-hapi 1.1.8 / w-serv-webdata 1.1.16 / w-serv-broadcast 1.1.12 升版, 輪詢帶 token) | `server/WWebTask.mjs` 之 `WServHapiServer` 選項 | 已套 | `grep -n "sysFuncsPublic" server/WWebTask.mjs` |
| **R-AUTHZ-09 測試權杖只在非 production**: `{token-for-member}`(id-for-member, 一般使用者, 測試中為頻道 A 成員)、`{token-for-outsider}`(id-for-outsider)、`{token-for-appuser}`(綁 id-for-member 之應用系統 token・使用者用途)、`{token-for-appadmin}`(綁系統管理者)、`{token-for-appsys}`(`app:key-for-test`・系統服務用途); `verifyClientUser` / `verifyAppUser` 僅對 `id-for-member` / `id-for-outsider` 另放行(`isTestOrdinaryUser`, 同受 NODE_ENV 守門); `id-for-nonadmin` 仍被拒(守 D17-3) | `srv.mjs` | 已套 | `grep -n "NODE_ENV !== 'production'" srv.mjs`(每個測試權杖與 `isTestOrdinaryUser` 皆含) |
| **R-AUTHZ-10 變異驗證(2026-10-25; 腳本 `mutate.mjs`〔暫存檔, 備份於任務報告資料夾 `task-run01-evidence/`, 不在 repo〕單點替換 → 跑 `unit-access` + `api-callerMatrix`〔92 案: unit-access 13 + 矩陣 79〕→ 還原並以 SHA-256 回驗; 外審補修後之最終版)**: 25 個變異**全數被抓到**(0 存活; 最終跑於外審補修後之凍結碼, 2026-10-25 12:46〜12:51) | 見下表 | 已套 | 重跑: 依下表對 `server/access.mjs` / `server/WWebTask.mjs` 單點施加(Edit 工具, 一次一個, 跑完 `git diff` 或雜湊確認還原) |

| 變異 | 內容 | 抓到之失敗案數 |
|---|---|---|
| M1 | C3: `getUserIdByToken` 回退為只取 `getUserByToken` 之 id(不呼叫 `verifyClientUser`、不驗欄位) | 4 |
| M1b | C3: 執行身分不看 `verifyClientUser` 之否定結果 | 3 |
| M2 | C2: `requireAdmin` 恆放行(拿掉管理類之角色檢查) | 14 |
| M3 | C2: `requireChannel` 恆放行(拿掉訊息等頻道內容之成員檢查) | 27 |
| M3b | C2: `requireTask` 只檢查任務存在(拿掉任務之成員檢查) | 18 |
| M4 | 第 128 項: 拿掉 `sysFuncsPublic`(回預設三者皆公開) | 1(輪詢案) |
| M5 | C2b: `scopeSelect` 回整表 | 3 |
| M5b | C2b: `operOrm` 不經 `scopeSelect` | 2 |
| M6 | C2b: `scopeChannels` 回整表 | 6 |
| M7 | C2b: `getStats` 不帶 `scope` | 3 |
| M8 | C2: `requireParticipant` 恆放行(檔案) | 7 |
| M9 | C2: `callerOf` 無登錄時視為系統管理者(fail-open) | 2 |
| M10 | C2: 角色判準放寬為「`isAdmin` 非 `'n'`」 | 1 |
| M11 | C2: `remember` 一律登錄為系統管理者 | 44 |
| M12 | C2: `saveChannelMember` 漏套 `admin` 規則(直通 procCore) | 3 |
| M13a | C2: 資料通道 `postMessage` 繞過入口函數表直呼 procCore | 2 |
| M13b | C2: HTTP `claimTask` 路由繞過入口函數表直呼 procCore | 2 |
| M14 | C2: `ackChannel` 漏套 `requireChannel`(非成員可 ack) | 1 |
| M15 | C2: `ackChannel` 一般使用者亦可經缺列路徑建列(`allowInsert` 一律 true; 授權後成員列被移除可自我加回) | 1(A11) |
| M16 | C2: HTTP `verifyAppUser` 收到原物件(非淺拷貝) | 1(C3-08) |
| M17 | C3: `verifyClientUser` 收到原物件(非淺拷貝) | 1(C3-08) |
| M18 | C2: 登錄不看序號(晚完成之舊驗證可覆蓋較新者) | 1(A2c) |
| M19 | C3: 連線閘回退為無條件刪前 7 字元(不驗 Bearer 方案) | 1(C3-07) |
| M20 | C2b: 登入檢查原樣回傳部署方之使用者物件 | 1(`getUserByToken` 案) |
| M21 | C2: `callerOf` 不驗逾期(登錄永久有效) | 1(A2) |

**入口 × 呼叫者全集與實測**: `test/api-callerMatrix.test.mjs`——呼叫者 7 類(無 token、一般使用者・頻道 A 成員、一般使用者・非成員、系統管理者、應用系統・使用者用途綁一般使用者、應用系統・使用者用途綁系統管理者、應用系統・系統服務用途); 入口 × 傳輸 66 列(業務操作 × 頻道 A / B 變體 × 資料通道 / HTTP REST, 含登入檢查、2 個表 select、`getChannels?agentId=`、修改既有列)× 7 = **462 格**, 每格各自建 fixture、讀回副作用(拒絕者零寫入; 含游標值、修改既有列、上傳實體檔); 另「入口全集」(資料通道函數清單與 HTTP 路由宣告須全在矩陣內)1 案、系統函數 2 案、輪詢 1 案(含 clientId 與身分之綁定)、通訊路由(ulctr / slc / dwgfn / dwgf / dw 未註冊監聽, 以各路由之合法請求驗證)1 案、C3 執行身分 8 案(C3-01～08: 被拒者 / 拋錯 / 查無 / 標頭與本體身分不同 / 欄位不齊 / token 形狀 / Bearer 方案 / 鉤子改寫傳入物件) = 13 案(共 79 案; 66 列各一案 + 13). 單元: `test/unit-access.test.mjs`(13: A1～A11 含 A2b / A2c)、`test/unit-mAccess.test.mjs`(3). 修前(HEAD 伺服端 + 本矩陣初版 70 案)**65 案紅 / 102 格不符 / 5 案綠**, 修後全綠. 存取表(寫入報告): 見任務報告。

## console 診斷輸出不印資料值(D22; 2026-10-31 task〔20261031023204〕; 對應 dspec `診斷輸出與遮罩.md` D2、`輸入參數之檢測機制.md` §6 V20; 取代 D15 之「不做: console 印使用者物件 (N7)」)

規則以「程式碼須長成什麼樣」為單位; 站點全集與判準如下, 盤點指令之 cwd 為專案根.

| 規則 | 站點全集 | 判準 | 盤點與守衛 |
|---|---|---|---|
| **R-CONSOLE-01 console 診斷只印四類內容**: ①固定詞彙(字面值、無運算式之樣板); ②型別 `describeType(v)`; ③鍵名 `describeKeys(v)`(不讀值、不執行 getter、控制字元換 `?`、至多 20 鍵、單鍵至多 32 字元); ④錯誤摘要 wsemi `getDiagBriefErr(err)`; 權杖仍一律 `maskTok`(M 契約不變). 不印使用者物件、請求本體、查詢參數值、傳入參數值、後端回傳值、錯誤物件(含 `err.message`、堆疊). 列名放行之非資料值: `apiType`(w-converhp `routeSpec` 表之固定字面)、`fpEntryIn` / `fnEntryOut`(靜態檔入口之部署路徑與固定檔名) | 活碼 46 站: `server/WWebTask.mjs` 39、`srv.mjs` 4、`g.initialData.mjs` 3(另 `srv.mjs` 兩處為註解, 非執行); 其他 `server/*.mjs`、`g.mOrm.mjs`、`g.getSettings.mjs`、`toolg/`、`src/schema/` 無 console. 全表見下 | 已套(2026-10-31): 修前 22 站輸出資料值(WWebTask 17、srv 3、g.initialData 2)全改; 其餘 24 站為固定詞彙、`maskTok` 或列名放行之非資料值; 前端 `src/` 之瀏覽器 console 不在本規則(見下「範圍外」) | 結構守衛 `test/unit-consoleSites.test.mjs`(AST 掃描: 各檔站點數固定、每引數合規、無 console 別名); 重跑 `grep -rnE "console\.(log\|warn\|error\|info\|debug\|trace\|dir\|table)" server srv.mjs g.initialData.mjs g.mOrm.mjs g.getSettings.mjs toolg src/schema`(應為上表 46 行 + 2 行註解) |
| **R-CONSOLE-02 以含識別值之測資觸發各站點, console 不含該值**: 同一識別值 `ZZ-secret-9317` 置於使用者物件之各欄位與額外欄位、請求本體(JSON 陣列、JSON 字串字面值、非 JSON 長字串)、查詢參數、建構參數(WOrm / url / db / 三個注入函數)、後端錯誤原文(ORM 初始化、SSO 回傳值與 HTTP 500 本文、種子腳本之資料庫與檔案錯誤) | 動態觸發: `server/WWebTask.mjs` 之建構檢核 6 站、ORM 初始化失敗、靜態檔入口產生失敗、checkUser 4 分支、授權不通過 2 處、無效本體、`req.query`、token 查無、連線閘無效 token、執行身分 3 分支(真實 WWebTask 子行程); `srv.mjs` 3 站(副本 + 假 SSO); `g.initialData.mjs` 2 站(副本). 不可由外部穩定觸發而僅由結構測試守者: 靜態檔入口 `fpEntryIn` 行以外之固定詞彙行、`/api/getUserByToken` 之 `!iseobj(user)` 防禦分支(`getAndVerifyClientUser` 回傳之使用者必為非空物件, 不可達)與 `srv.mjs` 之 `ssoAppToken 未設定` 行(副本須帶 app token 才走 SSO 站點; 固定詞彙) | 已套: 每站 console 輸出段含預期之安全形態(證明站點確實觸發), 且全部 stdout / stderr 不含識別值、其頭尾片段(`ZZ-s`、`9317`)、使用者信箱網域與堆疊框; 回應 key 與同步拋錯不變 | `test/api-consoleLeak.test.mjs`(CL-A 21 案、CL-B 4 案、CL-C 2 案; port 11310 / 11311 / 11312); 子行程 `test/tools/consoleLeakChild.mjs`; 副本置換之錨點(srv.mjs 兩行 import、g.initialData.mjs 之 import 與 `dbfDir`)改動時 `patch()` 會明確失敗而非略過 |
| **R-CONSOLE-03 變異驗證**: 還原任一站點為修前寫法、拿掉 `maskTok`、新增站點、console 別名、放寬掃描器、破壞 `describeKeys` / `describeType` 之任一性質, 皆須被抓到 | 見下「變異表」 | 已套(變異 39 個, 對照組全綠; 結果見下) | 變異腳本為暫存工具(`./tmp/task/mutate.mjs`, 已清); 重做時依下表之「變異」欄逐一還原並跑 `unit-consoleSites` + `api-consoleLeak` |

**範圍外(明知不處理)**: ①`src/` 前端之瀏覽器 console 共 43 處活碼(App.vue 5〔`login success` 印使用者物件 `cloneDeep(data.user)`、`login error` 印登入回應 `cloneDeep(data)`、`urlRedirect` 值〕、main.js 2、plugins/mUI.mjs 1、StatsView.vue 2、Composer.vue 5、ChatView.vue 7、LayoutContentTasks.vue 8、LayoutContentMembers.vue 8、LayoutContentChannels.vue 5): 屬使用者自己瀏覽器之開發者工具, 非伺服端診斷輸出, 且本輪不改畫面; **其中 App.vue:56、63 印使用者物件與登入回應, 列待裁示**(狀態檔). ②相依套件(w-converhp、w-serv-hapi 等)自身之 console. ③`WServOrm init failed` 後之 `throw err` 原樣轉拋(非 console; 由 w-serv-orm 丟出前遮罩).

**R-CONSOLE-03 變異表**(2026-10-31; 每個變異於獨立副本套用, 跑 `unit-consoleSites` + `api-consoleLeak` 共 43 案; 對照 CTRL 不變異 43 passing／0 failing; 39 個變異全數被抓到, 0 存活):

| 變異 | 內容 | 抓到之案例 |
|---|---|---|
| W01～W06 | 還原建構參數檢核 6 站之一為印傳入值(WOrm / url / db / getUserByToken / verifyClientUser / verifyAppUser) | CS-S-02、CL-A-C01～C06(各對應一)、CL-A-G |
| W07 | 還原 `WServOrm init failed` 印錯誤物件 | CS-S-02、CL-A-C07、CL-A-G |
| W08、W09、W10、W11 | 還原 checkUser 四分支之一為印 `pickUser(user)`(id 缺 / email 缺 / name 缺 / isAdmin 非 y 或 n) | CS-S-02、CL-A-R01～R04(各對應一; W08 另抓 R11)、CL-A-G |
| W12 | 只還原 `user.isAdmin` 值之印出(鍵名站點維持) | CS-S-02、CL-A-R04、CL-A-G |
| W13、W14 | 還原授權不通過之使用者投影(登入檢查 / app 路由) | CS-S-02、CL-A-R05 / R06、CL-A-G |
| W15 | 無效請求本體還原為 `maskTok(payload)`(修前寫法, 露頭尾字元) | **僅動態**: CL-A-R07、CL-A-G(AST 放行 `maskTok`) |
| W16 | 靜態檔入口產生失敗還原為 `console.log(err)` | CS-S-02、CL-A-C08、CL-A-G、CL-B-G |
| W17 | `req.query` 還原為印整包查詢物件 | CS-S-02、CL-A-R08、CL-A-G |
| W18 | 拿掉 `getTokenUser` 之 `maskTok`(印原 token) | CS-S-02、CL-A-R09 |
| W19 | 拿掉 verifyConn 之 `maskTok(authorization)` | CS-S-02、CL-A-R10、CL-A-G |
| W20 | verifyConn 之 `apiType` 站點改印請求標頭 | CS-S-02、CL-A-R10、CL-A-G |
| V01、V02、V03 | `srv.mjs` 還原 SSO `state` / SSO 例外印錯誤物件 / `'error'` 事件印原文 | CS-S-02、CL-B-01 / CL-B-02(另 CS-S-04) / CL-B-03(V01、V02 另 CL-B-G) |
| V04 | `briefSsoErr` 內改帶回應本文(放行函數之內部) | **僅動態**: CL-B-02、CL-B-G(AST 只看被呼叫者名稱) |
| G01、G02 | `g.initialData.mjs` 還原 `err.message` / 錯誤物件 | CS-S-02、CL-C-02 / CL-C-01 |
| H01 | `describeType` 帶出值 | CS-H-01、CS-H-02、CS-H-05、CS-H-06 與 CL-A 多案(共 9 案) |
| H02 | `describeKeys` 帶出值 | CS-H-02、CS-H-03、CS-H-04、CS-H-06 與 CL-A 多案(共 13 案) |
| H03、H04、H05 | `describeKeys` 不去控制字元 / 不截斷長鍵名 / 不限鍵數 | CS-H-04 |
| H06 | 取鍵名改用會執行 getter 之 `Object.entries` | CS-H-03 |
| H07 | 取鍵名失敗時拋錯(不回型別描述) | CS-H-05 |
| H08 | 陣列當物件列索引 | CS-H-02 |
| S01 | 新增一個印傳入值之站點 | CS-S-01、CS-S-02 |
| S02 | 新增 console 別名 `let log = console.log` | CS-S-03 |
| S03 | 遮罩函數之外多帶一個使用者物件引數 | CS-S-02、CL-A-R01、R11、G |
| S04 | 掃描器放行任何識別字 | CS-R-01、CS-R-03、CS-R-04 |
| S05 | 掃描器漏掉 `console.warn` | CS-R-03、CS-R-05 |

**R-CONSOLE-01 站點全表**(行號: HEAD → 現行; 判定: 資料值＝輸出資料值須改、權杖＝`maskTok` 照舊、固定＝固定詞彙、非資料值＝列名放行、註解＝非執行):

| # | 站點 | 修前輸出內容 | 判定 | 改後 |
|---|---|---|---|---|
| 1 | WWebTask.mjs 79 → 82 | `invalid WOrm` + 傳入值 | 資料值(傳入參數) | `invalid WOrm (typeof …)` |
| 2 | 86 → 89 | `invalid url` + 傳入值(含帳密之連線字串或物件) | 資料值(傳入參數) | `invalid url (typeof …)` |
| 3 | 93 → 96 | `invalid db` + 傳入值 | 資料值(傳入參數) | `invalid db (typeof …)` |
| 4 | 100 → 103 | `invalid getUserByToken` + 傳入值 | 資料值(傳入參數) | `invalid getUserByToken (typeof …)` |
| 5 | 107 → 110 | `invalid verifyClientUser` + 傳入值 | 資料值(傳入參數) | `invalid verifyClientUser (typeof …)` |
| 6 | 114 → 117 | `invalid verifyAppUser` + 傳入值 | 資料值(傳入參數) | `invalid verifyAppUser (typeof …)` |
| 7 | 205 → 209 | `WServOrm init failed` + 錯誤物件(訊息、堆疊; 實測識別值仍在) | 資料值(後端錯誤原文) | `WServOrm init failed { errType, errCode? }` |
| 8 | 338 → 344 | `user` + 使用者投影(id / name / email / isAdmin 之值) | 資料值(使用者物件) | `invalid user (keys: …)` |
| 9 | 339 → 345 | `can not get the userId` | 固定 | 不動 |
| 10 | 344 → 350 | 同 8(email 缺) | 資料值(使用者物件) | `invalid user (keys: …)` |
| 11 | 345 → 351 | `can not get the email of user` | 固定 | 不動 |
| 12 | 350 → 356 | 同 8(name 缺) | 資料值(使用者物件) | `invalid user (keys: …)` |
| 13 | 351 → 357 | `can not get userName` | 固定 | 不動 |
| 14 | 356 → 362 | 同 8(isAdmin 非 y / n) | 資料值(使用者物件) | `invalid user (keys: …)` |
| 15 | 357 → 363 | `user.isAdmin is not y or n` + `isAdmin` 之值 | 資料值(使用者欄位) | `… (typeof …)` |
| 16 | 358 → 364 | `can not get the role of user` | 固定 | 不動 |
| 17 | 380 → 386 | `token` + `maskTok(token)` | 權杖 | 不動 |
| 18 | 381 → 387 | `can not find the user from token` | 固定 | 不動 |
| 19 | 433 → 439 | `user` + 使用者投影(登入檢查被拒) | 資料值(使用者物件) | `denied user (keys: …)` |
| 20 | 434 → 440 | `user does not have permission` | 固定 | 不動 |
| 21 | 457 → 463 | `user` + 使用者投影(app 路由被拒) | 資料值(使用者物件) | `denied user (keys: …)` |
| 22 | 458 → 464 | `user does not have permission` | 固定 | 不動 |
| 23 | 480 → 486 | `payload` + `maskTok(payload)`(請求本體之頭尾字元; 陣列逐元素) | 資料值(請求本體片段) | `payload (typeof …)`(array / string / object) |
| 24 | 481 → 487 | `invalid payload in req` | 固定 | 不動 |
| 25 | 506 → 512 | `fpEntryIn` + 靜態檔入口之部署路徑(由 `dist` 與常數組成) | 非資料值 | 不動(列名放行) |
| 26 | 518 → 524 | `console.log(err)`(fs 或 Error 之訊息與堆疊) | 資料值(後端錯誤原文) | `generate index.html error { errType, errCode? }` |
| 27 | 519 → 525 | `can not generate index.html` | 固定 | 不動 |
| 28 | 538 → 544 | `req.query` + `maskQuery(query)`(token 鍵遮罩, 其餘鍵之值原樣) | 資料值(查詢參數值) | `req.query (keys: …)` |
| 29 | 539 → 545 | `token` + `maskTok(token)`(重複 `?token=` 為陣列) | 權杖 | 不動 |
| 30 | 540 → 546 | `[API]getUserByToken/check token: invalid token` | 固定 | 不動 |
| 31 | 549 → 555 | `token` + `maskTok(token)` | 權杖 | 不動 |
| 32 | 550 → 556 | `[API]getUserByToken/check user: invalid user` | 固定 | 不動 |
| 33 | 1050 → 1056 | `apiType` + 路由表之固定字面(`main` 等) | 非資料值 | 不動(列名放行) |
| 34 | 1051 → 1057 | `authorization` + `maskTok(authorization)` | 權杖 | 不動 |
| 35 | 1052 → 1058 | `invalid token` | 固定 | 不動 |
| 36 | 1081 → 1087 | `token` + `maskTok(token)` | 權杖 | 不動 |
| 37 | 1082 → 1088 | `can not get the userId from token` | 固定 | 不動 |
| 38 | 1087 → 1093 | `token` + `maskTok(token)` | 權杖 | 不動 |
| 39 | 1088 → 1094 | `user does not have permission for execution` | 固定 | 不動 |
| 40 | srv.mjs 122 → 133 | `ssoAppToken 未設定, 略過 SSO 驗證` | 固定 | 不動 |
| 41 | 132 → 143 | `SSO getSsoUserInfor 失敗` + SSO 回傳之 `state` | 資料值(後端回傳值) | 固定詞彙(不帶 state) |
| 42 | 140 → 151 | `SSO getSsoUserInfor error` + `err.name`、`cause.code`、HTTP 狀態碼 | 資料值(錯誤名可被改寫、非白名單; 非單一實作) | `… briefSsoErr(err)` → `{ errType, errCode?, httpStatus? }` |
| 43 | 152 → 163 | `// console.log('verifyClientUser/user', user)` | 註解(非執行) | 不動 |
| 44 | 170 → 181 | `// console.log('verifyAppUser/user', user)` | 註解(非執行) | 不動 |
| 45 | 190 → 202 | `console.log(err)`(`'error'` 事件之原文) | 資料值(後端 / 驅動錯誤原文) | `WWebTask error event { errType, errCode? }` |
| 46 | g.initialData.mjs 279 → 280 | `clear dbf warn` + `err.message`(含路徑與資料值) | 資料值(後端錯誤原文) | `clear dbf warn { errType, errCode? }` |
| 47 | 282 → 283 | `finish.` | 固定 | 不動 |
| 48 | 293 → 294 | `initialData catch` + 錯誤物件 | 資料值(後端錯誤原文) | `initialData catch { errType, errCode? }` |

(表列 48 行 = 活碼 46 站 + 註解 2 行〔43、44〕; 活碼中資料值 22 站〔1～8、10、12、14、15、19、21、23、26、28、41、42、45、46、48〕、權杖 6 站〔17、29、31、34、36、38〕、固定詞彙 16 站、非資料值 2 站〔25、33〕.)

