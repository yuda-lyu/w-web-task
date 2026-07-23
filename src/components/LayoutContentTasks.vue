<template>
    <div
        style="height:100%;"
        v-domresize
        @domresize="resizePanel"
        :changeParams="changeParams"
    >

        <!-- 頭部: 標題 + 頻道選擇器 -->
        <div
            style="background:#fff; border-bottom:1px solid #ddd;"
            v-domresize
            @domresize="resizeHead"
        >

            <div style="padding:10px 10px 10px 20px;">
                <div :style="`display:flex; align-items:center; padding:${drawer?'5px':'5px 5px 5px 20px'};`">

                    <WIcon
                        :icon="mdiClipboardCheckOutline"
                        :color="'#000'"
                        :size="32"
                    ></WIcon>

                    <div style="padding-left:12px;">
                        <div style="font-size:1.4rem; color:#000;">
                            {{$t('mmTasks')}}
                        </div>
                        <div style="padding-top:2px; font-size:0.8rem; color:#666;">
                            {{$t('mmTasksMsg')}}
                        </div>
                    </div>

                </div>
            </div>

            <div style="padding:5px 20px 12px 20px; display:flex; align-items:center;">
                <div style="font-size:0.85rem; color:#444; padding-right:10px; white-space:nowrap;">
                    {{$t('selectChannel')}}
                </div>
                <WTextSelect
                    style="min-width:200px;"
                    :items="channelItems"
                    :value="channelSelected"
                    :keyText="'text'"
                    @input="onChangeChannel"
                >
                    <template v-slot:select="props">
                        {{props.item ? props.item.text : ''}}
                    </template>
                    <template v-slot:item="props">
                        {{props.item ? props.item.text : ''}}
                    </template>
                </WTextSelect>

                <!-- 顯示封存切換: 資料來源切為冷表 (唯讀, 見 spec D12) -->
                <div
                    class="arch-toggle"
                    data-fmid="tasks-show-archived"
                    @click="onToggleArchived"
                >
                    <span class="sw" :class="{ on: showArchived }"></span>
                    <span>{{$t('showArchived')}}</span>
                </div>
            </div>

        </div>

        <!-- 任務清單 -->
        <div :style="`height:${listHeight}px;`">

            <template v-if="channelId">

                <template v-if="!firstLoading && items && items.length > 0">
                    <WAggridVue
                        ref="rftable"
                        :style="`width:100%;`"
                        :height="listHeight"
                        :opt="opt"
                    >
                        <template v-slot:cell-render="props">
                            <template v-if="props.key==='state'">
                                <span :style="`color:${$s.getTaskStateColor(props.value)}; font-weight:bold;`">
                                    {{stateText(props.value)}}
                                </span>
                            </template>
                            <template v-else-if="props.key==='title'">
                                <button
                                    style="width:100%; text-align:left; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; background:transparent; border:none; cursor:pointer; color:#1565c0;"
                                    @click="onClickTaskTitle(props.row.id)"
                                >{{ props.value }}</button>
                            </template>
                            <span v-else>{{ props.value }}</span>
                        </template>
                    </WAggridVue>
                </template>

                <div
                    style="padding:14px 18px; font-size:0.85rem; color:#999;"
                    v-else
                >
                    {{$t('tasksEmpty')}}
                </div>

            </template>

            <div
                style="padding:20px; font-size:0.85rem; color:#999; text-align:center;"
                v-else
            >
                {{$t('selectChannelFirst')}}
            </div>

        </div>

        <!-- 詳情面板 -->
        <div
            data-fmid="task-detail"
            :style="`height:${detailHeight}px; overflow-y:auto; border-top:1px solid #ddd; background:#fff; padding:12px 18px;`"
            v-if="taskDetail"
        >

            <div style="display:flex; align-items:center; margin-bottom:8px;">
                <div style="font-size:1.05rem; font-weight:bold; color:#222;">
                    {{taskDetail.title}}
                </div>
                <span :style="`margin-left:10px; font-size:0.8rem; padding:2px 8px; border-radius:10px; color:#fff; background:${$s.getTaskStateColor(taskDetail.state)};`">
                    {{stateText(taskDetail.state)}}
                </span>
                <div style="flex:1;"></div>

                <template v-if="canRetry">
                    <WButtonChip
                        :text="$t('resetTask')"
                        :icon="mdiRefresh"
                        :iconSize="18"
                        :iconColor="'#fff'"
                        :iconColorHover="'#fff'"
                        :textColor="'#fff'"
                        :textColorHover="'#fff'"
                        :backgroundColor="'#F57C00'"
                        :backgroundColorHover="'#FB8C00'"
                        :borderColor="'transparent'"
                        :shadow="false"
                        :promiseUnlock="true"
                        @click="onClickRetryBtn"
                    ></WButtonChip>
                    <div style="padding-left:8px;"></div>
                </template>

                <template v-if="canRespond">
                    <WButtonChip
                        :text="$t('respondTask')"
                        :icon="mdiReplyOutline"
                        :iconSize="18"
                        :iconColor="'#fff'"
                        :iconColorHover="'#fff'"
                        :textColor="'#fff'"
                        :textColorHover="'#fff'"
                        :backgroundColor="'#2e7d32'"
                        :backgroundColorHover="'#388e3c'"
                        :borderColor="'transparent'"
                        :shadow="false"
                        @click="onClickShowRespondBtn"
                    ></WButtonChip>
                </template>

            </div>

            <!-- payload (收) -->
            <div style="margin-bottom:10px;">
                <div style="font-size:0.8rem; color:#888; margin-bottom:3px;">{{$t('taskPayload')}}</div>
                <div class="md-body" style="font-size:0.9rem; color:#222; background:#fafafa; border:1px solid #eee; border-radius:6px; padding:8px;" v-html="renderMd(taskDetail.payload)"></div>
            </div>

            <!-- result (回) -->
            <div style="margin-bottom:10px;" v-if="taskDetail.result">
                <div style="font-size:0.8rem; color:#888; margin-bottom:3px;">{{$t('taskResult')}}</div>
                <div class="md-body" style="font-size:0.9rem; color:#222; background:#f1f8e9; border:1px solid #dcedc8; border-radius:6px; padding:8px;" v-html="renderMd(taskDetail.result)"></div>
            </div>

            <!-- errorKey -->
            <div style="margin-bottom:6px;" v-if="taskDetail.errorKey">
                <div style="font-size:0.8rem; color:#888; margin-bottom:3px;">{{$t('taskErrorKey')}}</div>
                <div style="font-size:0.85rem; color:#c62828;">{{$t(taskDetail.errorKey)}}</div>
            </div>

            <!-- 人工代回輸入區 -->
            <div style="margin-top:10px; border-top:1px dashed #ddd; padding-top:10px;" v-if="showRespond">
                <div style="font-size:0.8rem; color:#888; margin-bottom:4px;">{{$t('respondTaskInputLabel')}}</div>
                <div style="border:1px solid #ddd; border-radius:6px; padding:4px 8px; margin-bottom:8px;">
                    <WTextarea
                        :value="respondResult"
                        :height="60"
                        :placeholder="$t('respondTaskPlaceholder')"
                        :bottomLineBorderColor="'transparent'"
                        :bottomLineBorderColorHover="'transparent'"
                        :bottomLineBorderColorFocus="'transparent'"
                        @input="onInputRespond"
                    ></WTextarea>
                </div>
                <div style="display:flex; align-items:center;">
                    <WButtonChip
                        :text="$t('respondTaskSubmit')"
                        :iconColor="'#fff'"
                        :textColor="'#fff'"
                        :textColorHover="'#fff'"
                        :backgroundColor="'#2e7d32'"
                        :backgroundColorHover="'#388e3c'"
                        :borderColor="'transparent'"
                        :shadow="false"
                        :promiseUnlock="true"
                        @click="onClickRespondBtn"
                    ></WButtonChip>
                    <div style="padding-left:8px;"></div>
                    <WButtonChip
                        :text="$t('cancel')"
                        :textColor="'#666'"
                        :textColorHover="'#333'"
                        :backgroundColor="'#fff'"
                        :backgroundColorHover="'#f2f2f2'"
                        :borderColor="'#ddd'"
                        :shadow="false"
                        @click="onClickCancelRespond"
                    ></WButtonChip>
                </div>
            </div>

            <div
                style="padding-top:6px; color:#c62828; font-size:0.8rem;"
                v-if="aError"
            >
                {{aError}}
            </div>

        </div>

    </div>
</template>

<script>
import { mdiClipboardCheckOutline, mdiRefresh, mdiReplyOutline } from '@mdi/js/mdi.js'
import showdown from 'showdown'
import DOMPurify from 'dompurify'
import get from 'lodash-es/get.js'
import map from 'lodash-es/map.js'
import find from 'lodash-es/find.js'
import filter from 'lodash-es/filter.js'
import sortBy from 'lodash-es/sortBy.js'
import size from 'lodash-es/size.js'
import cloneDeep from 'lodash-es/cloneDeep.js'
import isestr from 'wsemi/src/isestr.mjs'
import isearr from 'wsemi/src/isearr.mjs'
import WIcon from 'w-component-vue/src/components/WIcon.vue'
import WTextarea from 'w-component-vue/src/components/WTextarea.vue'
import WTextSelect from 'w-component-vue/src/components/WTextSelect.vue'
import WButtonChip from 'w-component-vue/src/components/WButtonChip.vue'
import WAggridVue from 'w-aggrid-vue/src/components/WAggridVue.vue'


//showdown converter (markdown → html)
let mdConverter = new showdown.Converter({
    simpleLineBreaks: true,
    tables: true,
    strikethrough: true,
    tasklists: true,
    openLinksInNewWindow: true,
})


export default {
    components: {
        WIcon,
        WTextarea,
        WTextSelect,
        WButtonChip,
        WAggridVue,
    },
    props: {
        drawer: {
            type: Boolean,
            default: false,
        },
    },
    data: function() {
        return {
            mdiClipboardCheckOutline,
            mdiRefresh,
            mdiReplyOutline,

            panelHeight: 100,
            headHeight: 100,

            channelId: '',
            firstLoading: true,

            //顯示封存: true 時資料來源切為冷表 tasksArchive (唯讀檢視, 見 spec D12)
            showArchived: false,

            //任務以業務函式 getTasks 取回後存本地 (messages/tasks 一律走 kpFunExt, 不走 ORM 同步, 對應 spec D2/§6.2)
            tasksLocal: [],

            taskIdSelected: '',
            showRespond: false,
            respondResult: '',

            aError: '',

            tabKeys: [
                'id',
                'title',
                'state',
                'assigneeId',
                'timeCreate',
                'timeDone',
            ],

            items: [],
            opt: null,

        }
    },
    watch: {
        channelItems: {
            immediate: true,
            handler: function(cs) {
                let vo = this
                if (size(cs) > 0 && !isestr(vo.channelId)) {
                    vo.channelId = get(cs, '0.value', '')
                    vo.loadTasks()
                }
            },
        },
    },
    computed: {

        syncState: function() {
            let vo = this
            return get(vo, '$store.state.syncState')
        },

        channels: function() {
            let rs = get(this, `$store.state.channels`)
            if (!rs) {
                rs = []
            }
            rs = sortBy(rs, 'id')
            return rs
        },

        channelItems: function() {
            let vo = this
            return map(vo.channels, (c) => {
                return {
                    value: c.id,
                    text: get(c, 'name', '') || c.id,
                }
            })
        },

        channelSelected: function() {
            let vo = this
            let r = filter(vo.channelItems, (c) => c.value === vo.channelId)
            return get(r, '0', null)
        },

        tasksView: function() {
            let vo = this
            let rs = filter(vo.tasksLocal, (t) => t.channelId === vo.channelId && t.isActive !== 'n')
            rs = sortBy(rs, 'id')
            rs = rs.reverse() //最近優先 (desc)
            return rs
        },

        taskDetail: function() {
            let vo = this
            if (!isestr(vo.taskIdSelected)) {
                return null
            }
            let r = find(vo.tasksView, { id: vo.taskIdSelected })
            return r || null
        },

        canRetry: function() {
            let vo = this
            if (vo.showArchived) {
                return false //封存檢視唯讀
            }
            let st = get(vo, 'taskDetail.state', '')
            return st === 'error' || st === 'running'
        },

        canRespond: function() {
            let vo = this
            if (vo.showArchived) {
                return false //封存檢視唯讀
            }
            let st = get(vo, 'taskDetail.state', '')
            return st === 'running'
        },

        changeParams: function() {
            // console.log('computed changeParams')

            let vo = this

            //trigger: 頻道或任務數據變更時重組
            let channelId = vo.channelId
            let items = cloneDeep(vo.tasksView)

            //save
            vo.items = items

            //genOpt
            vo.genOpt()

            //firstLoading
            if (isestr(channelId)) {
                vo.firstLoading = false
            }

            return ''
        },

        listHeight: function() {
            let vo = this
            let total = vo.panelHeight - vo.headHeight
            total = Math.max(total, 120)
            //有詳情時清單佔上半, 無詳情時佔全部
            if (vo.taskDetail) {
                return Math.max(Math.round(total * 0.5), 120)
            }
            return total
        },

        detailHeight: function() {
            let vo = this
            let total = vo.panelHeight - vo.headHeight
            total = Math.max(total, 120)
            return Math.max(total - vo.listHeight, 0)
        },

    },
    methods: {

        resizePanel: function(msg) {
            let vo = this
            vo.panelHeight = msg.snew.offsetHeight
        },

        resizeHead: function(msg) {
            let vo = this
            vo.headHeight = msg.snew.offsetHeight
        },

        renderMd: function(c) {
            if (!isestr(c)) {
                return ''
            }
            //安全: 消毒 showdown HTML 輸出再交 v-html, 防 task payload/result 之儲存型 XSS
            return DOMPurify.sanitize(mdConverter.makeHtml(c))
        },

        stateText: function(state) {
            let vo = this
            return vo.$s.getTaskStateText(vo, state)
        },

        genOpt: function() {
            // console.log('methods genOpt')

            let vo = this

            let opt = null
            if (size(vo.items) > 0) {

                let ks = vo.tabKeys

                let kpHead = {
                    'id': vo.$t('id'),
                    'title': vo.$t('taskTitle'),
                    'state': vo.$t('taskState'),
                    'assigneeId': vo.$t('taskAssignee'),
                    'timeCreate': vo.$t('timeCreate'),
                    'timeDone': vo.$t('taskTimeDone'),
                }

                opt = {
                    language: vo.$t('aggridLanguage'),
                    rows: vo.items,
                    keys: ks,
                    kpHead,
                    defCellEditable: false,
                    defHeadFilter: true,
                    defCellAlignH: 'left',
                    kpHeadHide: {
                        'id': true,
                    },
                    kpHeadFixLeft: {
                        'title': true,
                    },
                    defHeadMinWidth: 130,
                    kpHeadWidth: {
                        'title': 280,
                        'state': 120,
                        'assigneeId': 200,
                        'timeCreate': 200,
                        'timeDone': 200,
                    },
                    kpHeadFilterType: {
                        'id': 'text',
                        'title': 'text',
                        'state': 'text',
                        'assigneeId': 'text',
                        'timeCreate': 'text',
                        'timeDone': 'text',
                    },
                }

            }

            vo.opt = opt

        },

        onChangeChannel: function(item) {
            // console.log('methods onChangeChannel', item)

            let vo = this

            let id = get(item, 'value', '')
            if (!isestr(id)) {
                return
            }
            vo.channelId = id
            vo.taskIdSelected = ''
            vo.showRespond = false

            vo.loadTasks()

        },

        onClickTaskTitle: function(id) {
            // console.log('methods onClickTaskTitle', id)

            let vo = this

            vo.taskIdSelected = isestr(id) ? id : ''
            vo.showRespond = false
            vo.respondResult = ''
            vo.aError = ''

        },

        onInputRespond: function(v) {
            this.respondResult = isestr(v) ? v : ''
        },

        loadTasks: function() {
            // console.log('methods loadTasks')

            let vo = this

            if (!isestr(vo.channelId)) {
                return
            }

            let core = async () => {
                let ok = false
                //顯示封存時資料來源切為冷表 (getArchivedTasks), 否則熱表 (getTasks)
                let pm = vo.showArchived
                    ? vo.$fapi.getArchivedTasks(vo.channelId, 50, 'desc')
                    : vo.$fapi.getTasks(vo.channelId, 50, '', 'desc')
                await pm
                    .then((rs) => { vo.tasksLocal = isearr(rs) ? rs : []; ok = true }) //回傳數據存本地渲染
                    .catch((err) => { console.log('loadTasks', err) })
                return ok ? 'ok' : undefined
            }

            core().catch((err) => { console.log('loadTasks catch', err) })

        },

        onToggleArchived: function() {
            let vo = this
            vo.showArchived = !vo.showArchived
            vo.taskIdSelected = '' //切換資料來源時清除選取, 避免詳情殘留另一來源之任務
            vo.loadTasks()
        },

        onClickRetryBtn: function(msg) {
            // console.log('methods onClickRetryBtn')

            let vo = this

            //第一行立刻釋放按鈕視覺鎖
            msg.pm.resolve()

            //確認後執行
            let taskId = vo.taskIdSelected
            vo.$dg.showCheckYesNo(vo.$t('resetTaskConfirm'))
                .then(() => {
                    vo.doResetTask(taskId)
                })
                .catch(() => {})

        },

        doResetTask: function(taskId) {
            // console.log('methods doResetTask', taskId)

            let vo = this

            let core = async () => {

                //1) 清空舊 inline 錯誤
                vo.aError = ''

                //2) 同步檢測
                if (!isestr(taskId)) {
                    return
                }

                //3) 確定打 API 才開 loading
                vo.$ui.updateLoading(true)

                //4) resetTask, 各自 catch + 旗標短路
                let ok = false
                let failMsg = ''
                await vo.$fapi.resetTask(taskId)
                    .then(() => { ok = true })
                    .catch((err) => { console.log('resetTask', err); failMsg = `${vo.$t('resetTaskFail')}: ${vo.$tErr(err)}` })
                if (!ok) {
                    vo.$ui.updateLoading(false)
                    await vo.$dg.showCheckYes(failMsg, { type: 'error' })
                    return
                }

                //重新取回任務存本地
                await vo.$fapi.getTasks(vo.channelId, 50, '', 'desc').then((rs) => { vo.tasksLocal = isearr(rs) ? rs : [] }).catch((err) => { console.log('getTasks', err) })

                //showCheckYes 前先關 loading
                vo.$ui.updateLoading(false)
                await vo.$dg.showCheckYes(vo.$t('resetTaskSuccess'), { type: 'success' })

                return 'ok'
            }

            core()
                .catch((err) => {
                    console.log('catch', err)
                    vo.$alert(vo.$t('anUnexpectedErrorOccurred'), { type: 'error' })
                })
                .finally(() => {
                    vo.$ui.updateLoading(false)
                })

        },

        onClickShowRespondBtn: function() {
            let vo = this
            vo.showRespond = true
            vo.respondResult = ''
            vo.aError = ''
        },

        onClickCancelRespond: function() {
            let vo = this
            vo.showRespond = false
            vo.respondResult = ''
        },

        onClickRespondBtn: function(msg) {
            // console.log('methods onClickRespondBtn')

            let vo = this

            //第一行立刻釋放按鈕視覺鎖
            msg.pm.resolve()

            //fire-and-forget
            vo.doRespondTask()

        },

        doRespondTask: function() {
            // console.log('methods doRespondTask')

            let vo = this

            let taskId = vo.taskIdSelected
            let result = vo.respondResult

            let core = async () => {

                //1) 清空舊 inline 錯誤
                vo.aError = ''

                //2) 同步檢測
                if (!isestr(taskId)) {
                    return
                }
                if (!isestr(result)) {
                    vo.aError = vo.$t('respondTaskResultEmpty')
                    return
                }

                //3) 確定打 API 才開 loading
                vo.$ui.updateLoading(true)

                //4) respondTask (人工代回: state='done', senderType='human'), 各自 catch + 旗標短路
                let ok = false
                let failMsg = ''
                await vo.$fapi.respondTask(taskId, result, 'done', '', 'human')
                    .then(() => { ok = true })
                    .catch((err) => { console.log('respondTask', err); failMsg = `${vo.$t('respondTaskFail')}: ${vo.$tErr(err)}` })
                if (!ok) {
                    vo.$ui.updateLoading(false)
                    await vo.$dg.showCheckYes(failMsg, { type: 'error' })
                    return
                }

                //重置輸入區
                vo.showRespond = false
                vo.respondResult = ''

                //重新取回任務存本地
                await vo.$fapi.getTasks(vo.channelId, 50, '', 'desc').then((rs) => { vo.tasksLocal = isearr(rs) ? rs : [] }).catch((err) => { console.log('getTasks', err) })

                //showCheckYes 前先關 loading
                vo.$ui.updateLoading(false)
                await vo.$dg.showCheckYes(vo.$t('respondTaskSuccess'), { type: 'success' })

                return 'ok'
            }

            core()
                .catch((err) => {
                    console.log('catch', err)
                    vo.$alert(vo.$t('anUnexpectedErrorOccurred'), { type: 'error' })
                })
                .finally(() => {
                    vo.$ui.updateLoading(false)
                })

        },

    }
}
</script>

<style scoped>
.md-body >>> p {
    margin: 0 0 4px 0;
}
.md-body >>> pre {
    background: #f5f5f5;
    padding: 8px;
    border-radius: 4px;
    overflow-x: auto;
}
.md-body >>> code {
    background: #f0f0f0;
    padding: 1px 4px;
    border-radius: 3px;
}
.md-body >>> ul,
.md-body >>> ol {
    margin: 4px 0;
    padding-left: 20px;
}

/* 顯示封存切換 (視覺同 Composer 之 toggle switch) */
.arch-toggle {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12px;
    color: var(--text-2);
    cursor: pointer;
    padding: 0 8px;
    margin-left: 14px;
    font-weight: 600;
    user-select: none;
    white-space: nowrap;
}
.arch-toggle .sw {
    width: 32px;
    height: 18px;
    border-radius: 9px;
    background: var(--border-2);
    position: relative;
    transition: .15s;
    flex-shrink: 0;
}
.arch-toggle .sw::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    transition: .15s;
    box-shadow: 0 1px 2px rgba(0, 0, 0, .2);
}
.arch-toggle .sw.on {
    background: var(--accent);
}
.arch-toggle .sw.on::after {
    left: 16px;
}
</style>
