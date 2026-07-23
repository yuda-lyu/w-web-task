<template>
    <div
        data-fmid="composer"
        class="composer"
    >
        <div class="box" :class="{ focused: focused }">

            <!-- 圖片預覽列 (已上傳完成者) -->
            <div class="previews" v-if="attachments.length > 0 || uploading">
                <div
                    :key="a.id"
                    v-for="a in attachments"
                    class="thumb"
                >
                    <img class="thumb-img" :src="a.url" :alt="a.name" :title="a.name">
                    <span
                        class="x"
                        :title="$t('removeImage')"
                        :data-fmid="`composer-remove-${a.id}`"
                        @click="onRemoveAttachment(a.id)"
                    >
                        <WIcon
                            :icon="mdiClose"
                            :color="'#fff'"
                            :size="12"
                        ></WIcon>
                    </span>
                </div>

                <!-- 上傳中縮圖 -->
                <div class="thumb uploading" v-if="uploading">
                    <WIconLoading
                        :name="'cir-rotate'"
                        :color="'#a8a29e'"
                        :size="20"
                    ></WIconLoading>
                </div>
            </div>

            <!-- 任務標題 (開成任務時) -->
            <div class="task-title" v-if="asTask">
                <input
                    data-fmid="composer-task-title"
                    :value="taskTitle"
                    :placeholder="$t('taskTitlePlaceholder')"
                    @input="onInputTitle"
                >
            </div>

            <!-- textarea -->
            <textarea
                ref="ta"
                data-fmid="composer-textarea"
                :value="content"
                :placeholder="$t('composerPlaceholder')"
                @input="onInputContent"
                @paste="onPaste"
                @keydown="onKeydown"
                @focus="focused = true"
                @blur="focused = false"
            ></textarea>

            <!-- 工具列 -->
            <div class="bar">

                <!-- 附圖鈕 -->
                <div
                    class="tool"
                    :title="$t('attachImage')"
                    data-fmid="composer-attach"
                    @click="onClickAttach"
                >
                    <WIcon
                        :icon="mdiImagePlusOutline"
                        :color="'#57534e'"
                        :size="19"
                    ></WIcon>
                </div>
                <input
                    ref="fileInput"
                    type="file"
                    accept="image/*"
                    multiple
                    style="display:none;"
                    @change="onChangeFile"
                >

                <!-- 開成任務 toggle -->
                <div
                    class="toggle"
                    data-fmid="composer-astask"
                    @click="onToggleAsTask"
                >
                    <span class="sw" :class="{ on: asTask }"></span>
                    <span>{{$t('openAsTask')}}</span>
                </div>

                <div class="spacer"></div>

                <span class="hint">{{$t('composerHint')}}</span>

                <!-- 發送鈕 -->
                <WButtonChip
                    :text="$t('sendMessage')"
                    :icon="mdiSend"
                    :iconSize="16"
                    :iconColor="'#fff'"
                    :iconColorHover="'#fff'"
                    :textColor="'#fff'"
                    :textColorHover="'#fff'"
                    :textFontSize="'13px'"
                    :backgroundColor="'#0d9488'"
                    :backgroundColorHover="'#0f766e'"
                    :borderColor="'transparent'"
                    :borderRadius="4"
                    :paddingStyle="{ v: 6, h: 14 }"
                    :shadow="false"
                    :editable="!!channelId"
                    :promiseUnlock="true"
                    @click="onClickSendBtn"
                ></WButtonChip>

            </div>

            <!-- inline 錯誤紅字 -->
            <div class="cerr" v-if="aError">{{aError}}</div>

        </div>
    </div>
</template>

<script>
import { mdiImagePlusOutline, mdiSend, mdiClose } from '@mdi/js/mdi.js'
import get from 'lodash-es/get.js'
import map from 'lodash-es/map.js'
import filter from 'lodash-es/filter.js'
import isestr from 'wsemi/src/isestr.mjs'
import buildFileUrl from '../plugins/mFileUrl.mjs'
import WIcon from 'w-component-vue/src/components/WIcon.vue'
import WIconLoading from 'w-component-vue/src/components/WIconLoading.vue'
import WButtonChip from 'w-component-vue/src/components/WButtonChip.vue'


export default {
    components: {
        WIcon,
        WIconLoading,
        WButtonChip,
    },
    props: {
        channelId: {
            type: String,
            default: '',
        },
    },
    data: function() {
        return {
            mdiImagePlusOutline,
            mdiSend,
            mdiClose,

            content: '',
            taskTitle: '',
            asTask: false,

            attachments: [], //[{ id, name, url }] 已上傳完成者
            uploading: false, //上傳中旗標 (顯 loading 縮圖)
            sending: false, //發送中旗標 (防 Enter 重複觸發)

            focused: false,

            aError: '',
        }
    },
    watch: {
        //切換頻道時清空輸入狀態 (避免跨頻道殘留)
        channelId: function() {
            let vo = this
            vo.content = ''
            vo.taskTitle = ''
            vo.asTask = false
            vo.attachments = []
            vo.aError = ''
        },
    },
    methods: {

        //fileUrl: 組 getFile 圖片 URL (給 <img src>), 與 ChatView 共用 mFileUrl 單點維護
        fileUrl: function(fileId) {
            let vo = this
            return buildFileUrl(vo, fileId)
        },

        onInputContent: function(ev) {
            this.content = get(ev, 'target.value', '')
        },

        onInputTitle: function(ev) {
            this.taskTitle = get(ev, 'target.value', '')
        },

        onToggleAsTask: function() {
            let vo = this
            vo.asTask = !vo.asTask
        },

        //貼圖: 讀 clipboard items, 對 image/* 上傳
        onPaste: function(ev) {
            let vo = this

            let items = get(ev, 'clipboardData.items', null)
            if (!items) {
                return
            }

            //收集 image 檔
            let files = []
            for (let i = 0; i < items.length; i++) {
                let it = items[i]
                if (it && isestr(it.type) && it.type.indexOf('image/') === 0) {
                    let f = it.getAsFile()
                    if (f) {
                        files.push(f)
                    }
                }
            }

            //有圖才攔截預設貼上 (避免把 base64 貼進文字)
            if (files.length > 0) {
                ev.preventDefault()
                vo.uploadFiles(files)
            }

        },

        //Enter 發送 (Shift+Enter 換行)
        onKeydown: function(ev) {
            let vo = this
            if (ev.key === 'Enter' && !ev.shiftKey) {
                ev.preventDefault()
                vo.doSend()
            }
        },

        onClickAttach: function() {
            let vo = this
            let inp = get(vo, '$refs.fileInput', null)
            if (inp) {
                inp.click()
            }
        },

        onChangeFile: function(ev) {
            let vo = this
            let fl = get(ev, 'target.files', null)
            if (!fl || fl.length === 0) {
                return
            }
            let files = []
            for (let i = 0; i < fl.length; i++) {
                files.push(fl[i])
            }
            vo.uploadFiles(files)
            //清空 input value 以便重複選同檔
            ev.target.value = ''
        },

        //讀檔成 base64 → uploadFile → push attachments
        uploadFiles: function(files) {
            let vo = this

            let readAsBase64 = (file) => {
                return new Promise((resolve, reject) => {
                    let reader = new FileReader()
                    reader.onload = () => {
                        let dataUrl = get(reader, 'result', '')
                        let base64 = isestr(dataUrl) ? dataUrl.split(',')[1] : ''
                        resolve(base64)
                    }
                    reader.onerror = () => { reject(new Error('read file error')) }
                    reader.readAsDataURL(file)
                })
            }

            let core = async () => {

                vo.aError = ''
                vo.uploading = true

                for (let file of files) {

                    //僅處理 image/*
                    let type = get(file, 'type', '')
                    if (!isestr(type) || type.indexOf('image/') !== 0) {
                        continue
                    }

                    let dataBase64 = ''
                    let okRead = false
                    await readAsBase64(file)
                        .then((b) => { dataBase64 = b; okRead = true })
                        .catch((err) => { console.log('readAsBase64', err) })
                    if (!okRead || !isestr(dataBase64)) {
                        vo.aError = vo.$t('uploadImageFail')
                        continue
                    }

                    let name = get(file, 'name', '') || 'pasted.png'

                    let okUp = false
                    await vo.$fapi.uploadFile({ name, type, dataBase64 })
                        .then((r) => {
                            let id = get(r, 'id', '')
                            if (isestr(id)) {
                                vo.attachments.push({ id, name: get(r, 'name', name), url: vo.fileUrl(id) })
                                okUp = true
                            }
                        })
                        .catch((err) => { console.log('uploadFile', err); vo.aError = `${vo.$t('uploadImageFail')}: ${vo.$tErr(err)}` })
                    if (!okUp) {
                        //單檔失敗繼續處理其餘
                        continue
                    }

                }

                return 'ok'
            }

            core()
                .catch((err) => { console.log('uploadFiles catch', err); vo.aError = vo.$t('uploadImageFail') })
                .finally(() => { vo.uploading = false })

        },

        onRemoveAttachment: function(id) {
            let vo = this
            //移除只從本地清單拿掉 (不刪伺服器檔)
            vo.attachments = filter(vo.attachments, (a) => a.id !== id)
        },

        //發送按鈕: 第一行釋放視覺鎖 + fire-and-forget doSend
        onClickSendBtn: function(msg) {
            let vo = this
            msg.pm.resolve()
            vo.doSend()
        },

        //doSend: core 五段
        doSend: function() {
            let vo = this

            //防 Enter / 按鈕 並發重送
            if (vo.sending) {
                return
            }

            let core = async () => {

                //1) 清空舊 inline 錯誤
                vo.aError = ''

                //2) 同步檢測
                if (!isestr(vo.channelId)) {
                    vo.aError = vo.$t('selectChannelFirst')
                    return
                }
                if (!isestr(vo.content) && vo.attachments.length === 0) {
                    vo.aError = vo.$t('messageContentEmpty')
                    return
                }
                if (vo.uploading) {
                    //上傳尚未完成, 擋下 (避免漏附件)
                    return
                }

                //opt
                let opt = {
                    asTask: vo.asTask,
                    title: vo.taskTitle,
                    attachments: map(vo.attachments, (a) => a.id),
                    senderType: 'human',
                }

                //3) 確定打 API 才開 loading
                vo.sending = true
                vo.$ui.updateLoading(true)

                //4) postMessage, 各自 catch + 旗標短路
                let ok = false
                let failMsg = ''
                await vo.$fapi.postMessage(vo.channelId, vo.content, opt)
                    .then(() => { ok = true })
                    .catch((err) => { console.log('postMessage', err); failMsg = `${vo.$t('postMessageFail')}: ${vo.$tErr(err)}` })
                if (!ok) {
                    vo.$ui.updateLoading(false)
                    await vo.$dg.showCheckYes(failMsg, { type: 'error' })
                    return
                }

                //成功: 清空輸入 + 通知父層刷新 (訊息出現即回饋, 不彈窗)
                vo.content = ''
                vo.taskTitle = ''
                vo.asTask = false
                vo.attachments = []

                vo.$emit('sent')

                //關 loading
                vo.$ui.updateLoading(false)

                return 'ok'
            }

            core()
                .catch((err) => {
                    console.log('catch', err)
                    vo.$ui.updateLoading(false)
                    vo.$alert(vo.$t('anUnexpectedErrorOccurred'), { type: 'error' })
                })
                .finally(() => {
                    vo.sending = false
                    vo.$ui.updateLoading(false)
                })

        },

    }
}
</script>

<style scoped>
.composer {
    padding: 10px 26px 18px;
}
.composer .box {
    background: var(--surface);
    border: 1px solid var(--border-2);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    overflow: hidden;
    transition: border-color .12s, box-shadow .12s;
}
.composer .box.focused {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft), var(--shadow);
}
.previews {
    display: flex;
    flex-wrap: wrap;
    gap: 9px;
    padding: 11px 13px 0;
}
.previews .thumb {
    width: 60px;
    height: 60px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-2);
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    background: var(--bg);
}
.previews .thumb.uploading {
    background: repeating-linear-gradient(45deg, #f5f5f4, #f5f5f4 6px, #eeece9 6px, #eeece9 12px);
}
.previews .thumb-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}
.previews .thumb .x {
    position: absolute;
    top: -7px;
    right: -7px;
    width: 19px;
    height: 19px;
    border-radius: 50%;
    background: var(--rail);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border: 2px solid #fff;
    z-index: 2;
}
.task-title {
    padding: 11px 15px 0;
}
.task-title input {
    width: 100%;
    border: none;
    border-bottom: 1px solid var(--border);
    outline: none;
    padding: 4px 2px;
    font-family: inherit;
    font-size: 13px;
    color: var(--text);
    background: transparent;
    transition: border-color .12s;
}
.task-title input::placeholder {
    color: var(--text-3);
}
.task-title input:focus {
    border-bottom-color: var(--accent);
}
.composer textarea {
    box-sizing: border-box; /* width 含 padding, 否則 100% 加上左右 padding 會爆出面板 */
    width: 100%;
    border: none;
    outline: none;
    resize: none;
    padding: 12px 15px 6px;
    font-family: inherit;
    font-size: 13.5px;
    color: var(--text);
    background: transparent;
    height: 52px;
    line-height: 1.5;
}
.composer textarea::placeholder {
    color: var(--text-3);
}
.composer .bar {
    display: flex;
    align-items: center;
    padding: 5px 10px 9px;
    gap: 5px;
}
.composer .tool {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background .12s;
}
.composer .tool:hover {
    background: var(--bg);
}
.toggle {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12px;
    color: var(--text-2);
    cursor: pointer;
    padding: 0 8px;
    font-weight: 600;
    user-select: none;
}
.toggle .sw {
    width: 32px;
    height: 18px;
    border-radius: 9px;
    background: var(--border-2);
    position: relative;
    transition: .15s;
    flex-shrink: 0;
}
.toggle .sw::after {
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
.toggle .sw.on {
    background: var(--accent);
}
.toggle .sw.on::after {
    left: 16px;
}
.composer .spacer {
    flex: 1;
}
.hint {
    font-size: 11px;
    color: var(--text-3);
    padding-right: 6px;
    letter-spacing: .01em;
}
.cerr {
    padding: 0 15px 10px;
    color: var(--st-error);
    font-size: 0.8rem;
}
</style>
