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
        'stream': 'stream',
        'events': 'events',
        'url': 'url',
        'pino': 'pino',
        // 'form-data': 'FormData',
    },
    external: [
        '@hapi/hapi',
        '@hapi/inert',
        'path',
        'fs',
        'stream',
        'events',
        'url',
        'pino',
        // 'form-data',
    ],
})

