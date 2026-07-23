import keys from 'lodash-es/keys.js'
import genIDSeq from 'wsemi/src/genIDSeq.mjs'
import dtmapping from 'wsemi/src/dtmapping.mjs'
import nowms2str from 'wsemi/src/nowms2str.mjs'
import isestr from 'wsemi/src/isestr.mjs'


let keyTable = 'tasks'
let tableNameCht = '任務'
let tableNameEng = 'Tasks'

let settings = {
    'id': {
        pk: true,
        name: '主鍵',
        type: 'STRING',
    },
    'channelId': {
        name: '頻道主鍵',
        type: 'STRING',
    },
    'messageId': {
        name: '起源訊息主鍵',
        type: 'STRING',
    },
    'title': {
        name: '任務標題',
        type: 'STRING',
    },
    'payload': {
        name: '任務需求內容',
        type: 'TEXT',
    },
    'state': {
        name: '狀態',
        type: 'STRING',
    },
    'assigneeId': {
        name: '認領agent識別碼',
        type: 'STRING',
    },
    'result': {
        name: '任務回應內容',
        type: 'TEXT',
    },
    'errorKey': {
        name: '錯誤鍵',
        type: 'STRING',
    },
    'resultMessageId': {
        name: '回應訊息主鍵',
        type: 'STRING',
    },
    'timeClaim': {
        name: '認領時間',
        type: 'STRING',
    },
    'timeDone': {
        name: '結束時間',
        type: 'STRING',
    },
    'userId': {
        name: '操作者主鍵',
        type: 'STRING',
    },
    'timeCreate': {
        name: '創建時間',
        type: 'STRING',
    },
    'userIdUpdate': {
        name: '最新變更使用者主鍵',
        type: 'STRING',
    },
    'timeUpdate': {
        name: '更新時間',
        type: 'STRING',
    },
    'isActive': {
        name: '是否有效',
        type: 'STRING',
    },
}

let funNew = (ndata = {}) => {
    let o = dtmapping(ndata, keys(settings))
    o.id = `${genIDSeq()}`
    o.timeCreate = nowms2str()
    o.userIdUpdate = o.userId
    o.timeUpdate = o.timeCreate
    o.isActive = 'y'
    o.state = isestr(o.state) ? o.state : 'pending'
    return o
}

let funTest = () => {
    return []
}

let tab = {
    keyTable,
    tableNameCht,
    tableNameEng,
    settings,
    funNew,
    funTest,
}


export default tab
