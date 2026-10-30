# w-web-task

> 任務安排調度套件 — 讓人類在頻道內對話、把對話擴充成任務, 並讓 AI agent 以輪詢方式收取任務、執行、回應. 認證委外 SSO.

架構與姊妹專案一致 (mjs + Vue2 + lmdb + w-serv-hapi + w-serv-orm + w-component-vue + wsemi): 後端 Hapi 服務 + Vue2 前端 SPA + 對外 HTTP REST API 供 agent 串接.

## 系統定位

「頻道 (channel) → 對話訊息 (message) → 任務 (task)」三層模型:

- **人類** 透過 **聊天式 Web UI** (左1 rail 統計/頻道/後台 → 頻道區左2 階層頻道樹 → 右側對話時間軸 + 訊息輸入框) 在頻道發訊、貼多圖、把訊息「擴充指向任務」、檢視任務與 agent 回應; 後台管理收納頻道/成員/任務之表格 CRUD.
- **AI agent** 透過對外 HTTP REST API 輪詢主責頻道、認領任務、執行後回應, 並可上傳/檢視檔案 (圖台). CLI session 內以 curl/fetch 即可呼叫, 無需持久連線.
- **任務一收一回**: 任務有「收 (payload)」與「回 (result)」, 回完即結束 (done/error 為終態).
- **圖台 (file store)**: 圖片/檔案上傳前先存圖台取 file id, 訊息只存 id (不內嵌 base64) → 對話精簡、省 agent token; agent 可經 API 查 metadata 與取檔檢視.

## 資料模型

七張表 (LMDB; 主鍵 `genIDSeq()` UUIDv7 時序遞增; 時間 `nowms2str()`; 稽核欄位 userId/timeCreate/userIdUpdate/timeUpdate/isActive):

| 表 | 用途 | 關鍵欄位 |
|---|---|---|
| **channels** | 頻道 | name, description, **levels (階層, 句點分隔, 供樹分類)**, agentId (主責 agent), ownerId |
| **channelMembers** | 頻道成員 (兼 agent 已讀游標) | channelId, memberId, memberType(human/agent), role, **lastSeenMessageId** |
| **messages** | 對話訊息 | channelId, senderId, senderType, kind(text/task/taskReply), content, **attachments (file id 陣列 JSON)**, taskId |
| **tasks** | 任務 | channelId, messageId, title, payload(收), state, assigneeId, result(回), errorKey, resultMessageId, timeClaim, timeDone |
| **files** | 圖台檔案 metadata | name(原始檔名), type(mime), size; 實體 bytes 存 `./dbf/<id>` (無副檔名) |
| **messagesArchive** | 訊息封存冷表 | schema 同 messages; 逾齡舊訊息由封存掃描搬入 (spec D12) |
| **tasksArchive** | 任務封存冷表 | schema 同 tasks; 終態且逾齡任務由封存掃描搬入 (spec D12) |

封存 (冷熱分離): 終態任務/舊訊息逾 `archiveAfterDays` (settings.json, 預設 30 天, <=0 停用) 由每小時背景掃描搬至冷表, 熱表僅留活躍資料 → agent 輪詢成本不隨歷史累積成長. 冷表查詢走 `getArchivedTasks`/`getArchivedMessages` 或後台任務頁「顯示封存」切換 (唯讀).

關聯 (字串外鍵 + application-layer 查詢): channels 1:N messages/tasks/channelMembers; message(kind=task) → task.messageId; task → resultMessageId (回應的 taskReply 訊息); message.attachments → files.id.

### 任務狀態機

```
            claimTask                respondTask(done)
[pending] ───────────▶ [running] ──────────────────▶ [done]   終態
   ▲                      │
   │                      └── respondTask(error) ──▶ [error]   終態
   └──── resetTask (error/running → pending, 重試/救援) ───────┘
```

- `pending` 待認領 → `claimTask` 原子認領 (state==='pending' 才成功, 防兩 agent 搶) → `running`
- `running` → `respondTask` 寫 result + 終態 (done/error), 並鏡射一筆 taskReply 訊息回頻道
- `error`/停滯 `running` → `resetTask` 退回 pending (清空殘留欄位) 重試
- 三動詞共用 `kmx('task:'+taskId)` 序列化 + state 守衛, 保證並發正確性.

詳見 [spec/設計總覽.md](spec/設計總覽.md)、[spec/設計_agent協定.md](spec/設計_agent協定.md)、[spec/設計要點與取捨.md](spec/設計要點與取捨.md).

## 安裝與啟動

```bash
npm install
node g.initialData.mjs        # 初始化 DB (種子: demo 頻道)
```

開發需 3 個服務協作 (port 見 `CLAUDE_settings.md`):

| 服務 | 指令 | port |
|---|---|---|
| 後端 | `node srv.mjs` | 11008 |
| 前端 (dev) | `npm run serve` | 8080 (衝突另選) |
| w-screenctl (e2e 探索用) | `node node_modules/w-screenctl/g.mjs` | 7000 |

設定: `settings.json` (JSON5; serverPort/language/showLanguage/archiveAfterDays) + `g.getSettings.mjs` (dbUrl/dbName/ssoBaseUrl/ssoAppToken/ssoLoginUrl).

開發登入捷徑 (NODE_ENV !== production): 瀏覽器網址帶 `?token=sys` 以系統管理者登入; `?token=agent-demo` 為示範 agent 身分. 正式部署每個使用者/agent 以 SSO 核發之 token 認證 (參見「認證」).

## 對外 agent API (HTTP REST)

> token 由 `?token=` query 或 POST payload 帶入; 回 `{ state:'success'|'error', msg }`. 查詢成功回數據, 操作成功回結果, 錯誤回 i18n key. 身分 (senderId/assigneeId) 一律取自 token 解析結果.

| method | path | 功能 | 參數 |
|---|---|---|---|
| GET | /api/getChannels | 查頻道清單 (agentId 過濾時附該 agent 游標) | token, agentId? |
| GET | /api/getRecentMessages | 查訊息 (afterId 給定→回該 id 之後全部新訊息上限500; 否則最近 n) | token, channelId, n=20, afterId? |
| GET | /api/getRecentTasks | 查任務 (state 過濾; order=asc 最舊優先 FIFO / desc 最近優先) | token, channelId, n=20, state?, order=desc |
| GET | /api/getTask | 查單一任務 | token, taskId |
| GET | /api/getArchivedTasks | 查頻道封存任務 (冷表, 唯讀稽核) | token, channelId, n=20, order=desc |
| GET | /api/getArchivedMessages | 查頻道封存訊息 (冷表, 唯讀稽核) | token, channelId, n=20 |
| POST | /api/postMessage | 發訊 (asTask=true 同時開任務; attachments=file id 陣列) | token, channelId, content, asTask?, title?, attachments?, senderType? |
| POST | /api/claimTask | 認領任務 (pending→running) | token, taskId |
| POST | /api/respondTask | 回應任務 (running→done/error; 唯一終態入口) | token, taskId, result, state='done', errorKey? |
| POST | /api/resetTask | 重置任務 (error/running→pending) | token, taskId |
| POST | /api/ackChannel | 推進 agent 在該頻道之已讀游標 | token, channelId, lastMessageId |
| POST | /api/uploadFile | 上傳檔案至圖台 → 回 `{id,name,type,size}` | token, name, type, dataBase64 |
| GET | /api/getFileInfo | 查檔案 metadata (原始檔名/type/size) | token, id |
| GET | /api/getFile | 串流檔案 bytes (看圖/下載; 直接回二進位) | token, id |
| GET | /api/getStats | 系統統計 (頻道/訊息/任務各狀態計數) | token |
| GET | /api/getUserByToken | (w-ui-loginout 用) token→user | token |

對內前端 (kpFunExt WebSocket RPC) 另有 getWebInfor / getChannelsList / saveChannels / deleteChannels / saveChannel / deleteChannel / getChannelMembers / saveChannelMembers / deleteChannelMembers / saveChannelMember / deleteChannelMember / getMessages / postMessage / getTasks / getTask / claimTask / respondTask / resetTask / ackChannel / uploadFile / getFileInfo / getStats — 與對外面共用同一 procCore 業務邏輯 (getFile 走 HTTP 二進位).

### 多人同時編輯 (後台頻道 / 成員清單頁)

多位系統管理者可同時開著後台「頻道管理」「成員」頁編輯 (規格: opensrcOper `dspec/多人同時編輯之寫入契約.md`; 設計 `spec/設計要點與取捨.md` D18). 規則:

- **拿舊畫面存檔 → 整次拒收、零寫入**: 後台頁以**清單級 API** 存檔 / 刪除 — `saveChannels(rows, { baseline })`、`deleteChannels(ids, { baseline })`、`saveChannelMembers(channelId, rows, { baseline })`、`deleteChannelMembers(channelId, ids, { baseline })` — 並帶「載入時畫面所見之列」之基準 (`w-serv-orm/src/baseline.mjs` 之 `buildBaseline`, 契約見 `src/schema/contracts/`; 頻道為整表、成員為該頻道). 後端於表鎖內新鮮讀取比對, 載入後若他人新增 / 修改 / 刪除任一列即拒收 (`saveStale`, 先動先贏). 回傳 `{ inserted, modified, deleted, unchanged, rows }`, 其中 `rows` 為寫入後之伺服端列, 前端以之取新基準.
- **不帶基準者 (外部呼叫, 如持系統管理者權杖直打資料通道) 後者蓋前者**, 但修改只改不增 (列已被刪 → `errRowNotFound`, 不復活)、刪除未命中 → `errRowNotFound`; 不帶基準之清單存檔無刪除集合 (只動送出之列). 單筆 API (`saveChannel` / `deleteChannel` / `saveChannelMember` / `deleteChannelMember`) 保留供外部呼叫, 屬不帶基準之寫入; 前端不再呼叫.
- **草稿保護**: 有未存修改時收到推播不重建編輯中之內容並顯示「資料已被他人更新」提示條 (內容全同之推播不誤報); 存檔被拒草稿保留, 提示條提供「重新載入」(確認後捨棄草稿).
- **伺服器專有欄位** (`userId / timeCreate / userIdUpdate / timeUpdate / isActive / order`, 成員之 `lastSeenMessageId`) 不採用客戶端值; agent 已讀游標只由 `ackChannel` 更新, 後台成員存檔不會回寫舊游標.
- **資料規則於後端強制**: 頻道名稱必填且不重複、同一頻道內 `(channelId, memberId)` 不重複 (以寫入後之結果判定, 可於同一次存檔刪掉既有重複列; 既有重複於成員頁以警告圖示提示); 成員清單每列 `channelId` 須等於參數.
- **寫入中途硬失敗** (非競爭, 如磁碟滿) 依前像補償還原: 成功還原回 `saveRolledBack` (未做任何變更)、補償亦失敗回 `saveWriteFail` (部分資料可能已寫入, 已記 log).
- **刪頻道**: 成員列連帶刪除, 該頻道之**訊息與任務 (任何狀態, 含進行中) 整列移入既有封存表** `messagesArchive` / `tasksArchive` (不直接刪除、不留孤兒; 與刪除頻道同一次操作、同一補償範圍: 全有或全無, 中途失敗整次還原回 `saveRolledBack`). 搬入之列與搬移前完全相同, 以 `getArchivedTasks(channelId)` / `getArchivedMessages(channelId)` 讀取 (已刪頻道之 id 仍可查; 來源頻道已刪除由該 `channelId` 已不在頻道清單得知); 熱表統計 (`getStats`) 不再計入. 已搬走之任務不可再認領 / 回應 / 重置 (回 `errTaskNotFound`). `postMessage` / `ackChannel` / 成員存檔對已刪或不存在之頻道回 `errChannelNotFound`. **效能注意**: 搬移全程持有訊息與任務之表鎖, 期間全系統之發訊與任務操作會等待 (實測一頻道 400 任務 + 404 訊息約 2.1 秒); 刪除大頻道宜選離峰時段.
- **編輯器開啟中之草稿保護**: 後台頻道頁 / 成員頁之儲存格編輯器已開啟、已輸入尚未按 Enter 時收到他人之更新, 視同有草稿 —— 不重建 (編輯器與已輸入之文字保留)、基準凍結、內容確實不同時顯示提示條; 編輯器關閉後依一般規則處理 (按 Enter 提交 → 草稿保留; 按 Esc 取消 → 頻道頁換成最新資料).
- 部署前提: 單一行程、同表只由同一 WServOrm 實例寫入 (比對之讀取不經 ORM 快取).

#### Upgrade Notes (多人同時編輯, 2026-10-23)

- **相依**: 需 `w-serv-orm` ≥ 1.1.17 (`withTabLocks` / `guardWrite` / `src/baseline.mjs`); `package.json` 已改為 `^1.1.17`.
- **自行建構 `procCore` 者**: deps 須新增 `withTabLocks`、`guardWrite` (取自 `WServOrm(...)` 之回傳); 缺則建構即拋 `invalid deps of procCore`. 使用 `WWebTask(...)` 入口者無須動作.
- **行為變更 (API 呼叫端)**: ①修改不存在之列回 `errRowNotFound` (原會新增); ②刪除不存在之列回 `errRowNotFound` (原回成功); ③頻道名稱空或重複、成員 `(channelId, memberId)` 重複於後端被拒 (`errChannelNameInvalid` / `errChannelNameDuplicate` / `errMemberDuplicate`; 原只前端擋或不擋) —— **若既有資料已有重複, 後台存檔會被擋至使用者修正 (刪除重複列)**; ④客戶端夾帶之 `userId / timeCreate / isActive / order / lastSeenMessageId` 不再寫入; ⑤`postMessage` / `ackChannel` 對已刪或不存在之頻道回 `errChannelNotFound` (原會寫入); ⑥刪頻道連帶刪成員列 (單筆 `saveChannel` / `saveChannelMember` / `deleteChannel` / `deleteChannelMember` 成功時之回傳形狀維持原 ORM 結果, 外部呼叫端不受影響; 新增清單 API 回 `{ inserted, modified, deleted, unchanged, rows }`).
- **前端**: 後台頻道頁 / 成員頁改用清單級 API 並帶基準; 自行以 `$fapi.saveChannel` 等逐列呼叫之客製頁面仍可用 (單筆 API 保留), 但不享有基準保護. 成員頁於有未儲存修改時切換頻道會先確認 (取消則維持原頻道與草稿).
- **語系鍵**: `server/procLang.mjs` 新增 `saveStale / errRowNotFound / errBaselineFormat / errRowsInvalid / saveRolledBack / saveWriteFail / errChannelNameInvalid / errChannelNameDuplicate / errChannelNotFound / errMemberChannelMismatch / errMemberDuplicate / draftStaleNotice / reloadData / reloadDiscardConfirm / switchChannelDiscardConfirm / memberDuplicate / memberInvalid` (eng + cht); 自訂 `kpLang` 覆寫者請補.
- **行為變更 (刪頻道, 2026-10-23 使用者裁示)**: 刪除頻道時 (清單 `deleteChannels` / 清單存檔之刪除集合 / 單筆 `deleteChannel` 同) 該頻道之**訊息與任務整列移入封存表**, 原行為為「訊息與任務留在熱表成為孤兒」. 影響: ①熱表與 `getStats` 不再含已刪頻道之訊息 / 任務; ②進行中 (`pending` / `running`) 之任務一併移入封存表且維持原狀態 (快照), 之後不可再認領 / 回應 / 重置 —— 持有該任務之 agent 呼叫 `respondTask` 會得 `errTaskNotFound` (頻道已不存在, 屬預期); ③`getArchivedTasks` / `getArchivedMessages` 對已刪頻道之 `channelId` 可查 (後台任務頁之「顯示封存」以頻道選擇器切換, 已刪頻道不在選擇器內, 須以 API 查); ④後台頻道頁刪除確認框之文字改為提示「訊息與任務（含進行中者）將一併移入封存，且不可再認領或回應」(`deleteChannelConfirm`, eng + cht; 自訂 `kpLang` 覆寫者請補). **升版前已刪頻道所遺之孤兒訊息 / 任務不會自動搬移** (留在熱表, 仍計入統計): 稽核方式 —— 停機後以 `w-orm-lmdb` 開啟資料目錄 (`./db`) 讀熱表 `messages` / `tasks`, `channelId` 不在 `channels` 表 id 集合者即孤兒 (`getStats` 之訊息 / 任務總數亦含之); 需清理者由維運於停機後以離線工具處理 (可依 `buildChannelDeleteOps` 之相同順序搬入封存表).
- **前端 (編輯器開啟中)**: 後台頻道頁 / 成員頁之儲存格編輯器已開啟、已輸入未按 Enter 時收到推播, 不再重建 (原頻道頁會整張重建, 編輯器被關閉、輸入靜默丟失), 並顯示草稿提示條 (新增 `src/plugins/mGridEdit.mjs`; 無語系鍵變更).
- **稽核既有資料之重複** (升版後後台存檔被 `errChannelNameDuplicate` / `errMemberDuplicate` 擋下時): 頻道名稱重複以 `getChannelsList` 依 `name` 分組; 成員重複以 `getChannelMembers(channelId)` 依 `memberId` 分組, 於後台成員頁 (重複儲存格有警告圖示) 刪除多餘列.

## Security: identity verification responsibility (身分驗證責任、角色與頻道成員)

> 身分驗證責任：框架（w-converhp、w-serv-hapi、w-serv-webdata、w-serv-orm）不驗證 token，一律由本套件負責。連線閘（`verifyConn`）與執行身分（`getUserIdByToken`）皆須完整驗證（token 有效、本系統使用者存在且啟用、部署方授權）；hapi `apis` 路由各自驗證；函數層級另檢查角色或成員；公開入口只限列名者。（跨套件原則：opensrcOper `dspec/使用者身分驗證原則.md`；設計 `spec/設計要點與取捨.md` D20）

**角色與成員的定義**

- **系統管理者** ＝ `getUserByToken` 所回使用者之 `isAdmin` 嚴格等於 `'y'` (本套件無自有使用者表, 以 token 反查結果為權威; 判準單一擁有者 `server/access.mjs` 之 `isAdminUser`). 應用系統 token (SSO `isApp='y'`): **使用者用途** (綁定使用者) 反查回所綁使用者之實際資料, 等級同該使用者; **系統服務用途** (不綁使用者) 反查回 `id='app:<金鑰主鍵>'`、`isAdmin='y'`, 等級為系統管理者. 本套件不讀 `isApp`; 是否簽發系統服務用途或綁系統管理者之應用系統 token 由專案方負責.
- **頻道成員** ＝ `channelMembers` 中 `(channelId, memberId = 呼叫者 id, isActive = 'y')` 之列. 本套件**不設頻道管理者角色** (`channelMembers.role`、`channels.ownerId` 為後台可編之自由欄位, 不作授權依據).
- **執行身分** (`getUserIdByToken`, 資料通道請求本體之 `__sysToken__`) 與連線閘 (標頭 `Authorization`) 共用同一個完整驗證 (token 認證 + 部署方 `verifyClientUser`, `from` 為 `'main'`): 兩個 token 各自完整驗證, 函數以**本體 token 之使用者**執行; 驗證不過函數不執行 (`errUserIdMissing`, 原因只入 srLog).

**入口與呼叫者** (資料通道與 HTTP REST 共用同一張入口函數表; 不通過者零寫入)

| 入口 | 誰可用 | 不通過 |
|---|---|---|
| 靜態前端檔 (index.html 與建置檔) | 任何人 (公開入口, 本質上還拿不到 token) | — |
| `[sys:getFuncList]` | 設定上列為公開 (`sysFuncsPublic`), 但資料通道一律先經 `getUserIdByToken` 且其對空 token fail-closed, 實際仍須有效身分 | `permission denied` / `errUserIdMissing` |
| `[sys:polling]`、`[sys:getTableTags]` | 有效身分 (輪詢帶 `__sysToken__`) | `permission denied` |
| 登入檢查 `GET /api/getUserByToken`(只回 `id / name / email / isAdmin`)、資料通道 `getWebInfor` | 任一通過 `verifyClientUser` 者 | 登入檢查 `errUserNoPermission`(認證失敗為 `errUserNotFound` 等);資料通道 `permission denied`(連線閘)/ `errUserIdMissing`(本體 token) |
| 頻道管理類: `saveChannels` / `deleteChannels` / `saveChannel` / `deleteChannel` / `saveChannelMembers` / `deleteChannelMembers` / `saveChannelMember` / `deleteChannelMember` (資料通道) | **系統管理者** | `errUserNotAdmin` |
| 頻道內容: `getChannelMembers`、`getMessages`、`postMessage`、`getTasks`、`getArchivedTasks`、`getArchivedMessages`、`ackChannel` (資料通道) 與對應 HTTP `getRecentMessages` / `postMessage` / `getRecentTasks` / `getArchivedTasks` / `getArchivedMessages` / `ackChannel` | 系統管理者或**該頻道成員** | `errChannelNotMember` |
| 任務: `getTask`、`claimTask`、`respondTask`、`resetTask` (資料通道與 HTTP) | 系統管理者或**任務所屬頻道成員** | `errTaskNotFound` (非成員與查無同回, 不洩漏存在與否) |
| 檔案: `uploadFile`、`getFileInfo`、HTTP `getFile` | 系統管理者或**任一頻道成員** | `errChannelNotMember` |
| 清單與統計: `getChannelsList` / `GET /api/getChannels`、`getStats` / `GET /api/getStats`、資料通道 `channels.select` / `channelMembers.select` | 任一已驗證者, **只回有權看之頻道**之資料 (系統管理者全部) | — (收斂, 不拒絕) |
| 通訊路由 `ulctr` / `slc` / `dwgfn` / `dwgf` / `dw` | 本套件未註冊監聽, 一律不受理 | — |

完整矩陣 (入口 × 呼叫者: 無 token / 一般使用者〔成員、非成員〕/ 系統管理者 / 應用系統〔使用者用途綁一般使用者、綁系統管理者、系統服務用途〕, 共 462 格) 由 `test/api-callerMatrix.test.mjs` 以真後端實測.

#### Upgrade Notes (身分驗證與存取矩陣, 2026-10-25, D20)

- **相依**: `w-serv-hapi` `^1.1.8` (連帶 w-serv-webdata 1.1.16、w-serv-broadcast 1.1.12). 後端設 `sysFuncsPublic: ['[sys:getFuncList]']`; 前端元件隨升版, 輪詢帶 token. **已發布之舊前端建置檔輪詢不帶 token, 升版後被拒 (使用者需重新載入頁面)**.
- **一般使用者 (`isAdmin≠'y'`) 不再能做管理類操作** (頻道與成員之建立 / 修改 / 刪除): 回 `errUserNotAdmin`. 原只要通過部署方 `verifyClientUser` 即可; 部署方只能在本套件之檢查上再收緊.
- **頻道內容限成員**: 一般使用者只能讀寫自己為成員之頻道; 非成員回 `errChannelNotMember` (任務為 `errTaskNotFound`). **agent 若以一般使用者 (或綁一般使用者之應用系統 token) 認證, 其 `user.id` 須為頻道成員**: `channel.agentId` 等於其 `user.id` 時存檔會自動建立 agent 成員列 (建議作法); `channel.agentId` 為友善名稱而 `user.id` 不同者, 須由系統管理者於成員頁加入其 `user.id` 為成員. 原本 `ackChannel` 缺列路徑會替任何通過連線閘者自動建立成員列 (等同自我加入任何頻道), **現僅系統管理者可建列(既有成員只更新自己的游標列; 授權通過後成員列才被系統管理者移除者亦不得加回)**. 以系統服務用途之應用系統 token (`isAdmin='y'`) 認證之 agent 與系統管理者不受影響.
- **升版時稽核 `channelMembers`(升版前遺留之成員列即授權)**: 修前任何通過連線閘者可經 `ackChannel` 缺列路徑自我加入任何頻道、一般使用者亦可經管理類函數為自己加列, 這些列升版後仍在, 而成員資格現在即存取權. 稽核: 以系統管理者 token 對各頻道呼叫 `getChannelMembers(channelId)`, 自建列之特徵為 `userId === memberId`(建立者即成員本人, 多為 `memberType==='agent'`); 預期之 agent 成員(由 `saveChannel` 依 `agentId` 自動建立者之 `userId` 為存檔之系統管理者)不符此特徵, 符合者逐一確認後於成員頁刪除非預期者. **系統管理者降級時**: 系統管理者(含 `isAdmin='y'` 之 agent)以非成員身分 `ackChannel` 會替自己建游標列(agent 之已讀游標須有列), 該帳號日後降為一般使用者時這些列使其仍為該頻道成員——降級時須同步清理其成員列.
- **其他變更**: ①連線閘只認 `Authorization: Bearer <token>`(方案名不分大小寫、其後一個以上空白), 其他方案與缺憑證視為未帶 token(原無條件刪前 7 字元); ②`GET /api/getUserByToken` 只回 `id / name / email / isAdmin` 四欄(原樣回傳部署方之物件; 前端 `userSelf` 只讀此四欄), 認證失敗之後端 console 亦只印此四欄; ③HTTP `verifyAppUser` 與資料通道之 `verifyClientUser` 同樣只收使用者物件之淺拷貝(鉤子改寫傳入之物件不影響本套件之角色與身分判斷); ④兩個部署方鉤子各管一種入口——資料通道(瀏覽器前端)經 `verifyClientUser`, HTTP REST 路由(agent 與外部應用)經 `verifyAppUser`; 部署方要完全拒絕某使用者, 須兩個鉤子都拒絕(只拒 `verifyClientUser` 時其 HTTP 路由仍可用, 2026-10-25 task-verify02 實測).
- **清單與統計收斂**: 一般使用者之 `getChannelsList` / `getChannels` / `getStats` 與資料通道 `channels.select` / `channelMembers.select` 只含所屬頻道 (原回整表).
- **檔案**: `uploadFile` / `getFileInfo` / `getFile` 限系統管理者或任一頻道成員.
- **執行身分**: 資料通道每個函數呼叫前之 `__sysToken__` 驗證由「只取 token 對應之 id」改為與連線閘同等完整 (認證 + `verifyClientUser(淺拷貝, 'main')`): 缺 `id / email / name / isAdmin` 欄位或被 `verifyClientUser` 拒絕者, 函數不執行. `verifyClientUser` 每個資料通道函數呼叫多被呼叫一次 (`from` 為 `'main'`), 收到的是使用者物件之淺拷貝.
- **語系鍵**: `server/procLang.mjs` 新增 `errUserNotAdmin`、`errChannelNotMember` (eng + cht); 自訂 `kpLang` 覆寫者請補.
- **前端**: 明確為非系統管理者 (`isAdmin='n'`) 者隱藏後台入口與頻道聊天頁成員視窗之編輯開關 (便利性; 後端為權威); 系統管理者畫面不變.
- **自行建構者**: `createAccess` / `createGuardedFuncs` 於 `server/access.mjs`; 使用 `WWebTask(...)` 入口者無須動作. 自行建構 `procCore` 者: `getStats(userId, scope)` 新增選用參數 `scope` (頻道 id 的 Set; 不給為全系統)、`ackChannel(userId, channelId, lastMessageId, allowInsert = true)` 新增選用參數 `allowInsert` (缺列時是否可建列; 預設同修前, 入口邊界對一般使用者傳 `false`).

### agent 處理訊息附件 (圖片/檔案)
訊息的 `attachments` 為 file id 陣列 (非 base64, 省 token). agent 看到附件時: `GET /api/getFileInfo?token=&id=<fileId>` 取原始檔名/type/size → `GET /api/getFile?token=&id=<fileId>` 取實際 bytes 檢視. 自己要發帶圖訊息: 先 `POST /api/uploadFile` 取 file id, 再 `postMessage(..., attachments:[id])`.

## AI agent 在 CLI session 的使用方式

完整協定與設計理由見 [spec/設計_agent協定.md](spec/設計_agent協定.md). 摘要 — **每輪 /loop 喚起 = 一輪無狀態輪詢** (去重全靠 server: 任務 state + 訊息游標, 不依賴 session 記憶):

```bash
TK=agent-demo                 # 你的 SSO token (dev 可用 agent-demo)
ME=agent-demo                 # 你的 agentId, 等於主責頻道 channel.agentId (僅用於過濾「我主責哪些頻道」)
B=http://127.0.0.1:11008      # 游標以 token 身分為 key, 你不需知道自己的 user.id

# 1. 取得我主責的頻道 (含我的已讀游標 lastSeenMessageId; 游標依 token 身分對應, 與 ackChannel 寫入對稱)
curl -s "$B/api/getChannels?token=$TK&agentId=$ME"

# 2. 先撈待辦任務 (FIFO 取最舊; order=asc 確保積壓也不餓死)
curl -s "$B/api/getRecentTasks?token=$TK&channelId=$CH&state=pending&order=asc&n=20"

# 3. 認領最舊一個 (原子: 已被認領會回 errTaskAlreadyClaimed)
curl -s -X POST "$B/api/claimTask" -H 'Content-Type: application/json' -d '{"token":"'$TK'","taskId":"'$TID'"}'

# 4. 在 session 內完整做完任務 (多步驟用自己的規劃拆解), 一次回應:
curl -s -X POST "$B/api/respondTask" -H 'Content-Type: application/json' \
  -d '{"token":"'$TK'","taskId":"'$TID'","result":"## 已完成\n...markdown 結果...","state":"done"}'
# 失敗: state:"error", result 寫清楚為何失敗

# 5. 撈游標之後的新訊息 (對話). 回話前務必過濾: 只回 senderId!==自己 且 kind==='text' 的訊息
#    (不回自己發的、不回 taskReply、不回 task 訊息本身, 否則會對自己的回覆無限再回);
#    處理完 ackChannel 推進游標 (lastMessageId 取「讀到最新 id」與「自己 post 最新 id」之較大者, 納入自產訊息):
curl -s "$B/api/getRecentMessages?token=$TK&channelId=$CH&afterId=$CURSOR"
curl -s -X POST "$B/api/ackChannel" -H 'Content-Type: application/json' -d '{"token":"'$TK'","channelId":"'$CH'","lastMessageId":"'$LAST'"}'
```

### 多任務怎麼切 (重點結論)

- **單任務原子**: DB 的 task = 一收一回一終態. 一輪只認領處理一個 (或少數), 做完乾淨收尾再下一個 — 對「注意力有限」的 agent 最穩.
- **真正獨立的多交付** → 開多個 task (多次 postMessage asTask), 各自認領各自回.
- **同一交付的多步驟** → 一個 task, payload 用 markdown 列步驟, 在 session 內自行規劃逐步完成, 一次彙整回應.
- **不做巢狀 multi-task** (一個 task 存多 subtask 各自 state) — 會逼 agent 維護多個 sub-state, 易亂.

## 後端日誌 (srLog) 與 w-serv-orm 診斷輸出

後端日誌由 `srLog` (w-syslog) 依時段輪檔寫入 `opt.logFd` (預設 `./logs`), 只記事件名、錯誤 key 與必要之識別, 不記權杖與上游原文 (見上述 Security 與 D15).

- **w-serv-orm 診斷輸出導入 srLog** (`w-serv-orm` ≥ 1.1.23、`wsemi` ≥ 1.9.33; 設計 `spec/設計要點與取捨.md` D21): 本套件建立 `WServOrm` 時傳入 `opt.funLog`, 其值為 wsemi 之 `genDiagFunLog((o) => srLog.warn(o), { safeKeys: SAFE_KEYS }).funLog` (`server/WWebTask.mjs`; `SAFE_KEYS` 取自 `w-serv-orm/src/safeKeys.mjs`, 為 w-serv-orm 宣告之 `safe` 頂層鍵名單, 作寫入 srLog 前的第二道防線; 轉接與遮罩規則由 wsemi 單一擁有, 本套件不另寫), w-serv-orm 的診斷輸出不再寫行程標準輸出 (pm2 / 容器常收集), 改記成 `srLog.warn({ event: 'orm-diag', label, safe })`. `label` 為標籤 (含表名與操作, 如 `channels.select catch`); `safe` 為不含主鍵、資料值與錯誤原文之摘要 (失敗筆數與位置 `{ n, ks }`、錯誤類別與機器代碼 `{ errType, errCode }`、拒收原因 `{ reason }`、進度 `{ table }` 等, 鍵由 w-serv-orm 宣告白名單). **完整細節 (`detail`: 含主鍵、錯誤原文與憑證) 不取用、不落地** (funLog 帶 `noDetail`, w-serv-orm 不為本套件建構細節); 日誌寫入失敗不影響原流程. 診斷選項 (`logDetail`、`funLog` 之引數形狀、遮罩範圍與有界規則) 見 [wsemi 的 `getDiag`／`genDiagFunLog` JSDoc](https://github.com/yuda-lyu/wsemi) 與 [w-serv-orm README〈Diagnostic output〉](https://github.com/yuda-lyu/w-serv-orm); 本套件不提供 `logDetail`.
- **平時會見到什麼**: 本套件之寫入走 `woItems` 不經 `procOrm`, 資料通道只開 `select` 且 w-serv-webdata 先擋無效條件 (`invalid find[…]`, 不到 w-serv-orm), 故實際只會見到資料庫讀取失敗: `channels.select catch` / `channelMembers.select catch` (`safe` 為 `{ errType }`). 需要原文時請看資料庫端或程序的錯誤輸出; 失敗之寫入由 `runOps` 記 `err` key (`saveRolledBack` / `saveWriteFail`).
- **升版注意**: 監控若曾比對行程標準輸出中的 w-serv-orm 診斷字樣, 改看 srLog 的 `orm-diag`. 使用 `WWebTask(...)` 入口者無須動作.
- **後端驅動例外 (外來值) 離開本套件前一律遮罩** (規格: 診斷輸出與遮罩 D3; `server/genDiag.mjs`): 本套件以 wsemi 的 `getDiag({}, { secrets })` 建立一個遮罩出口 `diag`, 秘密來源為建構 `WWebTask(WOrm, url, db, …)` 時給的 `url` (以 wsemi 的 `getDiagSecrets({ conns: [url] })` 分類; 連線字串含帳密者, 整串、帳密與裸密碼皆遮; 檔案位置如 lmdb 的 `./db` 視為儲存路徑, 對外錯誤值不遮路徑); 網址帳密、`password=`、`Bearer` 等形態即使不在 `url` 內也由 wsemi 的樣式規則遮罩. 經 `diag.mask` / `diag.err` 的出口共 7 站: 寫入失敗 `runOps` 的原因與補償失敗、`archiveSweep` 補償失敗與失敗 (`srLog.error` 的 `msg`)、資料通道函數失敗 (`srLog.error` 的 `err` 與回給遠端的 reject)、HTTP REST 核心失敗 (回應與 `srLog` 的 `msg`)、`getFile` 失敗 (404 回應與 `srLog` 的 `msg`); 另有 4 站來源不明的轉拋 (`guarded`、封存補償後轉拋、`lockSave`、`wrapErrLog`) 於轉出前經 `diag.err` (無應遮者回原物件; 有則回保型副本, 類別、`name`、`code` 不變, 只換 `message`). **不遮**: 本套件自身以固定詞彙組成的失敗 (錯誤 key 字面) 與成功回應的資料. 站點全集與測試見 `sgud/rule/rulebook_backend.md` R-ORMDIAG-06、R-ORMDIAG-07.
- **未涵蓋 (Not covered)**: ①未出現在 `url` 的秘密——連線字串以外另行提供給驅動的帳密 (本套件的 `WWebTask` 不接收), 或不以網址帳密 / `password=` / `Bearer` 形態出現的**裸密碼**, 若驅動未於丟出前處理, 本套件的遮罩遮不到 (wsemi 已知限制: 短於 4 字元的密碼不遮); ②第三方原生層直接寫入行程標準錯誤者 (如 lmdb 對損毀紀錄的傾印) 不在 JS 層可攔範圍, 部署端請以 `opt.logFd` 與行程輸出的存取權限管控; ③`console.log('WServOrm init failed', err)` 與其後原樣 throw 的錯誤由 w-serv-orm 在丟出前遮罩 (w-serv-orm ≥ 1.1.22), 本套件不再處理; ④w-orm-* 驅動自身的診斷輸出 (w-orm-lmdb ≥ 1.0.47 已改用 wsemi 共用模組) 由各驅動負責.

### Breaking changes (診斷輸出遷移至 wsemi 共用模組)

本套件不做舊版相容 (專案原則 14); 下列為升至 wsemi ≥ 1.9.31、w-serv-orm ≥ 1.1.22 之版本後 `orm-diag` 記錄的行為變化 (記錄形狀 `{ event, label, safe }`、等級 `warn`、事件名 `orm-diag` 不變), 以及失敗回應與日誌中後端例外原文的遮罩 (同版新增):

- **`server/ormDiagLog.mjs` 已刪除** (原 `genOrmFunLog(srLog)`): 無對外匯出, 不影響 `WWebTask(...)` 使用者; 直接 import 該檔者改用 `wsemi/src/genDiagFunLog.mjs`.
- **srLog 無效不再於建構時拋錯**: 舊版 `srLog` 缺 `warn` 函數即於 `WServOrm` 建立前拋 `invalid srLog`; 新版轉接以箭頭函數 `(o) => srLog.warn(o)` 每次取用 `srLog.warn`, 缺 `warn` 時寫入失敗被吞 (診斷輸出靜默遺失). `WWebTask(...)` 之 `srLog` 恆由內部 `srLogInit` 建立 (w-syslog 物件), 實際不會發生; 僅直接組裝者受影響.
- **srLog 寫入回傳 rejected promise**: 舊版丟棄該 promise (成為未處理拒絕, Node 預設終止行程); 新版由 wsemi 標記已處理.
- **label**: 控制字元換 `?`、至多 200 字元、非字串記為 `(label)` (舊版控制字元原樣).
- **safe 之正規化改由 wsemi 單一擁有**: 只取自有可列舉字串鍵 (至多 50 鍵), 值限字串 (至多 200 字元)、有限數字、布林、`null`、陣列 (至多 20 項)、至多 2 層之純物件, 其餘 `[Object]`; `bigint` 記為 `(bigint)`、循環記為 `[Circular]` (舊版深度上限 3 層、超出項數記 `[n more]`, 函數／Symbol 記型別標記). 非物件之 `safe` (舊版字串、陣列原樣) 記為 `undefined` (w-serv-orm ≥ 1.1.22 之 safe 皆為物件).
- **失敗回應與日誌中的後端例外原文改為遮罩後的文字** (外來值遮罩出口, 見上節): HTTP REST 的失敗 `msg`、`getFile` 的 404 `msg`、資料通道函數失敗的錯誤、`srLog.error` 記錄的 `msg` / `err`, 若含連線字串、帳密或權杖, 對應片段換為 `***`; 錯誤 key (如 `errFileNotFound`) 與成功資料不變. 依這些文字比對來源主機或帳號者請核對. 內部模組 `createLockSave(cst, diag)` 與 `procCore({ …, diag })` 新增必要的 `diag` 參數 (缺則建構即拋, 不以未遮罩狀態運作); 這兩個模組無對外匯出, `WWebTask(...)` 使用者不受影響.
- **`safe` 內容 (來自 w-serv-orm 1.1.22)**: 進度為 `{ table }` (舊為表名字串)、拒收鍵為 `{ msgs: [...] }` (舊為陣列); `errType` 只列內建錯誤類別名 (驅動或使用端自訂類別一律記 `Error`), `errCode` 只收 wsemi 明列之代碼集合; 白名單外之鍵丟棄. 依 `safe.errType` 值域或 `safe.errCode` 統計者請核對.

### Breaking changes (ORM 診斷日誌只保留白名單鍵)

升至 wsemi ≥ 1.9.33、w-serv-orm ≥ 1.1.23 之版本後 (專案原則 14: 不做舊版相容):

- **`orm-diag` 記錄的 `safe` 只保留白名單鍵**: 轉接器傳 `{ safeKeys: SAFE_KEYS }` (`SAFE_KEYS` 為 w-serv-orm 公開之 `safe` 頂層鍵名單: `n`、`ks`、`skipped`、`ok`、`type`、`reason`、`msgs`、`table`、`tables`、`keys`、`nOther`; `errType`、`errCode` 恆保留). 名單外之頂層鍵 (含其巢狀物件值) 不寫入 srLog, 巢狀物件內之鍵不另過濾. 本套件正式路徑上 w-serv-orm 本就只產出名單內之鍵, 一般部署無可觀察變化; 受影響者為直接組裝 `funLog`、或自 `safe` 讀取名單外鍵名的人 (舊版轉接器原樣保留, 如 `__proto__` 自有鍵).
- **內部相依**: `server/genDiag.mjs` 不再 import `w-serv-orm/src/getDiagBrief.mjs` (w-serv-orm 1.1.23 已刪 `getUrlSecrets`), 秘密分類改 wsemi 的 `getDiagSecrets({ conns: [url] })`, 結果相同; 該檔無對外匯出, `WWebTask(...)` 使用者不受影響.

## 測試

```bash
npx mocha test/unit-procCore.test.mjs --reporter list      # 單元 (procCore 邏輯/狀態守衛)
npx mocha test/unit-ormDiagLog.test.mjs --reporter list    # w-serv-orm 診斷輸出導入 srLog (真實 w-serv-orm + lmdb; 不含個資)
npx mocha test/api-ormDiag.test.mjs --reporter list        # 同上, 真實 WWebTask 子行程 (port 11308)
npx mocha test/unit-ormDiagMask.test.mjs --reporter list   # 外來值遮罩出口 (genDiag; procCore / lockSave 的出口與站點全集)
npx mocha test/api-ormLeak.test.mjs --reporter list        # 上游未遮罩時, 真實 WWebTask 的 REST / getFile / 資料通道 / 封存掃描出口 (port 11309; 約 40 秒)
npx mocha test/api-agent.test.mjs --reporter list           # API 契約 (agent HTTP 生命週期)
npx mocha test/api-callerMatrix.test.mjs --reporter list    # 呼叫者存取矩陣 (入口 × 呼叫者 462 格; 身分驗證 / 角色 / 頻道成員)
node test/e2e-channeltask.test.mjs --baseline               # 產製 e2e 標準圖
npx mocha test/e2e-channeltask.test.mjs --reporter list     # e2e (Playwright + pixel baseline: 感知容差比對, 非 byte-exact; 雙語)
npm test                                                     # mocha 全跑 (test/*.test.mjs)
```

e2e 規範詳 skill `role-coder-for-test-e2e` 與 `spec/流程_*.md`.

## 認證 (委外 SSO)

`srv.mjs` 注入 `getUserByToken(token)`: dev 捷徑 `sys`/`agent-demo` (NODE_ENV !== production); 否則打 SSO `GET ${ssoBaseUrl}/api/getSsoUserInfor?token=${ssoAppToken}&key=token&value=${token}` 解析 user. 部署需在 `g.getSettings.mjs` 填 `ssoBaseUrl` 與 `ssoAppToken` (SSO tokens 表中 isApp='y' 之 app token).

**agent 身分 (建議用 SSO app token)**: agent 為機器角色, 建議由 SSO 系統管理者核發 **app token** (tokens 表 isApp='y') 作為其認證 token, 無須為每個 agent 建立真人帳號與 email. 兩種用途 (w-web-sso 1.1.15 起, 見 `Security` 一節): **使用者用途** (綁定使用者) 反查回所綁使用者之實際資料, 等級同該使用者 —— 綁一般使用者者須為頻道成員 (`user.id` 即 agentId, 須等於主責頻道 channel.agentId, 存檔時自動建 agent 成員列); **系統服務用途** (不綁使用者) 反查回 `id='app:<金鑰主鍵>'`、`isAdmin='y'`, 等級為系統管理者 (可存取全部頻道; 是否簽發由專案方負責). 一般使用者 token 亦可作為 agent 認證, 但其 user 須四欄齊全 (id/email/name/isAdmin — 對外 API 之 `getAndVerifyAppUser` 與瀏覽器端同樣走 `checkUser` 檢查).

## 套件化

`npm run build` → 前端 SPA (`dist/`) + 後端 UMD bundle. 作為 npm 套件安裝後, `server/WWebTask.mjs` 為主入口 (`WWebTask(WOrm, url, db, getUserByToken, verifyClientUser, verifyAppUser, opt)`), 靜態檔自動偵測 `node_modules/w-web-task/dist`. 詳 `toolg/`.

## 授權

MIT
