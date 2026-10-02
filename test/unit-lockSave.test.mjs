import assert from 'assert'
import cacheSt from 'wsemi/src/cacheSt.mjs'
import createLockSave from '../server/lockSave.mjs'


//
// UNIT-LS-001～005: 後端寫入路徑之雙擊防護 server/lockSave.mjs (D16)
//   對應 spec/設計要點與取捨.md D16「後端: 以操作:操作者 id 原子占位, 同一操作者之同一儲存處理中再送出即 reject 'saveInProgress'」.
//   以受控之 deferred 決定第 1 次何時完成, 不依賴時序 (procCore 各站點之並行不變式另見 unit-procCore「雙擊防護 / 並行 (D16)」,
//   真後端之端到端不變式見 api-doubleclick).
// 跑法: npx mocha test/unit-lockSave.test.mjs --timeout 30000
//


function deferred() {
    let resolve
    let reject
    let p = new Promise((res, rej) => {
        resolve = res
        reject = rej
    })
    return { p, resolve, reject }
}


describe('lockSave (後端清單儲存雙擊防護, D16)', function() {

    let cst = null
    let lockSave = null

    beforeEach(function() {
        cst = cacheSt()
        lockSave = createLockSave(cst)
    })

    afterEach(function() {
        cst.clear() //停止 cacheSt 之 TTL 偵測 timer, 避免 mocha 不結束
    })

    it('UNIT-LS-001 同一操作者同一操作處理中再送出 → reject saveInProgress, 第 2 次之 fn 不執行', async function() {
        let d = deferred()
        let n = 0
        let r1 = lockSave('updateUsersList', 'id-admin', () => {
            n++
            return d.p
        })
        let err = null
        await lockSave('updateUsersList', 'id-admin', async () => {
            n++
        }).catch((e) => {
            err = e
        })
        assert.strict.equal(err, 'saveInProgress')
        d.resolve('ok')
        assert.strict.equal(await r1, 'ok')
        assert.strict.equal(n, 1)
    })

    it('UNIT-LS-002 不同操作者 / 不同操作互不影響', async function() {
        let d = deferred()
        let r1 = lockSave('updateUsersList', 'id-admin-a', () => d.p)
        let r2 = await lockSave('updateUsersList', 'id-admin-b', async () => 'b')
        let r3 = await lockSave('updateIpsList', 'id-admin-a', async () => 'ips')
        assert.strict.equal(r2, 'b')
        assert.strict.equal(r3, 'ips')
        d.resolve('a')
        assert.strict.equal(await r1, 'a')
    })

    it('UNIT-LS-003 fn 之 reject 原樣 bubble, 且結束後釋放占位', async function() {
        let err = null
        await lockSave('updateTokensList', 'id-admin', async () => {
            return Promise.reject('tokenPermsInvalid')
        }).catch((e) => {
            err = e
        })
        assert.strict.equal(err, 'tokenPermsInvalid')
        let r = await lockSave('updateTokensList', 'id-admin', async () => 'again')
        assert.strict.equal(r, 'again', '失敗結束後同 key 可再執行')
    })

    it('UNIT-LS-004 完成後同一操作者可再儲存(依序之合法連續儲存不受影響)', async function() {
        let r1 = await lockSave('updateIpsList', 'id-admin', async () => 1)
        let r2 = await lockSave('updateIpsList', 'id-admin', async () => 2)
        assert.strict.equal(r1, 1)
        assert.strict.equal(r2, 2)
    })

    it('UNIT-LS-005 opt.errKey 指定占位衝突時之 key(非儲存類操作用)', async function() {
        let d = deferred()
        let r1 = lockSave('proxyRequest', 'id-user', () => d.p, { errKey: 'requestInProgress' })
        let err = null
        await lockSave('proxyRequest', 'id-user', async () => 'x', { errKey: 'requestInProgress' }).catch((e) => {
            err = e
        })
        assert.strict.equal(err, 'requestInProgress')
        d.resolve('ok')
        assert.strict.equal(await r1, 'ok')
    })

})
