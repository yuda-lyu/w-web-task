<template>
    <div
        style="height:100%;"
        v-domresize
        @domresize="resizePanel"
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

                <div data-fmid="channels-edit-switch" style="padding:6px 0px 4px 4px;">
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
                        :promiseUnlock="true"
                        @click="onClickDeleteBtn"
                    ></WButtonCircle>

                    <div style="padding-left:4px;"></div>

                </template>

                <template v-if="isEditable && isModified">

                    <span data-fmid="channels-save-btn" style="display:inline-flex;">
                        <WButtonCircle
                            :paddingStyle="{v:6,h:6}"
                            :tooltip="$t('saveChanges')"
                            :icon="mdiCloudUploadOutline"
                            :backgroundColor="'rgba(255,0,50,0.7)'"
                            :backgroundColorHover="'rgba(255,0,50,0.8)'"
                            :backgroundColorFocus="'rgba(255,0,50,0.8)'"
                            :textColor="'#eee'"
                            :textColorHover="'#fff'"
                            :iconColor="'#eee'"
                            :iconColorHover="'#fff'"
                            :iconColorFocus="'#fff'"
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

            <!-- 草稿保護 (多人同時編輯, 原則 10): 有未存修改時他人已更新資料 → 不重建編輯中之內容, 提示並提供重新載入 -->
            <div
                data-fmid="draft-stale-notice"
                style="padding:6px 14px; background:#FFE0B2; color:#444; font-size:0.8rem; display:flex; align-items:center; border-top:1px solid #ddd;"
                v-if="isEditable && (isModified || editDefer) && staleNotice"
            >
                <img style="width:16px; height:16px; flex:none;" :src="$ui.getIcon('warning')" />
                <span style="padding:0px 10px 0px 6px;">{{$t('draftStaleNotice')}}</span>
                <span data-fmid="draft-reload-btn" style="display:inline-flex;">
                    <WButtonChip
                        :text="$t('reloadData')"
                        :icon="mdiRefresh"
                        :iconSize="16"
                        :iconColor="'#fff'"
                        :iconColorHover="'#fff'"
                        :textColor="'#fff'"
                        :textColorHover="'#fff'"
                        :backgroundColor="'#F57C00'"
                        :backgroundColorHover="'#FB8C00'"
                        :borderColor="'transparent'"
                        :shadow="false"
                        @click="onClickReload"
                    ></WButtonChip>
                </span>
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
import { mdiForumOutline, mdiCloudUploadOutline, mdiTrashCanOutline, mdiPlus, mdiRefresh } from '@mdi/js/mdi.js'
import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import size from 'lodash-es/size.js'
import filter from 'lodash-es/filter.js'
import sortBy from 'lodash-es/sortBy.js'
import cloneDeep from 'lodash-es/cloneDeep.js'
import haskey from 'wsemi/src/haskey.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import WIcon from 'w-component-vue/src/components/WIcon.vue'
import WSwitch from 'w-component-vue/src/components/WSwitch.vue'
import WButtonCircle from 'w-component-vue/src/components/WButtonCircle.vue'
import WButtonChip from 'w-component-vue/src/components/WButtonChip.vue'
import WAggridVue from 'w-aggrid-vue/src/components/WAggridVue.vue'
import channelsContract from '../schema/contracts/channels.mjs'
import { isStaleKey, calcBaseline, isStale, isDirty, resolveModified, decidePush, removeFromBaseline } from '../plugins/mDraft.mjs'
import { isEditorOpen, onceEditorStopped } from '../plugins/mGridEdit.mjs'


export default {
    components: {
        WIcon,
        WSwitch,
        WButtonCircle,
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
            mdiForumOutline,
            mdiCloudUploadOutline,
            mdiTrashCanOutline,
            mdiPlus,
            mdiRefresh,

            panelHeight: 100,
            headHeight: 100,

            firstLoading: true,
            firstSetting: true,
            isEditable: false,
            isModified: false,

            //草稿保護 (多人同時編輯, 原則 10; 見 plugins/mDraft.mjs): baseline 為載入時以畫面所見之列自算並凍結之基準 (存檔送此基準);
            //staleNotice 為有未存修改時他人已更新資料之提示; ownWriting 為自身存檔 / 刪除進行中 (期間到達之推播視為己寫, 延後處理); pendingRebuild 記錄期間有推播
            baseline: [],
            staleNotice: false,
            ownWriting: false,
            pendingRebuild: false,

            //editDefer: 儲存格編輯器開啟中 (已輸入、未按 Enter) 時收到推播, 視同草稿而延後處理 (不重建, 提示條照 staleNotice 顯示); 編輯器關閉後依一般規則處理 (見 plugins/mGridEdit.mjs)
            editDefer: false,

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
    beforeDestroy: function() {
        this.clearEditorWatch()
    },
    watch: {

        //store.channels 變更 (資料通道整表推播; 他人存、自己存、無關列皆觸發): 無未存修改 → 照舊重建; 有 → 不重建編輯中之內容 (修 E7), 凍結基準並依內容差異提示
        channels: {
            immediate: true,
            handler: function() {
                this.onStorePush()
            },
        },

        isEditable: function() {
            this.onEditableChange()
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

        //applyRows:以指定之列 (store 或伺服端回傳者) 重建畫面並凍結基準 —— 基準與畫面取自同一份列
        applyRows: function(rows) {
            let vo = this
            rows = isarr(rows) ? rows : []
            rows = sortBy(rows, 'id')
            let baseline = []
            try {
                baseline = calcBaseline(rows, channelsContract)
            }
            catch (err) {
                console.log('calcBaseline channels', err) //列主鍵缺漏或重複: 基準留空, 存檔將被後端以 errBaselineFormat 拒收 (不靜默放行)
            }
            vo.baseline = baseline
            vo.items = cloneDeep(rows)
            vo.staleNotice = false
            vo.pendingRebuild = false
            vo.clearEditorWatch()
            vo.genOpt()
            vo.firstLoading = false
        },

        //rebuildFromStore: 自 store.channels 重建 (無未存修改時之照舊行為)
        rebuildFromStore: function() {
            let vo = this
            vo.applyRows(vo.channels)
        },

        //onStorePush: store.channels 變更時之處置 (規則見 plugins/mDraft.mjs decidePush)
        onStorePush: function() {
            let vo = this
            //editing: 編輯器開啟中, 或已掛接關閉監聽而停止事件尚未回呼 (editDefer); modified: 旗標或畫面列內容 (提交後 rowsChange 回呼前之空窗以內容重算, 見 mDraft.resolveModified)
            let editing = vo.editDefer || isEditorOpen(vo.$refs.rftable)
            let modified = vo.opt ? resolveModified(vo.isModified, get(vo, 'opt.rows', []), vo.baseline, channelsContract) : vo.isModified
            if (modified && !vo.isModified) {
                vo.isModified = true
            }
            let d = decidePush({ isModified: modified, isEditing: editing, ownWriting: vo.ownWriting, baseline: vo.baseline, rows: vo.channels, contract: channelsContract })
            if (d.action === 'rebuild') {
                vo.rebuildFromStore()
            }
            else if (d.action === 'defer') {
                vo.pendingRebuild = true //自身存檔 / 刪除期間之推播視為己寫, 結束後處理
            }
            else {
                vo.staleNotice = d.stale //有未存修改或編輯器開啟中: 不重建, 內容不同才提示
                if (editing && !vo.isModified) {
                    vo.watchEditorStop() //僅編輯器開啟 (輸入未提交): 關閉後再依一般規則處理
                }
            }
        },

        //watchEditorStop: 編輯器開啟中收到推播而延後處理時, 掛接「編輯器關閉」一次性監聽 (已掛接或無法掛接則不重複 / 不進入延後狀態)
        watchEditorStop: function() {
            let vo = this
            if (vo.editDefer) {
                return
            }
            let dispose = onceEditorStopped(vo.$refs.rftable, () => vo.onEditorStopped())
            if (dispose) {
                vo.editDefer = true
                vo.disposeEditorWatch = dispose
            }
        },

        //clearEditorWatch: 取消編輯器關閉監聽並結束延後狀態 (重建畫面 / 元件銷毀時)
        clearEditorWatch: function() {
            let vo = this
            if (vo.disposeEditorWatch) {
                vo.disposeEditorWatch()
                vo.disposeEditorWatch = null
            }
            vo.editDefer = false
        },

        //onEditorStopped: 編輯器關閉 (Enter 提交 / Esc 取消 / 點他處): 先以內容重算 isModified (提交之值已在列資料, 不等 rowsChange), 再依一般規則處理延後之推播 ——
        //有未存修改 → 草稿保留並依內容差異提示; 無 → 重建為最新資料
        onEditorStopped: function() {
            let vo = this
            vo.disposeEditorWatch = null
            vo.editDefer = false
            vo.isModified = isDirty(get(vo, 'opt.rows', []), vo.baseline, channelsContract)
            vo.onStorePush()
        },

        //onEditableChange: 切換編輯模式. 有未存修改時保留草稿 (只重產 grid 設定), 否則自 store 重建
        onEditableChange: function() {
            let vo = this
            if (vo.isModified && vo.opt) {
                vo.items = cloneDeep(get(vo, 'opt.rows', []))
                vo.genOpt()
            }
            else {
                vo.rebuildFromStore()
            }
        },

        //onClickReload: 捨棄草稿並重新載入 (確認後)
        onClickReload: function() {
            let vo = this
            vo.$dg.showCheckYesNo(vo.$t('reloadDiscardConfirm'))
                .then(() => {
                    vo.isModified = false
                    vo.rebuildFromStore()
                })
                .catch(() => {})
        },

        genOpt: function() {
            // console.log('methods genOpt')

            let vo = this

            //default
            vo.itemsCheck = []

            //genOpt 必產生新的 grid 設定 (編輯器隨之關閉): 取消編輯器關閉監聽並結束延後狀態, 不留 editDefer 卡住
            vo.clearEditorWatch()

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

                        //isModified: 以內容相對凍結基準判定 (程式化重建 / 移除列亦會觸發此事件, 不可一律設為已修改; 見 plugins/mDraft.mjs isDirty)
                        vo.isModified = isDirty(get(vo, 'opt.rows', []), vo.baseline, channelsContract)

                        //草稿期間已提示他人更新 (staleNotice)、使用者其後把修改全數改回原值而回到「無未存修改」: 照舊重建為最新資料 (否則畫面停在舊值, 又無提示條);
                        //只依 staleNotice 判定 (不比對 store 與基準: 自身存檔後 store 之推播可能尚未到, 比對會把畫面退回存檔前之值)
                        if (!vo.isModified && vo.staleNotice && !vo.ownWriting) {
                            vo.rebuildFromStore()
                        }

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

            //save: 空表 (無列 → 無 grid 設定) 時先以新列建立設定與表格, 否則直接替換列
            if (vo.opt) {
                vo.opt.rows = rows
            }
            else {
                vo.items = rows
                vo.genOpt()
            }

            //isModified
            vo.isModified = true

        },

        onClickDeleteBtn: function(msg) {
            // console.log('method onClickDeleteBtn')
            //promiseUnlock 之鎖交由 deleteChannels 之 runSubmit 管理, 不於此解鎖 (D16; 原無 promiseUnlock, 亦無重入防護)
            let vo = this
            vo.deleteChannels({ pm: msg.pm })
        },

        deleteChannels: function(opt = {}) {
            // console.log('method deleteChannels')

            let vo = this

            //runSubmit: 刪除流程(確認框至結果訊息框關閉)進行中再觸發即略過, 刪除鈕之滑鼠與鍵盤 Enter 同一狀態 (D16);
            //unlockBtn 於開確認框前釋放按鈕鎖(確認框背後之按鈕不顯示載入圖示), 重入仍由流程狀態擋
            return vo.$ui.runSubmit('deleteChannels', (unlockBtn) => {

                //check
                if (size(vo.itemsCheck) === 0) {
                    return
                }

                //showCheckYesNo 確認: 是 → 刪除; 否(reject 'close') → 結束流程; 開框前釋放按鈕鎖
                unlockBtn()
                return vo.$dg.showCheckYesNo(vo.$t('deleteChannelConfirm'))
                    .then(() => {
                        return vo.doDeleteChannels()
                    })
                    .catch(() => {})

            }, opt)

        },

        doDeleteChannels: function() {
            // console.log('method doDeleteChannels')

            let vo = this

            //ids: 既存資料庫之列才需呼叫後端刪除 (新增未存者直接從 rows 移除); 「既存」以載入時之凍結基準判定 (基準內之 id 即載入時所見之資料庫列)
            let kpBase = {}
            each(vo.baseline, (e) => {
                kpBase[e[0]] = true
            })
            let idsDb = []
            let idsAll = []
            each(vo.itemsCheck, (v) => {
                let id = get(v, 'data.id', '')
                if (!isestr(id)) {
                    return true //跳出換下一個
                }
                idsAll.push(id)
                if (kpBase[id] === true) {
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

                //3) 確定打 API 才開 loading
                vo.$ui.updateLoading(true)

                //4) 清單級刪除: 一次提交被選取之資料庫列 (基準只含被選列: 刪除是針對特定列之命令, 他列被改不擋); 取代逐列迴圈 (任一失敗整次零刪除)
                let baselineSel = filter(vo.baseline, (e) => idsDb.indexOf(e[0]) >= 0)
                let ok = true
                let failKey = ''
                if (size(idsDb) > 0) {
                    ok = false
                    vo.ownWriting = true
                    await vo.$fapi.deleteChannels(idsDb, { baseline: baselineSel })
                        .then(() => { ok = true })
                        .catch((err) => { console.log('deleteChannels', err); failKey = err })
                    vo.ownWriting = false
                }
                if (!ok) {
                    vo.$ui.updateLoading(false)
                    if (isStaleKey(failKey)) {
                        vo.staleNotice = vo.isModified //被拒: 保留現況 (列未被移除), 有草稿時提示重新載入
                    }
                    await vo.$dg.showCheckYes(`${vo.$t('deleteChannelFail')}: ${vo.$tErr(failKey)}`, { type: 'error' })
                    return
                }

                //自本地 rows 移除被刪之列 (含未存 db 之新列). 有未存修改 (草稿) 時刪除不得丟棄其他列之草稿 (P3): 凍結基準維持, 只去掉被刪之 id;
                //isModified 以內容重算 (只剩被刪之列的修改 → 回到未修改)
                let rows = get(vo, 'opt.rows', [])
                rows = cloneDeep(rows)
                rows = filter(rows, (r) => idsAll.indexOf(r.id) < 0)
                vo.opt.rows = rows
                vo.itemsCheck = []
                vo.baseline = removeFromBaseline(vo.baseline, idsDb)
                vo.isModified = isDirty(rows, vo.baseline, channelsContract)

                //己寫期間若有推播被延後: 無草稿 → 重建; 有草稿 → 重算提示 (store 已含本次刪除)
                if (vo.pendingRebuild) {
                    vo.pendingRebuild = false
                    if (vo.isModified) {
                        vo.staleNotice = isStale(vo.channels, vo.baseline, channelsContract)
                    }
                    else {
                        vo.rebuildFromStore()
                    }
                }

                //showCheckYes 前先關 loading
                vo.$ui.updateLoading(false)
                await vo.$dg.showCheckYes(vo.$t('deleteChannelSuccess'), { type: 'success' })

                return 'ok'
            }

            //回傳流程之 promise, 供 deleteChannels 之 runSubmit 於結果訊息框關閉後才結束占位 (D16)
            return core()
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
            //promiseUnlock 之鎖交由 doSaveChannels 之 runSubmit 於請求結束時釋放, 不於此解鎖: 請求期間儲存鈕之滑鼠與鍵盤 Enter 皆擋 (D16;
            //原第一行即 pm.resolve, 鎖立即解除, 焦點留在儲存鈕時鍵盤連按可重複送出, 新增列會被建立 2 次)
            let vo = this
            vo.doSaveChannels({ pm: msg.pm })
        },

        doSaveChannels: function(opt = {}) {
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

                //4) 清單級存檔: 整份清單一次提交並帶載入時之基準 (不符即整次拒收零寫入; 取代逐列迴圈, 不再部分寫入)
                //新列 (不在載入時之基準內; timeUpdate 為佔位字串) 不帶 id, 由後端產生; 既有列帶 id
                let kpBase = {}
                each(vo.baseline, (e) => {
                    kpBase[e[0]] = true
                })
                let payload = cloneDeep(rows)
                each(payload, (r) => {
                    if (kpBase[r.id] !== true) {
                        delete r.id
                    }
                })
                let ok = false
                let res = null
                let failKey = ''
                vo.ownWriting = true
                await vo.$fapi.saveChannels(payload, { baseline: cloneDeep(vo.baseline) })
                    .then((r) => { ok = true; res = r })
                    .catch((err) => { console.log('saveChannels', err); failKey = err })
                vo.ownWriting = false
                if (!ok) {
                    vo.$ui.updateLoading(false)
                    //被拒: 保留草稿並提示重新載入 (資料過期類); 其餘錯誤 (名稱重複等) 依內容重算提示 (己寫期間之推播已延後)
                    vo.staleNotice = isStaleKey(failKey) ? true : isStale(vo.channels, vo.baseline, channelsContract)
                    vo.pendingRebuild = false
                    await vo.$dg.showCheckYes(`${vo.$t('saveChannelFail')}: ${vo.$tErr(failKey)}`, { type: 'error' })
                    return
                }

                //存檔成功: 新基準與畫面皆取自伺服端回傳之列 (不以送出值當新基準: 寫入時 clearXSS 等可能改寫字串)
                let hadPending = vo.pendingRebuild
                vo.applyRows(get(res, 'rows', []))
                vo.isModified = false
                //己寫期間被延後之推播: 若 store 已含比回傳之列更新者 (他人於本次寫入後立即再寫) 則依 store 重建, 否則畫面停在舊值而不再有推播
                if (hadPending && isStale(vo.channels, vo.baseline, channelsContract)) {
                    vo.rebuildFromStore()
                }

                //showCheckYes 前先關 loading
                vo.$ui.updateLoading(false)
                await vo.$dg.showCheckYes(vo.$t('saveChannelSuccess'), { type: 'success' })

                return 'ok'
            }

            //runSubmit: 儲存流程(至結果訊息框關閉)進行中再觸發即略過; opt.pm 為儲存鈕之 promiseUnlock 鎖, 於請求結束(updateLoading(false))時釋放 (D16)
            return vo.$ui.runSubmit('saveChannels', () => {
                return core()
                    .catch((err) => {
                        console.log('catch', err)
                        vo.$alert(vo.$t('anUnexpectedErrorOccurred'), { type: 'error' })
                    })
                    .finally(() => {
                        vo.$ui.updateLoading(false)
                    })
            }, opt)

        },

    }
}
</script>

<style scoped>
</style>
