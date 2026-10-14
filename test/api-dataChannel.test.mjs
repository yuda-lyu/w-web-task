//api-dataChannel: 資料通道(/api/main)之表操作授權與連線閘之契約測試(需 backend, 不需 browser)
//對應 spec/設計要點與取捨.md D17 決策 2(表操作只開 select)、決策 3(連線閘套用 verifyClientUser); CLAUDE_rulebook.md D17-2 / D17-3
//  DC-01「表操作只開 select」→ 函數清單含兩表之 select、不含任一表之 insert / save / del
//  DC-02「寫入一律經 kpFunExt; 直打表操作改收 invalid func[…]」→ 六個直寫函數皆被拒, 且以 kpFunExt 讀回之資料不變
//  DC-03「select 供前端同步」→ 已認證之管理者可 select 兩表, 含種子頻道
//  DC-04「被 verifyClientUser 拒絕者, 其資料通道請求一律 permission denied, 並記 srLog.error({ event:'verifyConn', err:'errUserNoPermission' })」
//        → 非管理者之讀與寫皆被拒、寫入未落地、srLog 逐筆; 與登入檢查 /api/getUserByToken 同一判定(errUserNoPermission)
//測試權杖(srv.mjs, 受 NODE_ENV!=='production' 守門): 'sys'(id-for-admin, isAdmin='y')、'{token-for-nonadmin}'(id-for-nonadmin, isAdmin='n'; srv.mjs 之 verifyClientUser 只放行 isAdmin='y')
//資料: 共用 harness 開場之種子(api 各檔不逐案重置); 本檔新建之頻道於 after 以 kpFunExt 刪除
//跑法: npx mocha test/api-dataChannel.test.mjs --timeout 180000(須持測試鎖)
import assert from 'assert'
import { startServersOnce } from './tools/e2e-setup.mjs'
import { httpGet, postMain, outputOf, snapshotLogs, waitRecords, proj } from './tools/apiProbe.mjs'


const TK_ADMIN = 'sys'
const TK_NONADMIN = '{token-for-nonadmin}'
const CHANNEL_DEMO = 'id-for-channel-demo' //g.initialData.mjs 之種子頻道
const TABLES = ['channels', 'channelMembers']
const METHODS_WRITE = ['insert', 'save', 'del']


//kpFunExt 呼叫(以管理者): 成功回 msg, 否則拋錯
async function kpfun(func, args) {
    let r = await postMain(TK_ADMIN, TK_ADMIN, func, args)
    let out = outputOf(r)
    assert.ok(out && out.state === 'success', `${func} 應成功, 實得 ${r.text}`)
    return out.msg
}

async function channelsByName(name) {
    let cs = await kpfun('getChannelsList', [])
    return cs.filter((c) => c.name === name)
}


describe('api-dataChannel(資料通道之表操作只開 select、連線閘套用 verifyClientUser, D17)', function() {
    this.timeout(180000) //首次起後端含 seedDb

    let ts = Date.now()
    let nameProbe = `dc-probe-${ts}`
    let nameNonadmin = `dc-nonadmin-${ts}`
    let idProbe = ''

    before(async function() {
        await startServersOnce({ backendOnly: true })
        //本檔專用頻道(經 kpFunExt 建立, 供直寫嘗試之對象)
        await kpfun('saveChannel', [{ name: nameProbe }])
        let cs = await channelsByName(nameProbe)
        assert.strictEqual(cs.length, 1, `頻道 ${nameProbe} 應恰 1 列`)
        idProbe = cs[0].id
    })

    after(async function() {
        //清理: 本檔建立之頻道(含修前紅燈時直寫或非管理者寫入者)一律以 kpFunExt 刪除; 刪後回驗
        let names = [nameProbe, nameNonadmin, 'dc-direct-insert', 'dc-hijacked']
        let cs = await kpfun('getChannelsList', [])
        for (let c of cs.filter((x) => names.includes(x.name) || x.id === 'dc-direct-insert')) {
            let ms = await kpfun('getChannelMembers', [c.id])
            for (let m of ms) {
                await kpfun('deleteChannelMember', [m.id])
            }
            await kpfun('deleteChannel', [c.id])
        }
        let left = (await kpfun('getChannelsList', [])).filter((x) => names.includes(x.name))
        assert.deepStrictEqual(left.map((x) => x.name), [], '本檔建立之頻道應已清除')
    })


    it('DC-01 函數清單: 表操作只有 channels.select、channelMembers.select, 無任一表之 insert / save / del', async function() {
        let r = await postMain(TK_ADMIN, TK_ADMIN, '[sys:getFuncList]')
        let out = outputOf(r)
        assert.ok(out && out.state === 'success' && Array.isArray(out.msg), `應取得函數清單, 實得 ${r.text}`)
        let fs = out.msg
        for (let t of TABLES) {
            assert.ok(fs.includes(`${t}.select`), `應含 ${t}.select, 實得 ${fs.join(', ')}`)
            for (let m of METHODS_WRITE) {
                assert.ok(!fs.includes(`${t}.${m}`), `不得含 ${t}.${m}(寫入一律經 kpFunExt), 實得 ${fs.join(', ')}`)
            }
        }
        //kpFunExt 之寫入入口仍在(寫入改走之處)
        for (let f of ['saveChannel', 'deleteChannel', 'saveChannelMember', 'deleteChannelMember']) {
            assert.ok(fs.includes(f), `應含 kpFunExt ${f}`)
        }
    })

    it('DC-02 直打表操作之寫入(六個函數)皆回 invalid func[…], 且以 kpFunExt 讀回之頻道與成員不變', async function() {
        let member = { id: 'dc-direct-member', channelId: idProbe, memberId: 'agent-x', memberType: 'agent', lastSeenMessageId: 'zzz-cursor-overwrite', isActive: 'y' }
        let attempts = [
            ['channels.insert', [[{ id: 'dc-direct-insert', name: 'dc-direct-insert', isActive: 'y' }]]],
            ['channels.save', [[{ id: idProbe, name: 'dc-hijacked', agentId: 'evil-agent' }]]],
            ['channels.del', [{ id: idProbe }]],
            ['channelMembers.insert', [[member]]],
            ['channelMembers.save', [[member]]],
            ['channelMembers.del', [{ id: 'dc-direct-member' }]],
        ]
        for (let [func, args] of attempts) {
            let r = await postMain(TK_ADMIN, TK_ADMIN, func, args)
            assert.deepStrictEqual(outputOf(r), { state: 'error', msg: `invalid func[${func}]` }, `${func} 應被拒(函數不綁定), 實得 ${r.text}`)
        }
        //資料未變: 專用頻道仍在且名稱、agentId 未被改寫; 直寫新增之頻道與成員列不存在
        let cs = await kpfun('getChannelsList', [])
        let c = cs.find((x) => x.id === idProbe)
        assert.ok(c, '專用頻道應仍存在(channels.del 未生效)')
        assert.strictEqual(c.name, nameProbe, 'channels.save 不得改寫名稱')
        assert.strictEqual(c.agentId, '', 'channels.save 不得改寫 agentId')
        assert.ok(!cs.some((x) => x.id === 'dc-direct-insert'), 'channels.insert 不得新增頻道')
        let ms = await kpfun('getChannelMembers', [idProbe])
        assert.ok(!ms.some((m) => m.memberId === 'agent-x'), `channelMembers 直寫不得落地, 實得 ${JSON.stringify(ms)}`)
    })

    it('DC-03 同步用之 select: 管理者可 select 兩表, channels 含種子頻道', async function() {
        let rc = await postMain(TK_ADMIN, TK_ADMIN, 'channels.select', [])
        let oc = outputOf(rc)
        assert.ok(oc && oc.state === 'success' && Array.isArray(oc.msg), `channels.select 應成功, 實得 ${rc.text}`)
        assert.ok(oc.msg.some((x) => x.id === CHANNEL_DEMO), `應含種子頻道 ${CHANNEL_DEMO}`)
        let rm = await postMain(TK_ADMIN, TK_ADMIN, 'channelMembers.select', [])
        let om = outputOf(rm)
        assert.ok(om && om.state === 'success' && Array.isArray(om.msg), `channelMembers.select 應成功, 實得 ${rm.text}`)
    })

    it('DC-04 被 verifyClientUser 拒絕之非管理者: 資料通道之讀與寫皆 permission denied、寫入未落地; srLog 逐筆 verifyConn errUserNoPermission; 登入檢查同為 errUserNoPermission', async function() {
        let snap = snapshotLogs()
        let rRead = await postMain(TK_NONADMIN, TK_NONADMIN, 'getWebInfor')
        assert.strictEqual(rRead.status, 200)
        assert.strictEqual(rRead.obj && rRead.obj.error, 'permission denied', `非管理者之讀應被連線閘拒絕, 實得 ${rRead.text}`)
        let rWrite = await postMain(TK_NONADMIN, TK_NONADMIN, 'saveChannel', [{ name: nameNonadmin }])
        assert.strictEqual(rWrite.obj && rWrite.obj.error, 'permission denied', `非管理者之寫應被連線閘拒絕, 實得 ${rWrite.text}`)
        let rLogin = await httpGet(`/api/getUserByToken?token=${encodeURIComponent(TK_NONADMIN)}`)
        assert.deepStrictEqual(rLogin.body, { state: 'error', msg: 'errUserNoPermission' }, `登入檢查應同為 errUserNoPermission, 實得 ${rLogin.text}`)
        //srLog: 連線閘之拒絕各 1 筆(只記 key 與 apiType, 不記權杖)+ 登入檢查之呼叫點 1 筆
        let { text, recs } = await waitRecords(snap, 3)
        assert.ok(!text.includes('token-for-nonadmin'), 'srLog 不得含測試權杖')
        assert.deepStrictEqual(recs.map(proj), [
            { level: 50, event: 'verifyConn', err: 'errUserNoPermission' },
            { level: 50, event: 'verifyConn', err: 'errUserNoPermission' },
            { level: 50, event: 'api/getUserByToken', err: 'errUserNoPermission' },
        ])
        assert.ok(recs.slice(0, 2).every((r) => r.apiType === 'main'), 'verifyConn 之記錄應帶 apiType main')
        //寫入未落地
        assert.deepStrictEqual(await channelsByName(nameNonadmin), [], '非管理者之 saveChannel 不得落地')
    })

})
