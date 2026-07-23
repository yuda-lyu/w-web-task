<template>
    <div style="height:100%; overflow-y:auto; background:var(--bg); padding:22px 26px;">

        <!-- 頂部標題列 -->
        <div style="display:flex; align-items:center; margin-bottom:18px;">
            <WIcon
                :icon="mdiChartBoxOutline"
                :color="'#0d9488'"
                :size="20"
            ></WIcon>
            <div style="padding-left:8px; font-size:18px; font-weight:800; letter-spacing:-.02em; color:var(--text);">
                {{$t('mmStats')}}
            </div>
        </div>

        <!-- inline 錯誤紅字 -->
        <div
            v-if="aError"
            style="color:var(--st-error); font-size:0.85rem; padding:8px 2px;"
        >
            {{aError}}
        </div>

        <!-- 第一區: statsOverview -->
        <div style="font-size:13px; font-weight:800; color:var(--text-2); letter-spacing:.02em; text-transform:uppercase; margin-bottom:12px;">
            {{$t('statsOverview')}}
        </div>

        <div data-fmid="stats-overview" style="display:flex; flex-wrap:wrap; gap:14px;">

            <!-- 頻道數 -->
            <div style="flex:1 1 180px; min-width:160px; background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); padding:16px 18px; box-shadow:var(--shadow-sm);">
                <div style="font-size:11.5px; font-weight:700; letter-spacing:.04em; color:var(--text-3); text-transform:uppercase;">
                    {{$t('statChannels')}}
                </div>
                <div style="font-size:30px; font-weight:800; color:var(--accent); font-variant-numeric:tabular-nums; letter-spacing:-.02em; margin-top:6px;">
                    {{stats.channels}}
                </div>
            </div>

            <!-- 訊息數 -->
            <div style="flex:1 1 180px; min-width:160px; background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); padding:16px 18px; box-shadow:var(--shadow-sm);">
                <div style="font-size:11.5px; font-weight:700; letter-spacing:.04em; color:var(--text-3); text-transform:uppercase;">
                    {{$t('statMessages')}}
                </div>
                <div style="font-size:30px; font-weight:800; color:var(--accent); font-variant-numeric:tabular-nums; letter-spacing:-.02em; margin-top:6px;">
                    {{stats.messages}}
                </div>
            </div>

            <!-- 任務總數 -->
            <div style="flex:1 1 180px; min-width:160px; background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); padding:16px 18px; box-shadow:var(--shadow-sm);">
                <div style="font-size:11.5px; font-weight:700; letter-spacing:.04em; color:var(--text-3); text-transform:uppercase;">
                    {{$t('statTasks')}}
                </div>
                <div style="font-size:30px; font-weight:800; color:var(--accent); font-variant-numeric:tabular-nums; letter-spacing:-.02em; margin-top:6px;">
                    {{taskTotal}}
                </div>
            </div>

        </div>

        <!-- 第二區: statTaskBreakdown -->
        <div style="font-size:13px; font-weight:800; color:var(--text-2); letter-spacing:.02em; text-transform:uppercase; margin:24px 0 12px;">
            {{$t('statTaskBreakdown')}}
        </div>

        <div style="display:flex; flex-wrap:wrap; gap:14px;">

            <!-- pending -->
            <div style="flex:1 1 140px; min-width:130px; background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); padding:16px 18px; box-shadow:var(--shadow-sm);">
                <div style="display:flex; align-items:center;">
                    <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--st-pending); margin-right:6px; vertical-align:middle; flex-shrink:0;"></span>
                    <div style="font-size:11.5px; font-weight:700; letter-spacing:.04em; color:var(--text-3); text-transform:uppercase;">
                        {{$t('statPending')}}
                    </div>
                </div>
                <div style="font-size:26px; font-weight:800; color:var(--st-pending); font-variant-numeric:tabular-nums; letter-spacing:-.02em; margin-top:6px;">
                    {{stats.tasks.pending}}
                </div>
            </div>

            <!-- running -->
            <div style="flex:1 1 140px; min-width:130px; background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); padding:16px 18px; box-shadow:var(--shadow-sm);">
                <div style="display:flex; align-items:center;">
                    <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--st-running); margin-right:6px; vertical-align:middle; flex-shrink:0;"></span>
                    <div style="font-size:11.5px; font-weight:700; letter-spacing:.04em; color:var(--text-3); text-transform:uppercase;">
                        {{$t('statRunning')}}
                    </div>
                </div>
                <div style="font-size:26px; font-weight:800; color:var(--st-running); font-variant-numeric:tabular-nums; letter-spacing:-.02em; margin-top:6px;">
                    {{stats.tasks.running}}
                </div>
            </div>

            <!-- done -->
            <div style="flex:1 1 140px; min-width:130px; background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); padding:16px 18px; box-shadow:var(--shadow-sm);">
                <div style="display:flex; align-items:center;">
                    <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--st-done); margin-right:6px; vertical-align:middle; flex-shrink:0;"></span>
                    <div style="font-size:11.5px; font-weight:700; letter-spacing:.04em; color:var(--text-3); text-transform:uppercase;">
                        {{$t('statDone')}}
                    </div>
                </div>
                <div style="font-size:26px; font-weight:800; color:var(--st-done); font-variant-numeric:tabular-nums; letter-spacing:-.02em; margin-top:6px;">
                    {{stats.tasks.done}}
                </div>
            </div>

            <!-- error -->
            <div style="flex:1 1 140px; min-width:130px; background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); padding:16px 18px; box-shadow:var(--shadow-sm);">
                <div style="display:flex; align-items:center;">
                    <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--st-error); margin-right:6px; vertical-align:middle; flex-shrink:0;"></span>
                    <div style="font-size:11.5px; font-weight:700; letter-spacing:.04em; color:var(--text-3); text-transform:uppercase;">
                        {{$t('statError')}}
                    </div>
                </div>
                <div style="font-size:26px; font-weight:800; color:var(--st-error); font-variant-numeric:tabular-nums; letter-spacing:-.02em; margin-top:6px;">
                    {{stats.tasks.error}}
                </div>
            </div>

        </div>

    </div>
</template>

<script>
import { mdiChartBoxOutline } from '@mdi/js/mdi.js'
import get from 'lodash-es/get.js'
import WIcon from 'w-component-vue/src/components/WIcon.vue'


export default {
    components: {
        WIcon,
    },
    data: function() {
        return {
            mdiChartBoxOutline,

            stats: {
                channels: 0,
                messages: 0,
                tasks: {
                    pending: 0,
                    running: 0,
                    done: 0,
                    error: 0,
                    total: 0,
                },
            },

            aError: '',
        }
    },
    computed: {

        taskTotal: function() {
            let vo = this
            return get(vo, 'stats.tasks.total', 0)
        },

    },
    mounted: function() {
        let vo = this
        vo.loadStats()
    },
    methods: {

        loadStats: function() {
            let vo = this

            let core = async () => {

                //1) 清空舊 inline 錯誤
                vo.aError = ''

                //2) 本頁無同步檢測

                //3) 確定打 API 才開 loading
                vo.$ui.updateLoading(true)

                //4) getStats, 各自 catch + 旗標短路
                let ok = false
                await vo.$fapi.getStats()
                    .then((res) => {
                        vo.stats = {
                            channels: get(res, 'channels', 0),
                            messages: get(res, 'messages', 0),
                            tasks: {
                                pending: get(res, 'tasks.pending', 0),
                                running: get(res, 'tasks.running', 0),
                                done: get(res, 'tasks.done', 0),
                                error: get(res, 'tasks.error', 0),
                                total: get(res, 'tasks.total', 0),
                            },
                        }
                        ok = true
                    })
                    .catch((err) => {
                        console.log('getStats', err)
                        vo.aError = vo.$t('getDataError')
                    })
                if (!ok) {
                    return
                }

                return 'ok'
            }

            core()
                .catch((err) => {
                    console.log('loadStats catch', err)
                    vo.aError = vo.$t('getDataError')
                })
                .finally(() => {
                    vo.$ui.updateLoading(false)
                })

        },

    },
}
</script>
