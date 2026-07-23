<template>
    <WConfirm
        :show.sync="bShow"
        :title="$t('systemMessage')"
        :content="content"
        :contentIcon="contentIcon"
        :contentIconColor="contentIconColor"
        :_contentColor="'white'"
        :_contentIconColor="'white'"
        :_contentBackgroundColor="'orange lighten-5'"
        :headerBackgroundColor="'grey lighten-3'"
        :hasNoBtn="false"
        :yesBtnText="$t('ok')"
        @click-yes="clickUnit()"
    ></WConfirm>
</template>

<script>
import Vue from 'vue'
import { mdiAlert, mdiCheckCircle } from '@mdi/js'
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

            //content icon（依 type 切換：success=綠勾，其餘=驚嘆號）
            contentIcon: mdiAlert,
            contentIconColor: '#D81B60',

        }
    },
    mounted: function() {
        //console.log('mounted')

        let vo = this

        //set
        Vue.prototype.$dg.showCheckYes = vo.show

    },
    computed: {
    },
    methods: {

        show: function (content, opt = {}) {
            //console.log('methods show', content)

            let vo = this

            //pm
            vo.pm = genPm()

            //save
            vo.content = content

            //content icon：type='success' 顯示綠勾，其餘維持驚嘆號
            if (opt && opt.type === 'success') {
                vo.contentIcon = mdiCheckCircle
                vo.contentIconColor = '#2E7D32'
            }
            else {
                vo.contentIcon = mdiAlert
                vo.contentIconColor = '#D81B60'
            }

            //show
            vo.bShow = true

            return vo.pm
        },

        clickUnit: function() {
            //console.log('methods clickUnit')

            let vo = this

            //resolve
            vo.pm.resolve()

            //hide
            vo.bShow = false

        },

    }
}
</script>

<style scoped>
</style>
