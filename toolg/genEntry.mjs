import path from 'path'
import fs from 'fs'
// import _ from 'lodash-es'
import w from 'wsemi'


let fdTar = './dist'
let fnEntryIn = 'index.html'
let fnEntryOut = 'index.tmp'
let fpEntryIn = path.resolve(fdTar, fnEntryIn)
let fpEntryOut = path.resolve(fdTar, fnEntryOut)

//readFileSync
let c = fs.readFileSync(fpEntryIn, 'utf8')

//replace
c = w.replace(c, '/mtask/', '{sfd}/')

//writeFileSync
fs.writeFileSync(fpEntryOut, c, 'utf8')

//unlinkSync
fs.unlinkSync(fpEntryIn)
