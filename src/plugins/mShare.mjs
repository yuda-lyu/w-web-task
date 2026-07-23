//前後端共用函數區
import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import isestr from 'wsemi/src/isestr.mjs'


//getNameNew: 於既有 rows 內依 key 產生不重複名稱 (供新增 / 複製列預設命名)
function getNameNew(rows, key = 'name', nameBase = '', nameExt = '') {

    //hasName
    let hasName = (name) => {
        let b = false
        each(rows, (r) => {
            let _name = get(r, key, '')
            if (_name === name) {
                b = true
                return false //跳出
            }
        })
        return b
    }

    //nameNew
    let nameNew = ''
    let b = true
    let i = 0
    while (b) {
        i++
        let pre = ''
        if (isestr(nameBase)) {
            pre = `${nameBase} - `
        }
        nameNew = `${pre}${nameExt}(${i})`
        b = hasName(nameNew)
    }

    return nameNew
}


//getTaskStateColor: 任務狀態 → 呈現顏色 (供任務頁狀態欄上色; 對齊 D 設計 tokens 語意狀態色)
function getTaskStateColor(state) {
    let kp = {
        pending: '#78716c', //--st-pending
        running: '#2563eb', //--st-running
        done: '#16a34a', //--st-done
        error: '#dc2626', //--st-error
    }
    return get(kp, state, '#78716c')
}


//getTaskStateText: 任務狀態 → 在地化文字 (taskStatePending / taskStateRunning / ...)
function getTaskStateText(vo, state) {
    let kp = {
        pending: 'taskStatePending',
        running: 'taskStateRunning',
        done: 'taskStateDone',
        error: 'taskStateError',
    }
    let key = get(kp, state, '')
    if (!isestr(key)) {
        return state
    }
    return vo.$t(key)
}


//getSenderTypeText: 發送者類型 → 在地化文字 (senderHuman / senderAgent)
function getSenderTypeText(vo, senderType) {
    let kp = {
        human: 'senderHuman',
        agent: 'senderAgent',
    }
    let key = get(kp, senderType, '')
    if (!isestr(key)) {
        return senderType
    }
    return vo.$t(key)
}


//getKindText: 訊息類型 → 在地化文字 (kindText / kindTask / kindTaskReply)
function getKindText(vo, kind) {
    let kp = {
        text: 'kindText',
        task: 'kindTask',
        taskReply: 'kindTaskReply',
    }
    let key = get(kp, kind, '')
    if (!isestr(key)) {
        return kind
    }
    return vo.$t(key)
}


//getMemberTypeText: 成員類型 → 在地化文字 (memberHuman / memberAgent). 供成員表格 cell-render 顯示用;
//注意僅轉顯示, 底層 row.memberType 仍為原始 'human'/'agent' (儲存送後端須為原值).
function getMemberTypeText(vo, memberType) {
    let kp = {
        human: 'memberHuman',
        agent: 'memberAgent',
    }
    let key = get(kp, memberType, '')
    if (!isestr(key)) {
        return memberType
    }
    return vo.$t(key)
}


export {
    getNameNew,
    getTaskStateColor,
    getTaskStateText,
    getSenderTypeText,
    getKindText,
    getMemberTypeText,
}
