import assert from 'assert'
import genPm from 'wsemi/src/genPm.mjs'
import submitGuard from '../src/plugins/submitGuard.mjs'


//
// UNIT-SG-001～007: 前端雙擊防護核心 src/plugins/submitGuard.mjs (D16)
//   對應 spec/設計要點與取捨.md D16「前端: 送出流程狀態 + 按鈕 promiseUnlock 於請求結束時釋放」:
//   - 同 key 之送出流程進行中再觸發即略過(按鈕滑鼠 / 鍵盤 Enter、輸入框 Enter 同一狀態)
//   - 被略過之觸發立即釋放其按鈕鎖, 否則按鈕永久鎖住
//   - 按鈕鎖於 releaseBtnLocks()(全頁 loading 關閉)時釋放, 流程狀態不變
//   - 流程結束(成功或失敗)釋放占位與按鈕鎖; hold 成立時保持(登入成功轉址)
//   - 先開確認框之流程於開框前呼叫 fn 收到之 unlock 釋放按鈕鎖(SG-007)
// 採 unit-test 性質 (無 server / 無 browser).
// 跑法: npx mocha test/unit-submitGuard.test.mjs --timeout 30000
//


//pmState: 以 Promise.race 判定 pm 是否已 resolve (不等待)
async function isResolved(pm) {
    let flag = 'pending'
    await Promise.race([
        pm.then(() => {
            flag = 'resolved'
        }),
        Promise.resolve().then(() => {}),
    ])
    //再讓出一次 microtask, 使已 resolve 之 then 必定執行
    await Promise.resolve()
    return flag === 'resolved'
}


//deferred: 由測試控制何時完成之流程
function deferred() {
    let resolve
    let reject
    let p = new Promise((res, rej) => {
        resolve = res
        reject = rej
    })
    return { p, resolve, reject }
}


describe('submitGuard (前端雙擊防護核心, D16)', function() {

    it('UNIT-SG-001 同 key 進行中再觸發即略過, fn 只執行 1 次', async function() {
        let sg = submitGuard()
        let n = 0
        let d = deferred()
        let r1 = sg.run('save', () => {
            n++
            return d.p
        })
        let r2 = sg.run('save', () => {
            n++
            return 'second'
        })
        assert.strict.equal(await r2, null, '第 2 次觸發應被略過並回 null')
        assert.strict.equal(sg.isRunning('save'), true, '第 1 次仍進行中')
        d.resolve('first')
        assert.strict.equal(await r1, 'first')
        assert.strict.equal(n, 1, 'fn 只執行 1 次')
        assert.strict.equal(sg.isRunning('save'), false, '流程結束後釋放占位')
    })

    it('UNIT-SG-002 被略過之觸發立即釋放其按鈕鎖', async function() {
        let sg = submitGuard()
        let d = deferred()
        let pm1 = genPm()
        let pm2 = genPm()
        sg.run('save', () => d.p, { pm: pm1 })
        await sg.run('save', () => 'x', { pm: pm2 })
        assert.strict.equal(await isResolved(pm2), true, '被略過之按鈕鎖應立即釋放')
        assert.strict.equal(await isResolved(pm1), false, '進行中流程之按鈕鎖仍鎖定')
        d.resolve()
    })

    it('UNIT-SG-003 releaseBtnLocks 釋放按鈕鎖但流程狀態不變(結果訊息框期間之重入仍擋)', async function() {
        let sg = submitGuard()
        let d = deferred()
        let pm1 = genPm()
        let n = 0
        let r1 = sg.run('save', () => {
            n++
            return d.p
        }, { pm: pm1 })
        sg.releaseBtnLocks()
        assert.strict.equal(await isResolved(pm1), true, '請求結束(全頁 loading 關閉)時按鈕鎖應釋放')
        assert.strict.equal(sg.isRunning('save'), true, '流程(結果訊息框開啟中)仍進行')
        let r2 = await sg.run('save', () => {
            n++
        })
        assert.strict.equal(r2, null, '訊息框開啟期間再觸發仍略過')
        d.resolve('ok')
        await r1
        assert.strict.equal(n, 1)
    })

    it('UNIT-SG-004 流程失敗亦釋放占位與按鈕鎖, 且原樣 reject', async function() {
        let sg = submitGuard()
        let pm1 = genPm()
        let err = null
        await sg.run('save', () => Promise.reject('boom'), { pm: pm1 })
            .catch((e) => {
                err = e
            })
        assert.strict.equal(err, 'boom')
        assert.strict.equal(sg.isRunning('save'), false)
        assert.strict.equal(await isResolved(pm1), true)
    })

    it('UNIT-SG-005 hold 成立(如登入成功轉址)時保持占位與按鈕鎖', async function() {
        let sg = submitGuard()
        let pm1 = genPm()
        let r = await sg.run('login', () => 'redir', { pm: pm1, hold: (v) => v === 'redir' })
        assert.strict.equal(r, 'redir')
        assert.strict.equal(sg.isRunning('login'), true, '轉址中保持占位')
        assert.strict.equal(await isResolved(pm1), false, '轉址中按鈕保持鎖定')
        let r2 = await sg.run('login', () => 'again')
        assert.strict.equal(r2, null, '轉址中再觸發略過')
    })

    it('UNIT-SG-007 fn 收到 unlock: 開確認框前呼叫即釋放按鈕鎖, 流程狀態不變', async function() {
        let sg = submitGuard()
        let d = deferred()
        let pm1 = genPm()
        let r1 = sg.run('adminResetUserPassword', (unlock) => {
            unlock() //模擬開確認框前釋放
            return d.p
        }, { pm: pm1 })
        await Promise.resolve()
        assert.strict.equal(await isResolved(pm1), true, '開確認框前按鈕鎖應已釋放')
        assert.strict.equal(sg.isRunning('adminResetUserPassword'), true, '確認框開啟中流程仍進行')
        let r2 = await sg.run('adminResetUserPassword', () => 'again')
        assert.strict.equal(r2, null, '確認框開啟中再觸發仍略過')
        d.resolve('ok')
        assert.strict.equal(await r1, 'ok')
    })

    it('UNIT-SG-006 不同 key 互不影響; 同步拋錯亦釋放', async function() {
        let sg = submitGuard()
        let d = deferred()
        sg.run('saveUsers', () => d.p)
        let r = await sg.run('saveIps', () => 'ips')
        assert.strict.equal(r, 'ips', '不同 key 不受影響')
        let err = null
        await sg.run('saveTokens', () => {
            throw new Error('sync-throw')
        }).catch((e) => {
            err = e
        })
        assert.strict.equal(err && err.message, 'sync-throw')
        assert.strict.equal(sg.isRunning('saveTokens'), false, '同步拋錯後釋放占位')
        d.resolve()
    })

})
