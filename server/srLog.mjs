import get from 'lodash-es/get.js'
import isestr from 'wsemi/src/isestr.mjs'
import WSyslog from 'w-syslog/src/WSyslog.mjs'


//後端 log（比照 w-web-sso server/srLog.mjs）：包 w-syslog，依時段輪檔寫入 ./logs。
//用法：srLog.info({ event, ... }) / srLog.warn({...}) / srLog.error({ event, err, ... })。
//錯誤一律 log 其 err key（對齊「後端錯誤須 log err key」原則），供事後識別。
let init = (opt = {}) => {

    let fdLog = get(opt, 'logFd', '')
    if (!isestr(fdLog)) {
        fdLog = './logs'
    }

    let interval = get(opt, 'logInterval', '')
    if (!isestr(interval)) {
        interval = 'hr'
    }

    let srLog = WSyslog({
        fdLog,
        interval,
    })

    return srLog
}


export default init
