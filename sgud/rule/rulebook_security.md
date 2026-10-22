# 規則帳本分冊:權杖外洩防護(w-web-task)

本檔為 `sgud/rule/rulebook.md` 之分冊(2026-10-22 依全域 §14 拆分): 以下各節自主檔原樣搬移, 節號與標題不變、不刪內容; 體例、盤點指令之 cwd 慣例、`git grep` 不搜未追蹤檔之注意事項同主檔。索引見 `rulebook.md`。

## 權杖外洩防護(D15; 對應 w-web-sso ADR-068 之 W / M / K 契約)

| 規則 | 站點全集 | 判準 | 盤點指令 |
|---|---|---|---|
| 注入函數(`getUserByToken` / `verifyClientUser` / `verifyAppUser`; 原第四個選填 `opt.getUserById` 隨 w-serv-orm 移除, 2026-10-14 起由 D17-1 於入口拒絕)只經 `wrapInjected`: srLog 初始化後以包裝版取代參數本身, 其後才有呼叫 | 包裝 `server/WWebTask.mjs` 之三行 `= wrapInjected(`; 呼叫點: getTokenUser(getUserByToken)、getAndVerifyClientUser 與 `p.checkToken`(verifyClientUser, 後者 2026-10-14 起, D17-3)、getAndVerifyAppUser(verifyAppUser)、getUserIdByToken(getUserByToken) | 已套(呼叫點行號皆大於包裝行) | `git grep -nE "\b(getUserByToken\|verifyClientUser\|verifyAppUser)\(" -- server/WWebTask.mjs` 之每筆呼叫行號須大於 `git grep -n "= wrapInjected(" -- server/WWebTask.mjs` |
| 上游拋錯 / reject 視同否定結果(getUserByToken → `null`; verify 系 → `false`); 失敗記 `srLog.warn({ event:'inject-<名>-fail', ... })`(`WWebTask.mjs:166`), 只含 K 契約白名單 key 或 `upstreamType` / `upstreamName`, 絕不記原文 | `server/wrapInjected.mjs` | 已套; 守 `unit-wrapInjected`、`api-tokenLeak` | — |
| **白名單同步點**: `keysUpstream`(`server/wrapInjected.mjs:15`)須與 w-web-sso K 契約之 14 key 一致; sso 增刪 helper 之 reject key 時同步改此處與 `test/unit-wrapInjected.test.mjs` 之 `KEYS_K` | `server/wrapInjected.mjs` ↔ w-web-sso `spec/設計要點與取捨.md` ADR-068 | 已套 | `git grep -n -A16 "let keysUpstream" -- server/wrapInjected.mjs` |
| 印權杖只經 `server/maskLog.mjs`(`maskTok` / `maskQuery` / `maskUrl`, 與 sso `maskToken`、perm / api `maskTok` 同一組測資); 錯誤只記名稱與代碼 | 後端 console 之權杖類參數; `srv.mjs:105` SSO 例外只印 `err.name` / `cause.code` / 狀態碼 | 已套 | `git grep -nE "console\.(log\|error\|warn\|info)\(.*(token\|query\|authorization\|headers\|referer\|payload)" -- server srv.mjs`(權杖值參數須皆經 mask; 其餘為固定字串) |
| srLog 不記權杖與上游原文 | srLog 全站點: 無 token / authorization / query / headers / referer 欄; `err` 只為自家 key 或 `describeUpstream` 之結果 | 已套 | `git grep -nE "srLog\.(info\|warn\|error)\(" -- server` |
| 查無使用者單一出口 `getTokenUser` → `errUserNotFound`(`WWebTask.mjs:335`); `getUserIdByToken` **fail-closed**(查無 → `srLog.error` 後 reject `errUserIdMissing`, `:1002-1003`, 函數不執行) | `server/WWebTask.mjs` | 已套(2026-09-25; 行為變更見 D15) | `git grep -n "errUserNotFound\|errUserIdMissing" -- server/WWebTask.mjs` |
| 測試權杖只在非 production: `sys`、`agent-demo`、`agent-api` / `agent-sso` / `agent-perm` / `agent-task`、`{token-for-reject}`、`{token-for-verify-throw}`、`{token-for-nonadmin}`(2026-10-14 起; isAdmin='n' 之有效使用者, 供驗 D17-3 被 verifyClientUser 拒絕者) | `srv.mjs` 之 getUserByToken; 合成使用者 `id-for-verify-throw` 之拋錯分支在 verifyClientUser / verifyAppUser | 已套 | `git grep -n "NODE_ENV !== 'production'" -- srv.mjs`(每個測試權杖之條件行須含) |
| 前端 Referer 只送 origin | `public/index.html` `<meta name="referrer" content="strict-origin">` | 已套 | `git grep -n 'name="referrer"' -- public/index.html` |

測試對照: `test/unit-maskLog.test.mjs`(M 契約測資全表, 含 sso 同一組)、`test/unit-wrapInjected.test.mjs`(W 契約)、`test/api-tokenLeak.test.mjs`(回應 + 本次後端 srLog 逐筆; 後端 log 目錄 `backendLogDir`). stdout 不在 mocha 內, 以真實入口 `node srv.mjs` 之驗收探測確認.

