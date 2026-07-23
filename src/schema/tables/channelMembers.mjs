import keys from 'lodash-es/keys.js'
import genIDSeq from 'wsemi/src/genIDSeq.mjs'
import dtmapping from 'wsemi/src/dtmapping.mjs'
import nowms2str from 'wsemi/src/nowms2str.mjs'
import isestr from 'wsemi/src/isestr.mjs'


let keyTable = 'channelMembers'
let tableNameCht = '頻道成員'
let tableNameEng = 'ChannelMembers'

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
    'channelId': {
        name: '頻道主鍵',
        type: 'STRING',
    },
    'memberId': {
        name: '成員識別碼',
        type: 'STRING',
    },
    'memberType': {
        name: '成員類型',
        type: 'STRING',
    },
    'role': {
        name: '角色',
        type: 'STRING',
    },
    'lastSeenMessageId': {
        name: '已讀訊息水位',
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
    o.memberType = isestr(o.memberType) ? o.memberType : 'human'
    o.role = isestr(o.role) ? o.role : 'member'
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
