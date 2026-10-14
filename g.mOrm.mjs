import WOrm from 'w-orm-lmdb/src/WOrmLmdb.mjs'
import WServOrm from 'w-serv-orm/src/WServOrm.mjs'
import ds from './src/schema/index.mjs'
import getSettings from './g.getSettings.mjs'


//getSettings
let st = getSettings()

//url, db
let url = st.dbUrl
let db = st.dbName

//WServOrm(w-serv-orm 已移除之 useCheckUser / getUserById / useExcludeWhenNotAdmin 不再傳入, spec D17)
let r = WServOrm(ds, WOrm, url, db)
let { woItems, procOrm } = r


export { woItems, procOrm }
