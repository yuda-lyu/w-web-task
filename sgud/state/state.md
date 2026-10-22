# 狀態(w-web-task)

本檔只記**現況**(各功能做到哪裡、對應之規則帳本條目與測試檔、已知缺口與待辦、最近一次驗證或發布之版本); 過程與教訓見 `sgud/exp/experience.md`。接續工作先讀本檔。規則帳本索引見 `sgud/rule/rulebook.md`(2026-10-22 起依類型分冊)。

更新: 2026-10-23(任務 task-run01: 多人同時編輯第二波實作輪後)

## 版本與驗證

- 套件版本 `1.0.34`(`package.json`, 本輪未動版本); 最近提交 `92592d6`(2026-10-20 `modify: update pks`)。本輪改動在工作樹, 未提交。相依: `w-serv-orm` 升至 **1.1.17**(`package.json` `^1.1.17`)。
- 最近一次完整驗證(全套)仍為 **2026-10-14** — `npm test` 284 passing / 0 failing; 本輪(2026-10-23)**未跑全套**(主控最末輪於凍結碼跑一次), 只跑受影響者:
  - 外審(sol / beam)修補後之終輪: 非瀏覽器 12 檔 229 passing(`unit-procCore` 52、`unit-procCoreConcurrency` 72、`unit-draft` 15、`api-concurrency` 8、`api-doubleclick` 7、`api-agent` / `api-dataChannel` / `api-tokenLeak` / `api-files` / `unit-authorizeExec` / `unit-optRemoved` / `unit-lockSave` 75)、e2e `E2E-005 / 008 / 010 / 014 / 015` 兩語系 10 passing(既有標準圖 0 張改變; 新增 16 張)。細節見任務報告。

## 功能現況

| 功能 | 現況 | 規則帳本(分冊) | 測試 |
|---|---|---|---|
| 頻道 / 成員後台管理(整表編輯頁) | 已上線; **多人同時編輯已防護(D18)**: 清單級 API + 基準比對 + 表鎖 + 補償還原; 前端草稿保護; 單筆 API 保留收緊 | `rulebook_concurrency.md`(主檔; 分冊 inventory / contract / defects); `rulebook_backend.md` D16 | `unit-procCore`、`unit-procCoreConcurrency`、`unit-draft`、`api-doubleclick`、`api-concurrency`、`e2e-channeltask` E2E-005 / 008 / 010 / 014 / 015 |
| 訊息、任務生命週期(`postMessage`、`claimTask` / `respondTask` / `resetTask`) | 已上線; `task:<id>` 鎖 + `state` 守衛(D6); `respondTask` 兩段寫入冪等與補償(O8); `postMessage` 對已刪頻道回 `errChannelNotFound` | `rulebook_backend.md` D6、D8、D9 | `unit-procCore`、`unit-procCoreConcurrency`、`api-agent`、`api-doubleclick` |
| agent 已讀游標 `ackChannel`(D7) | 已上線; **兩段式鎖**: 更新路徑實體鎖 + 只改不增, 缺列路徑表鎖 + 鎖內重查; 後台成員存檔不再回寫游標(E3 已修) | `rulebook_backend.md` D7; `rulebook_concurrency.md` | `unit-procCore`、`unit-procCoreConcurrency`、`api-agent`、`api-doubleclick` DC-05 / DC-06 |
| 冷熱分離封存 `archiveSweep`(D12) | 已上線(啟動後 30 秒首掃 + 每小時); **逐筆 `task:<id>` 鎖後重讀再搬(E2 已修)** | `rulebook_backend.md` D12; `rulebook_concurrency.md` | `unit-procCore`(封存案)、`unit-procCoreConcurrency` E2 三案 |
| 圖檔 `uploadFile` / `getFile`(D10) | 已上線; 僅點陣圖白名單 inline | `rulebook_backend.md` D10 | `api-files` |
| 資料通道只開 `select`(D17) + 連線閘 | 已上線 | `rulebook_backend.md` D17-1～3 | `api-dataChannel`、`unit-authorizeExec`、`unit-optRemoved` |
| 權杖外洩防護(D15) | 已上線 | `rulebook_security.md` | `api-tokenLeak`、`unit-maskLog`、`unit-wrapInjected` |
| 按鈕雙擊防護(D16) | 已上線(前端 `runSubmit`、後端 `lockSave`; 「確保成員列」之原子化由 D18 之表鎖取代原共用 kmx key) | `rulebook_backend.md` D16; `rulebook_ui.md` | `unit-submitGuard`、`unit-lockSave`、`api-doubleclick` |
| 前端 UI(RWD D13、i18n、彈窗) | 已上線; 後台頻道 / 成員頁新增草稿保護提示條與成員重複之警告圖示 | `rulebook_ui.md` | `unit-rwd`; e2e |
| e2e(15 案 × eng / cht = 30) | 標準圖 52 張(既有 36 + E2E-014 / 015 新增 16); harness 單一擁有者 | `rulebook_test.md` | `e2e-channeltask` |

## 多人同時編輯(原則 10)

- 狀態: **第二波已實作(2026-10-23, task-run01)**。規格 V1～V14 逐條有測試(V2 / V3 不適用: 本套件無外部匯入; V4 / V9 為變形), 對照見 `rulebook_concurrency.md` 第 9.3 節; 缺陷 E2 / E3 / E4 / E7 / O1～O8 皆轉綠(O7 之訊息與任務部分除外, 待裁示); 變異驗證 49 個(48 被抓到、1 個等價變異); 經 sol / beam 外審並修補(見 `rulebook_concurrency.md` 9.6)。
- 後端: `server/procCore.mjs`(清單級 API、共用核心、補償 `runOps`、`ackChannel` 兩段式、`archiveSweep` 逐筆鎖、`respondTask` 冪等、單筆 API 收緊)、`server/WWebTask.mjs`(取 `withTabLocks` / `guardWrite`、kpFunExt 增 4 個)、`server/procLang.mjs`(新增語系鍵)、`src/schema/contracts/`(7 份契約 + `index.mjs`)。
- 前端: `src/plugins/mDraft.mjs`(草稿保護純邏輯)、`LayoutContentChannels.vue` / `LayoutContentMembers.vue`。
- **待裁示(使用者)**: **刪頻道時該頻道之訊息與任務之處置**。現維持不刪、不搬(成員列已連帶刪除、對已刪頻道發訊 / 已讀 / 存成員被拒); 原則 6 要求引用連帶清理, 但屬刪除使用者資料(原則〇之一③); 主控建議移入既有封存表。
- 已知缺口(低): 成員頁無推播自動重載(沿用既有行為, 有草稿時提示)。成員頁切換頻道時有未存修改之確認(P5)已於外審補修實作(`switchChannelDiscardConfirm`)。已知不修(附理由)見 `rulebook_concurrency.md` 9.6: 毫秒級輪次識別邊界、`opModify` 補償對缺欄寫空字串。
- 外部匯入(原則 11): 本套件無此功能, 亦未見預期(Q8)。

## 已知缺口 / 待辦

- 見 `rulebook_changes.md`「已知缺口 / 待辦」: 每操作兩張標準圖第 2 期(含新案例 E2E-014 / 015 之各步前後圖)、窄版無 e2e、`procCore` 之 `procOrm` 參數未用(保留)、後端無完整停止。
- 新增: 刪頻道之訊息 / 任務處置待裁示(上節)。
