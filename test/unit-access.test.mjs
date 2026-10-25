//unit-access: 呼叫者角色與成員檢查之單一擁有者(server/access.mjs)之單元測試 —— 真實 lmdb ORM + 真實 procCore, 不起 server
//對應 spec/設計要點與取捨.md D20、dspec/使用者身分驗證原則.md 二.4、w-web呼叫者身分驗證.md C2 / C2b; 規則帳本 rulebook_security.md R-AUTHZ-01～06
//  A1 isAdminUser: 只認自有屬性 isAdmin 嚴格等於 'y'(其餘值、繼承屬性、非物件一律視為一般使用者)
//  A2 callerOf: 只認 getUserIdByToken 驗證當下登錄之角色; 無登錄 / 逾期 / 非字串 userId 一律拒絕(fail-closed)
//  A3 成員判準單一處(isMemberOf / memberChannelIds): channelMembers 之 (channelId, memberId=呼叫者, isActive='y'); 停用列、他頻道之列、非字串 channelId(含物件條件注入)皆不算
//  A4 入口函數表(createGuardedFuncs): 全部對外函數都在表內且各有規則; 被拒者零寫入、不呼叫 procCore
//  A5 清單與統計只回有權看之頻道之資料
//測試資料庫落 test/_tmp/concurrency/<案名>(測完即刪)
import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { mkEnv, cleanRoot, rejKey, gate, sleep } from './tools/concEnv.mjs'
import { createAccess, createGuardedFuncs, KEY_NOT_ADMIN, KEY_NOT_MEMBER } from '../server/access.mjs'


const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const ADMIN = { id: 'admin-1', isAdmin: true }
const MEMBER = { id: 'member-1', isAdmin: false }
const OUT = { id: 'out-1', isAdmin: false }


async function withEnv(name, fn) {
    let env = await mkEnv(name)
    try {
        await fn(env)
    }
    finally {
        await env.close()
    }
}

//mkWorld: 兩個頻道(A: member-1 為成員; B: 無一般使用者), 各有一筆訊息與任務; 回 { env, access, gf, A, B, taskA, taskB, warns }
async function mkWorld(name, fn) {
    await withEnv(name, async (env) => {
        let warns = []
        let srLog = {
            info() {},
            error() {},
            warn(o) {
                warns.push(o)
            }
        }
        let t = 1000
        let access = createAccess({ woItems: env.woItems, srLog, now: () => t })
        let gf = createGuardedFuncs({ access, pc: env.pc, getWebInfor: (userId) => ({ userId }) })
        await env.pc.saveChannels('admin-1', [{ name: 'chA', agentId: 'agent-x' }, { name: 'chB', agentId: 'agent-x' }]) //兩頻道同一主責 agent(存檔時自動建 agent 成員列): 供 agentId 過濾後之收斂測試
        let chs = await env.woItems.channels.select({})
        let A = chs.find((c) => c.name === 'chA').id
        let B = chs.find((c) => c.name === 'chB').id
        await env.pc.saveChannelMember('admin-1', { channelId: A, memberId: 'member-1', memberType: 'human' })
        let pa = await env.pc.postMessage('admin-1', A, 'a', { asTask: true })
        let pb = await env.pc.postMessage('admin-1', B, 'b', { asTask: true })
        await fn({
            env,
            access,
            gf,
            A,
            B,
            taskA: pa.task.id,
            taskB: pb.task.id,
            warns,
            tick: (ms) => {
                t += ms
            },
            setNow: (v) => {
                t = v
            }
        })
    })
}


describe('unit-access(呼叫者角色與成員檢查)', function() {
    this.timeout(60000)

    after(function() {
        cleanRoot()
    })

    it('A1 isAdminUser: 只認自有屬性 isAdmin 嚴格等於 y', async function() {
        await withEnv('access-a1', async (env) => {
            let access = createAccess({ woItems: env.woItems, srLog: { info() {}, warn() {}, error() {} } })
            let yes = [{ isAdmin: 'y' }, { id: 'x', isAdmin: 'y' }]
            let no = [{ isAdmin: 'n' }, { isAdmin: 'Y' }, { isAdmin: 'y ' }, { isAdmin: true }, { isAdmin: 1 }, { isAdmin: ['y'] }, {}, null, undefined, 'y', 0, [], Object.create({ isAdmin: 'y' })]
            for (let u of yes) {
                assert.strictEqual(access.isAdminUser(u), true, JSON.stringify(u))
            }
            for (let u of no) {
                assert.strictEqual(access.isAdminUser(u), false, JSON.stringify(u))
            }
            assert.deepStrictEqual(access.callerOfUser({ id: 'u1', isAdmin: 'y' }), { id: 'u1', isAdmin: true })
            assert.deepStrictEqual(access.callerOfUser({ id: 'u2', isAdmin: 'n' }), { id: 'u2', isAdmin: false })
        })
    })

    it('A2 callerOf: 無登錄 / 逾期 / 非字串 userId 一律拒絕; 登錄後查回角色; 重新驗證刷新登錄與角色', async function() {
        await mkWorld('access-a2', async ({ access, tick, warns }) => {
            assert.strictEqual(await rejKey(() => access.callerOf('nobody')), 'errUserIdMissing', '無登錄')
            for (let bad of ['', undefined, null, 1, {}, ['u1']]) {
                assert.strictEqual(await rejKey(() => access.callerOf(bad)), 'errUserIdMissing', `非字串 ${JSON.stringify(bad)}`)
            }
            access.remember({ id: 'u1', isAdmin: 'y' })
            assert.deepStrictEqual(await access.callerOf('u1'), { id: 'u1', isAdmin: true })
            //角色降級後重新驗證: 以最近一次驗證為準
            access.remember({ id: 'u1', isAdmin: 'n' })
            assert.deepStrictEqual(await access.callerOf('u1'), { id: 'u1', isAdmin: false })
            //逾期(>60s)拒絕; 刷新後恢復
            tick(60 * 1000 + 1)
            assert.strictEqual(await rejKey(() => access.callerOf('u1')), 'errUserIdMissing', '逾期')
            access.remember({ id: 'u1', isAdmin: 'n' })
            assert.deepStrictEqual(await access.callerOf('u1'), { id: 'u1', isAdmin: false })
            //remember 不收缺 id 者
            access.remember({ isAdmin: 'y' })
            access.remember(null)
            assert.strictEqual(await rejKey(() => access.callerOf(undefined)), 'errUserIdMissing')
            assert.ok(warns.every((w) => w.event !== 'callerOf'), 'callerOf 的拒絕記 error 不記 warn')
        })
    })

    it('A2b remember 超過上限時清除逾期登錄(不無限成長), 未逾期者保留', async function() {
        await mkWorld('access-a2b', async ({ access, tick }) => {
            for (let i = 0; i < 1000; i++) {
                access.remember({ id: `old-${i}`, isAdmin: 'n' })
            }
            assert.strictEqual(access.callerCount(), 1000)
            access.remember({ id: 'fresh-0', isAdmin: 'y' }) //未逾期: 此次寫入使筆數達 1001, 觸發清除但無逾期者可清
            assert.strictEqual(access.callerCount(), 1001)
            tick(60 * 1000 + 1)
            access.remember({ id: 'fresh-1', isAdmin: 'y' }) //逾期後之寫入: 筆數仍超過上限, 清掉全部逾期者(fresh-0 亦已逾期)
            assert.strictEqual(access.callerCount(), 1, '逾期登錄已清除, 只剩剛寫入者')
            assert.deepStrictEqual(await access.callerOf('fresh-1'), { id: 'fresh-1', isAdmin: true })
            assert.strictEqual(await rejKey(() => access.callerOf('old-5')), 'errUserIdMissing')
        })
    })

    it('A3 成員判準: 有效成員列才算; 停用列、他頻道之列、非字串 channelId(物件條件注入)皆不算', async function() {
        await mkWorld('access-a3', async ({ env, access, A, B }) => {
            assert.strictEqual(await access.isMemberOf('member-1', A), true)
            assert.strictEqual(await access.isMemberOf('member-1', B), false, '他頻道')
            assert.strictEqual(await access.isMemberOf('out-1', A), false, '非成員')
            for (let bad of [{ $ne: '' }, [A], undefined, null, 1, '', { $in: [A, B] }]) {
                assert.strictEqual(await access.isMemberOf('member-1', bad), false, `非字串 channelId ${JSON.stringify(bad)}`)
            }
            for (let bad of [{ $ne: '' }, undefined, null, '', 1]) {
                assert.strictEqual(await access.isMemberOf(bad, A), false, `非字串 memberId ${JSON.stringify(bad)}`)
                assert.strictEqual((await access.memberChannelIds(bad)).size, 0)
            }
            //停用列不算
            let m = (await env.woItems.channelMembers.select({ channelId: A, memberId: 'member-1' }))[0]
            await env.woItems.channelMembers.save({ id: m.id, isActive: 'n' }, { autoInsert: false })
            assert.strictEqual(await access.isMemberOf('member-1', A), false, '停用列')
            assert.strictEqual((await access.memberChannelIds('member-1')).size, 0)
        })
    })

    it('A4 規則: requireAdmin / requireChannel / requireTask / requireParticipant 之放行與拒絕鍵; 拒絕記 access-denied(不含 token, 含函數名與呼叫者 id)', async function() {
        await mkWorld('access-a4', async ({ access, A, B, taskA, taskB, warns }) => {
            //requireAdmin
            await access.requireAdmin('f', ADMIN)
            assert.strictEqual(await rejKey(() => access.requireAdmin('saveChannel', MEMBER)), KEY_NOT_ADMIN)
            //requireChannel
            await access.requireChannel('f', ADMIN, A)
            await access.requireChannel('f', ADMIN, B)
            await access.requireChannel('f', ADMIN, 'no-such-channel') //管理員不擋(業務函式回 errChannelNotFound)
            await access.requireChannel('f', MEMBER, A)
            assert.strictEqual(await rejKey(() => access.requireChannel('getMessages', MEMBER, B)), KEY_NOT_MEMBER)
            assert.strictEqual(await rejKey(() => access.requireChannel('getMessages', OUT, A)), KEY_NOT_MEMBER)
            assert.strictEqual(await rejKey(() => access.requireChannel('getMessages', MEMBER, { $ne: '' })), KEY_NOT_MEMBER, '物件條件注入')
            assert.strictEqual(await rejKey(() => access.requireChannel('getMessages', MEMBER, undefined)), KEY_NOT_MEMBER)
            //requireTask
            await access.requireTask('f', ADMIN, taskA)
            await access.requireTask('f', ADMIN, taskB)
            await access.requireTask('f', MEMBER, taskA)
            assert.strictEqual(await rejKey(() => access.requireTask('getTask', MEMBER, taskB)), 'errTaskNotFound', '非成員與查無同回 errTaskNotFound')
            assert.strictEqual(await rejKey(() => access.requireTask('getTask', MEMBER, 'no-such-task')), 'errTaskNotFound')
            assert.strictEqual(await rejKey(() => access.requireTask('getTask', MEMBER, { $ne: '' })), 'errTaskNotFound', '物件條件注入')
            assert.strictEqual(await rejKey(() => access.requireTask('getTask', OUT, taskA)), 'errTaskNotFound')
            //requireParticipant
            await access.requireParticipant('f', ADMIN)
            await access.requireParticipant('f', MEMBER)
            assert.strictEqual(await rejKey(() => access.requireParticipant('uploadFile', OUT)), KEY_NOT_MEMBER)
            //log
            let denied = warns.filter((w) => w.event === 'access-denied')
            assert.ok(denied.length >= 8)
            assert.ok(denied.every((w) => typeof w.func === 'string' && typeof w.userId === 'string' && typeof w.err === 'string'))
            assert.deepStrictEqual(denied[0], { event: 'access-denied', func: 'saveChannel', userId: 'member-1', err: KEY_NOT_ADMIN })
            assert.ok(!JSON.stringify(denied).includes('$ne'), '不記請求內容')
        })
    })

    it('A5 清單與選取: scopeChannels / scopeSelect 只回有權看之頻道; 非 select 或非陣列結果對一般使用者回空', async function() {
        await mkWorld('access-a5', async ({ env, access, A, B }) => {
            let chs = await env.woItems.channels.select({})
            let ms = await env.woItems.channelMembers.select({})
            assert.ok(chs.some((c) => c.id === B))
            assert.deepStrictEqual((await access.scopeChannels(ADMIN, chs)).length, chs.length)
            assert.deepStrictEqual((await access.scopeChannels(MEMBER, chs)).map((c) => c.id), [A])
            assert.deepStrictEqual(await access.scopeChannels(OUT, chs), [])
            assert.deepStrictEqual(await access.scopeChannels(MEMBER, 'not-array'), [])
            assert.strictEqual((await access.scopeSelect(ADMIN, 'channels', 'select', chs)).length, chs.length)
            assert.deepStrictEqual((await access.scopeSelect(MEMBER, 'channels', 'select', chs)).map((c) => c.id), [A])
            assert.ok((await access.scopeSelect(MEMBER, 'channelMembers', 'select', ms)).every((m) => m.channelId === A))
            assert.ok((await access.scopeSelect(MEMBER, 'channelMembers', 'select', ms)).length >= 1)
            assert.deepStrictEqual(await access.scopeSelect(OUT, 'channelMembers', 'select', ms), [])
            assert.deepStrictEqual(await access.scopeSelect(MEMBER, 'channels', 'insert', chs), [], '非 select')
            assert.deepStrictEqual(await access.scopeSelect(MEMBER, 'channels', 'select', { n: 1 }), [], '非陣列結果')
            assert.deepStrictEqual(await access.scopeSelect(MEMBER, 'tasks', 'select', chs), [], '非同步表')
            assert.strictEqual(await access.scopeIds(ADMIN), null)
            assert.deepStrictEqual([...(await access.scopeIds(MEMBER))], [A])
        })
    })

    it('A6 入口函數表: 全部對外函數(kpFunExt 24 + HTTP 串流 getFile = 25)皆在表內; 表外無其他函數名', async function() {
        await mkWorld('access-a6', async ({ gf }) => {
            let want = [
                'getWebInfor', 'getChannelsList', 'getStats',
                'saveChannels', 'deleteChannels', 'saveChannel', 'deleteChannel', 'saveChannelMembers', 'deleteChannelMembers', 'saveChannelMember', 'deleteChannelMember',
                'getChannelMembers', 'getMessages', 'postMessage', 'getTasks', 'getArchivedTasks', 'getArchivedMessages', 'ackChannel',
                'getTask', 'claimTask', 'respondTask', 'resetTask',
                'uploadFile', 'getFileInfo', 'getFile',
            ]
            assert.deepStrictEqual(Object.keys(gf).sort(), want.slice().sort())
        })
    })

    it('A7 入口函數表之放行與拒絕: 管理類 / 頻道內容 / 任務 / 檔案; 被拒者零寫入', async function() {
        //procCore 以 cwd 之 ./dbf 為檔案實體目錄(須以專案根為 cwd): 無論通過與否(被測碼錯誤放行時, 如變異驗證, 上傳檔亦會落地), 測後清掉本案新增之檔
        let dbfDir = path.resolve('dbf')
        let dbfBefore = new Set(fs.existsSync(dbfDir) ? fs.readdirSync(dbfDir) : [])
        let dbfClean = () => {
            for (let n of (fs.existsSync(dbfDir) ? fs.readdirSync(dbfDir) : [])) {
                if (!dbfBefore.has(n)) {
                    fs.rmSync(path.join(dbfDir, n), { force: true })
                }
            }
        }
        await mkWorld('access-a7', async ({ env, gf, A, B, taskA, taskB }) => {
            let cnt = async (ch) => (await env.woItems.messages.select({ channelId: ch })).length
            //管理類
            for (let [fn, args] of [
                ['saveChannel', [{ name: 'x' }]], ['saveChannels', [[{ name: 'x' }]]], ['deleteChannel', [A]], ['deleteChannels', [[A]]],
                ['saveChannelMember', [{ channelId: A, memberId: 'zz' }]], ['saveChannelMembers', [A, [{ channelId: A, memberId: 'zz' }]]],
                ['deleteChannelMember', ['no-id']], ['deleteChannelMembers', [A, ['no-id']]],
            ]) {
                for (let c of [MEMBER, OUT]) {
                    assert.strictEqual(await rejKey(() => gf[fn](c, ...args)), KEY_NOT_ADMIN, `${fn}/${c.id}`)
                }
            }
            assert.strictEqual((await env.woItems.channels.select({})).length, 2, '管理類被拒者零寫入')
            assert.strictEqual((await env.woItems.channelMembers.select({ channelId: A, memberId: 'zz' })).length, 0)
            //頻道內容
            let before = [await cnt(A), await cnt(B)]
            assert.strictEqual(await rejKey(() => gf.postMessage(MEMBER, B, 'hack', {})), KEY_NOT_MEMBER)
            assert.strictEqual(await rejKey(() => gf.postMessage(OUT, A, 'hack', {})), KEY_NOT_MEMBER)
            assert.deepStrictEqual([await cnt(A), await cnt(B)], before, '被拒者零寫入')
            let ok = await gf.postMessage(MEMBER, A, 'hi', {})
            assert.strictEqual(ok.message.senderId, 'member-1', '身分取自呼叫者')
            assert.strictEqual(await rejKey(() => gf.getMessages(MEMBER, B)), KEY_NOT_MEMBER)
            assert.strictEqual(await rejKey(() => gf.ackChannel(OUT, A, 'z')), KEY_NOT_MEMBER)
            assert.strictEqual((await env.woItems.channelMembers.select({ channelId: A, memberId: 'out-1' })).length, 0, '非成員不得藉 ackChannel 自我加入')
            //任務
            assert.strictEqual(await rejKey(() => gf.claimTask(MEMBER, taskB)), 'errTaskNotFound')
            assert.strictEqual((await env.woItems.tasks.select({ id: taskB }))[0].state, 'pending')
            assert.strictEqual((await gf.claimTask(MEMBER, taskA)).state, 'running')
            assert.strictEqual(await rejKey(() => gf.respondTask(OUT, taskA, 'r', 'done')), 'errTaskNotFound')
            assert.strictEqual((await env.woItems.tasks.select({ id: taskA }))[0].state, 'running')
            //管理員
            assert.strictEqual((await gf.claimTask(ADMIN, taskB)).state, 'running')
            //檔案
            assert.strictEqual(await rejKey(() => gf.uploadFile(OUT, { name: 'a.png', type: 'image/png', dataBase64: PNG })), KEY_NOT_MEMBER)
            let f = await gf.uploadFile(MEMBER, { name: 'a.png', type: 'image/png', dataBase64: PNG })
            assert.strictEqual(await rejKey(() => gf.getFileInfo(OUT, f.id)), KEY_NOT_MEMBER)
            assert.strictEqual((await gf.getFileInfo(MEMBER, f.id)).id, f.id)
            assert.strictEqual(await rejKey(() => gf.getFile(OUT, f.id)), KEY_NOT_MEMBER)
            assert.ok((await gf.getFile(MEMBER, f.id)).buf.length > 0)
        }).finally(dbfClean)
    })

    it('A8 清單與統計只回有權看之頻道: getChannelsList / getStats', async function() {
        await mkWorld('access-a8', async ({ gf, A, B }) => {
            let ids = async (c) => (await gf.getChannelsList(c)).map((x) => x.id).sort()
            assert.deepStrictEqual(await ids(ADMIN), [A, B].sort())
            assert.deepStrictEqual(await ids(MEMBER), [A])
            assert.deepStrictEqual(await ids(OUT), [])
            let s = async (c) => await gf.getStats(c)
            assert.deepStrictEqual([(await s(ADMIN)).channels, (await s(ADMIN)).tasks.total, (await s(ADMIN)).messages], [2, 2, 2])
            assert.deepStrictEqual([(await s(MEMBER)).channels, (await s(MEMBER)).tasks.total, (await s(MEMBER)).messages], [1, 1, 1])
            assert.deepStrictEqual([(await s(OUT)).channels, (await s(OUT)).tasks.pending, (await s(OUT)).messages], [0, 0, 0])
            //agentId 過濾(HTTP getChannels?agentId=)後仍只回有權看之頻道(兩頻道同一主責 agent: 若不收斂則成員會取得 A 與 B)
            let idsOf = async (c, ag) => (await gf.getChannelsList(c, ag)).map((x) => x.id).sort()
            assert.deepStrictEqual(await idsOf(ADMIN, 'agent-x'), [A, B].sort())
            assert.deepStrictEqual(await idsOf(MEMBER, 'agent-x'), [A])
            assert.deepStrictEqual(await idsOf(OUT, 'agent-x'), [])
            assert.deepStrictEqual(await idsOf(MEMBER, 'any-agent'), [])
        })
    })

    it('A2c remember 序號: 晚完成但較早開始之驗證不得蓋掉較晚開始者之角色(外審 opus#7 / sol#7)', async function() {
        await mkWorld('access-a2c', async ({ access }) => {
            let s1 = access.nextSeq()
            let s2 = access.nextSeq()
            assert.ok(s2 > s1, '序號單調遞增')
            access.remember({ id: 'u1', isAdmin: 'n' }, s2) //較晚開始者先完成
            access.remember({ id: 'u1', isAdmin: 'y' }, s1) //較早開始者後完成: 不得覆蓋
            assert.deepStrictEqual(await access.callerOf('u1'), { id: 'u1', isAdmin: false })
            let s3 = access.nextSeq()
            access.remember({ id: 'u1', isAdmin: 'y' }, s3) //更晚開始者可覆蓋
            assert.deepStrictEqual(await access.callerOf('u1'), { id: 'u1', isAdmin: true })
            access.remember({ id: 'u1', isAdmin: 'n' }, s3) //同序號(同一次驗證之重寫)可覆寫
            assert.deepStrictEqual(await access.callerOf('u1'), { id: 'u1', isAdmin: false })
            access.remember({ id: 'u2', isAdmin: 'y' }, s1) //不同 userId 互不影響
            assert.deepStrictEqual(await access.callerOf('u2'), { id: 'u2', isAdmin: true })
        })
    })

    it('A10 封存讀取: 冷表有內容時, 成員只讀得所屬頻道之封存任務與訊息, 非所屬頻道被拒(外審 sol#9)', async function() {
        await mkWorld('access-a10', async ({ env, gf, A, B, taskA, taskB }) => {
            let ta = (await env.woItems.tasks.select({ id: taskA }))[0]
            let tb = (await env.woItems.tasks.select({ id: taskB }))[0]
            await env.woItems.tasksArchive.save({ ...ta, id: 'arch-task-a' })
            await env.woItems.tasksArchive.save({ ...tb, id: 'arch-task-b' })
            let ma = (await env.woItems.messages.select({ channelId: A }))[0]
            let mb = (await env.woItems.messages.select({ channelId: B }))[0]
            await env.woItems.messagesArchive.save({ ...ma, id: 'arch-msg-a' })
            await env.woItems.messagesArchive.save({ ...mb, id: 'arch-msg-b' })
            let at = await gf.getArchivedTasks(MEMBER, A)
            assert.deepStrictEqual(at.map((x) => x.id), ['arch-task-a'], '成員讀所屬頻道: 只得該頻道之封存任務')
            let am = await gf.getArchivedMessages(MEMBER, A)
            assert.deepStrictEqual(am.map((x) => x.id), ['arch-msg-a'])
            assert.strictEqual(await rejKey(() => gf.getArchivedTasks(MEMBER, B)), KEY_NOT_MEMBER)
            assert.strictEqual(await rejKey(() => gf.getArchivedMessages(MEMBER, B)), KEY_NOT_MEMBER)
            assert.strictEqual(await rejKey(() => gf.getArchivedTasks(OUT, A)), KEY_NOT_MEMBER)
            assert.deepStrictEqual((await gf.getArchivedTasks(ADMIN, B)).map((x) => x.id), ['arch-task-b'], '管理員讀任一頻道')
        })
    })

    it('A11 ackChannel: 授權通過後成員列被管理員移除, 一般使用者不得藉缺列路徑重新加回; 管理員仍可建列(外審 opus#1 / sol#8)', async function() {
        await mkWorld('access-a11', async ({ env, gf, A }) => {
            let row = (await env.woItems.channelMembers.select({ channelId: A, memberId: 'member-1' }))[0]
            let t = env.woItems.channelMembers
            let orig = t.select
            let g = gate()
            let reached = gate()
            let n = 0
            t.select = async (...a) => {
                let r = await orig.apply(t, a)
                n += 1
                if (n === 1) { //第 1 次 select 為 requireChannel 之成員檢查: 通過後暫停, 讓管理員於授權檢查與 ack 之間移除成員列
                    reached.open()
                    await g.promise
                }
                return r
            }
            let p = gf.ackChannel(MEMBER, A, 'cursor-1')
            //各等待皆設上限: 若授權檢查被略過, 第 1 次 select 會落在 ack 之實體鎖內, 刪除成員會與之互鎖——此時應「失敗」而非懸置
            let st1 = await Promise.race([reached.promise.then(() => 'paused'), sleep(3000).then(() => 'timeout')])
            t.select = orig
            if (st1 !== 'paused') {
                g.open()
                await rejKey(() => p)
                assert.fail('授權檢查之成員查詢未發生(requireChannel 被略過?)')
            }
            let del = env.pc.deleteChannelMember('admin-1', row.id)
            let st2 = await Promise.race([del.then(() => 'deleted'), sleep(2000).then(() => 'blocked')])
            if (st2 !== 'deleted') {
                g.open()
                await rejKey(() => del)
                await rejKey(() => p)
                assert.fail('刪除成員被 ack 之實體鎖擋住: 成員查詢發生於實體鎖內, 即授權檢查未先於 ack')
            }
            g.open()
            assert.strictEqual(await rejKey(() => p), KEY_NOT_MEMBER)
            assert.strictEqual((await env.woItems.channelMembers.select({ channelId: A, memberId: 'member-1' })).length, 0, '被移除者不得重新建列')
            //對照: 管理員 ack 缺列路徑可建列(游標列, 修前行為不變)
            await gf.ackChannel(ADMIN, A, 'cursor-2')
            let ar = await env.woItems.channelMembers.select({ channelId: A, memberId: 'admin-1' })
            assert.strictEqual(ar.length, 1)
            assert.strictEqual(ar[0].lastSeenMessageId, 'cursor-2')
        })
    })

    it('A9 createAccess / createGuardedFuncs 缺依賴即 fail-fast', async function() {
        assert.throws(() => createAccess({}), /invalid deps of access/)
        assert.throws(() => createGuardedFuncs({}), /invalid deps of createGuardedFuncs/)
        await withEnv('access-a9', async (env) => {
            let access = createAccess({ woItems: env.woItems, srLog: { info() {}, warn() {}, error() {} } })
            assert.throws(() => createGuardedFuncs({ access, pc: env.pc }), /invalid deps of createGuardedFuncs/)
        })
    })

})
