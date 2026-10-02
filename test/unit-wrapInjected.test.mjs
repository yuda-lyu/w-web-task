//unit-wrapInjected：server/wrapInjected.mjs 之 W 契約（注入函數包裝）單元測試（不需 server/browser）。
//對應 spec/設計要點與取捨.md D15 與 w-web-sso 權杖外洩修正方案 v2〈六〉W 契約：
//  - 注入函數同步拋錯或 reject → 回 failValue（getUserByToken 用 null＝查無; verifyClientUser/verifyAppUser 用 false＝無權限）;
//  - 失敗時以 describeUpstream(err) 之結果呼叫 onFail：reject 值（或 Error.message）屬 sso K 契約 14 個 key → { upstream: key };
//    否則只給 { upstreamType, upstreamName }（型別與 Error.name）, 絕不含原文。
//模組以 before 動態載入：模組不存在時各案各自失敗（紅燈可逐列辨識）, 而非整檔載入錯誤。
import assert from 'assert'


//sso K 契約之 14 個 key（方案〈六〉K 契約對照表）; 白名單為與 sso 之同步點
const KEYS_K = [
    'invalidUrl',
    'invalidTokenSelf',
    'invalidTokenTar',
    'invalidUserIdTar',
    'noTokenKeyValueInUrl',
    'noTokenKeyUserIdInUrl',
    'noTokenInUrl',
    'cannotGetUserByUrl',
    'cannotGetUsersByUrl',
    'cannotGetUserDataByUrl',
    'cannotGetUsersDataByUrl',
    'noUserDataByUrl',
    'noUsersDataByUrl',
    'noUserDataAfterConvert',
]

//合成秘密: 模擬舊版 sso helper 失敗時 reject 之「已代入權杖之完整網址」
const SECRET_SYS = 'SYNTH-SYS-SECRET-FOR-TEST'
const SECRET_USER = 'SYNTH-USER-SECRET-FOR-TEST'
const LEGACY_REJECT = `can not get user data by url[http://127.0.0.1:11007/api/getSsoUserInfor?token=${SECRET_SYS}&key=token&value=${SECRET_USER}]`


describe('unit-wrapInjected（W 契約：注入函數失敗視同否定結果且不外洩原文）', function() {
    this.timeout(10000)

    let m = null
    let loadErr = null
    before(async function() {
        try {
            m = await import('../server/wrapInjected.mjs')
        }
        catch (err) {
            loadErr = err
        }
    })

    //fn: 取模組之具名匯出; 模組不存在或無此匯出即以明確訊息失敗
    let fn = (name) => {
        assert.ok(m, `server/wrapInjected.mjs 無法載入: ${loadErr && (loadErr.code || loadErr.name)}`)
        assert.strictEqual(typeof m[name], 'function', `server/wrapInjected.mjs 應匯出函數 ${name}`)
        return m[name]
    }

    //spy: 記錄 onFail 收到之物件
    let makeSpy = () => {
        let calls = []
        let onFail = (d) => {
            calls.push(d)
        }
        return { calls, onFail }
    }

    //noSecret: 物件序列化後不得含任何合成秘密或上游網址片段
    let noSecret = (o, secrets = [SECRET_SYS, SECRET_USER, 'getSsoUserInfor', 'http://']) => {
        let s = JSON.stringify(o)
        for (let sec of secrets) {
            assert.ok(!s.includes(sec), `onFail 收到之物件不得含「${sec}」: ${s}`)
        }
    }


    // ── 成功路徑：原樣回傳, 不呼叫 onFail ──────────────────────────────────────
    describe('成功路徑（resolve 原樣、非 Promise 回傳）', function() {

        it('async 函數 resolve 物件 → 原樣回傳同一參考, onFail 不被呼叫', async function() {
            let wrapInjected = fn('wrapInjected')
            let u = { id: 'id-a', name: 'a', email: 'a@example.com', isAdmin: 'y' }
            let spy = makeSpy()
            let w = wrapInjected(async () => u, { failValue: null, onFail: spy.onFail })
            let r = await w('tk')
            assert.strictEqual(r, u, '應回傳同一物件參考')
            assert.strictEqual(spy.calls.length, 0, '成功不應呼叫 onFail')
        })

        it('同步函數回傳非 Promise 值 → 包裝後回 Promise 且值原樣（含 false / null / {} 等否定結果不被改寫）', async function() {
            let wrapInjected = fn('wrapInjected')
            let spy = makeSpy()
            for (let v of [true, false, null, {}, 'x']) {
                let w = wrapInjected(() => v, { failValue: 'FAIL', onFail: spy.onFail })
                let p = w()
                assert.ok(p && typeof p.then === 'function', '包裝後應回 Promise')
                assert.deepStrictEqual(await p, v, `同步回傳 ${JSON.stringify(v)} 應原樣`)
            }
            assert.strictEqual(spy.calls.length, 0, '成功不應呼叫 onFail')
        })

        it('呼叫參數原樣傳入原函數', async function() {
            let wrapInjected = fn('wrapInjected')
            let got = null
            let w = wrapInjected((...args) => {
                got = args
                return true
            }, { failValue: false })
            await w({ id: 'u' }, 'getChannels')
            assert.deepStrictEqual(got, [{ id: 'u' }, 'getChannels'])
        })

    })


    // ── 失敗路徑：回 failValue, onFail 收到之物件不含原文 ─────────────────────────
    describe('失敗路徑（reject / throw → failValue, 不外洩原文）', function() {

        it('reject 舊版 helper 形狀之字串（夾合成秘密）→ 回 failValue(null), onFail 一次且只含型別', async function() {
            let wrapInjected = fn('wrapInjected')
            let spy = makeSpy()
            let w = wrapInjected(async () => Promise.reject(LEGACY_REJECT), { failValue: null, onFail: spy.onFail })
            let r = await w('tk')
            assert.strictEqual(r, null, '失敗應回 failValue')
            assert.strictEqual(spy.calls.length, 1, 'onFail 應被呼叫一次')
            assert.deepStrictEqual(spy.calls[0], { upstreamType: 'string', upstreamName: '' }, '非白名單字串只記型別')
            noSecret(spy.calls[0])
        })

        it('verify 系 failValue=false：reject → false（視同無權限）', async function() {
            let wrapInjected = fn('wrapInjected')
            let spy = makeSpy()
            let w = wrapInjected(async () => Promise.reject(LEGACY_REJECT), { failValue: false, onFail: spy.onFail })
            assert.strictEqual(await w({ id: 'u' }, 'getChannels'), false)
            assert.strictEqual(spy.calls.length, 1)
            noSecret(spy.calls[0])
        })

        it('同步 throw（Error, message 夾合成秘密）→ 不上拋, 回 failValue; onFail 只含 Error 型別與名稱', async function() {
            let wrapInjected = fn('wrapInjected')
            let spy = makeSpy()
            let w = wrapInjected(() => {
                throw new Error(`boom ${LEGACY_REJECT}`)
            }, { failValue: false, onFail: spy.onFail })
            let r = await w({ id: 'u' })
            assert.strictEqual(r, false)
            assert.deepStrictEqual(spy.calls, [{ upstreamType: 'error', upstreamName: 'Error' }])
            noSecret(spy.calls[0])
        })

        it('reject Error 子類（TypeError, message 為 fetch 之 Failed to parse URL from <含權杖網址>）→ upstreamName=TypeError', async function() {
            let wrapInjected = fn('wrapInjected')
            let spy = makeSpy()
            let w = wrapInjected(async () => {
                throw new TypeError(`Failed to parse URL from http://127.0.0.1:11007/api/getSsoUserInfor?token=${SECRET_SYS}`)
            }, { failValue: null, onFail: spy.onFail })
            assert.strictEqual(await w('tk'), null)
            assert.deepStrictEqual(spy.calls, [{ upstreamType: 'error', upstreamName: 'TypeError' }])
            noSecret(spy.calls[0])
        })

        it('Error.name 被改寫為非名稱形狀（夾秘密）→ upstreamName 不記', async function() {
            let wrapInjected = fn('wrapInjected')
            let spy = makeSpy()
            let e = new Error('x')
            e.name = `Bad-${SECRET_SYS}`
            let w = wrapInjected(async () => Promise.reject(e), { failValue: null, onFail: spy.onFail })
            assert.strictEqual(await w('tk'), null)
            assert.deepStrictEqual(spy.calls, [{ upstreamType: 'error', upstreamName: '' }])
            noSecret(spy.calls[0])
        })

        it('reject 非字串非 Error（undefined / null / 陣列 / 帶 message 之一般物件）→ 只記型別', async function() {
            let wrapInjected = fn('wrapInjected')
            let cases = [
                [undefined, 'undefined'],
                [null, 'null'],
                [[SECRET_SYS], 'array'],
                [{ message: SECRET_SYS, url: LEGACY_REJECT }, 'object'],
                [12345, 'number'],
            ]
            for (let [v, t] of cases) {
                let spy = makeSpy()
                let w = wrapInjected(async () => Promise.reject(v), { failValue: null, onFail: spy.onFail })
                assert.strictEqual(await w('tk'), null)
                assert.deepStrictEqual(spy.calls, [{ upstreamType: t, upstreamName: '' }], `reject ${t} 應只記型別`)
                noSecret(spy.calls[0])
            }
        })

        it('Error.message 為拋錯之 getter → describeUpstream 不拋, 仍回 failValue', async function() {
            let wrapInjected = fn('wrapInjected')
            let spy = makeSpy()
            let e = new Error('x')
            Object.defineProperty(e, 'message', {
                get() {
                    throw new Error('getter boom')
                },
            })
            let w = wrapInjected(async () => Promise.reject(e), { failValue: null, onFail: spy.onFail })
            assert.strictEqual(await w('tk'), null)
            assert.strictEqual(spy.calls.length, 1, 'onFail 仍應被呼叫一次')
            assert.ok(!('upstream' in spy.calls[0]), 'message 取不到時不得視為白名單 key')
        })

        it('onFail 本身拋錯（例如 log 已關閉）→ 不影響回 failValue', async function() {
            let wrapInjected = fn('wrapInjected')
            let w = wrapInjected(async () => Promise.reject(LEGACY_REJECT), {
                failValue: false,
                onFail: () => {
                    throw new Error('log closed')
                },
            })
            assert.strictEqual(await w({ id: 'u' }), false)
        })

        it('未給 onFail → 仍回 failValue', async function() {
            let wrapInjected = fn('wrapInjected')
            let w = wrapInjected(async () => Promise.reject(LEGACY_REJECT), { failValue: null })
            assert.strictEqual(await w('tk'), null)
        })

    })


    // ── 白名單：sso K 契約 14 個 key 照記, 其餘字串一律不記原文 ──────────────────
    describe('白名單（sso K 契約 14 key 照記; 其餘不記原文）', function() {

        it('reject 字串為 14 個 K 契約 key 之一 → onFail 收到 { upstream: key }', async function() {
            let wrapInjected = fn('wrapInjected')
            for (let k of KEYS_K) {
                let spy = makeSpy()
                let w = wrapInjected(async () => Promise.reject(k), { failValue: null, onFail: spy.onFail })
                assert.strictEqual(await w('tk'), null)
                assert.deepStrictEqual(spy.calls, [{ upstream: k }], `K 契約 key ${k} 應照記`)
            }
        })

        it('Error.message 為 K 契約 key → 同樣照記 { upstream: key }', async function() {
            let wrapInjected = fn('wrapInjected')
            for (let k of KEYS_K) {
                let spy = makeSpy()
                let w = wrapInjected(async () => {
                    throw new Error(k)
                }, { failValue: false, onFail: spy.onFail })
                assert.strictEqual(await w({ id: 'u' }), false)
                assert.deepStrictEqual(spy.calls, [{ upstream: k }], `Error(${k}) 應照記`)
            }
        })

        it('非 K 契約之 key 形字串（sso 其他 key、近似 key、含前後綴）→ 只記型別, 不記原文', function() {
            let describeUpstream = fn('describeUpstream')
            for (let v of ['tokenNoPermission', 'errUserNotFound', 'cannotGetUserByUrlX', ' cannotGetUserByUrl', 'CannotGetUserByUrl', `cannotGetUserByUrl ${SECRET_SYS}`]) {
                let d = describeUpstream(v)
                assert.deepStrictEqual(d, { upstreamType: 'string', upstreamName: '' }, `「${v}」不在白名單, 應只記型別`)
            }
        })

        it('describeUpstream 直接呼叫：白名單 key 與 Error(key) 結果一致', function() {
            let describeUpstream = fn('describeUpstream')
            assert.deepStrictEqual(describeUpstream('noUserDataAfterConvert'), { upstream: 'noUserDataAfterConvert' })
            assert.deepStrictEqual(describeUpstream(new Error('noUserDataAfterConvert')), { upstream: 'noUserDataAfterConvert' })
        })

    })

})
