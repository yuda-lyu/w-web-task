import channels from './tables/channels.mjs'
import channelMembers from './tables/channelMembers.mjs'
import messages from './tables/messages.mjs'
import messagesArchive from './tables/messagesArchive.mjs'
import tasks from './tables/tasks.mjs'
import tasksArchive from './tables/tasksArchive.mjs'
import files from './tables/files.mjs'
import build from 'w-data-collector/src/build.mjs'


let cs = {
    channels,
    channelMembers,
    messages,
    messagesArchive,
    tasks,
    tasksArchive,
    files,
}

//ds
let ds = {}
for (let k in cs) {
    ds[k] = build(cs[k], { useCreateStorage: false })
}


export default ds
