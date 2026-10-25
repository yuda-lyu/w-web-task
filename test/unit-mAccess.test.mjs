//unit-mAccess: 前端依 token 反查之 isAdmin 決定是否顯示管理入口之純邏輯(src/plugins/mAccess.mjs)
//對應 spec/設計要點與取捨.md D20 決策 7: 前端隱藏只是便利、後端 server/access.mjs 為權威; 管理員之畫面與標準圖不變
//  U1 明確為非管理員('n')者隱藏; 管理員('y')顯示
//  U2 尚未取得使用者資料(空物件 / 未定義 / 缺欄位)不隱藏: 避免登入後首繪時管理入口閃現後消失(後端仍把關)
//  U3 非預期值('Y'、true 等)不當管理員也不隱藏——與後端不同: 後端 isAdminUser 嚴格比對 'y', 前端只在確知為 'n' 時隱藏, 不影響授權
import assert from 'assert'
import { canManage } from '../src/plugins/mAccess.mjs'


describe('unit-mAccess(前端管理入口顯隱判準)', function() {

    it('U1 isAdmin 為 y 顯示、為 n 隱藏', function() {
        assert.strictEqual(canManage({ id: 'u1', isAdmin: 'y' }), true)
        assert.strictEqual(canManage({ id: 'u2', isAdmin: 'n' }), false)
    })

    it('U2 尚未取得使用者資料(空物件、未定義、null、缺 isAdmin)不隱藏', function() {
        for (let u of [{}, undefined, null, { id: 'u1' }, 'str', 0]) {
            assert.strictEqual(canManage(u), true, JSON.stringify(u))
        }
    })

    it('U3 非預期值只在確知為 n 時才隱藏', function() {
        for (let v of ['Y', true, 1, '', ' n', 'N']) {
            assert.strictEqual(canManage({ isAdmin: v }), true, JSON.stringify(v))
        }
    })

})
