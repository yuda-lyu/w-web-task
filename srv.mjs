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
    //'{token-for-reject}' 為測試用權杖 (test/api-tokenLeak), 同樣受 NODE_ENV 守門: 模擬舊版 w-web-sso helper 失敗時之 reject 形狀
    //(以字串 reject「已代入權杖之完整網址」, 內夾合成秘密), 供驗證注入函數失敗時回應 / srLog / console 皆不外洩上游原文 (spec D15).
    if (token === '{token-for-reject}' && process.env.NODE_ENV !== 'production') {
        return Promise.reject(`can not get user data by url[http://127.0.0.1:11007/api/getSsoUserInfor?token=SYNTH-SYS-SECRET-FOR-TEST&key=token&value=${token}]`)
    }
    //'{token-for-verify-throw}' 為測試用權杖 (test/api-tokenLeak), 同樣受 NODE_ENV 守門: 解析為合成使用者 id-for-verify-throw,
    //其 verifyClientUser / verifyAppUser 會拋出夾合成秘密之 Error, 供驗證 verify 系注入函數拋錯時視同無權限且不外洩原文 (spec D15).
    if (token === '{token-for-verify-throw}' && process.env.NODE_ENV !== 'production') {
        return { id: 'id-for-verify-throw', name: 'verify-throw', email: 'verify-throw@example.com', isAdmin: 'y' }
    }
    //'{token-for-nonadmin}' 為測試用權杖 (test/api-dataChannel), 同樣受 NODE_ENV 守門: 解析為有效但非系統管理者之使用者 (isAdmin='n'),
    //下方 verifyClientUser 拒絕之, 供驗證資料通道之連線閘與登入檢查同一授權強度 (spec D17).
    if (token === '{token-for-nonadmin}' && process.env.NODE_ENV !== 'production') {
        return { id: 'id-for-nonadmin', name: 'nonadmin', email: 'nonadmin@example.com', isAdmin: 'n' }
    }
    //呼叫者存取矩陣之測試權杖 (test/api-callerMatrix, 受 NODE_ENV 守門; 下方 verifyClientUser / verifyAppUser 對 id-for-member / id-for-outsider 放行以測套件自身之角色與成員檢查):
    //'{token-for-member}' 一般使用者 (測試中為某頻道之成員)、'{token-for-outsider}' 一般使用者 (非任何頻道成員)、
    //'{token-for-appuser}' 應用系統 token・使用者用途 (綁定 id-for-member, 反查回所綁使用者實際資料, 同一般使用者)、
    //'{token-for-appadmin}' 應用系統 token・使用者用途綁管理員 (同系統管理員)、'{token-for-appsys}' 應用系統 token・系統服務用途 (id 以 'app:' 開頭、isAdmin='y', 不綁使用者)
    if (token === '{token-for-member}' && process.env.NODE_ENV !== 'production') {
        return { id: 'id-for-member', name: 'member', email: 'member@example.com', isAdmin: 'n' }
    }
    if (token === '{token-for-outsider}' && process.env.NODE_ENV !== 'production') {
        return { id: 'id-for-outsider', name: 'outsider', email: 'outsider@example.com', isAdmin: 'n' }
    }
    if (token === '{token-for-appuser}' && process.env.NODE_ENV !== 'production') {
        return { id: 'id-for-member', name: 'member', email: 'member@example.com', isAdmin: 'n', isApp: 'y' }
    }
    if (token === '{token-for-appadmin}' && process.env.NODE_ENV !== 'production') {
        return { id: 'id-for-admin', name: '測試者', email: 'admin@example.com', isAdmin: 'y', isApp: 'y' }
    }
    if (token === '{token-for-appsys}' && process.env.NODE_ENV !== 'production') {
        return { id: 'app:key-for-test', name: 'App key-for-test', email: 'app-key-for-test@example.com', isAdmin: 'y', isApp: 'y' }
    }
    //'{token-for-badrole}' / '{token-for-numid}' / '{token-for-hookmut}' 為測試用權杖 (test/api-callerMatrix C3-06 / C3-08, 受 NODE_ENV 守門):
    //isAdmin 為 'Y' (非 'y' / 'n') 之使用者、id 為非字串之使用者 (皆應被 checkUser 拒絕); 一般使用者 id-for-hookmut (其 verifyClientUser / verifyAppUser 會嘗試改寫傳入之物件為管理員, 供驗本套件只交淺拷貝、角色與身分取自驗證當下之原物件)
    if (token === '{token-for-badrole}' && process.env.NODE_ENV !== 'production') {
        return { id: 'id-for-badrole', name: 'badrole', email: 'badrole@example.com', isAdmin: 'Y' }
    }
    if (token === '{token-for-numid}' && process.env.NODE_ENV !== 'production') {
        return { id: 12345, name: 'numid', email: 'numid@example.com', isAdmin: 'n' }
    }
    if (token === '{token-for-hookmut}' && process.env.NODE_ENV !== 'production') {
        return { id: 'id-for-hookmut', name: 'hookmut', email: 'hookmut@example.com', isAdmin: 'n' }
    }
    //'{token-for-incomplete}' 為測試用權杖 (test/api-callerMatrix C3-05, 受 NODE_ENV 守門): 解析為欄位不齊之使用者 (缺 email / name), 供驗執行身分須與連線閘同等完整 (欄位齊備) 而非只取 id
    if (token === '{token-for-incomplete}' && process.env.NODE_ENV !== 'production') {
        return { id: 'id-for-incomplete', isAdmin: 'y' }
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
        //不印 err.message: 請求例外之 message 可能含已代入 ssoAppToken 與使用者權杖之完整網址, 只印錯誤名稱與底層代碼 (spec D15);
        //axios 對非 2xx 亦拋錯 (無 cause), 另印 HTTP 狀態碼以保留診斷 (數值, 不含權杖)
        console.log('SSO getSsoUserInfor error', get(err, 'name', ''), get(err, 'cause.code', ''), get(err, 'response.status', ''))
        return {}
    }
}

//isTestOrdinaryUser: 呼叫者存取矩陣之測試用一般使用者 (受 NODE_ENV 守門); 其餘一般使用者 (如 id-for-nonadmin) 仍被拒, 供 D17 之連線閘測試
let isTestOrdinaryUser = (user) => {
    return process.env.NODE_ENV !== 'production' && ['id-for-member', 'id-for-outsider'].includes(get(user, 'id', ''))
}

let verifyClientUser = (user, from) => {
    //不於每次呼叫印出使用者物件: 登入檢查與資料通道之連線閘(前端每 2 秒輪詢)皆經此函數 (spec D17; 同 w-web-perm srv.mjs)
    // console.log('verifyClientUser/user', user)
    //於生產環境時得加入限制瀏覽器使用者身份機制 (from 為 'getUserByToken' 或資料通道之 apiType, 如 'main')
    //測試用 (受 NODE_ENV 守門): 合成使用者 id-for-verify-throw (見 getUserByToken 之 '{token-for-verify-throw}') 一律拋出夾合成秘密之 Error
    if (get(user, 'id', '') === 'id-for-verify-throw' && process.env.NODE_ENV !== 'production') {
        throw new Error('SYNTH-VERIFY-SECRET-FOR-TEST')
    }
    //測試用 (受 NODE_ENV 守門): id-for-hookmut 之鉤子嘗試把傳入之物件改為管理員 (id-for-admin / isAdmin='y') 後放行, 供驗本套件只交淺拷貝
    if (get(user, 'id', '') === 'id-for-hookmut' && process.env.NODE_ENV !== 'production') {
        user.isAdmin = 'y'
        user.id = 'id-for-admin'
        return true
    }
    // return false //測試無法登入
    return user.isAdmin === 'y' || isTestOrdinaryUser(user) //測試僅系統管理者使用 (另放行呼叫者存取矩陣之兩個一般使用者, 見 getUserByToken)
}

let verifyAppUser = (user, from) => {
    //不於每次呼叫印出使用者物件: agent 之每次 HTTP REST 請求皆經此函數 (與 verifyClientUser 對稱; 同 w-web-perm srv.mjs)
    // console.log('verifyAppUser/user', user)
    //於生產環境時得加入限制應用程式使用者身份機制
    //測試用 (受 NODE_ENV 守門): 合成使用者 id-for-verify-throw (見 getUserByToken 之 '{token-for-verify-throw}') 一律拋出夾合成秘密之 Error
    if (get(user, 'id', '') === 'id-for-verify-throw' && process.env.NODE_ENV !== 'production') {
        throw new Error('SYNTH-VERIFY-SECRET-FOR-TEST')
    }
    //測試用 (受 NODE_ENV 守門): 同 verifyClientUser 之 id-for-hookmut
    if (get(user, 'id', '') === 'id-for-hookmut' && process.env.NODE_ENV !== 'production') {
        user.isAdmin = 'y'
        user.id = 'id-for-admin'
        return true
    }
    // return false //測試無法登入
    return user.isAdmin === 'y' || isTestOrdinaryUser(user) //測試僅系統管理者使用 (另放行呼叫者存取矩陣之兩個一般使用者, 見 getUserByToken)
}

//WWebTask
let instWWebTask = WWebTask(WOrm, url, db, getUserByToken, verifyClientUser, verifyAppUser, opt)

instWWebTask.on('error', (err) => {
    console.log(err)
})


//node srv.mjs
