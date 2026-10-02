<template>
    <WConfirm
        :show.sync="bShow"
        :title="$t('systemMessage')"
        :content="content"
        :_contentColor="'white'"
        :_contentIconColor="'white'"
        :_contentBackgroundColor="'orange lighten-5'"
        :_titleColor="'white'"
        :headerBackgroundColor="'grey lighten-3'"
        :noBtnText="$t('no')"
        :yesBtnText="$t('yes')"
        @click-no="clickBtn(false)"
        @click-yes="clickBtn(true)"
    ></WConfirm>
</template>

<script>
import Vue from 'vue'
import genPm from 'wsemi/src/genPm.mjs'
import WConfirm from 'w-component-vue/src/components/WConfirm.vue'

export default {
    components: {
        WConfirm,
    },
    props: {
    },
    data: function() {
        return {

            bShow: false,
            pm: null,

            content: '',

        }
    },
    mounted: function() {
        //console.log('mounted')

        let vo = this

        //set
        Vue.prototype.$dg.showCheckYesNo = vo.show

    },
    computed: {
    },
    methods: {

        show: function (content) {
            //console.log('methods show', content)

            let vo = this

            //單例: 新確認框取代開啟中之舊確認框時, 舊確認框之等待者視同選 No(reject('close'), 對已結束者無作用);
            //否則其流程永久等待, 送出流程之 runSubmit 占位不釋放而該操作無法再觸發 (D16)
            if (vo.pm) {
                vo.pm.reject('close')
            }

            //pm
            vo.pm = genPm()

            //save
            vo.content = content

            //show
            vo.bShow = true

            return vo.pm
        },

        clickBtn: function(mode) {
            //console.log('methods clickBtn', mode)

            let vo = this

            if (mode) {
                vo.pm.resolve()
            }
            else {
                vo.pm.reject('close')
            }

            //hide
            vo.bShow = false

        },

    }
}
</script>

<style scoped>
</style>
