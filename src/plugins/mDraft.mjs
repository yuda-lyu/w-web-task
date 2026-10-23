import cloneDeep from 'lodash-es/cloneDeep.js'
import filter from 'lodash-es/filter.js'
import { buildBaseline } from 'w-serv-orm/src/baseline.mjs'


//草稿保護之純邏輯 (多人同時編輯, 原則 10; 規格 dspec/多人同時編輯之寫入契約.md §8). 與 Vue 無關, 可單元測試 (test/unit-draft.test.mjs).
//後台清單頁 (LayoutContentChannels / LayoutContentMembers) 的規則:
//  ①載入時以「畫面所見之同一份列」自算基準並凍結 (buildBaseline + 共用契約), 存檔送此基準, 不用編輯後之列重算;
//  ②有未存修改時收到推播: 不重建編輯中之內容, 基準維持凍結, 顯示「資料已被他人更新」提示 (內容全同之推播不誤報); 儲存格編輯器開啟中 (已輸入未按 Enter) 視同有未存修改 (mGridEdit.mjs), 編輯器關閉後依一般規則處理;
//  ③自身存檔期間到達之推播視為己寫 (延後, 不當他人更新);
//  ④存檔成功後之新基準取自伺服端 (回傳之列), 不得以送出值當新基準 (寫入時 clearXSS 等會改寫字串, 以送出值為基準下次存檔會被自己誤拒);
//  ⑤存檔被拒 (saveStale 等) 保留草稿, 提示重新載入.


//畫面資料過期類之拒收鍵 (後端 procCore 將 w-serv-orm 之 baselineMismatch / rowNotFound / baselineFormat 與頻道不存在轉成之語系鍵): 提示重新載入, 草稿保留
const STALE_KEYS = ['saveStale', 'errRowNotFound', 'errBaselineFormat', 'errChannelNotFound']


//isStaleKey: 拒收鍵是否屬「畫面資料過期」(其餘如名稱重複、成員重複為資料規則錯誤, 修正草稿即可, 不需重新載入)
function isStaleKey(err) {
    return typeof err === 'string' && STALE_KEYS.indexOf(err) >= 0
}


//calcBaseline: 對畫面所見之列自算基準. rows 可為 Vue 響應式物件 (先轉純資料: 響應式屬性為存取器, 共用模組不接受存取器)
function calcBaseline(rows, contract) {
    return buildBaseline(cloneDeep(rows), contract)
}


//sameBaseline: 兩份基準是否逐項相同 (id 與摘要皆同且次序相同)
function sameBaseline(a, b) {
    return JSON.stringify(a) === JSON.stringify(b)
}


//isStale: 目前列 (store 或 RPC 所見) 之基準與凍結基準是否不同 (他人已新增 / 修改 / 刪除). 列無法算基準 (主鍵缺漏或重複) 視為過期, 不靜默放過
function isStale(rows, baseline, contract) {
    try {
        return !sameBaseline(calcBaseline(rows, contract), baseline)
    }
    catch (err) {
        return true
    }
}


//decidePush: 推播 (或引用表重建觸發) 到達時之處置.
//  ownWriting                → defer   自身存檔期間之推播視為己寫, 延後 (存檔結束後由回傳之列重建)
//  無未存修改且編輯器未開啟  → rebuild 照舊重建
//  有未存修改 或 編輯器開啟中 → keep    不重建編輯中之內容; stale 為目前列相對凍結基準是否不同 (內容全同之推播不顯示提示)
//isEditing: 儲存格編輯器開啟中 (已輸入、尚未提交; 見 mGridEdit.mjs). 輸入尚未進列資料, isModified 看不到, 但視同草稿: 重建會關閉編輯器使輸入靜默丟失 (task-verify01 N1)
function decidePush({ isModified, isEditing, ownWriting, baseline, rows, contract }) {
    if (ownWriting) {
        return { action: 'defer', stale: false }
    }
    if (!isModified && !isEditing) {
        return { action: 'rebuild', stale: false }
    }
    return { action: 'keep', stale: isStale(rows, baseline, contract) }
}


//isDirty: 畫面上之列相對凍結基準是否有未存修改 (有新列、列數不同、任一列摘要不同). 以內容判定而非「曾觸發 rowsChange」:
//程式化重建列 (存檔後換成伺服端回傳之列、刪除後移除列) 亦會觸發 grid 之 rowsChange 事件, 以內容判定則不會誤設為已修改, 使用者把值改回原值亦自動回到未修改.
//列無法算摘要 (值非 JSON 型) 視為有修改
function isDirty(rows, baseline, contract) {
    try {
        //經共用主鍵規則算基準 (主鍵缺漏 / 非字串 / 重複會拋錯 → 有修改), 再與凍結基準逐項比較; 不以列數與逐列命中判定 (相同兩列重複、缺 id 恰巧命中字串 'undefined' 皆會漏判)
        return !sameBaseline(calcBaseline(rows, contract), baseline)
    }
    catch (err) {
        return true
    }
}


//resolveModified: 是否有未存修改 —— 旗標 flag (isModified) 為真, 或畫面列相對凍結基準已不同. 使用者於編輯器按 Enter 提交後, 值已寫入列資料,
//但 grid 之 rowsChange / cellEditingStopped 皆為非同步事件 (ag-grid 以 setTimeout 派送), 回呼前之空窗旗標尚未更新; 此時收到推播若只看旗標會當作「無草稿」而重建, 使剛提交之修改丟失.
//故推播處置前以列內容重算 (與 rowsChange 設定旗標同一判準 isDirty). 外審 sol#4 (task-run02)
function resolveModified(flag, rows, baseline, contract) {
    return !!flag || isDirty(rows, baseline, contract)
}


//countDuplicates: 列中 key 欄值重複者 → 重複次數 (僅回傳次數 > 1 者). 以 Map 計數, 不用物件字面量 (值為 'constructor' / '__proto__' 等合法字串時, 物件取值會取到原型成員而計數錯誤)
function countDuplicates(rows, key) {
    let cnt = new Map()
    for (let row of (Array.isArray(rows) ? rows : [])) {
        let v = row ? row[key] : undefined
        cnt.set(v, (cnt.get(v) || 0) + 1)
    }
    let dup = new Map()
    for (let [v, n] of cnt) {
        if (n > 1) {
            dup.set(v, n)
        }
    }
    return dup
}


//removeFromBaseline: 刪除成功後凍結基準去掉被刪之 id (其餘列的載入時摘要不變; 他人若動過其餘列, 之後存檔仍會被拒)
function removeFromBaseline(baseline, ids) {
    let kp = {}
    for (let id of ids) {
        kp[id] = true
    }
    return filter(baseline, (e) => kp[e[0]] !== true)
}


export { STALE_KEYS, isStaleKey, calcBaseline, sameBaseline, isStale, isDirty, resolveModified, countDuplicates, decidePush, removeFromBaseline }
