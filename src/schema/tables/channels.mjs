import keys from 'lodash-es/keys.js'
import genIDSeq from 'wsemi/src/genIDSeq.mjs'
import dtmapping from 'wsemi/src/dtmapping.mjs'
import nowms2str from 'wsemi/src/nowms2str.mjs'


let keyTable = 'channels'
let tableNameCht = '頻道'
let tableNameEng = 'Channels'

let settings = {
    'id': {
        pk: true,
        name: '主鍵',
        type: 'STRING',
    },
    'order': {
        name: '順序',
        type: 'INTEGER',
    },
    'name': {
        name: '頻道名稱',
        type: 'STRING',
    },
    'description': {
        name: '頻道描述',
        type: 'TEXT',
    },
    'agentId': {
        name: '主責agent識別碼',
        type: 'STRING',
    },
    'levels': {
        name: '階層',
        type: 'STRING',
    },
    'ownerId': {
        name: '建立者',
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
