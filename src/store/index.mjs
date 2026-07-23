import Vue from 'vue'
import Vuex from 'vuex'
import { state, mutations } from './mutations.mjs'
import * as getters from './getters.mjs'
import * as actions from './actions.mjs'
import * as types from './types.mjs'


//use
Vue.use(Vuex)

let st = new Vuex.Store({
    state,
    mutations,
    getters,
    actions,
    strict: true, //嚴格模式禁止修改state
})

//save to $store
st.types = types
Vue.prototype.$store = st
// console.log('$store', st)

export default st
