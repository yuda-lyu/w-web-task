import keys from 'lodash-es/keys.js'
import genIDSeq from 'wsemi/src/genIDSeq.mjs'
import dtmapping from 'wsemi/src/dtmapping.mjs'
import nowms2str from 'wsemi/src/nowms2str.mjs'
import isestr from 'wsemi/src/isestr.mjs'


let keyTable = 'messages'
let tableNameCht = '對話訊息'
let tableNameEng = 'Messages'

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
    'senderId': {
        name: '發送者識別碼',
        type: 'STRING',
    },
    'senderType': {
        name: '發送者類型',
        type: 'STRING',
    },
    'kind': {
        name: '訊息類型',
        type: 'STRING',
    },
    'content': {
        name: '訊息內容',
        type: 'TEXT',
    },
    'taskId': {
        name: '任務主鍵',
        type: 'STRING',
    },
    'attachments': {
        name: '附件檔案清單',
        type: 'TEXT',
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
    o.kind = isestr(o.kind) ? o.kind : 'text'
    o.senderType = isestr(o.senderType) ? o.senderType : 'human'
    o.attachments = isestr(o.attachments) ? o.attachments : '[]'
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
