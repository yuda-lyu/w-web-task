# 規則帳本分冊:多人同時編輯(原則 10)之盤點(w-web-task)

本檔為 `sgud/rule/rulebook_concurrency.md` 之分冊(2026-10-23 第二波落地後依全域 §14 與 inv01 之建議拆分): 收錄第 1 節(欄位三分類)、第 2 節(業務函式與寫入者全集, 含所用 ORM 與 useCache)、第 3 節(前端資料流: 草稿被覆蓋與部分寫入之全部路徑), **節號、標題與內容自主檔原樣搬移, 不刪不改**(行號為 2026-10-22 盤點時之值, 改碼後以各節之盤點指令重取; 第二波實作後之現況見主檔「9. 第二波實作現況」)。索引與規則總表見主檔。

## 1. 欄位三分類(第 1 項)

分類依規格第 4 節: **客戶端欄位**(只由後台經存檔寫入; 入基準; 存檔採用客戶端值)、**雙方欄位**(後台可改且系統亦會寫; 入基準; 系統直寫須取表鎖)、**伺服器專有**(只由系統寫; 不入基準; 存檔保留庫內值)。

**統計**: 7 表 94 欄 = 客戶端 **9**、雙方 **0**、伺服器專有 **85**(其中 5 表全欄伺服器專有, 不適用基準)。

| 表 | 欄數 | 客戶端 | 雙方 | 伺服器專有 | 有後台整表編輯頁 |
|---|---|---|---|---|---|
| channels | 12 | 5 | 0 | 7 | 是(`LayoutContentChannels.vue`) |
| channelMembers | 12 | 4 | 0 | 8 | 是(`LayoutContentMembers.vue`; 後台區與頻道聊天頁成員視窗共用) |
| messages | 13 | 0 | 0 | 13 | 否(純新增 + 系統搬移) |
| messagesArchive | 13 | 0 | 0 | 13 | 否(系統搬移冷表) |
| tasks | 17 | 0 | 0 | 17 | 否(狀態機; 頁面按鈕為「重試 / 代回」命令, 非整表存檔) |
| tasksArchive | 17 | 0 | 0 | 17 | 否 |
| files | 10 | 0 | 0 | 10 | 否(純新增) |

**無雙方欄位之依據**: 後台可改之 9 欄(下列)從無系統路徑改寫其值(`git grep -n -E "\.(name|role|description|agentId|levels|ownerId|memberType|memberId)\s*=[^=]" -- server` 無命中; 系統建立之成員列 `memberType:'agent'`、`role:'member'` 僅發生在**新增列**: `procCore.mjs:102`、`:529-536`, 屬「列新增」而非欄位改寫, 於第 5.3 節處理)。

### 1.1 channels(`src/schema/tables/channels.mjs`)

| 欄 | 類 | 判定依據 |
|---|---|---|
| id | 伺服器專有(主鍵; 基準以 id 為鍵, 不入摘要) | `channels.mjs:12` pk; 新列由 `funNew` 產生(`:65`); 前端新列之臨時 id 於送出前刪除(`LayoutContentChannels.vue:641`) |
| order | 伺服器專有 | grid 無此欄(`LayoutContentChannels.vue:219-227` tabKeys、`:383-389` 可編輯鍵皆無); 唯一讀者 `ChannelTree.vue:150` 排序; 寫入者僅種子 `g.initialData.mjs` 與前端 pass-through(`procCore.mjs:82`)。若日後開放編輯再改列客戶端並決定是否設 `orderKey`(現況存檔不重編 order) |
| name | 客戶端 | 可編輯(`:384`); 前端檢查必填且不重複(`:298-330`) |
| description | 客戶端 | 可編輯(`:386`) |
| agentId | 客戶端 | 可編輯(`:387`); 副作用: `saveChannel` 連帶建主責 agent 成員列(`procCore.mjs:98-106`) |
| levels | 客戶端 | 可編輯(`:385`) |
| ownerId | 客戶端 | 可編輯(`:388`); 新列預設當前使用者(`:471`)。語意為「建立者」但 UI 可改, 依規格 §3「擁有者語意欄位須入 fields」列客戶端 |
| userId | 伺服器專有 | 操作者 / 建立者稽核欄(`channels.mjs:41`); `funNew` 以操作者填(`procCore.mjs:91`); 更新路徑 pass-through 可被客戶端改寫(O6 實證)→ 第二波不採用客戶端值 |
| timeCreate | 伺服器專有 | `funNew`(`channels.mjs:66`) |
| userIdUpdate | 伺服器專有 | `procCore.mjs:85`(寫入處補填) |
| timeUpdate | 伺服器專有 | `procCore.mjs:84`; grid 顯示但唯讀(不在可編輯鍵) |
| isActive | 伺服器專有 | `funNew` 設 `'y'`(`:69`); 無任何路徑合法改為 `'n'`; 但客戶端 pass-through 可改(O6 實證)。**注意**: 資料通道 `select` 不過濾 isActive(w-serv-webdata 以 `kpExec[table].select()` 全撈, 頻道頁亦不過濾), 而 `getChannelsList`、`getChannelMembers` 過濾 `'y'`(`procCore.mjs:43,139`) → 基準之伺服端新鮮讀取須與前端取得資料之查詢條件相同 |

### 1.2 channelMembers(`src/schema/tables/channelMembers.mjs`)

| 欄 | 類 | 判定依據 |
|---|---|---|
| id | 伺服器專有(主鍵) | `channelMembers.mjs:13`; `funNew` 產生(`:66`) |
| order | 伺服器專有 | 同 channels.order: grid 無(`LayoutContentMembers.vue:265-272`), 無讀者, 種子有值 |
| channelId | 客戶端(範圍鍵) | 新列由頁面帶入(`LayoutContentMembers.vue:523`); grid 不顯示不可改。入摘要以偵測搬移, 並由清單級 API 驗證**每列 channelId = 參數 channelId**(否則 `errMemberChannelMismatch`) |
| memberId | 客戶端 | 可編輯(`:437`) |
| memberType | 客戶端 | 可編輯(`:438`); 顯示在地化只在顯示層(D14) |
| role | 客戶端 | 可編輯(`:439`) |
| lastSeenMessageId | **伺服器專有** | 唯一合法寫入者 `ackChannel`(`procCore.mjs:520-538`, 讀者 `getChannelsList` `:49-56`); grid 顯示但唯讀(tabKeys `:270` 有、可編輯鍵 `:436-440` 無); 現況 `saveChannelMember` pass-through(`:163`)回寫舊值 = E3 |
| userId / timeCreate / userIdUpdate / timeUpdate | 伺服器專有 | 同 channels |
| isActive | 伺服器專有 | 同 channels(`getChannelMembers` 過濾 `'y'`, `procCore.mjs:139`) |

### 1.3 messages / messagesArchive(`messages.mjs`, `messagesArchive.mjs` 為其複本)

13 欄**全為伺服器專有**: `id`(`:13`)、`channelId`(`:18`)、`senderId`(`:22`)、`senderType`(`:26`)、`kind`(`:30`)、`content`(`:34`)、`taskId`(`:38`)、`attachments`(`:42`)、`userId`(`:46`)、`timeCreate`(`:50`)、`userIdUpdate`(`:54`)、`timeUpdate`(`:58`)、`isActive`(`:62`)。依據: 寫入者只有 `postMessage` / `respondTask` 新增(`procCore.mjs:267,435`)與 `postMessage` 回指 `taskId`(`:287-292`)、`archiveSweep` 複製與刪除(`:696-698`); 無後台編輯頁、無採用客戶端欄位值之路徑。`messagesArchive` 同, 僅 `archiveSweep` 以 `save` upsert 整列複製(`:696`)。

### 1.4 tasks / tasksArchive(`tasks.mjs`, `tasksArchive.mjs` 為其複本)

17 欄**全為伺服器專有**: `id`(`:13`)、`channelId`(`:18`)、`messageId`(`:22`)、`title`(`:26`)、`payload`(`:30`)、`state`(`:34`)、`assigneeId`(`:38`)、`result`(`:42`)、`errorKey`(`:46`)、`resultMessageId`(`:50`)、`timeClaim`(`:54`)、`timeDone`(`:58`)、`userId`(`:62`)、`timeCreate`(`:66`)、`userIdUpdate`(`:70`)、`timeUpdate`(`:74`)、`isActive`(`:78`)。依據與寫入者: 建立 `postMessage asTask`(`procCore.mjs:276-284`: channelId、messageId、title、payload、state)、認領 `claimTask`(`:381-388`: state、assigneeId、timeClaim)、終態 `respondTask`(`:438-447`: result、state、errorKey、resultMessageId、timeDone)、重置 `resetTask`(`:479-490`: 清空上述)、搬移 `archiveSweep`(`:672-674`)。互斥由 `kmx('task:'+id)` + `state` 守衛提供(D6)。無整表存檔 → 不適用基準。

### 1.5 files(`files.mjs`)

10 欄**全為伺服器專有**: `id`(`:12`)、`name`(`:17`)、`type`(`:21`)、`size`(`:25`)、`ext`(`:29`)、`userId`(`:33`)、`timeCreate`(`:37`)、`userIdUpdate`(`:41`)、`timeUpdate`(`:45`)、`isActive`(`:49`)。依據: 僅 `saveFile` 新增(`procCore.mjs:569-578`, 同時寫 `./dbf/<id>` 實體檔 `:572`); 無修改、無刪除路徑。

## 2. 業務函式全集與寫入者全集(第 2 項)

### 2.1 業務函式與對外路由全集(歸類依方案 v2 §3.4)

**函式全集 22** = `server/procCore.mjs` 匯出 21(`:752-774`)+ `WWebTask.mjs` 本地之 `getWebInfor`。**kpFunExt 20**(`server/WWebTask.mjs:1028-1056`, 資料通道 `/api/main` 經連線閘 `verifyClientUser`, 即**後台系統管理者**可呼叫); **HTTP 路由 16**(`WWebTask.mjs:474-927`, 以 app 權杖 `verifyAppUser` 守門, 即 **agent / 外部應用**)。

| 類(§3.4) | 函式(procCore 行) | kpFunExt 名 | HTTP 路由 | 處置 |
|---|---|---|---|---|
| 讀取(11) | `getChannelsList`(`:41`)、`getChannelMembers`(`:132`)、`getMessages`(`:199`)、`getTasks`(`:306`)、`getTask`(`:339`)、`getArchivedTasks`(`:707`)、`getArchivedMessages`(`:734`)、`getFileInfo`(`:585`)、`readFile`(`:605`)、`getStats`(`:621`)、`getWebInfor`(`WWebTask.mjs`) | 同名(`readFile` 無) | `/api/getChannels`、`/getRecentMessages`、`/getRecentTasks`、`/getTask`、`/getArchivedTasks`、`/getArchivedMessages`、`/getFileInfo`、`/getStats`、`/getFile`(binary) | 不變 |
| 清單編輯(新增 4) | (新)`saveChannels`、`deleteChannels`、`saveChannelMembers`、`deleteChannelMembers` | 新增 | 無(後台專用) | 第 5 節 |
| 單筆增改刪(4) | `saveChannel`(`:64`)、`deleteChannel`(`:114`)、`saveChannelMember`(`:146`)、`deleteChannelMember`(`:181`) | 同名 | 無 | 保留並收緊: 修改只改不增、刪除未命中 `rowNotFound`、不採用伺服器專有欄位、取表鎖; 前端不再呼叫(R-CONC-08) |
| 狀態機(3) | `claimTask`(`:359`)、`respondTask`(`:398`)、`resetTask`(`:457`) | 同名 | `/api/claimTask`、`/respondTask`、`/resetTask` | 沿用 `task:<id>` 鎖內 `state` 守衛; 不帶基準(外部呼叫); 修改帶 `autoInsert:false` |
| 游標(1) | `ackChannel`(`:500`) | 同名 | `/api/ackChannel` | `lastSeenMessageId` 伺服器專有; 更新路徑 `autoInsert:false`, 缺列路徑改取表鎖重做(第 5.4 節) |
| 純新增(2) | `postMessage`(`:226`, 含 `asTask`)、`saveFile`(`:546`) | `postMessage`、`uploadFile` | `/api/postMessage`、`/api/uploadFile` | 不比對。見下「異議 4」: `postMessage` 不驗證頻道存在(O7), 建議補「頻道不存在 → `errChannelNotFound`」(原則 6) |
| 系統搬移(1) | `archiveSweep`(`:653`) | 無 | 無(`WWebTask.mjs:244-266` 計時器) | 修 E2: 逐筆取 `task:<id>` 鎖後重讀再搬; 不比對 UI 基準 |
| 認證(非 procCore) | — | — | `/api/getUserByToken`(`:474`) | 不涉資料表寫入 |

**歸類核對**: 讀取 11 + 單筆 4 + 狀態機 3 + 游標 1 + 純新增 2 + 系統搬移 1 = 22(未歸類 0)。kpFunExt 20 = 22 − `readFile` − `archiveSweep`(`saveFile` 以 `uploadFile` 名露出)。HTTP 16 = 15 個 JSON 路由 + `getFile`(二進位)。

**對方案 v2 §3.4 之異議 / 補充**: (1) §3.4 未列 `getWebInfor`, 補入讀取; (2) `saveChannel` 同時寫兩表(channels + channelMembers), 表鎖須兩把(依序 `channelMembers`、`channels`); (3) `ackChannel` 缺列路徑是**新增**列到成員清單, §3.4「與成員管理共用互斥範圍」須落實為: 更新路徑只取實體鎖(熱路徑, agent 輪詢頻繁), 缺列路徑取表鎖(見 5.4); (4) `postMessage` 補頻道存在檢查; (5) §3.4 之「清單編輯: 移除前端逐列迴圈」另需**刪除**之清單級 API(現況刪除亦逐列迴圈, 見 R-CONC-08), 本草案新增 `deleteChannels` / `deleteChannelMembers`(第 5 節)。

**可重跑**: kpFunExt 20: `sed -n '/kpFunExt: {/,/^        },/p' server/WWebTask.mjs | grep -c -E "^\s+[A-Za-z]+: wrapErrLog\("`; procCore 匯出 21: `sed -n '/^    return {/,/^    }/p' server/procCore.mjs | grep -c -E "^\s+[A-Za-z]+,$"`; 路由 16: `git grep -c -E "path: '/api/" -- server/WWebTask.mjs`。

### 2.2 寫入站點全集(生產碼 30)

欄位「現況鎖」: **LS** = `lockSave`(不排隊雙擊占位, 見 D16)、**kmx** = `pmKeyMutex` 同鍵序列化、**無** = 無任何鎖。`刪除回報`: 現況對 ORM `del` 之結果不檢查命中。

| # | 表 | 檔:行 | 操作 | 入口 | 現況鎖 | 寫哪些欄位 | 刪除回報 | 第二波 |
|---|---|---|---|---|---|---|---|---|
| W01 | channels | procCore.mjs:86 | save([o]) | saveChannel(有 id) | LS `saveChannel:{userId}:{id\|name}`(`:75`) | `pick(row, ds.channels.keys)` 全 12 欄(客戶端帶入者)+ id + timeUpdate + userIdUpdate; autoInsert 預設 true | — | 表鎖 + `autoInsert:false` + 只寫 5 客戶端欄 + 稽核 |
| W02 | channels | :92 | insert(o) | saveChannel(無 id) | 同上 | `funNew({...row, userId})` 全欄 | — | 表鎖; 不比對 |
| W03 | channelMembers | :103 | insert(m) | saveChannel 連帶建主責 agent 列 | LS(外層)+ kmx `channelMember:<channelId>:<agentId>`(`:99`) | `funNew({channelId, memberId:agentId, memberType:'agent', userId})` | — | 表鎖(channelMembers, channels 兩把) |
| W04 | channels | :124 | del({id}) | deleteChannel | LS `deleteChannel:{userId}:{id}`(`:122`) | — | **回 ORM 原結果, 未命中仍 resolve**(O2) | 表鎖 + 未命中 `rowNotFound`; 連帶清理引用待裁示 Q2 |
| W05 | channelMembers | :167 | save([o]) | saveChannelMember(有 id) | LS `saveChannelMember:{userId}:{id\|channelId:memberId}`(`:157`) | `pick(row, ds.channelMembers.keys)` 全 12 欄**含 lastSeenMessageId**(E3)+ 稽核; autoInsert true(O1) | — | 表鎖 + `autoInsert:false` + 只寫 4 客戶端欄 |
| W06 | channelMembers | :172 | insert(o) | saveChannelMember(無 id) | 同上 | `funNew({...row, userId})` | — | 表鎖; 新列唯一性待決(Q5) |
| W07 | channelMembers | :191 | del({id}) | deleteChannelMember | LS `deleteChannelMember:{userId}:{id}`(`:189`) | — | 同 W04(O2) | 表鎖 + `rowNotFound` |
| W08 | messages | :267 | insert | postMessage | LS `postMessage:{userId}:{channelId}`(`:245`)+ kmx `postMessage:<channelId>`(`:248`) | funNew 全欄 | — | 不變(補頻道存在檢查) |
| W09 | tasks | :284 | insert | postMessage(asTask) | 同上 | funNew 全欄(state 'pending') | — | 不變 |
| W10 | messages | :287 | save | postMessage(asTask)回指 | 同上 | id、taskId、timeUpdate、userIdUpdate | — | 不變(僅新建列, 同鎖內) |
| W11 | tasks | :381 | save | claimTask | kmx `task:<id>`(`:367`) | id、state、assigneeId、timeClaim、稽核 | — | 沿用; 補 `autoInsert:false` |
| W12 | messages | :435 | insert | respondTask(taskReply) | kmx `task:<id>`(`:412`) | funNew 全欄 | — | 沿用(O8: 與 W13 非原子, 見第 6 節) |
| W13 | tasks | :438 | save | respondTask | 同上 | id、result、state、errorKey、resultMessageId、timeDone、稽核 | — | 沿用; 補 `autoInsert:false` |
| W14 | tasks | :479 | save | resetTask | kmx `task:<id>`(`:465`) | id、state、result、errorKey、assigneeId、timeClaim、timeDone、resultMessageId(清空)、稽核 | — | 沿用; 補 `autoInsert:false` |
| W15 | channelMembers | :520 | save | ackChannel(有列) | kmx `channelMember:<channelId>:<userId>`(`:512`) | id、lastSeenMessageId、稽核; autoInsert true(O3) | — | 更新路徑 `autoInsert:false`(未命中 → 走 W16) |
| W16 | channelMembers | :537 | insert | ackChannel(缺列) | 同上 | funNew + role 'member'、lastSeenMessageId | — | 缺列路徑取表鎖(5.4) |
| W17 | files | :578 | insert([row]) | saveFile / uploadFile | 無 | funNew({name,type,ext,userId}) + size; 另寫實體檔 `:572` | — | 不變(純新增) |
| W18 | tasksArchive | :672 | save(tsOld) | archiveSweep | 無(僅 `lockingForArchive` 旗標防計時器重入, `WWebTask.mjs:245-262`) | 整列複本(upsert) | — | 逐筆 `task:<id>` 鎖內重讀後複製 |
| W19 | tasks | :674 | del({id}) | archiveSweep | 無 | — | **不檢查**; 刪前不重讀(E2) | 同上; 鎖內重讀仍符條件才刪 |
| W20 | messagesArchive | :696 | save(msOld) | archiveSweep | 無 | 整列複本 | — | 守衛集合改取「實際搬走之任務」 |
| W21 | messages | :698 | del({id}) | archiveSweep | 無 | — | 不檢查 | 同 W19 |
| W22 | channels | g.initialData.mjs:258 | delAll | 離線工具 `initialData()` | 無(與服務互斥) | — | — | 不變(R-CONC-13) |
| W23 | channels | :259 | insert | 同上 | 同上 | 種子全欄 | — | 不變 |
| W24 | channelMembers | :261 | delAll | 同上 | 同上 | — | — | 不變 |
| W25 | channelMembers | :262 | insert | 同上 | 同上 | 種子全欄 | — | 不變 |
| W26 | messages | :264 | delAll | 同上 | 同上 | — | — | 不變 |
| W27 | messages | :265 | insert | 同上 | 同上 | 種子全欄 | — | 不變 |
| W28 | tasks | :267 | delAll | 同上 | 同上 | — | — | 不變 |
| W29 | tasks | :268 | insert | 同上 | 同上 | 種子全欄 | — | 不變 |
| W30 | files | :271 | delAll | 同上(另清 `./dbf`) | 同上 | — | — | 不變 |

**他路徑核對**: ①資料通道(`/api/main`)之表操作只開 `select`(D17-2; `tableNamesExec`/`methodsExec`, `WWebTask.mjs:967-969`), 經 `procOrm` 之寫入不可達, 故 `procOrm` 在本套件無寫入站點(`git grep -n "procOrm" -- server` 僅 deps 傳遞與 `operOrm`); ②測試夾具 17 站點(`test/unit-procCore.test.mjs`、`test/tools/seed-archived-task.mjs:33`)為測試用, 不入全集; ③`./dbf` 檔案實體寫入(`procCore.mjs:572`)隨 W17。

### 2.3 所用 ORM 實例與 useCache 設定

- ORM: `w-orm-lmdb`(`srv.mjs:1`; 實裝 1.0.42), 經 `w-serv-orm`(實裝 1.1.15)`WServOrm(ds, WOrm, url, db)`(`WWebTask.mjs:183`)建一個實例; 取 `{ woItems, procOrm }`(`:190`)。每表一個 `new WOrm({ url, db, cl })`(`node_modules/w-serv-orm/src/getWoItems.mjs:39`), **未傳 `useCache`**, w-orm-lmdb 預設 false(`WOrmLmdb.mjs:54,82-85`) → select 直讀資料庫(R-CONC-11 已套)。
- `woItems.X.save()` 之 `autoInsert` 預設 **true**(`WOrmLmdb.mjs:707,725`): 修改不存在之列會插入(O1、O3 之根因); 寫入於 lmdb 寫交易內讀 + 合併(`merge({}, vv, v)`, `:803-844`), 單列內原子。
- 鎖管理器: `kmx = pmKeyMutex()`(`WWebTask.mjs:226`)與 `cst = cacheSt()`/`lockSave`(`:231-232`)各單一實例, 於 `procCore({ woItems, procOrm, ds, srLog, kmx, lockSave })`(`:236`)注入; **尚無表鎖**(第二波取 WServOrm 實例之 `withTabLocks`)。
- 離線工具另建實例(`g.mOrm.mjs`), 與服務互斥(R-CONC-13)。單一行程部署前提(規格 §12)成立: 服務為單一 `node srv.mjs`。
- `procCore` 之 `procOrm` 參數全檔未用(`rulebook_changes.md`「已知缺口 / 待辦」之「procCore 之 deps 收 `procOrm` 而全檔未用」條, 主控 2026-10-14 裁示保留)。

## 3. 前端資料流(第 3 項)

**資料來源**: 頻道頁取自 `$store.state.channels`(資料通道同步引擎整表推播, `src/main.js:79-82` → `UpdateTableData`, `src/store/mutations.mjs:70-72` 整表替換); 成員頁取自 RPC `getChannelMembers`(`LayoutContentMembers.vue:573`), 存入 `membersLocal` 快照, **不隨推播更新**。`channelMembers` 雖在 `tableNamesSync`(D2), 但前端無讀者(`state.channelMembers` 未被引用)。

### 3.1 草稿被覆蓋與部分寫入之全部路徑

| 路徑 | 位置 | 現況行為 | 判定 |
|---|---|---|---|
| **P1 頻道頁: 推播即重建** | `LayoutContentChannels.vue:251-281`(`channels`、`changeParams` 依賴 store.channels); 模板綁定 `:6` | 任何一次 channels 表推播(他人存、自己存、無關列、內容全同)→ `items = cloneDeep(store)` → `genOpt` 以新列取代 `opt.rows`: 草稿**靜默消失**, 而 `isModified` 仍為 true(儲存鈕仍亮、內容卻是最新)。無提示 | **E7 缺陷**(`probe-e7` 紅) |
| P2 兩頁: `isEditable` 切換 | Channels `:260-281`(依賴 `isEditable`); Members `:338-363` | 關閉編輯模式 → 重建 → 草稿丟失; `isModified` 殘留 | 缺陷(使用者操作, 但無警告) |
| P3 頻道頁: 自己刪除成功後 | `:578` 設 `isModified = false`; 刪除觸發推播(P1) | 其他列之未存修改被推播重建丟失, 且儲存鈕消失 | 缺陷(P1 之變形) |
| P4 頻道頁: 逐列存檔中途失敗 | 存檔迴圈 `:635-647`; 每列寫入觸發推播 | 已寫入列觸發推播重建 → 第 k 列起之未送草稿一併丟失, 庫內為部分寫入 | **E4 + E7 疊加** |
| P5 成員頁: 切換頻道 | `onChangeChannel` `:541-560`(`isModified = false`、`membersLocal = []`) | 靜默丟草稿(使用者操作) | 缺陷(應確認)【2026-10-23 外審補修已修: 有未存修改先確認, 取消則維持原頻道與草稿, 見 `rulebook_concurrency.md` 9.6】 |
| P6 成員頁: 存 / 刪成功後重載 | `:676`、`:755`(`getChannelMembers` 取代 `membersLocal`) | 預期行為(成功後以新資料重建) | 正常 |
| P7 成員頁: 無推播重建 | — | 快照永不自動更新 → 他人已改 / 已刪 / 游標已進,舊畫面存檔照寫(E3、O1 之成因) | 缺陷(靠基準擋) |
| **P8 ChatView 5 秒輪詢** | `ChatView.vue:245-247`、`pollRefresh :495-533` | **只更新** `messagesLocal` / `tasksLocal`; 與任何可編輯草稿無關 | **查證非草稿覆蓋路徑** |
| P9 發訊草稿 `Composer.content` | `Composer.vue:174-178`(`watch channelId → content = ''`)、`:395`(送出成功清空) | 僅切頻道或送出成功才清; 輪詢與推播不影響 | 非本原則範圍(使用者操作) |
| P10 任務頁代回草稿 `respondResult` | `LayoutContentTasks.vue:306`、`:551`、`:678-685`、`:735` | 與 `tasksLocal` 重建無關; 該頁無輪詢, 僅使用者操作後重載 | 非草稿覆蓋路徑; 競爭由狀態機守衛處理(`errTaskNotRunning`) |
| P11 頻道聊天頁成員視窗 | `ChatView.vue:93-96`(`v-if="showMembers"`, `:560`) | 同成員頁(P5–P7); 關閉視窗即銷毀元件 | 同上 |

### 3.2 部分寫入路徑

| 路徑 | 位置 | 說明 |
|---|---|---|
| PW1 頻道存檔迴圈 | `LayoutContentChannels.vue:635-647` | 逐列 `saveChannel`, 失敗 `break`; **每列都送**(含未改動之列, 全列蓋 `timeUpdate` / `userIdUpdate`); 失敗後前列已寫入且無回滾(E4) |
| PW2 頻道刪除迴圈 | `:565-571` | 逐列 `deleteChannel`, 失敗 `break`; 前列已刪 |
| PW3 成員存檔迴圈 | `LayoutContentMembers.vue:731-743` | 同 PW1; 且**新列**(無 id)在失敗後重試會**重複建立**已成功之新列(成員頁無推播重建, 草稿與 `membersLocal` 不變 → 同一份草稿再送一次; E4 探針 B) |
| PW4 成員刪除迴圈 | `:660-666` | 同 PW2 |
| PW5 `saveChannel` 兩段寫入 | `procCore.mjs:86/92` → `:103` | 先寫 channels, 後建 agent 成員列; 後者失敗則頻道已存而成員列缺(單次呼叫內部分寫入) |
| PW6 狀態機多段寫入 | `postMessage asTask`(`:267` → `:284` → `:287`)、`respondTask`(`:435` → `:438`) | 非原子; `respondTask` 於第二段失敗後重試會產生**重複 taskReply**(O8 實證)。屬狀態機 / 無跨表交易之既有限制, 不在清單頁契約內, 列待裁示 Q6 |

