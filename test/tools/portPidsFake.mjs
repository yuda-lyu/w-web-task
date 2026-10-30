//portPidsFake：listenerPids（w-package-tools-e2e ≥ 1.0.12，委由 wsemi 1.9.32 之 execProcessPortPidsSync）之測試替身與固定輸出夾具。
//替身為 spawnSync 形：(prog, args, { src, timeout, maxBuffer }) => { status, stdout, error }，src 為 'netstat'、'powershell'、'lsof'。
//輸出格式取自 wsemi test/tools/portPidsKit.mjs（netstat -ano 之欄寬、PowerShell 腳本之標記行 WSEMI-PORTPIDS-BEGIN／END 與 `R <本地埠> <遠端位址> <遠端埠> <PID>` 列）；
//wsemi 改版而格式變動時只改本檔。無副作用，import 不啟動任何行程。

//row：組 netstat -ano 之一列（欄寬同 Windows）；state 為 null 時不輸出狀態欄（UDP）
export function row(proto, local, remote, state, pid) {
    return `  ${proto.padEnd(7)}${local.padEnd(23)}${remote.padEnd(23)}${state === null ? '' : state.padEnd(16)}${pid}`
}

//netstat 表頭（英文）
export const HEAD_EN = ['', 'Active Connections', '', '  Proto  Local Address          Foreign Address        State           PID']

//ns：組 netstat -ano 之輸出
export function ns(rows, head = HEAD_EN) {
    return [...head, ...rows].join('\r\n') + '\r\n'
}

//BG：他埠之背景列（使輸出形同真實）
export const BG = [
    row('TCP', '0.0.0.0:135', '0.0.0.0:0', 'LISTENING', '1356'),
    row('TCP', '0.0.0.0:445', '0.0.0.0:0', 'LISTENING', '4'),
    row('TCP', '192.168.1.10:51234', '140.82.112.3:443', 'ESTABLISHED', '7000'),
    row('TCP', '[::]:135', '[::]:0', 'LISTENING', '1356'),
    row('UDP', '0.0.0.0:5353', '*:*', null, '3100'),
    row('UDP', '[::]:5353', '*:*', null, '3100'),
]

//ps：組 Get-NetTCPConnection 腳本之輸出；rows 為 [本地埠, 遠端位址, 遠端埠, PID]
export function ps(rows) {
    return ['WSEMI-PORTPIDS-BEGIN', ...rows.map((r) => `R ${r.join(' ')}`), 'WSEMI-PORTPIDS-END'].join('\r\n') + '\r\n'
}

//ok、err：與 spawnSync 同形之結果
export function ok(stdout, status = 0) {
    return { status, stdout, error: null }
}
export function err(code) {
    const e = new Error(`spawn x ${code}`)
    e.code = code
    return { status: null, stdout: '', error: e }
}

//fakeExec：outs 為 { netstat, powershell, lsof } 之結果；calls 記錄各次呼叫之 src、prog、args、timeout；未預期之 src 即拋錯（使多查一個來源的實作當場失敗）
export function fakeExec(outs, calls) {
    return (prog, args, o) => {
        calls.push({ src: o.src, prog, args, timeout: o.timeout })
        const r = outs[o.src]
        if (r === undefined) { throw new Error(`unexpected src ${o.src}`) }
        return r
    }
}
