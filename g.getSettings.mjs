// import path from 'path'
// import fs from 'fs'
// import JSON5 from 'json5'


function getSettings() {
    return {
        'dbUrl': './db',
        'dbName': 'wtask',
        'ssoBaseUrl': 'http://localhost:11007',
        'ssoAppToken': '', //部署時填入SSO tokens表中isApp=y的app token (真SSO鏈路已於2026-07-07以 tk-app-wtask-e2e 端到端驗證過, 步驟見 z待修正清單.md)
        'ssoLoginUrl': 'http://localhost:11007/', //未登入時導向之SSO登入頁
    }
}


export default getSettings
