import Vue from 'vue'
import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import isestr from 'wsemi/src/isestr.mjs'
import isfun from 'wsemi/src/isfun.mjs'


let vo = Vue.prototype


//連線建立前的 fallback 專用, 僅含連線狀態字串, 其餘語系皆由後端提供
let kpFallback = {
    csIng: {
        eng: 'Connecting...',
        cht: '連線中...',
    },
    csLogin: {
        eng: 'Logged in',
        cht: '已登入',
    },
    csLogout: {
        eng: 'Logged out',
        cht: '已登出',
    },
    csErrConn: {
        eng: 'Unable to connect',
        cht: '無法連線',
    },
    csErrLogin: {
        eng: 'Login denied',
        cht: '拒絕登入',
    },
}


function setVo(vObj) {
    vo = vObj
}


function updateConnState(connState) {
    vo.$store.commit(vo.$store.types.UpdateConnState, connState)
}


function updateLoading(loading) {
    vo.$store.commit(vo.$store.types.UpdateLoading, loading)
}


function updateUserToken(userToken) {
    vo.$store.commit(vo.$store.types.UpdateUserToken, userToken)
}


function updateUserSelf(userSelf) {
    vo.$store.commit(vo.$store.types.UpdateUserSelf, userSelf)
}


function forceUpdate() {
    // console.log('forceUpdate')

    function broadcast(chs) {
        each(chs, (v) => {
            // console.log(v.$el)
            v.$forceUpdate()
            if (v.$children) {
                broadcast(v.$children)
            }
        })
    }

    //broadcast, 注意此處需使用更換ui內vo為mounted後的vo, 也就是含元素, 才能使用廣播技術
    broadcast(vo.$children)

}


function validLang(lang) {
    if (lang !== 'eng' && lang !== 'cht') {
        // console.log(`invalid lang[${lang}]`)
        lang = 'eng'
    }
    return lang
}


function getLang() {
    let lang = ''

    //from window
    if (!isestr(lang)) {
        let _lang = get(window, '___pmwtask___.language', '')
        // console.log('_lang(from window)', _lang)
        if (isestr(_lang)) {
            lang = validLang(_lang) //有可能取到未取代前模板符號
        }
    }

    //from store
    if (!isestr(lang)) {
        let _lang = get(vo, '$store.state.lang', '')
        // console.log('_lang(from store)', _lang)
        if (isestr(_lang)) {
            lang = validLang(_lang) //有可能給予非預期lang
        }
    }

    //validLang
    lang = validLang(lang) //有可能給予非預期lang

    return lang
}


function setLang(lang = null, from = '') {
    // console.log('setLang', lang, from)

    //check
    if (!isestr(lang)) {
        lang = getLang()
    }
    lang = validLang(lang)
    // console.log('get lang', lang)

    //check, 若有變更才commit
    if (true) {
        let _lang = get(vo, '$store.state.lang')
        if (lang !== _lang) {
            vo.$store.commit(vo.$store.types.UpdateLang, lang)
            // console.log('commit lang', lang)
        }
    }

    //kpLang
    let kpLang = get(vo, '$store.state.webInfor.kpLang', {})

    //kpText
    let kpText = get(kpLang, lang, {})
    // console.log('kpText', kpText)

    //commit
    vo.$store.commit(vo.$store.types.UpdateKpText, kpText)
    // console.log('commit kpText', kpText)

    //forceUpdate
    forceUpdate()

}


function getKpText(key) {
    // console.log('getKpText', key)

    //kpText
    let kpText = get(vo, '$store.state.kpText')
    // console.log('kpText', cloneDeep(kpText))

    //t
    let t = get(kpText, key, '')
    if (!isestr(t)) {
        // fallback: 後端語系尚未載入時使用預設值
        let lang = getLang()
        t = get(kpFallback, `${key}.${lang}`, '')
    }
    if (!isestr(t)) {
        t = key
    }

    return t
}


function tErr(err) {
    let key = isestr(err) ? err : 'anUnexpectedErrorOccurred'
    let msg = getKpText(key)           //後端 err key → 翻譯
    if (msg === key) {                 //getKpText 查無 → 回傳 key 本身 → 非 procLang key (連線層 raw 等)
        msg = getKpText('cannotConnectServer')
    }
    return msg
}


function syncHeight() {

    //heightToolbar
    let heightToolbar = get(vo, '$store.state.heightToolbar')

    //heightAppEff
    let heightAppEff = window.innerHeight - heightToolbar

    //commit
    vo.$store.commit(vo.$store.types.UpdateHeightApp, window.innerHeight)
    vo.$store.commit(vo.$store.types.UpdateHeightAppEff, heightAppEff)

    return ''
}


let kpIcon = {
    warning: `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACQAAAAhCAYAAACxzQkrAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAOwwAADsMBx2+oZAAAABZ0RVh0Q3JlYXRpb24gVGltZQAwOS8xOS8yNP52YhIAAAAcdEVYdFNvZnR3YXJlAEFkb2JlIEZpcmV3b3JrcyBDUzbovLKMAAADMklEQVRYha2WTWgTQRiGn0k2SU2KNQjmoiL+gGAVD/5gEelAkSKOiILei+hBRAQv/tBDsQiK1CJFDz331tNePAjRm60eBL0pXsSDF+dimmzbZDzsRJNmm+xPXliyOzP7zrNfvpn5hDGGJNJSHQJmAQHcLpbdL0n8RBIgLdVhYBHYb5u+AZeLZfdzXM9UbBpfC8AB/OgIe7+QxDA2kJZqAhgO6Bq2fbEU6y/TUuWB70BpkyG/gL3FsrsS1TtuhO53gcH23Y9jHDlCWqqd+Mmb6zHUA/YVy+7PKP5xIvQkBAx2zNOo5pEipKU6Bnzo6Kg3/N904PcdL5bdj2HniBqh2bYnITDVGmQcyDj+vRDd3+kXkJbqEjDS2mYqK2THTjO0MMfQwhzZsdOYSsfCGrHv9g9IS+UAz9oajUFkHPITV0mVSqRKJfITVxAZBzrT4Jn16A8QcBvY0w4EZDL+/mw8/xIpv60zLfdYj+RAWqrtwGRgpzHQaJm90QiKTlOT1isZEPAI2BpiXC9ttV5d1RVIS3UQuN4HmKZuWM94QMBMiDFRJKznptp0Mi3VGDDeR5imxq13eCB95iz0+JKEmtFj58IDkc5dI7jWaZcQ7cdFOhW0UwdpmHr6WiggLVUBmO4NA6bmYSpVEIMgBjGVKqbm+ZnSW9N2ru5AwANgR28gf9bKzDxry+9ZW35PZWa+ra+Hdti52m1bT3st1S7gK+HKi/+Ha73uP6fTiC0D3TbHjfKAA8Wy+6PZsDFCT0PDAGAQ2Qys12G97t8HnBtd1FEz/YuQluoEsBTFjXoDnDQ5u4o9940PF1wXddPJYtldBmg9gZ9HdTG1GoMPb5G9cBEAZ+9u/ky/QBTyUa2eY0ubFICWSgGnotEYxEAO59gRoAJUcI4fQQzkouRQU6csAykt1TZgKqqDn9Aeq6/fAQWgwOrrt5iqF3aVbdSUlmpI/B49vwiErujaZAxmbZ3syaMArC598gu0eEAAi+L36PkakVZWANRKFQCR35IEBqCaAl4mcUAIRCHvJ3IyGIBXjhHcEYYGcJMkkUomD5gziLut+9Bj4DKQJeLulkACWAUWi2X3HsBfLU4ARuGaUEMAAAAASUVORK5CYII=`,
}
function getIcon(icon) {
    let c = get(kpIcon, icon, '')
    if (!isestr(c)) {
        console.log(`invalid icon[${icon}]`)
    }
    return c
}


let mUI = {

    setVo,

    updateConnState,
    updateLoading,
    updateUserToken,
    updateUserSelf,
    forceUpdate,

    setLang,
    getKpText,
    tErr,

    syncHeight,

    getIcon,

}


export default mUI
