# 規則帳本分冊:前端 UI(w-web-task)

本檔為 `sgud/rule/rulebook.md` 之分冊(2026-10-22 依全域 §14 拆分): 以下各節自主檔原樣搬移, 節號與標題不變、不刪內容; 體例、盤點指令之 cwd 慣例、`git grep` 不搜未追蹤檔之注意事項同主檔。索引見 `rulebook.md`。

## 前端 UI 規則(對應 `CLAUDE.md` UI 設計、全域技能[role-coder-for-vue-ui])

| 規則 | 站點全集 | 判準 | 盤點指令 |
|---|---|---|---|
| 可見文字一律 `$t('key')`, 新鍵同時於 `server/procLang.mjs` 加 eng 與 cht | `src/` 全部元件 | 已套(新增時逐鍵核對) | 新鍵以 `git grep -n "<key>" -- server/procLang.mjs` 確認兩語系皆有 |
| 儲存類操作之成功 / 失敗以 `showCheckYes` 停留彈窗(先 `updateLoading(false)`); `$alert` 只用於非預期例外 | `showCheckYes` 13 處(LayoutContentChannels 4、LayoutContentMembers 4、LayoutContentTasks 4、Composer 1(失敗; 發訊成功以時間軸呈現)); `$alert` 7 處皆為 `core().catch` 之 `anUnexpectedErrorOccurred` | 已套 | `git grep -n "showCheckYes(\|\$alert(" -- src`(`$alert` 每處須為 `anUnexpectedErrorOccurred`) |
| 有副作用之 WButtonChip / WButtonCircle 一律 `:promiseUnlock="true"`; handler 為 method 名、非 async, **不** `pm.resolve()`, 把 `msg.pm` 交給送出函式(`vo.doX({ pm: msg.pm })`); 送出函式以 `vo.$ui.runSubmit(key, fn, opt)` 包覆, 鎖於 `updateLoading(false)`(請求結束)或流程結束時釋放; 有確認框者自確認框起整段包入, 並於開框前呼叫 fn 收到之 `unlockBtn`; 非按鈕入口(輸入框 Enter、原生 div)呼叫同一送出函式不帶 pm(D16; 2026-09-29 前為「第一個動作 `msg.pm.resolve()` 後 fire-and-forget」, 焦點留在按鈕時鍵盤連按可重複送出) | 7 顆: Composer 發送(`Composer.vue:119`)、LayoutContentChannels 刪除(`:88`) / 儲存(`:109`)、LayoutContentMembers 刪除(`:117`) / 儲存(`:140`)、LayoutContentTasks 重試(`:146`) / 送出代回(`:213`); 非按鈕入口 2: Composer 輸入框 Enter(`onKeydown`)、Rail 登出(`onClickLogout`); 開框前 `unlockBtn` 4: 頻道 / 成員刪除、任務重試、登出 | 已套 7 / 7 + 2 | `git grep -n ':promiseUnlock="true"' -- src`(應 7 處); `git grep -n "pm.resolve()" -- src/components`(只應為 `Common/CheckYes.vue` / `CheckYesNo.vue` 之對話框自身 pm, 3 處: CheckYes 之 `show` 先 settle 前一 pm 與 `clickUnit`、CheckYesNo 之 `clickBtn`); `grep -n "\$ui.runSubmit('" src/components/*.vue`(8 處); `grep -n "unlockBtn()" src/components/*.vue`(4 處) |
| template `@event` 不得以 `async` 開頭之 inline arrow(Vue 2 靜默編錯, handler 永不執行) | `src/` | 已套(0 處) | `git grep -nE '@\w+="async' -- src`(應為空) |
| 自訂主題區禁原生 `<select>`(全域 §10.6-3) | `src/` | 已套(0 處) | `git grep -n "<select" -- src`(應為空) |
| 以計算值(px)設高 / 寬之容器, 同一 style 帶 padding 或 border 者須 `box-sizing:border-box`(本 repo 無全域 box-sizing; 否則實際尺寸多出 padding＋border 而撐破父層、底部被裁) | `LayoutContentTasks.vue` 詳情面板(`height:${detailHeight}px` + `padding:12px 18px` + `border-top:1px`; 2026-09-29 補); 同型先例 `Composer.vue:513`、`ChannelTree.vue:315`(寬 100% + padding); 其餘計算高度站點(`LayoutContentTasks.vue` 清單容器、`LayoutContentChannels.vue` / `LayoutContentMembers.vue` 之 `:height="contentHeight"`)無 padding / border | 已套 | `git grep -n 'height:\${' -- src`, 逐一看同一 style 是否帶 padding / border; 改版面後以探測量「元素底緣 ≤ 視窗高」 |

