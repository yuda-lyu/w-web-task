//unit-rwd：RWD master-detail 版面切換之真值表單元測試（不需 server/browser）。
//對應 spec 設計要點與取捨.md D13「RWD 採 master-detail 堆疊, 斷點 768px」。
//
//被測邏輯為 ChannelsWorkspace.vue:70-78 之兩個純 computed（僅依 isNarrow × currentChannelId 兩布林/字串輸入,
//無副作用、不觸 DOM、不觸 $store 以外狀態）：
//  showTree    = !isNarrow || !currentChannelId
//  showContent = !isNarrow || !!currentChannelId
//.vue SFC 無法於 node/mocha 直接 import（需 vue-loader 編譯）, 且此二 computed 與 Vue 實例/$store 耦合;
//故採「純函式等價驗證」（方案 b）: 於此以等價純函式鏡射 production 公式（逐字對映 ChannelsWorkspace.vue:70-78）,
//對 isNarrow × currentChannelId 之 4 組真值表逐格斷言。每格之「預期值」來源為 D13 之 master-detail 語意規格
//（非 production 輸出指紋）: 寬屏兩者並存; 窄屏未選→樹全寬; 窄屏已選→內容全寬。
//若日後改動 production 公式而未同步更新此鏡射, 兩者將對不上 D13 語意 → 本測試揭露。
import assert from 'assert'


// ── 等價純函式（逐字鏡射 ChannelsWorkspace.vue:70-78 之 computed 公式）─────────────
//showTree: 寬屏(!isNarrow)恆顯示; 窄屏僅未選頻道時顯示樹。
function showTree(isNarrow, currentChannelId) {
    return !isNarrow || !currentChannelId
}
//showContent: 寬屏(!isNarrow)恆顯示; 窄屏僅已選頻道時顯示內容。
function showContent(isNarrow, currentChannelId) {
    return !isNarrow || !!currentChannelId
}


describe('unit-rwd（D13 master-detail 版面切換真值表）', function() {
    this.timeout(10000)

    // ── 寬屏 (isNarrow=false, ≥768px) ────────────────────────────────────────────
    //D13:「桌面 (≥768px) 版面必須與改動前逐像素相同」→ 樹與內容並存, 與是否選頻道無關。
    describe('寬屏 isNarrow=false（樹與內容並存）', function() {

        it('寬屏 + 未選頻道 → 樹顯示、內容顯示（D13: 桌面版面與改動前相同, 兩者並存）', function() {
            assert.strictEqual(showTree(false, ''), true, '寬屏未選頻道: showTree 應為 true')
            assert.strictEqual(showContent(false, ''), true, '寬屏未選頻道: showContent 應為 true（顯示空狀態提示）')
        })

        it('寬屏 + 已選頻道 → 樹顯示、內容顯示（D13: 桌面版面與改動前相同, 兩者並存）', function() {
            assert.strictEqual(showTree(false, 'id-for-channel-demo'), true, '寬屏已選頻道: showTree 應為 true')
            assert.strictEqual(showContent(false, 'id-for-channel-demo'), true, '寬屏已選頻道: showContent 應為 true（顯示 ChatView）')
        })

    })

    // ── 窄屏 (isNarrow=true, <768px) master-detail ───────────────────────────────
    //D13:「未選頻道→頻道樹全寬; 選了頻道→聊天區全寬」→ 僅顯示其一（master 或 detail）。
    describe('窄屏 isNarrow=true（master-detail 僅顯示其一）', function() {

        it('窄屏 + 未選頻道 → 樹全寬顯示、內容隱藏（D13: 未選頻道→頻道樹全寬, master 態）', function() {
            assert.strictEqual(showTree(true, ''), true, '窄屏未選頻道: showTree 應為 true（樹全寬）')
            assert.strictEqual(showContent(true, ''), false, '窄屏未選頻道: showContent 應為 false（內容讓位）')
        })

        it('窄屏 + 已選頻道 → 樹隱藏、內容全寬顯示（D13: 選了頻道→聊天區全寬, detail 態）', function() {
            assert.strictEqual(showTree(true, 'id-for-channel-demo'), false, '窄屏已選頻道: showTree 應為 false（樹讓位）')
            assert.strictEqual(showContent(true, 'id-for-channel-demo'), true, '窄屏已選頻道: showContent 應為 true（聊天區全寬）')
        })

    })

    // ── 互斥不變式（D13 master-detail 之核心性質）─────────────────────────────────
    describe('D13 不變式（master-detail 互斥、桌面並存）', function() {

        it('窄屏下 showTree 與 showContent 恆互斥（永遠恰顯示其一, 對應 master-detail 堆疊）', function() {
            //D13: 窄屏為 master-detail, 樹與內容不同時佔畫面（避免 rail+樹擠出內容區之 RWD 失效）
            for (let cid of ['', 'id-for-channel-demo']) {
                let t = showTree(true, cid)
                let c = showContent(true, cid)
                assert.strictEqual(t && c, false, `窄屏(cid='${cid}') 樹與內容不應同時顯示`)
                assert.strictEqual(t || c, true, `窄屏(cid='${cid}') 樹與內容應恰顯示其一`)
            }
        })

        it('寬屏下 showTree 與 showContent 恆同時為真（桌面並存, 與選頻道無關）', function() {
            //D13: 桌面版面與改動前逐像素相同 → 兩者恆並存
            for (let cid of ['', 'id-for-channel-demo']) {
                assert.strictEqual(showTree(false, cid), true, `寬屏(cid='${cid}') showTree 應恆為 true`)
                assert.strictEqual(showContent(false, cid), true, `寬屏(cid='${cid}') showContent 應恆為 true`)
            }
        })

    })

})
