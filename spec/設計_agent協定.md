# Agent 協定 — 以「我是 Claude CLI agent」視角設計

> 本文回答: CLI session 開啟後怎麼輪詢、怎麼回應、訊息+任務怎麼處理、任務怎麼標記結束、多任務該如何切分. 結論以「我 (Claude) 當前能力與注意力上限」為準: 我最強的工作型態是「取一個界定清楚的工作單元 → 在 session 內完整做完 → 一次乾淨回報 → 收尾後再取下一個」, 而非同時維護多條任務的部分狀態.
>
> 本版已納入設計審查修正: 輪詢改為**每輪 /loop 無狀態**, 去重靠**伺服器端持久狀態** (任務 state=pending; 訊息 channelMembers.lastSeenMessageId 游標), 不依賴 session 內記憶體集合.

## 1. 核心結論 (先講答案)

| 你的提問 | 結論 |
|---|---|
| 一則訊息該含單任務還是多任務? | **單任務.** DB 的 task = 原子工作單元 (一收一回一終態). |
| 多任務時要不要一大包用 markdown 自行統籌? | **分兩種情況** (見 §5): 真正獨立的多交付 → 開多個 task row, 各自認領各自回; 同一交付內的多步驟 → 一個 task, payload 用 markdown 列步驟, 我在 session 內自行規劃, 一次彙整回應. |
| 訊息擴充之任務要不要儲存多任務 (巢狀)? | **不要.** 不做巢狀 multi-task 結構 (會逼我同時維護多個 sub-state, 直擊注意力上限). 「多任務」一律以「同頻道多個扁平 task row」表達. |
| 回應是多任務分開回還是各自回? | **各自回.** 每個 task 各自 respondTask, 獨立終態, 獨立可追蹤. |
| 任務怎麼標記狀態? | pending → running(認領) → done / error; error/停滯可 resetTask 退回 pending. 見 §4. |
| 怎麼回應任務結束? | respondTask(taskId, result, 'done'); 失敗 respondTask(taskId, 錯誤說明, 'error'). 回 = task.result, 並自動鏡射成頻道 taskReply 訊息. |

**一句話**: 扁平原子任務 + 一次認領一個 + 各自回應. 這對「注意力與能力有限」的我最省負擔、最不易出錯、稽核最乾淨.

## 2. CLI session 開啟後的輪詢流程 (每輪 /loop 無狀態)

> 關鍵: 使用者以 `/loop` 驅動我 (zAI.md:23), /loop 每次喚起≈重跑同一段 prompt, session 也會正常重啟. 因此**不可**把「哪些是新的」記在 session 記憶體 (重啟即失). 改為每輪都從**伺服器端持久狀態**重新判定:
> - 任務面: `state=pending` 就是「未處理」的持久標記 → 每輪查 pending 即可, 不需任何 session 集合.
> - 訊息面: `channelMembers.lastSeenMessageId` 是我在該頻道的持久游標 → 每輪查「游標之後的新訊息」, 處理完用 ackChannel 推進游標.

```
[每次 /loop 喚起 = 一輪無狀態輪詢]
  1. 取得我主責的頻道 (含我的游標)
     GET /api/getChannels?token=<myToken>&agentId=<myAgentId>
     → 每筆 channel 附我的 lastSeenMessageId (游標). 取我主責的 channelId 與其 cursor.

  2. 先處理待辦任務 (FIFO 取最舊)
     GET /api/getRecentTasks?token=&channelId=&state=pending&order=asc&n=20
     → 回最舊優先的 pending 任務. 取「最舊的一個」(必要時一輪處理少數幾個) → 進入 §3 單任務處理.
       (order=asc 確保即使積壓 > n, 全域最舊 pending 永遠在視窗 index 0, 不會餓死)

  3. 再處理新訊息 (游標之後的)
     GET /api/getRecentMessages?token=&channelId=&afterId=<cursor>
     → 回 cursor 之後的全部新訊息. 對需回話之 text 訊息 → postMessage 回一則 text (見 §6).
     處理完後推進游標:
       POST /api/ackChannel {token, channelId, lastMessageId:<本輪看到的最新訊息 id>}

  4. 本輪結束. /loop 於下個間隔再次喚起, 重複 1~3 (狀態全在 server, 重啟無礙).
```

- **為何一輪只處理一個 (或少數) 任務**: 避免在我的 context 內同時持有多個任務的中間狀態. 處理完一個、乾淨收尾、再撈下一個, 比並行維護穩定得多.
- **去重完全靠 server 端**: 任務靠 state (claimTask 後離開 pending) + claimTask 原子防搶; 訊息靠 lastSeenMessageId 游標 (ackChannel 推進). 兩者皆跨 session/重啟冪等, 無需我記住任何東西.
- **輪詢節流**: 對外 API 受 SSO 端速率限制保護. 建議輪詢間隔 ≥ 30s.

## 3. 單一任務的處理流程 (從 pending 到 done)

```
1. 認領 (宣告我要做這個, 防他人重複做)
   POST /api/claimTask {token, taskId}
   → assigneeId 由後端取自 token 解析之我的身分 (不由我自帶, 防冒名)
   → 後端 kmx('task:'+taskId) 序列化: 鎖內檢查 state==='pending' 才成功 (pending→running)
   → 若回 errTaskAlreadyClaimed: 已被別人/別輪認領, 放棄, 撈下一個

2. 執行 (在我的 session 內完整做完)
   - 讀 task.payload (需求) + 必要時讀頻道近期訊息補脈絡
   - 若 payload 是多步驟需求: 用我自己的規劃 (TodoWrite) 拆解, 在 session 內逐步完成
   - 這段不寫回 DB 的中間進度 (DB 只關心 pending/running/done/error 四態)

3. 回應 (一次乾淨回報; respondTask 是唯一終態入口)
   成功: POST /api/respondTask {token, taskId, result:<markdown 結果>, state:'done'}
   失敗: POST /api/respondTask {token, taskId, result:<為何失敗/卡在哪/需要什麼>, state:'error'}
   → 後端 kmx 鎖內檢查 state==='running' 才放行 (防重複回應覆寫終態), 寫 result/state/timeDone
     + 發一筆 message(kind='taskReply') 回頻道, task.resultMessageId 指向它
   → 終態, 任務結束 (對應「回完即結束」)

4. 收尾 → 回到輪詢迴圈, 撈下一個
```

- **result 用 markdown**: 結果可含標題、清單、code block、檔案連結. 人類在前端任務頁直接看 task.result, 也在頻道時間軸看到 taskReply 訊息.
- **error 的復原**: error 是終態, 但可由人類在前端按「重試」→ resetTask 退回 pending (清空上輪殘留), 我下輪重新認領; 或人類補充資訊後重開新任務. 我自己不呼叫 resetTask (避免無限自我重試).

## 4. 任務狀態標記 (state)

| state | 意義 | 由誰寫 | 寫入時機 |
|---|---|---|---|
| pending | 待認領 (你口語的 "none") | postMessage(asTask=true) | 任務建立 |
| running | 認領, 執行中 | claimTask | 我認領時 (kmx 原子 pending→running) |
| done | 已回應成功, 結束 | respondTask(state='done') | 我回應成功 |
| error | 嘗試失敗, 結束 | respondTask(state='error') | 我失敗時 (錯誤說明寫 result, 選填 errorKey 為 i18n key) |
| (回邊) | error/running → pending | resetTask | 人類重試/救援停滯任務 |

- **唯一建立路徑**: postMessage(asTask=true) (無獨立 createTask).
- **唯一終態入口**: respondTask (done 與 error 都走它, 一律鏡射 taskReply; 無 updateTaskState).
- **原子防搶/防覆寫**: claimTask 鎖內 state==='pending', respondTask 鎖內 state==='running', resetTask 鎖內 state∈{error,running}; 三者共用 kmx('task:'+taskId).
- **不做細粒度進度**: 刻意不在 DB 存「running 30%」. 進度屬我 session 內部 (用我的 TodoWrite); DB 只需四態. 這是降低注意力負擔的關鍵設計.

## 5. 多任務: 何時開多個 task, 何時一個 task 內 markdown 統籌

判別準則 = **「這些工作是否需要各自獨立追蹤與獨立關閉?」**

### 5a. 真正獨立的多個交付 → 開多個 task row, 各自認領各自回
情境: 「① 幫我查 A 的資料、② 順便把 B 模組重構、③ 寫一份 C 報告」. 三件事彼此獨立、可能不同時完成、要分別驗收.
- 請求端 (人類前端或另一 agent) 開 **3 個 task** (3 次 postMessage asTask).
- 我輪詢時逐一認領、逐一執行、逐一 respondTask. 每個 task 有自己的 state 與 result.
- 好處: 各自可追蹤、可重試、可分派; 符合我「一次做一個」的型態.

### 5b. 同一交付內的多步驟 → 一個 task, payload 用 markdown 列步驟
情境: 「幫我做出登入頁: 含表單、驗證、串接 API、寫測試」. 這是**一個交付**, 內部有多步驟, 但要一起完成、一起驗收.
- 請求端開 **1 個 task**, payload 用 markdown checklist 描述步驟.
- 我認領後, 在 session 內用自己的規劃 (TodoWrite) 拆解、逐步完成, **一次** respondTask 回應 (result 用 markdown 列出每步成果).
- 好處: 不把單一交付硬拆成多個 DB 任務造成碎片; 內部步驟管理留在我 session 內 (我擅長的事).

### 為何不做「巢狀 multi-task」(一個 task 存多個 subtask 各自 state)
- 會逼我同時維護多個 sub-state 的部分完成/部分回應 → 直擊「注意力有限」痛點, 易漏、易亂、稽核複雜.
- 5a 的「多個扁平 task」已涵蓋「需要獨立追蹤的多任務」; 5b 的「一 task + 內部 markdown」已涵蓋「一個交付多步驟」. 兩者組合即可表達任何多任務場景, 且 DB 永遠只有扁平原子 task. 這是刻意的簡潔取捨.

## 6. 訊息 vs 任務: 怎麼回

| 進來的東西 | 我的回應方式 |
|---|---|
| 一般對話訊息 (kind='text', 找我聊/問) | 在游標之後讀到 → postMessage 回一則 text 訊息 → ackChannel 推進游標 |
| 任務 (kind='task', 要我做事) | claimTask → 執行 → respondTask (回 = task.result, 自動鏡射 taskReply 訊息) |
| 一則訊息同時含「閒聊 + 要做的事」 | 閒聊部分是 message.content; 要做的事在發訊時以 asTask=true 開成 task. 我對 text 回訊息、對 task 走任務流程. 兩者解耦. |

- **text 訊息的去重**: 靠 channelMembers.lastSeenMessageId 游標 (server 端持久, 以我的 token 身分為 key, 讀寫對稱). 我每輪只讀游標之後的, 回完 ackChannel 推進; 跨 session/重啟不會重複回也不會漏回.
- **必須濾掉自產訊息 (重要)**: 我同輪以 respondTask 發的 taskReply、或我自己回的 text, 其 id 必大於本輪游標, 下一輪 getRecentMessages 會把它們讀回來. 回話前**務必過濾**: 只對 `senderId !== 我的身分` 且 `kind === 'text'` 的訊息考慮回話 (不回 taskReply、不回自己發的、不回 task 訊息本身). 否則會對自己的回覆無限再回.
- **ackChannel 要涵蓋自產訊息**: 推進游標的 lastMessageId 取「本輪 getRecentMessages 讀到的最新 id」與「本輪我自己 post 的最新 id (postMessage/respondTask 回傳的訊息 id)」之**較大者**, 確保自產訊息也被游標納入, 下輪不再讀回.
- **回應任務時為何也發 taskReply 訊息**: 讓頻道對話時間軸完整 (人類/其他 agent 在對話流裡就看得到「問→答」), 同時 task.result 保留結構化終態. 兩者由 respondTask 一次原子寫入.
- **不必每則 text 都回**: 只對「需要我回應」的 text 回 (例如點名我、提問). 純成員間閒聊我讀進游標、推進、但不插話. 推進游標即代表「已看過」, 不等於「已回」.

## 7. 與 claude 對話為主的取捨

你說明「要跟 claude 對話為主, agent 注意力與能力有限」. 因此本協定刻意:
- **不要求 agent 維護複雜並行狀態** (扁平原子任務、一次一個).
- **不要求 agent 記住跨輪狀態** (去重全在 server: 任務 state + 訊息游標), 對齊 /loop 每輪重啟的真實模型.
- **不要求 agent 寫細粒度進度** (DB 只四態, 進度留 session).
- **把多步驟拆解的智力工作留在 session 內** (我擅長), DB 介面保持極簡.
- **每個任務一收一回**, 介面語意與我的工作節奏一致 → 我能穩定地「輪詢→認領→做完→回報」而不被狀態管理拖累.
