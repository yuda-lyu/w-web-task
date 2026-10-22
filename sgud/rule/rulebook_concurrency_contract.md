# 規則帳本分冊:多人同時編輯(原則 10)之寫入契約與清單級 API(w-web-task)

本檔為 `sgud/rule/rulebook_concurrency.md` 之分冊(2026-10-23 第二波落地後依全域 §14 與 inv01 之建議拆分): 收錄第 4 節(寫入契約草案)、第 5 節(清單級 API 設計草案: 簽名、diff 規則、與單筆 API 之關係、鎖之組合與取鎖順序), **節號、標題與內容自主檔原樣搬移, 不刪不改**(行號為 2026-10-22 盤點時之值, 改碼後以各節之盤點指令重取; 第二波實作後之現況見主檔「9. 第二波實作現況」)。索引與規則總表見主檔。

## 4. 寫入契約草案(第 4 項)

形式依規格 §3。檔位置建議 `src/schema/contracts/<表>.mjs`(前後端同構 import)。`scope` 於規格為單參函式; 成員清單之範圍隨頻道而變 → 建議契約**工廠** `getMembersContract(channelId)`(回傳帶 `scope: (r) => r.channelId === channelId` 之契約物件, 不需動共用核心); 若主控希望核心 `scope` 接額外參數則改採之(Q4)。

```js
// src/schema/contracts/channels.mjs  — 有後台整表編輯頁
export default {
    table: 'channels',
    pk: 'id',
    fields: ['name', 'description', 'agentId', 'levels', 'ownerId'], //客戶端欄位(grid 可編輯鍵 LayoutContentChannels.vue:383-389)
    serverOnly: ['order', 'userId', 'timeCreate', 'userIdUpdate', 'timeUpdate', 'isActive'], //存檔保留庫內值
    // 無 orderKey: 存檔不依列序重編 order(order 為種子 / 離線設定值, 現無編輯入口)
    scope: null, //整表(資料通道 select 全撈, 前端不過濾 isActive)
}
// 理由: 與 grid 可編輯鍵逐一對應; userId / timeCreate / isActive 在現況可被 pass-through 改寫(O6)故顯式列 serverOnly。
```

```js
// src/schema/contracts/channelMembers.mjs — 有後台整表編輯頁; scope = 該頻道
export const getMembersContract = (channelId) => ({
    table: 'channelMembers',
    pk: 'id',
    fields: ['channelId', 'memberId', 'memberType', 'role'], //LayoutContentMembers.vue:436-440 可編輯鍵 + 範圍鍵
    serverOnly: ['order', 'lastSeenMessageId', 'userId', 'timeCreate', 'userIdUpdate', 'timeUpdate', 'isActive'],
    scope: (r) => r.channelId === channelId,
})
// 理由: lastSeenMessageId 只由 ackChannel 寫(E3); channelId 入摘要以偵測搬移並於清單 API 驗每列 channelId = 參數;
//       伺服端新鮮讀取查詢須與前端取得路徑相同(getChannelMembers 過濾 isActive:'y')。
```

```js
// 其餘 5 表: 無後台整表存檔, 不適用基準; 宣告全欄伺服器專有, 供「存檔不採用客戶端值」之一致檢查與日後擴充
// messages / messagesArchive: serverOnly = 全 13 欄(欄名見第 1.3 節); fields: []
// tasks / tasksArchive:       serverOnly = 全 17 欄(第 1.4 節); fields: []; 競爭由 kmx('task:<id>') + state 守衛處理(D6)
// files:                      serverOnly = 全 10 欄(第 1.5 節); fields: []
// 理由: 這些表的「誰能寫哪些欄位、經哪把鎖」以第 2.2 節站點表為單一宣告; 契約檔只為使三分類可被腳本核對(欄位全集 = fields ∪ serverOnly)。
```

**契約核對腳本(第二波加入單元測試)**: 對每表斷言 `fields ∪ serverOnly = ds[表].keys` 且兩者不交, 防 schema 增欄而契約漏列。

## 5. 清單級 API 設計草案(第 5 項)

### 5.1 簽名與回傳

kpFunExt 慣例: 第 1 參數 `userId` 由伺服端自 token 注入, 下列為前端 `$fapi.*` 看到之參數。

```
saveChannels(rows, { baseline })                          → { inserted: [id], modified: [id], deleted: [id], unchanged: n }
deleteChannels(ids, { baseline })                         → { deleted: [id] }
saveChannelMembers(channelId, rows, { baseline })         → 同 saveChannels
deleteChannelMembers(channelId, ids, { baseline })        → { deleted: [id] }
```

- `baseline`: `[[id, 'h1:…'], …]`(規格 §5), 由前端對載入時所見快照以 `buildBaseline(rows, contract)` 自算。**後台 UI 必送**; 外部呼叫(持管理者權杖直打 `/api/main`)可不帶 → 不比對、其餘規則照舊(規格 §8、方案 v2 §2.7)。**格式或版本不識 → `baselineFormat`, 不得降級為未帶**。
- `deleteChannels` / `deleteChannelMembers` 之 baseline 只含**被選取列**(逐列粒度, 與 api 套件 `deleteApi(userId, id, { baseline })` 一致); 理由: 刪除是針對特定列之命令, 他列被改不應擋(原則 10 刪除先刪先贏)。

### 5.2 diff 規則(有 baseline 時; 鎖內以新鮮讀取為準)

1. 取鎖 → 新鮮讀取(查詢條件 = 前端取得資料之條件: channels `select({})`; members `select({ channelId, isActive:'y' })`)→ `compareBaseline`; 不符 → 整次拒收、零寫入(`baselineMismatch` / `rowNotFound` / `baselineFormat`)。
2. 比對通過後以**送出列**對**基準**分三類:
   - 送出列 `id ∈ 基準`: 以 `digestRow(row)` 對基準摘要: 相同 → 未變(**不寫入、不蓋稽核欄**); 不同 → 修改(只寫 `fields` + `timeUpdate` + `userIdUpdate`, `autoInsert:false`)。
   - 送出列無 `id`: 新增(`funNew({...row, userId})`, 伺服端產 id; 前端新列之臨時 id 必須省略, 與現況 `:641` 一致)。送出列有 `id` 但 `∉ 基準` → 拒收 `baselineFormat`(客戶端宣稱基準不含之 id)。
   - 基準 `id ∉ 送出 id` → 刪除(刪除集合＝**基準內 − 送出**, 不得為「庫內全部 − 送出」, 規格 §6)。比對已通過保證其仍存在。
3. 無 baseline(外部): 有 `id` → 只改不增, 列不存在 → `rowNotFound`(整次零寫入); 無 `id` → 新增; **無刪除集合**。
4. 寫入前先全部驗證(含資料規則), 再依序寫: 新增 → 修改 → 刪除。
5. 資料規則於鎖內、所有入口一致(原則 4): channels 最終清單 `name` 必填且不重複(現只在前端 `errItemsByName`, O5); channelMembers 每列 `channelId = 參數`。**成員 `memberId` 不重複**為新增規則(`ackChannel` / `getChannelsList` 假設唯一, O4), 但現有資料可能已重複而使存檔永遠被擋 → 待裁示 Q5, 裁示前不強制。違反 → 整次拒收, 回固定錯誤鍵。
6. 連帶: channels 清單有新增 / 修改 `agentId` 者, 同一次呼叫、同一把 `channelMembers` 表鎖內補建主責 agent 成員列(取代 W03 之獨立 kmx)。

**殘餘風險**: lmdb 無跨呼叫交易, 第 4 點寫入中途遇 ORM 硬失敗(磁碟滿等, 非競爭)仍可能部分寫入。建議於鎖內保留各列寫前原值, 失敗時盡力補償回滾(Q3)。

### 5.3 與既有單筆 API 之關係

**保留** `saveChannel` / `deleteChannel` / `saveChannelMember` / `deleteChannelMember`(薄包裝, 與清單 API 共用同一內部核心), 前端不再呼叫。理由: ①持管理者權杖直打 `/api/main` 之外部工具可能使用(移除屬破壞性); ②既有測試 `api-doubleclick` DC-03～DC-07、`unit-procCore` 雙擊並行案依賴(部分列只帶 `{id, agentId}`, 故不帶基準之修改須容許部分欄位); ③共用核心使額外成本小。收緊項: 修改只改不增(列已刪 → `rowNotFound`)、刪除未命中 → `rowNotFound`、不採用伺服器專有欄位、取表鎖; 可選帶單列 `{ baseline }`。以 R-CONC-08 之盤點指令保證前端零呼叫。

### 5.4 鎖之組合與取鎖順序

總序: **lockSave(不排隊)→ 表鎖(依表名碼元序)→ 實體鎖(依鍵碼元序)**。表名碼元序: `channelMembers`(…`M`=0x4D)< `channels`(…`s`=0x73)。

| 呼叫 | lockSave 鍵(沿用 D16 語意) | 表鎖 | 實體鎖 |
|---|---|---|---|
| `saveChannels` | `saveChannels:{userId}` | `channelMembers` + `channels` | 無(表鎖內序列化) |
| `deleteChannels` | `deleteChannels:{userId}` | `channelMembers` + `channels`(連帶清理成員列, 若 Q2 裁示清理) | 無 |
| `saveChannelMembers` | `saveChannelMembers:{userId}:{channelId}` | `channelMembers` | 無 |
| `deleteChannelMembers` | `deleteChannelMembers:{userId}:{channelId}` | `channelMembers` | 無 |
| 單筆四函式 | 沿用現鍵 | 依其涉及之表 | 無 |
| `ackChannel` 更新路徑 | — | **不取**(熱路徑; 只寫伺服器專有欄, 與後台合併寫入欄位不重疊, lmdb 單列合併原子) | `channelMember:<c>:<u>`, `save(..., { autoInsert:false })`; 命中 `n=0`(列已被刪)→ 走缺列路徑 |
| `ackChannel` 缺列路徑 | — | `channelMembers`(**先釋放實體鎖再取表鎖**, 避免實體鎖→表鎖倒置) | 表鎖內重查: 已存在(他人剛建)→ 更新游標; 仍缺 → insert |
| `postMessage` / 狀態機 | 沿用 | 無(tasks / messages 無整表存檔) | 沿用 `postMessage:<channelId>`、`task:<id>` |
| `archiveSweep` | — | 無 | 逐筆 `task:<id>`: 重讀 → 仍 done/error 且過齡才 `tasksArchive.save` + `tasks.del` |

死鎖檢查: 表鎖只在最前取; ack 更新路徑只取實體鎖, 缺列路徑釋放後才取表鎖 → 無「持實體鎖等表鎖」; `archiveSweep` 只取實體鎖; 清單 API 內不再取 `channelMember:*` 實體鎖(表鎖已涵蓋 W03 / W05 / W06 / W07)。**ack 與清單存檔並行**: 清單存檔只寫 `fields` + 稽核欄, ack 只寫 `lastSeenMessageId` + 稽核欄, 二者皆為 lmdb 單列合併原子寫 → 游標不再被回寫(E3 修復), 稽核欄後寫者為準(伺服器專有, 可接受)。

