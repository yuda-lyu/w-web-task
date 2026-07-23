<template>
    <div
        data-fmid="chat-view"
        class="main"
    >

        <!-- 標題列 -->
        <header class="ch-head" data-fmid="chat-head">

            <!-- RWD 窄屏: 返回頻道樹 -->
            <div
                class="back-btn"
                data-fmid="chat-head-back-btn"
                v-if="isNarrow"
                :title="$t('mmChannels')"
                @click="onClickBack"
            >
                <WIcon
                    :icon="mdiArrowLeft"
                    :color="'#57534e'"
                    :size="20"
                ></WIcon>
            </div>

            <div class="title">
                <span class="hash">
                    <WIcon
                        :icon="mdiPound"
                        :color="'#a8a29e'"
                        :size="18"
                    ></WIcon>
                </span>
                <span>{{channelName}}</span>
            </div>

            <div class="desc" v-if="breadcrumb">{{breadcrumb}}</div>

            <div class="spacer"></div>

            <!-- 任務狀態 pills -->
            <div class="tstats">
                <span class="pill pending">
                    <span class="d"></span>{{$t('statPending')}} {{taskCounts.pending}}
                </span>
                <span class="pill running">
                    <span class="d"></span>{{$t('statRunning')}} {{taskCounts.running}}
                </span>
                <span class="pill done">
                    <span class="d"></span>{{$t('statDone')}} {{taskCounts.done}}
                </span>
            </div>

            <!-- agent 在線 chip -->
            <div class="agent-chip" v-if="agentId">
                <span class="av">{{agentInitial}}</span>
                <span class="dot"></span>
                <span class="agent-nm">{{agentId}}</span>
            </div>

            <!-- 本頻道成員管理入口 -->
            <div
                class="members-btn"
                data-fmid="chat-head-members-btn"
                :title="$t('mmMembers')"
                @click="onClickMembers"
            >
                <WIcon
                    :icon="mdiAccountGroupOutline"
                    :color="'#57534e'"
                    :size="18"
                ></WIcon>
            </div>

        </header>

        <!-- 本頻道成員管理 dialog: fixedChannelId 綁定當前頻道, 免再選頻道 -->
        <WDialog
            :show.sync="showMembers"
            :title="$t('mmMembers')"
            :icon="mdiAccountGroupOutline"
            :minWidth="720"
            :maxWidth="720"
            :headerBackgroundColor="'#0f766e'"
            :contentBackgroundColor="'#fff'"
            :hasSaveBtn="false"
            :close-btn-tooltip="$t('close')"
        >
            <template v-slot:content>
                <div
                    data-fmid="channel-members-dialog"
                    style="height:560px; max-height:80vh;"
                >
                    <LayoutContentMembers
                        v-if="showMembers"
                        :fixedChannelId="currentChannelId"
                    ></LayoutContentMembers>
                </div>
            </template>
        </WDialog>

        <!-- 時間軸 -->
        <section class="timeline" data-fmid="chat-timeline" ref="timeline">

            <template v-if="messagesView.length > 0">

                <div class="day">{{$t('today')}}</div>

                <div
                    :key="m.id"
                    v-for="m in messagesView"
                    :class="`msg ${msgSide(m)}`"
                >

                    <!-- avatar -->
                    <div class="av" :style="`background:${avatarColor(m)};`">
                        {{avatarInitial(m)}}
                    </div>

                    <!-- bubble -->
                    <div :class="`bubble ${bubbleKindClass(m)}`">

                        <div class="meta">
                            <span class="who">{{senderLabel(m)}}</span>
                            <span
                                :class="`kbadge ${m.kind==='task' ? 'task' : 'reply'}`"
                                v-if="m.kind==='task' || m.kind==='taskReply'"
                            >
                                {{kindText(m.kind)}}
                            </span>
                            <span class="tm">{{m.timeCreate}}</span>
                        </div>

                        <div
                            class="body md-body"
                            v-html="renderMd(m.content)"
                        ></div>

                        <!-- 圖片附件 -->
                        <div class="imgs" v-if="attachmentsOf(m).length > 0">
                            <img
                                :key="fid"
                                v-for="fid in attachmentsOf(m)"
                                class="att-img"
                                :src="fileUrl(fid)"
                                :title="$t('viewImage')"
                                @click="onClickImage(fid)"
                            >
                        </div>

                    </div>

                </div>

            </template>

            <div class="timeline-empty" v-else>
                {{$t('timelineEmpty')}}
            </div>

        </section>

        <!-- composer -->
        <Composer
            :channelId="currentChannelId"
            @sent="onSent"
        ></Composer>

        <!-- 圖片放大檢視 modal -->
        <div
            class="img-modal"
            data-fmid="image-modal"
            v-if="imageModalUrl"
            @click="onCloseImage"
        >
            <img class="img-modal-img" :src="imageModalUrl" @click.stop>
            <span class="img-modal-close" @click="onCloseImage">
                <WIcon
                    :icon="mdiClose"
                    :color="'#fff'"
                    :size="22"
                ></WIcon>
            </span>
        </div>

    </div>
</template>

<script>
import { mdiPound, mdiClose, mdiAccountGroupOutline, mdiArrowLeft } from '@mdi/js/mdi.js'
import showdown from 'showdown'
import DOMPurify from 'dompurify'
import get from 'lodash-es/get.js'
import filter from 'lodash-es/filter.js'
import sortBy from 'lodash-es/sortBy.js'
import find from 'lodash-es/find.js'
import isestr from 'wsemi/src/isestr.mjs'
import isearr from 'wsemi/src/isearr.mjs'
import buildFileUrl from '../plugins/mFileUrl.mjs'
import WIcon from 'w-component-vue/src/components/WIcon.vue'
import WDialog from 'w-component-vue/src/components/WDialog.vue'
import Composer from './Composer.vue'
import LayoutContentMembers from './LayoutContentMembers.vue'


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
        WDialog,
        Composer,
        LayoutContentMembers,
    },
    props: {
    },
    data: function() {
        return {
            mdiPound,
            mdiClose,
            mdiAccountGroupOutline,
            mdiArrowLeft,

            //訊息 / 任務以業務函式取回後存本地 (messages/tasks 走 kpFunExt 按需拉取, 不走 ORM 同步)
            messagesLocal: [],
            tasksLocal: [],

            //開窗輪詢 timer id (掛載期間每 5 秒靜默重拉, 使 agent 回應無須切頻道即可見)
            pollTimer: null,

            imageModalUrl: '',
            showMembers: false,
        }
    },
    mounted: function() {
        let vo = this
        //開窗輪詢: 視窗開啟期間定期靜默刷新訊息/任務 (messages/tasks 不走 ORM 同步, 見設計要點 D 同步策略)
        vo.pollTimer = setInterval(() => {
            vo.pollRefresh()
        }, 5000)
    },
    beforeDestroy: function() {
        let vo = this
        if (vo.pollTimer) {
            clearInterval(vo.pollTimer)
            vo.pollTimer = null
        }
    },
    watch: {
        currentChannelId: {
            immediate: true,
            handler: function(id) {
                let vo = this
                if (isestr(id)) {
                    vo.loadMessages()
                    vo.loadTasks()
                }
                else {
                    vo.messagesLocal = []
                    vo.tasksLocal = []
                }
            },
        },
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

        channels: function() {
            let vo = this
            let rs = get(vo, '$store.state.channels')
            if (!rs) {
                rs = []
            }
            return rs
        },

        channel: function() {
            let vo = this
            return find(vo.channels, { id: vo.currentChannelId }) || null
        },

        channelName: function() {
            let vo = this
            return get(vo, 'channel.name', '') || vo.currentChannelId
        },

        //麵包屑: levels 以 ' · ' 分隔顯示
        breadcrumb: function() {
            let vo = this
            let levels = get(vo, 'channel.levels', '')
            if (!isestr(levels)) {
                return ''
            }
            let segs = levels.split('.').map((s) => s.trim()).filter((s) => isestr(s))
            return segs.join(' · ')
        },

        agentId: function() {
            let vo = this
            return get(vo, 'channel.agentId', '')
        },

        agentInitial: function() {
            let vo = this
            let a = vo.agentId
            if (!isestr(a)) {
                return 'A'
            }
            return a.trim().charAt(0).toUpperCase()
        },

        userSelfId: function() {
            let vo = this
            return get(vo, '$store.state.userSelf.id', '')
        },

        messagesView: function() {
            let vo = this
            let rs = filter(vo.messagesLocal, (m) => m.channelId === vo.currentChannelId && m.isActive !== 'n')
            rs = sortBy(rs, 'id') //時序 asc
            return rs
        },

        //任務狀態計數 (供標題 pills)
        taskCounts: function() {
            let vo = this
            let rs = filter(vo.tasksLocal, (t) => t.channelId === vo.currentChannelId && t.isActive !== 'n')
            let kp = { pending: 0, running: 0, done: 0, error: 0 }
            rs.forEach((t) => {
                let st = get(t, 'state', '')
                if (kp[st] !== undefined) {
                    kp[st]++
                }
            })
            return kp
        },

    },
    methods: {

        renderMd: function(c) {
            if (!isestr(c)) {
                return ''
            }
            //安全: showdown 不消毒 HTML, 原始 content 經 v-html 會造成儲存型 XSS (<script>/<img onerror>/javascript: 連結);
            //故 makeHtml 輸出一律經 DOMPurify 消毒後才交 v-html.
            return DOMPurify.sanitize(mdConverter.makeHtml(c))
        },

        kindText: function(kind) {
            let vo = this
            return vo.$s.getKindText(vo, kind)
        },

        //fileUrl: 組 getFile 圖片 URL (給 <img src>), 與 Composer 共用 mFileUrl 單點維護
        fileUrl: function(fileId) {
            let vo = this
            return buildFileUrl(vo, fileId)
        },

        //attachmentsOf: JSON.parse message.attachments → file id 陣列
        attachmentsOf: function(m) {
            let raw = get(m, 'attachments', '')
            if (!isestr(raw)) {
                return []
            }
            try {
                let arr = JSON.parse(raw)
                if (isearr(arr)) {
                    return arr.filter((x) => isestr(x))
                }
            }
            catch (err) {
                //解析失敗視為無附件
                return []
            }
            return []
        },

        //訊息靠左 / 靠右: 自己發的靠右
        msgSide: function(m) {
            let vo = this
            if (get(m, 'senderId', '') === vo.userSelfId) {
                return 'me'
            }
            return get(m, 'senderType', '') === 'agent' ? 'agent' : 'human'
        },

        //avatar 顏色: 自己 rail 近黑 / agent teal / 其他人類深棕
        avatarColor: function(m) {
            let vo = this
            if (get(m, 'senderId', '') === vo.userSelfId) {
                return 'var(--rail)'
            }
            if (get(m, 'senderType', '') === 'agent') {
                return 'var(--accent)'
            }
            return '#44403c'
        },

        avatarInitial: function(m) {
            let vo = this
            //自己用使用者名稱首字, agent 用 agentId 首字, 其他用 senderId 首字
            let senderId = get(m, 'senderId', '')
            if (senderId === vo.userSelfId) {
                let nm = get(vo, '$store.state.userSelf.name', '') || senderId
                return isestr(nm) ? nm.trim().charAt(0).toUpperCase() : '?'
            }
            if (isestr(senderId)) {
                return senderId.trim().charAt(0).toUpperCase()
            }
            return '?'
        },

        //發送者標籤: 自己用使用者名稱, 否則用 senderId
        senderLabel: function(m) {
            let vo = this
            let senderId = get(m, 'senderId', '')
            if (senderId === vo.userSelfId) {
                return get(vo, '$store.state.userSelf.name', '') || senderId
            }
            return senderId || vo.$s.getSenderTypeText(vo, get(m, 'senderType', ''))
        },

        //bubble kind class: task / taskReply 卡片樣式
        bubbleKindClass: function(m) {
            let kind = get(m, 'kind', '')
            if (kind === 'task') {
                return 'taskcard'
            }
            if (kind === 'taskReply') {
                return 'replycard'
            }
            return ''
        },

        loadMessages: function() {
            let vo = this
            if (!isestr(vo.currentChannelId)) {
                return
            }
            let cid = vo.currentChannelId
            let core = async () => {
                let ok = false
                await vo.$fapi.getMessages(cid, 50)
                    .then((rs) => { vo.messagesLocal = isearr(rs) ? rs : []; ok = true })
                    .catch((err) => { console.log('getMessages', err) })
                return ok ? 'ok' : undefined
            }
            core()
                .then(() => { vo.scrollToBottom() })
                .catch((err) => { console.log('loadMessages catch', err) })
        },

        loadTasks: function() {
            let vo = this
            if (!isestr(vo.currentChannelId)) {
                return
            }
            let cid = vo.currentChannelId
            let core = async () => {
                let ok = false
                await vo.$fapi.getTasks(cid, 200, '', 'desc')
                    .then((rs) => { vo.tasksLocal = isearr(rs) ? rs : []; ok = true })
                    .catch((err) => { console.log('getTasks', err) })
                return ok ? 'ok' : undefined
            }
            core().catch((err) => { console.log('loadTasks catch', err) })
        },

        //發送成功後刷新訊息與任務計數
        onSent: function() {
            let vo = this
            vo.loadMessages()
            vo.loadTasks()
        },

        //開窗輪詢之靜默刷新: 資料有變才更新 (避免無謂重繪); 原本貼底才自動捲到底 (不打斷使用者往上閱讀)
        pollRefresh: function() {
            let vo = this
            if (!isestr(vo.currentChannelId)) {
                return
            }
            if (document.hidden) {
                return //背景分頁不輪詢
            }
            let cid = vo.currentChannelId
            let core = async () => {
                let rs = await vo.$fapi.getMessages(cid, 50)
                    .catch((err) => { console.log('pollRefresh getMessages', err); return null })
                //頻道已切換或取回失敗則放棄本輪
                if (rs === null || cid !== vo.currentChannelId) {
                    return
                }
                let rsNew = isearr(rs) ? rs : []
                if (JSON.stringify(rsNew) !== JSON.stringify(vo.messagesLocal)) {
                    //貼底判定須在更新前取值
                    let el = get(vo, '$refs.timeline', null)
                    let atBottom = el ? (el.scrollTop + el.clientHeight >= el.scrollHeight - 60) : true
                    vo.messagesLocal = rsNew
                    if (atBottom) {
                        vo.scrollToBottom()
                    }
                }
                let ts = await vo.$fapi.getTasks(cid, 200, '', 'desc')
                    .catch((err) => { console.log('pollRefresh getTasks', err); return null })
                if (ts === null || cid !== vo.currentChannelId) {
                    return
                }
                let tsNew = isearr(ts) ? ts : []
                if (JSON.stringify(tsNew) !== JSON.stringify(vo.tasksLocal)) {
                    vo.tasksLocal = tsNew
                }
            }
            core()
                .catch((err) => { console.log('pollRefresh catch', err) })
        },

        scrollToBottom: function() {
            let vo = this
            vo.$nextTick(() => {
                let el = get(vo, '$refs.timeline', null)
                if (el) {
                    el.scrollTop = el.scrollHeight
                }
            })
        },

        onClickImage: function(fileId) {
            let vo = this
            if (!isestr(fileId)) {
                return
            }
            vo.imageModalUrl = vo.fileUrl(fileId)
        },

        onCloseImage: function() {
            let vo = this
            vo.imageModalUrl = ''
        },

        onClickMembers: function() {
            let vo = this
            vo.showMembers = true
        },

        //RWD 窄屏返回: 清空當前頻道 → 回頻道樹 (master-detail)
        onClickBack: function() {
            let vo = this
            vo.$store.commit(vo.$store.types.UpdateCurrentChannelId, '')
        },

    }
}
</script>

<style scoped>
.main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    height: 100%;
    background: var(--bg);
}
.ch-head {
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    padding: 12px 22px;
    display: flex;
    align-items: center;
    gap: 13px;
    flex-shrink: 0;
}
.ch-head .title {
    font-size: 18px;
    font-weight: 800;
    letter-spacing: -.02em;
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text);
    white-space: nowrap;
}
.ch-head .title .hash {
    display: flex;
    align-items: center;
}
.ch-head .desc {
    color: var(--text-2);
    font-size: 12px;
    border-left: 1px solid var(--border-2);
    padding-left: 13px;
    letter-spacing: .01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.ch-head .spacer {
    flex: 1;
}
.tstats {
    display: flex;
    gap: 5px;
}
.pill {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    font-weight: 700;
    padding: 4px 9px;
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text-2);
    border: 1px solid var(--border);
    letter-spacing: .01em;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
}
.pill .d {
    width: 6px;
    height: 6px;
    border-radius: 50%;
}
.pill.pending .d {
    background: var(--st-pending);
}
.pill.running .d {
    background: var(--st-running);
}
.pill.done .d {
    background: var(--st-done);
}
.agent-chip {
    display: flex;
    align-items: center;
    gap: 7px;
    background: var(--surface);
    border: 1px solid var(--border-2);
    padding: 3px 11px 3px 4px;
    border-radius: var(--radius);
    font-size: 12px;
    color: var(--text-2);
    font-weight: 600;
    white-space: nowrap;
}
.agent-chip .av {
    width: 22px;
    height: 22px;
    border-radius: var(--radius-sm);
    background: var(--rail);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
}
.agent-chip .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--st-done);
}
.members-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    margin-left: 10px;
    border-radius: var(--radius-sm);
    cursor: pointer;
}
.members-btn:hover {
    background: var(--border-2);
}
.back-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    margin-right: 8px;
    flex-shrink: 0;
    border-radius: var(--radius-sm);
    cursor: pointer;
}
.back-btn:hover {
    background: var(--border-2);
}
.timeline {
    flex: 1;
    overflow-y: auto;
    padding: 20px 26px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    background: var(--chat-bg); /* 對話畫布退一階 (通訊軟體慣例), 白/淡青綠氣泡浮於其上 */
}
.day {
    align-self: center;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: .06em;
    color: var(--text-3);
    background: var(--surface);
    border: 1px solid var(--border);
    padding: 3px 13px;
    border-radius: 20px;
    text-transform: uppercase;
}
.msg {
    display: flex;
    gap: 10px;
    max-width: 72%;
}
.msg.me {
    align-self: flex-end;
    flex-direction: row-reverse;
}
.msg .av {
    width: 32px;
    height: 32px;
    border-radius: var(--radius);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    font-weight: 700;
    color: #fff;
}
.bubble {
    background: var(--bubble-other);
    border: 1px solid var(--bubble-other-border);
    /* 不對稱圓角 (iMessage/Telegram 手法): 朝發送者側之下角收緊作方向暗示 — 對方在左, 收左下角 */
    border-radius: 12px 12px 12px 4px;
    padding: 9px 13px;
    box-shadow: var(--shadow-sm);
    min-width: 0;
}
/* 身分層 (LINE/WhatsApp 慣例: 我方淡青綠底墨字, 對方白底墨字, 黑字對比皆過 WCAG AA):
   所有訊息型態 (含任務卡) 一致帶身分底色, 任務頻道亦能一眼分辨我與對方 */
.msg.me .bubble {
    background: var(--bubble-me);
    border-color: var(--bubble-me-border);
    border-radius: 12px 12px 4px 12px; /* 我方在右, 收右下角 */
}
/* 語意層: 任務/回覆以左側 3px 色條 + kbadge 徽章標示 (teal=任務收, green=任務回), 不覆蓋身分底色 */
.bubble.taskcard {
    border-left: 3px solid var(--accent);
}
.bubble.replycard {
    border-left: 3px solid var(--st-done);
}
.bubble .meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
}
.bubble .who {
    font-size: 12.5px;
    font-weight: 800;
    letter-spacing: -.01em;
    color: var(--text);
}
.bubble .tm {
    font-size: 10.5px;
    color: var(--text-3);
    font-variant-numeric: tabular-nums;
    letter-spacing: .02em;
}
.kbadge {
    font-size: 9.5px;
    font-weight: 800;
    padding: 2px 7px;
    border-radius: 3px;
    color: #fff;
    letter-spacing: .06em;
    text-transform: uppercase;
}
.kbadge.task {
    background: var(--accent);
}
.kbadge.reply {
    background: var(--st-done);
}
.bubble .body {
    font-size: 13px;
    color: var(--text-2);
    line-height: 1.55;
    word-break: break-word;
}
.imgs {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 9px;
}
.imgs .att-img {
    width: 140px;
    height: 90px;
    object-fit: cover;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-2);
    cursor: pointer;
    transition: opacity .12s;
}
.imgs .att-img:hover {
    opacity: .85;
}
.timeline-empty {
    align-self: center;
    margin-top: 30px;
    font-size: 13px;
    color: var(--text-3);
}

/* markdown body */
.md-body >>> p {
    margin: 2px 0;
}
.md-body >>> b,
.md-body >>> strong {
    color: var(--text);
    font-weight: 800;
}
.md-body >>> pre {
    background: rgba(0, 0, 0, .04);
    padding: 8px;
    border-radius: var(--radius-sm);
    overflow-x: auto;
}
.md-body >>> code {
    background: rgba(0, 0, 0, .05);
    padding: 1px 4px;
    border-radius: 3px;
}
.md-body >>> ul,
.md-body >>> ol {
    margin: 4px 0;
    padding-left: 20px;
}
.md-body >>> table {
    border-collapse: collapse;
    margin-top: 7px;
    font-size: 12px;
}
.md-body >>> table td,
.md-body >>> table th {
    border: 1px solid var(--border-2);
    padding: 4px 11px;
}
.md-body >>> table th {
    background: rgba(0, 0, 0, .03);
    font-weight: 700;
    color: var(--text);
}

/* 圖片放大 modal */
.img-modal {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(10, 10, 10, .8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    padding: 40px;
}
.img-modal-img {
    max-width: 90%;
    max-height: 90%;
    border-radius: var(--radius);
    box-shadow: var(--shadow);
}
.img-modal-close {
    position: absolute;
    top: 20px;
    right: 24px;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: rgba(255, 255, 255, .12);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background .12s;
}
.img-modal-close:hover {
    background: rgba(255, 255, 255, .25);
}

/* RWD 窄屏: 標題列項目過多會溢出 → 隱藏次要資訊 (breadcrumb / 任務 pills / agent chip),
   保留 返回鈕 + 頻道標題 + 成員入口; 時間軸縮小左右留白 */
@media (max-width: 767px) {
    .ch-head {
        padding: 10px 12px;
        gap: 8px;
    }
    .ch-head .desc,
    .ch-head .tstats,
    .ch-head .agent-chip {
        display: none;
    }
    .timeline {
        padding: 16px 12px;
    }
}
</style>
