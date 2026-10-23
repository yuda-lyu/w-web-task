//格內編輯器 (ag-grid cell editor) 之狀態判定: 後台清單頁 (LayoutContentChannels / LayoutContentMembers) 之草稿保護用 (多人同時編輯, 原則 10; task-verify01 N1).
//問題: 編輯器已開啟、值尚未提交 (已輸入、未按 Enter) 時, 輸入內容只存在編輯器內, 不在列資料, isModified 與基準比對都看不到 ——
//此時若收到推播就照「無草稿」重建整張表, 編輯器被關閉、輸入靜默丟失. 本模組讓頁面把「編輯器開啟中」視同有草稿: 不重建、凍結基準、顯示提示, 編輯器關閉後再依一般規則處理.
//與 Vue 無關, 可單元測試 (test/unit-draft.test.mjs, 以假 api 驗證). gridComp 為 WAggridVue 元件實例 (頁面 $refs.rftable), 其 getApi() 回 ag-grid api, 未就緒回 null.


//getGridApi: 取 ag-grid api; 元件不存在 (表格尚未渲染) 或未就緒回 null
function getGridApi(gridComp) {
    try {
        let api = (gridComp && typeof gridComp.getApi === 'function') ? gridComp.getApi() : null
        return api || null
    }
    catch (err) {
        return null
    }
}


//isEditorOpen: 目前是否有儲存格編輯器開啟中 (含已輸入但未按 Enter 者). api 無法查詢 (表格未渲染 / 未就緒) 視為未開啟
function isEditorOpen(gridComp) {
    let api = getGridApi(gridComp)
    if (!api || typeof api.getEditingCells !== 'function') {
        return false
    }
    try {
        let cs = api.getEditingCells()
        return Array.isArray(cs) && cs.length > 0
    }
    catch (err) {
        return false
    }
}


//onceEditorStopped: 編輯器關閉 (按 Enter 提交 / Esc 取消 / 點他處) 時呼叫 fn 一次 (ag-grid 事件 cellEditingStopped; 此時格內值若已提交, 已寫入列資料).
//回取消函式 (已觸發過或已取消者重複呼叫無害); api 無法掛接事件 (表格未渲染 / 未就緒) 回 null, 呼叫端據此不得進入「延後」狀態 (否則永遠等不到)
function onceEditorStopped(gridComp, fn) {
    let api = getGridApi(gridComp)
    if (!api || typeof api.addEventListener !== 'function' || typeof api.removeEventListener !== 'function') {
        return null
    }
    let done = false
    let handler = () => {
        if (done) {
            return
        }
        done = true
        try {
            api.removeEventListener('cellEditingStopped', handler)
        }
        catch (err) {
            //api 已隨表格銷毀: 無需移除
        }
        fn()
    }
    api.addEventListener('cellEditingStopped', handler)
    return () => {
        if (done) {
            return
        }
        done = true
        try {
            api.removeEventListener('cellEditingStopped', handler)
        }
        catch (err) {
            //api 已隨表格銷毀: 無需移除
        }
    }
}


export { isEditorOpen, onceEditorStopped }
