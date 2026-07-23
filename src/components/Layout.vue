<template>
    <div
        data-fmid="app-shell"
        style="height:100svh; display:flex; overflow:hidden; background:var(--bg);"
    >

        <!-- 左1 rail (近黑) -->
        <Rail></Rail>

        <!-- 右側依 section 切換 -->
        <div style="flex:1; min-width:0; height:100%;">

            <template v-if="syncState">

                <ChannelsWorkspace v-if="section==='channels'"></ChannelsWorkspace>

                <StatsView v-else-if="section==='stats'"></StatsView>

                <AdminView v-else-if="section==='admin'"></AdminView>

            </template>

            <div
                style="padding:24px; font-size:0.9rem; color:var(--text-2);"
                v-else
            >
                {{$t('waitingData')}}
            </div>

        </div>

    </div>
</template>

<script>
import get from 'lodash-es/get.js'
import Rail from './Rail.vue'
import ChannelsWorkspace from './ChannelsWorkspace.vue'
import StatsView from './StatsView.vue'
import AdminView from './AdminView.vue'


export default {
    components: {
        Rail,
        ChannelsWorkspace,
        StatsView,
        AdminView,
    },
    props: {
    },
    data: function() {
        return {
            firstSetting: true,
        }
    },
    mounted: function() {
        let vo = this

        //firstSetting: 依 webInfor 設定初始語系 (沿用舊 Layout 行為, 避免移除既有語系初始化)
        if (vo.firstSetting) {
            let language = get(vo, 'webInfor.language', '')
            vo.$ui.setLang(language, 'layout mounted')
            vo.firstSetting = false
        }

        //RWD: 監聽視窗寬度維護 isNarrow (窄屏用 master-detail 堆疊)。BREAKPOINT=768 (rail 64 + 樹 282 + 內容最小需求下限)。
        vo.updateNarrow()
        window.addEventListener('resize', vo.updateNarrow)

    },
    beforeDestroy: function() {
        let vo = this
        window.removeEventListener('resize', vo.updateNarrow)
    },
    computed: {

        syncState: function() {
            let vo = this
            return get(vo, '$store.state.syncState')
        },

        section: function() {
            let vo = this
            return get(vo, '$store.state.section', 'channels')
        },

        webInfor: function() {
            let vo = this
            return get(vo, '$store.state.webInfor', {})
        },

    },
    methods: {
        updateNarrow: function() {
            let vo = this
            let narrow = window.innerWidth < 768
            if (get(vo, '$store.state.isNarrow') !== narrow) {
                vo.$store.commit(vo.$store.types.UpdateIsNarrow, narrow)
            }
        },
    }
}
</script>

<style scoped>
</style>
