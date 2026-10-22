# 規則帳本分冊:多人同時編輯(原則 10)之缺陷實證與第二波規劃(w-web-task)

本檔為 `sgud/rule/rulebook_concurrency.md` 之分冊(2026-10-23 第二波落地後依全域 §14 與 inv01 之建議拆分): 收錄第 6 節(現存缺陷實證 E2 / E3 / E4 / E7 / O1～O8)、第 7 節(第二波實作規劃: 改動站點、是否改用 procOrm、前端接點、V1～V14 測試計畫、受影響測試、改動範圍→測試對照), **節號、標題與內容自主檔原樣搬移, 不刪不改**(行號為 2026-10-22 盤點時之值, 改碼後以各節之盤點指令重取; 第二波實作後之現況見主檔「9. 第二波實作現況」)。索引與規則總表見主檔。

## 6. 現存缺陷實證(第 6 項)

探測腳本原置 `./tmp/inv01/`, 本輪結束已移至 `C:\opensrcOper\dnow\20261022221854\agent-out\inv01-probes\`(含輸出 `out/*.log`)並自 repo 清理; 重跑: 將 `lib.mjs` 與 `probe-*.mjs` 複製回 `./tmp/inv01/`。全部以**真實** lmdb ORM(`w-orm-lmdb` 1.0.42 + `w-serv-orm` 1.1.15)、真實 `procCore` / `lockSave` / `pmKeyMutex`(與 `WWebTask.mjs:183-236` 相同組裝)執行, 資料庫落在 `./tmp/inv01/db-<案>`。執行: `node C:/opensrcOper/tools/quiet-run.mjs --name inv01-<案> -- node ./tmp/inv01/probe-<案>.mjs`(e3 / e2 / e4 / e7 / other); 離開碼 1 = 有紅。

| 缺陷 | 探測 | 結果(2026-10-22) | 規格對應 |
|---|---|---|---|
| **E3** 成員存檔回寫游標 | `probe-e3.mjs` | 離開碼 1, **RED ×3**: ack 到 `MSG-100` 後管理員存成員頁 → 游標回 `""`; agent `getChannelsList` 讀到 `""`(整段訊息重讀); 未被編輯之 agent 列最後修改者被蓋成 admin-1 | V5 |
| **E2** 封存 vs `resetTask` | `probe-e2.mjs` | 離開碼 1, **RED ×3**: A) `tasksArchive.save` 人為延遲 300ms, 期間 `resetTask`(回 pending)→ 掃描回 `tasksMoved:1`, 熱表 0 筆、冷表 1 筆 state=error; B) 無人為延遲, 120 個過齡 error 任務、掃描中並行重置 → **成功重置 118、其中 117 其後消失**(自然競態窗為「select → 最後一筆 del」全程) | 方案 §六 E2 |
| **E4** 逐列存檔部分寫入 | `probe-e4.mjs` | 離開碼 1, **RED ×3**: A) 頻道三列皆改名、第 2 次寫入失敗 → 庫內 `c1-EDITED,c2,c3`(第 1 列已改); B) 成員頁新增 2 列、第 2 次失敗 → 庫內已有 alice; 按重試 → **alice 重複 2 列** | V12 |
| **E7** 推播丟草稿 | `probe-e7.mjs` | 離開碼 1, **RED ×3**(最小 Vue 2 + Vuex 重現): 草稿 `DRAFT-A` 於推播後變 `alpha`; `isModified` 仍 true; 內容全同之推播亦丟 | V11 |
| O1 修改已刪之列 → 復活 | `probe-other.mjs` | RED: 成員、頻道皆復活(`reject=null`, 庫內 1 筆) | V6 |
| O2 刪除不存在之列回成功 | 同 | RED: `deleteChannelMember` / `deleteChannel` 對不存在 id 皆 resolve | V7 |
| O3 `ackChannel` 與刪成員競態 | 同 | RED: 列被刪後 ack 之 `save` 復活**殘缺列** `{id, lastSeenMessageId, timeUpdate, userIdUpdate}`(無 channelId / memberId) | — |
| O4 成員 `(channelId, memberId)` 可重複 | 同 | RED: 2 列; ack 寫其一、`getChannelsList` 讀另一 → 游標永遠 `""` | — |
| O5 後端不驗頻道名稱必填 / 不重複 | 同 | RED: 重複名稱、空名稱皆被接受(僅前端 `errItemsByName` 擋) | 原則 4 |
| O6 存檔採用客戶端伺服器專有欄位 | 同 | RED: 可改 `userId`、`timeCreate`、`isActive='n'`(頻道自 `getChannelsList` 消失) | R-CONC-07 |
| O7 刪頻道不清理引用 / 對已刪頻道可發訊 | 同 | RED: 成員 / 訊息 / 任務各殘留 1; `postMessage` 對已刪頻道成功 | 原則 6 |
| O8 `respondTask` 非原子 | 同 | RED: 第二段失敗後重試 → 2 則 taskReply | — |

**E7 瀏覽器實證說明**: 未做瀏覽器實證。理由: ①驗證需同時起後端(11008 / 測試 11108)與前端並以兩個登入階段操作; 測試 harness 會寫入 `test/_tmp`, 本輪不得動 `test/`; ②重現的是 Vue 響應式機制, 與瀏覽器無關。已以**最小 Vue 2 + Vuex** 逐段複製元件之 `channels` / `changeParams` / `genOpt` 片段與 store 變更函式(行號見探測檔頭), 並於執行時檢查原始碼 7 個錨點行仍存在(漂移則 INCONCLUSIVE); 第二波以 e2e / 元件測試於真實元件上驗 V11。
**E4 / E3 / E2 之前端迴圈**: 探測複製前端迴圈程式(`LayoutContentChannels.vue:633-647`、`LayoutContentMembers.vue:729-743`), 失敗以包住探測自建 ORM 物件之方法注入; 後端函式為真實程式。

## 7. 第二波實作規劃(第 7 項)

### 7.1 改動站點清單(檔:行為現值)

**後端**
- `server/WWebTask.mjs:183-190` 取 `withTabLocks`、`guardWrite`(來自 `WServOrm` 回傳); `:236` 傳入 `procCore`; `:1028-1056` kpFunExt 增 `saveChannels`、`deleteChannels`、`saveChannelMembers`、`deleteChannelMembers`(各經 `wrapErrLog`)。
- `server/procCore.mjs`: `:63-110` saveChannel、`:113-128` deleteChannel、`:145-177` saveChannelMember、`:180-195` deleteChannelMember 改為薄包裝(共用核心); `:499-542` ackChannel(兩段式); `:653-703` archiveSweep(逐筆 `task:<id>` 重讀); 新增 4 個清單級函式; `postMessage :226` 補頻道存在檢查(第 2.1 節異議 4)。
- `server/procLang.mjs`: 新增 eng + cht 鍵(建議: `saveStale`〔對齊 perm〕/ `errBaselineFormat` / `errRowNotFound` / `errChannelNameInvalid` / `errChannelNameDuplicate` / `errMemberChannelMismatch` / `errChannelNotFound` / (Q5 裁示後)`errMemberDuplicate` 及前端提示「資料已被他人更新, 請重新載入」)。
- 新增 `src/schema/contracts/*.mjs`(7 份, 第 4 節); `package.json` 之 `w-serv-orm` 升版至含共用核心者(使用者通知後裝)。
- `g.initialData.mjs`: 不改(R-CONC-13)。

**前端**
- `LayoutContentChannels.vue`: `:260-281` changeParams(草稿凍結 + 基準凍結 + 自身存檔期間不誤判)、`:521-597` 刪除(`:565-571` 迴圈 → `deleteChannels`)、`:607-680` 存檔(`:635-647` 迴圈 → `saveChannels`); 模板增「資料已被他人更新」提示條與「重新載入」鈕。
- `LayoutContentMembers.vue`: `:338-363` changeParams、`:541-560` onChangeChannel(有草稿時確認)、`:616-697` 刪除(`:660-666`)、`:707-782` 存檔(`:731-743`)。
- 新增前端基準輔助(例 `src/plugins/mBaseline.mjs`: 對顯示列呼叫共用 `buildBaseline` + 契約); `ChatView.vue:245` 輪詢不改(P8 已查證非草稿路徑)。

### 7.2 是否改用 procOrm — 評估與建議: **不改**

- 現況不經 procOrm 之原因仍在: procCore 檔頭(`procCore.mjs:20`)為避免 `clearXSS` 改動 markdown `content` / `result`(D10); messages / tasks 必須維持 `woItems` 直寫。
- channels / channelMembers 兩表為純文字欄位, 改 procOrm 技術上可行(可得稽核欄自動填、只改不增與未命中回報), 但: ①`clearXSS` 會改寫含 `<字母` 之 `description` / `levels` 等既有資料之儲存形態(行為變更); ②procOrm 對字串主鍵含 HTML 標記整批 reject; ③「只改不增」之底層即 `woItems.save(row, { autoInsert:false })`、「未命中」即結果 `n`/`nDeleted`, 本套件自行呼叫等價且無副作用。
- 建議(依原則 4「所有入口一致」+ 既有檔頭決策自行決定): 全程沿用 `woItems`, 只採共用核心之純函數(`digestRow / buildBaseline / compareBaseline`)、`withTabLocks` / `guardWrite`、與 `{ autoInsert:false }`; 待共用核心發布後以其實際 API 再核對一次(若核心把「只改不增」封裝在 `woItems` 層則直接採用)。

### 7.3 前端自算基準與草稿保護之接點

- 基準: 頻道頁於「由 store 重建 items」當下對 `items`(未編輯快照)算 `baselineLoaded = buildBaseline(items, channelsContract)` 並凍結; 成員頁於 `loadMembers` / 存刪後重載(`:573`、`:676`、`:755`)取得 `membersLocal` 時算。存檔送 `baselineLoaded`, 不用編輯後之列重算。V10: 前端收到之列(資料通道 / RPC 經 JSON 傳輸)所算 = 伺服端新鮮讀取所算(含 lmdb 型別)。
- 草稿保護(頻道頁): `changeParams` 計算屬性有副作用 → 改為明確的 `rebuildFromStore()`; 推播到達時 `isModified === true` 且非自身存檔期間 → 不重建、設 `staleNotice = true`; 自身存檔期間(`runSubmit` 進行中)到達之推播視為自己的寫入, 記 `needRebuild`, 成功後重建、失敗保留草稿。存檔被拒(`saveStale` 等)→ 保留草稿 + 提示條。「重新載入」鈕才丟草稿重建(確認框)。
- `isEditable` 切換(P2)與成員頁切頻道(P5): 有草稿時保留 / 確認, 不靜默丟。
- 成員頁無推播重建, 草稿保護只需處理 P2、P5 與存檔被拒; 可選: 監看 `state.channelMembers`(已同步)對本頻道算摘要與 `baselineLoaded` 比較, 不同則顯示提示條(不重建); ack 游標不入摘要故不會誤報。

### 7.4 規格第 13 節 V1–V14 逐條對應之測試計畫

測試檔建議(命名依 `role-coder-for-test`: `test/*.test.mjs`, 前綴分層): `test/unit-procCoreConcurrency.test.mjs`(真實 lmdb 於 `test/_tmp/concurrency/`, 以 inv01 探測腳本轉為斷言)、`test/api-concurrency.test.mjs`(真後端經資料通道 / RPC)、e2e 增案(見下)。

| # | 層 | 計畫(對應現有探測) | 備註 |
|---|---|---|---|
| V1 | unit + api + e2e | A、B 載入同表; A 存; B 舊基準存 → 整次拒收、零寫入(庫內 = A 的結果); e2e 另驗草稿保留 + 提示條 | 頻道、成員各一組 |
| V2 | **不適用** | 本套件無外部同步 / 外部匯入(channels / channelMembers 僅後台寫入, 無整批重寫來源; 原則 11 之 `C:\opensrcOper\dspec\外部匯入之定義與機制.md` 未涵蓋本套件, 見 Q8) | 離線工具 `g.initialData` 只在服務停止時執行, 固定 id 重播種摘要不變, 另列一案「重播種後舊基準可存」可選 |
| V3 | **不適用** | 同上 | — |
| V4 | unit(變形) | 本套件無雙方欄位, 但**系統新增成員列**(ack 缺列 W16、saveChannel 補 agent 列 W03)為清單新增 → 持舊畫面存成員頁應被拒(`added`) | 驗證「系統新增亦使舊畫面失效」 |
| V5 | unit + api | = E3 探測轉綠: ack 後管理員存檔, 游標維持 | 另驗清單存檔不蓋未變動列之稽核欄 |
| V6 | unit | = O1 轉綠: 修改已刪之列 → `rowNotFound`、列不復活(單筆 API 與清單 API 各一) | ack 缺列路徑另驗不產生殘缺列(O3 轉綠) |
| V7 | unit | = O2 轉綠: 刪除不存在之列(帶 / 不帶基準)→ `rowNotFound` | — |
| V8 | unit + api | 整表存檔期間他人新增: channels(基準後新增 → 拒收且他人列保留)、members(他頻道新增不影響本頻道存檔、本頻道新增則拒收) | 驗刪除集合＝基準 − 送出 |
| V9 | **不適用 / 變形** | 無 `orderKey`(存檔不重編 order)。變形案: 系統改 `order`(serverOnly)後舊基準仍可存 | 若日後開放編輯 `order` 再補 |
| V10 | api | 頻道: 資料通道 `select` 之列(經 JSON 傳輸)算 `buildBaseline` = 伺服端新鮮讀取算; 成員: RPC `getChannelMembers` 同; 含 lmdb 型別 | 與前端同一份共用模組 |
| V11 | e2e(+ 元件測試) | 頻道頁有草稿時另一階段存檔觸發推播 → 草稿與基準不變、出現提示條; 引用表觸發之重建(channels 為成員頁頻道選擇器來源)同驗 | 見下「e2e 增案」 |
| V12 | api | 清單 API 多列提交其中一列過期 → 零寫入(= E4 轉綠); 另驗注入 ORM 硬失敗之補償回滾(若 Q3 採行) | 前端以 spy 驗單次 RPC |
| V13 | unit + api | 未知版本前綴 / 格式錯誤之基準 → `baselineFormat`, 且不寫入; 不得當未帶 | — |
| V14 | unit | 以人為延遲(包住 `woItems.*.save`)於比對與寫入間並行他人寫入(單筆 API、另一清單 API、ack 缺列)→ 序列化, 不可插入; 另驗 E2: 封存掃描逐筆鎖內重讀(= E2 探測 A / B 轉綠) | — |

**e2e 增案(須授權)**: `spec/流程_頻道任務調度.md` 新增 E2E-014(頻道頁草稿保護)、E2E-015(成員頁舊畫面存檔被拒)並產標準圖, 屬新增標準圖須使用者授權(`role-coder-for-test`), 列待裁示 Q7; 未授權前以 api + 元件層驗 V11/V1, e2e 僅回歸既有案例。

### 7.5 預估影響之既有測試

| 檔 | 受影響點 | 動作 |
|---|---|---|
| `test/unit-procCore.test.mjs`(45 處相關) | 假 `woItems` 的 `save` 忽略 `autoInsert`、`del` 恆回 `nDeleted:1`; `procCore(...)` 建構(`:104` 與 D16 並行案)須傳 `withTabLocks` / `guardWrite`; 若有案例預期「修改不存在之列即插入」「刪除重複不報錯」須改 | 升級假 table 並補依賴; 逐案核對 |
| `test/api-doubleclick.test.mjs`(32 處) | DC-04 以 `{id, agentId}` 部分列修改(須容許不帶基準之部分欄位); DC-07 依序刪除第二次將回 `rowNotFound`(並行時仍 `deleteInProgress`); `after` 清理的 `deleteChannel` 不斷言結果, 影響低 | 小改斷言 |
| `test/api-dataChannel.test.mjs`(8) | 表操作只開 select 之斷言不變; 若列舉 kpFunExt 名稱需補新名 | 核對 |
| `test/api-agent.test.mjs`(4) | `ackChannel` 流程(缺列 upsert、游標) | 回歸 |
| `test/e2e-channeltask.test.mjs`(5) | 受影響案例: **E2E-005**(後台頻道表)、**E2E-008**(成員 CRUD, 儲存與刪除改走清單 API)、**E2E-010**(後台成員表); 預期標準圖零改寫(正常態不顯示提示條) | 跑 005 / 008 / 010 × 兩語系 = 6 案; 其餘 e2e 為共用基礎外之瀏覽 / 發訊, 不重跑 |
| 其餘(`unit-*` 十檔中與 procCore 無關者、`api-files`、`api-tokenLeak`) | 不涉及 | 不跑或全跑 unit / api(非瀏覽器全跑) |

### 7.6 改動範圍 → 測試對照(主控共通守則 12 要求「沒有就先建」)

| 改動範圍 | 必跑測試 |
|---|---|
| `server/procCore.mjs`(寫入函式) | `unit-procCore`、`unit-procCoreConcurrency`(新)、`api-doubleclick`、`api-agent`、`api-concurrency`(新)、e2e 005 / 008 / 010 |
| `server/WWebTask.mjs`(kpFunExt / 組裝) | 上列 + `api-dataChannel`、`unit-authorizeExec`、`unit-optRemoved` |
| `src/schema/**`(契約 / schema) | 上列 + 契約核對單元測試 |
| 前端清單頁(`LayoutContentChannels.vue` / `LayoutContentMembers.vue`) | e2e 005 / 008 / 010(兩語系)+ 新增 V11 案 |
| 共用基礎(測試輔助、版面共用元件、樣式、伺服端核心、建置設定) | 擴大至 e2e 全跑 |

