<template>
    <div
        style="height:100%;"
        v-domresize
        @domresize="resizePanel"
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
                    :key="selectKey"
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

                <!-- 編輯開關: 明確為非系統管理者時隱藏 (便利性; 成員管理類函數由後端限系統管理者, 見 src/plugins/mAccess.mjs) -->
                <div v-if="isManager" data-fmid="members-edit-switch" style="padding:6px 0px 4px 4px;">
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
                            :promiseUnlock="true"
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
                style="padding:6px 14px; background:#FFE0B2; color:#444; font-size:0.8rem; display:flex; align-items:center; border-top:1px solid var(--border);"
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
                        <!-- memberId: 同一頻道內重複者(既有重複列或編輯中造成)於儲存格顯示警告圖示 (原則 3 收嚴+提示; (channelId, memberId) 唯一, 後端以寫入後之結果驗證) -->
                        <template v-else-if="props.key === 'memberId'">
                            <span v-if="errItemsByMember.has(props.value)" :title="errItemsByMember.get(props.value)">
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
import { mdiAccountGroupOutline, mdiCloudUploadOutline, mdiTrashCanOutline, mdiPlus, mdiRefresh } from '@mdi/js/mdi.js'
import get from 'lodash-es/get.js'
import map from 'lodash-es/map.js'
import each from 'lodash-es/each.js'
import size from 'lodash-es/size.js'
import filter from 'lodash-es/filter.js'
import sortBy from 'lodash-es/sortBy.js'
import cloneDeep from 'lodash-es/cloneDeep.js'
import isarr from 'wsemi/src/isarr.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import WIcon from 'w-component-vue/src/components/WIcon.vue'
import WSwitch from 'w-component-vue/src/components/WSwitch.vue'
import WButtonCircle from 'w-component-vue/src/components/WButtonCircle.vue'
import WButtonChip from 'w-component-vue/src/components/WButtonChip.vue'
import WTextSelect from 'w-component-vue/src/components/WTextSelect.vue'
import WAggridVue from 'w-aggrid-vue/src/components/WAggridVue.vue'
import getMembersContract from '../schema/contracts/channelMembers.mjs'
import { isStaleKey, calcBaseline, isStale, isDirty, countDuplicates, removeFromBaseline } from '../plugins/mDraft.mjs'
import { isEditorOpen, onceEditorStopped } from '../plugins/mGridEdit.mjs'
import { canManage } from '../plugins/mAccess.mjs'


export default {
    components: {
        WIcon,
        WSwitch,
        WButtonCircle,
        WButtonChip,
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
            mdiRefresh,

            panelHeight: 100,
            headHeight: 100,

            channelId: this.fixedChannelId || '',
            firstLoading: true,
            firstSetting: true,
            isEditable: false,
            isModified: false,

            //草稿保護 (多人同時編輯, 原則 10; 見 plugins/mDraft.mjs): baseline 為載入 (RPC getChannelMembers) 時以所得之列自算並凍結之基準, 存檔送此基準;
            //staleNotice 為有未存修改時他人已更新資料之提示; ownWriting 為自身存檔 / 刪除進行中 (期間到達之推播視為己寫)
            baseline: [],
            staleNotice: false,
            ownWriting: false,
            pendingPush: false,

            //editDefer: 儲存格編輯器開啟中 (已輸入、未按 Enter) 時收到推播, 視同草稿 (提示條照 staleNotice 顯示); 編輯器關閉後依一般規則處理 (見 plugins/mGridEdit.mjs)
            editDefer: false,

            //loadSeq: 載入世代 (每次載入 / 存檔成功遞增; 回應到達時世代已變即捨棄, 防 A→B→A 之舊回應覆蓋新畫面與草稿);
            //selectKey: 頻道選擇器重掛鍵 (有草稿而取消切換頻道時, 使選擇器回到目前頻道)
            loadSeq: 0,
            selectKey: 0,

            aError: '',

            //membersLocal: 載入 (RPC) 所得之快照, 為「未存修改時重建畫面」之來源. 改動它不會自動重建畫面 (有草稿時刪除列只自快照移除該列, 草稿維持); 重建一律明確呼叫 rebuildFromLocal
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
    beforeDestroy: function() {
        this.clearEditorWatch()
    },
    watch: {

        //明確為非系統管理者時收回編輯模式 (使用者資料晚於畫面取得時, 已開啟之編輯模式不殘留; 便利性, 後端為權威)
        isManager: function(v) {
            if (!v) {
                this.isEditable = false
            }
        },

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

        //切換編輯模式: 有未存修改時保留草稿 (只重產 grid 設定), 否則自快照重建
        isEditable: function() {
            this.onEditableChange()
        },

        //store.channelMembers (資料通道整表推播, 含所有頻道): 有未存修改時依內容差異提示他人已更新 (成員頁快照本不隨推播重建, 故無「丟草稿」問題, 提示用於存檔前讓使用者知悉)
        storeMembers: function() {
            this.onStorePush()
        },
    },
    computed: {

        isManager: function() {
            let vo = this
            return canManage(get(vo, '$store.state.userSelf', {}))
        },

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

        //membersContract: 成員清單之寫入契約 (範圍＝本頻道; 契約工廠 getMembersContract)
        membersContract: function() {
            return getMembersContract(this.channelId)
        },

        //storeMembers: store.channelMembers 中本頻道之有效成員 (與 RPC getChannelMembers 同條件: channelId 且 isActive 'y')
        storeMembers: function() {
            let vo = this
            let rs = get(vo, '$store.state.channelMembers')
            if (!isarr(rs)) {
                return []
            }
            return filter(rs, (r) => r.channelId === vo.channelId && r.isActive === 'y')
        },

        //errItemsByMember: 畫面上同一頻道內重複之 memberId → 警告文字 (Map; (channelId, memberId) 唯一; 既有重複列與編輯造成者皆提示).
        //以 Map 計數與查詢: memberId 為 'constructor' / '__proto__' 等合法字串時, 物件取值會取到原型成員 (重複漏報、非重複誤報)
        errItemsByMember: function() {
            let vo = this

            //rows
            let rows = get(vo, 'opt.rows', [])

            //kpErr
            let kpErr = new Map()
            let text = vo.$t('memberDuplicate')
            countDuplicates(rows, 'memberId').forEach((n, mid) => {
                kpErr.set(mid, text)
            })

            return kpErr
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

        //applyLocal: 以伺服端所得之列 (RPC getChannelMembers 或存檔回傳之 rows) 作為快照, 並自同一份列算基準 (新基準取自伺服端)
        applyLocal: function(rs) {
            let vo = this
            rs = isarr(rs) ? rs : []
            let baseline = []
            try {
                baseline = calcBaseline(rs, vo.membersContract)
            }
            catch (err) {
                console.log('calcBaseline members', err) //列主鍵缺漏或重複: 基準留空, 存檔將被後端以 errBaselineFormat 拒收 (不靜默放行)
            }
            vo.baseline = baseline
            vo.staleNotice = false
            vo.clearEditorWatch()
            vo.membersLocal = rs
            vo.rebuildFromLocal()
        },

        //rebuildFromLocal: 自快照 membersLocal 重建畫面 (取代原 changeParams 計算屬性之副作用)
        rebuildFromLocal: function() {
            let vo = this
            vo.items = cloneDeep(vo.membersLocal)
            vo.genOpt()
            //firstLoading: 僅在有選定頻道時才解除
            if (isestr(vo.channelId)) {
                vo.firstLoading = false
            }
        },

        //onEditableChange: 切換編輯模式. 有未存修改時保留草稿 (只重產 grid 設定), 否則自快照重建
        onEditableChange: function() {
            let vo = this
            if (vo.isModified && vo.opt) {
                vo.items = cloneDeep(get(vo, 'opt.rows', []))
                vo.genOpt()
            }
            else {
                vo.rebuildFromLocal()
            }
        },

        //onStorePush: store.channelMembers 變更. 自身存檔 / 刪除進行中視為己寫不處理; 有未存修改或儲存格編輯器開啟中 (已輸入未按 Enter, 視同草稿) 時依內容差異提示他人已更新 (內容全同不提示)
        onStorePush: function() {
            let vo = this
            if (vo.ownWriting) {
                vo.pendingPush = true //己寫期間之推播延後, 結束後視需要重算
                return
            }
            //editing: 編輯器開啟中, 或已掛接關閉監聽而停止事件尚未回呼 (editDefer; 提交後事件回呼前之空窗仍視為編輯中). 成員頁不隨推播重建, 空窗內旗標尚未更新只影響提示條之顯示 (rowsChange 回呼後即依內容重算)
            let editing = vo.editDefer || isEditorOpen(vo.$refs.rftable)
            if (!vo.isModified && !editing) {
                vo.staleNotice = false //無未存修改: 不顯示提示條 (其後再有修改時 rowsChange 會依 store 內容重算)
                return
            }
            vo.staleNotice = isStale(vo.storeMembers, vo.baseline, vo.membersContract)
            if (editing && !vo.isModified) {
                vo.watchEditorStop() //僅編輯器開啟 (輸入未提交): 關閉後再依一般規則處理
            }
        },

        //watchEditorStop: 編輯器開啟中收到推播時, 掛接「編輯器關閉」一次性監聽 (已掛接或無法掛接則不重複 / 不進入延後狀態)
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

        //clearEditorWatch: 取消編輯器關閉監聽並結束延後狀態 (重新載入 / 元件銷毀時)
        clearEditorWatch: function() {
            let vo = this
            if (vo.disposeEditorWatch) {
                vo.disposeEditorWatch()
                vo.disposeEditorWatch = null
            }
            vo.editDefer = false
        },

        //onEditorStopped: 編輯器關閉 (Enter 提交 / Esc 取消 / 點他處): 先以內容重算 isModified (提交之值已在列資料, 不等 rowsChange), 再依一般規則處理 ——
        //有未存修改 → 草稿保留並依內容差異提示; 無 → 不顯示提示條 (成員頁不隨推播自動重載, 沿用既有行為)
        onEditorStopped: function() {
            let vo = this
            vo.disposeEditorWatch = null
            vo.editDefer = false
            vo.isModified = isDirty(get(vo, 'opt.rows', []), vo.baseline, vo.membersContract)
            vo.onStorePush()
        },

        //onClickReload: 捨棄草稿並重新載入 (確認後)
        onClickReload: function() {
            let vo = this
            vo.$dg.showCheckYesNo(vo.$t('reloadDiscardConfirm'))
                .then(() => {
                    vo.isModified = false
                    vo.staleNotice = false
                    vo.loadMembers()
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

                        //isModified: 以內容相對凍結基準判定 (程式化重建 / 移除列亦會觸發此事件, 不可一律設為已修改; 見 plugins/mDraft.mjs isDirty)
                        vo.isModified = isDirty(get(vo, 'opt.rows', []), vo.baseline, vo.membersContract)

                        //有未存修改時依 store 內容提示他人是否已更新
                        vo.onStorePush()

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

        onChangeChannel: function(item) {
            // console.log('methods onChangeChannel', item)

            let vo = this

            let id = get(item, 'value', '')
            if (!isestr(id) || id === vo.channelId) {
                return //選到同一頻道: 不重新載入, 不丟草稿
            }

            //doChange: 切換並載入新頻道 (草稿隨之捨棄)
            let doChange = () => {
                vo.channelId = id
                vo.baseline = []
                vo.staleNotice = false
                vo.membersLocal = []
                vo.itemsCheck = []
                vo.isModified = false
                vo.firstLoading = true
                vo.firstSetting = true
                setTimeout(() => { vo.firstSetting = false }, 1)
                vo.rebuildFromLocal() //清空畫面 (與原 membersLocal 監看觸發之重建同效: 有選定頻道即解除 firstLoading, 載入完成後 applyLocal 再重建)

                vo.loadMembers()
            }

            //有未存修改: 先確認; 取消則維持原頻道與草稿, 並重掛選擇器使其回到目前頻道
            if (vo.isModified) {
                vo.$dg.showCheckYesNo(vo.$t('switchChannelDiscardConfirm'))
                    .then(() => { doChange() })
                    .catch(() => { vo.selectKey += 1 })
                return
            }
            doChange()

        },

        loadMembers: function() {
            // console.log('methods loadMembers')

            let vo = this

            if (!isestr(vo.channelId)) {
                return
            }

            //seq: 本次載入之世代; 回應到達時世代已變 (期間切換過頻道 / 又發起載入 / 存檔成功) 或頻道不符即捨棄, 不以舊回應覆蓋新畫面、基準與草稿 (含 A→B→A)
            let seq = ++vo.loadSeq
            let core = async () => {
                let cid = vo.channelId
                let ok = false
                await vo.$fapi.getChannelMembers(cid)
                    .then((rs) => {
                        ok = true
                        if (seq !== vo.loadSeq || cid !== vo.channelId) {
                            return
                        }
                        vo.applyLocal(rs)
                    })
                    .catch((err) => { console.log('getChannelMembers', err) })
                return ok ? 'ok' : undefined
            }

            core().catch((err) => { console.log('loadMembers catch', err) })

        },

        onClickDeleteBtn: function(msg) {
            // console.log('method onClickDeleteBtn')
            //promiseUnlock 之鎖交由 deleteMembers 之 runSubmit 管理, 不於此解鎖 (D16; 原無 promiseUnlock, 亦無重入防護)
            let vo = this
            vo.deleteMembers({ pm: msg.pm })
        },

        deleteMembers: function(opt = {}) {
            // console.log('method deleteMembers')

            let vo = this

            //runSubmit: 刪除流程(確認框至結果訊息框關閉)進行中再觸發即略過, 刪除鈕之滑鼠與鍵盤 Enter 同一狀態 (D16);
            //unlockBtn 於開確認框前釋放按鈕鎖(確認框背後之按鈕不顯示載入圖示), 重入仍由流程狀態擋
            return vo.$ui.runSubmit('deleteChannelMembers', (unlockBtn) => {

                //check
                if (size(vo.itemsCheck) === 0) {
                    return
                }

                //showCheckYesNo 確認: 是 → 刪除; 否(reject 'close') → 結束流程; 開框前釋放按鈕鎖
                unlockBtn()
                return vo.$dg.showCheckYesNo(vo.$t('deleteMemberConfirm'))
                    .then(() => {
                        return vo.doDeleteMembers()
                    })
                    .catch(() => {})

            }, opt)

        },

        doDeleteMembers: function() {
            // console.log('method doDeleteMembers')

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

                //有未存修改 (草稿) 時刪除不得丟棄其他列之草稿 (P3): 凍結基準維持並去掉被刪之 id, 本地只移除被刪之列; 無草稿則照舊自伺服端重載 (新基準取自伺服端)
                let hadDraft = vo.isModified
                let cid = vo.channelId

                //3) 確定打 API 才開 loading
                vo.$ui.updateLoading(true)

                //4) 清單級刪除: 一次提交被選取之資料庫列 (基準只含被選列: 刪除是針對特定列之命令, 他列被改不擋); 取代逐列迴圈 (任一失敗整次零刪除)
                let baselineSel = filter(vo.baseline, (e) => idsDb.indexOf(e[0]) >= 0)
                let ok = true
                let failKey = ''
                if (size(idsDb) > 0) {
                    ok = false
                    vo.ownWriting = true
                    await vo.$fapi.deleteChannelMembers(cid, idsDb, { baseline: baselineSel })
                        .then(() => { ok = true })
                        .catch((err) => { console.log('deleteChannelMembers', err); failKey = err })
                    vo.ownWriting = false
                }
                if (!ok) {
                    vo.$ui.updateLoading(false)
                    if (isStaleKey(failKey)) {
                        vo.staleNotice = vo.isModified //被拒: 保留現況 (列未被移除), 有草稿時提示重新載入
                    }
                    await vo.$dg.showCheckYes(`${vo.$t('deleteMemberFail')}: ${vo.$tErr(failKey)}`, { type: 'error' })
                    return
                }

                //自本地 rows 移除被刪之列 (含未存 db 之新列)
                let rows = get(vo, 'opt.rows', [])
                rows = cloneDeep(rows)
                rows = filter(rows, (r) => idsAll.indexOf(r.id) < 0)
                vo.opt.rows = rows
                vo.itemsCheck = []
                vo.baseline = removeFromBaseline(vo.baseline, idsDb)
                vo.membersLocal = filter(vo.membersLocal, (r) => idsAll.indexOf(r.id) < 0) //被刪之列同時退出重建來源 (快照), 否則之後「改回原值 → 無修改 → 切換編輯模式」自舊快照重建會帶回已刪之列, 存檔時被當新列重新新增; 不觸發重建 (草稿維持)
                vo.isModified = isDirty(rows, vo.baseline, vo.membersContract)

                //無草稿: 重新載入成員 (新基準取自伺服端); 有草稿: 草稿與凍結基準維持, 己寫期間若有推播被延後則依 store 內容重算提示 (之後之推播由 storeMembers 監看處理)
                if (!hadDraft && !vo.isModified) {
                    let seq = ++vo.loadSeq //與 loadMembers 同一世代機制: 期間若切頻道或另有載入, 此回應即捨棄
                    await vo.$fapi.getChannelMembers(cid)
                        .then((rs) => {
                            if (seq === vo.loadSeq && cid === vo.channelId) {
                                vo.applyLocal(rs)
                            }
                        })
                        .catch((err) => { console.log('getChannelMembers after delete', err) })
                }
                else if (vo.pendingPush) {
                    vo.pendingPush = false
                    vo.onStorePush()
                }
                vo.pendingPush = false

                //showCheckYes 前先關 loading
                vo.$ui.updateLoading(false)
                await vo.$dg.showCheckYes(vo.$t('deleteMemberSuccess'), { type: 'success' })

                return 'ok'
            }

            //回傳流程之 promise, 供 deleteMembers 之 runSubmit 於結果訊息框關閉後才結束占位 (D16)
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
            //promiseUnlock 之鎖交由 doSaveMembers 之 runSubmit 於請求結束時釋放, 不於此解鎖: 請求期間儲存鈕之滑鼠與鍵盤 Enter 皆擋 (D16;
            //原第一行即 pm.resolve, 鎖立即解除, 焦點留在儲存鈕時鍵盤連按可重複送出, 新增列會被建立 2 次)
            let vo = this
            vo.doSaveMembers({ pm: msg.pm })
        },

        doSaveMembers: function(opt = {}) {
            // console.log('method doSaveMembers')

            let vo = this

            let core = async () => {

                //1) 清空舊 inline 錯誤
                vo.aError = ''

                //rows
                let rows = get(vo, 'opt.rows', [])

                //2) 同步檢測: (channelId, memberId) 唯一 (重複之儲存格已顯示警告圖示; 後端另以寫入後之結果驗證)
                if (vo.errItemsByMember.size > 0) {
                    vo.aError = vo.$t('memberInvalid')
                    return
                }
                if (size(rows) === 0) {
                    return
                }

                //3) 確定打 API 才開 loading
                vo.$ui.updateLoading(true)

                //4) 清單級存檔: 該頻道整份成員清單一次提交並帶載入時之基準 (不符即整次拒收零寫入; 取代逐列迴圈, 不再部分寫入或重試時重複建列)
                //新列 (不在載入時之基準內) 不帶 id, 由後端產生; 既有列帶 id
                let cid = vo.channelId
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
                await vo.$fapi.saveChannelMembers(cid, payload, { baseline: cloneDeep(vo.baseline) })
                    .then((r) => { ok = true; res = r })
                    .catch((err) => { console.log('saveChannelMembers', err); failKey = err })
                vo.ownWriting = false
                if (!ok) {
                    vo.$ui.updateLoading(false)
                    //被拒: 保留草稿並提示重新載入 (資料過期類); 其餘錯誤 (成員重複等) 依 store 內容重算提示
                    vo.pendingPush = false
                    if (isStaleKey(failKey)) {
                        vo.staleNotice = true
                    }
                    else {
                        vo.onStorePush()
                    }
                    await vo.$dg.showCheckYes(`${vo.$t('saveMemberFail')}: ${vo.$tErr(failKey)}`, { type: 'error' })
                    return
                }

                //存檔成功: 新基準與畫面皆取自伺服端回傳之列 (不以送出值當新基準), 草稿已落實
                vo.pendingPush = false
                vo.loadSeq += 1 //存檔結果較任何進行中之載入新: 使其回應失效 (不以舊資料覆蓋剛存妥之畫面與基準)
                if (cid === vo.channelId) {
                    vo.applyLocal(get(res, 'rows', []))
                }
                vo.isModified = false

                //showCheckYes 前先關 loading
                vo.$ui.updateLoading(false)
                await vo.$dg.showCheckYes(vo.$t('saveMemberSuccess'), { type: 'success' })

                return 'ok'
            }

            //runSubmit: 儲存流程(至結果訊息框關閉)進行中再觸發即略過; opt.pm 為儲存鈕之 promiseUnlock 鎖, 於請求結束(updateLoading(false))時釋放 (D16)
            return vo.$ui.runSubmit('saveChannelMembers', () => {
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
