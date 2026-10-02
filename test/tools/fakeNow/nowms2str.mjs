//e2e 假時鐘之替身(取代本專案 server/ 與 src/ 所用之 wsemi nowms2str): 標記檔(環境變數 WTASK_E2E_FAKE_NOW_FILE 所指)存在時
//回傳其 now(固定之執行期錨點字串), 否則回真實 nowms2str(). 標記檔由 test/tools/e2e-setup.mjs 之 setFakeNow() / clearFakeNow() 逐案寫入與刪除,
//每次呼叫即時讀檔, 故不需重啟後端即生效; 未開啟之案例與 api 測試行為與真時鐘相同.
import fs from 'node:fs'
import nowms2strReal from 'wsemi/src/nowms2str.mjs'

let fp = process.env.WTASK_E2E_FAKE_NOW_FILE || ''

function nowms2str() {
    if (fp) {
        try {
            let now = JSON.parse(fs.readFileSync(fp, 'utf8')).now
            if (typeof now === 'string' && now !== '') {
                return now
            }
        }
        catch (err) {} //無標記檔(ENOENT)或內容不合即用真時鐘
    }
    return nowms2strReal()
}

export default nowms2str
