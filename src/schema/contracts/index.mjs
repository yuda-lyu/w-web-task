import channels from './channels.mjs'
import getMembersContract from './channelMembers.mjs'
import messages from './messages.mjs'
import messagesArchive from './messagesArchive.mjs'
import tasks from './tasks.mjs'
import tasksArchive from './tasksArchive.mjs'
import files from './files.mjs'


//7 表之寫入契約 (多人同時編輯, 原則 10): 有後台整表編輯頁者 (channels、channelMembers) 為有基準之契約;
//其餘 5 表無整表存檔, 宣告全欄伺服器專有 (fields 為空, 不適用基準, 不得交給 checkContract).
//channelMembers 之範圍隨頻道而變, 以工廠 getMembersContract(channelId) 取用.
const contracts = {
    channels,
    channelMembers: getMembersContract,
    messages,
    messagesArchive,
    tasks,
    tasksArchive,
    files,
}


export { contracts, getMembersContract }
export default contracts
