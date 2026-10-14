import assert from 'assert'
import createAuthorizeExec from '../server/authorizeExec.mjs'


//
// UNIT-AE-001～006: 資料通道表操作之授權閘 server/authorizeExec.mjs (spec/設計要點與取捨.md D17 決策 2; CLAUDE_rulebook.md D17-2)
//   D17-2「只放行 userId 為非空字串、且 methodName 屬 methodsExec 之請求, 回傳嚴格布林」→ UNIT-AE-001、005
//   D17-2「拒絕時回 false 並記 srLog.error({ event:'authorizeExec', err, tableName, methodName }); userId 缺為 errUserIdMissing、方法不在清單為 errUserNoPermission」→ UNIT-AE-002～004
//   D17-2「由 server/authorizeExec.mjs 建立」之建立參數檢核 → UNIT-AE-006
//   端到端(真後端之函數清單與直寫被拒)見 api-dataChannel
// 跑法: npx mocha test/unit-authorizeExec.test.mjs
//


//srLog mock: 收集呼叫
function mockSrLog() {
    let calls = []
    let srLog = {
        info: (d) => calls.push({ level: 'info', d }),
        warn: (d) => calls.push({ level: 'warn', d }),
        error: (d) => calls.push({ level: 'error', d }),
    }
    return { srLog, calls }
}


describe('unit-authorizeExec(資料通道表操作之授權閘, D17-2)', function() {

    it('UNIT-AE-001 已識別使用者之 select → 放行(嚴格 true), 不記 srLog', function() {
        let { srLog, calls } = mockSrLog()
        let authorizeExec = createAuthorizeExec({ methodsExec: ['select'], srLog })
        for (let tableName of ['channels', 'channelMembers']) {
            //前端同步呼叫 select 不帶參數, input 為 undefined(w-serv-webdata 1.1.12 之同步行為)
            let b = authorizeExec({ userId: 'id-for-admin', tableName, methodName: 'select', input: undefined })
            assert.strictEqual(b, true)
        }
        assert.deepStrictEqual(calls, [])
    })

    it('UNIT-AE-002 userId 為空字串 → 拒絕(嚴格 false), srLog.error 記 errUserIdMissing 與表名、方法名', function() {
        let { srLog, calls } = mockSrLog()
        let authorizeExec = createAuthorizeExec({ methodsExec: ['select'], srLog })
        let b = authorizeExec({ userId: '', tableName: 'channels', methodName: 'select', input: undefined })
        assert.strictEqual(b, false)
        assert.deepStrictEqual(calls, [
            { level: 'error', d: { event: 'authorizeExec', err: 'errUserIdMissing', tableName: 'channels', methodName: 'select' } },
        ])
    })

    it('UNIT-AE-003 userId 非字串(undefined / null / 數字 / 物件)→ 拒絕, 皆記 errUserIdMissing', function() {
        let { srLog, calls } = mockSrLog()
        let authorizeExec = createAuthorizeExec({ methodsExec: ['select'], srLog })
        for (let userId of [undefined, null, 123, { id: 'x' }]) {
            assert.strictEqual(authorizeExec({ userId, tableName: 'channelMembers', methodName: 'select' }), false)
        }
        assert.strictEqual(calls.length, 4)
        for (let c of calls) {
            assert.deepStrictEqual(c, { level: 'error', d: { event: 'authorizeExec', err: 'errUserIdMissing', tableName: 'channelMembers', methodName: 'select' } })
        }
    })

    it('UNIT-AE-004 方法不在 methodsExec(insert / save / del / mix / delAll)→ 拒絕, 記 errUserNoPermission', function() {
        let { srLog, calls } = mockSrLog()
        let authorizeExec = createAuthorizeExec({ methodsExec: ['select'], srLog })
        let methods = ['insert', 'save', 'del', 'mix', 'delAll']
        for (let methodName of methods) {
            assert.strictEqual(authorizeExec({ userId: 'id-for-admin', tableName: 'channels', methodName, input: [{ id: 'x' }] }), false)
        }
        assert.deepStrictEqual(calls.map((c) => c.d), methods.map((methodName) => ({ event: 'authorizeExec', err: 'errUserNoPermission', tableName: 'channels', methodName })))
        assert.ok(calls.every((c) => c.level === 'error'))
    })

    it('UNIT-AE-005 回傳一律為布林(w-serv-webdata 只認嚴格 true), 不回傳 truthy 之非布林值', function() {
        let { srLog } = mockSrLog()
        let authorizeExec = createAuthorizeExec({ methodsExec: ['select'], srLog })
        let rs = [
            authorizeExec({ userId: 'u', tableName: 'channels', methodName: 'select' }),
            authorizeExec({ userId: '', tableName: 'channels', methodName: 'select' }),
            authorizeExec({ userId: 'u', tableName: 'channels', methodName: 'save' }),
            authorizeExec({}),
        ]
        assert.deepStrictEqual(rs.map((r) => typeof r), ['boolean', 'boolean', 'boolean', 'boolean'])
        assert.deepStrictEqual(rs, [true, false, false, false])
    })

    it('UNIT-AE-006 建立參數無效(methodsExec 非非空陣列、srLog 無 error 函數)→ 建立時即拋 Error', function() {
        let { srLog } = mockSrLog()
        assert.throws(() => createAuthorizeExec({ methodsExec: [], srLog }), Error)
        assert.throws(() => createAuthorizeExec({ methodsExec: 'select', srLog }), Error)
        assert.throws(() => createAuthorizeExec({ methodsExec: ['select'], srLog: {} }), Error)
        assert.throws(() => createAuthorizeExec(), Error)
    })

})
