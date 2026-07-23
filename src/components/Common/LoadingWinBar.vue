<template>
    <WDialog
        :show.sync="loading"
        :maxWidth="dialogWidth"
        @resize="resizeDialog"
    >

        <template v-slot:panel>

            <div :style="`padding:${barPadding-5}px ${barPadding}px ${barPadding}px ${barPadding}px;`">


                <div style="padding-bottom:3px; font-size:0.9rem; color:#666;">

                    <span v-if="msg!==''">{{msg}}</span>

                    <span v-else>{{$t('processing')}}</span>

                </div>

                <WProgressBar
                    :style="`width:${barWidth}px;`"
                    :height="3"
                    :enableContinuous="true"
                    :progColor="'deep-purple lighten-1'"
                    :progBackgroundColor="'deep-purple lighten-4'"
                ></WProgressBar>

            </div>

        </template>

    </WDialog>
</template>

<script>
import Vue from 'vue'
import get from 'lodash-es/get.js'
import WDialog from 'w-component-vue/src/components/WDialog.vue'
import WProgressBar from 'w-component-vue/src/components/WProgressBar.vue'


export default {
    components: {
        WDialog,
        WProgressBar,
    },
    props: {
    },
    data: function() {
        return {

            dialogWidth: 0,
            dialogWidthMax: 600,

            barPadding: 20,
            barWidth: 0,
            msg: '',

        }
    },
    mounted: function() {
        //console.log('mounted')

        let vo = this

        //set
        Vue.prototype.$dg.setLoadingWinBarMessage = vo.setMessage

    },
    computed: {

        loading: function() {
            let vo = this
            let b = get(vo, `$store.state.loading`)
            // console.log('loading', b)
            return b
        },

    },
    methods: {

        setMessage: function(msg) {
            this.msg = msg
        },

        resizeDialog: function(msg) {
            // console.log('methods resizeDialog', msg)

            let vo = this

            let w = window.innerWidth
            // console.log('window.innerWidth', window.innerWidth)

            //dialogWidth
            let dialogWidth = w - vo.barPadding * 2
            dialogWidth = Math.max(dialogWidth, 0)
            dialogWidth = Math.min(dialogWidth, vo.dialogWidthMax)
            vo.dialogWidth = dialogWidth
            // console.log('dialogWidth', dialogWidth)

            //barWidth
            let barWidth = dialogWidth - vo.barPadding * 2
            barWidth = Math.max(barWidth, 0)
            vo.barWidth = barWidth
            // console.log('barWidth', barWidth)

        },

    }
}
</script>

<style scoped>
</style>
