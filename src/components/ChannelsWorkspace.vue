<template>
    <div
        data-fmid="channels-workspace"
        style="height:100%; display:flex; min-width:0; background:var(--bg);"
    >

        <!-- 左2 頻道樹 (RWD 窄屏: 未選頻道時全寬顯示, 選了頻道則讓位給內容) -->
        <ChannelTree v-if="showTree"></ChannelTree>

        <!-- 右側聊天工作區 / 空狀態 (RWD 窄屏: 選了頻道時全寬顯示) -->
        <div
            v-if="showContent"
            style="flex:1; min-width:0; height:100%;"
        >

            <ChatView v-if="currentChannelId"></ChatView>

            <div
                class="empty-state"
                data-fmid="workspace-empty"
                v-else
            >
                <WIcon
                    :icon="mdiForumOutline"
                    :color="'#d6d3d1'"
                    :size="54"
                ></WIcon>
                <div class="empty-text">{{$t('selectChannelToStart')}}</div>
            </div>

        </div>

    </div>
</template>

<script>
import { mdiForumOutline } from '@mdi/js/mdi.js'
import get from 'lodash-es/get.js'
import WIcon from 'w-component-vue/src/components/WIcon.vue'
import ChannelTree from './ChannelTree.vue'
import ChatView from './ChatView.vue'


export default {
    components: {
        WIcon,
        ChannelTree,
        ChatView,
    },
    props: {
    },
    data: function() {
        return {
            mdiForumOutline,
        }
    },
    computed: {

        currentChannelId: function() {
            let vo = this
            return get(vo, '$store.state.currentChannelId', '')
        },

        isNarrow: function() {
            let vo = this
            return get(vo, '$store.state.isNarrow', false)
        },

        //RWD master-detail: 寬屏兩者並存; 窄屏僅顯示其一 (未選頻道→樹; 選了頻道→內容)
        showTree: function() {
            let vo = this
            return !vo.isNarrow || !vo.currentChannelId
        },

        showContent: function() {
            let vo = this
            return !vo.isNarrow || !!vo.currentChannelId
        },

    },
    methods: {
    }
}
</script>

<style scoped>
.empty-state {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    background: var(--bg);
}
.empty-text {
    font-size: 13.5px;
    color: var(--text-3);
    letter-spacing: .01em;
}
</style>
