//e2e 假時鐘(e2e 技能契約 C15)之註冊入口: harness 起測試後端時以 `node --import <本檔 URL> srv.mjs` 載入(test/tools/e2e-setup.mjs 之 spawnBackend).
//只把本專案 server/ 與 src/ 所 import 之 wsemi/src/nowms2str.mjs 導向 ./nowms2str.mjs——本專案寫入 timeCreate / timeUpdate / timeClaim / timeDone
//之唯一出口(schema funNew 與 procCore); 後端其他時間用途(srLog 時間、套件內部)仍為真時鐘. 是否固定由標記檔逐案決定(見 ./nowms2str.mjs).
import { register } from 'node:module'

register('./hooks.mjs', import.meta.url)
