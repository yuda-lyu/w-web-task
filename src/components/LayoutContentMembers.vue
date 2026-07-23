<template>
    <div
        style="height:100%;"
        v-domresize
        @domresize="resizePanel"
        :changeParams="changeParams"
    >

        <!-- 頭部: 標題 + 頻道選擇器 -->
        <div
            style="background:#fff;"
            v-domresize
            @domresize="resizeHead"
        >

            <!-- 標題區 -->
            <div style="padding:10px 10px 10px 20px;">
                <div :style="`display:flex; align-items:center; padding:${drawer?'5px':'5px 5px 5px 20px'};`">

                    <WIcon
                        :icon="mdiAccountGroupOutline"
                        :color="'#0a0a0a'"
                        :size="32"
                    ></WIcon>

                    <div style="padding-left:12px;">

                        <div style="font-size:1.4rem; color:var(--text);">
                            {{$t('mmMembers')}}
                        </div>

                        <div style="padding-top:2px; font-size:0.8rem; color:var(--text-2);">
                            {{$t('channelMembers')}}
                        </div>

                    </div>

                </div>
            </div>

            <!-- 頻道選擇器: fixedChannelId 給定時(如由頻道聊天頁開啟)隱藏, 直接管理該頻道成員 -->
            <div
                data-fmid="members-channel-selector"
                style="padding:5px 20px 12px 20px; display:flex; align-items:center;"
                v-if="!fixedChannelId"
            >
                <div style="font-size:0.85rem; color:var(--text-2); padding-right:10px; white-space:nowrap;">
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
            </div>

            <!-- 功能區 -->
            <div
                data-fmid="members-toolbar"
                style="padding:5px; border-top:1px solid var(--border); display:flex; align-items:center;"
            >

                <div data-fmid="members-edit-switch" style="padding:6px 0px 4px 4px;">
                    <WSwitch
                        :checkedSwitchCircleColor="'#F68200'"
                        :checkedSwitchCircleColorHover="'#FB8C00'"
                        :checkedSwitchBarColor="'#FFE0B2'"
                        :checkedSwitchBarColorHover="'#FFE6B8'"
                        v-model="isEditable"
                        :text="$t('modeEdit')"
                    ></WSwitch>
                </div>

                <div style="padding-left:10px;"></div>

                <template v-if="isEditable">

                    <span data-fmid="members-add-btn" style="display:inline-flex;">
                        <WButtonCircle
                            :paddingStyle="{v:6,h:6}"
                            :tooltip="$t('addMember')"
                            :icon="mdiPlus"
                            :backgroundColor="'#fff'"
                            :backgroundColorHover="'#f2f2f2'"
                            :iconColor="'#444'"
                            :iconColorHover="'#222'"
                            :shadow="false"
                            @click="addItem"
                        ></WButtonCircle>
                    </span>

                    <div style="padding-left:4px;"></div>

                </template>

                <template v-if="isEditable && hasItemsCheck">

                    <span data-fmid="members-delete-btn" style="display:inline-flex;">
                        <WButtonCircle
                            :paddingStyle="{v:6,h:6}"
                            :tooltip="$t('deleteMember')"
                            :icon="mdiTrashCanOutline"
                            :backgroundColor="'#fff'"
                            :backgroundColorHover="'#f2f2f2'"
                            :iconColor="'#444'"
                            :iconColorHover="'#222'"
                            :shadow="false"
                            @click="onClickDeleteBtn"
                        ></WButtonCircle>
                    </span>

                    <div style="padding-left:4px;"></div>

                </template>

                <template v-if="isEditable && isModified">

                    <span data-fmid="members-save-btn" style="display:inline-flex;">
                        <WButtonCircle
                            :paddingStyle="{v:6,h:6}"
                            :tooltip="$t('saveChanges')"
                            :icon="mdiCloudUploadOutline"
                            :backgroundColor="'rgba(255,0,50,0.7)'"
                            :backgroundColorHover="'rgba(255,0,50,0.8)'"
                            :textColor="'#eee'"
                            :textColorHover="'#fff'"
                            :iconColor="'#eee'"
                            :iconColorHover="'#fff'"
                            :shadow="false"
                            :promiseUnlock="true"
                            @click="onClickSaveBtn"
                        ></WButtonCircle>
                    </span>

                    <div style="padding-left:4px;"></div>

                </template>

            </div>

            <!-- inline 錯誤紅字 -->
            <div
                style="padding:4px 14px; color:#c62828; font-size:0.8rem;"
                v-if="aError"
            >
                {{aError}}
            </div>

        </div>

        <!-- 內容區 -->
        <template v-if="!channelId">

            <div style="padding:20px; font-size:0.85rem; color:var(--text-3); text-align:center;">
                {{$t('selectChannelForMembers')}}
            </div>

        </template>

        <template v-else-if="!firstLoading">

            <template v-if="items && items.length > 0">
                <WAggridVue
                    ref="rftable"
                    :style="`width:100%;`"
                    :height="contentHeight"
                    :opt="opt"
                >
                    <template v-slot:cell-render="props">
                        <!-- memberType 顯示在地化文字 (僅顯示層, 底層值仍為原始 human/agent 供儲存) -->
                        <span v-if="props.key === 'memberType'">{{ memberTypeText(props.value) }}</span>
                        <span v-else>{{ props.value }}</span>
                    </template>
                </WAggridVue>
            </template>

            <div
                style="padding:14px 18px; font-size:0.85rem; color:var(--text-3);"
                v-else
            >
                {{$t('membersEmpty')}}
            </div>

        </template>

        <div
            style="padding:10px 15px; font-size:0.8rem;"
            v-else
        >
            {{$t('waitingData')}}
        </div>

    </div>
</template>

<script>
import { mdiAccountGroupOutline, mdiCloudUploadOutline, mdiTrashCanOutline, mdiPlus } from '@mdi/js/mdi.js'
import get from 'lodash-es/get.js'
import map from 'lodash-es/map.js'
import each from 'lodash-es/each.js'
import size from 'lodash-es/size.js'
import filter from 'lodash-es/filter.js'
import sortBy from 'lodash-es/sortBy.js'
import cloneDeep from 'lodash-es/cloneDeep.js'
import isestr from 'wsemi/src/isestr.mjs'
import isearr from 'wsemi/src/isearr.mjs'
import WIcon from 'w-component-vue/src/components/WIcon.vue'
import WSwitch from 'w-component-vue/src/components/WSwitch.vue'
import WButtonCircle from 'w-component-vue/src/components/WButtonCircle.vue'
import WTextSelect from 'w-component-vue/src/components/WTextSelect.vue'
import WAggridVue from 'w-aggrid-vue/src/components/WAggridVue.vue'


export default {
    components: {
        WIcon,
        WSwitch,
        WButtonCircle,
        WTextSelect,
        WAggridVue,
    },
    props: {
        drawer: {
            type: Boolean,
            default: false,
        },
        //fixedChannelId: 由外部(如頻道聊天頁)綁定固定頻道時傳入; 給定時隱藏頻道選擇器, 直接管理該頻道成員
        fixedChannelId: {
            type: String,
            default: '',
        },
    },
    data: function() {
        return {
            mdiAccountGroupOutline,
            mdiCloudUploadOutline,
            mdiTrashCanOutline,
            mdiPlus,

            panelHeight: 100,
            headHeight: 100,

            channelId: this.fixedChannelId || '',
            firstLoading: true,
            firstSetting: true,
            isEditable: false,
            isModified: false,

            aError: '',

            membersLocal: [],

            tabKeys: [
                'id',
                'memberId',
                'memberType',
                'role',
                'lastSeenMessageId',
                'timeUpdate',
            ],

            items: [],
            itemsCheck: [],
            opt: null,

        }
    },
    mounted: function() {
        let vo = this

        //firstSetting: 延遲釋放, 讓初始 rowsChange 被守衛吃掉不誤設 isModified
        setTimeout(() => {
            vo.firstSetting = false
        }, 1)

        //fixedChannelId 給定時 channelId 已於 data() 就緒, channelItems watcher 之 immediate handler 不會觸發載入(其守衛僅補全未設定情形), 故此處直接載入
        if (isestr(vo.fixedChannelId)) {
            vo.loadMembers()
        }

    },
    watch: {
        channelItems: {
            immediate: true,
            handler: function(cs) {
                let vo = this
                if (size(cs) > 0 && !isestr(vo.channelId)) {
                    vo.channelId = get(cs, '0.value', '')
                    vo.loadMembers()
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

        changeParams: function() {
            // console.log('computed changeParams')

            let vo = this

            //trigger
            let isEditable = vo.isEditable
            let channelId = vo.channelId
            let membersLocal = vo.membersLocal

            //items: 本地取出已存數據
            let items = cloneDeep(membersLocal)

            //save
            vo.items = items

            //genOpt
            vo.genOpt({ isEditable })

            //firstLoading: 僅在有選定頻道時才解除
            if (isestr(channelId)) {
                vo.firstLoading = false
            }

            return ''
        },

        contentHeight: function() {
            let vo = this

            //h
            let h = vo.panelHeight - vo.headHeight
            h = Math.max(h, 0)

            return h
        },

        hasItemsCheck: function() {
            let vo = this
            return size(vo.itemsCheck) > 0
        },

        kpHead: function() {
            let vo = this

            let kp = {
                'id': vo.$t('id'),
                'memberId': vo.$t('memberId'),
                'memberType': vo.$t('memberType'),
                'role': vo.$t('memberRole'),
                'lastSeenMessageId': vo.$t('memberLastSeen'),
                'timeUpdate': vo.$t('timeUpdate'),
            }

            return kp
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

        //memberTypeText: 成員類型原始值 → 在地化顯示文字 (供 cell-render slot; 底層值不變)
        memberTypeText: function(v) {
            let vo = this
            return vo.$s.getMemberTypeText(vo, v)
        },

        genOpt: function() {
            // console.log('methods genOpt')

            let vo = this

            //default
            vo.itemsCheck = []

            //opt
            let opt = null
            if (size(vo.items) > 0) {

                //ks
                let ks = vo.tabKeys

                //kpHead
                let kpHead = vo.kpHead

                //kpCellEditable, kpHeadCheckBox
                let kpCellEditable = {}
                let kpHeadCheckBox = {}
                if (vo.isEditable) {
                    kpCellEditable = {
                        'memberId': true,
                        'memberType': true,
                        'role': true,
                    }
                    kpHeadCheckBox = {
                        'memberId': true,
                    }
                }

                //kpHeadHide
                let kpHeadHide = {
                    'id': true,
                }

                //opt
                opt = {
                    language: vo.$t('aggridLanguage'),
                    rows: vo.items,
                    keys: ks,
                    kpHead,
                    defCellEditable: false,
                    defHeadFilter: true,
                    defCellAlignH: 'left',
                    kpHeadHide,
                    kpHeadFixLeft: {
                        'memberId': true,
                    },
                    defHeadMinWidth: 150,
                    kpHeadWidth: {
                        'memberId': 220,
                        'memberType': 160,
                        'role': 160,
                        'lastSeenMessageId': 220,
                        'timeUpdate': 220,
                    },
                    kpHeadFilterType: {
                        'id': 'text',
                        'memberId': 'text',
                        'memberType': 'text',
                        'role': 'text',
                        'lastSeenMessageId': 'text',
                        'timeUpdate': 'text',
                    },
                    kpCellEditable,
                    kpHeadCheckBox,
                    rowsChange: () => {

                        //check
                        if (!vo.syncState || vo.firstLoading || vo.firstSetting) {
                            return
                        }

                        //isModified
                        vo.isModified = true

                    },
                    rowChecked: (rs) => {

                        //save itemsCheck
                        vo.itemsCheck = cloneDeep(rs)

                    },
                }

            }

            //save
            vo.opt = opt

        },

        addItem: function() {
            // console.log('method addItem')

            let vo = this

            //check
            if (!isestr(vo.channelId)) {
                return
            }

            //rows
            let rows = get(vo, 'opt.rows', [])
            rows = cloneDeep(rows)

            //r
            let r = vo.$ds.channelMembers.funNew({ channelId: vo.channelId })
            r.memberId = vo.$s.getNameNew(rows, 'memberId', '', vo.$t('addMember'))
            r.timeUpdate = `{${vo.$t('addMember')}}`

            //添加至最首
            rows = [
                r,
                ...rows,
            ]

            //save
            vo.opt.rows = rows

            //isModified
            vo.isModified = true

        },

        onChangeChannel: function(item) {
            // console.log('methods onChangeChannel', item)

            let vo = this

            let id = get(item, 'value', '')
            if (!isestr(id)) {
                return
            }
            vo.channelId = id
            vo.membersLocal = []
            vo.itemsCheck = []
            vo.isModified = false
            vo.firstLoading = true
            vo.firstSetting = true
            setTimeout(() => { vo.firstSetting = false }, 1)

            vo.loadMembers()

        },

        loadMembers: function() {
            // console.log('methods loadMembers')

            let vo = this

            if (!isestr(vo.channelId)) {
                return
            }

            let core = async () => {
                let ok = false
                await vo.$fapi.getChannelMembers(vo.channelId)
                    .then((rs) => { vo.membersLocal = isearr(rs) ? rs : []; ok = true })
                    .catch((err) => { console.log('getChannelMembers', err) })
                return ok ? 'ok' : undefined
            }

            core().catch((err) => { console.log('loadMembers catch', err) })

        },

        onClickDeleteBtn: function() {
            // console.log('method onClickDeleteBtn')

            let vo = this

            //check
            if (size(vo.itemsCheck) === 0) {
                return
            }

            //showCheckYesNo 確認
            vo.$dg.showCheckYesNo(vo.$t('deleteMemberConfirm'))
                .then(() => {
                    vo.doDeleteMembers()
                })
                .catch(() => {})

        },

        doDeleteMembers: function() {
            // console.log('method doDeleteMembers')

            let vo = this

            //ids: 既存資料庫之列才需呼叫後端刪除 (新增未存者直接從 rows 移除)
            let idsDb = []
            let idsAll = []
            each(vo.itemsCheck, (v) => {
                let id = get(v, 'data.id', '')
                if (!isestr(id)) {
                    return true //跳出換下一個
                }
                idsAll.push(id)
                //已存在於 membersLocal 者才是資料庫列
                let inDb = filter(vo.membersLocal, (m) => m.id === id)
                if (size(inDb) > 0) {
                    idsDb.push(id)
                }
            })

            let core = async () => {

                //1) 清空舊 inline 錯誤
                vo.aError = ''

                //2) 同步檢測
                if (size(idsAll) === 0) {
                    return
                }

                //從本地 rows 先移除未存 db 之新列
                let rows = get(vo, 'opt.rows', [])
                rows = cloneDeep(rows)
                rows = filter(rows, (r) => idsAll.indexOf(r.id) < 0)
                vo.opt.rows = rows
                vo.itemsCheck = []

                //3) 確定打 API 才開 loading
                vo.$ui.updateLoading(true)

                //4) 逐筆刪除 db 列, 各自 catch
                let okAll = true
                let failMsg = ''
                for (let id of idsDb) {
                    let ok = false
                    await vo.$fapi.deleteChannelMember(id)
                        .then(() => { ok = true })
                        .catch((err) => { console.log('deleteChannelMember', err); failMsg = `${vo.$t('deleteMemberFail')}: ${vo.$tErr(err)}` })
                    if (!ok) { okAll = false; break }
                }
                if (!okAll) {
                    vo.$ui.updateLoading(false)
                    await vo.$dg.showCheckYes(failMsg, { type: 'error' })
                    return
                }

                vo.isModified = false

                //重新載入成員
                await vo.$fapi.getChannelMembers(vo.channelId)
                    .then((rs) => { vo.membersLocal = isearr(rs) ? rs : [] })
                    .catch((err) => { console.log('getChannelMembers after delete', err) })

                //showCheckYes 前先關 loading
                vo.$ui.updateLoading(false)
                await vo.$dg.showCheckYes(vo.$t('deleteMemberSuccess'), { type: 'success' })

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

        onClickSaveBtn: function(msg) {
            // console.log('method onClickSaveBtn')

            let vo = this

            //第一行立刻釋放按鈕視覺鎖
            msg.pm.resolve()

            //fire-and-forget, 不 await
            vo.doSaveMembers()

        },

        doSaveMembers: function() {
            // console.log('method doSaveMembers')

            let vo = this

            let core = async () => {

                //1) 清空舊 inline 錯誤
                vo.aError = ''

                //rows
                let rows = get(vo, 'opt.rows', [])

                //2) 同步檢測
                if (size(rows) === 0) {
                    return
                }

                //3) 確定打 API 才開 loading
                vo.$ui.updateLoading(true)

                //4) 逐筆儲存, 各自 catch + 旗標短路
                let okAll = true
                let failMsg = ''
                for (let row of rows) {
                    let ok = false
                    //新列 (不在 membersLocal 既有 id) delete payload.id 讓後端 funNew 重產
                    let payload = cloneDeep(row)
                    let inDb = filter(vo.membersLocal, (m) => m.id === row.id)
                    if (size(inDb) === 0) {
                        delete payload.id //後端 funNew 重產 id
                    }
                    await vo.$fapi.saveChannelMember(payload)
                        .then(() => { ok = true })
                        .catch((err) => { console.log('saveChannelMember', err); failMsg = `${vo.$t('saveMemberFail')}: ${vo.$tErr(err)}` })
                    if (!ok) { okAll = false; break }
                }
                if (!okAll) {
                    vo.$ui.updateLoading(false)
                    await vo.$dg.showCheckYes(failMsg, { type: 'error' })
                    return
                }

                //存檔成功: 關 isModified, 暫設 firstSetting=true 讓同步回推的 rowsChange 被守衛吃掉
                vo.isModified = false
                vo.firstSetting = true

                //重新載入成員
                await vo.$fapi.getChannelMembers(vo.channelId)
                    .then((rs) => { vo.membersLocal = isearr(rs) ? rs : [] })
                    .catch((err) => { console.log('getChannelMembers after save', err) })

                vo.$nextTick(() => {
                    setTimeout(() => { vo.firstSetting = false }, 1)
                })

                //showCheckYes 前先關 loading
                vo.$ui.updateLoading(false)
                await vo.$dg.showCheckYes(vo.$t('saveMemberSuccess'), { type: 'success' })

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
</style>
