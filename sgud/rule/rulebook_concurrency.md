# 規則帳本分冊:多人同時編輯(原則 10)(w-web-task)

本檔為 `sgud/rule/rulebook.md` 之分冊(2026-10-22 新增, 任務 inv01 盤點輪產出; **2026-10-23 第二波落地後依全域 §14 與 inv01 之建議拆為主檔 + 三分冊**)。體例同主檔: 以「規則」為單位, 每條列 站點全集 / 判準(已套 / 未套 / 刻意不套) / 可重跑之盤點指令。盤點指令以專案根為 cwd; **`git grep` 不搜未追蹤之檔**(新增之契約與測試檔未提交前以 Grep 工具或 `ls` 查)。

| 分冊 | 收錄 |
|---|---|
| `rulebook_concurrency.md`(本檔) | 摘要、規則總表(R-CONC-01～15 現況)、第 8 節(本輪決定與待裁示, inv01 原文)、**第 9 節 第二波實作現況**(站點對照、V1～V14 對照、變異驗證、修前紅、外審、已知不修與待裁示、改動範圍 → 測試對照) |
| `rulebook_concurrency_inventory.md` | 第 1 節欄位三分類、第 2 節業務函式與寫入者全集(W01～W30)、第 3 節前端資料流(草稿被覆蓋與部分寫入路徑 P1～P11、PW1～PW6) |
| `rulebook_concurrency_contract.md` | 第 4 節寫入契約草案、第 5 節清單級 API 設計草案(簽名、diff 規則、鎖之組合與取鎖順序) |
| `rulebook_concurrency_defects.md` | 第 6 節現存缺陷實證(E2 / E3 / E4 / E7 / O1～O8)、第 7 節第二波實作規劃 |

分冊內各節自 inv01 原樣搬移(節號、標題、內容不變; 行號為 2026-10-22 之值, 改碼後以盤點指令重取)。

## 多人同時編輯(原則 10)

**摘要**

- 上位原則: `C:\opensrcOper\sgud\proc\process_principle.md` 第 10 條(使用者 2026-10-22 裁示)。共用規格(本分冊所有「契約 / 基準 / 鎖」名詞皆依此): **`C:\opensrcOper\dspec\多人同時編輯之寫入契約.md`**(規格 1, 雜湊版本 `h1`)。定稿方案與三審採納表: `C:\opensrcOper\dnow\20261022221854\方案v2.md`(第 3.4 節為本套件之方向)。設計決策: `spec/設計要點與取捨.md` D18。
- 規格重點: 拿舊畫面存檔者**整次拒收、零寫入、保留草稿並提示重新載入**(先動先贏); 看著最新資料改者與不帶基準之外部呼叫照常寫入(後者蓋前者); 刪除先刪先贏; 任何寫入不得把伺服器專有欄位回寫成舊值、不得讓已刪之列復活、不得部分寫入; 每表一份寫入契約(前後端 import 同一檔); 每表一把表鎖(`withTabLocks`), 先表鎖後實體鎖; 不設快取。
- 本套件特點: ①**寫入不經 procOrm**(procCore 檔頭, 為避免 clearXSS 改動 markdown content / result); ②僅 `channels`、`channelMembers` 兩表有後台整表編輯頁, 其餘五表為狀態機 / 純新增 / 系統搬移; ③**無外部同步**(無 V2、V3); ④`channelMembers.lastSeenMessageId` 為伺服器專有(agent 已讀游標)。
- **現況(2026-10-23 第二波 task-run01)**: 契約、清單級 API、表鎖、補償還原、`ackChannel` 兩段式、`archiveSweep` 逐筆鎖、`respondTask` 冪等、前端草稿保護皆已實作並有測試; 規格 V1～V14 逐條有測試(V2 / V3 不適用); 變異驗證 49 個(48 被抓到、1 個等價變異); 修前紅有證據; 經 sol / beam 兩位外審並修補(見 9.6)。
- **現況(2026-10-23 第三輪 task-run02, 修正輪)**: 原待裁示 Q2 經使用者裁示「移入封存表」, **已實作**(刪頻道時該頻道之訊息與任務整列移入 `messagesArchive` / `tasksArchive`, 與成員連帶刪除同一次操作、全有或全無; D19); task-verify01 N1(編輯器開啟中收到推播丟輸入)**已修**(視同草稿; 頻道頁、成員頁)。變異驗證 後端 34(33 被抓到、1 對照綠)+ 前端 8(7 被抓到、1 存活為防禦性冗餘; 見 9.8); 另經 sol 外審採納 6 條(含補償持鎖、訊息 / 掃描共用鎖、頻道列於全部頻道搬移後才刪)。**目前無待裁示事項**。
- inv01 結論數字(可由「規則總表」之指令重跑): 7 表 94 欄 = 客戶端 9 / 雙方 0 / 伺服器專有 85; 業務函式 22(procCore 匯出 21 + `getWebInfor`); kpFunExt 20(第二波後 24); HTTP 路由 16; 生產碼寫入站點 30(procCore 21 + 離線工具 9), 未歸類 0; 缺陷實證 E2、E3、E4、E7 + 其他 O1–O8(修前探測皆紅, 第二波後皆綠; O7 之訊息 / 任務部分原待裁示, 2026-10-23 第三輪依使用者裁示實作後全綠)。

### 規則總表(2026-10-23 現況)

| 規則 | 站點全集 | 判準(現況) | 盤點指令 |
|---|---|---|---|
| **R-CONC-01** 每表每欄皆宣告三分類(客戶端 / 雙方 / 伺服器專有), 不以「排除系統欄位」推得 | 7 表 94 欄(inventory 第 1 節) | **已套**(7 / 7): 契約檔明列 `fields` 與 `serverOnly`; `unit-procCoreConcurrency`「契約: fields 與 serverOnly 不交且與 pk 合起來涵蓋 schema 全欄」守「欄位全集」 | `node --input-type=module -e "import ds from './src/schema/index.mjs'; let t=0; for (const k of Object.keys(ds)) { t+=ds[k].keys.length; console.log(k, ds[k].keys.length) } console.log('tables', Object.keys(ds).length, 'fields', t)"`(應 7 表 94 欄) |
| **R-CONC-02** 每表一份寫入契約, 前後端 import 同一檔(`src/schema/contracts/<表>.mjs`) | 7 份 + `index.mjs`: channels、channelMembers(契約工廠 `getMembersContract(channelId)`)為有基準之契約; messages、messagesArchive、tasks、tasksArchive、files 為「全欄伺服器專有、`fields: []`、不適用基準」之宣告(不交 `checkContract`) | **已套**(7 / 7) | `ls src/schema/contracts`(8 檔: 7 + index; 提交前未追蹤, `git ls-files` 為 0); `grep -rn "contracts/" server src --include=*.mjs --include=*.vue` |
| **R-CONC-03** 寫入站點全集可重跑且每站點記入口 / 鎖 / 欄位 / 刪除回報 | inventory 第 2.2 節 30 站點; 第二波後之對照見本檔 9.2 | 已盤點; 第二波後 procCore 寫入站點皆經 `chkWrite`/`runOps` 或有 `autoInsert:false` | `git grep -n -E "woItems\.[A-Za-z]+\.(insert\|save\|del\|delAll)\(" -- server`; `grep -n "woItems\[tab\]" server/procCore.mjs`(可補償單元三處) |
| **R-CONC-04** `channels` / `channelMembers` 之所有寫入者取表鎖(先表鎖後實體鎖, 依表名碼元序) | 清單 API 4 個、單筆 API 4 個(經同一核心)、`ackChannel` 缺列路徑、`postMessage`(`channels` 表鎖內重查頻道存在) | **已套**: 經 `guarded`→`guardWrite`(`TABS_CH = ['channelMembers','channels']`)或 `withTabLocks(TABS_CH, …)`; 變異 `no-tablock-guard`、`no-tablock-ack` 被抓到 | `git grep -n -E "withTabLocks\|guardWrite" -- server`(WWebTask 2 + procCore: deps、`guarded`、`ackChannel` 缺列路徑) |
| **R-CONC-05** 修改路徑只改不增(`autoInsert: false`), 已刪之列不復活 | `opModify`、`ackChannel`(兩處)、`claimTask`、`resetTask`、`postMessage` 回指 | **已套**(procCore 8 處); 變異 `single-api-revive`、`ack-autoinsert` 被抓到 | `git grep -c "autoInsert" -- server`(procCore 8) |
| **R-CONC-06** 刪除未命中一律回 `rowNotFound`(含不帶基準者); 語系鍵 `errRowNotFound` | 清單刪除 2 個、單筆刪除 2 個(`deleteChannelsCore` / `deleteMembersCore` 之 `read`); 系統搬移(`archiveSweep`)以「鎖內重讀不在即略過」處理 | **已套**; 變異 `delete-miss-ok`、`delete-members-no-scope` 被抓到 | `git grep -n "rowNotFound" -- server`(procCore 16、procLang 2) |
| **R-CONC-07** 存檔不採用客戶端之伺服器專有欄位(契約 `fields` 白名單 `pickWriteRow`) | 頻道新增 / 修改、成員新增 / 修改 | **已套**: `pick(row` 0 處; 變異 `adopt-client-server-fields` 被抓到 | `git grep -c "pick(row" -- server/procCore.mjs`(應 0)、`git grep -n "pickWriteRow" -- server` |
| **R-CONC-08** 清單編輯頁一次提交至清單級 API, 不得逐列迴圈呼叫單筆 API | 4 處前端迴圈(`LayoutContentChannels.vue` 刪 / 存、`LayoutContentMembers.vue` 刪 / 存) | **已套**(0 / 4); `unit-draft`「R-CONC-08」兩案守(src 內無單筆呼叫、清單頁呼叫皆帶 `{ baseline`) | `git grep -n -F -e '$fapi.saveChannel(' -e '$fapi.saveChannelMember(' -e '$fapi.deleteChannel(' -e '$fapi.deleteChannelMember(' -- src`(應 0) |
| **R-CONC-09** 草稿保護: 有未存修改時推播不重建編輯內容、凍結載入時基準、提示「資料已被他人更新」; 存檔被拒保留草稿; 新基準取自伺服端 | 頻道頁 `watch: channels`→`onStorePush`、成員頁 `watch: storeMembers`、兩頁 `isEditable` 切換、存檔 / 刪除成功路徑 | **已套**(頻道頁、成員頁); 純邏輯 `src/plugins/mDraft.mjs`(`unit-draft` 22 案; 第三輪增編輯器開啟中視同草稿 `decidePush({ isEditing })` 與 `src/plugins/mGridEdit.mjs`)、真瀏覽器 E2E-014 / E2E-015 兩語系(含外審補驗: 重新載入後新基準可存、切換頻道確認 P5、草稿中刪除後已刪列不復活)與 E2E-016 / E2E-017 兩語系(第三輪: 儲存格編輯器開啟中已輸入未按 Enter 時收到推播, 編輯器與輸入不丟、提示條、Esc / Enter 關閉後依一般規則); 成員頁切換頻道時有草稿先確認(P5)已做 | `ls src/plugins/mDraft.mjs src/plugins/mGridEdit.mjs`; `grep -n "decidePush\|isDirty\|isStale\|isEditorOpen" src/components/*.vue` |
| **R-CONC-10** 封存逐筆取 `task:<id>` 鎖後重讀再搬移; 訊息守衛集合取自「實際搬走」之任務 | `archiveSweep` | **已套**; 變異 `archive-no-reread`、`archive-no-task-lock`、`archive-guard-from-candidates` 被抓到 | `git grep -n "kmx('task:'" -- server/procCore.mjs`(4: claim / respond / reset / archiveSweep 迴圈內) |
| **R-CONC-11** 比對用之讀取不經 ORM 快取; 同表由同一 ORM 實例與同一鎖管理器寫入 | 單一 `WServOrm(ds, WOrm, url, db)` 實例(`WWebTask.mjs`), 未傳 `useCache`; `withTabLocks` / `guardWrite` 取自同一實例並傳入 procCore | 已套(useCache 0 處); procCore 缺 `withTabLocks` / `guardWrite` 即建構拋錯 | `git grep -n "useCache" -- server g.mOrm.mjs srv.mjs`(應 0); `git grep -n "WServOrm(" -- server g.mOrm.mjs` |
| **R-CONC-12** 取鎖順序恆為 lockSave(不排隊之雙擊占位)→ 表鎖(依表名碼元序, 一次宣告兩表)→ 實體鎖; 不可重入, 同一呼叫鏈不巢狀取同表 | procCore: lockSave 8 站點(清單 4 + 單筆 4 + `postMessage` 1 = 9 呼叫點)、kmx(`postMessage:<c>`、`task:<id>` ×4、`channelMember:<c>:<m>`: ack 第一段 / 成員刪除 `opDeleteMember` / 成員改名 `opModify` 之 `lockKey`)、`postMessage` 於 `channels` 表鎖內重查頻道存在再寫入 | **已套**: 鎖序 lockSave → 表鎖 → 實體鎖; `ackChannel` 第一段只取實體鎖、結束後才取表鎖(第二段), 無「持實體鎖等表鎖」; 清單 API 於表鎖內對「刪除成員 / 成員改名」再取 `channelMember:<c>:<m>` 實體鎖(表鎖→實體鎖方向, 與 ack 不倒置), 刪除前像於實體鎖內重讀; 以 V14 三案與「外審補驗」交錯案(人為延遲)守序列化; 變異 `delete-member-no-entity-lock`、`rename-no-entity-lock`、`ack-no-entity-lock`、`postmessage-no-channels-lock` 被抓到 | `git grep -n -E "kmx\(\|lockSave\(" -- server/procCore.mjs` |
| **R-CONC-13** 離線工具 `g.initialData.mjs` 與服務互斥(lmdb 單行程持有) | 9 站點(W22–W30) | 已套(不變; 前提文件化) | `git grep -n "g.initialData" -- test/tools server srv.mjs package.json` |
| **R-CONC-15** 刪除頻道時, 其引用 (訊息、任務) 連帶處置而不留孤兒 (原則 6; 使用者 2026-10-23 裁示 Q2「移入封存表」, 不直接刪除): 三入口共用 `buildChannelDeleteOps`; 寫入單元順序任務(逐筆, `task:<id>` 鎖內重讀)→訊息(整批, 任務搬完後才讀)→成員列→頻道列(最後刪); 全有或全無(`runOps` 補償, 檢查 `ok` 與命中); 不增 schema 欄 | 3 個入口: `deleteChannelsCore`(清單刪除、單筆刪除經此)、`saveChannelsCore` 之刪除集合; 寫入單元 `opMoveTask` / `opMoveMessages`; 讀取介面 `getArchivedTasks` / `getArchivedMessages` | **已套**(3 / 3 入口); `unit-procCoreConcurrency`「Q2」節 22 案、`api-concurrency` Q2 一案; 變異 34 個(33 被抓到, 1 對照綠, 見 9.8) | `git grep -n "buildChannelDeleteOps" -- server`(定義 1 + 使用 2); `git grep -n -E "opMoveTask\|opMoveMessages" -- server`; 搜 `opDelete('channels'` 應只在 `buildChannelDeleteOps` 內 1 處(頻道列刪除不得繞過搬移); `git grep -n "'msgarch:'" -- server`(應 2: 搬移 / 補償之 `opMoveMessages`、封存掃描之訊息階段, 兩處同一把鎖) |
| **R-CONC-14** 資料列記錄最後修改者 `userIdUpdate`; 直寫路徑補填; 清單 API 只對有變動之列補填 | 7 表皆有 `userIdUpdate`; 清單 API 未改動之列(摘要相符)不寫入、不蓋稽核欄 | **已套**; 變異 `unchanged-always-write` 被抓到; `unit-procCoreConcurrency` E3 案守「未被編輯之 agent 列最後修改者仍為 ack 者」 | `git grep -n "userIdUpdate" -- server/procCore.mjs` |

## 8. 本輪決定與待裁示(摘要; 詳見任務報告)

依原則自行決定(已記入任務 `decisions.tsv`): D-1 不改用 procOrm; D-2 `order`、`userId`、`timeCreate`、`isActive` 等歸伺服器專有; D-3 `channelMembers.channelId` 入基準並驗每列 channelId; D-4 新增刪除之清單級 API 且刪除基準逐列; D-5 保留單筆 API 並收緊; D-6 ack 兩段式(更新路徑不取表鎖); D-7 既有資料規則於清單 API 鎖內強制, 與入口一致(原則 3、4): 頻道名稱必填且不重複(現只前端擋, O5)、成員列 `channelId` = 參數(範圍完整); D-8 契約檔置 `src/schema/contracts/`(前後端同構 import); D-9 E7 以最小 Vue 重現 + 程式碼路徑取代瀏覽器實證(本輪不得動 `test/`)。成員 `memberId` 唯一性屬**新增資料規則**且現有資料可能已重複, 不自行決定, 列 Q5。

待裁示: Q1 單筆 API 去留之外部相容; Q2 刪頻道是否連帶清理成員 / 訊息 / 任務(原則 6); Q3 ORM 硬失敗之補償回滾是否實作; Q4 成員契約 `scope` 接參數或採契約工廠; Q5 成員 `(channelId, memberId)` 唯一性是否強制(現有資料可能已重複); Q6 `respondTask` / `postMessage asTask` 多段寫入之原子性(O8); Q7 新增 e2e 案與標準圖授權; Q8 確認本套件**無**預期之外部匯入功能(原則 11 之 dspec 未列 w-web-task; 若業主預期以外部清單匯入頻道 / 成員, 須另行設計並入帳本, 否則 V2 / V3 / 規格 §10 皆不適用)。

**主控 2026-10-22 之處置**(`複審-task-inv01.md`): Q1 保留並收緊; Q2 成員列連帶刪除 + 拒絕已刪頻道, **訊息與任務須使用者裁示**; Q3 實作補償; Q4 契約工廠; Q5 強制、以寫入後之結果驗證; Q6 修(冪等 + 補償); Q7 主控授權新案例產新標準圖(既有圖 0 張改變); Q8 確認不在原則 11 範圍。另加之條件: 成員清單存檔只以合併方式寫 `fields` 與稽核欄, 須有「清單存檔期間人為延遲插入 ack → 游標保留」一案(已實作)。

## 9. 第二波實作現況(2026-10-23, 任務 task-run01; 依規格與上節處置)

### 9.1 實作清單

| 項 | 位置 | 說明 |
|---|---|---|
| 寫入契約 | `src/schema/contracts/{channels,channelMembers,messages,messagesArchive,tasks,tasksArchive,files,index}.mjs` | 純資料, 前後端 import 同一檔; channelMembers 為工廠 |
| 清單級 API(4) | `server/procCore.mjs`: `saveChannels / deleteChannels / saveChannelMembers / deleteChannelMembers`(+ 核心 `saveChannelsCore / deleteChannelsCore / saveMembersCore / deleteMembersCore`); `server/WWebTask.mjs` kpFunExt | 第二參數 / 第四參數 `{ baseline }`; 回 `{ inserted, modified, deleted, unchanged, rows }`(刪除回 `{ deleted }`) |
| 單筆 API(4)收緊 | `saveChannel / deleteChannel / saveChannelMember / deleteChannelMember` | 薄包裝, 共用核心; 不帶基準; 成功回傳形狀維持原 ORM 結果(新增 `{ n, nInserted, ok }`; 修改 / 刪除逐筆陣列), 外部呼叫端相容 |
| 補償還原 | `runOps` + `opInsert / opModify / opDelete` + `chkWrite` | `saveRolledBack` / `saveWriteFail` |
| 拒收鍵轉換 | `guarded`(`getRejectKey`) | baselineMismatch→`saveStale`、rowNotFound→`errRowNotFound`、baselineFormat→`errBaselineFormat`、rowsInvalid→`errRowsInvalid`(+ log) |
| `ackChannel` 兩段式 | `ackChannel` | 更新路徑實體鎖 + `autoInsert:false`; 缺列路徑 `withTabLocks` + 鎖內重查 + 頻道存在檢查 |
| `archiveSweep` | 逐筆 `kmx('task:'+id)` 重讀 | 守衛集合取自實際搬走者 |
| `respondTask` 冪等 | 沿用本輪認領後之殘留 taskReply(`timeCreate ≥ timeClaim`) | 第二段失敗補償 |
| `postMessage` | 頻道存在檢查 | `errChannelNotFound` |
| 前端 | `src/plugins/mDraft.mjs`; `LayoutContentChannels.vue`; `LayoutContentMembers.vue` | 見 `spec/設計要點與取捨.md` D18 第 11 點 |
| 語系鍵 | `server/procLang.mjs` | 後端 11 個 + 前端 6 個(eng + cht) |

### 9.2 寫入站點對照(inventory 第 2.2 節 W01～W21 之第二波處置)

W01/W02/W03(`saveChannel` 修改 / 新增 / 補 agent 成員列)→ `saveChannelsCore`(表鎖內, 補 agent 列同一次呼叫); W04(`deleteChannel`)→ `deleteChannelsCore`(`rowNotFound`、成員列連帶刪除); W05/W06/W07(成員存 / 刪)→ `saveMembersCore` / `deleteMembersCore`; W08～W10(`postMessage`)→ 加頻道存在檢查, 回指 save 加 `autoInsert:false`; W11/W13/W14(`claimTask` / `respondTask` / `resetTask`)→ 補 `autoInsert:false`, `respondTask` 以 `opModify`/`opInsert` 經 `runOps`; W12(taskReply 新增)→ 冪等(沿用殘留); W15/W16(`ackChannel`)→ 兩段式; W17(`saveFile`)不變; W18～W21(`archiveSweep`)→ 逐筆鎖內重讀; W22～W30(離線工具)不變。

### 9.3 規格 V1～V14 逐條對照

| # | 情境 | 測試(檔: 案) | 判定 |
|---|---|---|---|
| V1 | A 存後 B 以舊基準存 | `unit-procCoreConcurrency`「V1」; `api-concurrency`「V1 / V12」; E2E-014 / E2E-015(草稿保留 + 提示 + 被拒) | 已證 |
| V2 | 外部匯入相同內容重送 | 不適用: 本套件無外部匯入(Q8); `unit-procCoreConcurrency`「Q8」釘住「procCore 無 delAll」 | 不適用 |
| V3 | 外部同步改變內容 | 同上 | 不適用 |
| V4 | 系統直寫雙方欄位後舊基準被拒 | 變形(本套件無雙方欄位): 系統新增成員列(ack 缺列路徑)使舊畫面被拒 —「V4 (變形)」 | 已證(變形) |
| V5 | 系統寫伺服器專有欄後後台可存, 該欄維持 | 「E3 轉綠 / V5」「V5: 系統直接改伺服器專有欄…」「V14 (主控加之條件)」 | 已證 |
| V6 | 修改時該列已被刪 | 「V6 / O1」兩案; `api-concurrency`「V6 / V7」 | 已證 |
| V7 | 刪除已不存在之列(帶或不帶基準) | 「V7 / O2」「V7 (成員範圍)」; `api-concurrency` | 已證 |
| V8 | 整表存檔期間他人新增列 | 「V8」頻道、「V8 (成員範圍)」 | 已證 |
| V9 | 他人重排 / 系統重編號 | 不適用 `orderKey`(存檔不重編 order); 變形「V9」: 系統改 `order`(伺服器專有)後舊基準仍可存 | 已證(變形) |
| V10 | 前端算之基準(經實際傳輸路徑)=伺服端新鮮讀取所算 | `api-concurrency`「V10」(RPC 往返); `unit-procCoreConcurrency`「V10」; `unit-draft`「V10」 | 已證 |
| V11 | 有草稿時收到推播 | `unit-draft`「decidePush」; E2E-014(頻道頁)、E2E-015(成員頁) | 已證 |
| V12 | 清單頁多列提交其中一列過期 | 「V12 (E4 轉綠)」; `api-concurrency`「V1 / V12」 | 已證 |
| V13 | 格式或版本不識之基準 | 「V13」(8 種不識 × 4 API × 頻道 / 成員); `api-concurrency`「V13」 | 已證 |
| V14 | 比對與寫入間不可插入他人寫入(人為延遲) | 「V14」三案(兩系統管理者並行、單筆 / 清單 / 刪除並行、ack 缺列路徑取表鎖)、「V14 (主控加之條件)」、E2 三案(封存 vs 重置) | 已證 |

### 9.4 缺陷轉綠對照(inv01 探測 → 正式測試)

| 缺陷 | 修前(inv01 探測 / HEAD 副本) | 修後(正式測試) |
|---|---|---|
| E2 封存 vs 重置 | 探測 RED ×3(熱表 0 筆、冷表留 error; 壓力 117/118 遺失); HEAD 副本三案紅 | `unit-procCoreConcurrency`「E2」三案綠 |
| E3 成員存檔回寫游標 | 探測 RED ×3(游標回 `""`) | 「E3 轉綠 / V5」「V14 (主控加之條件)」綠 |
| E4 逐列存檔部分寫入 / 重複建列 | 探測 RED ×3 | 「V12 (E4 轉綠)」「Q3 saveChannelMembers (E4 B 轉綠)」綠 |
| E7 推播丟草稿 | 探測 RED ×3(最小 Vue 重現) | `unit-draft` + E2E-014 / E2E-015(真元件, 真瀏覽器)綠 |
| O1 修改已刪之列復活 | RED | 「V6 / O1」綠 |
| O2 刪除不存在之列回成功 | RED | 「V7 / O2」綠 |
| O3 ack 與刪成員競態產殘缺列 | RED | 「O3 轉綠」兩案綠 |
| O4 成員重複 | RED | 「O4 / Q5」兩案綠 |
| O5 名稱不驗 | RED | 「O5」綠 |
| O6 採用客戶端專有欄位 | RED | 「O6 轉綠」「V5」綠 |
| O7 刪頻道不清引用 / 可對已刪頻道發訊 | RED(成員 / 訊息 / 任務各殘留 1; 發訊成功) | 成員列連帶刪除、`errChannelNotFound` 綠; 訊息與任務原維持現行(待裁示), **2026-10-23 依使用者裁示改為移入封存表, 已綠**(`unit-procCoreConcurrency`「O7 / Q2」與「Q2」節; 見 9.8) |
| O8 `respondTask` 重複 taskReply | RED(重試後 2 則) | 「O8」三案綠 |

修前紅證據: inv01 探測腳本(複本 `tmp/task-run01/inv01/`)於本輪開工時對未改之程式重跑仍為 RED(E2 ×3、E3 ×3、E4 ×3、E7 ×3、其他 ×14); 正式測試 `unit-procCoreConcurrency` 對 HEAD 之 `server/` 副本(`git archive HEAD` 解至 `tmp/`)跑: 當時之測試檔(47 案)中 5 綠 42 紅(綠者為「既有行為不變」類: 契約 2、digestRow 1、狀態機歷史回覆 1、Q8 1); 紅者含「函式不存在」與行為紅兩類(夾具以單筆 API 退回建資料, 使行為紅可見); 其後測試檔因外審補驗增至 72 案(紅綠比未重跑, 新增案屬外審所提之交錯與硬失敗缺格, 以變異驗證證明可抓錯)。

### 9.5 變異驗證(對 `server/procCore.mjs` 副本逐一施加, 跑 `unit-procCoreConcurrency` + `unit-procCore`)

49 個變異(另含 1 個對照): 對照全綠; **48 個被測試抓到(KILLED)**; **1 個存活 = 等價變異**: `rollback-wrong-order`(補償不反向; 資料庫無外鍵, 還原次序不影響終態, 不可觀察)。

- **第一批 32 個**(首輪實作時; 31 個被抓到、1 個等價): 拿掉表鎖(清單 / ack 缺列路徑)、成員改回整列覆寫、archiveSweep 拿掉重讀 / 逐筆鎖 / 守衛集合改取候選、單筆 API 拿掉存在檢查(復活)、ack 拿掉 `autoInsert:false` / 頻道檢查、補償不執行 / 漏失敗步 / 不報失敗、`chkWrite` 不查 `ok`、名稱 / 成員唯一檢查拿掉、採用客戶端整列、基準降級(非物件 opt、`baseline:null`)、不帶基準時刪除集合取庫內全部、未改動之列也寫入、刪頻道不連帶刪成員(兩路徑)、成員刪除 / 存檔不限範圍、刪除未命中不回 `rowNotFound`、`respondTask` 拿掉冪等 / 沿用歷史回覆、`postMessage` 拿掉頻道存在檢查、channelId 不符不拒收、成員存檔不檢查頻道存在。
- **外審後新增 17 個**(皆 KILLED): `postmessage-check-outside-lock`(發訊只剩鎖外存在檢查)、`postmessage-no-channels-lock`(發訊不取 channels 表鎖)、`delete-member-no-entity-lock`(成員刪除不取實體鎖)、`delete-member-stale-pre`(刪除前像不於鎖內重讀, 補償撤銷已成功之 ack)、`rename-no-entity-lock`(成員改名不於實體鎖內寫入)、`ack-no-isactive-filter`(ack 不限有效列)、`ack-no-entity-lock`、`no-field-type-check`(客戶端欄位不驗字串)、`archive-no-cold-chk` / `archive-msg-no-chk`(封存冷表寫入不檢查結果)、`archive-no-undo-cold`(熱表刪除失敗不撤回冷表複本)、`rollback-stop-on-first-undo-fail`(補償遇第一個補償失敗即中止)、`delete-dup-pk-as-notfound`(刪除入口庫內主鍵重複誤報)、`single-api-new-shape`(單筆 API 成功形狀改為清單形狀)、`list-api-no-locksave`(頻道清單存檔拿掉 lockSave)、`baseline-ids-only`(基準比對只比 id 集合)、`channels-read-active-only`(頻道存檔之新鮮讀取只取有效列)。另 `postmessage-no-channel-check` 改為鎖外與鎖內皆拿掉(原「只拿掉鎖外檢查」因鎖內另有同一檢查而為等價變異, 已棄用)。
- 腳本與結果: 本輪報告〈證據〉附 `mutate.mjs` 與逐條結果(`tmp` 內腳本於結束前清理)。測試修補紀錄: 首輪 3 個存活(補償漏失敗步、補償次序、`ok:0` 檢查)→ 補「已生效才失敗」注入與 `n:1, ok:0` 之 stub 後前兩者之一與第三者被抓到, 補償次序確認為等價; 外審後首輪(新增變異)3 個錨點因重構失效(`pickSelected`)、1 個因只拿掉鎖外檢查而等價, 皆已改錨點 / 改變異後重跑被抓到。變異腳本之 mocha 須加 `--exit`(死鎖類變異會留下開啟之 lmdb 句柄使行程不退出)。

### 9.6 待裁示、已知不修與外審採納

**待裁示(使用者)**: ~~刪頻道時該頻道之訊息與任務之處置~~ —— 2026-10-23 使用者裁示「移入封存表」, 已於第三輪實作(9.8), 現無待裁示事項。

**外審採納(sol 20 條 + beam 8 條, 逐條讀碼 / 實測核實)**: 屬實並已修 —— sol #1 刪除補償撤銷已成功之 ack(前像改於實體鎖內重讀)、#2 成員改名與 ack 不互斥(改名於同一實體鎖內寫入)、#3 ack 與讀取端有效列條件不一致、#4(= beam #3)發訊存在檢查與新增不在同一互斥範圍(鎖內重查)、#5 封存未檢查逐筆結果與熱表刪除失敗後留下矛盾冷表、#7 深度合併無法精確還原物件欄位(拒收非字串客戶端欄位)、#8 草稿中刪除後舊快照使已刪列被重新新增、#9 切頻道丟草稿(P5)、#10 A→B→A 舊回應覆蓋草稿(`loadSeq`)、#11(= beam #1)自身寫入期間之他人推播(存檔成功後依 store 重算; 已於先前輪次處理)、#12 `isDirty` 未驗主鍵集合、#13 單筆 API 成功形狀(撤回改變)、#14 空表無法新增、#15 特殊識別碼重複警告、#16 刪除入口誤分類庫內重複主鍵、#17～#20 測試缺格(皆已補測, 見 9.3 / 9.5 與 `unit-procCoreConcurrency`「外審補驗」)。

**已知不修(附理由)**:

- sol #6 以毫秒時間判「本輪認領後建立之殘留 taskReply」(`timeCreate >= timeClaim`): 須同一毫秒內完成「第一輪回覆 → 系統管理者重置 → 第二輪認領」才會誤沿用前輪回覆, 人為流程不可能達到; 若改用持久輪次識別需動 tasks schema(新增欄位與遷移), 擴大改動面; 時鐘回撥同。測試以 `sleep(5)` 避開此邊界(已註明)。
- `opModify` 補償對「列上原本缺欄」之欄位寫回空字串(beam #7): 摘要對缺欄 ≡ 空值, 且所有列皆由 `funNew` 產生含全欄; 不另處理。
- beam #2(成員頁存檔成功後不依己寫期間之推播重算提示): 成員頁每次 `rowsChange` 即以 `store.channelMembers` 比對凍結基準(`onStorePush`), 他人於存檔後之變更於使用者下一次編輯時即提示, 無遺失; 不屬實於功能面。
- beam #5(`archiveSweep` 與 `postMessage` / `respondTask` 無共用表鎖): 封存只搬「過齡」(預設天數以上)之訊息與終態任務, 與新發訊 / 回覆之資料集不相交; 任務以 `task:<id>` 鎖與 `respondTask` 序列化。不屬實。
- beam #6(`isDirty` 不比對列順序): 兩頁無排序入口(`order` 為伺服器專有欄, 不在契約 `fields`), grid 欄排序僅顯示層; 不適用。
- 單筆 API 不支援單列基準(刻意, 見 D18)。
- 補償次序不反向屬等價變異(見 9.5)。
- 單元測試 `test/tools/memTables.mjs` 之記憶體替身採淺層展開, 與真實 lmdb 之深度合併不同(sol #7 註): 涉及合併語意之斷言一律使用真實 lmdb(`unit-procCoreConcurrency`)。

(外審結果與採納表見本輪報告〈外審評分表〉。)

### 9.7 改動範圍 → 測試對照(主控共通守則 12; 取代 inventory 第 7.6 節之預估)

| 改動範圍 | 必跑測試 |
|---|---|
| `server/procCore.mjs`(寫入函式) | `unit-procCore`、`unit-procCoreConcurrency`、`api-doubleclick`、`api-agent`、`api-concurrency`、e2e E2E-005 / 008 / 010 / 014 / 015 |
| `server/WWebTask.mjs`(kpFunExt / 組裝) | 上列 + `api-dataChannel`、`unit-authorizeExec`、`unit-optRemoved`、`api-tokenLeak` |
| `src/schema/**`(契約 / schema) | 上列 + `unit-procCoreConcurrency` 之契約案、`unit-draft` |
| `server/procCore.mjs` 之刪頻道搬移(`buildChannelDeleteOps` / `opMoveTask` / `opMoveMessages`; 第三輪) | `unit-procCoreConcurrency`(全檔; 「Q2」節為主)、`unit-procCore`、`api-concurrency`、`api-agent`(封存 / 任務生命週期); 不需 e2e(UI 不變) |
| `src/plugins/mDraft.mjs`、`src/plugins/mGridEdit.mjs` | `unit-draft`、e2e E2E-014 / 015 / 016 / 017 |
| 前端清單頁(`LayoutContentChannels.vue` / `LayoutContentMembers.vue`) | `unit-draft`、e2e E2E-005 / 008 / 010 / 014 / 015 / 016 / 017(兩語系; 008 為聊天頁成員視窗共用 `LayoutContentMembers`) |
| `server/procLang.mjs` 之 `deleteChannelConfirm` 等語系鍵 | 無標準圖含刪頻道確認框(`grep -n "deleteChannelConfirm" test/`: 0); 跑 `unit-procCore`、`unit-optRemoved` |
| `server/access.mjs`(角色 / 成員檢查、入口函數表)、`server/WWebTask.mjs` 之 `authToken` / `getUserIdByToken` / `kp` / `operOrm` / `sysFuncsPublic`、`srv.mjs` 之測試權杖(task-run01, D20) | `unit-access`、`api-callerMatrix`(462 格)、`api-dataChannel`、`api-tokenLeak`、`unit-authorizeExec`、`unit-optRemoved`、`unit-procCore`、`api-agent`、`api-files`、`api-doubleclick`、`api-concurrency`; 改到連線與同步(`sysFuncsPublic`、w-serv-hapi 升版)→ e2e 全跑 |
| `src/plugins/mAccess.mjs`、`Rail.vue` 之 `navItems`、`LayoutContentMembers.vue` 之編輯開關(D20 前端) | `unit-mAccess`; e2e 恆以系統管理者登入故畫面不變, 跑 E2E-001～017 全部(Rail 為每案共用) |
| 共用基礎(測試輔助、版面共用元件、樣式、建置設定、w-serv-orm 與 w-serv-hapi 升版) | 擴大至 e2e 全跑 + 全套 unit / api |

### 9.8 第三輪(2026-10-23, 任務 task-run02, 修正輪): 刪頻道移入封存表(Q2)與編輯器開啟中視同草稿(N1)

**範圍**: ①刪頻道時該頻道之訊息與任務移入封存表(使用者 2026-10-23 裁示; D19); ②task-verify01 N1(排程項第 115 項)編輯器開啟中收到推播不丟輸入(頻道頁、成員頁); ③文件。不改狀態機、不改 run01 之其他行為。

**修前紅**(證據 `C:\opensrcOper\dnow\20261022221854\agent-out\task-run02-evidence\red-before\`):
- 後端: 新測試對 HEAD 之 `server/` 副本(`git archive HEAD server src` 解至 `tmp/`, 不 checkout)跑 `unit-procCoreConcurrency`: **13 紅**(皆為行為紅: 熱表殘留任務 / 訊息、封存表無複本、補償矩陣不含搬移、等任務鎖之交錯; 本輪新增之 API 皆為既有函式, 無「函式不存在」類紅)。
- 前端: 以 `cp` 把 HEAD 版 `LayoutContentChannels.vue` / `LayoutContentMembers.vue` / `mDraft.mjs` 換入 `src/`(備份於 `tmp/`, 跑完 `cmp` 驗證還原)後跑 E2E-016 / E2E-017 兩語系: **4 紅** —— 頻道頁「N1: 編輯器開啟中收到推播不得關閉編輯器」(編輯器被重建關閉, 輸入丟失), 成員頁「提示條不出現」(編輯器本就不丟, 缺提示)。修後 4 綠(新標準圖 6 張經逐張目視; 既有 52 張 0 張改變)。

**外審(sol, 1 位; gpt-6.1-sol max, 唯讀)發現 6 條, 逐條讀碼核對後採納 5 條(含 2 條高)、1 條部分採納, 皆已修並補測**(原文 `agent-out/task-run02-evidence/review/sol-review-original.md`): #1(高)任務補償未持 `task:<id>` 鎖, 與封存掃描交錯可使任務兩表皆無 → 補償移入同一把鎖; #2(高)訊息補償與掃描交錯同(初版列「已知不修」, 外審指出不符「全有或全無」) → 搬移 / 補償 / 掃描之訊息階段共用 `msgarch:<channelId>` 鎖(掃描依頻道分組逐組取鎖), 原已知不修條目取消; #3(中)補償無條件刪封存列, 中斷後重試遇「冷熱並存」殘留會刪掉原有封存列 → 記搬移前封存表是否已有該列, 補償只刪本次新增者; #4(中)提交(Enter)後 `rowsChange` / 停止事件回呼前之空窗到達之推播仍可重建丟草稿 → 頻道頁 `onStorePush` 以 `resolveModified` 依列內容重算並把 `editDefer` 視同編輯中; #5(中)多頻道中斷後原請求不能續跑 → 頻道列於全部頻道搬移後才刪; #6(低)`messagesMoved` 為選取數 → 鎖內讀取後即為實際搬移數(掃描持鎖時刪頻道須等待)。另補採其測試缺格建議: 熱表刪除回 `ok:0`、批次混合 `ok:1/0`、`claimTask` 進行中互斥、已有草稿時再開編輯器、失焦(點他處)關閉; 不補: 附件內容(整列複製, 與欄位內容無關)、元件層「非同步事件已入列後取消」之確定性重現(見下)。
- **無法決定性重現者(誠實揭露)**: 提交後事件回呼前之空窗 (#4) 僅數毫秒, 無法在真瀏覽器穩定重現; 純邏輯層以 `unit-draft`「resolveModified」兩案守, 元件層之接線(`onStorePush` 取 `resolveModified` 與 `editDefer`)只由讀碼與外審保證, 變異「拿掉該接線」e2e 抓不到(等價於不重現之空窗)。

**變異驗證**(後端對 `server/procCore.mjs` 副本逐一施加; 腳本第二版 `mutate.mjs`(`tmp` 內腳本於結束前清理, 複本收於任務資料夾 `agent-out/task-run02-evidence/mutation/`), 逐條結果 `mutation-result2.md` 與補跑之 `mutation-result-partial2.md`): 34 個(1 對照 + 33 變異)**33 全被抓到、對照全綠**: 不搬任務 / 只搬終態任務 / 不搬訊息、任務或訊息只刪熱表不寫封存表、封存寫入不檢查 `ok`(任務、訊息各一)、搬任務不取 `task:<id>` 鎖、**任務補償不取鎖、訊息補償不取鎖、掃描之訊息階段不取鎖、訊息搬移不取鎖(由「掃描持鎖時刪頻道須等待」之計數案抓到)**、熱表刪除不要求命中、任務與訊息補償各三種缺漏(整個無補償 / 不補回熱表 / 不撤封存複本)、**補償一律刪封存列(任務、訊息各一)、搬移前不讀冷表原有列**、先搬訊息後搬任務、訊息於建立寫入單元時預讀、頻道列先刪、**頻道列於各頻道搬移後即刪**、只搬 `isActive y` 之任務或訊息、清單存檔之刪除集合不搬、清單刪除不搬、不記 log、log 筆數不累計(任務、訊息各一)。(第一版 26 個結果仍留 `mutation-result.md`; 第二版為外審採納後之補強, 錨點隨程式改動。)
- 前端以 Edit 逐一施加與還原(每輪 `cmp` 比對備份): `decidePush` 忽略 `isEditing`(`unit-draft` 抓到)、`isEditorOpen` 恆 false(`unit-draft` 抓到)、頻道頁 / 成員頁 `onStorePush` 不判編輯器(E2E-016 / E2E-017 抓到)、頻道頁編輯器關閉後不重新處理推播(E2E-016 抓到)、成員頁模板條件退回只看 `isModified`(E2E-017 抓到)、成員頁不掛編輯器關閉監聽(E2E-017 抓到); **存活 1 個**: 頻道頁 `onEditorStopped` 不先以內容重算 `isModified`(E2E-016 仍通過) —— 實測 `rowsChange` 先於停止事件回呼, 重算屬防禦性冗餘, 於外審 #4 之空窗(事件順序不保證)才有作用, 保留。
- 變異過程中發現並修正之測試脆弱點: `Q2 交錯(停在搬訊息前)` 案之 `pauseOnce` 謂詞原綁死查詢形狀(`isActive === undefined`), 變異 `select-msgs-active-only` 因而在非預期之測試超時才「被抓到」; 已放寬為只比 `channelId`, 該變異改由 `isActive n` 專案抓到。另 `Q2 多頻道` 案初版之故障點(第 5 次寫入)恰落在變異 `channel-row-per-channel` 之頻道列刪除, 該變異存活; 改為第 6 次後被抓到。

**依原則自行決定**(皆已記 `decisions.tsv`, phase `task-run02`): 進行中任務一併搬移且維持原狀態、不拒絕刪除(原則 3、原則〇之一③; 理由見 D19 第 4 點); 不增 schema 欄(D19 第 1 點); 頻道列最後刪(D19 第 3 點); 訊息於任務搬完後才讀(D19 第 2 點); 新增 E2E-016 / E2E-017 與 6 張標準圖(主控授權); 舊孤兒不遷移(D19 取捨③)。

**已知不修(附理由)**: ①升版前已刪頻道所遺之孤兒不自動搬移(稽核方式見 README); ②補償亦失敗(`saveWriteFail`)時庫內可能留中間態(本來即只保證回報, 見 D18; 此時頻道列仍在, 重送可補完); ③提交後事件回呼前之空窗於元件層無決定性 e2e(見上)。(初版之「補償與封存掃描交錯可能兩表皆無」已於外審後修復, 取消。)

**待辦**: 無新增(舊孤兒搬移若業主要求另案)。
