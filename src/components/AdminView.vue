<template>
    <div class="admin-shell">

        <!-- 左側子選單 panel (RWD 窄屏: 改頂部橫向 tab bar) -->
        <div class="admin-sub">

            <!-- 頂部標題 -->
            <div class="admin-sub-title">
                <div style="font-size:15px; font-weight:800; color:var(--text);">
                    {{$t('mmAdmin')}}
                </div>
            </div>

            <!-- 子選單項目 -->
            <div class="admin-sub-items">
                <div
                    v-for="item in subItems"
                    :key="item.key"
                    :data-fmid="'admin-sub-' + item.key"
                    class="sub-item"
                    :class="{ 'sub-item--active': subKey === item.key }"
                    @click="onClickSub(item.key)"
                >
                    <WIcon
                        :icon="item.icon"
                        :color="subKey === item.key ? '#0f766e' : '#57534e'"
                        :size="17"
                    ></WIcon>
                    <span>{{$t(item.key)}}</span>
                </div>
            </div>

        </div>

        <!-- 右側內容 -->
        <div class="admin-content">

            <LayoutContentChannels
                v-if="subKey === 'mmChannels'"
                :drawer="true"
            ></LayoutContentChannels>

            <LayoutContentMembers
                v-else-if="subKey === 'mmMembers'"
            ></LayoutContentMembers>

            <LayoutContentTasks
                v-else-if="subKey === 'mmTasks'"
                :drawer="true"
            ></LayoutContentTasks>

        </div>

    </div>
</template>

<script>
import { mdiForumOutline, mdiAccountGroupOutline, mdiClipboardCheckOutline } from '@mdi/js/mdi.js'
import WIcon from 'w-component-vue/src/components/WIcon.vue'
import LayoutContentChannels from './LayoutContentChannels.vue'
import LayoutContentMembers from './LayoutContentMembers.vue'
import LayoutContentTasks from './LayoutContentTasks.vue'


export default {
    components: {
        WIcon,
        LayoutContentChannels,
        LayoutContentMembers,
        LayoutContentTasks,
    },
    data: function() {
        return {
            mdiForumOutline,
            mdiAccountGroupOutline,
            mdiClipboardCheckOutline,

            subKey: 'mmChannels',

            subItems: [
                { key: 'mmChannels', icon: mdiForumOutline },
                { key: 'mmMembers', icon: mdiAccountGroupOutline },
                { key: 'mmTasks', icon: mdiClipboardCheckOutline },
            ],
        }
    },
    methods: {

        onClickSub: function(key) {
            // console.log('method onClickSub', key)

            let vo = this
            vo.subKey = key
        },

    }
}
</script>

<style scoped>
.admin-shell {
    height: 100%;
    display: flex;
    background: var(--bg);
}
.admin-sub {
    width: 282px;
    flex-shrink: 0;
    background: var(--surface);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
}
.admin-sub-title {
    padding: 16px 16px 8px;
}
.admin-content {
    flex: 1;
    min-width: 0;
    height: 100%;
}
.sub-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    cursor: pointer;
    font-size: 12.5px;
    color: var(--text-2);
}
.sub-item:hover {
    background: var(--bg);
}
.sub-item--active {
    background: var(--accent-tint);
    color: var(--accent-700);
    font-weight: 700;
    box-shadow: inset 2px 0 0 var(--accent);
}

/* RWD 窄屏: admin 改上下堆疊 — 子選單為頂部橫向 tab bar, 內容於下方全寬 */
@media (max-width: 767px) {
    .admin-shell {
        flex-direction: column;
    }
    .admin-sub {
        width: 100%;
        flex-shrink: 0;
        border-right: none;
        border-bottom: 1px solid var(--border);
    }
    .admin-sub-title {
        display: none;
    }
    .admin-sub-items {
        display: flex;
        flex-direction: row;
    }
    .admin-sub-items .sub-item {
        flex: 1;
        justify-content: center;
        padding: 12px 8px;
    }
    .sub-item--active {
        box-shadow: inset 0 -2px 0 var(--accent);
    }
    .admin-content {
        flex: 1;
        min-height: 0;
    }
}
</style>
