<template>
    <nav
        data-fmid="rail"
        class="rail"
    >

        <!-- logo -->
        <div class="logo">
            <WIcon
                :icon="mdiClipboardFlowOutline"
                :color="'#fff'"
                :size="21"
            ></WIcon>
        </div>

        <!-- nav -->
        <div class="nav">

            <div
                :key="it.key"
                v-for="it in navItems"
                :class="`item ${section===it.key ? 'active' : ''}`"
                :data-fmid="`rail-nav-${it.key}`"
                @click="onClickNav(it.key)"
            >
                <WIcon
                    :icon="it.icon"
                    :color="section===it.key ? '#fff' : '#8a8782'"
                    :size="21"
                ></WIcon>
                <span class="lb">{{it.label}}</span>
            </div>

        </div>

        <div class="spacer"></div>

        <!-- 設定鈕 (popup: 目前提供語系切換, 未來其他設定統一收納於此) -->
        <div style="position:relative;">

            <div
                class="item setbtn"
                data-fmid="rail-settings"
                :title="$t('settings')"
                @click="toggleSettings"
            >
                <WIcon
                    :icon="mdiCog"
                    :color="'#8a8782'"
                    :size="21"
                ></WIcon>
                <span class="lb">{{$t('settings')}}</span>
            </div>

            <div
                class="usermenu"
                data-fmid="rail-settingsmenu"
                v-if="showSettings"
            >

                <div class="um-name">{{$t('settings')}}</div>

                <template v-if="showLangSelect">
                    <div
                        :key="lg"
                        v-for="lg in keysLang"
                        :class="`um-item ${lang===lg ? 'on' : ''}`"
                        @click="onClickLang(lg)"
                    >
                        <WIcon
                            :icon="mdiTranslate"
                            :color="'#57534e'"
                            :size="15"
                        ></WIcon>
                        <span>{{getLangText(lg)}}</span>
                    </div>
                </template>

            </div>

        </div>

        <!-- 使用者頭像 (點擊開語系 / 登出選單) -->
        <div style="position:relative;">

            <div
                class="avatar"
                data-fmid="rail-avatar"
                :title="userName"
                @click="toggleMenu"
            >
                {{userInitial}}
            </div>

            <div
                class="usermenu"
                data-fmid="rail-usermenu"
                v-if="showMenu"
            >

                <div class="um-name">{{userName}}</div>

                <div
                    class="um-item logout"
                    data-fmid="rail-logout"
                    @click="onClickLogout"
                >
                    <WIcon
                        :icon="mdiLogoutVariant"
                        :color="'#c62828'"
                        :size="15"
                    ></WIcon>
                    <span>{{$t('logout')}}</span>
                </div>

            </div>

        </div>

    </nav>
</template>

<script>
import { mdiClipboardFlowOutline, mdiChartBoxOutline, mdiForumOutline, mdiCogOutline, mdiCog, mdiLogoutVariant, mdiTranslate } from '@mdi/js/mdi.js'
import get from 'lodash-es/get.js'
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
            mdiClipboardFlowOutline,
            mdiCog,
            mdiLogoutVariant,
            mdiTranslate,

            showMenu: false,
            showSettings: false,
            showLangSelect: false,

            keysLang: [
                'eng',
                'cht',
            ],
            kpLangSelect: {
                'eng': 'English',
                'cht': '中文',
            },

        }
    },
    mounted: function() {
        let vo = this

        //showLangSelect: 依 webInfor 設定顯隱 (沿用舊 Layout 之語系選單顯隱判斷)
        let showLanguage = get(vo, 'webInfor.showLanguage', '')
        vo.showLangSelect = showLanguage === 'y'

    },
    computed: {

        section: function() {
            let vo = this
            return get(vo, '$store.state.section', 'channels')
        },

        webInfor: function() {
            let vo = this
            return get(vo, '$store.state.webInfor', {})
        },

        lang: function() {
            let vo = this
            return get(vo, '$store.state.lang', '')
        },

        userSelf: function() {
            let vo = this
            return get(vo, '$store.state.userSelf', {})
        },

        userName: function() {
            let vo = this
            return get(vo, 'userSelf.name', '') || get(vo, 'userSelf.id', '')
        },

        userInitial: function() {
            let vo = this
            let nm = vo.userName
            if (!isestr(nm)) {
                return '?'
            }
            //取首字 (中文首字 / 英文首字母大寫)
            let c = nm.trim().charAt(0)
            return c.toUpperCase()
        },

        navItems: function() {
            let vo = this
            return [
                {
                    key: 'stats',
                    label: vo.$t('mmStats'),
                    icon: mdiChartBoxOutline,
                },
                {
                    key: 'channels',
                    label: vo.$t('mmChannels'),
                    icon: mdiForumOutline,
                },
                {
                    key: 'admin',
                    label: vo.$t('mmAdmin'),
                    icon: mdiCogOutline,
                },
            ]
        },

    },
    methods: {

        onClickNav: function(key) {
            let vo = this
            if (!isestr(key)) {
                return
            }
            vo.$store.commit(vo.$store.types.UpdateSection, key)
            vo.showMenu = false
        },

        toggleMenu: function() {
            let vo = this
            vo.showMenu = !vo.showMenu
            vo.showSettings = false //與設定 popup 互斥
        },

        toggleSettings: function() {
            let vo = this
            vo.showSettings = !vo.showSettings
            vo.showMenu = false //與頭像 popup 互斥
        },

        getLangText: function(lg) {
            let vo = this
            return get(vo, `kpLangSelect.${lg}`, '')
        },

        onClickLang: function(lg) {
            let vo = this
            vo.$ui.setLang(lg, 'rail settings')
            vo.showSettings = false
        },

        onClickLogout: function() {
            let vo = this

            vo.showMenu = false

            //showCheckYesNo 確認 (沿用舊登出流程: 清前端登入態 → 轉址 SSO)
            vo.$dg.showCheckYesNo(vo.$t('logoutConfirm'))
                .then(() => {

                    localStorage.setItem('wtask:userToken', '')
                    vo.$ui.updateUserToken('')

                    let urlRedirect = get(window, '___pmwtask___.urlRedirect', '')
                    if (isestr(urlRedirect)) {
                        window.location.href = urlRedirect
                    }
                    else {
                        window.location.reload()
                    }

                })
                .catch(() => {})

        },

    }
}
</script>

<style scoped>
.rail {
    width: 70px;
    background: var(--rail);
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 12px 0;
    flex-shrink: 0;
    border-right: 1px solid #000;
}
.rail .logo {
    width: 38px;
    height: 38px;
    border-radius: 8px;
    background: var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    margin-bottom: 20px;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .08);
}
.rail .nav {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    align-items: center;
}
.rail .item {
    width: 56px;
    height: 54px;
    border-radius: var(--radius);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    color: #8a8782;
    cursor: pointer;
    position: relative;
    transition: color .12s, background .12s;
}
.rail .item .lb {
    font-size: 10px;
    letter-spacing: .4px;
    font-weight: 600;
}
.rail .item:hover {
    background: #1c1c1c;
    color: #e7e5e4;
}
.rail .setbtn {
    margin-bottom: 8px; /* 與下方頭像留距 */
    color: #8a8782;
}
.rail .item.active {
    background: #1c1c1c;
    color: #fff;
}
.rail .item.active::before {
    content: "";
    position: absolute;
    left: -12px;
    top: 13px;
    bottom: 13px;
    width: 3px;
    border-radius: 0 2px 2px 0;
    background: var(--accent);
}
.rail .spacer {
    flex: 1;
}
.rail .avatar {
    width: 36px;
    height: 36px;
    border-radius: 8px;
    background: #2a2a2a;
    color: #e7e5e4;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 700;
    border: 1px solid #3a3a3a;
    cursor: pointer;
    transition: background .12s;
}
.rail .avatar:hover {
    background: #3a3a3a;
}
.usermenu {
    position: absolute;
    left: 46px;
    bottom: 0;
    min-width: 150px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 6px;
    z-index: 50;
}
.usermenu .um-name {
    font-size: 12px;
    font-weight: 800;
    color: var(--text);
    padding: 5px 8px 7px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 4px;
    white-space: nowrap;
}
.usermenu .um-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 8px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 12.5px;
    color: var(--text-2);
}
.usermenu .um-item:hover {
    background: var(--bg);
}
.usermenu .um-item.on {
    color: var(--accent-700);
    font-weight: 700;
    background: var(--accent-tint);
}
.usermenu .um-item.logout {
    color: #c62828;
    font-weight: 600;
}
.usermenu .um-item.logout:hover {
    background: #fdecea;
}
.usermenu .um-sep {
    height: 1px;
    background: var(--border);
    margin: 4px 0;
}
</style>
