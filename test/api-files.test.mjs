//api-files: 圖台(檔案) + 附件 + 統計 之 HTTP 契約測試 (需 backend, 不需 browser)
//對應 spec 設計總覽 §10.3(圖台)/§10.5(getStats); 驗證 file id 機制 (附件存 id 非 base64) 與 agent 可查看檔案.
import assert from 'assert'
import { startServersOnce, apiBaseUrl } from './e2e-setup.mjs'

const human = 'sys'
const agent = 'agent-demo'
const CH = 'id-for-channel-demo'
//1x1 PNG (base64)
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const G = async (p) => (await fetch(`${apiBaseUrl}${p}`)).json()
const P = async (p, b) => (await fetch(`${apiBaseUrl}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json()

describe('api-files（圖台 / 附件 / 統計 HTTP 契約）', function() {
    this.timeout(180000)

    let fid = ''

    before(async function() {
        this.timeout(180000)
        await startServersOnce({ backendOnly: true })
    })

    it('uploadFile → 回 file id + meta (size>0)', async function() {
        //對應 §10.3 POST /api/uploadFile
        let r = await P(`/api/uploadFile?token=${human}`, { name: '逾時截圖.png', type: 'image/png', dataBase64: PNG })
        assert.strictEqual(r.state, 'success')
        assert.ok(r.msg && r.msg.id, '應回 file id')
        assert.strictEqual(r.msg.type, 'image/png')
        assert.ok(r.msg.size > 0, 'size 應 > 0')
        fid = r.msg.id
    })

    it('getFileInfo → 原始檔名/type 正確 (中文檔名保留)', async function() {
        //對應 §10.3 GET /api/getFileInfo — agent 靠此知檔名/type
        let r = await G(`/api/getFileInfo?token=${agent}&id=${fid}`)
        assert.strictEqual(r.state, 'success')
        assert.strictEqual(r.msg.name, '逾時截圖.png')
        assert.strictEqual(r.msg.type, 'image/png')
    })

    it('getFile → 串流真 PNG bytes (magic number) + 正確 Content-Type', async function() {
        //對應 §10.3 GET /api/getFile — agent/前端看圖; 直接回二進位非 JSON
        let resp = await fetch(`${apiBaseUrl}/api/getFile?token=${agent}&id=${fid}`)
        assert.strictEqual(resp.status, 200)
        assert.ok((resp.headers.get('content-type') || '').includes('image/png'))
        let ab = new Uint8Array(await resp.arrayBuffer())
        assert.ok(ab[0] === 0x89 && ab[1] === 0x50 && ab[2] === 0x4e && ab[3] === 0x47, '應為真 PNG (magic 89 50 4E 47)')
    })

    it('getFile 不存在 id → 404', async function() {
        let resp = await fetch(`${apiBaseUrl}/api/getFile?token=${agent}&id=nonexistent-xyz`)
        assert.strictEqual(resp.status, 404)
    })

    it('getFile 非白名單類型 (text/html) → 強制 attachment + octet-stream + nosniff (防 inline XSS)', async function() {
        //安全審計: 上傳惡意 HTML 檔, 若 getFile 以原 type text/html inline 服務 → 於本站原點執行 JS (儲存型 XSS).
        //強化後: 僅點陣圖白名單可 inline, 其餘 (含 html/svg) 一律 octet-stream + attachment + X-Content-Type-Options:nosniff.
        let html = Buffer.from('<html><body><script>window.__xss=1<\/script></body></html>').toString('base64')
        let up = await P(`/api/uploadFile?token=${human}`, { name: 'evil.html', type: 'text/html', dataBase64: html })
        assert.strictEqual(up.state, 'success')
        let hid = up.msg.id
        let resp = await fetch(`${apiBaseUrl}/api/getFile?token=${agent}&id=${hid}`)
        assert.strictEqual(resp.status, 200)
        let ct = resp.headers.get('content-type') || ''
        assert.ok(ct.includes('application/octet-stream'), `非白名單類型不可回原 type, 應 octet-stream, 實得 ${ct}`)
        assert.ok(!ct.includes('text/html'), 'getFile 絕不可回 text/html (會 inline 渲染)')
        let cd = resp.headers.get('content-disposition') || ''
        assert.ok(cd.includes('attachment'), `非白名單類型應 attachment 下載, 實得 ${cd}`)
        assert.strictEqual(resp.headers.get('x-content-type-options'), 'nosniff', '應有 nosniff 禁 MIME 嗅探')
    })

    it('getFile 點陣圖白名單 (image/png) → 維持 inline 顯示 (聊天 <img> 不受影響)', async function() {
        //強化不可誤傷正常圖片顯示: png 仍須 inline + image/png
        let resp = await fetch(`${apiBaseUrl}/api/getFile?token=${agent}&id=${fid}`)
        assert.strictEqual(resp.status, 200)
        assert.ok((resp.headers.get('content-type') || '').includes('image/png'), 'png 應維持 image/png')
        assert.ok((resp.headers.get('content-disposition') || '').includes('inline'), 'png 應維持 inline')
    })

    it('postMessage attachments 只存 file id (非 base64) → 省對話容量', async function() {
        //對應 §10.3 訊息只存 file id; 驗證不含 base64 字面
        let r = await P(`/api/postMessage?token=${human}`, { channelId: CH, content: '附上逾時截圖', attachments: [fid], senderType: 'human' })
        assert.strictEqual(r.state, 'success')
        let att = r.msg.message.attachments
        let arr = JSON.parse(att)
        assert.ok(arr.includes(fid), 'attachments 應含 file id')
        assert.ok(!att.includes('iVBOR'), 'attachments 不應內嵌 base64')
    })

    it('getStats → 回頻道/訊息/任務各狀態計數', async function() {
        //對應 §10.5 getStats
        let r = await G(`/api/getStats?token=${agent}`)
        assert.strictEqual(r.state, 'success')
        let s = r.msg
        assert.strictEqual(typeof s.channels, 'number')
        assert.strictEqual(typeof s.messages, 'number')
        assert.ok(s.tasks && typeof s.tasks.total === 'number')
        assert.ok(['pending', 'running', 'done', 'error'].every(k => typeof s.tasks[k] === 'number'))
    })

    it('postMessage 純圖訊息 (content 空 + attachments) → success (v2 貼圖不打字)', async function() {
        //對應 v2 審查 V1: 前端允許純圖訊息, 後端須放行 (content 與 attachments 至少一者非空)
        let r = await P(`/api/postMessage?token=${human}`, { channelId: CH, content: '', attachments: [fid], senderType: 'human' })
        assert.strictEqual(r.state, 'success')
        let arr = JSON.parse(r.msg.message.attachments)
        assert.ok(arr.includes(fid), '附件應含 file id')
        assert.strictEqual(r.msg.message.content, '', 'content 應為空字串')
    })

    it('postMessage content 與 attachments 皆空 → errContentInvalid', async function() {
        let r = await P(`/api/postMessage?token=${human}`, { channelId: CH, content: '', attachments: [] })
        assert.strictEqual(r.state, 'error')
        assert.strictEqual(r.msg, 'errContentInvalid')
    })

    it('uploadFile >1MB payload → success (maxBytes 放寬至 20MB, 真實截圖可上傳)', async function() {
        //對應 v2 審查 V2: Hapi 預設 1MB, 真實截圖 base64>1MB 會 413; route 已設 maxBytes 20MB
        let big = 'A'.repeat(1500000) //~1.5MB base64, 破舊 1MB 預設
        let r = await P(`/api/uploadFile?token=${human}`, { name: 'big.png', type: 'image/png', dataBase64: big })
        assert.strictEqual(r.state, 'success')
        assert.ok(r.msg.size > 1000000, 'size 應 > 1MB')
    })

    it('壞 token 上傳 → error (getAndVerifyAppUser 守門)', async function() {
        let r = await P(`/api/uploadFile?token=badtok`, { name: 'x.png', type: 'image/png', dataBase64: PNG })
        assert.strictEqual(r.state, 'error')
    })

    it('uploadFile 缺 dataBase64 → errUploadInvalid', async function() {
        let r = await P(`/api/uploadFile?token=${human}`, { name: 'x.png', type: 'image/png' })
        assert.strictEqual(r.state, 'error')
        assert.strictEqual(r.msg, 'errUploadInvalid')
    })
})
