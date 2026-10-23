//unit-procCoreConcurrency: 多人同時編輯 (原則 10) 之後端寫入契約測試 —— 真實 lmdb ORM + 真實 procCore / kmx / lockSave / withTabLocks / guardWrite.
//規格: C:\opensrcOper\dspec\多人同時編輯之寫入契約.md (§6 比對與寫入、§7 鎖、§13 V1～V14); 本套件盤點與規劃: sgud/rule/rulebook_concurrency.md.
//缺陷編號 E2 / E3 / E4 / O1～O8 見該帳本第 6 節 (inv01 盤點實證; 探測腳本於修前皆為紅).
//測試資料庫落 test/_tmp/concurrency/<案名> (測完即刪); 人為延遲一律用閘門 (gate) 控制次序, 不依賴機器快慢。
import assert from 'assert'
import { digestRow } from 'w-serv-orm/src/baseline.mjs'
import {
    ds, mkEnv, cleanRoot, baselineOfChannels, baselineOfMembers, sleep, gate, pauseOnce, rejKey, snapshot, installFaults, channelsContract
} from './tools/concEnv.mjs'


const ADMIN = 'admin-1'
const ADMIN2 = 'admin-2'
const AGENT = 'agent-1'


//withEnv: 每案獨立資料庫, 結束必關閉並刪除
async function withEnv(name, fn) {
    let env = await mkEnv(name)
    try {
        await fn(env)
    }
    finally {
        await env.close()
    }
}

//seedChannels: 以後台清單 API (不帶基準, 外部呼叫等價) 建頻道, 回寫入後之列
async function seedChannels(env, rows) {
    if (typeof env.pc.saveChannels !== 'function') {
        //修前 (HEAD) 對照用: 尚無清單 API 時退回單筆 API 建夾具, 使其餘斷言能對修前行為判紅 (非「函式不存在」之假紅)
        for (let row of rows) {
            await env.pc.saveChannel(ADMIN, row)
        }
        return env.woItems.channels.select({})
    }
    let r = await env.pc.saveChannels(ADMIN, rows)
    return r.rows
}

//loadChannels: 前端等價 —— 取畫面所見之列並自算基準
async function loadChannels(env) {
    let rows = JSON.parse(JSON.stringify(await env.woItems.channels.select({}))) //經 JSON 傳輸等價
    return { rows, baseline: baselineOfChannels(rows) }
}

//loadMembers: 前端等價 (RPC getChannelMembers) 並自算基準
async function loadMembers(env, channelId) {
    let rows = JSON.parse(JSON.stringify(await env.pc.getChannelMembers(ADMIN, channelId)))
    return { rows, baseline: baselineOfMembers(rows, channelId) }
}

//seedMembers: 建成員 (不帶基準), 回寫入後之成員列
async function seedMembers(env, channelId, rows) {
    if (typeof env.pc.saveChannelMembers !== 'function') {
        //修前 (HEAD) 對照用: 同 seedChannels
        for (let row of rows) {
            await env.pc.saveChannelMember(ADMIN, { channelId, ...row })
        }
        return env.pc.getChannelMembers(ADMIN, channelId)
    }
    let r = await env.pc.saveChannelMembers(ADMIN, channelId, rows)
    return r.rows
}


describe('unit-procCoreConcurrency', function() {
    this.timeout(60000)

    after(function() {
        cleanRoot()
    })


    // ── 契約與前後端基準一致 (規格 §3、§5、V10) ──────────────────────────────────
    describe('契約與基準 (V10 前端算之基準＝伺服端新鮮讀取所算)', function() {

        it('V10: 經 JSON 傳輸之畫面列所算基準 = 伺服端表鎖內新鮮讀取所算 (頻道、成員; 含 lmdb 型別與空值)', async function() {
            await withEnv('v10', async (env) => {
                let rows = await seedChannels(env, [
                    { name: 'v10-a', description: '中文 & <b>', levels: '', agentId: AGENT, ownerId: ADMIN },
                    { name: 'v10-b' }, //未給 description / levels / agentId / ownerId: 空值正規化
                ])
                let { baseline } = await loadChannels(env)
                let r = await env.pc.saveChannels(ADMIN, [], { baseline }).catch((e) => e)
                //全部列自送出集合刪除 → 此處只驗「基準通過比對」: 若兩端算法不一致將是 saveStale 而非成功
                assert.ok(typeof r === 'object' && Array.isArray(r.deleted), `基準應通過比對 (實得 ${JSON.stringify(r)})`)
                assert.strictEqual(r.deleted.length, rows.length)

                //成員: 頻道刪除連帶清掉, 重建後比對
                let ch = (await seedChannels(env, [{ name: 'v10-c' }]))[0]
                await seedMembers(env, ch.id, [{ memberId: 'm1', memberType: 'human', role: 'member' }, { memberId: 'm2', memberType: 'agent', role: 'owner' }])
                let m = await loadMembers(env, ch.id)
                let r2 = await env.pc.saveChannelMembers(ADMIN, ch.id, m.rows, { baseline: m.baseline })
                assert.strictEqual(r2.unchanged, 2, '未改動之列應全數 unchanged (摘要相符)')
                assert.deepStrictEqual(r2.modified, [])
            })
        })

        it('V10 (停用列與非預設字元): 畫面整表含停用列 (isActive n) —— 基準涵蓋整張表; 以整表基準存檔通過且停用列不被動 (伺服端讀取若只取有效列則範圍不一致而被拒)', async function() {
            await withEnv('v10off', async (env) => {
                let desc = '中文 & <i>x</i> 😀 "q" \'s\''
                let [a, b] = await seedChannels(env, [{ name: 'v10-off', description: desc }, { name: 'v10-live' }])
                await env.woItems.channels.save({ id: a.id, isActive: 'n' })
                let { rows, baseline } = await loadChannels(env) //整表 (前端 store.channels 同範圍), 含停用列
                assert.strictEqual(rows.length, 2)
                assert.strictEqual(rows.find((r) => r.id === a.id).isActive, 'n')
                let edited = JSON.parse(JSON.stringify(rows))
                edited.find((r) => r.id === b.id).description = 'edited'
                let r = await env.pc.saveChannels(ADMIN, edited, { baseline })
                assert.deepStrictEqual(r.modified, [b.id])
                assert.strictEqual(r.unchanged, 1)
                let stored = (await env.woItems.channels.select({ id: a.id }))[0]
                assert.strictEqual(stored.isActive, 'n', '停用列不被動')
                assert.strictEqual(stored.description, desc)
            })
        })

        it('契約: fields 與 serverOnly 不交且與 pk 合起來涵蓋 schema 全欄 (7 表; 防 schema 增欄而契約漏列)', async function() {
            let { contracts } = await import('../src/schema/contracts/index.mjs')
            for (let tab of Object.keys(ds)) {
                let c = contracts[tab]
                if (typeof c === 'function') {
                    c = c('any-channel') //channelMembers 為契約工廠
                }
                assert.strictEqual(c.table, tab)
                let all = [c.pk, ...c.fields, ...c.serverOnly]
                assert.strictEqual(new Set(all).size, all.length, `${tab}: fields / serverOnly / pk 不得重複`)
                assert.deepStrictEqual([...all].sort(), [...ds[tab].keys].sort(), `${tab}: 欄位全集 = pk ∪ fields ∪ serverOnly`)
            }
        })

        it('契約: 有後台整表編輯頁之 2 表 (channels、channelMembers 工廠) 可通過 w-serv-orm checkContract; lastSeenMessageId 為伺服器專有', async function() {
            let { checkContract } = await import('w-serv-orm/src/baseline.mjs')
            let { getMembersContract } = await import('../src/schema/contracts/index.mjs')
            assert.strictEqual(checkContract(channelsContract), true)
            let mc = getMembersContract('c-1')
            assert.strictEqual(checkContract(mc), true)
            assert.ok(mc.serverOnly.includes('lastSeenMessageId') && !mc.fields.includes('lastSeenMessageId'))
            assert.strictEqual(mc.scope({ channelId: 'c-1' }), true)
            assert.strictEqual(mc.scope({ channelId: 'c-2' }), false)
        })
    })


    // ── V1 / V12 / V13 / V8 / V9: 拿舊畫面存檔整次拒收、零寫入 ──────────────────────
    describe('基準比對: 舊畫面整次拒收、零寫入 (V1、V8、V9、V12、V13)', function() {

        it('V1: A 存後 B 以舊基準存 → B 整次拒收 saveStale, 零寫入 (庫內＝A 之結果)', async function() {
            await withEnv('v1', async (env) => {
                await seedChannels(env, [{ name: 'a' }, { name: 'b' }])
                let A = await loadChannels(env)
                let B = await loadChannels(env)
                //A 把 a 改名 a1
                let ra = JSON.parse(JSON.stringify(A.rows)); ra[0].name = 'a1'
                await env.pc.saveChannels(ADMIN, ra, { baseline: A.baseline })
                let afterA = await snapshot(env.woItems)
                //B 以舊基準把 b 改名 b1
                let rb = JSON.parse(JSON.stringify(B.rows)); rb[1].name = 'b1'
                let k = await rejKey(() => env.pc.saveChannels(ADMIN2, rb, { baseline: B.baseline }))
                assert.strictEqual(k, 'saveStale')
                assert.deepStrictEqual(await snapshot(env.woItems), afterA, '拒收後庫內不得有任何變動')
            })
        })

        it('V12 (E4 轉綠): 多列提交其中一列過期 → 零寫入 (修前: 逐列迴圈第 1 列已寫入)', async function() {
            await withEnv('v12', async (env) => {
                await seedChannels(env, [{ name: 'c1' }, { name: 'c2' }, { name: 'c3' }])
                let A = await loadChannels(env)
                //他人改了第 3 列
                let c3 = A.rows[2]
                await env.pc.saveChannels(ADMIN2, [{ id: c3.id, description: 'by-other' }])
                let before = await snapshot(env.woItems)
                //A 改前 2 列後整份提交
                let rows = JSON.parse(JSON.stringify(A.rows)); rows[0].name = 'c1-EDITED'; rows[1].name = 'c2-EDITED'
                let k = await rejKey(() => env.pc.saveChannels(ADMIN, rows, { baseline: A.baseline }))
                assert.strictEqual(k, 'saveStale')
                assert.deepStrictEqual(await snapshot(env.woItems), before, '前 2 列不得被寫入')
            })
        })

        it('V13: 格式或版本不識之基準 → errBaselineFormat, 零寫入, 不當作未帶基準 (清單存檔與清單刪除、頻道與成員)', async function() {
            await withEnv('v13', async (env) => {
                let chs = await seedChannels(env, [{ name: 'f1' }])
                let ch = chs[0]
                await seedMembers(env, ch.id, [{ memberId: 'mf' }])
                let mem = (await loadMembers(env, ch.id)).rows
                let before = await snapshot(env.woItems)
                let bads = [null, 'x', 123, {}, [['a']], [['a', 'h2:0123456789abcd']], [['a', 'h1:xyz']], [[ch.id, 'h1:0123456789abcd'], [ch.id, 'h1:0123456789abcd']]]
                for (let bad of bads) {
                    let rows = [{ ...chs[0], name: 'f1-edited' }]
                    assert.strictEqual(await rejKey(() => env.pc.saveChannels(ADMIN, rows, { baseline: bad })), 'errBaselineFormat', `saveChannels baseline=${JSON.stringify(bad)}`)
                    assert.strictEqual(await rejKey(() => env.pc.deleteChannels(ADMIN, [ch.id], { baseline: bad })), 'errBaselineFormat', `deleteChannels baseline=${JSON.stringify(bad)}`)
                    assert.strictEqual(await rejKey(() => env.pc.saveChannelMembers(ADMIN, ch.id, mem, { baseline: bad })), 'errBaselineFormat', `saveChannelMembers baseline=${JSON.stringify(bad)}`)
                    assert.strictEqual(await rejKey(() => env.pc.deleteChannelMembers(ADMIN, ch.id, [mem[0].id], { baseline: bad })), 'errBaselineFormat', `deleteChannelMembers baseline=${JSON.stringify(bad)}`)
                }
                assert.deepStrictEqual(await snapshot(env.woItems), before, '格式不識者零寫入, 且未被降級為不帶基準而寫入')
                //opt 非物件亦視為格式不識
                assert.strictEqual(await rejKey(() => env.pc.saveChannels(ADMIN, [{ ...chs[0], name: 'zz' }], 'garbage')), 'errBaselineFormat')
                assert.deepStrictEqual(await snapshot(env.woItems), before)
            })
        })

        it('V8: 載入後他人新增頻道 → 持舊基準存檔被拒且他人之列保留; 不帶基準之外部清單存檔不產生刪除集合 (只動送出列)', async function() {
            await withEnv('v8', async (env) => {
                await seedChannels(env, [{ name: 'k1' }, { name: 'k2' }])
                let A = await loadChannels(env)
                await env.pc.saveChannels(ADMIN2, [{ name: 'added-by-other' }]) //載入後他人新增
                let rows = JSON.parse(JSON.stringify(A.rows)).slice(0, 1) //A 的送出集合少了 k2 (視為刪除 k2)
                let k = await rejKey(() => env.pc.saveChannels(ADMIN, rows, { baseline: A.baseline }))
                assert.strictEqual(k, 'saveStale')
                let names = (await env.woItems.channels.select({})).map((r) => r.name).sort()
                assert.deepStrictEqual(names, ['added-by-other', 'k1', 'k2'], '他人新增之列不被刪, k2 亦未被刪')

                //外部呼叫 (不帶基準): 只送一列 → 其餘列不被刪 (無刪除集合: 規格 §6「刪除集合＝基準內 − 送出」, 無基準即無集合)
                let r = await env.pc.saveChannels(ADMIN, [{ id: A.rows[0].id, description: 'ext' }])
                assert.deepStrictEqual(r.deleted, [])
                assert.strictEqual((await env.woItems.channels.select({})).length, 3)
            })
        })

        it('V8 (成員範圍): 他頻道成員於載入後新增不影響本頻道存檔; 本頻道新增則拒收; 存檔不動他頻道之列', async function() {
            await withEnv('v8m', async (env) => {
                let [x, y] = await seedChannels(env, [{ name: 'x' }, { name: 'y' }])
                await seedMembers(env, x.id, [{ memberId: 'x1' }])
                await seedMembers(env, y.id, [{ memberId: 'y1' }])
                let X = await loadMembers(env, x.id)
                await seedMembers(env, y.id, [{ memberId: 'y2' }]) //他頻道新增
                let rows = JSON.parse(JSON.stringify(X.rows)); rows[0].role = 'owner'
                let r = await env.pc.saveChannelMembers(ADMIN, x.id, rows, { baseline: X.baseline })
                assert.deepStrictEqual(r.modified, [X.rows[0].id], '他頻道之新增不影響本頻道')
                assert.strictEqual((await env.woItems.channelMembers.select({ channelId: y.id })).length, 2, '他頻道之列不被動')

                let X2 = await loadMembers(env, x.id)
                await seedMembers(env, x.id, [{ memberId: 'x2' }]) //本頻道新增
                let rows2 = JSON.parse(JSON.stringify(X2.rows)); rows2[0].role = 'admin'
                assert.strictEqual(await rejKey(() => env.pc.saveChannelMembers(ADMIN, x.id, rows2, { baseline: X2.baseline })), 'saveStale')
                assert.strictEqual((await env.woItems.channelMembers.select({ channelId: x.id })).length, 2, '他人新增之列保留')
            })
        })

        it('V9 (變形; 本套件無 orderKey): 系統改伺服器專有欄 (order) 後舊基準仍可存; 他人改客戶端欄則被拒', async function() {
            await withEnv('v9', async (env) => {
                await seedChannels(env, [{ name: 'o1' }, { name: 'o2' }])
                let A = await loadChannels(env)
                //系統 (非後台) 改 order: 伺服器專有, 不入基準
                await env.woItems.channels.save({ id: A.rows[0].id, order: 99 })
                let rows = JSON.parse(JSON.stringify(A.rows)); rows[1].description = 'ok'
                let r = await env.pc.saveChannels(ADMIN, rows, { baseline: A.baseline })
                assert.deepStrictEqual(r.modified, [A.rows[1].id])
                //他人改客戶端欄 (name) → 被拒
                await env.pc.saveChannels(ADMIN2, [{ id: A.rows[0].id, name: 'renamed-by-other' }])
                assert.strictEqual(await rejKey(() => env.pc.saveChannels(ADMIN, rows, { baseline: A.baseline })), 'saveStale')
            })
        })

        it('V4 (變形): 系統新增成員列 (ack 缺列路徑) 使持舊畫面之成員清單存檔被拒 (added)', async function() {
            await withEnv('v4', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'v4' }]))[0]
                await seedMembers(env, ch.id, [{ memberId: 'h1' }])
                let M = await loadMembers(env, ch.id)
                await env.pc.ackChannel(AGENT, ch.id, 'MSG-1') //缺列 → 系統新增 agent 成員列
                let rows = JSON.parse(JSON.stringify(M.rows)); rows[0].role = 'owner'
                assert.strictEqual(await rejKey(() => env.pc.saveChannelMembers(ADMIN, ch.id, rows, { baseline: M.baseline })), 'saveStale')
            })
        })

        it('刪除: 清單刪除之基準只含被選列 (他列被改不擋; 被選列被改則擋); 刪除成功後其餘列不動', async function() {
            await withEnv('del-base', async (env) => {
                await seedChannels(env, [{ name: 'd1' }, { name: 'd2' }, { name: 'd3' }])
                let A = await loadChannels(env)
                await env.pc.saveChannels(ADMIN2, [{ id: A.rows[2].id, description: 'other-changed-d3' }]) //他人改非被選列
                let sel = [A.rows[0].id]
                let bs = A.baseline.filter((e) => sel.includes(e[0]))
                let r = await env.pc.deleteChannels(ADMIN, sel, { baseline: bs })
                assert.deepStrictEqual(r.deleted, sel, '他列被改不擋 (刪除是針對特定列之命令, 先刪先贏)')
                //被選列被他人改 → 擋
                await env.pc.saveChannels(ADMIN2, [{ id: A.rows[1].id, name: 'd2-renamed' }])
                let k = await rejKey(() => env.pc.deleteChannels(ADMIN, [A.rows[1].id], { baseline: A.baseline.filter((e) => e[0] === A.rows[1].id) }))
                assert.strictEqual(k, 'saveStale')
                assert.strictEqual((await env.woItems.channels.select({ id: A.rows[1].id })).length, 1, '被擋者未刪')
            })
        })
    })


    // ── E3 / V5 / V14: 伺服器專有欄位 (agent 已讀游標) ──────────────────────────────
    describe('E3 / V5: lastSeenMessageId 為伺服器專有, 成員清單存檔不回寫', function() {

        it('E3 轉綠 / V5: ack 後管理員以含舊游標之整列存檔 → 游標維持系統所寫之值; 未動列不蓋稽核欄', async function() {
            await withEnv('e3', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'e3', agentId: AGENT }]))[0] //連帶建 agent 成員列
                await seedMembers(env, ch.id, [{ memberId: 'human-1', memberType: 'human' }])
                let M = await loadMembers(env, ch.id) //此時 agent 列游標為 ''
                await env.pc.ackChannel(AGENT, ch.id, 'MSG-100') //ack 推進
                let agentRow = (await env.woItems.channelMembers.select({ memberId: AGENT }))[0]
                assert.strictEqual(agentRow.lastSeenMessageId, 'MSG-100')
                //管理員改 human-1 之角色並整份提交 (agent 列帶舊游標 '')
                let rows = JSON.parse(JSON.stringify(M.rows))
                rows.find((r) => r.memberId === 'human-1').role = 'owner'
                assert.strictEqual(rows.find((r) => r.memberId === AGENT).lastSeenMessageId, '', '前置: 畫面上之游標為舊值')
                let r = await env.pc.saveChannelMembers(ADMIN, ch.id, rows, { baseline: M.baseline })
                assert.strictEqual(r.modified.length, 1)
                let after = (await env.woItems.channelMembers.select({ memberId: AGENT }))[0]
                assert.strictEqual(after.lastSeenMessageId, 'MSG-100', '游標不得被回寫成舊值')
                assert.strictEqual(after.userIdUpdate, AGENT, '未被編輯之列, 最後修改者仍為 ack 者 (不蓋成 admin)')
                let list = await env.pc.getChannelsList(AGENT, AGENT)
                assert.strictEqual(list.find((c) => c.id === ch.id).lastSeenMessageId, 'MSG-100', 'agent 讀到的游標不退回')
            })
        })

        it('V14 (主控加之條件): 清單存檔改的是 agent 列本身, 存檔期間人為延遲插入 ackChannel → 游標保留 ack 之值 (成員以合併方式只寫 fields 與稽核欄, 不整列覆寫)', async function() {
            await withEnv('e3-race', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'e3r', agentId: AGENT }]))[0]
                let M = await loadMembers(env, ch.id)
                let g = gate()
                let reached = gate()
                let orig = env.woItems.channelMembers.save.bind(env.woItems.channelMembers)
                env.woItems.channelMembers.save = async (data, opt) => {
                    if (data && data.role !== undefined) { //清單存檔之修改寫入: 讀鎖內前像之後、寫入之前人為停住
                        reached.open()
                        await g.promise
                    }
                    return orig(data, opt)
                }
                let rows = JSON.parse(JSON.stringify(M.rows)); rows[0].role = 'owner'
                let pList = env.pc.saveChannelMembers(ADMIN, ch.id, rows, { baseline: M.baseline })
                await reached.promise
                await env.pc.ackChannel(AGENT, ch.id, 'MSG-777') //延遲期間 ack 落在清單存檔的讀與寫之間 (更新路徑只取實體鎖)
                g.open()
                await pList
                env.woItems.channelMembers.save = orig
                let after = (await env.woItems.channelMembers.select({ memberId: AGENT }))[0]
                assert.strictEqual(after.role, 'owner', '清單存檔之修改已寫入')
                assert.strictEqual(after.lastSeenMessageId, 'MSG-777', 'ack 於讀寫之間推進之游標不得被舊值回寫')
            })
        })

        it('V5: 系統直接改伺服器專有欄 (游標) 後, 後台持舊基準仍可存且該欄維持系統所寫之值; 客戶端偽造之 lastSeenMessageId / userId / timeCreate / isActive / order 不採用 (O6)', async function() {
            await withEnv('v5-o6', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'v5' }]))[0]
                let m = (await seedMembers(env, ch.id, [{ memberId: 'u1' }]))[0]
                let M = await loadMembers(env, ch.id)
                await env.woItems.channelMembers.save({ id: m.id, lastSeenMessageId: 'SYS-9' }, { autoInsert: false })
                let rows = JSON.parse(JSON.stringify(M.rows))
                rows[0].role = 'owner'
                rows[0].lastSeenMessageId = 'FORGED'
                rows[0].userId = 'forged-owner'
                rows[0].timeCreate = '1999-01-01T00:00:00.000+08:00'
                rows[0].isActive = 'n'
                rows[0].order = 99
                await env.pc.saveChannelMembers(ADMIN2, ch.id, rows, { baseline: M.baseline })
                let a = (await env.woItems.channelMembers.select({ id: m.id }))[0]
                assert.strictEqual(a.role, 'owner')
                assert.strictEqual(a.lastSeenMessageId, 'SYS-9')
                assert.strictEqual(a.userId, ADMIN, '建立者 userId 不得被客戶端改寫')
                assert.notStrictEqual(a.timeCreate, '1999-01-01T00:00:00.000+08:00')
                assert.strictEqual(a.isActive, 'y')
                assert.notStrictEqual(a.order, 99)
                assert.strictEqual(a.userIdUpdate, ADMIN2, '被改動之列, 最後修改者為存檔者')
            })
        })
    })


    // ── V14: 並行 —— 比對與寫入間插不進他人寫入 (同鎖) ───────────────────────────────
    describe('V14: 表鎖 —— 比對與寫入間插不進他人寫入', function() {

        it('兩位管理員以同一基準並行存檔, 其一寫入中人為延遲 → 恰一成功, 另一 saveStale (無表鎖則兩者皆成功＝遺失更新)', async function() {
            await withEnv('v14a', async (env) => {
                await seedChannels(env, [{ name: 'p1' }, { name: 'p2' }])
                let A = await loadChannels(env)
                let g = gate()
                let reached = gate()
                let orig = env.woItems.channels.save.bind(env.woItems.channels)
                env.woItems.channels.save = async (data, opt) => {
                    reached.open()
                    await g.promise //A 之寫入停在「比對之後、寫入之前」
                    return orig(data, opt)
                }
                let ra = JSON.parse(JSON.stringify(A.rows)); ra[0].name = 'p1-by-A'
                let rb = JSON.parse(JSON.stringify(A.rows)); rb[1].name = 'p2-by-B'
                let pa = env.pc.saveChannels(ADMIN, ra, { baseline: A.baseline })
                await reached.promise
                let pb = rejKey(() => env.pc.saveChannels(ADMIN2, rb, { baseline: A.baseline }))
                await sleep(100) //B 若未被表鎖擋住, 此時已完成比對與寫入
                g.open()
                await pa
                let kb = await pb
                env.woItems.channels.save = orig
                assert.strictEqual(kb, 'saveStale', 'B 須等 A 寫完後才比對, 故被拒')
                let names = (await env.woItems.channels.select({})).map((r) => r.name).sort()
                assert.deepStrictEqual(names, ['p1-by-A', 'p2'])
            })
        })

        it('單筆 API / 清單 API / 刪除並行: 皆取同一表鎖而序列化 (人為延遲期間之單筆寫入不可插入; 結果等同依序執行)', async function() {
            await withEnv('v14b', async (env) => {
                await seedChannels(env, [{ name: 'q1' }, { name: 'q2' }])
                let A = await loadChannels(env)
                let g = gate()
                let reached = gate()
                let orig = env.woItems.channels.save.bind(env.woItems.channels)
                env.woItems.channels.save = async (data, opt) => {
                    reached.open()
                    await g.promise
                    return orig(data, opt)
                }
                let ra = JSON.parse(JSON.stringify(A.rows)); ra[0].name = 'q1-A'
                let pa = env.pc.saveChannels(ADMIN, ra, { baseline: A.baseline })
                await reached.promise
                let order = []
                let pSingle = env.pc.saveChannel(ADMIN2, { id: A.rows[1].id, description: 'single' }).then(() => order.push('single'))
                let pDel = env.pc.deleteChannel(ADMIN2, A.rows[1].id).then(() => order.push('del'))
                await sleep(100)
                assert.deepStrictEqual(order, [], 'A 持表鎖期間, 單筆寫入與刪除皆須等待')
                g.open()
                await pa
                await Promise.allSettled([pSingle, pDel])
                env.woItems.channels.save = orig
                assert.deepStrictEqual(order, ['single', 'del'], '依取鎖先後序列化')
            })
        })

        it('ack 缺列路徑取表鎖: 成員清單存檔寫入期間, ack 之新增列須等清單存檔完成後才寫入 (不插入、不重複)', async function() {
            await withEnv('v14c', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'v14c' }]))[0]
                await seedMembers(env, ch.id, [{ memberId: 'h1' }])
                let M = await loadMembers(env, ch.id)
                let g = gate()
                let reached = gate()
                let orig = env.woItems.channelMembers.save.bind(env.woItems.channelMembers)
                env.woItems.channelMembers.save = async (data, opt) => {
                    if (data && data.role !== undefined) {
                        reached.open()
                        await g.promise
                    }
                    return orig(data, opt)
                }
                let rows = JSON.parse(JSON.stringify(M.rows)); rows[0].role = 'owner'
                let order = []
                let pList = env.pc.saveChannelMembers(ADMIN, ch.id, rows, { baseline: M.baseline }).then(() => order.push('list'))
                await reached.promise
                let pAck = env.pc.ackChannel(AGENT, ch.id, 'MSG-5').then(() => order.push('ack'))
                await sleep(100)
                assert.deepStrictEqual(order, [], '清單存檔持表鎖期間, ack 缺列路徑須等待')
                g.open()
                await Promise.all([pList, pAck])
                env.woItems.channelMembers.save = orig
                assert.deepStrictEqual(order, ['list', 'ack'])
                let ms = await env.woItems.channelMembers.select({ channelId: ch.id, memberId: AGENT })
                assert.strictEqual(ms.length, 1)
                assert.strictEqual(ms[0].lastSeenMessageId, 'MSG-5')
            })
        })
    })


    // ── V6 / V7 / O1 / O2 / O3: 只改不增、刪除未命中 ─────────────────────────────────
    describe('V6 / V7 (O1、O2、O3): 只改不增與刪除未命中', function() {

        it('V6 / O1: 修改已被刪之列 → errRowNotFound 且不復活 (單筆 API、清單 API 不帶基準; 頻道與成員)', async function() {
            await withEnv('o1', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'o1' }]))[0]
                let m = (await seedMembers(env, ch.id, [{ memberId: 'bob' }]))[0]
                let chSnap = JSON.parse(JSON.stringify(ch))
                let mSnap = JSON.parse(JSON.stringify(m))
                await env.pc.deleteChannelMember(ADMIN2, m.id)
                await env.pc.deleteChannel(ADMIN2, ch.id)
                assert.strictEqual(await rejKey(() => env.pc.saveChannelMember(ADMIN, mSnap)), 'errRowNotFound')
                assert.strictEqual(await rejKey(() => env.pc.saveChannel(ADMIN, chSnap)), 'errRowNotFound')
                assert.strictEqual(await rejKey(() => env.pc.saveChannels(ADMIN, [chSnap])), 'errRowNotFound')
                assert.strictEqual(await rejKey(() => env.pc.saveChannelMembers(ADMIN, ch.id, [mSnap])), 'errChannelNotFound', '頻道已刪 → 不對已刪頻道存成員')
                assert.strictEqual((await env.woItems.channelMembers.select({})).length, 0, '成員列不復活')
                assert.strictEqual((await env.woItems.channels.select({})).length, 0, '頻道列不復活')
            })
        })

        it('V6 (成員, 頻道仍在): 清單 API 不帶基準修改已刪成員 → errRowNotFound, 整次零寫入 (含同批其他可改之列)', async function() {
            await withEnv('o1b', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'o1b' }]))[0]
                let [m1, m2] = await seedMembers(env, ch.id, [{ memberId: 'bob' }, { memberId: 'carol' }])
                await env.pc.deleteChannelMember(ADMIN2, m1.id)
                let before = await snapshot(env.woItems)
                let k = await rejKey(() => env.pc.saveChannelMembers(ADMIN, ch.id, [{ id: m2.id, role: 'owner' }, { id: m1.id, role: 'owner' }]))
                assert.strictEqual(k, 'errRowNotFound')
                assert.deepStrictEqual(await snapshot(env.woItems), before)
            })
        })

        it('V7 / O2: 刪除已不存在之列 → errRowNotFound (單筆 API、清單 API 帶或不帶基準; 頻道與成員)', async function() {
            await withEnv('o2', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'o2' }, { name: 'o2b' }]))[0]
                let m = (await seedMembers(env, ch.id, [{ memberId: 'u' }]))[0]
                let A = await loadChannels(env)
                let M = await loadMembers(env, ch.id)
                await env.pc.deleteChannelMember(ADMIN2, m.id)
                await env.pc.deleteChannels(ADMIN2, [A.rows[1].id])
                assert.strictEqual(await rejKey(() => env.pc.deleteChannelMember(ADMIN, 'no-such-member')), 'errRowNotFound')
                assert.strictEqual(await rejKey(() => env.pc.deleteChannel(ADMIN, 'no-such-channel')), 'errRowNotFound')
                assert.strictEqual(await rejKey(() => env.pc.deleteChannelMember(ADMIN, m.id)), 'errRowNotFound', '已被他人刪除')
                assert.strictEqual(await rejKey(() => env.pc.deleteChannels(ADMIN, [A.rows[1].id])), 'errRowNotFound', '不帶基準')
                assert.strictEqual(await rejKey(() => env.pc.deleteChannels(ADMIN, [A.rows[1].id], { baseline: A.baseline.filter((e) => e[0] === A.rows[1].id) })), 'errRowNotFound', '帶基準 (單列基準, 該列已被刪)')
                assert.strictEqual(await rejKey(() => env.pc.deleteChannelMembers(ADMIN, ch.id, [m.id])), 'errRowNotFound')
                assert.strictEqual(await rejKey(() => env.pc.deleteChannelMembers(ADMIN, ch.id, [m.id], { baseline: M.baseline })), 'errRowNotFound')
                //多列中一列不存在 → 整次零刪除
                let before = await snapshot(env.woItems)
                assert.strictEqual(await rejKey(() => env.pc.deleteChannels(ADMIN, [A.rows[0].id, 'no-such-channel'])), 'errRowNotFound')
                assert.deepStrictEqual(await snapshot(env.woItems), before)
            })
        })

        it('V7 (成員範圍): 以他頻道之成員 id 對本頻道刪除 → errRowNotFound (成員清單刪除之範圍＝該頻道), 他頻道成員不被刪', async function() {
            await withEnv('o2scope', async (env) => {
                let [x, y] = await seedChannels(env, [{ name: 'sx' }, { name: 'sy' }])
                let [mx] = await seedMembers(env, x.id, [{ memberId: 'mx' }])
                let before = await snapshot(env.woItems)
                assert.strictEqual(await rejKey(() => env.pc.deleteChannelMembers(ADMIN, y.id, [mx.id])), 'errRowNotFound')
                assert.strictEqual(await rejKey(() => env.pc.saveChannelMembers(ADMIN, y.id, [{ id: mx.id, role: 'owner' }])), 'errRowNotFound', '以他頻道之成員 id 修改本頻道亦拒收')
                assert.deepStrictEqual(await snapshot(env.woItems), before)
            })
        })

        it('刪除 ids 檢查: 空陣列 / 非陣列 / 含非字串 / 重複 → 拒收且零寫入', async function() {
            await withEnv('delids', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'di' }]))[0]
                let before = await snapshot(env.woItems)
                for (let ids of [[], 'x', null, [1], ['a', 'a'], ['']]) {
                    assert.strictEqual(await rejKey(() => env.pc.deleteChannels(ADMIN, ids)), 'errChannelIdInvalid', JSON.stringify(ids))
                    assert.strictEqual(await rejKey(() => env.pc.deleteChannelMembers(ADMIN, ch.id, ids)), 'errMemberIdInvalid', JSON.stringify(ids))
                }
                assert.deepStrictEqual(await snapshot(env.woItems), before)
            })
        })

        it('O3 轉綠 (縱深; 繞過實體鎖之直接刪除): ack 已讀到成員列、其後該列被直接刪除 → ack 之 save 不產生殘缺列 (autoInsert:false 命中 0 → 改走缺列路徑重建完整列)', async function() {
            await withEnv('o3', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'o3', agentId: AGENT }]))[0]
                let m = (await env.woItems.channelMembers.select({ memberId: AGENT }))[0]
                let g = gate()
                let reached = gate()
                let orig = env.woItems.channelMembers.save.bind(env.woItems.channelMembers)
                env.woItems.channelMembers.save = async (data, opt) => {
                    if (data && data.lastSeenMessageId === 'MSG-9' && !reached.done) { //ack 第一段之 save: 已 select 到列, 寫入前被刪
                        reached.done = true
                        reached.open()
                        await g.promise
                    }
                    return orig(data, opt)
                }
                let pAck = env.pc.ackChannel(AGENT, ch.id, 'MSG-9')
                await reached.promise
                await env.woItems.channelMembers.del({ id: m.id }) //直接刪 (模擬繞過 procCore 實體鎖之刪除; 一般路徑之刪除須等 ack 鎖, 見下一則)
                g.open()
                await pAck
                env.woItems.channelMembers.save = orig
                let rows = await env.woItems.channelMembers.select({ channelId: ch.id })
                for (let r of rows) {
                    assert.ok(r.channelId && r.memberId, `不得有殘缺列 (缺 channelId / memberId): ${JSON.stringify(r)}`)
                }
                assert.strictEqual(rows.filter((r) => r.memberId === AGENT).length, 1)
                assert.strictEqual(rows.find((r) => r.memberId === AGENT).lastSeenMessageId, 'MSG-9')
            })
        })

        it('O3 (實體鎖): ack 持實體鎖寫游標期間, 後台 deleteChannelMember 須等 ack 完成才執行 → 無殘缺列、游標不遺失於刪除前 (先 ack 後刪)', async function() {
            await withEnv('o3c', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'o3c', agentId: AGENT }]))[0]
                let m = (await env.woItems.channelMembers.select({ memberId: AGENT }))[0]
                let g = gate()
                let reached = gate()
                let orig = env.woItems.channelMembers.save.bind(env.woItems.channelMembers)
                env.woItems.channelMembers.save = async (data, opt) => {
                    if (data && data.lastSeenMessageId === 'MSG-9' && !reached.done) {
                        reached.done = true
                        reached.open()
                        await g.promise
                    }
                    return orig(data, opt)
                }
                let pAck = env.pc.ackChannel(AGENT, ch.id, 'MSG-9')
                await reached.promise
                let delDone = false
                let pDel = env.pc.deleteChannelMember(ADMIN, m.id).then(() => {
                    delDone = true
                })
                await sleep(120)
                assert.strictEqual(delDone, false, 'ack 持鎖寫入期間, 刪除不可插入')
                assert.strictEqual((await env.woItems.channelMembers.select({ id: m.id })).length, 1, '刪除尚未執行, 列仍在')
                g.open()
                await pAck
                await pDel
                env.woItems.channelMembers.save = orig
                let rows = await env.woItems.channelMembers.select({ channelId: ch.id })
                for (let r of rows) {
                    assert.ok(r.channelId && r.memberId, `不得有殘缺列: ${JSON.stringify(r)}`)
                }
                assert.strictEqual(rows.filter((r) => r.memberId === AGENT).length, 0, 'ack 完成後該列才被刪, 終態無此成員列')
            })
        })

        it('O3 (頻道亦已刪): ack 缺列路徑於鎖內發現頻道不存在 → errChannelNotFound, 不建成員列', async function() {
            await withEnv('o3b', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'o3b' }]))[0]
                await env.pc.deleteChannel(ADMIN, ch.id)
                assert.strictEqual(await rejKey(() => env.pc.ackChannel(AGENT, ch.id, 'MSG-1')), 'errChannelNotFound')
                assert.strictEqual((await env.woItems.channelMembers.select({})).length, 0)
            })
        })
    })


    // ── O4 / O5 / O6: 資料規則於後端強制、伺服器專有欄不採用客戶端值 ────────────────────────
    describe('O4 / O5 / O6: 資料規則與伺服器專有欄位', function() {

        it('O4 / Q5: (channelId, memberId) 唯一 —— 新增重複、同批重複、改成重複皆拒收 errMemberDuplicate 且零寫入; 單筆 API 亦然', async function() {
            await withEnv('o4', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'o4', agentId: AGENT }]))[0] //已有 agent 成員列
                let h1 = (await seedMembers(env, ch.id, [{ memberId: 'h1' }])).find((r) => r.memberId === 'h1')
                let before = await snapshot(env.woItems)
                assert.strictEqual(await rejKey(() => env.pc.saveChannelMembers(ADMIN, ch.id, [{ memberId: AGENT, memberType: 'agent' }])), 'errMemberDuplicate', '與既有 agent 列重複')
                assert.strictEqual(await rejKey(() => env.pc.saveChannelMembers(ADMIN, ch.id, [{ memberId: 'z' }, { memberId: 'z' }])), 'errMemberDuplicate', '同批重複')
                assert.strictEqual(await rejKey(() => env.pc.saveChannelMembers(ADMIN, ch.id, [{ id: h1.id, memberId: AGENT }])), 'errMemberDuplicate', '改成重複')
                assert.strictEqual(await rejKey(() => env.pc.saveChannelMember(ADMIN, { channelId: ch.id, memberId: 'h1' })), 'errMemberDuplicate', '單筆 API 新增重複')
                assert.deepStrictEqual(await snapshot(env.woItems), before)
                //不同頻道同 memberId 不算重複
                let ch2 = (await seedChannels(env, [{ name: 'o4b' }]))[1] || (await env.woItems.channels.select({ name: 'o4b' }))[0]
                await seedMembers(env, ch2.id, [{ memberId: 'h1' }])
            })
        })

        it('O4 / Q5 (以寫入後之結果驗證): 既有重複列時, 同一次存檔刪掉重複者可存; 仍留重複則拒收; ack 不新增重複列', async function() {
            await withEnv('o4b', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'o4b' }]))[0]
                //直接寫庫造出既有重複 (舊版本遺留): 兩列 memberId='dup'
                let d1 = ds.channelMembers.funNew({ channelId: ch.id, memberId: 'dup', userId: ADMIN })
                let d2 = ds.channelMembers.funNew({ channelId: ch.id, memberId: 'dup', userId: ADMIN })
                await env.woItems.channelMembers.insert([d1, d2])
                let M = await loadMembers(env, ch.id)
                assert.strictEqual(M.rows.length, 2)
                //仍留重複 (只改角色) → 拒收
                let keep = JSON.parse(JSON.stringify(M.rows)); keep[0].role = 'owner'
                assert.strictEqual(await rejKey(() => env.pc.saveChannelMembers(ADMIN, ch.id, keep, { baseline: M.baseline })), 'errMemberDuplicate')
                //刪掉其中一列 → 結果唯一, 可存
                let fixed = JSON.parse(JSON.stringify(M.rows)).slice(0, 1)
                let r = await env.pc.saveChannelMembers(ADMIN, ch.id, fixed, { baseline: M.baseline })
                assert.strictEqual(r.deleted.length, 1)
                assert.strictEqual((await env.woItems.channelMembers.select({ channelId: ch.id, memberId: 'dup' })).length, 1)
                //ack 對已存在列只更新游標, 不新增
                await env.pc.ackChannel('dup', ch.id, 'MSG-3')
                await env.pc.ackChannel('dup', ch.id, 'MSG-4')
                let ms = await env.woItems.channelMembers.select({ channelId: ch.id, memberId: 'dup' })
                assert.strictEqual(ms.length, 1)
                assert.strictEqual(ms[0].lastSeenMessageId, 'MSG-4')
            })
        })

        it('O5 / 原則 4: 後端驗頻道名稱必填且不重複 —— 空 / 重複 / 改成重複皆拒收零寫入 (單筆 API 與清單 API 一致); 對調兩列名稱(結果唯一)可存', async function() {
            await withEnv('o5', async (env) => {
                let [a, b] = await seedChannels(env, [{ name: 'same-a' }, { name: 'same-b' }])
                let before = await snapshot(env.woItems)
                assert.strictEqual(await rejKey(() => env.pc.saveChannel(ADMIN2, { name: 'same-a' })), 'errChannelNameDuplicate')
                assert.strictEqual(await rejKey(() => env.pc.saveChannel(ADMIN2, { name: '' })), 'errChannelNameInvalid')
                assert.strictEqual(await rejKey(() => env.pc.saveChannel(ADMIN2, { description: 'no-name' })), 'errChannelNameInvalid')
                assert.strictEqual(await rejKey(() => env.pc.saveChannel(ADMIN2, { id: b.id, name: 'same-a' })), 'errChannelNameDuplicate')
                assert.strictEqual(await rejKey(() => env.pc.saveChannels(ADMIN2, [{ name: 'n1' }, { name: 'n1' }])), 'errChannelNameDuplicate')
                assert.strictEqual(await rejKey(() => env.pc.saveChannels(ADMIN2, [{ id: a.id, name: '' }])), 'errChannelNameInvalid')
                assert.deepStrictEqual(await snapshot(env.woItems), before)
                //對調名稱: 寫入後之結果唯一
                let A = await loadChannels(env)
                let rows = JSON.parse(JSON.stringify(A.rows)); [rows[0].name, rows[1].name] = [rows[1].name, rows[0].name]
                let r = await env.pc.saveChannels(ADMIN2, rows, { baseline: A.baseline })
                assert.strictEqual(r.modified.length, 2)
            })
        })

        it('O6 轉綠: 單筆與清單存檔皆不採用客戶端之 userId / timeCreate / isActive / order; 新增列之 userId 為操作者', async function() {
            await withEnv('o6', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'o6' }]))[0]
                let before = JSON.parse(JSON.stringify(ch))
                let forged = { userId: 'forged-owner', timeCreate: '1999-01-01T00:00:00.000+08:00', isActive: 'n', order: 99, userIdUpdate: 'forged-updater', timeUpdate: '1999-01-01T00:00:00.000+08:00' }
                await env.pc.saveChannel(ADMIN2, { ...ch, ...forged, description: 'd1' })
                await env.pc.saveChannels(ADMIN2, [{ id: ch.id, ...forged, description: 'd2' }])
                let after = (await env.woItems.channels.select({ id: ch.id }))[0]
                assert.strictEqual(after.description, 'd2')
                assert.strictEqual(after.userId, before.userId)
                assert.strictEqual(after.timeCreate, before.timeCreate)
                assert.strictEqual(after.isActive, 'y')
                assert.strictEqual(after.order, before.order)
                assert.strictEqual(after.userIdUpdate, ADMIN2)
                assert.notStrictEqual(after.timeUpdate, forged.timeUpdate)
                assert.strictEqual((await env.pc.getChannelsList(ADMIN)).length, 1, 'isActive 未被改為 n, 頻道仍在清單')
                //新增列: userId 為操作者, 偽造值不採用
                let r = await env.pc.saveChannels(ADMIN2, [{ name: 'o6-new', ...forged }])
                let n = (await env.woItems.channels.select({ id: r.inserted[0] }))[0]
                assert.strictEqual(n.userId, ADMIN2)
                assert.strictEqual(n.isActive, 'y')
                assert.notStrictEqual(n.timeCreate, forged.timeCreate)
            })
        })

        it('opt 只取 baseline: 客戶端夾帶之其他鍵 (userId、mustExist、keepUserId…) 一律忽略, 不影響寫入 (procOrm 之 opt 只能由伺服端自組)', async function() {
            await withEnv('opt', async (env) => {
                let A0 = await seedChannels(env, [{ name: 'opt-a' }])
                let A = await loadChannels(env)
                let rows = JSON.parse(JSON.stringify(A.rows)); rows[0].description = 'x'
                await env.pc.saveChannels(ADMIN, rows, { baseline: A.baseline, userId: 'forged', mustExist: false, keepUserId: true, autoInsert: true })
                let r = await env.pc.saveChannels(ADMIN, [{ name: 'opt-b' }], { userId: 'forged', keepUserId: true })
                let n = (await env.woItems.channels.select({ id: r.inserted[0] }))[0]
                assert.strictEqual(n.userId, ADMIN)
                assert.strictEqual(A0.length, 1)
            })
        })

        it('成員 channelId 不符參數 → errMemberChannelMismatch 零寫入 (成員不得藉清單搬到他頻道)', async function() {
            await withEnv('mismatch', async (env) => {
                let [x, y] = await seedChannels(env, [{ name: 'mx' }, { name: 'my' }])
                let [m] = await seedMembers(env, x.id, [{ memberId: 'm1' }])
                let before = await snapshot(env.woItems)
                assert.strictEqual(await rejKey(() => env.pc.saveChannelMembers(ADMIN, x.id, [{ id: m.id, channelId: y.id }])), 'errMemberChannelMismatch')
                assert.strictEqual(await rejKey(() => env.pc.saveChannelMembers(ADMIN, x.id, [{ channelId: y.id, memberId: 'n' }])), 'errMemberChannelMismatch')
                assert.deepStrictEqual(await snapshot(env.woItems), before)
            })
        })

        it('清單 API 不帶基準 (外部呼叫): 容許部分欄位、修改只寫帶入欄與稽核欄、新增補預設; 基準模式下未改動之列不蓋稽核欄', async function() {
            await withEnv('ext', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'ext', description: 'keep', levels: 'L1', agentId: AGENT }]))[0]
                await env.pc.saveChannels(ADMIN2, [{ id: ch.id, levels: 'L2' }])
                let a = (await env.woItems.channels.select({ id: ch.id }))[0]
                assert.strictEqual(a.levels, 'L2')
                assert.strictEqual(a.description, 'keep', '未帶之欄位不被清成空')
                assert.strictEqual(a.name, 'ext')
                assert.strictEqual(a.userIdUpdate, ADMIN2)
                //基準模式: 未改動之列 unchanged, 稽核欄不變
                let A = await loadChannels(env)
                let r = await env.pc.saveChannels(ADMIN, JSON.parse(JSON.stringify(A.rows)), { baseline: A.baseline })
                assert.strictEqual(r.unchanged, 1)
                assert.deepStrictEqual(r.modified, [])
                assert.strictEqual((await env.woItems.channels.select({ id: ch.id }))[0].userIdUpdate, ADMIN2)
            })
        })
    })


    // ── O7 / Q2: 刪頻道 ───────────────────────────────────────────────────────────
    describe('O7 / Q2: 刪頻道 —— 成員列連帶刪除、對已刪頻道之操作被拒', function() {

        it('deleteChannel / deleteChannels 連帶刪除該頻道所有成員列 (含 agent 列); 訊息與任務移入封存表 (Q2 已裁示 2026-10-23, 詳見「Q2」節)', async function() {
            await withEnv('o7', async (env) => {
                let [c1, c2] = await seedChannels(env, [{ name: 'c1', agentId: AGENT }, { name: 'c2', agentId: 'agent-2' }])
                await seedMembers(env, c1.id, [{ memberId: 'h1' }, { memberId: 'h2' }])
                await env.pc.postMessage('human-1', c1.id, 'hello', { asTask: true })
                await env.pc.deleteChannel(ADMIN, c1.id)
                assert.strictEqual((await env.woItems.channelMembers.select({ channelId: c1.id })).length, 0, '成員列連帶刪除')
                assert.strictEqual((await env.woItems.channelMembers.select({ channelId: c2.id })).length, 1, '他頻道成員不動')
                //Q2 (使用者 2026-10-23 裁示「移入封存表」): 訊息與任務自熱表移入封存表, 不留孤兒
                assert.strictEqual((await env.woItems.messages.select({ channelId: c1.id })).length, 0, '熱表無殘留訊息')
                assert.strictEqual((await env.woItems.tasks.select({ channelId: c1.id })).length, 0, '熱表無殘留任務')
                assert.strictEqual((await env.woItems.messagesArchive.select({ channelId: c1.id })).length, 1, '訊息在封存表')
                assert.strictEqual((await env.woItems.tasksArchive.select({ channelId: c1.id })).length, 1, '任務在封存表')
                await env.pc.deleteChannels(ADMIN, [c2.id])
                assert.strictEqual((await env.woItems.channelMembers.select({})).length, 0)
            })
        })

        it('postMessage / ackChannel / saveChannelMembers / saveChannelMember 對已刪或不存在之頻道 → errChannelNotFound', async function() {
            await withEnv('o7b', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'gone' }]))[0]
                await env.pc.deleteChannel(ADMIN, ch.id)
                assert.strictEqual(await rejKey(() => env.pc.postMessage('human-1', ch.id, 'to-deleted')), 'errChannelNotFound')
                assert.strictEqual(await rejKey(() => env.pc.postMessage('human-1', ch.id, 'to-deleted', { asTask: true })), 'errChannelNotFound')
                assert.strictEqual(await rejKey(() => env.pc.postMessage('human-1', 'never-existed', 'x')), 'errChannelNotFound')
                assert.strictEqual(await rejKey(() => env.pc.ackChannel(AGENT, ch.id, 'MSG-1')), 'errChannelNotFound')
                assert.strictEqual(await rejKey(() => env.pc.saveChannelMembers(ADMIN, ch.id, [{ memberId: 'x' }])), 'errChannelNotFound')
                assert.strictEqual(await rejKey(() => env.pc.saveChannelMember(ADMIN, { channelId: ch.id, memberId: 'x' })), 'errChannelNotFound')
                assert.strictEqual((await env.woItems.messages.select({})).length, 0)
                assert.strictEqual((await env.woItems.channelMembers.select({})).length, 0)
            })
        })

        it('saveChannels 帶基準刪頻道 (集合差) 亦連帶刪成員列', async function() {
            await withEnv('o7c', async (env) => {
                let [c1, c2] = await seedChannels(env, [{ name: 'k1', agentId: AGENT }, { name: 'k2' }])
                let A = await loadChannels(env)
                let rows = JSON.parse(JSON.stringify(A.rows)).filter((r) => r.id !== c1.id)
                let r = await env.pc.saveChannels(ADMIN, rows, { baseline: A.baseline })
                assert.deepStrictEqual(r.deleted, [c1.id])
                assert.strictEqual((await env.woItems.channelMembers.select({})).length, 0)
                assert.strictEqual((await env.woItems.channels.select({ id: c2.id })).length, 1)
            })
        })
    })


    // ── Q2: 刪頻道 → 訊息與任務移入封存表 (使用者 2026-10-23 裁示「移入封存表」) ──────────────────────────────
    describe('Q2: 刪頻道時該頻道之訊息與任務移入既有封存表 (messagesArchive / tasksArchive); 全有或全無, 與成員連帶刪除同一次操作', function() {

        //seedBusy: 建立「忙碌頻道」(含主責 agent 列 + 1 個人類成員) 與「他頻道」(1 任務 + 1 訊息, 供驗證不受牽連).
        //忙碌頻道: 純文字訊息 2、任務 4 (pending / running / done / error 各 1; 後兩者各有 taskReply) → 訊息共 8 (2 純文字 + 4 任務起源 + 2 回應鏡射)
        async function seedBusy(env) {
            let rs = await seedChannels(env, [{ name: 'busy', agentId: AGENT }, { name: 'other' }])
            let ch = rs.find((c) => c.name === 'busy')
            let other = rs.find((c) => c.name === 'other')
            await seedMembers(env, ch.id, [{ memberId: 'h1' }])
            await env.pc.postMessage('human-1', ch.id, 'plain-1')
            await env.pc.postMessage('human-1', ch.id, 'plain-2')
            let pend = (await env.pc.postMessage('human-1', ch.id, 'req-pending', { asTask: true })).task
            let run = (await env.pc.postMessage('human-1', ch.id, 'req-running', { asTask: true })).task
            let done = (await env.pc.postMessage('human-1', ch.id, 'req-done', { asTask: true })).task
            let err = (await env.pc.postMessage('human-1', ch.id, 'req-error', { asTask: true })).task
            await env.pc.claimTask(AGENT, run.id)
            await env.pc.claimTask(AGENT, done.id)
            await env.pc.respondTask(AGENT, done.id, 'answer-done', 'done')
            await env.pc.claimTask(AGENT, err.id)
            await env.pc.respondTask(AGENT, err.id, 'answer-err', 'error', 'errX')
            await env.pc.postMessage('human-1', other.id, 'other-msg', { asTask: true })
            return { ch, other, ids: { pend: pend.id, run: run.id, done: done.id, err: err.id } }
        }

        //byId: 依 id 排序 (供深度比對)
        let byId = (rs) => rs.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

        const PATHS = ['deleteChannel', 'deleteChannels', 'saveChannels (集合差)']
        for (let i = 0; i < PATHS.length; i++) {
            let pathName = PATHS[i]

            it(`Q2 (${pathName}): 該頻道之訊息與任務 (含進行中) 整列移入封存表 —— 熱表無殘留、封存表列與搬移前完全相同、他頻道不動、統計不計`, async function() {
                await withEnv(`q2-${i}`, async (env) => {
                    let { ch, other, ids } = await seedBusy(env)
                    let preTasks = byId(await env.woItems.tasks.select({ channelId: ch.id }))
                    let preMsgs = byId(await env.woItems.messages.select({ channelId: ch.id }))
                    let preOtherTasks = byId(await env.woItems.tasks.select({ channelId: other.id }))
                    let preOtherMsgs = byId(await env.woItems.messages.select({ channelId: other.id }))
                    assert.strictEqual(preTasks.length, 4, '前置: 4 個任務')
                    assert.strictEqual(preMsgs.length, 8, '前置: 8 則訊息')
                    assert.deepStrictEqual(preTasks.map((t) => t.state).sort(), ['done', 'error', 'pending', 'running'], '前置: 四種狀態')
                    env.infos.length = 0

                    //act: 三種入口
                    if (pathName === 'deleteChannel') {
                        await env.pc.deleteChannel(ADMIN, ch.id)
                    }
                    else if (pathName === 'deleteChannels') {
                        let r = await env.pc.deleteChannels(ADMIN, [ch.id])
                        assert.deepStrictEqual(r.deleted, [ch.id])
                    }
                    else {
                        let A = await loadChannels(env)
                        let rows = JSON.parse(JSON.stringify(A.rows)).filter((r) => r.id !== ch.id)
                        let r = await env.pc.saveChannels(ADMIN, rows, { baseline: A.baseline })
                        assert.deepStrictEqual(r.deleted, [ch.id])
                    }

                    //assert: 頻道與成員已刪; 熱表無殘留 (不留孤兒)
                    assert.strictEqual((await env.woItems.channels.select({ id: ch.id })).length, 0)
                    assert.strictEqual((await env.woItems.channelMembers.select({ channelId: ch.id })).length, 0)
                    assert.strictEqual((await env.woItems.tasks.select({ channelId: ch.id })).length, 0, '熱表不得殘留該頻道之任務')
                    assert.strictEqual((await env.woItems.messages.select({ channelId: ch.id })).length, 0, '熱表不得殘留該頻道之訊息')
                    //封存表: 列與搬移前完全相同 (格式、狀態、稽核欄皆不變; 進行中任務維持原狀態)
                    assert.deepStrictEqual(byId(await env.woItems.tasksArchive.select({ channelId: ch.id })), preTasks, '封存表任務＝搬移前之熱表列')
                    assert.deepStrictEqual(byId(await env.woItems.messagesArchive.select({ channelId: ch.id })), preMsgs, '封存表訊息＝搬移前之熱表列')
                    //他頻道不動 (熱表原樣、封存表無)
                    assert.deepStrictEqual(byId(await env.woItems.tasks.select({ channelId: other.id })), preOtherTasks)
                    assert.deepStrictEqual(byId(await env.woItems.messages.select({ channelId: other.id })), preOtherMsgs)
                    assert.strictEqual((await env.woItems.tasksArchive.select({ channelId: other.id })).length, 0)
                    assert.strictEqual((await env.woItems.messagesArchive.select({ channelId: other.id })).length, 0)

                    //既有查詢介面讀得到 (稽核 / 回顧; 已刪頻道之 id 仍可查)
                    let at = await env.pc.getArchivedTasks(ADMIN, ch.id, 50, 'asc')
                    assert.deepStrictEqual(at.map((t) => t.id), preTasks.map((t) => t.id).sort(), 'getArchivedTasks 讀得到全部 4 個任務')
                    assert.strictEqual((await env.pc.getArchivedMessages(ADMIN, ch.id, 50)).length, 8, 'getArchivedMessages 讀得到全部 8 則訊息')
                    assert.strictEqual(at.find((t) => t.id === ids.run).state, 'running', '進行中任務原樣保留於封存表 (快照)')
                    //熱表查詢介面對已刪頻道為空
                    assert.strictEqual((await env.pc.getTasks(ADMIN, ch.id, 50)).length, 0)
                    assert.strictEqual((await env.pc.getMessages(ADMIN, ch.id, 50)).length, 0)

                    //統計 (N4): 熱表孤兒不再計入 —— 僅餘「他頻道」之 1 頻道 / 1 任務 / 其訊息
                    let st = await env.pc.getStats(ADMIN)
                    assert.strictEqual(st.channels, 1)
                    assert.strictEqual(st.tasks.total, 1)
                    assert.strictEqual(st.messages, preOtherMsgs.length)

                    //審計 log: 記實際搬移筆數
                    let lg = env.infos.find((l) => l.event === 'channelArchived' && l.channelId === ch.id)
                    assert.ok(lg, '應記 channelArchived')
                    assert.strictEqual(lg.tasksMoved, 4)
                    assert.strictEqual(lg.messagesMoved, 8)
                })
            })
        }

        it('Q2: 已搬進封存表之任務不可再被認領 / 回應 / 重置 / 以熱表查詢 (agent 對已刪頻道之任務得 errTaskNotFound); 發訊、已讀仍被拒 errChannelNotFound', async function() {
            await withEnv('q2-after', async (env) => {
                let { ch, ids } = await seedBusy(env)
                await env.pc.deleteChannel(ADMIN, ch.id)
                assert.strictEqual(await rejKey(() => env.pc.claimTask(AGENT, ids.pend)), 'errTaskNotFound')
                assert.strictEqual(await rejKey(() => env.pc.respondTask(AGENT, ids.run, 'late-answer', 'done')), 'errTaskNotFound')
                assert.strictEqual(await rejKey(() => env.pc.resetTask(ADMIN, ids.err)), 'errTaskNotFound')
                assert.strictEqual(await rejKey(() => env.pc.resetTask(ADMIN, ids.run)), 'errTaskNotFound')
                assert.strictEqual(await rejKey(() => env.pc.getTask(ADMIN, ids.done)), 'errTaskNotFound')
                assert.strictEqual(await rejKey(() => env.pc.postMessage('human-1', ch.id, 'to-deleted')), 'errChannelNotFound')
                assert.strictEqual(await rejKey(() => env.pc.ackChannel(AGENT, ch.id, 'MSG-1')), 'errChannelNotFound')
                //被拒者不寫入任何表
                assert.strictEqual((await env.woItems.tasks.select({ channelId: ch.id })).length, 0)
                assert.strictEqual((await env.woItems.messages.select({ channelId: ch.id })).length, 0)
                assert.strictEqual((await env.woItems.tasksArchive.select({ channelId: ch.id, state: 'running' })).length, 1, '封存表之 running 任務維持原狀 (未被 respondTask 改寫)')
            })
        })

        it('Q2: 空頻道 (無任務、無訊息) 刪除不多寫入、不報錯; 封存表仍空', async function() {
            await withEnv('q2-empty', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'empty' }]))[0]
                let f = installFaults(env.woItems)
                try {
                    f.arm(99)
                    await env.pc.deleteChannel(ADMIN, ch.id)
                    f.disarm()
                    assert.deepStrictEqual(f.st.calls, ['channels.del'], '空頻道只刪頻道列')
                }
                finally {
                    f.restore()
                }
                assert.strictEqual((await env.woItems.tasksArchive.select({})).length, 0)
                assert.strictEqual((await env.woItems.messagesArchive.select({})).length, 0)
            })
        })

        it('Q2 補償 (全有或全無): 搬移過程任一次寫入 (第 1～13 次; 含前 / 已生效後失敗) 失敗 → 補償後熱表與封存表與刪除前完全相同, reject saveRolledBack, 記 log; 無故障則成功', async function() {
            await withEnv('q2-rb', async (env) => {
                let { ch } = await seedBusy(env)
                let before = await snapshot(env.woItems)
                let f = installFaults(env.woItems)
                try {
                    for (let afterWrite of [false, true]) {
                        for (let k = 1; k <= 13; k++) {
                            env.logs.length = 0
                            f.arm(k, false, afterWrite)
                            let key = await rejKey(() => env.pc.deleteChannels(ADMIN, [ch.id]))
                            f.disarm()
                            assert.strictEqual(key, 'saveRolledBack', `第 ${k} 次寫入失敗 (afterWrite=${afterWrite})`)
                            assert.deepStrictEqual(await snapshot(env.woItems), before, `第 ${k} 次失敗 (afterWrite=${afterWrite}) 後應完全還原 (含封存表)`)
                            assert.ok(env.logs.some((l) => l.event === 'deleteChannels' && l.err === 'saveRolledBack'), '補償成功亦記 log')
                        }
                    }
                    //第 14 次以後無寫入可失敗 → 成功 (確認 13 為全部寫入次數: 4 任務 × (冷表+熱表) + 訊息 (冷表+熱表) + 2 成員列 + 1 頻道列)
                    f.arm(14)
                    await env.pc.deleteChannels(ADMIN, [ch.id])
                    f.disarm()
                    assert.strictEqual(f.st.n, 13)
                }
                finally {
                    f.restore()
                }
                assert.strictEqual((await env.woItems.tasksArchive.select({ channelId: ch.id })).length, 4)
                assert.strictEqual((await env.woItems.tasks.select({ channelId: ch.id })).length, 0)
            })
        })

        it('Q2 補償: 失敗後補償亦失敗 → saveWriteFail 並記 log (不假裝已還原); 單筆 API 與清單存檔 (集合差) 之補償範圍相同', async function() {
            await withEnv('q2-rb2', async (env) => {
                let { ch } = await seedBusy(env)
                let f = installFaults(env.woItems)
                try {
                    env.logs.length = 0
                    f.arm(10, true) //第 10 次 (訊息熱表整批刪除) 失敗, 其後所有寫入 (含補償) 皆失敗
                    let key = await rejKey(() => env.pc.deleteChannel(ADMIN, ch.id))
                    f.disarm()
                    assert.strictEqual(key, 'saveWriteFail')
                    assert.ok(env.logs.some((l) => l.err === 'saveWriteFail'), '補償失敗須記 log')
                    assert.ok(env.logs.some((l) => /rollback-fail/.test(l.event)), '逐步補償失敗亦記 log')
                }
                finally {
                    f.restore()
                }
            })
            await withEnv('q2-rb3', async (env) => {
                let { ch } = await seedBusy(env)
                let A = await loadChannels(env)
                let rows = JSON.parse(JSON.stringify(A.rows)).filter((r) => r.id !== ch.id)
                let before = await snapshot(env.woItems)
                let f = installFaults(env.woItems)
                try {
                    for (let k of [3, 9, 12, 13]) {
                        f.arm(k)
                        assert.strictEqual(await rejKey(() => env.pc.saveChannels(ADMIN, rows, { baseline: A.baseline })), 'saveRolledBack', `第 ${k} 次`)
                        f.disarm()
                        assert.deepStrictEqual(await snapshot(env.woItems), before, `saveChannels 第 ${k} 次失敗後完全還原`)
                    }
                }
                finally {
                    f.restore()
                }
            })
        })

        it('Q2 交錯: respondTask 進行中 (持 task:<id> 鎖, taskReply 寫入停住) 刪頻道須等待該任務鎖; 兩者皆完成後, 已完成之任務與其 taskReply 完整在封存表 (不複製到 running 前像, 熱表無殘留)', async function() {
            await withEnv('q2-resp', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'q2r' }]))[0]
                let t = (await env.pc.postMessage('human-1', ch.id, 'req', { asTask: true })).task
                await env.pc.claimTask(AGENT, t.id)
                let p = pauseOnce(env, 'messages', 'insert')
                let pResp = env.pc.respondTask(AGENT, t.id, 'final-answer', 'done')
                await p.reached
                let done = false
                let pDel = env.pc.deleteChannel(ADMIN, ch.id).then(() => {
                    done = true
                })
                await sleep(150)
                assert.strictEqual(done, false, 'respondTask 持任務鎖期間, 刪頻道 (搬該任務) 須等待')
                p.release()
                let rt = await pResp
                await pDel
                p.restore()
                assert.strictEqual(rt.state, 'done', '進行中之 respondTask 先完成')
                assert.strictEqual((await env.woItems.tasks.select({ channelId: ch.id })).length, 0)
                assert.strictEqual((await env.woItems.messages.select({ channelId: ch.id })).length, 0)
                let at = await env.woItems.tasksArchive.select({ id: t.id })
                assert.strictEqual(at.length, 1)
                assert.strictEqual(at[0].state, 'done', '封存表為 respondTask 完成後之終態 (非 running 前像)')
                assert.strictEqual(at[0].result, 'final-answer')
                let reply = (await env.woItems.messagesArchive.select({ channelId: ch.id })).filter((m) => m.kind === 'taskReply')
                assert.strictEqual(reply.length, 1, 'taskReply 隨頻道移入封存表')
                assert.strictEqual(at[0].resultMessageId, reply[0].id)
            })
        })

        it('Q2 交錯: 刪頻道進行中 (任務已搬走, 停在搬訊息前) respondTask / claimTask / resetTask 皆得 errTaskNotFound, 不新增 taskReply 於熱表', async function() {
            await withEnv('q2-mid', async (env) => {
                let { ch, ids } = await seedBusy(env)
                let p = pauseOnce(env, 'messages', 'select', (q) => q && q.channelId === ch.id) //opMoveMessages 讀該頻道訊息之前停住 (任務已全搬完)
                let pDel = env.pc.deleteChannel(ADMIN, ch.id)
                await p.reached
                assert.strictEqual(await rejKey(() => env.pc.respondTask(AGENT, ids.run, 'x', 'done')), 'errTaskNotFound')
                assert.strictEqual(await rejKey(() => env.pc.claimTask(AGENT, ids.pend)), 'errTaskNotFound')
                assert.strictEqual(await rejKey(() => env.pc.resetTask(ADMIN, ids.err)), 'errTaskNotFound')
                p.release()
                await pDel
                p.restore()
                assert.strictEqual((await env.woItems.messages.select({ channelId: ch.id })).length, 0, '熱表不得因搬移期間之回應而殘留訊息')
                assert.strictEqual((await env.woItems.messagesArchive.select({ channelId: ch.id })).length, 8)
            })
        })

        it('Q2 與封存掃描: 任務已被 archiveSweep 搬走 → 刪頻道略過它 (封存表不重複、不報錯); 掃描與刪頻道並行 (60 個過齡任務 + 其訊息) 後每個任務 / 訊息恰在封存表一份、熱表無殘留', async function() {
            await withEnv('q2-sweep', async (env) => {
                const OLD = '2020-01-01T00:00:00.000+08:00'
                let seedOld = async (ch, id) => {
                    let t = ds.tasks.funNew({ channelId: ch.id, title: `t-${id}`, payload: 'p', state: 'error', userId: ADMIN })
                    t.id = id
                    t.timeDone = OLD
                    t.errorKey = 'errX'
                    await env.woItems.tasks.insert(t)
                    let m = ds.messages.funNew({ channelId: ch.id, senderId: ADMIN, senderType: 'human', kind: 'task', content: `m-${id}`, taskId: id, userId: ADMIN })
                    m.id = `m-${id}`
                    m.timeCreate = OLD
                    await env.woItems.messages.insert(m)
                }
                let ch = (await seedChannels(env, [{ name: 'q2s' }]))[0]
                //(a) 確定性: 一個任務先被掃描搬走, 另一個仍在熱表
                await seedOld(ch, 'T-A')
                await seedOld(ch, 'T-B')
                await env.woItems.tasks.save({ id: 'T-B', state: 'running', timeDone: '' }, { autoInsert: false }) //T-B 非終態: 掃描不搬
                let r = await env.pc.archiveSweep(30)
                assert.strictEqual(r.tasksMoved, 1)
                await env.pc.deleteChannel(ADMIN, ch.id)
                assert.deepStrictEqual((await env.woItems.tasksArchive.select({ channelId: ch.id })).map((t) => t.id).sort(), ['T-A', 'T-B'])
                assert.strictEqual((await env.woItems.tasks.select({ channelId: ch.id })).length, 0)
                assert.strictEqual((await env.woItems.messages.select({ channelId: ch.id })).length, 0)
                assert.strictEqual((await env.woItems.messagesArchive.select({ channelId: ch.id })).length, 2)

                //(b) 壓力: 掃描與刪頻道並行
                let ch2 = (await seedChannels(env, [{ name: 'q2s2' }])).find((c) => c.name === 'q2s2')
                let ids = []
                for (let i = 0; i < 60; i++) {
                    ids.push(`P-${String(i).padStart(3, '0')}`)
                    await seedOld(ch2, ids[i])
                }
                await Promise.all([env.pc.archiveSweep(30), env.pc.deleteChannel(ADMIN, ch2.id)])
                assert.strictEqual((await env.woItems.tasks.select({ channelId: ch2.id })).length, 0, '熱表無殘留任務')
                assert.strictEqual((await env.woItems.messages.select({ channelId: ch2.id })).length, 0, '熱表無殘留訊息')
                let at = (await env.woItems.tasksArchive.select({ channelId: ch2.id })).map((t) => t.id).sort()
                assert.deepStrictEqual(at, ids, '60 個任務各在封存表一份 (不遺失、不重複)')
                assert.strictEqual((await env.woItems.messagesArchive.select({ channelId: ch2.id })).length, 60)
            })
        })

        it('Q2 大量: 300 則訊息 + 40 個任務之頻道刪除成功 (整批搬移), 全數在封存表, 熱表無殘留', async function() {
            await withEnv('q2-bulk', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'bulk' }]))[0]
                for (let i = 0; i < 300; i++) {
                    await env.pc.postMessage('human-1', ch.id, `m-${i}`, { asTask: i < 40 })
                }
                assert.strictEqual((await env.woItems.messages.select({ channelId: ch.id })).length, 300)
                await env.pc.deleteChannel(ADMIN, ch.id)
                assert.strictEqual((await env.woItems.messages.select({ channelId: ch.id })).length, 0)
                assert.strictEqual((await env.woItems.tasks.select({ channelId: ch.id })).length, 0)
                assert.strictEqual((await env.woItems.messagesArchive.select({ channelId: ch.id })).length, 300)
                assert.strictEqual((await env.woItems.tasksArchive.select({ channelId: ch.id })).length, 40)
            })
        })

        it('Q2 封存表寫入回 ok:0 (ORM 對單筆失敗不 reject) → 視為失敗: 不刪熱表 (不遺失資料)、整次補償 saveRolledBack, 庫內完全還原 —— 任務冷表與訊息冷表各一輪', async function() {
            await withEnv('q2-ok0', async (env) => {
                let { ch } = await seedBusy(env)
                let before = await snapshot(env.woItems)
                for (let tab of ['tasksArchive', 'messagesArchive']) {
                    let orig = env.woItems[tab].save
                    //任務冷表: 單筆全 ok:0; 訊息冷表: 整批中第 1 筆 ok:1、其餘 ok:0 (混合結果, 批次部分生效)
                    env.woItems[tab].save = async (data) => (Array.isArray(data) ? data : [data]).map((_, i) => ({ n: 1, nInserted: 0, nModified: 0, ok: (tab === 'messagesArchive' && i === 0) ? 1 : 0, err: 'single-fail' }))
                    let key = await rejKey(() => env.pc.deleteChannel(ADMIN, ch.id))
                    env.woItems[tab].save = orig
                    assert.strictEqual(key, 'saveRolledBack', `${tab}.save 回 ok:0`)
                    assert.deepStrictEqual(await snapshot(env.woItems), before, `${tab}.save 回 ok:0 後應完全還原 (熱表不得被刪)`)
                }
            })
        })

        it('Q2 熱表刪除回 ok:0 / 熱表刪除未命中 (任務於鎖內已確認存在, 未命中代表鎖紀律被破壞) → 視為失敗並補償, 不留矛盾 (冷熱並存)', async function() {
            await withEnv('q2-del0', async (env) => {
                let { ch } = await seedBusy(env)
                let before = await snapshot(env.woItems)
                let orig = env.woItems.tasks.del
                //兩種回傳: 命中 0 (ok:1, n:0) 與單筆失敗 (ok:0)
                for (let res of [{ n: 0, nDeleted: 0, ok: 1 }, { n: 1, nDeleted: 0, ok: 0, err: 'single-fail' }]) {
                    env.woItems.tasks.del = async (q) => (Array.isArray(q) ? q : [q]).map(() => ({ ...res }))
                    let key = await rejKey(() => env.pc.deleteChannel(ADMIN, ch.id))
                    env.woItems.tasks.del = orig
                    assert.strictEqual(key, 'saveRolledBack', JSON.stringify(res))
                    assert.deepStrictEqual(await snapshot(env.woItems), before, `補償後完全還原 (封存表之複本撤回): ${JSON.stringify(res)}`)
                }
            })
        })

        it('Q2 頻道列最後刪: 搬移中途硬失敗且補償亦失敗 (saveWriteFail, 行程崩潰之等價) → 頻道列仍在 (不留「頻道已刪而訊息 / 任務仍在熱表」之孤兒); 故障排除後重試補完, 封存表不重複、熱表無殘留', async function() {
            await withEnv('q2-last', async (env) => {
                let { ch } = await seedBusy(env)
                let f = installFaults(env.woItems)
                try {
                    f.arm(3, true) //第 3 次寫入 (第 2 個任務之冷表寫入) 失敗, 其後所有寫入 (含補償) 皆失敗 → 停在半途
                    assert.strictEqual(await rejKey(() => env.pc.deleteChannel(ADMIN, ch.id)), 'saveWriteFail')
                    f.disarm()
                }
                finally {
                    f.restore()
                }
                assert.strictEqual((await env.woItems.channels.select({ id: ch.id })).length, 1, '半途中斷時頻道列仍在 (頻道列最後刪)')
                //重試補完
                await env.pc.deleteChannel(ADMIN, ch.id)
                assert.strictEqual((await env.woItems.tasks.select({ channelId: ch.id })).length, 0)
                assert.strictEqual((await env.woItems.messages.select({ channelId: ch.id })).length, 0)
                assert.strictEqual((await env.woItems.tasksArchive.select({ channelId: ch.id })).length, 4, '4 個任務各在封存表一份')
                assert.strictEqual((await env.woItems.messagesArchive.select({ channelId: ch.id })).length, 8)
                assert.strictEqual((await env.woItems.channels.select({ id: ch.id })).length, 0)
            })
        })

        it('Q2 多頻道頻道列最後刪 (外審 sol#5): deleteChannels([A, B]) 搬到 B 時中斷 (硬失敗且補償亦失敗) → A、B 之頻道列皆仍在 (A 之引用已搬、B 之引用在熱表); 原請求重送即補完, 封存表不重複、熱表無殘留', async function() {
            await withEnv('q2-multi', async (env) => {
                let [A, B] = await seedChannels(env, [{ name: 'mA' }, { name: 'mB' }])
                for (let c of [A, B]) {
                    await env.pc.postMessage('human-1', c.id, `task-of-${c.name}`, { asTask: true })
                }
                let f = installFaults(env.woItems)
                try {
                    f.arm(6, true) //A 之搬移 4 次寫入 (任務 2 + 訊息 2) 完成後, B 之第 2 次寫入 (任務之熱表刪除) 失敗, 其後所有寫入 (含補償) 皆失敗; 若頻道列隨各頻道搬移後即刪, 第 5 次寫入即刪掉 A 之頻道列
                    assert.strictEqual(await rejKey(() => env.pc.deleteChannels(ADMIN, [A.id, B.id])), 'saveWriteFail')
                    f.disarm()
                }
                finally {
                    f.restore()
                }
                assert.strictEqual((await env.woItems.channels.select({ id: A.id })).length, 1, 'A 之頻道列仍在')
                assert.strictEqual((await env.woItems.channels.select({ id: B.id })).length, 1, 'B 之頻道列仍在')
                assert.strictEqual((await env.woItems.tasksArchive.select({ channelId: A.id })).length, 1, 'A 之任務已搬')
                assert.strictEqual((await env.woItems.tasks.select({ channelId: B.id })).length, 1, 'B 之任務仍在熱表 (冷表已寫、熱表刪除失敗: 冷熱並存之中間態)')
                //原請求 (同一組 ids) 重送即補完
                let r = await env.pc.deleteChannels(ADMIN, [A.id, B.id])
                assert.deepStrictEqual(r.deleted.sort(), [A.id, B.id].sort())
                for (let c of [A, B]) {
                    assert.strictEqual((await env.woItems.tasks.select({ channelId: c.id })).length, 0)
                    assert.strictEqual((await env.woItems.messages.select({ channelId: c.id })).length, 0)
                    assert.strictEqual((await env.woItems.tasksArchive.select({ channelId: c.id })).length, 1, '封存表不重複')
                    assert.strictEqual((await env.woItems.messagesArchive.select({ channelId: c.id })).length, 1)
                    assert.strictEqual((await env.woItems.channels.select({ id: c.id })).length, 0)
                }
            })
        })

        it('Q2 補償不刪「搬移前冷表原有」之列 (外審 sol#3): 中斷後重試遇冷熱並存之殘留, 重試再失敗 → 補償後庫內與重試前完全相同 (冷表原有列保留)', async function() {
            await withEnv('q2-preexist', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'pre' }]))[0]
                await env.pc.postMessage('human-1', ch.id, 'm1', { asTask: true })
                await env.pc.postMessage('human-1', ch.id, 'm2')
                //模擬先前行程於「冷表已寫、熱表尚未刪」中斷: 任務與訊息在冷熱兩表並存
                for (let t of await env.woItems.tasks.select({ channelId: ch.id })) {
                    await env.woItems.tasksArchive.save(t)
                }
                await env.woItems.messagesArchive.save(await env.woItems.messages.select({ channelId: ch.id }))
                let before = await snapshot(env.woItems)
                assert.strictEqual(before.tasksArchive.length, 1)
                assert.strictEqual(before.messagesArchive.length, 2)
                let f = installFaults(env.woItems)
                try {
                    for (let k = 1; k <= 5; k++) { //任務 2 + 訊息 2 + 頻道列 1
                        f.arm(k)
                        assert.strictEqual(await rejKey(() => env.pc.deleteChannel(ADMIN, ch.id)), 'saveRolledBack', `第 ${k} 次`)
                        f.disarm()
                        assert.deepStrictEqual(await snapshot(env.woItems), before, `第 ${k} 次失敗後: 冷表原有列須保留、熱表還原`)
                    }
                }
                finally {
                    f.restore()
                }
                //故障排除後重試成功: 每個任務與訊息各在冷表一份、熱表無
                await env.pc.deleteChannel(ADMIN, ch.id)
                assert.strictEqual((await env.woItems.tasksArchive.select({ channelId: ch.id })).length, 1)
                assert.strictEqual((await env.woItems.messagesArchive.select({ channelId: ch.id })).length, 2)
                assert.strictEqual((await env.woItems.tasks.select({ channelId: ch.id })).length, 0)
                assert.strictEqual((await env.woItems.messages.select({ channelId: ch.id })).length, 0)
            })
        })

        //外審 sol#1 / #2: 補償 (補回熱表 → 刪冷表複本) 與封存掃描交錯. 於補償之「刪冷表複本」前以閘門停住, 此時熱表已補回、冷表複本尚在; 掃描於此時啟動:
        //補償與搬移對稱地持鎖 (任務 task:<id>、訊息 msgarch:<channelId>) → 掃描須等補償完成才搬 (終態: 任務 / 訊息恰在一處); 補償若不持鎖則掃描先搬走, 其後補償刪掉冷表複本 → 兩表皆無
        const OLD = '2020-01-01T00:00:00.000+08:00'
        for (let kind of ['task', 'message']) {
            it(`Q2 補償 × 封存掃描 (${kind === 'task' ? '任務, task:<id> 鎖' : '訊息, msgarch:<頻道> 鎖'}): 刪頻道失敗之補償進行中掃描啟動 → 過齡${kind === 'task' ? '任務' : '訊息'}恰在冷熱兩表之一處 (不兩表皆無)`, async function() {
                await withEnv(`q2-undo-sweep-${kind}`, async (env) => {
                    let ch = (await seedChannels(env, [{ name: `q2u-${kind}` }]))[0]
                    if (kind === 'task') {
                        let t = ds.tasks.funNew({ channelId: ch.id, title: 't', payload: 'p', state: 'error', userId: ADMIN })
                        t.id = 'T-OLD'
                        t.timeDone = OLD
                        t.errorKey = 'errX'
                        await env.woItems.tasks.insert(t)
                    }
                    else {
                        let m = ds.messages.funNew({ channelId: ch.id, senderId: ADMIN, senderType: 'human', kind: 'text', content: 'old-msg', userId: ADMIN })
                        m.id = 'M-OLD'
                        m.timeCreate = OLD
                        await env.woItems.messages.insert(m)
                    }
                    let tabHot = kind === 'task' ? 'tasks' : 'messages'
                    let tabCold = kind === 'task' ? 'tasksArchive' : 'messagesArchive'
                    let f = installFaults(env.woItems)
                    let p = null
                    try {
                        f.arm(3) //寫入: 1 冷表寫入、2 熱表刪除、3 頻道列刪除 (失敗) → 補償
                        p = pauseOnce(env, tabCold, 'del') //補償之冷表複本刪除 (本流程唯一之 del 呼叫) 前停住
                        let pDel = rejKey(() => env.pc.deleteChannel(ADMIN, ch.id))
                        await p.reached
                        assert.strictEqual((await env.woItems[tabHot].select({ channelId: ch.id })).length, 1, '前置: 此刻熱表已補回')
                        assert.strictEqual((await env.woItems[tabCold].select({ channelId: ch.id })).length, 1, '前置: 此刻冷表複本尚在')
                        let pSweep = env.pc.archiveSweep(30)
                        await sleep(200)
                        p.release()
                        assert.strictEqual(await pDel, 'saveRolledBack')
                        await pSweep
                    }
                    finally {
                        if (p) { p.restore() }
                        f.restore()
                    }
                    let nHot = (await env.woItems[tabHot].select({ channelId: ch.id })).length
                    let nCold = (await env.woItems[tabCold].select({ channelId: ch.id })).length
                    assert.strictEqual(nHot + nCold, 1, `${kind} 應恰在冷熱兩表之一處 (熱 ${nHot} / 冷 ${nCold}); 兩表皆無 = 資料遺失`)
                    assert.strictEqual((await env.woItems.channels.select({ id: ch.id })).length, 1, '頻道列已補償還原')
                })
            })
        }

        it('Q2 log 之 messagesMoved 為實際搬移筆數 (外審 sol#6): 封存掃描正持 msgarch 鎖搬該過齡訊息時刪頻道須等待, 之後該訊息已在冷表, 不重複計入; 冷表恰一份', async function() {
            await withEnv('q2-count', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'q2n' }]))[0]
                let m = ds.messages.funNew({ channelId: ch.id, senderId: ADMIN, senderType: 'human', kind: 'text', content: 'old-msg', userId: ADMIN })
                m.id = 'M-OLD'
                m.timeCreate = OLD
                await env.woItems.messages.insert(m)
                let p = pauseOnce(env, 'messagesArchive', 'save') //掃描之冷表寫入前停住 (持 msgarch 鎖; 熱表仍有該訊息)
                let pSweep = env.pc.archiveSweep(30)
                await p.reached
                env.infos.length = 0
                let pDel = env.pc.deleteChannel(ADMIN, ch.id)
                await sleep(200)
                p.release()
                await pSweep
                await pDel
                p.restore()
                let lg = env.infos.find((l) => l.event === 'channelArchived' && l.channelId === ch.id)
                assert.ok(lg)
                assert.strictEqual(lg.messagesMoved, 0, '該訊息已由掃描搬走, 刪頻道實際搬移 0 筆 (無鎖則讀到尚在熱表之該訊息而重複計為 1)')
                assert.strictEqual((await env.woItems.messagesArchive.select({ channelId: ch.id })).length, 1)
                assert.strictEqual((await env.woItems.messages.select({ channelId: ch.id })).length, 0)
            })
        })

        it('Q2 交錯: claimTask 進行中 (持 task:<id> 鎖, 任務狀態寫入停住) 刪頻道須等待; 完成後封存表為認領後之 running (不複製到 pending 前像), 熱表無殘留', async function() {
            await withEnv('q2-claim', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'q2c' }]))[0]
                let t = (await env.pc.postMessage('human-1', ch.id, 'req', { asTask: true })).task
                let p = pauseOnce(env, 'tasks', 'save')
                let pClaim = env.pc.claimTask(AGENT, t.id)
                await p.reached
                let done = false
                let pDel = env.pc.deleteChannel(ADMIN, ch.id).then(() => {
                    done = true
                })
                await sleep(150)
                assert.strictEqual(done, false, 'claimTask 持任務鎖期間, 刪頻道須等待')
                p.release()
                let ct = await pClaim
                await pDel
                p.restore()
                assert.strictEqual(ct.state, 'running')
                assert.strictEqual((await env.woItems.tasks.select({ channelId: ch.id })).length, 0)
                let at = await env.woItems.tasksArchive.select({ id: t.id })
                assert.strictEqual(at.length, 1)
                assert.strictEqual(at[0].state, 'running', '封存表為認領完成後之狀態')
                assert.strictEqual(at[0].assigneeId, AGENT)
            })
        })

        it('Q2 無條件整列搬移: 熱表中 isActive 為 n 之訊息與任務 (讀取介面不顯示) 亦隨頻道移入封存表, 不留孤兒', async function() {
            await withEnv('q2-inactive', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'q2i' }]))[0]
                await env.pc.postMessage('human-1', ch.id, 'visible', { asTask: true })
                let t = ds.tasks.funNew({ channelId: ch.id, title: 'hidden-task', payload: 'p', state: 'done', userId: ADMIN })
                t.isActive = 'n'
                await env.woItems.tasks.insert(t)
                let m = ds.messages.funNew({ channelId: ch.id, senderId: ADMIN, senderType: 'human', kind: 'text', content: 'hidden-msg', userId: ADMIN })
                m.isActive = 'n'
                await env.woItems.messages.insert(m)
                assert.strictEqual((await env.woItems.tasks.select({ channelId: ch.id })).length, 2)
                await env.pc.deleteChannel(ADMIN, ch.id)
                assert.strictEqual((await env.woItems.tasks.select({ channelId: ch.id })).length, 0, '含 isActive n 之任務不殘留')
                assert.strictEqual((await env.woItems.messages.select({ channelId: ch.id })).length, 0, '含 isActive n 之訊息不殘留')
                assert.strictEqual((await env.woItems.tasksArchive.select({ channelId: ch.id })).length, 2)
                assert.strictEqual((await env.woItems.messagesArchive.select({ channelId: ch.id })).length, 2)
            })
        })

        it('Q2 重試補完: 中斷後 (任務已搬走一部分、頻道仍在) 再刪一次 → 補完, 封存表不重複', async function() {
            await withEnv('q2-resume', async (env) => {
                let { ch, ids } = await seedBusy(env)
                //模擬行程於搬移中途中斷: 手動搬走 2 個任務 (先冷表、再刪熱表), 頻道仍在
                for (let id of [ids.pend, ids.done]) {
                    let t = (await env.woItems.tasks.select({ id }))[0]
                    await env.woItems.tasksArchive.save(t)
                    await env.woItems.tasks.del({ id })
                }
                await env.pc.deleteChannel(ADMIN, ch.id)
                assert.strictEqual((await env.woItems.tasks.select({ channelId: ch.id })).length, 0)
                assert.strictEqual((await env.woItems.tasksArchive.select({ channelId: ch.id })).length, 4, '4 個任務各在封存表一份')
                assert.strictEqual((await env.woItems.messagesArchive.select({ channelId: ch.id })).length, 8)
            })
        })
    })


    // ── 主責 agent 成員列 ──────────────────────────────────────────────────────────
    describe('主責 agent 成員列 (D7): 同一次呼叫、同一表鎖內補建', function() {

        it('新增 / 修改 agentId 的頻道補建 agent 成員列 (memberType=agent); 已有則不重複; 清單內未改動之列不補', async function() {
            await withEnv('agent', async (env) => {
                let r = await env.pc.saveChannels(ADMIN, [{ name: 'g1', agentId: AGENT }, { name: 'g2' }])
                let g1 = r.rows.find((c) => c.name === 'g1')
                let g2 = r.rows.find((c) => c.name === 'g2')
                let ms = await env.woItems.channelMembers.select({ channelId: g1.id })
                assert.strictEqual(ms.length, 1)
                assert.strictEqual(ms[0].memberType, 'agent')
                assert.strictEqual(ms[0].memberId, AGENT)
                //修改 g2 設 agentId
                await env.pc.saveChannel(ADMIN, { id: g2.id, agentId: 'agent-2' })
                assert.strictEqual((await env.woItems.channelMembers.select({ channelId: g2.id, memberId: 'agent-2' })).length, 1)
                //再存一次同 agentId: 不重複
                await env.pc.saveChannel(ADMIN2, { id: g2.id, agentId: 'agent-2' })
                assert.strictEqual((await env.woItems.channelMembers.select({ channelId: g2.id, memberId: 'agent-2' })).length, 1)
            })
        })
    })


    // ── Q3: 寫入中途之 ORM 硬失敗 —— 補償還原 ────────────────────────────────────────
    describe('Q3: 寫入中途硬失敗 (非競爭) —— 依序補償還原', function() {

        //頻道清單: 新增 c4(含 agent) + 修改 c1、c3 + 刪除 c2 (連帶 agent 成員列) → 6 次寫入
        async function setupChannels(env) {
            await env.pc.saveChannels(ADMIN, [{ name: 'c1' }, { name: 'c2', agentId: AGENT }, { name: 'c3' }])
            let A = await loadChannels(env)
            let rows = JSON.parse(JSON.stringify(A.rows))
            rows.find((r) => r.name === 'c1').name = 'c1x'
            rows.find((r) => r.name === 'c3').description = 'd3'
            let del = rows.find((r) => r.name === 'c2')
            rows = rows.filter((r) => r !== del)
            rows.push({ name: 'c4', agentId: 'agent-4' })
            return { A, rows }
        }

        it('saveChannels: 任一次寫入 (第 1～6 次) 失敗 → 補償後庫內與存檔前完全相同, reject saveRolledBack, 記 log; 無故障則成功', async function() {
            await withEnv('q3a', async (env) => {
                let { A, rows } = await setupChannels(env)
                let before = await snapshot(env.woItems)
                let f = installFaults(env.woItems)
                try {
                    for (let k = 1; k <= 6; k++) {
                        env.logs.length = 0
                        f.arm(k)
                        let key = await rejKey(() => env.pc.saveChannels(ADMIN, rows, { baseline: A.baseline }))
                        f.disarm()
                        assert.strictEqual(key, 'saveRolledBack', `第 ${k} 次寫入失敗`)
                        assert.deepStrictEqual(await snapshot(env.woItems), before, `第 ${k} 次寫入失敗後應完全還原`)
                        assert.ok(env.logs.some((l) => l.event === 'saveChannels' && l.err === 'saveRolledBack'), '補償成功亦記 log')
                    }
                    //第 7 次以後無寫入可失敗 → 成功 (確認 6 為全部寫入次數)
                    f.arm(7)
                    let r = await env.pc.saveChannels(ADMIN, rows, { baseline: A.baseline })
                    f.disarm()
                    assert.strictEqual(r.inserted.length, 1)
                    assert.strictEqual(r.modified.length, 2)
                    assert.strictEqual(r.deleted.length, 1)
                    assert.strictEqual(f.st.n, 6, '共 6 次寫入 (1 新增頻道 + 2 修改 + 1 補 agent 成員 + 1 刪成員 + 1 刪頻道)')
                }
                finally {
                    f.restore()
                }
            })
        })

        it('單次寫入「已生效才失敗」(呼叫部分生效後拋錯) → 補償須含失敗中那一步, 庫內仍完全還原 (第 1～6 次各一)', async function() {
            await withEnv('q3after', async (env) => {
                let { A, rows } = await setupChannels(env)
                let before = await snapshot(env.woItems)
                let f = installFaults(env.woItems)
                try {
                    for (let k = 1; k <= 6; k++) {
                        f.arm(k, false, true)
                        let key = await rejKey(() => env.pc.saveChannels(ADMIN, rows, { baseline: A.baseline }))
                        f.disarm()
                        assert.strictEqual(key, 'saveRolledBack', `第 ${k} 次寫入已生效後失敗`)
                        assert.deepStrictEqual(await snapshot(env.woItems), before, `第 ${k} 次已生效之寫入亦須還原`)
                    }
                }
                finally {
                    f.restore()
                }
            })
        })

        it('補償亦失敗 → reject saveWriteFail 並記 log (部分資料可能已寫入; 不假裝已還原)', async function() {
            await withEnv('q3b', async (env) => {
                let { A, rows } = await setupChannels(env)
                let f = installFaults(env.woItems)
                try {
                    env.logs.length = 0
                    f.arm(3, true) //第 3 次寫入失敗, 其後所有寫入 (含補償) 皆失敗
                    let key = await rejKey(() => env.pc.saveChannels(ADMIN, rows, { baseline: A.baseline }))
                    f.disarm()
                    assert.strictEqual(key, 'saveWriteFail')
                    assert.ok(env.logs.some((l) => l.err === 'saveWriteFail'), '補償失敗須記 log')
                    assert.ok(env.logs.some((l) => /rollback-fail/.test(l.event)), '逐步補償失敗亦記 log')
                }
                finally {
                    f.restore()
                }
            })
        })

        it('saveChannelMembers (E4 B 轉綠): 新增 2 列時第 2 次寫入失敗 → 補償後無殘留; 重試後只有 1 份 (不重複建列)', async function() {
            await withEnv('q3c', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'q3c' }]))[0]
                let [h1, h2] = await seedMembers(env, ch.id, [{ memberId: 'h1' }, { memberId: 'h2' }])
                let M = await loadMembers(env, ch.id)
                let rows = JSON.parse(JSON.stringify(M.rows))
                rows.find((r) => r.id === h1.id).role = 'owner' //修改
                rows = rows.filter((r) => r.id !== h2.id) //刪除
                rows.push({ channelId: ch.id, memberId: 'alice' }) //新增
                let before = await snapshot(env.woItems)
                let f = installFaults(env.woItems)
                try {
                    for (let k = 1; k <= 3; k++) {
                        f.arm(k)
                        assert.strictEqual(await rejKey(() => env.pc.saveChannelMembers(ADMIN, ch.id, rows, { baseline: M.baseline })), 'saveRolledBack', `第 ${k} 次`)
                        f.disarm()
                        assert.deepStrictEqual(await snapshot(env.woItems), before, `第 ${k} 次失敗後應完全還原`)
                    }
                }
                finally {
                    f.restore()
                }
                //重試成功: alice 只有 1 列
                await env.pc.saveChannelMembers(ADMIN, ch.id, rows, { baseline: M.baseline })
                assert.strictEqual((await env.woItems.channelMembers.select({ channelId: ch.id, memberId: 'alice' })).length, 1)
            })
        })

        it('deleteChannels (含連帶刪成員): 任一次寫入失敗 → 補償還原 (頻道與成員列皆回復)', async function() {
            await withEnv('q3d', async (env) => {
                let [c1, c2] = await seedChannels(env, [{ name: 'dd1', agentId: AGENT }, { name: 'dd2', agentId: 'agent-2' }])
                await seedMembers(env, c1.id, [{ memberId: 'h1' }])
                let A = await loadChannels(env)
                let before = await snapshot(env.woItems)
                let f = installFaults(env.woItems)
                try {
                    for (let k = 1; k <= 5; k++) { //c1: 成員 2 + 頻道; c2: 成員 1 + 頻道 = 5 次
                        f.arm(k)
                        let key = await rejKey(() => env.pc.deleteChannels(ADMIN, [c1.id, c2.id], { baseline: A.baseline }))
                        f.disarm()
                        assert.strictEqual(key, 'saveRolledBack', `第 ${k} 次`)
                        assert.deepStrictEqual(await snapshot(env.woItems), before)
                    }
                }
                finally {
                    f.restore()
                }
            })
        })

        it('ORM 單筆失敗 (回 ok:0 而非 reject) 亦視為失敗並補償 —— woItems 對單筆失敗不 reject, 不檢查結果則假成功', async function() {
            await withEnv('q3ok0', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'ok0-a' }, { name: 'ok0-b' }]))[0]
                let A = await loadChannels(env)
                let rows = JSON.parse(JSON.stringify(A.rows)); rows[0].description = 'x'; rows[1].description = 'y'
                let before = await snapshot(env.woItems)
                let orig = env.woItems.channels.save.bind(env.woItems.channels)
                let n = 0
                env.woItems.channels.save = async (data, opt) => {
                    n++
                    if (n === 2) {
                        return [{ n: 1, nInserted: 0, nModified: 0, ok: 0, err: 'single-fail' }]
                    } //第 2 次寫入單筆失敗 (命中但 ok:0), 不 reject
                    return orig(data, opt)
                }
                let key = await rejKey(() => env.pc.saveChannels(ADMIN, rows, { baseline: A.baseline }))
                env.woItems.channels.save = orig
                assert.strictEqual(key, 'saveRolledBack')
                assert.deepStrictEqual(await snapshot(env.woItems), before)
                assert.ok(ch.id)
            })
        })

        it('rowsInvalid: 庫內讀出之列主鍵重複 → errRowsInvalid (伺服端資料錯誤, 非重新載入可解) 並記 log; 不寫入', async function() {
            await withEnv('rowsinvalid', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'ri' }]))[0]
                let A = await loadChannels(env)
                let orig = env.woItems.channels.select.bind(env.woItems.channels)
                env.woItems.channels.select = async () => [{ ...ch }, { ...ch, name: 'dup-pk' }]
                env.logs.length = 0
                let key = await rejKey(() => env.pc.saveChannels(ADMIN, JSON.parse(JSON.stringify(A.rows)), { baseline: A.baseline }))
                env.woItems.channels.select = orig
                assert.strictEqual(key, 'errRowsInvalid')
                assert.ok(env.logs.some((l) => l.err === 'errRowsInvalid'))
            })
        })
    })


    // ── O8: respondTask 冪等 ──────────────────────────────────────────────────────
    describe('O8: respondTask 多段寫入之冪等與補償', function() {

        async function startRunning(env, name) {
            let ch = (await seedChannels(env, [{ name }]))[0]
            let r = await env.pc.postMessage('human-1', ch.id, 'req', { asTask: true })
            await env.pc.claimTask(AGENT, r.task.id)
            return { ch, tid: r.task.id }
        }

        it('第二段 (任務終態) 失敗且補償成功 → saveRolledBack, 無殘留 taskReply; 重試後恰 1 則 taskReply, 任務 done', async function() {
            await withEnv('o8a', async (env) => {
                let { ch, tid } = await startRunning(env, 'o8a')
                let f = installFaults(env.woItems)
                try {
                    f.arm(2) //第 1 次寫入=新增 taskReply, 第 2 次=任務終態
                    assert.strictEqual(await rejKey(() => env.pc.respondTask(AGENT, tid, 'answer', 'done')), 'saveRolledBack')
                    f.disarm()
                }
                finally {
                    f.restore()
                }
                let replies = (await env.woItems.messages.select({ channelId: ch.id })).filter((m) => m.kind === 'taskReply')
                assert.strictEqual(replies.length, 0, '補償刪除殘留之 taskReply')
                assert.strictEqual((await env.woItems.tasks.select({ id: tid }))[0].state, 'running')
                let t = await env.pc.respondTask(AGENT, tid, 'answer', 'done') //agent 重試
                assert.strictEqual(t.state, 'done')
                replies = (await env.woItems.messages.select({ channelId: ch.id })).filter((m) => m.kind === 'taskReply')
                assert.strictEqual(replies.length, 1)
                assert.strictEqual(t.resultMessageId, replies[0].id)
            })
        })

        it('第二段失敗且補償亦失敗 (殘留 taskReply) → saveWriteFail; 重試沿用殘留回覆並更新內容, 不產生重複 taskReply', async function() {
            await withEnv('o8b', async (env) => {
                let { ch, tid } = await startRunning(env, 'o8b')
                let f = installFaults(env.woItems)
                try {
                    f.arm(2, true)
                    assert.strictEqual(await rejKey(() => env.pc.respondTask(AGENT, tid, 'first-answer', 'done')), 'saveWriteFail')
                    f.disarm()
                }
                finally {
                    f.restore()
                }
                let replies = (await env.woItems.messages.select({ channelId: ch.id })).filter((m) => m.kind === 'taskReply')
                assert.strictEqual(replies.length, 1, '補償失敗, 殘留 1 則 (前置)')
                let t = await env.pc.respondTask(AGENT, tid, 'retry-answer', 'done')
                replies = (await env.woItems.messages.select({ channelId: ch.id })).filter((m) => m.kind === 'taskReply')
                assert.strictEqual(replies.length, 1, '重試不產生重複 taskReply')
                assert.strictEqual(replies[0].content, 'retry-answer', '沿用之回覆內容更新為本次 result')
                assert.strictEqual(t.resultMessageId, replies[0].id)
                assert.strictEqual(t.state, 'done')
            })
        })

        it('狀態機不變: 重置後再認領再回應, 前一輪之歷史 taskReply 不被沿用 (共 2 則, 各自獨立)', async function() {
            await withEnv('o8c', async (env) => {
                let { ch, tid } = await startRunning(env, 'o8c')
                await env.pc.respondTask(AGENT, tid, 'round-1', 'error', 'errX')
                await env.pc.resetTask(ADMIN, tid)
                await sleep(5)
                await env.pc.claimTask(AGENT, tid)
                await env.pc.respondTask(AGENT, tid, 'round-2', 'done')
                let replies = (await env.woItems.messages.select({ channelId: ch.id })).filter((m) => m.kind === 'taskReply')
                assert.deepStrictEqual(replies.map((m) => m.content).sort(), ['round-1', 'round-2'])
                //守衛不變
                assert.strictEqual(await rejKey(() => env.pc.respondTask(AGENT, tid, 'again', 'done')), 'errTaskNotRunning')
                assert.strictEqual(await rejKey(() => env.pc.claimTask(AGENT, tid)), 'errTaskAlreadyClaimed')
                assert.strictEqual(await rejKey(() => env.pc.resetTask(ADMIN, tid)), 'errTaskNotResettable')
            })
        })
    })


    // ── E2: archiveSweep 逐筆取鎖重讀 ───────────────────────────────────────────────
    describe('E2: archiveSweep 逐筆取 task:<id> 鎖後重讀再搬', function() {

        const OLD = '2020-01-01T00:00:00.000+08:00'

        async function seedOldErrorTask(env, ch, id) {
            let t = ds.tasks.funNew({ channelId: ch.id, title: `t-${id}`, payload: 'p', state: 'error', userId: ADMIN })
            t.id = id
            t.timeDone = OLD
            t.errorKey = 'errX'
            await env.woItems.tasks.insert(t)
            let m = ds.messages.funNew({ channelId: ch.id, senderId: ADMIN, senderType: 'human', kind: 'task', content: `m-${id}`, taskId: id, userId: ADMIN })
            m.id = `m-${id}`
            m.timeCreate = OLD
            await env.woItems.messages.insert(m)
        }

        it('E2 轉綠 (確定性): 候選清單取得後、搬移前任務被重置 (回 pending) → 掃描略過, 熱表仍在且 pending, 冷表無, 其過齡訊息亦不搬', async function() {
            await withEnv('e2a', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'e2a' }]))[0]
                await seedOldErrorTask(env, ch, 'T-1')
                //人為延遲: 掃描取得候選清單後停住 (此時尚未取任務鎖)
                let g = gate()
                let got = gate()
                let orig = env.woItems.tasks.select.bind(env.woItems.tasks)
                let first = true
                env.woItems.tasks.select = async (q) => {
                    let rs = await orig(q)
                    if (first && q && q.isActive === 'y') {
                        first = false
                        got.open()
                        await g.promise
                    }
                    return rs
                }
                let pSweep = env.pc.archiveSweep(30)
                await got.promise
                let t = await env.pc.resetTask(ADMIN, 'T-1') //重置成功 (error → pending)
                assert.strictEqual(t.state, 'pending')
                g.open()
                let r = await pSweep
                env.woItems.tasks.select = orig
                assert.strictEqual(r.tasksMoved, 0, '鎖內重讀已非終態 → 略過')
                let hot = await env.woItems.tasks.select({ id: 'T-1' })
                assert.strictEqual(hot.length, 1, '成功重置之任務不得消失')
                assert.strictEqual(hot[0].state, 'pending')
                assert.strictEqual((await env.woItems.tasksArchive.select({})).length, 0, '冷表不得有被重置之任務')
                assert.strictEqual(r.messagesMoved, 0, '任務仍在熱表 → 其過齡訊息不搬 (守衛取自實際搬走者)')
            })
        })

        it('E2 轉綠 (搬移進行中): 冷表寫入人為延遲期間 resetTask 須等待任務鎖; 結果只有兩種一致狀態 (已搬走則重置失敗 errTaskNotFound)', async function() {
            await withEnv('e2b', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'e2b' }]))[0]
                await seedOldErrorTask(env, ch, 'T-2')
                let g = gate()
                let reached = gate()
                let orig = env.woItems.tasksArchive.save.bind(env.woItems.tasksArchive)
                env.woItems.tasksArchive.save = async (...a) => {
                    reached.open()
                    await g.promise
                    return orig(...a)
                }
                let pSweep = env.pc.archiveSweep(30)
                await reached.promise
                let done = false
                let pReset = rejKey(async () => {
                    await env.pc.resetTask(ADMIN, 'T-2')
                }).then((k) => {
                    done = true; return k
                })
                await sleep(100)
                assert.strictEqual(done, false, '搬移持任務鎖期間, 重置須等待')
                g.open()
                await pSweep
                let k = await pReset
                env.woItems.tasksArchive.save = orig
                assert.strictEqual(k, 'errTaskNotFound', '已搬走之任務不可再重置')
                assert.strictEqual((await env.woItems.tasks.select({ id: 'T-2' })).length, 0)
                assert.strictEqual((await env.woItems.tasksArchive.select({ id: 'T-2' })).length, 1, '任務完整在冷表')
            })
        })

        it('E2 轉綠 (壓力; 修前: 成功重置 117/118 其後消失): 掃描與重置並行, 凡重置成功者皆須仍在熱表且 pending, 不可消失', async function() {
            await withEnv('e2c', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'e2c' }]))[0]
                let ids = []
                for (let i = 0; i < 60; i++) {
                    ids.push(`T-${String(i).padStart(3, '0')}`)
                    await seedOldErrorTask(env, ch, ids[i])
                }
                let pSweep = env.pc.archiveSweep(30)
                let ok = []
                await Promise.all(ids.map((id) => env.pc.resetTask(ADMIN, id).then(() => ok.push(id)).catch(() => {})))
                await pSweep
                for (let id of ok) {
                    let hot = await env.woItems.tasks.select({ id })
                    assert.strictEqual(hot.length, 1, `重置成功之任務 ${id} 不得消失`)
                    assert.strictEqual(hot[0].state, 'pending')
                }
                //其餘 (重置失敗者) 必在冷表且熱表無: 不遺失
                let cold = (await env.woItems.tasksArchive.select({})).map((t) => t.id)
                for (let id of ids.filter((x) => !ok.includes(x))) {
                    assert.ok(cold.includes(id), `未重置者 ${id} 應完整搬到冷表`)
                    assert.strictEqual((await env.woItems.tasks.select({ id })).length, 0)
                }
            })
        })
    })


    // ── 外審補驗 (sol / beam 審查所列交錯與硬失敗缺格) ─────────────────────────────────────────
    describe('外審補驗: 交錯 (ack / 刪除 / 改名 / postMessage)、封存失敗、型別、成員內容衝突、硬失敗矩陣', function() {

        const OLD = '2020-01-01T00:00:00.000+08:00'
        async function seedOldTask(env, ch, id) {
            let t = ds.tasks.funNew({ channelId: ch.id, title: `t-${id}`, payload: 'p', state: 'error', userId: ADMIN })
            t.id = id
            t.timeDone = OLD
            t.errorKey = 'errX'
            await env.woItems.tasks.insert(t)
            let m = ds.messages.funNew({ channelId: ch.id, senderId: ADMIN, senderType: 'human', kind: 'task', content: `m-${id}`, taskId: id, userId: ADMIN })
            m.id = `m-${id}`
            m.timeCreate = OLD
            await env.woItems.messages.insert(m)
        }


        // ── ack 與刪除 / 改名之交錯 ──
        it('deleteChannelMembers 補償不撤銷已成功之 ack: 前像於實體鎖內重讀 —— ack 於刪除前推進之游標納入前像; 其後寫入失敗補償, 游標仍為 ack 所寫之值 (已生效後才失敗; 兩列各自為首次寫入之情形皆測)', async function() {
            for (let k of [1, 2]) {
                await withEnv(`q3ack${k}`, async (env) => {
                    let ch = (await seedChannels(env, [{ name: 'q3ack', agentId: AGENT }]))[0]
                    let h1 = (await seedMembers(env, ch.id, [{ memberId: 'h1' }])).find((r) => r.memberId === 'h1')
                    let agentRow = (await env.woItems.channelMembers.select({ memberId: AGENT }))[0]
                    await env.pc.ackChannel(AGENT, ch.id, 'MSG-1')
                    let M = await loadMembers(env, ch.id)
                    let baselineSel = M.baseline.filter((e) => e[0] === agentRow.id || e[0] === h1.id)
                    //ack(MSG-2) 持實體鎖寫游標前停住
                    let p = pauseOnce(env, 'channelMembers', 'save', (d) => d && d.lastSeenMessageId === 'MSG-2')
                    let pAck = env.pc.ackChannel(AGENT, ch.id, 'MSG-2')
                    await p.reached
                    let f = installFaults(env.woItems)
                    try {
                        f.arm(k, false, true) //刪除之第 k 次寫入「已生效後」失敗
                        let done = false
                        let pDel = rejKey(() => env.pc.deleteChannelMembers(ADMIN, ch.id, [agentRow.id, h1.id], { baseline: baselineSel })).then((x) => {
                            done = true; return x
                        })
                        await sleep(100)
                        assert.strictEqual(done, false, '刪除須等 ack 釋放實體鎖 (agent 列之刪除不插入 ack 寫入期間)')
                        p.release()
                        await pAck
                        assert.strictEqual(await pDel, 'saveRolledBack')
                        f.disarm()
                    }
                    finally {
                        f.restore()
                        p.restore()
                    }
                    let rows = await env.woItems.channelMembers.select({ channelId: ch.id })
                    assert.strictEqual(rows.length, 2, `補償後兩列皆在 (k=${k})`)
                    assert.strictEqual(rows.find((r) => r.memberId === AGENT).lastSeenMessageId, 'MSG-2', `ack 已成功推進之游標不得被補償撤銷 (k=${k})`)
                })
            }
        })

        it('ack 與成員改名 (memberId) 交錯: ack 持實體鎖寫游標期間, 改名須等 ack 完成 (ack 之 save 不落在已換人之列); 改名先完成則 ack 對原成員另建新列, 不寫入已改名之列', async function() {
            await withEnv('ackrename', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'ar', agentId: AGENT }]))[0]
                let m = (await env.woItems.channelMembers.select({ memberId: AGENT }))[0]
                let p = pauseOnce(env, 'channelMembers', 'save', (d) => d && d.lastSeenMessageId === 'MSG-9')
                let pAck = env.pc.ackChannel(AGENT, ch.id, 'MSG-9')
                await p.reached
                let done = false
                let pRen = env.pc.saveChannelMembers(ADMIN, ch.id, [{ id: m.id, memberId: 'bob' }]).then(() => {
                    done = true
                })
                await sleep(120)
                assert.strictEqual(done, false, 'ack 持鎖寫入期間, 改名不可插入')
                assert.strictEqual((await env.woItems.channelMembers.select({ id: m.id }))[0].memberId, AGENT, '改名尚未生效')
                p.release()
                assert.deepStrictEqual(await pAck, { ok: true })
                await pRen
                p.restore()
                let row = (await env.woItems.channelMembers.select({ id: m.id }))[0]
                assert.strictEqual(row.memberId, 'bob')
                assert.strictEqual(row.lastSeenMessageId, 'MSG-9', 'ack 先完成, 游標隨該列')

                //改名先完成: 其後 ack 找不到有效 agent 列 → 缺列路徑另建新列; bob 列之游標不被改寫
                await env.pc.ackChannel(AGENT, ch.id, 'MSG-10')
                let rows = await env.woItems.channelMembers.select({ channelId: ch.id })
                assert.strictEqual(rows.length, 2)
                assert.strictEqual(rows.find((r) => r.memberId === 'bob').lastSeenMessageId, 'MSG-9', '已改名之列不被後到之 ack 改寫')
                assert.strictEqual(rows.find((r) => r.memberId === AGENT).lastSeenMessageId, 'MSG-10')
            })
        })

        it('ack 只認有效列 (isActive y): 既有停用之舊重複列不被寫入游標; 只有停用列時另建有效列', async function() {
            await withEnv('ackactive', async (env) => {
                let [c1, c2] = await seedChannels(env, [{ name: 'aa1', agentId: AGENT }, { name: 'aa2' }])
                let legacy = (cid) => {
                    let o = ds.channelMembers.funNew({ channelId: cid, memberId: AGENT, memberType: 'agent', role: 'member', userId: ADMIN, lastSeenMessageId: 'OLD' })
                    o.isActive = 'n' //funNew 固定 isActive 為 'y', 另行設為停用 (既有資料中之停用舊列)
                    return o
                }
                let l1 = legacy(c1.id)
                let l2 = legacy(c2.id)
                await env.woItems.channelMembers.insert(l1)
                await env.woItems.channelMembers.insert(l2)
                await env.pc.ackChannel(AGENT, c1.id, 'MSG-5') //c1: 有效列 + 停用舊列
                await env.pc.ackChannel(AGENT, c2.id, 'MSG-6') //c2: 只有停用舊列
                let r1 = await env.woItems.channelMembers.select({ channelId: c1.id, memberId: AGENT })
                assert.strictEqual(r1.length, 2)
                assert.strictEqual(r1.find((r) => r.isActive === 'y').lastSeenMessageId, 'MSG-5')
                assert.strictEqual(r1.find((r) => r.isActive === 'n').lastSeenMessageId, 'OLD', '停用舊列不被寫入')
                let r2 = await env.woItems.channelMembers.select({ channelId: c2.id, memberId: AGENT })
                assert.strictEqual(r2.length, 2, '只有停用列時另建有效列')
                assert.strictEqual(r2.find((r) => r.isActive === 'y').lastSeenMessageId, 'MSG-6')
                assert.strictEqual(r2.find((r) => r.isActive === 'n').lastSeenMessageId, 'OLD')
                //讀取端 (getChannelsList) 讀到的游標＝剛 ack 者
                let cs = await env.pc.getChannelsList(AGENT, AGENT)
                assert.strictEqual(cs.find((c) => c.id === c1.id).lastSeenMessageId, 'MSG-5')
            })
        })


        // ── postMessage 與刪頻道交錯 ──
        it('postMessage 與 deleteChannels 交錯 (一): 發訊寫入期間 (持 channels 表鎖) 刪頻道須等待; 兩者皆完成, 該訊息隨頻道移入封存表 (Q2)', async function() {
            await withEnv('pmdel1', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'pm1' }]))[0]
                let p = pauseOnce(env, 'messages', 'insert')
                let pPost = env.pc.postMessage('human-1', ch.id, 'hello')
                await p.reached
                let done = false
                let pDel = env.pc.deleteChannels(ADMIN, [ch.id]).then(() => {
                    done = true
                })
                await sleep(120)
                assert.strictEqual(done, false, '發訊持鎖期間刪頻道須等待')
                p.release()
                await pPost
                await pDel
                p.restore()
                assert.strictEqual((await env.woItems.channels.select({ id: ch.id })).length, 0)
                assert.strictEqual((await env.woItems.messages.select({ channelId: ch.id })).length, 0, '發訊完成後刪頻道: 熱表不得殘留該訊息')
                assert.strictEqual((await env.woItems.messagesArchive.select({ channelId: ch.id })).length, 1, '該訊息在封存表')
            })
        })

        it('postMessage 與 deleteChannels 交錯 (二): 刪頻道進行中 (已持表鎖) 發訊於鎖內重查 → errChannelNotFound, 不產生孤兒訊息 / 任務', async function() {
            await withEnv('pmdel2', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'pm2' }]))[0]
                let p = pauseOnce(env, 'channels', 'del')
                let pDel = env.pc.deleteChannels(ADMIN, [ch.id])
                await p.reached
                let pPost = rejKey(() => env.pc.postMessage('human-1', ch.id, 'late', { asTask: true }))
                await sleep(120)
                p.release()
                await pDel
                p.restore()
                assert.strictEqual(await pPost, 'errChannelNotFound')
                assert.strictEqual((await env.woItems.messages.select({ channelId: ch.id })).length, 0, '不得有孤兒訊息')
                assert.strictEqual((await env.woItems.tasks.select({ channelId: ch.id })).length, 0, '不得有孤兒任務')
                assert.strictEqual((await env.woItems.messagesArchive.select({ channelId: ch.id })).length, 0, '被拒之發訊不得進封存表')
                assert.strictEqual((await env.woItems.tasksArchive.select({ channelId: ch.id })).length, 0, '被拒之任務不得進封存表')
            })
        })


        // ── 封存失敗處理 ──
        it('archiveSweep: 冷表任務寫入回 ok:0 → 拋出且熱表任務不被刪; 熱表刪除失敗 → 撤回冷表複本 (不留矛盾); 撤回亦失敗 → 記 saveWriteFail', async function() {
            await withEnv('arch1', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'arch1' }]))[0]
                await seedOldTask(env, ch, 'T-1')

                //(a) 冷表 save 回 ok:0
                let orig = env.woItems.tasksArchive.save
                env.woItems.tasksArchive.save = async () => [{ n: 1, nInserted: 0, nModified: 0, ok: 0 }]
                let k = await rejKey(() => env.pc.archiveSweep(30))
                env.woItems.tasksArchive.save = orig
                assert.ok(/^Error:/.test(k), `應拋出 (實得 ${k})`)
                assert.strictEqual((await env.woItems.tasks.select({ id: 'T-1' })).length, 1, '熱表任務不得被刪')
                assert.strictEqual((await env.woItems.tasksArchive.select({})).length, 0)
                assert.strictEqual((await env.woItems.messages.select({ channelId: ch.id })).length, 1, '訊息不動')

                //(b) 熱表 del 失敗 → 冷表複本撤回
                let origDel = env.woItems.tasks.del
                env.woItems.tasks.del = async () => {
                    throw new Error('boom-del')
                }
                k = await rejKey(() => env.pc.archiveSweep(30))
                env.woItems.tasks.del = origDel
                assert.ok(/boom-del/.test(k), k)
                assert.strictEqual((await env.woItems.tasks.select({ id: 'T-1' })).length, 1)
                assert.strictEqual((await env.woItems.tasksArchive.select({})).length, 0, '冷表複本須撤回 (否則熱冷並存)')

                //(c) 熱表 del 失敗且撤回亦失敗 → 記 log
                env.logs.length = 0
                env.woItems.tasks.del = async () => {
                    throw new Error('boom-del2')
                }
                let origArchDel = env.woItems.tasksArchive.del
                env.woItems.tasksArchive.del = async () => {
                    throw new Error('boom-undo')
                }
                k = await rejKey(() => env.pc.archiveSweep(30))
                env.woItems.tasks.del = origDel
                env.woItems.tasksArchive.del = origArchDel
                assert.ok(/boom-del2/.test(k), k)
                assert.ok(env.logs.some((l) => l.event === 'archiveSweep-undo-fail' && l.err === 'saveWriteFail'), '撤回失敗須記 log')

                //無故障: 重跑冪等, 任務恰在冷表一份
                await env.pc.archiveSweep(30)
                assert.strictEqual((await env.woItems.tasks.select({ id: 'T-1' })).length, 0)
                assert.strictEqual((await env.woItems.tasksArchive.select({ id: 'T-1' })).length, 1)
            })
        })

        it('archiveSweep: 訊息冷表寫入回 ok:0 → 拋出且熱表訊息不被刪; 逐筆熱表刪除中途失敗 → 已搬者冷表有、未搬者熱表仍在, 重跑後每則恰在冷表一份、熱表無', async function() {
            await withEnv('arch2', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'arch2' }]))[0]
                await seedOldTask(env, ch, 'T-1')
                await seedOldTask(env, ch, 'T-2')

                //(d) messagesArchive.save 回 ok:0
                let orig = env.woItems.messagesArchive.save
                env.woItems.messagesArchive.save = async () => [{ n: 1, nInserted: 0, nModified: 0, ok: 0 }, { n: 1, nInserted: 1, nModified: 0, ok: 1 }]
                let k = await rejKey(() => env.pc.archiveSweep(30))
                env.woItems.messagesArchive.save = orig
                assert.ok(/^Error:/.test(k), k)
                assert.strictEqual((await env.woItems.messages.select({ channelId: ch.id })).length, 2, '熱表訊息不得被刪')

                //(e) 第 2 次 messages.del 失敗
                let origDel = env.woItems.messages.del
                let n = 0
                env.woItems.messages.del = async (...a) => {
                    n++
                    if (n === 2) {
                        throw new Error('boom-msg-del')
                    }
                    return origDel.apply(env.woItems.messages, a)
                }
                k = await rejKey(() => env.pc.archiveSweep(30))
                env.woItems.messages.del = origDel
                assert.ok(/boom-msg-del/.test(k), k)
                assert.strictEqual((await env.woItems.messages.select({ channelId: ch.id })).length, 1, '未搬者熱表仍在')
                assert.strictEqual((await env.woItems.messagesArchive.select({ channelId: ch.id })).length, 2, '冷表已有兩則 (已搬者 + 失敗者之複本; 重跑冪等)')
                let r = await env.pc.archiveSweep(30) //重跑
                assert.strictEqual(r.messagesMoved, 1)
                assert.strictEqual((await env.woItems.messages.select({ channelId: ch.id })).length, 0)
                let cold = await env.woItems.messagesArchive.select({ channelId: ch.id })
                assert.deepStrictEqual(cold.map((m) => m.id).sort(), ['m-T-1', 'm-T-2'], '每則恰在冷表一份')
            })
        })


        // ── 客戶端欄位型別 ──
        it('欄位型別: 契約 fields 若有帶須為字串 —— 物件 / 陣列 / 數字 / null / 布林一律拒收且零寫入 (頻道與成員; 清單與單筆 API; 帶基準修改亦然)', async function() {
            await withEnv('types', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'ty' }]))[0]
                let m = (await seedMembers(env, ch.id, [{ memberId: 'h1' }])).find((r) => r.memberId === 'h1')
                let A = await loadChannels(env)
                let M = await loadMembers(env, ch.id)
                let before = await snapshot(env.woItems)
                for (let bad of [123, { a: 1 }, ['x'], null, true]) {
                    for (let f of ['name', 'description', 'agentId', 'levels', 'ownerId']) {
                        let row = { name: 'new-ty', [f]: bad }
                        assert.strictEqual(await rejKey(() => env.pc.saveChannels(ADMIN, [row])), 'errChannelRowInvalid', `新增 ${f}=${JSON.stringify(bad)}`)
                        assert.strictEqual(await rejKey(() => env.pc.saveChannel(ADMIN, row)), 'errChannelRowInvalid', `單筆新增 ${f}=${JSON.stringify(bad)}`)
                        let rows = JSON.parse(JSON.stringify(A.rows)); rows[0][f] = bad
                        let key = await rejKey(() => env.pc.saveChannels(ADMIN, rows, { baseline: A.baseline }))
                        assert.ok(['errChannelRowInvalid'].includes(key), `帶基準修改 ${f}=${JSON.stringify(bad)} 實得 ${key}`)
                    }
                    for (let f of ['memberId', 'memberType', 'role']) {
                        let row = { memberId: 'new-m', [f]: bad }
                        assert.strictEqual(await rejKey(() => env.pc.saveChannelMembers(ADMIN, ch.id, [row])), 'errMemberRowInvalid', `成員新增 ${f}=${JSON.stringify(bad)}`)
                        assert.strictEqual(await rejKey(() => env.pc.saveChannelMember(ADMIN, { channelId: ch.id, ...row })), 'errMemberRowInvalid', `成員單筆新增 ${f}=${JSON.stringify(bad)}`)
                        let rows = JSON.parse(JSON.stringify(M.rows)); rows[0][f] = bad
                        let key = await rejKey(() => env.pc.saveChannelMembers(ADMIN, ch.id, rows, { baseline: M.baseline }))
                        assert.ok(['errMemberRowInvalid'].includes(key), `成員帶基準修改 ${f}=${JSON.stringify(bad)} 實得 ${key}`)
                    }
                }
                assert.ok(m.id)
                assert.deepStrictEqual(await snapshot(env.woItems), before, '全部拒收且零寫入')
            })
        })


        // ── 成員內容衝突 / 兩份成員清單並行 ──
        it('成員清單存檔: 成員集合相同但既有列內容已被他人改 (A 改 h1 角色) → B 以舊基準改 h2 角色整次拒收 saveStale, 零寫入 (比對含既有列摘要, 不只 id 集合)', async function() {
            await withEnv('memcontent', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'mc' }]))[0]
                let [h1, h2] = await seedMembers(env, ch.id, [{ memberId: 'h1' }, { memberId: 'h2' }])
                let A = await loadMembers(env, ch.id)
                let B = await loadMembers(env, ch.id)
                let ra = JSON.parse(JSON.stringify(A.rows)); ra.find((r) => r.id === h1.id).role = 'owner'
                await env.pc.saveChannelMembers(ADMIN, ch.id, ra, { baseline: A.baseline })
                let afterA = await snapshot(env.woItems)
                let rb = JSON.parse(JSON.stringify(B.rows)); rb.find((r) => r.id === h2.id).role = 'owner'
                assert.strictEqual(await rejKey(() => env.pc.saveChannelMembers(ADMIN2, ch.id, rb, { baseline: B.baseline })), 'saveStale')
                assert.deepStrictEqual(await snapshot(env.woItems), afterA, '零寫入 (庫內＝A 之結果)')
            })
        })

        it('兩份成員清單存檔共用同一基準並行: 第一份寫入中人為延遲, 第二份須等第一份完成後重新比對 → saveStale (不得兩者皆通過而遺失更新)', async function() {
            await withEnv('memtwo', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'mt' }]))[0]
                let [h1, h2] = await seedMembers(env, ch.id, [{ memberId: 'h1' }, { memberId: 'h2' }])
                let A = await loadMembers(env, ch.id)
                let ra = JSON.parse(JSON.stringify(A.rows)); ra.find((r) => r.id === h1.id).role = 'owner'
                let rb = JSON.parse(JSON.stringify(A.rows)); rb.find((r) => r.id === h2.id).role = 'owner'
                let p = pauseOnce(env, 'channelMembers', 'save')
                let pA = env.pc.saveChannelMembers(ADMIN, ch.id, ra, { baseline: A.baseline })
                await p.reached
                let done = false
                let pB = rejKey(() => env.pc.saveChannelMembers(ADMIN2, ch.id, rb, { baseline: A.baseline })).then((x) => {
                    done = true; return x
                })
                await sleep(120)
                assert.strictEqual(done, false, '第二份須等第一份釋放表鎖')
                p.release()
                await pA
                assert.strictEqual(await pB, 'saveStale')
                p.restore()
                let rows = await env.woItems.channelMembers.select({ channelId: ch.id })
                assert.strictEqual(rows.find((r) => r.id === h1.id).role, 'owner')
                assert.notStrictEqual(rows.find((r) => r.id === h2.id).role, 'owner', '第二份之修改不得寫入')
            })
        })

        it('成員範圍深度比對: 存檔本頻道成員後, 他頻道成員完整列 (含稽核欄) 前後完全相同', async function() {
            await withEnv('memscope', async (env) => {
                let [c1, c2] = await seedChannels(env, [{ name: 'ms1', agentId: AGENT }, { name: 'ms2', agentId: 'agent-2' }])
                await seedMembers(env, c2.id, [{ memberId: 'z1' }, { memberId: 'z2' }])
                let others = async () => (await env.woItems.channelMembers.select({ channelId: c2.id })).map((r) => ({ ...r })).sort((a, b) => (a.id < b.id ? -1 : 1))
                let before = await others()
                let M = await loadMembers(env, c1.id)
                let rows = JSON.parse(JSON.stringify(M.rows)); rows[0].role = 'owner'
                rows.push({ memberId: 'new-in-c1' })
                await env.pc.saveChannelMembers(ADMIN, c1.id, rows, { baseline: M.baseline })
                assert.deepStrictEqual(await others(), before)
            })
        })


        // ── 未改動頻道不補 agent 列 ──
        it('未改動之頻道不補主責 agent 成員列: agent 列被刪後, 以相符基準存檔 (該頻道摘要未變) → 不重建; 該頻道有修改時才補', async function() {
            await withEnv('noagent', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'na', agentId: AGENT }, { name: 'nb' }]))[0]
                let agentRow = (await env.woItems.channelMembers.select({ channelId: ch.id, memberId: AGENT }))[0]
                await env.woItems.channelMembers.del({ id: agentRow.id }) //直接刪 (模擬已被管理員刪除之 agent 列)
                let A = await loadChannels(env)
                let rows = JSON.parse(JSON.stringify(A.rows))
                rows.find((r) => r.name === 'nb').description = 'edited' //只改另一個頻道
                let r = await env.pc.saveChannels(ADMIN, rows, { baseline: A.baseline })
                assert.strictEqual(r.unchanged, 1)
                assert.strictEqual((await env.woItems.channelMembers.select({ channelId: ch.id })).length, 0, '未改動之頻道不補列')
                //該頻道有修改 → 補 (D7)
                let A2 = await loadChannels(env)
                let rows2 = JSON.parse(JSON.stringify(A2.rows)); rows2.find((x) => x.id === ch.id).description = 'now-edited'
                await env.pc.saveChannels(ADMIN, rows2, { baseline: A2.baseline })
                assert.strictEqual((await env.woItems.channelMembers.select({ channelId: ch.id, memberId: AGENT })).length, 1)
            })
        })


        // ── 清單 API 嚴格 saveInProgress (閘門) ──
        it('清單 API 同一操作者並行: 第一請求停在寫入中, 第二請求 (名稱合法) 立即 reject saveInProgress / deleteInProgress (非排隊後以名稱重複等他因拒收) —— 頻道與成員清單存檔、刪除', async function() {
            await withEnv('listlock', async (env) => {
                let [c1, c2] = await seedChannels(env, [{ name: 'll1' }, { name: 'll2' }])
                let h = (await seedMembers(env, c1.id, [{ memberId: 'h1' }, { memberId: 'h2' }]))
                //頻道清單存檔
                let p = pauseOnce(env, 'channels', 'insert')
                let pA = env.pc.saveChannels(ADMIN, [{ name: 'll-new-1' }])
                await p.reached
                assert.strictEqual(await rejKey(() => env.pc.saveChannels(ADMIN, [{ name: 'll-new-2' }])), 'saveInProgress')
                p.release(); await pA; p.restore()
                //頻道清單刪除
                p = pauseOnce(env, 'channels', 'del')
                pA = env.pc.deleteChannels(ADMIN, [c2.id])
                await p.reached
                let c3 = (await env.woItems.channels.select({ name: 'll-new-1' }))[0]
                assert.strictEqual(await rejKey(() => env.pc.deleteChannels(ADMIN, [c3.id])), 'deleteInProgress')
                p.release(); await pA; p.restore()
                //成員清單存檔
                p = pauseOnce(env, 'channelMembers', 'insert')
                pA = env.pc.saveChannelMembers(ADMIN, c1.id, [{ memberId: 'x1' }])
                await p.reached
                assert.strictEqual(await rejKey(() => env.pc.saveChannelMembers(ADMIN, c1.id, [{ memberId: 'x2' }])), 'saveInProgress')
                p.release(); await pA; p.restore()
                //成員清單刪除
                p = pauseOnce(env, 'channelMembers', 'del')
                pA = env.pc.deleteChannelMembers(ADMIN, c1.id, [h[0].id])
                await p.reached
                assert.strictEqual(await rejKey(() => env.pc.deleteChannelMembers(ADMIN, c1.id, [h[1].id])), 'deleteInProgress')
                p.release(); await pA; p.restore()
            })
        })


        // ── 單筆 API 成功形狀 (相容) ──
        it('單筆 API 維持 ORM 結果形狀 (外部呼叫端相容): 新增 { n, nInserted, ok }; 修改 [{ n, nInserted, nModified, ok }]; 刪除 [{ n, nDeleted, ok } ] —— 頻道與成員', async function() {
            await withEnv('shape', async (env) => {
                let r = await env.pc.saveChannel(ADMIN, { name: 'shape' })
                assert.deepStrictEqual(r, { n: 1, nInserted: 1, ok: 1 })
                let id = (await env.woItems.channels.select({ name: 'shape' }))[0].id
                assert.deepStrictEqual(await env.pc.saveChannel(ADMIN, { id, description: 'x' }), [{ n: 1, nInserted: 0, nModified: 1, ok: 1 }])
                assert.deepStrictEqual(await env.pc.saveChannelMember(ADMIN, { channelId: id, memberId: 'mm' }), { n: 1, nInserted: 1, ok: 1 })
                let mid = (await env.woItems.channelMembers.select({ memberId: 'mm' }))[0].id
                assert.deepStrictEqual(await env.pc.saveChannelMember(ADMIN, { id: mid, role: 'owner' }), [{ n: 1, nInserted: 0, nModified: 1, ok: 1 }])
                assert.deepStrictEqual(await env.pc.deleteChannelMember(ADMIN, mid), [{ n: 1, nDeleted: 1, ok: 1 }])
                assert.deepStrictEqual(await env.pc.deleteChannel(ADMIN, id), [{ n: 1, nDeleted: 1, ok: 1 }])
            })
        })


        // ── 硬失敗矩陣擴充 ──
        it('saveChannelMembers 同批兩筆新增: 第 2 筆新增失敗 → 補償刪除第 1 筆, 庫內完全還原; 重試後兩筆各 1 份', async function() {
            await withEnv('q3two', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'q3two' }]))[0]
                let M = await loadMembers(env, ch.id)
                let rows = [{ memberId: 'n1' }, { memberId: 'n2' }]
                let before = await snapshot(env.woItems)
                let f = installFaults(env.woItems)
                try {
                    for (let k of [1, 2]) {
                        for (let after of [false, true]) {
                            f.arm(k, false, after)
                            assert.strictEqual(await rejKey(() => env.pc.saveChannelMembers(ADMIN, ch.id, rows, { baseline: M.baseline })), 'saveRolledBack', `第 ${k} 筆 ${after ? '已生效後' : ''}失敗`)
                            f.disarm()
                            assert.deepStrictEqual(await snapshot(env.woItems), before)
                        }
                    }
                }
                finally {
                    f.restore()
                }
                await env.pc.saveChannelMembers(ADMIN, ch.id, rows, { baseline: M.baseline })
                assert.strictEqual((await env.woItems.channelMembers.select({ channelId: ch.id, memberId: 'n1' })).length, 1)
                assert.strictEqual((await env.woItems.channelMembers.select({ channelId: ch.id, memberId: 'n2' })).length, 1)
            })
        })

        it('deleteChannelMembers 多列刪除: 每一次寫入失敗 (前 / 已生效後) 皆補償還原 (含失敗中之那一步)', async function() {
            await withEnv('q3mdel', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'q3mdel', agentId: AGENT }]))[0]
                await seedMembers(env, ch.id, [{ memberId: 'h1' }, { memberId: 'h2' }])
                let M = await loadMembers(env, ch.id)
                let ids = M.rows.map((r) => r.id)
                let baselineSel = M.baseline.filter((e) => ids.includes(e[0]))
                let before = await snapshot(env.woItems)
                let f = installFaults(env.woItems)
                try {
                    for (let k = 1; k <= 3; k++) {
                        for (let after of [false, true]) {
                            f.arm(k, false, after)
                            assert.strictEqual(await rejKey(() => env.pc.deleteChannelMembers(ADMIN, ch.id, ids, { baseline: baselineSel })), 'saveRolledBack', `第 ${k} 次 ${after ? '已生效後' : ''}失敗`)
                            f.disarm()
                            assert.deepStrictEqual(await snapshot(env.woItems), before, `第 ${k} 次失敗後應完全還原`)
                        }
                    }
                }
                finally {
                    f.restore()
                }
            })
        })

        it('saveChannelMembers (修改 / 刪除 / 新增混合) 與 respondTask 沿用回覆分支: 已生效後失敗亦完全還原', async function() {
            await withEnv('q3mix', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'q3mix' }]))[0]
                let [h1, h2] = await seedMembers(env, ch.id, [{ memberId: 'h1' }, { memberId: 'h2' }])
                let M = await loadMembers(env, ch.id)
                let rows = JSON.parse(JSON.stringify(M.rows))
                rows.find((r) => r.id === h1.id).role = 'owner'
                rows = rows.filter((r) => r.id !== h2.id)
                rows.push({ memberId: 'alice' })
                let before = await snapshot(env.woItems)
                let f = installFaults(env.woItems)
                try {
                    for (let k = 1; k <= 3; k++) {
                        f.arm(k, false, true)
                        assert.strictEqual(await rejKey(() => env.pc.saveChannelMembers(ADMIN, ch.id, rows, { baseline: M.baseline })), 'saveRolledBack', `第 ${k} 次已生效後失敗`)
                        f.disarm()
                        assert.deepStrictEqual(await snapshot(env.woItems), before, `第 ${k} 次`)
                    }
                }
                finally {
                    f.restore()
                }

                //respondTask 沿用殘留回覆分支: 殘留 taskReply (補償失敗之遺留) → 重試沿用其 id; 任務終態寫入已生效後失敗亦還原
                let r = await env.pc.postMessage('human-1', ch.id, 'req', { asTask: true })
                await env.pc.claimTask(AGENT, r.task.id)
                f = installFaults(env.woItems)
                try {
                    f.arm(2, true) //第 2 次寫入 (任務終態) 失敗且補償亦失敗 → 殘留 taskReply
                    assert.strictEqual(await rejKey(() => env.pc.respondTask(AGENT, r.task.id, 'a1', 'done')), 'saveWriteFail')
                    f.disarm()
                    let beforeReuse = await snapshot(env.woItems)
                    f.arm(1, false, true) //沿用分支: 第 1 次寫入 (更新殘留回覆內容) 已生效後失敗 → 補償還原
                    assert.strictEqual(await rejKey(() => env.pc.respondTask(AGENT, r.task.id, 'a2', 'done')), 'saveRolledBack')
                    f.disarm()
                    assert.deepStrictEqual(await snapshot(env.woItems), beforeReuse, '沿用分支失敗後回到失敗前狀態')
                }
                finally {
                    f.restore()
                }
            })
        })

        it('只有部分補償步驟失敗: 失敗步驟之補償失敗不中斷其後補償 —— reject saveWriteFail, 其餘步驟仍完全還原; 記逐步補償失敗 log', async function() {
            await withEnv('q3part', async (env) => {
                let { A, rows } = await (async () => {
                    await env.pc.saveChannels(ADMIN, [{ name: 'c1' }, { name: 'c2', agentId: AGENT }, { name: 'c3' }])
                    let A0 = await loadChannels(env)
                    let rs = JSON.parse(JSON.stringify(A0.rows))
                    rs.find((r) => r.name === 'c1').name = 'c1x'
                    rs.find((r) => r.name === 'c3').description = 'd3'
                    rs = rs.filter((r) => r.name !== 'c2')
                    rs.push({ name: 'c4', agentId: 'agent-4' })
                    return { A: A0, rows: rs }
                })()
                let before = await snapshot(env.woItems)
                let f = installFaults(env.woItems)
                try {
                    env.logs.length = 0
                    //寫入順序: 1 新增 c4、2 改 c1、3 改 c3、4 補 agent-4 成員、5 刪 c2 之成員 (agent)、6 刪 c2.
                    //第 5 次失敗 (未生效) → 補償依序: 第 5 步 (call 6)、第 4 步 (call 7)、第 3 步 (call 8)...; 令 call 6 (第 5 步自身之補償) 失敗, 其後皆成功
                    f.armSet([5, 6])
                    let key = await rejKey(() => env.pc.saveChannels(ADMIN, rows, { baseline: A.baseline }))
                    f.disarm()
                    assert.strictEqual(key, 'saveWriteFail')
                    assert.ok(env.logs.some((l) => /rollback-fail/.test(l.event)), '逐步補償失敗須記 log')
                    assert.deepStrictEqual(await snapshot(env.woItems), before, '第 1～4 步之補償仍須執行, 庫內完全還原 (第 5 步未生效, 其補償失敗無影響)')
                }
                finally {
                    f.restore()
                }
            })
        })

        it('rowsInvalid 零寫入: 庫內讀出之列主鍵重複 → errRowsInvalid 且無任何寫入 (恢復 select 後快照與前相同)', async function() {
            await withEnv('rowsinvalid2', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'ri2' }]))[0]
                let A = await loadChannels(env)
                let rows = JSON.parse(JSON.stringify(A.rows)); rows[0].description = 'edit'
                let before = await snapshot(env.woItems)
                let orig = env.woItems.channels.select
                env.woItems.channels.select = async () => [{ ...ch }, { ...ch, name: 'dup-pk' }]
                let f = installFaults(env.woItems)
                let key
                try {
                    f.arm(0)
                    key = await rejKey(() => env.pc.saveChannels(ADMIN, rows, { baseline: A.baseline }))
                    assert.strictEqual(f.st.calls.length, 0, `不得有任何寫入呼叫 (實得 ${f.st.calls.join(',')})`)
                }
                finally {
                    f.restore()
                    env.woItems.channels.select = orig
                }
                assert.strictEqual(key, 'errRowsInvalid')
                assert.deepStrictEqual(await snapshot(env.woItems), before)
            })
        })

        it('rowsInvalid (刪除入口): 庫內讀出之被選列主鍵重複 → errRowsInvalid 並記 log (非 errRowNotFound), 零寫入 —— deleteChannels 與 deleteChannelMembers', async function() {
            await withEnv('rowsinvalid3', async (env) => {
                let ch = (await seedChannels(env, [{ name: 'ri3', agentId: AGENT }]))[0]
                let m = (await env.woItems.channelMembers.select({ channelId: ch.id }))[0]
                let A = await loadChannels(env)
                let M = await loadMembers(env, ch.id)
                let before = await snapshot(env.woItems)
                let f = installFaults(env.woItems)
                let origCh = env.woItems.channels.select
                let origMb = env.woItems.channelMembers.select
                try {
                    env.woItems.channels.select = async () => [{ ...ch }, { ...ch, name: 'dup-pk' }]
                    env.logs.length = 0
                    f.arm(0)
                    assert.strictEqual(await rejKey(() => env.pc.deleteChannels(ADMIN, [ch.id], { baseline: A.baseline })), 'errRowsInvalid')
                    assert.ok(env.logs.some((l) => l.err === 'errRowsInvalid'), '須記 log')
                    env.woItems.channelMembers.select = async () => [{ ...m }, { ...m, role: 'dup' }]
                    env.logs.length = 0
                    assert.strictEqual(await rejKey(() => env.pc.deleteChannelMembers(ADMIN, ch.id, [m.id], { baseline: M.baseline })), 'errRowsInvalid')
                    assert.ok(env.logs.some((l) => l.err === 'errRowsInvalid'), '須記 log')
                    assert.strictEqual(f.st.calls.length, 0, '不得有任何寫入呼叫')
                }
                finally {
                    f.restore()
                    env.woItems.channels.select = origCh
                    env.woItems.channelMembers.select = origMb
                }
                assert.deepStrictEqual(await snapshot(env.woItems), before)
            })
        })
    })


    // ── 外部匯入不涉本套件 (Q8) ───────────────────────────────────────────────────────
    describe('Q8: 本套件無外部匯入 (原則 11 不適用) —— V2、V3 不適用', function() {
        it('寫入入口全集不含 delAll + insert 之整批重寫 (離線工具 g.initialData 與服務互斥, 不在服務程式碼內)', async function() {
            let fs = await import('fs')
            let src = fs.readFileSync(new URL('../server/procCore.mjs', import.meta.url), 'utf8')
            assert.ok(!/\.delAll\(/.test(src), 'procCore 不得有 delAll 整批重寫 (外部匯入之 V2/V3 因此不適用)')
        })
    })


    // 防呆: 摘要函式於測試內可用 (確認 import 路徑為前端同一份共用模組)
    it('前端共用模組: digestRow 對相同內容不同表示給相同摘要 (undefined / null / 空字串等價)', function() {
        assert.strictEqual(digestRow({ id: 'a', name: 'n', description: null }, channelsContract), digestRow({ id: 'a', name: 'n', description: '' }, channelsContract))
    })
})
