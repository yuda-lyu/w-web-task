<template>
    <aside
        data-fmid="channel-tree"
        class="tree-panel"
        :class="{ 'tree-panel--full': isNarrow }"
    >

        <!-- 標題 -->
        <div class="tree-head">
            <h2>
                <WIcon
                    :icon="mdiForumOutline"
                    :color="'#0d9488'"
                    :size="18"
                ></WIcon>
                <span>{{$t('mmChannels')}}</span>
            </h2>
        </div>

        <!-- 搜尋 -->
        <div class="search">
            <span class="search-ic">
                <WIcon
                    :icon="mdiMagnify"
                    :color="'#a8a29e'"
                    :size="16"
                ></WIcon>
            </span>
            <input
                data-fmid="channel-search"
                :value="keyword"
                :placeholder="$t('searchChannelPlaceholder')"
                @input="onInputKeyword"
            >
        </div>

        <!-- tree -->
        <div class="tree" data-fmid="channel-tree-list">

            <template v-if="rows.length > 0">

                <div
                    :key="row.key"
                    v-for="row in rows"
                >

                    <!-- 群組節點 (專案 / 群組 ... 各層) -->
                    <div
                        v-if="row.type==='group'"
                        :class="`tnode ${row.depth===0 ? 'proj-row' : 'group-row'}`"
                        :style="`padding-left:${7 + row.depth*14}px;`"
                        @click="onToggleGroup(row.key)"
                    >
                        <WIcon
                            :icon="row.collapsed ? mdiMenuRight : mdiMenuDown"
                            :color="'#a8a29e'"
                            :size="17"
                        ></WIcon>
                        <WIcon
                            :icon="mdiFolderOutline"
                            :color="'#a8a29e'"
                            :size="15"
                        ></WIcon>
                        <span class="grp-nm">{{row.label}}</span>
                    </div>

                    <!-- 頻道葉節點 -->
                    <div
                        v-else
                        :class="`chan ${currentChannelId===row.channel.id ? 'active' : ''}`"
                        :style="`padding-left:${16 + row.depth*14}px;`"
                        :data-fmid="`channel-item-${row.channel.id}`"
                        @click="onClickChannel(row.channel.id)"
                    >
                        <span class="hash">
                            <WIcon
                                :icon="mdiPound"
                                :color="currentChannelId===row.channel.id ? '#0d9488' : '#a8a29e'"
                                :size="13"
                            ></WIcon>
                        </span>
                        <span class="nm">{{row.channel.name || row.channel.id}}</span>
                        <span
                            class="dot"
                            :style="`background:${hasAgent(row.channel) ? 'var(--st-done)' : 'var(--border-2)'};`"
                            :title="hasAgent(row.channel) ? $t('agentOnline') : $t('noAgentAssigned')"
                        ></span>
                    </div>

                </div>

            </template>

            <div class="tree-empty" v-else>
                {{$t('channelTreeEmpty')}}
            </div>

        </div>

    </aside>
</template>

<script>
import { mdiForumOutline, mdiMagnify, mdiMenuDown, mdiMenuRight, mdiFolderOutline, mdiPound } from '@mdi/js/mdi.js'
import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import sortBy from 'lodash-es/sortBy.js'
import isestr from 'wsemi/src/isestr.mjs'
import WIcon from 'w-component-vue/src/components/WIcon.vue'


export default {
    components: {
        WIcon,
    },
    props: {
    },
    data: function() {
        return {
            mdiForumOutline,
            mdiMagnify,
            mdiMenuDown,
            mdiMenuRight,
            mdiFolderOutline,
            mdiPound,

            keyword: '',
            collapsed: {}, //{ groupKey: true } 收合狀態
        }
    },
    computed: {

        isNarrow: function() {
            let vo = this
            return get(vo, '$store.state.isNarrow', false)
        },

        currentChannelId: function() {
            let vo = this
            return get(vo, '$store.state.currentChannelId', '')
        },

        channels: function() {
            let vo = this
            let rs = get(vo, '$store.state.channels')
            if (!rs) {
                rs = []
            }
            //依 order, 再 name 排序 (穩定呈現)
            rs = sortBy(rs, ['order', 'name', 'id'])
            return rs
        },

        //依關鍵字過濾後之頻道 (比對 name 或 levels)
        channelsFiltered: function() {
            let vo = this
            let kw = vo.keyword.trim().toLowerCase()
            if (!isestr(kw)) {
                return vo.channels
            }
            return vo.channels.filter((c) => {
                let nm = get(c, 'name', '').toLowerCase()
                let lv = get(c, 'levels', '').toLowerCase()
                return nm.indexOf(kw) >= 0 || lv.indexOf(kw) >= 0
            })
        },

        //把頻道依 levels 建巢狀, 再攤平成可渲染列 (含 group / channel, 各帶 depth)
        rows: function() {
            let vo = this

            //搜尋中時強制展開全部 (忽略 collapsed), 以便看到命中頻道
            let searching = isestr(vo.keyword.trim())

            //tree: { groups:{ name:{node} }, channels:[] }
            let buildNode = () => {
                return { groups: {}, channels: [] }
            }
            let root = buildNode()

            each(vo.channelsFiltered, (c) => {

                //segs: levels 以英文句點分隔; 空字串 → 未分類
                let levels = get(c, 'levels', '')
                let segs = []
                if (isestr(levels)) {
                    segs = levels.split('.').map((s) => s.trim()).filter((s) => isestr(s))
                }
                if (segs.length === 0) {
                    segs = [vo.$t('uncategorized')]
                }

                //逐層下探
                let node = root
                each(segs, (seg) => {
                    if (!node.groups[seg]) {
                        node.groups[seg] = buildNode()
                    }
                    node = node.groups[seg]
                })
                node.channels.push(c)
            })

            //flatten (DFS, group 在前 channel 在後)
            let out = []
            let walk = (node, depth, pathPre) => {

                //group 名稱排序穩定
                let gkeys = sortBy(Object.keys(node.groups))
                each(gkeys, (gk) => {
                    let key = `${pathPre}/${gk}`
                    let isCollapsed = !searching && vo.collapsed[key] === true
                    out.push({
                        type: 'group',
                        key,
                        label: gk,
                        depth,
                        collapsed: isCollapsed,
                    })
                    if (!isCollapsed) {
                        walk(node.groups[gk], depth + 1, key)
                    }
                })

                //channels
                each(node.channels, (c) => {
                    out.push({
                        type: 'channel',
                        key: `ch:${c.id}`,
                        channel: c,
                        depth,
                    })
                })

            }
            walk(root, 0, '')

            return out
        },

    },
    methods: {

        hasAgent: function(channel) {
            return isestr(get(channel, 'agentId', ''))
        },

        onInputKeyword: function(ev) {
            let vo = this
            vo.keyword = get(ev, 'target.value', '')
        },

        onToggleGroup: function(key) {
            let vo = this
            if (!isestr(key)) {
                return
            }
            //切換收合 (Vue2 須用 $set 確保響應)
            let cur = vo.collapsed[key] === true
            vo.$set(vo.collapsed, key, !cur)
        },

        onClickChannel: function(id) {
            let vo = this
            if (!isestr(id)) {
                return
            }
            vo.$store.commit(vo.$store.types.UpdateCurrentChannelId, id)
        },

    }
}
</script>

<style scoped>
.tree-panel {
    width: 282px;
    background: var(--surface);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    height: 100%;
}
/* RWD 窄屏: 頻道樹佔滿寬度 (master-detail 之 master 全寬) */
.tree-panel--full {
    width: 100%;
}
.tree-head {
    padding: 16px 16px 8px;
}
.tree-head h2 {
    font-size: 15px;
    font-weight: 800;
    letter-spacing: -.01em;
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text);
    margin: 0;
}
.search {
    margin: 6px 14px 8px;
    position: relative;
}
.search .search-ic {
    position: absolute;
    left: 9px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
}
.search input {
    box-sizing: border-box; /* width 含 padding+border, 否則 100% 加上 40px padding 會爆出面板 */
    width: 100%;
    padding: 7px 10px 7px 30px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: inherit;
    font-size: 12.5px;
    background: var(--bg);
    outline: none;
    color: var(--text);
    transition: border-color .12s, box-shadow .12s, background .12s;
}
.search input::placeholder {
    color: var(--text-3);
}
.search input:focus {
    border-color: var(--accent);
    background: #fff;
    box-shadow: 0 0 0 3px var(--accent-soft);
}
.tree {
    flex: 1;
    overflow-y: auto;
    padding: 4px 8px 14px;
}
.tnode {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 7px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: var(--text-2);
    font-size: 12.5px;
    user-select: none;
}
.tnode:hover {
    background: var(--bg);
}
.tnode.proj-row {
    font-weight: 700;
    color: var(--text-2);
    letter-spacing: .04em;
    font-size: 11.5px;
    text-transform: uppercase;
}
.tnode.group-row {
    font-weight: 700;
    color: var(--text-2);
    font-size: 12.5px;
}
.tnode .grp-nm {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.chan {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 5px 8px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: var(--text-2);
    font-size: 12.5px;
    position: relative;
}
.chan:hover {
    background: var(--bg);
}
.chan.active {
    background: var(--accent-tint);
    color: var(--accent-700);
    font-weight: 700;
    box-shadow: inset 2px 0 0 var(--accent);
}
.chan .hash {
    display: flex;
    align-items: center;
}
.chan .nm {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.chan .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    box-shadow: 0 0 0 2px #fff;
    flex-shrink: 0;
}
.tree-empty {
    padding: 14px 10px;
    font-size: 12px;
    color: var(--text-3);
}
</style>
