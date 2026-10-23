# 狀態(w-web-task)

本檔只記**現況**(各功能做到哪裡、對應之規則帳本條目與測試檔、已知缺口與待辦、最近一次驗證或發布之版本); 過程與教訓見 `sgud/exp/experience.md`。接續工作先讀本檔。規則帳本索引見 `sgud/rule/rulebook.md`(2026-10-22 起依類型分冊)。

更新: 2026-10-23(任務 task-run02: 第三輪修正輪——刪頻道移入封存表、編輯器開啟中視同草稿)

## 版本與驗證

- 套件版本 `1.0.35`(`package.json`, 本輪未動版本; run01 成果已由主控以本機檢查點提交 `50d9a11`)。本輪(run02)改動在工作樹, 未提交。相依: `w-serv-orm` `^1.1.17`。
- 最近一次完整驗證(全套)為主控於 run01 後所跑(383 passing); 本輪(2026-10-23 run02)**未跑全套**(主控最末輪於凍結碼跑一次), 只跑受影響者:
  - 非瀏覽器: `unit-procCoreConcurrency` 94(含新增「Q2」節 22 案)、`unit-procCore` 52、`unit-draft` 22、`api-concurrency` 9(含 Q2 一案)等, 結果見任務報告; e2e `E2E-005 / 008 / 010 / 014 / 015 / 016 / 017` 兩語系 compare(既有標準圖 0 張改變; 新增 6 張: E2E-016 / 017)。細節見任務報告 `task-run02-修正報告.md`。

## 功能現況

| 功能 | 現況 | 規則帳本(分冊) | 測試 |
|---|---|---|---|
| 頻道 / 成員後台管理(整表編輯頁) | 已上線; **多人同時編輯已防護(D18)**: 清單級 API + 基準比對 + 表鎖 + 補償還原; 前端草稿保護; 單筆 API 保留收緊 | `rulebook_concurrency.md`(主檔; 分冊 inventory / contract / defects); `rulebook_backend.md` D16 | `unit-procCore`、`unit-procCoreConcurrency`、`unit-draft`、`api-doubleclick`、`api-concurrency`、`e2e-channeltask` E2E-005 / 008 / 010 / 014 / 015 |
| 訊息、任務生命週期(`postMessage`、`claimTask` / `respondTask` / `resetTask`) | 已上線; `task:<id>` 鎖 + `state` 守衛(D6); `respondTask` 兩段寫入冪等與補償(O8); `postMessage` 對已刪頻道回 `errChannelNotFound` | `rulebook_backend.md` D6、D8、D9 | `unit-procCore`、`unit-procCoreConcurrency`、`api-agent`、`api-doubleclick` |
| 刪頻道之訊息與任務(Q2, D19; 2026-10-23 使用者裁示「移入封存表」) | **已實作**: 三入口共用 `buildChannelDeleteOps`; 任務(含進行中, 維持原狀態)與訊息整列移入 `tasksArchive` / `messagesArchive`, 與成員連帶刪除同一次操作、全有或全無(補償); 頻道列最後刪; 熱表與 `getStats` 不計; 已移走之任務不可再認領 / 回應 / 重置; 刪除確認框提示此後果 | `rulebook_concurrency.md` R-CONC-15、9.8 | `unit-procCoreConcurrency`「Q2」節、`api-concurrency` Q2 |
| agent 已讀游標 `ackChannel`(D7) | 已上線; **兩段式鎖**: 更新路徑實體鎖 + 只改不增, 缺列路徑表鎖 + 鎖內重查; 後台成員存檔不再回寫游標(E3 已修) | `rulebook_backend.md` D7; `rulebook_concurrency.md` | `unit-procCore`、`unit-procCoreConcurrency`、`api-agent`、`api-doubleclick` DC-05 / DC-06 |
| 冷熱分離封存 `archiveSweep`(D12) | 已上線(啟動後 30 秒首掃 + 每小時); **逐筆 `task:<id>` 鎖後重讀再搬(E2 已修)** | `rulebook_backend.md` D12; `rulebook_concurrency.md` | `unit-procCore`(封存案)、`unit-procCoreConcurrency` E2 三案 |
| 圖檔 `uploadFile` / `getFile`(D10) | 已上線; 僅點陣圖白名單 inline | `rulebook_backend.md` D10 | `api-files` |
| 資料通道只開 `select`(D17) + 連線閘 | 已上線 | `rulebook_backend.md` D17-1～3 | `api-dataChannel`、`unit-authorizeExec`、`unit-optRemoved` |
| 權杖外洩防護(D15) | 已上線 | `rulebook_security.md` | `api-tokenLeak`、`unit-maskLog`、`unit-wrapInjected` |
| 按鈕雙擊防護(D16) | 已上線(前端 `runSubmit`、後端 `lockSave`; 「確保成員列」之原子化由 D18 之表鎖取代原共用 kmx key) | `rulebook_backend.md` D16; `rulebook_ui.md` | `unit-submitGuard`、`unit-lockSave`、`api-doubleclick` |
| 前端 UI(RWD D13、i18n、彈窗) | 已上線; 後台頻道 / 成員頁新增草稿保護提示條與成員重複之警告圖示; **儲存格編輯器開啟中(已輸入未按 Enter)收到推播視同草稿**(不重建、凍結基準、提示; 編輯器關閉後依一般規則; N1 已修) | `rulebook_ui.md`; `rulebook_concurrency.md` R-CONC-09 | `unit-rwd`、`unit-draft`; e2e E2E-016 / 017 |
| e2e(17 案 × eng / cht = 34) | 標準圖 58 張(既有 36 + E2E-014 / 015 新增 16 + E2E-016 / 017 新增 6); harness 單一擁有者 | `rulebook_test.md` | `e2e-channeltask` |

## 多人同時編輯(原則 10)

- 狀態: **第二波已實作(2026-10-23, task-run01), 第三輪修正輪已完成(2026-10-23, task-run02)**。規格 V1～V14 逐條有測試(V2 / V3 不適用: 本套件無外部匯入; V4 / V9 為變形), 對照見 `rulebook_concurrency.md` 第 9.3 節; 缺陷 E2 / E3 / E4 / E7 / O1～O8 皆轉綠(O7 之訊息與任務部分於第三輪依使用者裁示實作後亦轉綠); 變異驗證 run01 49 個(48 被抓到、1 個等價變異)、run02 後端 34 個(33 被抓到、1 對照綠)與前端 8 個(7 被抓到、1 存活為防禦性冗餘; 見 `rulebook_concurrency.md` 9.8); 經 sol / beam 外審並修補(9.6)、run02 另經 sol 外審(見任務報告)。
- 後端: `server/procCore.mjs`(清單級 API、共用核心、補償 `runOps`、`ackChannel` 兩段式、`archiveSweep` 逐筆鎖、`respondTask` 冪等、單筆 API 收緊)、`server/WWebTask.mjs`(取 `withTabLocks` / `guardWrite`、kpFunExt 增 4 個)、`server/procLang.mjs`(新增語系鍵)、`src/schema/contracts/`(7 份契約 + `index.mjs`)。
- 前端: `src/plugins/mDraft.mjs`(草稿保護純邏輯)、`LayoutContentChannels.vue` / `LayoutContentMembers.vue`。
- **待裁示(使用者)**: 無。(原「刪頻道時訊息與任務之處置」已於 2026-10-23 由使用者裁示「移入封存表」並實作, 見上表與 D19; 進行中任務一併移入、維持原狀態, 由本套件依原則 3 判定, 使用者可否決。)
- 已知缺口(低): 成員頁無推播自動重載(沿用既有行為, 有草稿或編輯器開啟中時提示); 升版前已刪頻道所遺之熱表孤兒訊息 / 任務不自動搬移(稽核方式見 README Upgrade Notes); 提交後事件回呼前之空窗於元件層無決定性 e2e(純邏輯 `resolveModified` 有 unit 守; 見 `rulebook_concurrency.md` 9.8)。成員頁切換頻道時有未存修改之確認(P5)已於外審補修實作(`switchChannelDiscardConfirm`)。已知不修(附理由)見 `rulebook_concurrency.md` 9.6: 毫秒級輪次識別邊界、`opModify` 補償對缺欄寫空字串。
- 外部匯入(原則 11): 本套件無此功能, 亦未見預期(Q8)。

## 已知缺口 / 待辦

- 見 `rulebook_changes.md`「已知缺口 / 待辦」: 每操作兩張標準圖第 2 期(含新案例 E2E-014 / 015 之各步前後圖)、窄版無 e2e、`procCore` 之 `procOrm` 參數未用(保留)、後端無完整停止。
- 第三輪(task-run02)無新增待辦。
