const http = require('http')

//dev server 之 /api proxy 重用至後端之連線(pt347, R-E2E-PROXY-01): http-proxy 未給 agent 時以 agent:false 每個請求新開一條連線並送 Connection: close,
//後端回應之 connection: close 又被轉回瀏覽器, 使每個 /api 請求於「瀏覽器→dev server」「dev server→後端」兩段各留一個 TIME_WAIT(e2e 大量請求時上萬個)
const proxyAgent = new http.Agent({ keepAlive: true })

module.exports = {
    productionSourceMap: false, //不產出map檔
    lintOnSave: false, //禁止eslint-loader於編譯時檢查語法
    devServer: {
        proxy: {
            '/api': {
                //預設打 3 srv 之後端 11008；e2e／api 測試 harness（test/tools/e2e-setup.mjs）以環境變數指向其自建之測試實例
                target: process.env.WTASK_DEV_PROXY_TARGET || 'http://localhost:11008',
                agent: proxyAgent,
                pathRewrite: {
                    '^/api': '/api'
                },
            },
        }
    },
    // transpileDependencies: [''],
    publicPath: process.env.NODE_ENV === 'production' ? '/mtask/' : '/', //預先編譯至mtask子目錄下, 待轉成模板, 並於伺服器啟動後依照設定檔取代
}
