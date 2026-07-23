// import rollupFiles from 'w-package-tools/src/rollupFiles.mjs'
import rollupFile from 'w-package-tools/src/rollupFile.mjs' //因只有1檔案且不需刪除dsit故改用rollupFile


let fdSrc = './server' //'./src'
let fdTar = './dist'


rollupFile({
    // fns: ['WWebTask.mjs'],
    fn: 'WWebTask.mjs',
    fdSrc,
    fdTar,
    nameDistType: 'kebabCase',
    globals: {
        '@hapi/hapi': '@hapi/hapi',
        '@hapi/inert': '@hapi/inert',
        'path': 'path',
        'fs': 'fs',
        'events': 'events',
        'stream': 'stream',
        // 'form-data': 'FormData',
        'crypto': 'crypto', //因crypto-js修改使用內建crypto方式, 會偵測nodejs並使用require內建的crypto, 故需剔除
    },
    external: [
        '@hapi/hapi',
        '@hapi/inert',
        'path',
        'fs',
        'events',
        'stream',
        // 'form-data',
        'crypto',
    ],
})

