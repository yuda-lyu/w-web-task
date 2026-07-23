import WOrm from 'w-orm-lmdb/src/WOrmLmdb.mjs'
import WWebTask from './server/WWebTask.mjs'
import getSettings from './g.getSettings.mjs'
import get from 'lodash-es/get.js'
import iseobj from 'wsemi/src/iseobj.mjs'
import axios from 'axios'
import JSON5 from 'json5'
import fs from 'fs'


//st（db 等系統參數由 g.getSettings 提供，供 g.mOrm 共用）
let st = getSettings()

//pathSettings：app 設定檔路徑，預設 ./settings.json；可由 `node srv.mjs <path>` 覆寫
//（供 e2e restartBackend / 部署帶不同設定）。settings.json 為 JSON5 格式。
let pathSettings = process.argv[2] || './settings.json'
let stApp = JSON5.parse(fs.readFileSync(pathSettings, 'utf8'))

let url = st.dbUrl
let db = st.dbName
let ssoBaseUrl = st.ssoBaseUrl
let ssoAppToken = st.ssoAppToken
let ssoLoginUrl = st.ssoLoginUrl
let opt = {

    useCheckUser: false,
    getUserById: null,
    useExcludeWhenNotAdmin: false,

    serverPort: get(stApp, 'serverPort', 11008),
    subfolder: '', //mtask
    urlRedirect: ssoLoginUrl, //未登入時導向SSO登入頁, 本機測試時得先編譯, 再瀏覽: http://localhost:11008/

    //語系（來自 settings.json）：language 由 WWebTask 注入 index.html ({language}) → 初始畫面即此語系；
    //showLanguage 控右上語系選單顯隱。
    showLanguage: get(stApp, 'showLanguage', 'y'),
    language: get(stApp, 'language', 'eng'),

    //log 資料夾與輪檔間隔（srLog 寫入讀此）。
    logFd: get(stApp, 'logFd', './logs'),
    logInterval: get(stApp, 'logInterval', 'hr'),

    //封存機制 (spec D12 方向②): 終態任務/舊訊息逾此天數搬冷表; <=0 停用。
    archiveAfterDays: get(stApp, 'archiveAfterDays', 30),

    webName: {
        'eng': 'Task Dispatch System',
        'cht': '任務調度系統',
    },
    webDescription: {
        'eng': 'A web service package for dispatching tasks between humans and AI agents.',
        'cht': '提供人類與 AI agent 間任務調度之網頁服務套件。',
    },
    webLogo: '',

}

let getUserByToken = async (token) => {
    // return {} //測試無法登入
    //'sys' 為開發捷徑（w-ui-loginout 於 localhost 自動帶入）。加環境守門：NODE_ENV==='production' 時不接受，
    //避免 srv.mjs 若作正式入口時 'sys' 成為遠端管理員後門。e2e/dev 未設 NODE_ENV=production 故仍可用；
    //正式部署設 NODE_ENV=production 即停用此捷徑（並應改提供真實 getUserByToken）。
    if (token === 'sys' && process.env.NODE_ENV !== 'production') {
        return { id: 'id-for-admin', name: '測試者', email: 'admin@example.com', isAdmin: 'y' }
    }
    //'agent-demo' 為開發/示範用 agent 身分捷徑 (對應 g.initialData 種子頻道之 agentId), 同樣受 NODE_ENV 守門.
    //真實部署時每個 agent 以自己的 SSO token 認證, 其解析出的 user.id 即該 agent 之 agentId (須等於主責頻道 channel.agentId).
    if (token === 'agent-demo' && process.env.NODE_ENV !== 'production') {
        return { id: 'agent-demo', name: 'Demo Agent', email: 'agent-demo@example.com', isAdmin: 'y' }
    }
    //'agent-api'/'agent-sso'/'agent-perm'/'agent-task' 為開發/測試用 agent 身分捷徑 (對應外部執行 agent 之測試頻道 agentId), 同樣受 NODE_ENV 守門.
    if (['agent-api', 'agent-sso', 'agent-perm', 'agent-task'].includes(token) && process.env.NODE_ENV !== 'production') {
        return { id: token, name: `Agent ${token.slice(6)}`, email: `${token}@example.com`, isAdmin: 'y' }
    }
    //未設定 SSO app token 時(本機開發未接SSO), 不打SSO直接拒絕
    if (!ssoAppToken) {
        console.log('ssoAppToken 未設定, 略過 SSO 驗證')
        return {}
    }
    //呼叫 SSO 解析 token -> user
    try {
        let url = `${ssoBaseUrl}/api/getSsoUserInfor?token=${encodeURIComponent(ssoAppToken)}&key=token&value=${encodeURIComponent(token)}`
        let res = await axios.get(url)
        let state = get(res, 'data.state', '')
        let u = get(res, 'data.msg', null)
        if (state !== 'success' || !iseobj(u)) {
            console.log('SSO getSsoUserInfor 失敗', state)
            return {}
        }
        return { id: u.id, name: u.name, email: u.email, isAdmin: u.isAdmin }
    }
    catch (err) {
        console.log('SSO getSsoUserInfor error', err.message)
        return {}
    }
}

let verifyClientUser = (user, from) => {
    console.log('verifyClientUser/user', user)
    console.log('於生產環境時得加入限制瀏覽器使用者身份機制')
    // return false //測試無法登入
    return user.isAdmin === 'y' //測試僅系統管理者使用
}

let verifyAppUser = (user, from) => {
    console.log('verifyAppUser/user', user)
    console.log('於生產環境時得加入限制應用程式使用者身份機制')
    // return false //測試無法登入
    return user.isAdmin === 'y' //測試僅系統管理者使用
}

//WWebTask
let instWWebTask = WWebTask(WOrm, url, db, getUserByToken, verifyClientUser, verifyAppUser, opt)

instWWebTask.on('error', (err) => {
    console.log(err)
})


//node srv.mjs
