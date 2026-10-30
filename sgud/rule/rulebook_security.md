# 規則帳本分冊:權杖外洩防護(w-web-task)

本檔為 `sgud/rule/rulebook.md` 之分冊(2026-10-22 依全域 §14 拆分): 以下各節自主檔原樣搬移, 節號與標題不變、不刪內容; 體例、盤點指令之 cwd 慣例、`git grep` 不搜未追蹤檔之注意事項同主檔。索引見 `rulebook.md`。

## 權杖外洩防護(D15; 對應 w-web-sso ADR-068 之 W / M / K 契約)

| 規則 | 站點全集 | 判準 | 盤點指令 |
|---|---|---|---|
| 注入函數(`getUserByToken` / `verifyClientUser` / `verifyAppUser`; 原第四個選填 `opt.getUserById` 隨 w-serv-orm 移除, 2026-10-14 起由 D17-1 於入口拒絕)只經 `wrapInjected`: srLog 初始化後以包裝版取代參數本身, 其後才有呼叫 | 包裝 `server/WWebTask.mjs` 之三行 `= wrapInjected(`; 呼叫點: getTokenUser(getUserByToken)、getAndVerifyClientUser 與 `p.checkToken`(verifyClientUser, 後者 2026-10-14 起, D17-3)、getAndVerifyAppUser(verifyAppUser)、getUserIdByToken(getUserByToken) | 已套(呼叫點行號皆大於包裝行) | `git grep -nE "\b(getUserByToken\|verifyClientUser\|verifyAppUser)\(" -- server/WWebTask.mjs` 之每筆呼叫行號須大於 `git grep -n "= wrapInjected(" -- server/WWebTask.mjs` |
| 上游拋錯 / reject 視同否定結果(getUserByToken → `null`; verify 系 → `false`); 失敗記 `srLog.warn({ event:'inject-<名>-fail', ... })`(`WWebTask.mjs:166`), 只含 K 契約白名單 key 或 `upstreamType` / `upstreamName`, 絕不記原文 | `server/wrapInjected.mjs` | 已套; 守 `unit-wrapInjected`、`api-tokenLeak` | — |
| **白名單同步點**: `keysUpstream`(`server/wrapInjected.mjs:15`)須與 w-web-sso K 契約之 14 key 一致; sso 增刪 helper 之 reject key 時同步改此處與 `test/unit-wrapInjected.test.mjs` 之 `KEYS_K` | `server/wrapInjected.mjs` ↔ w-web-sso `spec/設計要點與取捨.md` ADR-068 | 已套 | `git grep -n -A16 "let keysUpstream" -- server/wrapInjected.mjs` |
| 印權杖只經 `server/maskLog.mjs`(`maskTok` / `maskQuery` / `maskUrl`, 與 sso `maskToken`、perm / api `maskTok` 同一組測資); 錯誤只記名稱與代碼 | 後端 console 之權杖類參數; `srv.mjs:105` SSO 例外只印 `err.name` / `cause.code` / 狀態碼 | 已套 | `git grep -nE "console\.(log\|error\|warn\|info)\(.*(token\|query\|authorization\|headers\|referer\|payload)" -- server srv.mjs`(權杖值參數須皆經 mask; 其餘為固定字串) |
| srLog 不記權杖與上游原文 | srLog 全站點: 無 token / authorization / query / headers / referer 欄; `err` 只為自家 key 或 `describeUpstream` 之結果(外來值——`woItems` / 驅動例外原文——出口 7 站與轉拋 4 站一律先經 `diag.mask` / `diag.err`, R-ORMDIAG-06); 另 `orm-diag`(wsemi `genDiagFunLog` 轉接, 只記 `label` 與 w-serv-orm 之 `safe`, 不記 `detail`; D21 / R-ORMDIAG-02; 舊 `server/ormDiagLog.mjs` 已於 2026-10-29 刪除) | 已套 | `git grep -nE "srLog\.(info\|warn\|error)\(" -- server` |
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

