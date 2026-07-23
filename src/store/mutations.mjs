import each from 'lodash-es/each.js'
import set from 'lodash-es/set.js'
import * as types from './types.mjs'
import ds from '../schema/index.mjs'


//state, 全域狀態
let state = {

    hostname: `${window.location.origin}`,
    webInfor: {},
    connState: 'csIng', //'csIng', 'csLogin', 'csLogout', 'csErrConn', 'csErrLogin'
    syncState: false,
    loading: false,
    settings: {
        leftDrawerWidth: 200,
    },

    heightApp: 0,
    heightAppEff: 0,
    heightToolbar: 60,

    userToken: '',
    userSelf: {},

    section: 'channels', //'channels' | 'stats' | 'admin', 左1 rail 區段切換
    currentChannelId: '', //頻道區當前選定頻道 id (空字串=未選)
    isNarrow: false, //RWD: 視窗寬度小於斷點時 true (窄屏用 master-detail 堆疊, 由 Layout resize 監聽維護)

    lang: 'eng', //'eng', 'cht'
    kpText: {}, //一定要放在vuex內, 否則無法用broadcast驅動變更語系文字

}

//添加各資料表
each(ds, (v, k) => {
    state[k] = null //初始化null
})

//儲存至state
export { state }

//mutations, 同步執行
export let mutations = {

    [types.UpdateWebInfor] (state, webInfor) {
        state.webInfor = webInfor
    },

    [types.UpdateLang] (state, lang) {
        state.lang = lang
    },

    [types.UpdateKpText] (state, kpText) {
        state.kpText = kpText
    },

    [types.UpdateConnState] (state, connState) {
        state.connState = connState
    },

    [types.UpdateSyncState] (state, syncState) {
        state.syncState = syncState
    },

    [types.UpdateLoading] (state, loading) {
        state.loading = loading
    },

    [types.UpdateTableData] (state, msg) {
        state[msg.tableName] = msg.data
    },

    [types.UpdateData] (state, msg) {
        //msg.path內為存取路徑, 需使用set處理
        set(state, msg.path, msg.data)
    },

    [types.UpdateHeightApp] (state, heightApp) {
        state.heightApp = heightApp
    },

    [types.UpdateHeightAppEff] (state, heightAppEff) {
        state.heightAppEff = heightAppEff
    },

    [types.UpdateHeightToolbar] (state, heightToolbar) {
        state.heightToolbar = heightToolbar
    },

    [types.UpdateUserToken] (state, userToken) {
        state.userToken = userToken
    },

    [types.UpdateUserSelf] (state, userSelf) {
        state.userSelf = userSelf
    },

    [types.UpdateSection] (state, section) {
        state.section = section
    },

    [types.UpdateCurrentChannelId] (state, currentChannelId) {
        state.currentChannelId = currentChannelId
    },

    [types.UpdateIsNarrow] (state, isNarrow) {
        state.isNarrow = isNarrow
    },

}
