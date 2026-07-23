<template>
    <div
        style="height:100%;"
        v-domresize
        @domresize="resizePanel"
        :changeParams="changeParams"
    >

        <div
            style="background:#fff;"
            v-domresize
            @domresize="resizeHead"
        >

            <!-- 標題區 -->
            <div style="padding:10px 10px 10px 20px;">
                <div :style="`display:flex; align-items:center; padding:${drawer?'5px':'5px 5px 5px 20px'};`">

                    <WIcon
                        :icon="mdiForumOutline"
                        :color="'#000'"
                        :size="32"
                    ></WIcon>

                    <div style="padding-left:12px;">

                        <div style="font-size:1.4rem; color:#000;">
                            {{$t('mmChannels')}}
                        </div>

                        <div style="padding-top:2px; font-size:0.8rem; color:#666;">
                            {{$t('mmChannelsMsg')}}
                        </div>

                    </div>

                </div>
            </div>

            <!-- 功能區 -->
            <div
                data-fmid="channels-toolbar"
                style="padding:5px; border-top:1px solid #ddd; display:flex; align-items:center;"
            >

                <div style="padding:6px 0px 4px 4px;">
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

                    <WButtonCircle
                        :paddingStyle="{v:6,h:6}"
                        :tooltip="$t('addChannel')"
                        :icon="mdiPlus"
                        :backgroundColor="'#fff'"
                        :backgroundColorHover="'#f2f2f2'"
                        :iconColor="'#444'"
                        :iconColorHover="'#222'"
                        :shadow="false"
                        @click="addItem"
                    ></WButtonCircle>

                    <div style="padding-left:4px;"></div>

                </template>

                <template v-if="isEditable && hasItemsCheck">

                    <WButtonCircle
                        :paddingStyle="{v:6,h:6}"
                        :tooltip="$t('deleteChannel')"
                        :icon="mdiTrashCanOutline"
                        :backgroundColor="'#fff'"
                        :backgroundColorHover="'#f2f2f2'"
                        :iconColor="'#444'"
                        :iconColorHover="'#222'"
                        :shadow="false"
                        @click="onClickDeleteBtn"
                    ></WButtonCircle>

                    <div style="padding-left:4px;"></div>

                </template>

                <template v-if="isEditable && isModified">

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

        <template v-if="!firstLoading">

            <template v-if="items && items.length > 0">
                <WAggridVue
                    ref="rftable"
                    :style="`width:100%;`"
                    :height="contentHeight"
                    :opt="opt"
                >
                    <template v-slot:cell-render="props">
                        <template v-if="props.key==='name'">
                            <span v-if="errItemsByName[props.value]" :title="errItemsByName[props.value]">
                                <span style="color:#F57C00;">{{ props.value }}</span>
                                <img style="vertical-align:sub; width:16px; height:16px;" :src="$ui.getIcon('warning')" />
                            </span>
                            <span v-else>{{ props.value }}</span>
                        </template>
                        <span v-else>{{ props.value }}</span>
                    </template>
                </WAggridVue>
            </template>

            <div
                style="padding:14px 18px; font-size:0.85rem; color:#999;"
                v-else
            >
                {{$t('channelsEmpty')}}
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
import { mdiForumOutline, mdiCloudUploadOutline, mdiTrashCanOutline, mdiPlus } from '@mdi/js/mdi.js'
import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import size from 'lodash-es/size.js'
import filter from 'lodash-es/filter.js'
import sortBy from 'lodash-es/sortBy.js'
import cloneDeep from 'lodash-es/cloneDeep.js'
import haskey from 'wsemi/src/haskey.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import WIcon from 'w-component-vue/src/components/WIcon.vue'
import WSwitch from 'w-component-vue/src/components/WSwitch.vue'
import WButtonCircle from 'w-component-vue/src/components/WButtonCircle.vue'
import WAggridVue from 'w-aggrid-vue/src/components/WAggridVue.vue'


export default {
    components: {
        WIcon,
        WSwitch,
        WButtonCircle,
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
            mdiForumOutline,
            mdiCloudUploadOutline,
            mdiTrashCanOutline,
            mdiPlus,

            panelHeight: 100,
            headHeight: 100,

            firstLoading: true,
            firstSetting: true,
            isEditable: false,
            isModified: false,

            aError: '',

            tabKeys: [
                'id',
                'name',
                'levels',
                'description',
                'agentId',
                'ownerId',
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

        changeParams: function() {
            // console.log('computed changeParams')

            let vo = this

            //trigger
            let isEditable = vo.isEditable

            //items
            let items = cloneDeep(vo.channels)

            //save
            vo.items = items

            //genOpt
            vo.genOpt({ isEditable })

            //firstLoading
            vo.firstLoading = false

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

        errItemsByName: function() {
            let vo = this

            //rows
            let rows = get(vo, 'opt.rows', [])

            //kpErr
            let kpErr = {}
            let kpName = {}
            each(rows, (v) => {

                //name
                let name = get(v, 'name', '')

                //check
                if (!isestr(name)) {
                    kpErr[name] = vo.$t('channelNameEmpty')
                    return true //跳出換下一個
                }

                //check
                if (haskey(kpName, name)) {
                    kpErr[name] = vo.$t('channelNameDuplicate')
                    return true //跳出換下一個
                }

                //kpName
                kpName[name] = true

            })

            return kpErr
        },

        kpHead: function() {
            let vo = this

            let kp = {
                'id': vo.$t('id'),
                'name': vo.$t('channelName'),
                'levels': vo.$t('channelLevels'),
                'description': vo.$t('channelDescription'),
                'agentId': vo.$t('channelAgentId'),
                'ownerId': vo.$t('channelOwnerId'),
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

                //kpCellEditable, kpRowDrag, kpHeadCheckBox
                let kpCellEditable = {}
                let kpHeadCheckBox = {}
                if (vo.isEditable) {
                    kpCellEditable = {
                        'name': true,
                        'levels': true,
                        'description': true,
                        'agentId': true,
                        'ownerId': true,
                    }
                    kpHeadCheckBox = {
                        'name': true,
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
                        'name': true,
                    },
                    defHeadMinWidth: 150,
                    kpHeadWidth: {
                        'name': 220,
                        'levels': 220,
                        'description': 320,
                        'agentId': 200,
                        'ownerId': 200,
                        'timeUpdate': 220,
                    },
                    kpHeadFilterType: {
                        'id': 'text',
                        'name': 'text',
                        'levels': 'text',
                        'description': 'text',
                        'agentId': 'text',
                        'ownerId': 'text',
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

            //rows
            let rows = get(vo, 'opt.rows', [])
            rows = cloneDeep(rows)

            //r
            let r = vo.$ds.channels.funNew()
            r.name = vo.$s.getNameNew(rows, 'name', '', vo.$t('addChannel'))
            r.ownerId = get(vo, '$store.state.userSelf.id', '')
            r.timeUpdate = `{${vo.$t('addChannel')}}`

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

        onClickDeleteBtn: function() {
            // console.log('method onClickDeleteBtn')

            let vo = this

            //check
            if (size(vo.itemsCheck) === 0) {
                return
            }

            //showCheckYesNo 確認
            vo.$dg.showCheckYesNo(vo.$t('deleteChannelConfirm'))
                .then(() => {
                    vo.doDeleteChannels()
                })
                .catch(() => {})

        },

        doDeleteChannels: function() {
            // console.log('method doDeleteChannels')

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
                //已存在於 store.channels 者才是資料庫列
                let inDb = filter(vo.channels, (c) => c.id === id)
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
                    await vo.$fapi.deleteChannel(id)
                        .then(() => { ok = true })
                        .catch((err) => { console.log('deleteChannel', err); failMsg = `${vo.$t('deleteChannelFail')}: ${vo.$tErr(err)}` })
                    if (!ok) { okAll = false; break }
                }
                if (!okAll) {
                    vo.$ui.updateLoading(false)
                    await vo.$dg.showCheckYes(failMsg, { type: 'error' })
                    return
                }

                vo.isModified = false

                //showCheckYes 前先關 loading
                vo.$ui.updateLoading(false)
                await vo.$dg.showCheckYes(vo.$t('deleteChannelSuccess'), { type: 'success' })

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
            vo.doSaveChannels()

        },

        doSaveChannels: function() {
            // console.log('method doSaveChannels')

            let vo = this

            let core = async () => {

                //1) 清空舊 inline 錯誤
                vo.aError = ''

                //rows
                let rows = get(vo, 'opt.rows', [])

                //2) 同步檢測: name 必填且不重複
                if (iseobj(vo.errItemsByName) && size(vo.errItemsByName) > 0) {
                    vo.aError = vo.$t('channelNameInvalid')
                    return
                }
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
                    //新列 (timeUpdate 為佔位字串) 不帶 id; 既有列帶 id
                    let payload = cloneDeep(row)
                    let inDb = filter(vo.channels, (c) => c.id === row.id)
                    if (size(inDb) === 0) {
                        delete payload.id //後端 funNew 重產 id
                    }
                    await vo.$fapi.saveChannel(payload)
                        .then(() => { ok = true })
                        .catch((err) => { console.log('saveChannel', err); failMsg = `${vo.$t('saveChannelFail')}: ${vo.$tErr(err)}` })
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
                vo.$nextTick(() => {
                    setTimeout(() => { vo.firstSetting = false }, 1)
                })

                //showCheckYes 前先關 loading
                vo.$ui.updateLoading(false)
                await vo.$dg.showCheckYes(vo.$t('saveChannelSuccess'), { type: 'success' })

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
