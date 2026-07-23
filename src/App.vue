<template>
    <div
        v-domresize
        @domresize="resize"
    >

        <LayoutState :style="`opacity:${ready?0:1};`" v-if="!ready"></LayoutState>

        <transition enter-active-class="fade-enter-active" leave-active-class="fade-leave-active">
            <Layout v-if="ready"></Layout>
        </transition>

        <LoadingWinBar></LoadingWinBar>
        <CheckYesNo></CheckYesNo>
        <CheckYes></CheckYes>

    </div>
</template>

<script>
import get from 'lodash-es/get.js'
import cloneDeep from 'lodash-es/cloneDeep.js'
import isestr from 'wsemi/src/isestr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isDev from 'wsemi/src/isDev.mjs'
import wui from 'w-ui-loginout/src/WUiLoginout.mjs'
import LoadingWinBar from './components/Common/LoadingWinBar.vue'
import CheckYesNo from './components/Common/CheckYesNo.vue'
import CheckYes from './components/Common/CheckYes.vue'
import LayoutState from './components/LayoutState.vue'
import Layout from './components/Layout.vue'


export default {
    components: {
        LoadingWinBar,
        CheckYesNo,
        CheckYes,
        LayoutState,
        Layout,
    },
    beforeMount: function() {
        // console.log('methods beforeMount')

        let vo = this

        //setVo, 更換ui內vo, 才能使用廣播技術, 更換語系才能用廣播通知全部組件forceUpdate
        vo.$ui.setVo(vo)

        //setLang
        let lang = get(window, '___pmwtask___.language', '')
        vo.$ui.setLang(lang, 'app init') //初始化先讀取html內語系設定進行變更
        // console.log('lang', lang)

        function loginSuccess(data) {
            console.log('login success', cloneDeep(data.user))
            vo.$ui.updateConnState('csLogin')
            vo.$ui.updateUserToken(data.token)
            vo.$ui.updateUserSelf(data.user)
        }

        function loginError(data) {
            console.log('login error', cloneDeep(data))
            vo.$ui.updateConnState('csErrLogin')
            vo.$ui.updateUserToken('')
            let urlRedirect = get(window, '___pmwtask___.urlRedirect', '')
            if (!isestr(urlRedirect)) {
                console.log('urlRedirect', urlRedirect)
                throw new Error(`invalid urlRedirect`)
            }
            if (isDev()) {
                console.log('60s redirect to:', urlRedirect)
                setTimeout(() => {
                    window.location.href = urlRedirect
                }, 60 * 1000)
            }
            else {
                window.location.href = urlRedirect
            }
        }

        //login
        console.log('login...')
        let ll = wui('wtask', {
            timeWaitAnimation: 2000,
            params: {},
        })
        ll.login({
            afterGetUser: null,
            afterLogin: null,
            loginSuccess,
            loginError,
        })
    },
    mounted: function() {
        let vo = this

        //set, 把目前vo儲存至window供外部非vue環境使用
        window.$vo = vo

    },
    computed: {

        ready: function() {
            //console.log('computed ready')

            let vo = this

            let connState = get(vo, `$store.state.connState`)
            let webInfor = get(vo, `$store.state.webInfor`)

            let b1 = connState === 'csLogin'
            let b2 = iseobj(webInfor)
            let b = b1 && b2

            return b
        },

    },
    methods: {

        resize: function(msg) {
            // console.log('methods resize', msg)

            let vo = this

            //syncHeight
            vo.$ui.syncHeight()

        },

    },
}
</script>

<style>
/* === 設計系統 tokens (D 墨黑翠青編輯感; 取自 spec/ui設計參考-editorial.html :root) === */
:root {
    /* surfaces & ink */
    --bg: #fafaf9;            /* 暖白紙感 */
    --surface: #ffffff;
    --rail: #111111;          /* 近黑 rail */
    --border: #e7e5e4;        /* stone */
    --border-2: #d6d3d1;
    --text: #0a0a0a;
    --text-2: #57534e;        /* stone 600 */
    --text-3: #a8a29e;        /* stone 400 暖灰 */
    /* accent */
    --accent: #0d9488;        /* 深翠青 teal */
    --accent-700: #0f766e;
    --accent-soft: #ccfbf1;
    --accent-tint: #f0fdfa;
    /* 語意狀態色 */
    --st-pending: #78716c;
    --st-running: #2563eb;
    --st-done: #16a34a;
    --st-error: #dc2626;
    /* 聊天對話區 (LINE/WhatsApp/Telegram 慣例: 對話畫布底色退一階, 氣泡浮於其上;
       我方淡主色底墨字, 對方白底墨字, 身分一眼可辨) */
    --chat-bg: #efebe4;             /* 對話畫布: 暖米紙 (WhatsApp 米色之 stone 家族化) */
    --bubble-me: #ccfbf1;           /* 我方: teal-100, 呼應 accent */
    --bubble-me-border: #99f6e4;    /* teal-200 */
    --bubble-other: #ffffff;        /* 對方: 白, 浮於暖米畫布上 */
    --bubble-other-border: #e7e5e4; /* stone-200 hairline */
    /* shape — 銳利, 小圓角 */
    --radius: 6px;
    --radius-sm: 4px;
    --shadow-sm: 0 1px 1px rgba(10, 10, 10, .04);
    --shadow: 0 6px 24px rgba(10, 10, 10, .07);
}

html,
body {
    font-family: '微軟正黑體', 'Microsoft JhengHei', 'MicrosoftJhengHeiRegular', 'Avenir', Helvetica, Arial, sans-serif;
    overflow-y: hidden;
}

div,
p,
span,
a,
pre,
input,
textarea,
button {
    font-family: inherit;
}

.fade-enter-active {
  animation: go 1s;
}

.fade-leave-active {
  animation: back 1s;
}

@keyframes go {
  from { opacity: 0; }
  to {opacity: 1;}
}

@keyframes back {
  from { opacity: 1; }
  to { opacity: 0; }
}

</style>
