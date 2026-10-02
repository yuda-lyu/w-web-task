//api-tokenLeak：注入函數失敗時之權杖外洩與 fail-closed 契約測試（需 backend，不需 browser）。
//對應 spec/設計要點與取捨.md D15（w-web-sso 權杖外洩修正方案 v2 之 W 契約、S7–S9、表 B task 列）。
//
//測試權杖（srv.mjs 內定義, 受 NODE_ENV!=='production' 守門; harness 以 `node srv.mjs ./test/tools/e2e-settings.json` 啟動後端）：
//  - '{token-for-reject}'：getUserByToken 以舊版 sso helper 形狀之字串 reject（夾合成秘密 SYNTH-SYS-SECRET-FOR-TEST 與本權杖）。
//  - '{token-for-verify-throw}'：getUserByToken 回合成使用者 id-for-verify-throw; verifyClientUser / verifyAppUser 對其 throw Error('SYNTH-VERIFY-SECRET-FOR-TEST')。
//  - 'bad-invalid-token-xyz'：非測試權杖且未設 ssoAppToken → getUserByToken 回 {}（查無路徑, 作為上游失敗之對照組）。
//
//每案斷言兩個通道：C1 HTTP 回應（自家 key 且不含合成秘密/測試權杖）與 C2 本次後端之 srLog（本案新增之記錄逐筆比對且不含合成秘密/測試權杖）。
//C3/C4（後端 stdout 與 error 事件）不經 harness 暴露, 由 unit-maskLog（陣列/遮罩）與 D15 之驗收探測覆蓋。
import assert from 'assert'
import fs from 'fs'
import path from 'path'
import obj2u8arr from 'wsemi/src/obj2u8arr.mjs'
import u8arr2obj from 'wsemi/src/u8arr2obj.mjs'
import { startServersOnce, apiBaseUrl, backendLogDir } from './tools/e2e-setup.mjs'


const TK_REJECT = '{token-for-reject}'
const TK_VERIFY_THROW = '{token-for-verify-throw}'
const TK_NOT_FOUND = 'bad-invalid-token-xyz'
const TK_ADMIN = 'sys'

//禁出現字串：合成秘密與測試權杖本體（不含大括號之片段同時涵蓋原樣與 URL 編碼 %7B...%7D 兩種形式）
const FORBIDDEN = ['SYNTH-SYS-SECRET-FOR-TEST', 'SYNTH-VERIFY-SECRET-FOR-TEST', 'token-for-reject', 'token-for-verify-throw']

//本次後端之 srLog 目錄：harness 以測試實例目錄為工作目錄、以 test/tools/e2e-settings.json 啟動後端, srv.mjs 以該設定檔之 logFd 傳入 WWebTask 之 srLog；
//目錄由 harness 匯出（與開發用之 ./logs 分離）
const logDir = backendLogDir


// ── srLog 讀取：以「各 log 檔當下位元組數」為快照, 只讀快照之後新增之內容（本案之記錄）─────────
function snapshotLogs() {
    let snap = {}
    if (fs.existsSync(logDir)) {
        for (let fn of fs.readdirSync(logDir)) {
            if (fn.endsWith('.log')) {
                snap[fn] = fs.statSync(path.join(logDir, fn)).size
            }
        }
    }
    return snap
}

function readNewText(snap) {
    let out = ''
    if (!fs.existsSync(logDir)) {
        return out
    }
    for (let fn of fs.readdirSync(logDir).sort()) { //檔名為 YYYY-MM-DDTHH.log, 字典序即時間序（跨小時亦正確）
        if (!fn.endsWith('.log')) {
            continue
        }
        let buf = fs.readFileSync(path.join(logDir, fn))
        let from = snap[fn] || 0
        if (buf.length > from) {
            out += buf.subarray(from).toString('utf8')
        }
    }
    return out
}

function parseRecords(text) {
    return text.split(/\r?\n/).filter((l) => l.trim() !== '').map((l) => {
        try {
            return JSON.parse(l)
        }
        catch (err) {
            return { _raw: l }
        }
    })
}

//proj：記錄之比對投影（level + event + 語意欄位; 略去 time/pid/hostname 等環境欄位）
function proj(r) {
    let o = { level: r.level, event: r.event }
    for (let k of ['err', 'upstream', 'upstreamType', 'upstreamName', '_raw']) {
        if (k in r) {
            o[k] = r[k]
        }
    }
    return o
}

//waitRecords：pino 經 worker thread 非同步落檔, 輪詢至新增記錄數達 n（或逾時）後再多等一小段收齊尾端記錄
async function waitRecords(snap, n, timeoutMs = 8000) {
    let t0 = Date.now()
    while (Date.now() - t0 < timeoutMs) {
        if (parseRecords(readNewText(snap)).length >= n) {
            break
        }
        await new Promise((resolve) => setTimeout(resolve, 200))
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
    let text = readNewText(snap)
    return { text, recs: parseRecords(text) }
}

function assertNoForbidden(text, where) {
    for (let s of FORBIDDEN) {
        assert.ok(!String(text).includes(s), `${where} 不得含「${s}」: ${String(text).slice(0, 400)}`)
    }
}


// ── HTTP helper ───────────────────────────────────────────────────────────────
async function httpGet(pathQs) {
    let res = await fetch(`${apiBaseUrl}${pathQs}`)
    let text = await res.text()
    let body = null
    try {
        body = JSON.parse(text)
    }
    catch (err) {}
    return { status: res.status, text, body }
}

//資料通道 /api/main（w-converhp 封包）：Authorization 走 verifyConn; 本體 __sysToken__ 走 getUserIdByToken
async function postMain(authToken, sysToken, func = 'getWebInfor') {
    let payload = { func, input: { __sysInputArgs__: [], __sysToken__: sysToken } }
    let res = await fetch(`${apiBaseUrl}/api/main`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/octet-stream' },
        body: Buffer.from(obj2u8arr(payload)),
    })
    let u8a = new Uint8Array(await res.arrayBuffer())
    let text = Buffer.from(u8a).toString('utf8')
    let obj = u8arr2obj(u8a)
    return { status: res.status, text, obj }
}

const qs = (tk) => encodeURIComponent(tk)


describe('api-tokenLeak（注入函數失敗不外洩上游原文; getUserIdByToken fail-closed）', function() {
    this.timeout(180000) //首次起後端含 seedDb

    let snapSuite = null

    before(async function() {
        await startServersOnce({ backendOnly: true })
        snapSuite = snapshotLogs()
    })


    // ── HTTP 路由（表 B task：E1 / E3 / E3b）─────────────────────────────────────
    it('E1 GET /api/getUserByToken 以 {token-for-reject} → 回自家 key errUserNotFound; 回應與 srLog 皆不含上游原文', async function() {
        //D15/W 契約: getUserByToken reject 視同查無(null) → 走 getTokenUser 既有查無分支 → errUserNotFound (S7)
        let snap = snapshotLogs()
        let r = await httpGet(`/api/getUserByToken?token=${qs(TK_REJECT)}`)
        assert.strictEqual(r.status, 200)
        assert.deepStrictEqual(r.body, { state: 'error', msg: 'errUserNotFound' }, `回應應為自家 key, 實得 ${r.text}`)
        assertNoForbidden(r.text, 'HTTP 回應')
        //D15: 包裝處記 warn（因, 只記型別）+ 呼叫點記 error（果, 自家 key）= 2 筆
        let { text, recs } = await waitRecords(snap, 2)
        assertNoForbidden(text, 'srLog')
        assert.deepStrictEqual(recs.map(proj), [
            { level: 40, event: 'inject-getUserByToken-fail', upstreamType: 'string', upstreamName: '' },
            { level: 50, event: 'api/getUserByToken', err: 'errUserNotFound' },
        ])
    })

    it('E3 GET /api/getChannels（app 路由）以 {token-for-reject} → errUserNotFound; 回應與 srLog 皆不含上游原文', async function() {
        let snap = snapshotLogs()
        let r = await httpGet(`/api/getChannels?token=${qs(TK_REJECT)}`)
        assert.strictEqual(r.status, 200)
        assert.deepStrictEqual(r.body, { state: 'error', msg: 'errUserNotFound' }, `回應應為自家 key, 實得 ${r.text}`)
        assertNoForbidden(r.text, 'HTTP 回應')
        let { text, recs } = await waitRecords(snap, 2)
        assertNoForbidden(text, 'srLog')
        assert.deepStrictEqual(recs.map(proj), [
            { level: 40, event: 'inject-getUserByToken-fail', upstreamType: 'string', upstreamName: '' },
            { level: 50, event: 'api/getChannels', err: 'errUserNotFound' },
        ])
    })

    it('E3b GET /api/getFile（二進位路由, 非 runApi）以 {token-for-reject} → 404 + 自家 key; 回應與 srLog 皆不含上游原文', async function() {
        let snap = snapshotLogs()
        let r = await httpGet(`/api/getFile?token=${qs(TK_REJECT)}&id=x`)
        assert.strictEqual(r.status, 404)
        assert.deepStrictEqual(r.body, { state: 'error', msg: 'errUserNotFound' }, `回應應為自家 key, 實得 ${r.text}`)
        assertNoForbidden(r.text, 'HTTP 回應')
        let { text, recs } = await waitRecords(snap, 2)
        assertNoForbidden(text, 'srLog')
        assert.deepStrictEqual(recs.map(proj), [
            { level: 40, event: 'inject-getUserByToken-fail', upstreamType: 'string', upstreamName: '' },
            { level: 50, event: 'api/getFile', err: 'errUserNotFound' },
        ])
    })


    // ── verify 系注入函數拋錯（W 契約：視同無權限）───────────────────────────────
    it('verifyClientUser 拋錯：GET /api/getUserByToken 以 {token-for-verify-throw} → errUserNoPermission; 不含合成秘密', async function() {
        let snap = snapshotLogs()
        let r = await httpGet(`/api/getUserByToken?token=${qs(TK_VERIFY_THROW)}`)
        assert.strictEqual(r.status, 200)
        assert.deepStrictEqual(r.body, { state: 'error', msg: 'errUserNoPermission' }, `回應應為自家 key, 實得 ${r.text}`)
        assertNoForbidden(r.text, 'HTTP 回應')
        let { text, recs } = await waitRecords(snap, 2)
        assertNoForbidden(text, 'srLog')
        assert.deepStrictEqual(recs.map(proj), [
            { level: 40, event: 'inject-verifyClientUser-fail', upstreamType: 'error', upstreamName: 'Error' },
            { level: 50, event: 'api/getUserByToken', err: 'errUserNoPermission' },
        ])
    })

    it('verifyAppUser 拋錯：GET /api/getChannels 以 {token-for-verify-throw} → errUserNoPermission; 不含合成秘密', async function() {
        let snap = snapshotLogs()
        let r = await httpGet(`/api/getChannels?token=${qs(TK_VERIFY_THROW)}`)
        assert.strictEqual(r.status, 200)
        assert.deepStrictEqual(r.body, { state: 'error', msg: 'errUserNoPermission' }, `回應應為自家 key, 實得 ${r.text}`)
        assertNoForbidden(r.text, 'HTTP 回應')
        let { text, recs } = await waitRecords(snap, 2)
        assertNoForbidden(text, 'srLog')
        assert.deepStrictEqual(recs.map(proj), [
            { level: 40, event: 'inject-verifyAppUser-fail', upstreamType: 'error', upstreamName: 'Error' },
            { level: 50, event: 'api/getChannels', err: 'errUserNoPermission' },
        ])
    })


    // ── 查無與上游失敗對外 key 一致（S6/S7：失敗＝否定結果）─────────────────────
    it('查無路徑（getUserByToken 回 {}）之對外 key 與上游失敗相同：client 與 app 路由皆 errUserNotFound, 且不記 inject warn', async function() {
        //S7: getTokenUser 補 isestr + iseobj → errUserNotFound（修正前 client 路由經 checkUser 回 errUserIdMissing）
        let snap = snapshotLogs()
        let rc = await httpGet(`/api/getUserByToken?token=${qs(TK_NOT_FOUND)}`)
        assert.deepStrictEqual(rc.body, { state: 'error', msg: 'errUserNotFound' }, `client 路由查無應 errUserNotFound, 實得 ${rc.text}`)
        let ra = await httpGet(`/api/getChannels?token=${qs(TK_NOT_FOUND)}`)
        assert.deepStrictEqual(ra.body, { state: 'error', msg: 'errUserNotFound' }, `app 路由查無應 errUserNotFound, 實得 ${ra.text}`)
        //查無非上游失敗 → 只有呼叫點之 error, 無 inject warn
        let { recs } = await waitRecords(snap, 2)
        assert.deepStrictEqual(recs.map(proj), [
            { level: 50, event: 'api/getUserByToken', err: 'errUserNotFound' },
            { level: 50, event: 'api/getChannels', err: 'errUserNotFound' },
        ])
    })


    // ── 資料通道（表 B task：E5 verifyConn、E6 execute __sysToken__）─────────────
    it('E5 資料通道 /api/main 以 Authorization {token-for-reject} → permission denied; srLog 只記 1 筆 inject warn 且不含上游原文', async function() {
        let snap = snapshotLogs()
        let r = await postMain(TK_REJECT, TK_REJECT)
        assert.strictEqual(r.status, 200)
        assert.strictEqual(r.obj.error, 'permission denied', `verifyConn 未通過應回 permission denied, 實得 ${r.text}`)
        assertNoForbidden(r.text, '資料通道回應')
        //D15: verifyConn 失敗之果由 w-converhp 回 permission denied（不寫 srLog）→ 同一次失敗 1 筆
        let { text, recs } = await waitRecords(snap, 1)
        assertNoForbidden(text, 'srLog')
        assert.deepStrictEqual(recs.map(proj), [
            { level: 40, event: 'inject-getUserByToken-fail', upstreamType: 'string', upstreamName: '' },
        ])
    })

    it('E6 資料通道：Authorization 有效(sys) 但 __sysToken__ 為 {token-for-reject} → 不執行函數（fail-closed）; srLog 記 inject warn + getUserIdByToken error', async function() {
        let snap = snapshotLogs()
        let r = await postMain(TK_ADMIN, TK_REJECT)
        assert.strictEqual(r.status, 200)
        let out = r.obj && r.obj.success && r.obj.success.output
        assert.ok(out, `應有 execute 回應, 實得 ${r.text}`)
        assert.strictEqual(out.state, 'error', `__sysToken__ 上游失敗時不得執行函數, 實得 ${r.text}`)
        assertNoForbidden(r.text, '資料通道回應')
        let { text, recs } = await waitRecords(snap, 3)
        assertNoForbidden(text, 'srLog')
        assert.deepStrictEqual(recs.map(proj), [
            { level: 30, event: 'verifyConn' },
            { level: 40, event: 'inject-getUserByToken-fail', upstreamType: 'string', upstreamName: '' },
            { level: 50, event: 'getUserIdByToken', err: 'errUserIdMissing' },
        ])
    })

    it('S9 fail-closed：__sysToken__ 查無（回 {}）或空字串 → 不執行函數且記 errUserIdMissing; 有效 __sysToken__ 照常執行（對照組）', async function() {
        //S9: 修正前 getUserIdByToken 查無回 '' 並繼續執行函數（fail-open）; 修正後一律 reject errUserIdMissing（對齊 perm）
        let snap = snapshotLogs()
        let rNotFound = await postMain(TK_ADMIN, TK_NOT_FOUND)
        let outNotFound = rNotFound.obj && rNotFound.obj.success && rNotFound.obj.success.output
        assert.ok(outNotFound, `應有 execute 回應, 實得 ${rNotFound.text}`)
        assert.strictEqual(outNotFound.state, 'error', `__sysToken__ 查無時不得執行函數, 實得 ${rNotFound.text}`)

        let rEmpty = await postMain(TK_ADMIN, '')
        let outEmpty = rEmpty.obj && rEmpty.obj.success && rEmpty.obj.success.output
        assert.ok(outEmpty, `應有 execute 回應, 實得 ${rEmpty.text}`)
        assert.strictEqual(outEmpty.state, 'error', `__sysToken__ 為空字串時不得執行函數, 實得 ${rEmpty.text}`)

        //對照組：有效權杖照常執行（fail-closed 不誤擋）
        let rOk = await postMain(TK_ADMIN, TK_ADMIN)
        let outOk = rOk.obj && rOk.obj.success && rOk.obj.success.output
        assert.ok(outOk && outOk.state === 'success', `有效 __sysToken__ 應執行成功, 實得 ${rOk.text}`)
        assert.ok(outOk.msg && outOk.msg.kpLang, 'getWebInfor 應回 webInfor（含 kpLang）')

        let { recs } = await waitRecords(snap, 6)
        assert.deepStrictEqual(recs.map(proj), [
            { level: 30, event: 'verifyConn' },
            { level: 50, event: 'getUserIdByToken', err: 'errUserIdMissing' },
            { level: 30, event: 'verifyConn' },
            { level: 50, event: 'getUserIdByToken', err: 'errUserIdMissing' },
            { level: 30, event: 'verifyConn' },
            { level: 30, event: 'kpfun-getWebInfor' },
        ])
    })


    // ── 全程 srLog 總檢（本檔所有請求）──────────────────────────────────────────
    it('本檔全部請求後, 本次後端之 srLog 新增內容不含任何合成秘密與測試權杖', async function() {
        await new Promise((resolve) => setTimeout(resolve, 800))
        let text = readNewText(snapSuite)
        assert.ok(text.length > 0, `應讀到本次後端之 srLog 新增內容（${logDir}）`)
        assertNoForbidden(text, '本次 srLog')
    })

})
