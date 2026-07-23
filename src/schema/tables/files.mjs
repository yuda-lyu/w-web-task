import keys from 'lodash-es/keys.js'
import genIDSeq from 'wsemi/src/genIDSeq.mjs'
import dtmapping from 'wsemi/src/dtmapping.mjs'
import nowms2str from 'wsemi/src/nowms2str.mjs'


let keyTable = 'files'
let tableNameCht = '圖台檔案'
let tableNameEng = 'Files'

let settings = {
    'id': {
        pk: true,
        name: '主鍵',
        type: 'STRING',
    },
    'name': {
        name: '原始檔名',
        type: 'STRING',
    },
    'type': {
        name: 'MIME類型',
        type: 'STRING',
    },
    'size': {
        name: '檔案大小',
        type: 'INTEGER',
    },
    'ext': {
        name: '副檔名',
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
