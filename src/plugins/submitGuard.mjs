import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import isfun from 'wsemi/src/isfun.mjs'
import haskey from 'wsemi/src/haskey.mjs'


/**
 * 送出類操作之前端雙擊防護核心 (與 Vue / store 無關, 供單元測試; 由 mUI 之 runSubmit 與 updateLoading 使用, D16)
 *
 * - run(key, fn, opt): 同 key 之送出流程進行中(自觸發起至流程結束, 含結果訊息框開啟期間)再觸發即略過.
 *   按鈕之滑鼠與鍵盤 Enter、輸入框之 Enter 等入口共用同一狀態.
 *   opt.pm 為 WButtonChip / WButtonCircle 之 promiseUnlock 鎖(click 事件之 msg.pm), 於 releaseBtnLocks()(全頁 loading 關閉, 即請求結束)
 *   或流程結束時釋放; 被略過之觸發亦立即釋放其 pm, 否則該按鈕永久鎖住.
 *   fn 收到 unlock 函數: 流程需先開確認框者於開框前呼叫, 按鈕鎖只涵蓋請求期間(確認框背後之按鈕不顯示載入圖示), 重入仍由流程狀態擋.
 *   opt.hold 為函數, 輸入流程結果, 回傳 true 時保持占位與按鈕鎖(如登入成功轉址, 頁面即將離開).
 * - releaseBtnLocks(): 釋放進行中流程所登記之按鈕鎖, 流程狀態不變(結果訊息框開啟期間之重入仍擋).
 * - isRunning(key): 查詢 key 是否進行中.
 *
 * 為何需要: 全頁 loading(WDialog)不搶焦點, 只擋滑鼠, 鍵盤事件仍送達背後之按鈕與輸入框;
 * 按鈕鎖若於 handler 第一行即解除, 鍵盤連按照樣送出(2026-09-29 實測).
 *
 * @returns {Object} 回傳 { run, releaseBtnLocks, isRunning }
 */
function submitGuard() {

    //kpRunning, 進行中流程: key → { unlock }
    let kpRunning = {}

    let run = (key, fn, opt = {}) => {

        //unlock, 釋放本次觸發之按鈕鎖; pm.resolve 重複呼叫無作用
        let pm = get(opt, 'pm', null)
        let unlock = () => {
            if (pm && isfun(pm.resolve)) {
                pm.resolve()
            }
        }

        //同 key 進行中: 略過, 並立即釋放本次觸發之按鈕鎖
        if (haskey(kpRunning, key)) {
            unlock()
            return Promise.resolve(null)
        }

        //占位
        kpRunning[key] = { unlock }

        //hold
        let hold = get(opt, 'hold', null)

        //end
        let end = () => {
            unlock()
            delete kpRunning[key]
        }

        return Promise.resolve()
            .then(() => {
                return fn(unlock)
            })
            .then((r) => {
                if (isfun(hold) && hold(r) === true) {
                    return r //保持占位與按鈕鎖
                }
                end()
                return r
            }, (err) => {
                end()
                return Promise.reject(err)
            })
    }

    let releaseBtnLocks = () => {
        each(kpRunning, (v) => {
            v.unlock()
        })
    }

    let isRunning = (key) => {
        return haskey(kpRunning, key)
    }

    return {
        run,
        releaseBtnLocks,
        isRunning,
    }
}


export default submitGuard
