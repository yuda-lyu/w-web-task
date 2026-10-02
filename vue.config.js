module.exports = {
    productionSourceMap: false, //不產出map檔
    lintOnSave: false, //禁止eslint-loader於編譯時檢查語法
    devServer: {
        proxy: {
            '/api': {
                //預設打 3 srv 之後端 11008；e2e／api 測試 harness（test/tools/e2e-setup.mjs）以環境變數指向其自建之測試實例
                target: process.env.WTASK_DEV_PROXY_TARGET || 'http://localhost:11008',
                pathRewrite: {
                    '^/api': '/api'
                },
            },
        }
    },
    // transpileDependencies: [''],
    publicPath: process.env.NODE_ENV === 'production' ? '/mtask/' : '/', //預先編譯至mtask子目錄下, 待轉成模板, 並於伺服器啟動後依照設定檔取代
}
