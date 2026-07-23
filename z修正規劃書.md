# w-web-task 修正規劃書

## ✅ 覆核(2026-07-11 主代理派獨立子代理逐項查證)

> 逐項讀碼 + 實跑快速測試複驗本書「已完成」宣稱: **9/9 全數屬實, 無待修項, 未動任何檔案**。
>
> - **spec**: E2E-011/012/013 三條 bullet(三層結構完整, `流程_頻道任務調度.md:101-126`)、設計總覽 §3「7 張」+ 3.5/3.6/3.7 + §6.1/§6.2 補 2 支封存 API + §9「scaffold 收斂紀錄(已完成)」、D10「兩處」(無 LayoutContentConversation 殘留)、D13/D14 存在 —— 皆落地;D 編號維持 S4 決議之原失序(D11 缺號), 未被誤修。
> - **test**: e2e-channeltask 之 E2E-011(`:646`)/012(`:703`)/013(`:779`)、E2E-008 三條 UI grid 斷言(`:519/:540/:559`)、`seed-archived-task.mjs` + `reseedBackend({withArchivedTask})`、6 張新 baseline(eng/cht × 011/012/013)—— 皆在。
> - **實跑**: unit-rwd **6 passing** / unit-procCore **42 passing**, 與宣稱一致。
> - **archiveSweep cutoff**(`procCore.mjs:624`)實為 `ot().subtract(nd, 'day').format('YYYY-MM-DDTHH:mm:ss.SSSZ')`(`ot` = dayjs 別名), 與稽核「格式一致、字典序=時序、正確無 bug」結論相符。

## 🔍 稽核追加(2026-07-11 三維度稽核 → 主代理逐項查核)

> 架構/風格/弱點三維度稽核(opus 半邊 + 主代理讀碼複查)。程式碼與 spec(D1~D14)高度一致。**待修 bug = 0**。

### 逐項查核結果(全數非缺陷)
- **NoSQL/mingo 注入**: 所有 `select({...})` 查詢值先過 `isestr()` 守衛, 僅字串可通過, 無法夾帶 operator 物件。
- **archiveSweep 時間比較**(主動查證之唯一實質疑點): cutoff 用 `dayjs().format('YYYY-MM-DDTHH:mm:ss.SSSZ')`(procCore.mjs:624)與 `nowms2str()`(wsemi 原始碼確認同格式)一致, 單機固定 TZ 下字典序=時序, **正確無 bug**。
- **XSS 兩處消毒**(D10)、**getFile 白名單**、**身分權威取自 token**(D8)、**kmx 三動詞對稱守衛**(D6)、前端 core() 五段 + pm.resolve() 第一行、無原生 alert/confirm、無 async inline arrow —— 皆已落地。
- **D 節觀察(不建議動, 依真痛三條件)**: saveChannel 之 agent member 建列非原子(後台管理員 CRUD, 並發非現實場景, 需求擴大型假痛)、getFile 一律 404、純圖 asTask title 空、全表掃描、procLang 保留鍵 —— 均命中既有決策或後果不具體。

**結論**: 本專案本輪三維度稽核**無任何待修項**。

---

> ## ✅ §壹 待修正清單執行狀態: **全部完成**(2026-07-10, 主代理統籌 + opus 子代理執行)
>
> | 項 | 處置 | 結果 |
> |---|---|---|
> | S1 | spec 補 E2E-011(開成任務)/012(任務回應與重試, 承接式)/013(封存顯示切換), UI 事實(雙語按鈕文字/狀態徽章)逐一讀碼+procLang 取得 | ✔ 三條 bullet 依三點結構落地;執行中據實修正兩處: 回應入口僅 running 態(:393-400, 需前置認領推進)、封存需測試自備冷表種子(base seed 無) |
> | S2 | 設計總覽同步: §3 標題 4→7 張 + 補 3.5 files/3.6 messagesArchive/3.7 tasksArchive;§6.1 補 2 支 API;§6.2 kpFunExt 亦補 2 列(執行中發現之同型遺漏);D10「三處」→「兩處」(已 grep 證實 LayoutContentConversation 不存在) | ✔ |
> | S3 | §9 改「scaffold 收斂紀錄(已完成)」+ 完成註記(三項逐一 grep 確認) | ✔ |
> | S4 | cosmetic 編號失序 | 依規劃書「不強制」**不修**(README 以 D12 字面引用, 移位風險>收益) |
> | T1 | 依新 spec 補 3 個 e2e case(arrange 走 API/種子屬合法前置, act 全 UI);新增 `test/seed-archived-task.mjs` + `e2e-setup reseedBackend({withArchivedTask})` 向後相容擴充 | ✔ 6 張新 baseline 手術式產製(`--names E2E-011,E2E-012,E2E-013`), 抽驗合格 |
> | T2 | E2E-008 C/U/D 各補一條 UI 斷言(grid DOM, 非 wait 條件), 後端斷言留作補強 | ✔ `:519/:540/:559` |
> | T3 | RWD 真值表 unit(方案 b): `test/unit-rwd.test.mjs` 純函式等價驗證 4 格真值表 + 2 條 D13 不變式 | ✔ 6 passing |
>
> **npm test 全量驗收(2026-07-10)**: unit **48 passing**(42 procCore + 6 rwd)/ api **30 passing** / e2e **26 passing**(20 舊 + 6 新)—— **0 failing**。
> 附帶: e2e 期間曾停用主代理稍早自啟之 11008 dev 後端(避免 LMDB 記憶體映射衝突), 測試後已重建 dev 環境。

> **本版**: 2026-07-09 由 w-web-task session 重新盤查後改寫
> **本次任務**: (1) 研判前版內容是否合理屬實 (2) 盤查 `./spec` 是否涵蓋本專案重要流程含中間細部 (3) 盤查 `./test` 是否依原則對齊 spec 完成 unit/api/e2e (含命名與撰寫風格)
> **結論速覽**: 前版**全部屬實、已執行完畢**(移至 §參)。但本次盤查在 spec 與 test 發現 **7 項待修正**(§壹), 其中 **S1 / T2 為真痛**。另有 2 項屬設計取捨, 已依指示寫入 `spec/設計要點與取捨.md`(D13 / D14)。
>
> **行號基準**: 2026-07-09。動手前先 grep 確認, 勿盲信本文行號。

---

# 壹、待修正清單(依優先序)

> 判準: 全域規範 §7 真痛三條件(①在合約內 ②已被觀察 / 靜態可確定 ③後果具體)。未滿足者標「不修」並附理由, 不列入本表。

## 甲、spec 缺口

### 🔴 S1|「重要流程」漏掉兩條**需求原文之核心流程** + 一條新上線功能

**事實**: `spec/流程_頻道任務調度.md` 之「重要流程」共 **10 個 E2E bullet**(`E2E-001` ~ `E2E-010`), 全數為「瀏覽 / 顯示 / 發純文字訊息 / 成員管理」。以下三條**完全沒有 bullet**:

| 漏掉的流程 | production 進入點 | 後端 | 需求原文 |
|---|---|---|---|
| **開成任務 (asTask)** | `Composer.vue:92` `@click="onToggleAsTask"` + `:41` 任務標題輸入 → `:379` `asTask: vo.asTask` 送 `postMessage` | `procCore.postMessage` 之 asTask 契約 | 「對話**可擴充指向任務**」 |
| **任務的收與回 (respond / retry)** | `LayoutContentTasks.vue:213` `@click="onClickRespondBtn"`、`:146` `@click="onClickRetryBtn"` | `$fapi.respondTask` / `$fapi.resetTask` | 「任務**有收與回, 回完就視為結束**」 |
| **封存顯示切換** | `LayoutContentTasks.vue:60` `@click="onToggleArchived"` → `:572` `getArchivedTasks` | `procCore.archiveSweep` + 冷表 | 2026-07-07 上線(D3 有記, 但那是設計文件非流程) |

**真痛判定**: ✅ 三條件全滿足。
- ①合約內: 前兩條**就是原始需求的核心語句**(對話→任務、任務收與回)。
- ②靜態可確定: `grep -niE "asTask|respond|retry|archived" test/e2e-channeltask.test.mjs` → **零命中**。
- ③後果具體: 這兩條核心需求的 **UI 路徑從未被端到端驗證過**。改壞 `Composer` 的 asTask 傳參、或 `LayoutContentTasks` 的回應/重試按鈕, **不會有任何測試擋下**(unit / api 只覆蓋後端函式, 不含前端接線)。

**修法(順序不可顛倒)**: 先補 spec bullet(E2E-011 開成任務 / E2E-012 任務回應與重試 / E2E-013 封存顯示切換), **再**補對應 e2e case。理由見 T1 —— 目前 test 對 spec 是齊的, 根因在 spec。

---

### 🔴 S2|`spec/設計總覽.md` 已與實作脫節(含**安全不變量文件失準**)

| # | 事實 | 佐證 |
|---|---|---|
| a | 標題寫 **「## 3. 資料表 (4 張)」**, 僅列 3.1~3.4;實際為 **7 張** | `spec/設計總覽.md:41`;`src/schema/index.mjs:1-7` 註冊 channels / channelMembers / messages / **messagesArchive** / tasks / **tasksArchive** / files |
| b | **`messagesArchive` / `tasksArchive` 兩表在設計總覽全篇零提及** | `grep -n "Archive" spec/設計總覽.md` → 零命中。**反倒 `README.md:27-28` 有完整記載** → 設計總覽比 README 更舊 |
| c | §6 API 目錄缺 `getArchivedTasks` / `getArchivedMessages` | 後端 `server/WWebTask.mjs` 實際暴露 16 個 `/api/*`, 設計總覽少列 2 個 |
| d | **`設計要點與取捨.md:74` (D10 安全不變量) 稱 `renderMd` 消毒有「ChatView / LayoutContentTasks / LayoutContentConversation **三處**」** | `LayoutContentConversation.vue` **已刪除**, 現為**兩處**。前版規劃書 R4 寫「重複兩份」才是對的 |

**真痛判定**: ✅。①合約內(spec 是給後續 agent 讀的真理來源);②靜態確定;③後果具體 —— 新 agent 依設計總覽做設計會**漏掉封存冷表**;依 D10 去找第三處 `renderMd` 會**找不到而困惑**, 且 D10 是 XSS 守門的單一維護點宣告, 失準風險最高。

**修法**: 更新 §3 標題與表列(補 files / messagesArchive / tasksArchive)、§6 補 2 支 API、D10 之「三處」改「兩處」並移除 `LayoutContentConversation`。

---

### 🟡 S3|`spec/設計總覽.md` §9「scaffold 殘留需修正」三項**早已全部完成**

**事實**(`spec/設計總覽.md:202-212`)列出三項「待改」, 實測皆已完成:

| §9 宣稱待改 | 實際 |
|---|---|
| `toolg/genEntry.mjs` replace `/msso/` → `/mtask/` | 已含 `mtask` ✔ |
| `public/index.html` `___pmwsso___` → `___pmwtask___` | 實際即 `___pmwtask___` ✔ |
| `vue.config.js` (待建) proxy → 11008 | 已建且已設 11008 ✔ |

**真痛判定**: ✅(輕)。③後果具體: 該節標題為「**需修正**」, 後續 agent 會誤以為仍有 scaffold 待改而去動 `toolg` / `public` / `vue.config.js`。

**修法**: 整節刪除, 或改標題為「§9. scaffold 收斂紀錄(已完成)」並標註完成日。

---

### 🟢 S4|`設計要點與取捨.md` 之 D 編號失序且跳號(低)

**事實**: 順序為 `D1 D2 D3` → **`D12`** → `D4 … D10`;**`D11` 不存在**。(`spec/設計要點與取捨.md:25` 為 D12)

**真痛判定**: ⚠️ 僅滿足 ①③(輕微)。②未觀察到因此出錯。**屬 cosmetic, 不強制修**。

**若要修**: **只移動位置、不改編號**(把 D12 整段移到 D10 之後)。**不可改號** —— `README.md:27,28` 以「spec D12」字面引用。D11 缺號建議留白並註記, 不回填。

---

## 乙、test 缺口

### 🔴 T2|`E2E-008` 之 Create / Update / Delete **最終斷言全為 DB-only**

**事實**(`test/e2e-channeltask.test.mjs:423-502`):

| 階段 | 最終斷言 | 是否 UI 觀察 |
|---|---|---|
| Create | `waitUntilExist(…, '新增成員已寫入後端（成員數=2）')` → `getChannelMembers().length===2` | ❌ 後端 |
| Update | `waitUntilExist(…, '更新後端 role 生效')` → `getChannelMembers()` 之 role | ❌ 後端 |
| Delete | `waitUntilExist(…, '刪除後端生效（成員數回 1）')` → `length===1` | ❌ 後端 |
| semantic | `backend.length===1` / `backend[0].memberId` / `dlgText.includes(tAgent)` / 選擇器隱藏 | 僅後兩者為 UI |

「新增後出現非 agent-demo 之新列」雖有查 DOM, 但那是 **wait(推進條件)不是 assert(驗收)**。

**真痛判定**: ✅。①合約內(e2e 之定義即使用者觀察);②靜態確定;③後果具體 —— **若 grid 完全不重新渲染(例如 `membersLocal` reload 後 Vue 未更新), 後端仍會是 2 筆 → 此 case 照樣全綠**, 而使用者實際看不到新成員。這正是技能明列的失敗樣態「只驗 DB」。

**修法(最小)**: 三階段各補一條 UI 斷言 —— Create: grid 內非 `agent-demo` 之列存在;Update: 該列 `[col-id="role"]` 之 `innerText` 等於新值;Delete: grid 內僅剩 `agent-demo` 一列。後端斷言**保留為補強**。

---

### 🟠 T1|e2e 按鈕覆蓋缺口(技能 rubric #2 機械式比對)

**事實**: `src/components/*.vue` 共 **24 個** 不重複 `@click` handler。e2e 觸及者僅 `onClickNav` / `onClickChannel` / `onClickMembers` / `onClickSub` / `onClickAttach` / `onClickSendBtn` / `addItem` / `onClickSaveBtn` / `onClickDeleteBtn`。

**未被任何 e2e 點過**(16 個), 其中**核心**者:

- `onToggleAsTask`、`onClickRespondBtn`、`onClickShowRespondBtn`、`onClickCancelRespond`、`onClickRetryBtn`、`onToggleArchived` ← **對應 S1**
- `onClickBack`(RWD 返回鈕, D13 新行為)
- `onClickLang`(語系切換)、`onClickImage` / `onCloseImage`(圖片放大)、`onToggleGroup`(樹展開)、`onClickTaskTitle`、`onRemoveAttachment`、`toggleMenu`、`toggleSettings`、`onClickLogout`

**真痛判定**: ✅, **但根因是 S1 不是 test**。
技能 rubric #1 為「spec 每 bullet ≥ 1 case」—— 目前 **10 bullet ↔ 10 case, 是齊的**。test 忠實跟隨了 spec, 錯不在 test。

**修法**: **先修 S1(補 spec bullet), 再補 e2e case。** 不可繞過 spec 直接加 e2e(違反「spec 是真理」)。
其餘非核心按鈕(語系切換 / 圖片放大 / 樹展開…)是否納入, 由業主決定 —— 全部補齊屬鍍金, **不建議無差別補**。

---

### 🟠 T3|RWD(D13)零測試守衛、spec 亦無記載

**事實**: `isNarrow` master-detail(斷點 768px)、`onClickBack` 返回鈕、後台頂部 tab 三項行為, **無任何 unit / e2e 覆蓋**;`spec/流程_*.md` 亦無 bullet。(設計決策已於本次補入 `設計要點與取捨.md` D13)

**真痛判定**: ✅(中)。③後果具體: 任何人改動 `Layout.vue` 的 resize 監聽、或 `ChannelsWorkspace` 的 `showTree/showContent` computed, **不會被擋下**;而桌面版面因 e2e 跑在 1440px(`test/e2e-setup.mjs:208`)恆為 `isNarrow=false`, **既有 20 個 baseline 對窄屏完全盲區**。

**修法(擇一, 建議 b)**:
- (a) 補一個窄屏 e2e case(需 `newContext({viewport:{width:390}})`, 與現行 per-case 1440 viewport 衝突, 成本較高)
- (b) **補 unit 測 `showTree` / `showContent` 之真值表**(4 組: isNarrow × currentChannelId), 成本極低、直擊 master-detail 唯一邏輯分支。窄屏視覺已於實作時以 w-screenctl 人工驗證(390/1440)。

---

## 丙、判定為「不修」者(避免鍍金, 明列留痕)

| 項目 | 為何不修 |
|---|---|
| e2e 僅 1 個檔 `e2e-channeltask.test.mjs`(w-web-api 有 5 個) | 本專案僅 **1 份 spec 流程文件** → 1 flow 1 檔, 與 `test/pics/channeltask/` 目錄一致。**命名與風格完全合規**, 非缺陷 |
| `mShare.mjs` 四個 `getXxxText` 同構 | 各自 1 個呼叫點、各對應不同欄位語意;合併只是把 kp 表換成參數, 改動點不減 → 純 DRY 鍍金 |
| `E2E-007` 語意-only 無 baseline | 屬技能明列之合法 gap;spec description 已載明理由(消毒與否之純文字渲染無法以 pixel 區辨) |
| 成員表過濾器以原值比對(輸入「人類」不命中) | 見 D14: 每頻道數列之小表, 後果不具體 |

---

# 貳、本次三項研判之結論

### (1) 前版規劃書內容是否合理屬實 → ✅ **全部屬實, 且已執行完畢**

逐項讀碼查證(非目視):

| 前版斷言 | 查證結果 |
|---|---|
| A-1 `CLAUDE.md:115` 已改寫、四專案逐字相同 | ✅ 四專案 `sed -n '115p' \| md5sum` **完全相同**(`751f82e870eed632`) |
| A-2 新增「e2e baseline 比對落地映射」節 | ✅ `CLAUDE.md:225`;**四專案皆有** |
| A-3 `README.md:141` 補正面陳述 | ✅ 已含「感知容差比對, 非 byte-exact」 |
| A-4 `spec/` 與 `test/` 零變更 | ✅ mtime 佐證: `CLAUDE.md` / `README.md` = **07-09 22:51**;`spec/*` / `test/*` = **07-07**(未動) |
| 勿改處完好 | ✅ `e2e-setup.mjs:336` `curr.equals(prev)` / `:414` 沿革註解 / `:426` `assertBaselineMatch` / `:427` 預設值 皆原封不動 |
| §1 仲裁: w-web-api 實名為 `assertOrRegenBaseline` | ✅ `w-web-api/test/e2e-apitest.test.mjs:18`。前版對 `z待整合_TASK.md §7` 的糾正**成立** |
| 全域技能已移除寫死函式名 | ✅ `SKILL.md:32` 現為「函式實名與簽章因專案而異, 本技能不寫死, 由各專案 CLAUDE.md 落地映射」 |
| §三 本專案無 `staLogs` | ✅ 無該目錄;`fsTreeFolder` 零命中 |
| 基準線 unit 42 / api 30 / e2e 20 | ✅ `unit-procCore` 42 個 `it()`;`api-agent` 17 + `api-files` 13 = 30;e2e 10 case × 2 語系 = 20 |

> **唯一補充**: 前版凍結區 R4 稱 `renderMd` 重複「兩份」—— **此為正確**。但 `設計要點與取捨.md:74` (D10) 仍寫「三處」, 兩者矛盾, 已列為 **S2-d**。

### (2) `./spec` 是否為本專案重要流程、是否含中間細部 → ⚠️ **細部品質高, 但覆蓋有硬缺口**

- **細部品質: 良好。** `流程_頻道任務調度.md` 之 10 個 bullet 皆嚴格遵守專案三點結構(title / description / flow 五 bullet), 未混入 helper 名、Playwright API、固定 wait 數字;承接式 journey(E2E-008)與語意-only(E2E-007)之判別與理由皆有載明。
- **覆蓋: 有硬缺口。** 需求原文之兩條核心(對話→任務、任務收與回)**無流程 bullet**, 另缺封存切換 → **S1**。
- **旁證文件陳舊**: 設計總覽(表數 / 冷表 / API)與 D10(消毒處數)已與實作脫節 → **S2 / S3**。

### (3) `./test` 是否依原則對齊 spec 完成 unit/api/e2e → ⚠️ **形式全合規, 實質有兩處失守**

依技能 5 維 rubric 逐維裁定(**不以「case 數對齊」概括回報**):

| # | 維度 | 裁定 | 依據 |
|---|---|---|---|
| 1 | Case 對齊 | ✅ | spec 10 bullet ↔ e2e 10 case(× 2 語系 = 20)。**但 spec 自身缺 3 條 → 見 S1** |
| 2 | Act 真實 | ✅ | 全檔無 `.fill(` / `vm.` / `evaluate setValue`;ag-grid 走 Pattern B(dblclick + insertText + Enter);modal 走 `div[role=button]` 真點擊 |
| 3 | Assert 完整 | ❌ **失守** | **E2E-008 之 C/U/D 最終斷言全為後端 `getChannelMembers`** → **T2** |
| 4 | 多語覆蓋 | ✅ | 全 case eng / cht 各一輪 |
| 5 | Cleanup 完整 | ✅ | 技能 audit 指令通過(`--baseline` 分支有 `cleanup()`);per-case reseed;E2E-008 自刪測試成員回歸 pristine |

**其他合規項**: 端點為 `127.0.0.1`(`e2e-setup.mjs:28-29`, 避 IPv6 Happy-Eyeballs);baseline 命名 `channeltask-{lang}-E2E-NNN-name.png` 與 `test/pics/channeltask/` 一致;檔名 `unit-*` / `api-*` / `e2e-*` 分層清楚;封存後端已有守衛(`unit-procCore` 之 archiveSweep 9 處 + `api-agent.test.mjs:297` G1 契約)。

**失守處**: T2(Assert 退回 DB-only)、T1/T3(覆蓋缺口, 根因在 spec)。

---

# 參、已完成(前版批 A|2026-07-09 執行、本次獨立複驗通過)

> 本區為**歷史紀錄**, 已全數落地並經本次逐項讀碼複驗(見 §貳-(1))。**無待辦。**

## 背景: 業主已拍板之四項全域決策

| # | 決策點 | 業主裁示 |
|---|---|---|
| 1 | 全域技能寫死 sso 函式名 | 只描述機制, 不寫死函式名;實名改由各專案 `CLAUDE.md` 落地映射 |
| 2 | 四專案 `CLAUDE.md` `:105`/`:115`/`:124` 自相矛盾 | **方案 A**: 改 `:115` 為契約語意、不點名 API;`:105`/`:124` 維持禁寫 API 呼叫形式 |
| 3 | 其他三專案 spec 既有之「(pixelmatch 容差)」字樣 | **B1 保留原樣**, 不回頭批次改寫 |
| 4 | 統計 API 之 log 檔全量掃描 | api / sso / perm 三專案一併修 —— **本專案無 staLogs, 不適用** |

## 執行結果

| 項 | 內容 | 結果 |
|---|---|---|
| A-1 | `CLAUDE.md:115` 改寫為「感知容差比對(非逐位元精確)」, 不點名 API | ✔ 四專案逐字相同 |
| A-2 | 新增「e2e baseline 比對落地映射」節(`CLAUDE.md:225`) | ✔ 四專案皆有 |
| A-3 | `README.md:141` 補「感知容差比對, 非 byte-exact」 | ✔ |
| A-4 | `spec/` 與 `test/` 不改 | ✔ 零變更(mtime 佐證) |

**事實基準(勿再質疑)**: 本專案 baseline 比對為 `assertBaselineMatch(buf, baselinePath, label, opts?)`(`test/e2e-setup.mjs:426`), 採 **pixelmatch 反鋸齒感知容差**(`includeAA:false` / `threshold:0.1` / `maxDiffPixels` 預設 100, `:427`), **非 byte-exact**。全 repo 唯一之 `buf.equals` 字樣為 `:414` 之**沿革註解**(「取代舊的 buf.equals」), **正確, 不得刪改**。`:336` 之 `curr.equals(prev)` 是 **settle 偵測**(刻意 byte 比較), 與 baseline 比對無關。

---

# 肆、凍結區(本次不執行)

| 項目 | 狀態 |
|---|---|
| `test/e2e-setup.mjs` 之比對實作、參數預設值、`includeAA:false` | 不動(現況正確) |
| `test/e2e-setup.mjs:414` 沿革註解 / `:336` `curr.equals(prev)` | 不動(刻意如此) |
| baseline 圖檔 / 標準圖重產 | 不動。**任何 ≥768px 版面變更才會觸發 mismatch**(見 D13) |
| `spec/流程_*.md` 既有 10 個 E2E 之驗證 bullet 措辭 | 不動(方案 A 下合法)。**S1 是「新增 bullet」, 不改既有** |
| **R4**: `ChatView.vue` 與 `LayoutContentTasks.vue` 之 `renderMd` + DOMPurify 重複**兩份** | **重構凍結**(業主指示)。解凍時建議優先(XSS 守門非單點, 違反 D10 單點維護精神) |
| **R5**: 後台三 CRUD 元件整套樣板重複 | **重構凍結**。解凍前須以 E2E-005/008/009/010 為安全網 |
| **T6 方向①**: w-orm-lmdb `channelId` 前綴複合 key | **不做**。方向②(封存/冷熱分離)已上線, 熱表恆小已大幅緩解 |

---

# 伍、已移入 `spec/設計要點與取捨.md` 者(本次新增)

依指示, 屬「設計要點與取捨」性質者不留在本規劃書:

| 編號 | 內容 |
|---|---|
| **D13** | RWD 採 master-detail 堆疊, 斷點 768px。含關鍵不變量:**≥768px 桌面版面須與改動前逐像素相同**(e2e 跑 1440×900, `isNarrow=false`, 故既有 baseline 不受影響) |
| **D14** | 成員類型在地化採 `cell-render`「顯示層映射」, 底層存原值(`doSaveMembers` 直讀 `opt.rows`, 轉底層值會污染 DB)。明列取捨: ag-grid 過濾器比對原值, 小表可接受 |

---

# 陸、執行紀律

1. **只做本規劃書 §壹 明列之項目**。§肆 凍結區一律不碰。
2. **順序強制**: `S1` → `T1`(先 spec 後 test)。不可繞過 spec 直接加 e2e。
3. `S2` / `S3` 為 doc-only, 零 runtime 風險, 不需重跑 `npm test`。
4. `T2` / `T3` 會動 `test/`, **修完須跑** `npm test`(基準線: unit **42** / api **30** / e2e **20**)。
5. `S4` 為 cosmetic, **不強制**;若修, 只移位不改號(`README.md:27,28` 以「D12」字面引用)。
6. 暫存檔一律落 `C:\opensrc\w-web-task\tmp\`;探索用 Glob/Grep/Read, 禁止 dump-to-disk。
7. 不主動 commit。
8. 任何**與本文描述不符**之現況(行號飄移、程式碼已被他人改動)—— **停下回報**, 不自行推測修改。
