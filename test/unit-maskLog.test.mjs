//unit-maskLog：server/maskLog.mjs 之 M 契約（遮罩）單元測試（不需 server/browser）。
//對應 spec/設計要點與取捨.md D15 與 w-web-sso 權杖外洩修正方案 v2〈六〉M 契約：
//四 repo（sso / perm / api / task）各一份實作、同一組測資；本檔之 M 表逐列即該組測資, 不得改寫預期值遷就實作。
//模組以 before 動態載入：模組不存在時各案各自失敗（紅燈可逐列辨識）, 而非整檔載入錯誤。
import assert from 'assert'


describe('unit-maskLog（M 契約：maskTok / maskQuery / maskUrl）', function() {
    this.timeout(10000)

    let m = null
    let loadErr = null
    before(async function() {
        try {
            m = await import('../server/maskLog.mjs')
        }
        catch (err) {
            loadErr = err
        }
    })

    //fn: 取模組之具名匯出; 模組不存在或無此匯出即以明確訊息失敗
    let fn = (name) => {
        assert.ok(m, `server/maskLog.mjs 無法載入: ${loadErr && (loadErr.code || loadErr.name)}`)
        assert.strictEqual(typeof m[name], 'function', `server/maskLog.mjs 應匯出函數 ${name}`)
        return m[name]
    }


    // ── maskTok：M 契約測資表（四 repo 同一組）────────────────────────────────
    describe('maskTok（M 契約測資表逐列）', function() {

        //[輸入, 預期輸出, 說明]; 預期值逐字取自方案〈六〉M 契約測資表
        let rows = [
            ['', '', '空字串 → 空字串'],
            ['abc', '(len=3)', 'n=3 → k=min(4,floor(3/8))=0 → 只給長度'],
            ['abcdefg', '(len=7)', 'n=7 → k=0 → 只給長度（≤7 字元不露任何字）'],
            ['abcdefgh', 'a...h(len=8)', 'n=8 → k=1 → 前 1 後 1'],
            ['token-for-app', 't...p(len=13)', 'n=13 → k=1（舊前4後4 會露 8 字）'],
            ['abcdefghijklmnop', 'ab...op(len=16)', 'n=16 → k=2'],
            ['0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', '0199...4a5b(len=36)', 'n=36 → k=4（與現行 sso session token 格式相容）'],
            [['abcdefghijklmnop', 'x'], ['ab...op(len=16)', '(len=1)'], '陣列 → 逐元素遮罩（Hapi 重複 query 參數）'],
            [{ a: 'SECRET' }, '(object)', '物件 → (typeof), 絕不輸出原值'],
            [12345, '(number)', '數字 → (typeof)'],
            ['\nbcdefghijklmno\r', '?b...o?(len=16)', '露出字元中之控制字元換成 ?（防 log 注入）'],
        ]

        for (let [inp, exp, desc] of rows) {
            it(`${JSON.stringify(inp)} → ${JSON.stringify(exp)}（${desc}）`, function() {
                let maskTok = fn('maskTok')
                assert.deepStrictEqual(maskTok(inp), exp)
            })
        }

        it('undefined / null → 空字串（M 契約：undefined／null／\'\' → \'\'）', function() {
            let maskTok = fn('maskTok')
            assert.strictEqual(maskTok(undefined), '')
            assert.strictEqual(maskTok(null), '')
        })

        it('其他型別一律 (typeof)：boolean / function / 巢狀物件皆不輸出原值', function() {
            let maskTok = fn('maskTok')
            assert.strictEqual(maskTok(true), '(boolean)')
            assert.strictEqual(maskTok(() => 'SECRET'), '(function)')
            let r = maskTok({ token: 'SECRET-IN-OBJECT' })
            assert.strictEqual(r, '(object)')
            assert.ok(!String(r).includes('SECRET'), '物件遮罩結果不得含原值')
        })

        it('陣列之元素為非字串者亦依 M 契約（逐元素：物件→(object)、null→\'\'）', function() {
            let maskTok = fn('maskTok')
            assert.deepStrictEqual(maskTok([{ a: 'SECRET' }, null, 'abcdefgh']), ['(object)', '', 'a...h(len=8)'])
        })

    })


    // ── maskQuery：淺拷貝, 鍵名小寫為 token 者以 maskTok 處理 ────────────────────
    describe('maskQuery（鍵名小寫為 token 者遮罩, 淺拷貝不動原物件）', function() {

        it('token 為字串 → 遮罩; 其他鍵原樣; 原物件不被修改', function() {
            let maskQuery = fn('maskQuery')
            let q = { token: 'abcdefghijklmnop', agentId: 'agent-demo' }
            let r = maskQuery(q)
            assert.deepStrictEqual(r, { token: 'ab...op(len=16)', agentId: 'agent-demo' })
            assert.strictEqual(q.token, 'abcdefghijklmnop', '原物件不得被修改（淺拷貝）')
            assert.notStrictEqual(r, q, '應回傳新物件')
        })

        it('token 為陣列（重複 query 參數）→ 逐元素遮罩, 不含任何原值', function() {
            let maskQuery = fn('maskQuery')
            let r = maskQuery({ token: ['SYNTH-TASK-Y1-SECRET', 'SYNTH-TASK-Y2-SECRET'] })
            //n=20 → k=min(4,floor(20/8))=2
            assert.deepStrictEqual(r, { token: ['SY...ET(len=20)', 'SY...ET(len=20)'] })
            assert.ok(!JSON.stringify(r).includes('Y1') && !JSON.stringify(r).includes('Y2'), '遮罩結果不得含原值中段')
        })

        it('鍵名大小寫不同（Token / TOKEN）亦遮罩', function() {
            let maskQuery = fn('maskQuery')
            assert.deepStrictEqual(maskQuery({ Token: 'abcdefgh', TOKEN: 'abcdefgh' }), { Token: 'a...h(len=8)', TOKEN: 'a...h(len=8)' })
        })

        it('null-prototype 物件（Hapi req.query 之型態）亦可處理', function() {
            let maskQuery = fn('maskQuery')
            let q = Object.create(null)
            q.token = 'abcdefghijklmnop'
            q.id = 'x'
            assert.deepStrictEqual(maskQuery(q), { token: 'ab...op(len=16)', id: 'x' })
        })

        it('非物件輸入依 M 契約遮罩（不原樣輸出）', function() {
            let maskQuery = fn('maskQuery')
            assert.strictEqual(maskQuery(undefined), '')
            //n=21 → k=min(4,floor(21/8))=2
            assert.strictEqual(maskQuery('token=SYNTH-SECRET-QS'), 'to...QS(len=21)')
        })

    })


    // ── maskUrl：origin + pathname, 捨棄 query / fragment / userinfo ─────────────
    //語意對齊 M 契約之來源實作 w-web-sso src/maskUrl.mjs（陣列逐元素 maskUrl、非 http(s) 只回 protocol）
    describe('maskUrl（http(s) 只留 origin + pathname）', function() {

        it('捨棄 query 與 fragment（網址內之權杖不出現）', function() {
            let maskUrl = fn('maskUrl')
            let r = maskUrl('http://127.0.0.1:11007/api/getSsoUserInfor?token=SYNTH-APP-SECRET&key=token&value=SYNTH-USER-SECRET#frag-SECRET')
            assert.strictEqual(r, 'http://127.0.0.1:11007/api/getSsoUserInfor')
            assert.ok(!r.includes('SECRET'), '結果不得含任何 query / fragment 值')
        })

        it('捨棄 userinfo（帳密不出現）', function() {
            let maskUrl = fn('maskUrl')
            assert.strictEqual(maskUrl('https://user:SYNTH-PASS@example.com/a/b?x=1'), 'https://example.com/a/b')
        })

        it('無法解析 → (invalid-url)', function() {
            let maskUrl = fn('maskUrl')
            assert.strictEqual(maskUrl('not a url SYNTH-SECRET'), '(invalid-url)')
        })

        it('非 http(s) 網址（data: / javascript: 之 pathname 即內容）→ 只回 protocol', function() {
            let maskUrl = fn('maskUrl')
            assert.strictEqual(maskUrl('data:text/plain,SYNTH-SECRET-IN-DATA'), 'data:')
            assert.strictEqual(maskUrl('javascript:alert("SYNTH-SECRET")'), 'javascript:')
        })

        it('空值 → \'\'; 其他非字串 → (typeof); 陣列逐元素 maskUrl', function() {
            let maskUrl = fn('maskUrl')
            assert.strictEqual(maskUrl(undefined), '')
            assert.strictEqual(maskUrl(null), '')
            assert.strictEqual(maskUrl(''), '')
            assert.strictEqual(maskUrl({ href: 'http://x/?token=SECRET' }), '(object)')
            assert.deepStrictEqual(maskUrl(['http://h/a?token=SYNTH-SECRET', 'x']), ['http://h/a', '(invalid-url)'])
        })

    })

})
