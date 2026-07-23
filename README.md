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

對內前端 (kpFunExt WebSocket RPC) 另有 getWebInfor / getChannelsList / saveChannel / deleteChannel / getChannelMembers / saveChannelMember / deleteChannelMember / getMessages / postMessage / getTasks / getTask / claimTask / respondTask / resetTask / ackChannel / uploadFile / getFileInfo / getStats — 與對外面共用同一 procCore 業務邏輯 (getFile 走 HTTP 二進位).

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

## 測試

```bash
npx mocha test/unit-procCore.test.mjs --reporter list      # 單元 (procCore 邏輯/狀態守衛)
npx mocha test/api-agent.test.mjs --reporter list           # API 契約 (agent HTTP 生命週期)
node test/e2e-channeltask.test.mjs --baseline               # 產製 e2e 標準圖
npx mocha test/e2e-channeltask.test.mjs --reporter list     # e2e (Playwright + pixel baseline: 感知容差比對, 非 byte-exact; 雙語)
npm test                                                     # mocha 全跑 (test/*.test.mjs)
```

e2e 規範詳 skill `role-code-for-test-e2e` 與 `spec/流程_*.md`.

## 認證 (委外 SSO)

`srv.mjs` 注入 `getUserByToken(token)`: dev 捷徑 `sys`/`agent-demo` (NODE_ENV !== production); 否則打 SSO `GET ${ssoBaseUrl}/api/getSsoUserInfor?token=${ssoAppToken}&key=token&value=${token}` 解析 user. 部署需在 `g.getSettings.mjs` 填 `ssoBaseUrl` 與 `ssoAppToken` (SSO tokens 表中 isApp='y' 之 app token).

**agent 身分 (建議用 SSO app token)**: agent 為機器角色, 建議由 SSO 管理員核發 **app token** (tokens 表 isApp='y', `userId` 欄填 agent 識別碼) 作為其認證 token — SSO 解析 app token 時回傳虛擬使用者 (id=token.userId, name/email 為占位值, isAdmin='y', 視同已驗證), 無須為每個 agent 建立真人帳號與 email, 適合大量 agent 部署. 解析出的 user.id 即 agentId (須等於主責頻道 channel.agentId). 一般使用者 token 亦可作為 agent 認證, 但其 user 須四欄齊全 (id/email/name/isAdmin — 對外 API 之 `getAndVerifyAppUser` 與瀏覽器端同樣走 `checkUser` 檢查).

## 套件化

`npm run build` → 前端 SPA (`dist/`) + 後端 UMD bundle. 作為 npm 套件安裝後, `server/WWebTask.mjs` 為主入口 (`WWebTask(WOrm, url, db, getUserByToken, verifyClientUser, verifyAppUser, opt)`), 靜態檔自動偵測 `node_modules/w-web-task/dist`. 詳 `toolg/`.

## 授權

MIT
