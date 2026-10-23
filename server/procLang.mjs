import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import iseobj from 'wsemi/src/iseobj.mjs'


let kpLang = {

    //連線狀態 (前端 w-ui-loginout 連線畫面)
    csIng: {
        eng: 'Connecting...',
        cht: '連線中...',
    },
    csLogin: {
        eng: 'Logged in',
        cht: '已登入',
    },
    csLogout: {
        eng: 'Logged out',
        cht: '已登出',
    },
    csErrConn: {
        eng: 'Unable to connect',
        cht: '無法連線',
    },
    csErrLogin: {
        eng: 'Login denied',
        cht: '拒絕登入',
    },

    aggridLanguage: {
        eng: 'en-US',
        cht: 'zh-TW',
    },

    //通用
    id: {
        eng: 'ID',
        cht: '主鍵',
    },
    systemMessage: {
        eng: 'System message',
        cht: '系統確認訊息',
    },
    ok: {
        eng: 'OK',
        cht: '確認',
    },
    no: {
        eng: 'No',
        cht: '取消',
    },
    yes: {
        eng: 'Yes',
        cht: '確定',
    },
    //未引用, 保留供日後使用
    // empty: {
    //     eng: '(empty)',
    //     cht: '(空)',
    // },
    //未引用, 保留供日後使用
    // save: {
    //     eng: 'Save',
    //     cht: '儲存',
    // },
    saveChanges: {
        eng: 'Save changes',
        cht: '儲存變更',
    },
    close: {
        eng: 'Close',
        cht: '關閉',
    },
    //未引用, 保留供日後使用
    // send: {
    //     eng: 'Send',
    //     cht: '送出',
    // },
    cancel: {
        eng: 'Cancel',
        cht: '取消',
    },
    //未引用, 保留供日後使用
    // add: {
    //     eng: 'Add',
    //     cht: '新增',
    // },
    //未引用, 保留供日後使用
    // edit: {
    //     eng: 'Edit',
    //     cht: '編輯',
    // },
    //未引用, 保留供日後使用
    // del: {
    //     eng: 'Delete',
    //     cht: '刪除',
    // },
    //未引用, 保留供日後使用
    // refresh: {
    //     eng: 'Refresh',
    //     cht: '重新整理',
    // },
    processing: {
        eng: 'Processing...',
        cht: '處理中請稍後...',
    },
    waitingData: {
        eng: 'Waiting data...',
        cht: '等待數據中...',
    },
    anUnexpectedErrorOccurred: {
        eng: 'An unexpected error occurred, please contact the administrator',
        cht: '發生非預期錯誤，請洽管理員',
    },
    getDataError: {
        eng: 'Failed to get data, please try again later',
        cht: '取得數據失敗，請稍後再試',
    },
    //未引用, 保留供日後使用
    // login: {
    //     eng: 'Log in',
    //     cht: '登入',
    // },
    logout: {
        eng: 'Log out',
        cht: '登出',
    },
    settings: {
        eng: 'Settings',
        cht: '設定',
    },
    showArchived: {
        eng: 'Show archived',
        cht: '顯示封存',
    },

    //稽核欄位
    timeCreate: {
        eng: 'Created time',
        cht: '創建時間',
    },
    //未引用, 保留供日後使用
    // userIdUpdate: {
    //     eng: 'ID of the updated user',
    //     cht: '最新變更使用者主鍵',
    // },
    timeUpdate: {
        eng: 'Updated time',
        cht: '最新變更時間',
    },
    //未引用, 保留供日後使用
    // userId: {
    //     eng: 'ID of the user',
    //     cht: '使用者主鍵',
    // },
    //未引用, 保留供日後使用
    // isActive: {
    //     eng: 'Active',
    //     cht: '是否有效',
    // },

    //=== 錯誤鍵 (後端 reject 用; 對應 procCore) ===

    //使用者 / 認證
    errUserIdMissing: {
        eng: 'Can not get the user id',
        cht: '無法取得使用者主鍵',
    },
    errUserEmailMissing: {
        eng: 'Can not get the email of user',
        cht: '無法取得使用者電子郵件',
    },
    errUserNameMissing: {
        eng: 'Can not get the name of user',
        cht: '無法取得使用者名稱',
    },
    errUserRoleMissing: {
        eng: 'Can not get the role of user',
        cht: '無法取得使用者角色',
    },
    errUserNoPermission: {
        eng: 'User does not have permission',
        cht: '使用者無權限',
    },
    errUserNotFound: {
        eng: 'Can not find the user',
        cht: '查無使用者',
    },
    errTokenNoPermission: {
        eng: 'Token does not have permission',
        cht: '權杖無存取權限',
    },
    errPayloadInvalid: {
        eng: 'Invalid payload',
        cht: '請求內容格式錯誤',
    },

    //頻道
    errChannelIdInvalid: {
        eng: 'Invalid channel id',
        cht: '頻道主鍵無效',
    },
    //未引用, 保留供日後使用
    // errChannelNotFound: {
    //     eng: 'Can not find the channel',
    //     cht: '查無頻道',
    // },
    errChannelRowInvalid: {
        eng: 'Invalid channel data',
        cht: '頻道數據無效',
    },
    //未引用, 保留供日後使用
    // errChannelIdRequired: {
    //     eng: 'Channel id is required',
    //     cht: '須提供頻道主鍵',
    // },

    //成員
    errMemberRowInvalid: {
        eng: 'Invalid member data',
        cht: '成員數據無效',
    },
    errMemberIdInvalid: {
        eng: 'Invalid member id',
        cht: '成員主鍵無效',
    },

    //訊息
    errContentInvalid: {
        eng: 'Invalid message content',
        cht: '訊息內容無效',
    },
    //未引用, 保留供日後使用
    // errMessageIdInvalid: {
    //     eng: 'Invalid message id',
    //     cht: '訊息主鍵無效',
    // },

    //圖台檔案
    errFileRowInvalid: {
        eng: 'Invalid file data',
        cht: '檔案數據無效',
    },
    errUploadInvalid: {
        eng: 'Invalid upload data',
        cht: '上傳數據無效',
    },
    errFileIdInvalid: {
        eng: 'Invalid file id',
        cht: '檔案主鍵無效',
    },
    errFileNotFound: {
        eng: 'Can not find the file',
        cht: '查無檔案',
    },

    //任務
    errTaskIdInvalid: {
        eng: 'Invalid task id',
        cht: '任務主鍵無效',
    },
    errTaskNotFound: {
        eng: 'Can not find the task',
        cht: '查無任務',
    },
    //未引用, 保留供日後使用
    // errTaskRowInvalid: {
    //     eng: 'Invalid task data',
    //     cht: '任務數據無效',
    // },
    //未引用, 保留供日後使用
    // errTaskTitleRequired: {
    //     eng: 'Task title is required',
    //     cht: '須提供任務標題',
    // },
    errTaskAlreadyClaimed: {
        eng: 'This task has already been claimed',
        cht: '此任務已被認領',
    },
    errTaskNotRunning: {
        eng: 'This task is not in running state',
        cht: '此任務非執行中狀態',
    },
    errTaskNotResettable: {
        eng: 'This task can not be reset',
        cht: '此任務無法重置',
    },
    errTaskExternalServiceUnavailable: {
        eng: 'External service is temporarily unavailable',
        cht: '外部服務暫時無法使用',
    },
    errResultInvalid: {
        eng: 'Invalid task result',
        cht: '任務回應內容無效',
    },
    errStateInvalid: {
        eng: 'Invalid task state',
        cht: '任務狀態無效',
    },
    errLastMessageIdInvalid: {
        eng: 'Invalid last message id',
        cht: '已讀訊息主鍵無效',
    },

    //雙擊防護 (同一操作者之同一操作處理中再送出; 見 lockSave, spec D16)
    saveInProgress: { //頻道 / 成員之儲存: 同一操作者對同一列處理中再送出
        eng: 'The previous save is still in progress. Please do not submit again.',
        cht: '上一次儲存仍在處理中，請勿重複送出',
    },
    deleteInProgress: { //頻道 / 成員之刪除: 同一操作者對同一列處理中再送出
        eng: 'The previous deletion is still in progress. Please do not submit again.',
        cht: '上一次刪除仍在處理中，請勿重複送出',
    },
    sendInProgress: { //發送訊息: 同一操作者對同一頻道送出中再送出
        eng: 'The previous message is still being sent. Please do not submit again.',
        cht: '上一則訊息仍在送出中，請勿重複送出',
    },

    //多人同時編輯 (原則 10; 規格 dspec/多人同時編輯之寫入契約.md): w-serv-orm 拒收鍵 baselineMismatch / rowNotFound / baselineFormat / rowsInvalid 轉本套件語系鍵,
    //前三者皆為「畫面資料過期」(提示重新載入, 草稿保留), rowsInvalid 為伺服端資料異常 (記 log, 重新載入無解)
    saveStale: { //baselineMismatch: 載入後他人已新增 / 修改 / 刪除 / 重排 (先動先贏, 整次拒收零寫入)
        eng: 'The data has been updated by someone else. Nothing was saved. Please reload and try again.',
        cht: '資料已被他人更新，本次未儲存任何變更，請重新載入後再操作',
    },
    errRowNotFound: { //rowNotFound: 欲修改 / 刪除之列已不存在 (含不帶基準之呼叫)
        eng: 'The data no longer exists (it may have been deleted). Please reload.',
        cht: '找不到資料（可能已被刪除），請重新載入',
    },
    errBaselineFormat: { //baselineFormat: 基準格式或版本不識 (不降級為不帶基準)
        eng: 'The data version is not recognized. Please reload.',
        cht: '資料版本無法辨識，請重新載入',
    },
    errRowsInvalid: { //rowsInvalid: 庫內列主鍵重複或缺漏 (伺服端資料錯誤)
        eng: 'The stored data is inconsistent. Please contact the administrator.',
        cht: '資料庫內資料異常，請洽管理員',
    },
    saveRolledBack: { //寫入中途硬失敗 (非競爭), 已依前像還原
        eng: 'Saving failed and all changes were rolled back. Nothing was changed.',
        cht: '儲存失敗，已還原，未做任何變更',
    },
    saveWriteFail: { //寫入中途硬失敗且補償亦失敗: 部分資料可能已寫入
        eng: 'Saving failed and part of the data may have been written. Please reload to check, or contact the administrator.',
        cht: '儲存失敗，部分資料可能已寫入，請重新載入確認或洽管理員',
    },
    errChannelNameInvalid: { //頻道名稱必填 (所有入口一致, 原則 4)
        eng: 'Channel name is required',
        cht: '頻道名稱必填',
    },
    errChannelNameDuplicate: { //頻道名稱不可重複 (所有入口一致, 原則 4)
        eng: 'Channel name must be unique',
        cht: '頻道名稱不可重複',
    },
    errChannelNotFound: { //對已刪 / 不存在之頻道操作 (發訊、已讀、成員存檔; 原則 6)
        eng: 'Can not find the channel',
        cht: '查無頻道',
    },
    errMemberChannelMismatch: { //成員清單之列 channelId 與參數不符
        eng: 'The member does not belong to this channel',
        cht: '成員不屬於此頻道',
    },
    errMemberDuplicate: { //同一頻道內成員不可重複 ((channelId, memberId) 唯一; 以寫入後之結果判定)
        eng: 'A member can only appear once in a channel',
        cht: '同一頻道內成員不可重複',
    },

    //=== UI 文字鍵 (前端頁面用) ===

    //頻道頁
    //未引用, 保留供日後使用
    // channels: {
    //     eng: 'Channels',
    //     cht: '頻道',
    // },
    //未引用, 保留供日後使用
    // channelsList: {
    //     eng: 'Channels list',
    //     cht: '頻道清單',
    // },
    channelName: {
        eng: 'Channel name',
        cht: '頻道名稱',
    },
    channelDescription: {
        eng: 'Channel description',
        cht: '頻道描述',
    },
    channelAgentId: {
        eng: 'Agent id',
        cht: '主責agent識別碼',
    },
    channelOwnerId: {
        eng: 'Owner id',
        cht: '建立者',
    },
    addChannel: {
        eng: 'Add channel',
        cht: '新增頻道',
    },
    //未引用, 保留供日後使用
    // saveChannel: {
    //     eng: 'Save channel',
    //     cht: '儲存頻道',
    // },
    deleteChannel: {
        eng: 'Delete channel',
        cht: '刪除頻道',
    },
    saveChannelSuccess: {
        eng: 'Channel saved successfully',
        cht: '頻道儲存成功',
    },
    saveChannelFail: {
        eng: 'Failed to save channel',
        cht: '頻道儲存失敗',
    },
    deleteChannelSuccess: {
        eng: 'Channel deleted successfully',
        cht: '頻道刪除成功',
    },
    deleteChannelFail: {
        eng: 'Failed to delete channel',
        cht: '頻道刪除失敗',
    },

    //成員頁
    channelMembers: {
        eng: 'Channel members',
        cht: '頻道成員',
    },
    memberId: {
        eng: 'Member id',
        cht: '成員識別碼',
    },
    memberType: {
        eng: 'Member type',
        cht: '成員類型',
    },
    memberRole: {
        eng: 'Role',
        cht: '角色',
    },
    memberLastSeen: {
        eng: 'Last seen message',
        cht: '已讀訊息水位',
    },
    addMember: {
        eng: 'Add member',
        cht: '新增成員',
    },
    //未引用, 保留供日後使用
    // saveMember: {
    //     eng: 'Save member',
    //     cht: '儲存成員',
    // },
    deleteMember: {
        eng: 'Delete member',
        cht: '刪除成員',
    },
    saveMemberSuccess: {
        eng: 'Member saved successfully',
        cht: '成員儲存成功',
    },
    saveMemberFail: {
        eng: 'Failed to save member',
        cht: '成員儲存失敗',
    },
    deleteMemberSuccess: {
        eng: 'Member deleted successfully',
        cht: '成員刪除成功',
    },
    deleteMemberFail: {
        eng: 'Failed to delete member',
        cht: '成員刪除失敗',
    },

    //訊息頁
    //未引用, 保留供日後使用
    // messages: {
    //     eng: 'Messages',
    //     cht: '訊息',
    // },
    //未引用, 保留供日後使用
    // messageContent: {
    //     eng: 'Message content',
    //     cht: '訊息內容',
    // },
    //未引用, 保留供日後使用
    // messageKind: {
    //     eng: 'Kind',
    //     cht: '訊息類型',
    // },
    //未引用, 保留供日後使用
    // messageSender: {
    //     eng: 'Sender',
    //     cht: '發送者',
    // },
    //未引用, 保留供日後使用
    // postMessage: {
    //     eng: 'Post message',
    //     cht: '傳送訊息',
    // },
    postMessageSuccess: {
        eng: 'Message posted successfully',
        cht: '訊息傳送成功',
    },
    postMessageFail: {
        eng: 'Failed to post message',
        cht: '訊息傳送失敗',
    },
    inputMessage: {
        eng: 'Type a message...',
        cht: '輸入訊息...',
    },

    //任務頁
    //未引用, 保留供日後使用
    // tasks: {
    //     eng: 'Tasks',
    //     cht: '任務',
    // },
    //未引用, 保留供日後使用
    // tasksList: {
    //     eng: 'Tasks list',
    //     cht: '任務清單',
    // },
    taskTitle: {
        eng: 'Task title',
        cht: '任務標題',
    },
    taskPayload: {
        eng: 'Task payload',
        cht: '任務需求內容',
    },
    taskState: {
        eng: 'State',
        cht: '狀態',
    },
    taskAssignee: {
        eng: 'Assignee',
        cht: '認領者',
    },
    taskResult: {
        eng: 'Result',
        cht: '任務回應內容',
    },
    taskStatePending: {
        eng: 'Pending',
        cht: '待認領',
    },
    taskStateRunning: {
        eng: 'Running',
        cht: '執行中',
    },
    taskStateDone: {
        eng: 'Done',
        cht: '已完成',
    },
    taskStateError: {
        eng: 'Error',
        cht: '失敗',
    },
    //未引用, 保留供日後使用
    // claimTask: {
    //     eng: 'Claim task',
    //     cht: '認領任務',
    // },
    respondTask: {
        eng: 'Respond task',
        cht: '回應任務',
    },
    resetTask: {
        eng: 'Retry task',
        cht: '重試任務',
    },
    //未引用, 保留供日後使用
    // claimTaskSuccess: {
    //     eng: 'Task claimed successfully',
    //     cht: '任務認領成功',
    // },
    //未引用, 保留供日後使用
    // claimTaskFail: {
    //     eng: 'Failed to claim task',
    //     cht: '任務認領失敗',
    // },
    respondTaskSuccess: {
        eng: 'Task responded successfully',
        cht: '任務回應成功',
    },
    respondTaskFail: {
        eng: 'Failed to respond task',
        cht: '任務回應失敗',
    },
    resetTaskSuccess: {
        eng: 'Task reset successfully',
        cht: '任務重置成功',
    },
    resetTaskFail: {
        eng: 'Failed to reset task',
        cht: '任務重置失敗',
    },

    //=== 前端 SPA 介面文字鍵 (選單 / 對話 / 任務頁) ===

    //連線層 fallback (tErr 查無 procLang key 時使用)
    cannotConnectServer: {
        eng: 'Unable to connect to the server, please try again later',
        cht: '無法連線至伺服器，請稍後再試',
    },

    //左側選單
    mmChannels: {
        eng: 'Channels',
        cht: '頻道管理',
    },
    mmChannelsMsg: {
        eng: 'Manage channels for conversations and tasks.',
        cht: '管理用於對話與任務的頻道。',
    },
    mmConversation: {
        eng: 'Conversation',
        cht: '頻道對話',
    },
    mmConversationMsg: {
        eng: 'View channel messages, send messages or open them as tasks.',
        cht: '檢視頻道訊息、發送訊息或將訊息開成任務。',
    },
    mmTasks: {
        eng: 'Tasks',
        cht: '任務檢視',
    },
    mmTasksMsg: {
        eng: 'View tasks and their responses, retry or respond manually.',
        cht: '檢視任務與其回應，可重試或人工代回。',
    },

    //通用 UI
    modeEdit: {
        eng: 'Edit mode',
        cht: '編輯模式',
    },
    menuTreeShow: {
        eng: 'Show menu',
        cht: '顯示選單',
    },
    menuTreeHide: {
        eng: 'Hide menu',
        cht: '隱藏選單',
    },
    logoutConfirm: {
        eng: 'Are you sure you want to log out?',
        cht: '確定要登出嗎？',
    },

    //頻道頁 (CRUD 驗證 / 確認)
    channelsEmpty: {
        eng: 'No channels yet',
        cht: '目前尚無頻道',
    },
    channelNameEmpty: {
        eng: 'Channel name can not be empty',
        cht: '頻道名稱不可為空',
    },
    channelNameDuplicate: {
        eng: 'Channel name is duplicated',
        cht: '頻道名稱重複',
    },
    channelNameInvalid: {
        eng: 'Please correct the channel name first',
        cht: '請先修正頻道名稱',
    },
    deleteChannelConfirm: { //提示: 刪頻道時該頻道之訊息與任務移入封存表 (Q2, 使用者 2026-10-23 裁示); 進行中之任務亦一併移入, 之後不可再認領 / 回應
        eng: 'Are you sure you want to delete the selected channels? Their messages and tasks (including unfinished ones) will be moved to the archive and can no longer be claimed or answered.',
        cht: '確定要刪除所選頻道嗎？頻道內之訊息與任務（含進行中者）將一併移入封存，且不可再認領或回應。',
    },

    //後台清單頁之草稿保護 (多人同時編輯, 原則 10; 頻道頁、成員頁共用)
    draftStaleNotice: {
        eng: 'This data has been updated by someone else. Your unsaved edits are kept, but saving will be rejected. Please reload to get the latest data.',
        cht: '資料已被他人更新。未儲存的修改仍保留，但存檔將被拒絕，請重新載入取得最新資料。',
    },
    reloadData: {
        eng: 'Reload',
        cht: '重新載入',
    },
    reloadDiscardConfirm: {
        eng: 'Reloading will discard your unsaved edits. Continue?',
        cht: '重新載入將捨棄未儲存的修改，是否繼續？',
    },
    switchChannelDiscardConfirm: { //成員頁: 有未儲存修改時切換頻道之確認
        eng: 'Switching channel will discard your unsaved edits. Continue?',
        cht: '切換頻道將捨棄未儲存的修改，是否繼續？',
    },
    memberDuplicate: { //成員頁: 同一頻道內成員重複之儲存格警告 (tooltip)
        eng: 'This member is duplicated in the channel',
        cht: '此成員於頻道內重複',
    },
    memberInvalid: {
        eng: 'Please correct the duplicated members first',
        cht: '請先修正重複的成員',
    },

    //對話頁
    selectChannel: {
        eng: 'Channel',
        cht: '頻道',
    },
    selectChannelFirst: {
        eng: 'Please select a channel first',
        cht: '請先選擇頻道',
    },
    conversationEmpty: {
        eng: 'No messages in this channel yet',
        cht: '此頻道尚無訊息',
    },
    openAsTask: {
        eng: 'Open as task',
        cht: '開成任務',
    },
    taskTitlePlaceholder: {
        eng: 'Task title (optional, defaults to first line)',
        cht: '任務標題（選填，預設取首行）',
    },
    sendMessage: {
        eng: 'Send',
        cht: '送出',
    },
    messageContentEmpty: {
        eng: 'Message content can not be empty',
        cht: '訊息內容不可為空',
    },
    senderHuman: {
        eng: 'Human',
        cht: '人類',
    },
    senderAgent: {
        eng: 'Agent',
        cht: 'Agent',
    },
    kindText: {
        eng: 'Text',
        cht: '對話',
    },
    kindTask: {
        eng: 'Task',
        cht: '任務',
    },
    kindTaskReply: {
        eng: 'Task reply',
        cht: '任務回應',
    },

    //任務頁
    tasksEmpty: {
        eng: 'No tasks in this channel yet',
        cht: '此頻道尚無任務',
    },
    taskTimeDone: {
        eng: 'Done time',
        cht: '結束時間',
    },
    taskErrorKey: {
        eng: 'Error key',
        cht: '錯誤鍵',
    },
    resetTaskConfirm: {
        eng: 'Are you sure you want to retry this task?',
        cht: '確定要重試此任務嗎？',
    },
    respondTaskInputLabel: {
        eng: 'Respond on behalf (manual)',
        cht: '人工代回內容',
    },
    respondTaskPlaceholder: {
        eng: 'Enter the task result (markdown supported)...',
        cht: '輸入任務回應內容（支援 markdown）...',
    },
    respondTaskSubmit: {
        eng: 'Submit response',
        cht: '送出回應',
    },
    respondTaskResultEmpty: {
        eng: 'Response content can not be empty',
        cht: '回應內容不可為空',
    },

    //=== v2 UI (聊天式任務調度工作區) ===

    //左1 rail 區段
    mmStats: {
        eng: 'Stats',
        cht: '統計',
    },
    mmAdmin: {
        eng: 'Admin',
        cht: '後台',
    },
    mmMembers: {
        eng: 'Members',
        cht: '成員',
    },

    //頻道樹
    searchChannelPlaceholder: {
        eng: 'Search channels / projects...',
        cht: '搜尋頻道 / 專案…',
    },
    uncategorized: {
        eng: 'Uncategorized',
        cht: '未分類',
    },
    channelTreeEmpty: {
        eng: 'No channels match',
        cht: '無符合的頻道',
    },
    agentOnline: {
        eng: 'Agent online',
        cht: 'agent 在線',
    },

    //聊天工作區
    selectChannelToStart: {
        eng: 'Select a channel from the left to start',
        cht: '請從左側選擇一個頻道開始',
    },
    timelineEmpty: {
        eng: 'No messages in this channel yet',
        cht: '此頻道尚無訊息',
    },
    today: {
        eng: 'Today',
        cht: '今天',
    },
    noAgentAssigned: {
        eng: 'No agent assigned',
        cht: '未指派 agent',
    },

    //composer
    composerPlaceholder: {
        eng: 'Type a message...  Paste images directly  (Enter to send, Shift+Enter for newline)',
        cht: '輸入訊息…  可直接貼上多張圖片　(Enter 發送，Shift+Enter 換行)',
    },
    composerHint: {
        eng: 'Enter to send',
        cht: 'Enter 發送',
    },
    attachImage: {
        eng: 'Attach image',
        cht: '附加圖片',
    },
    removeImage: {
        eng: 'Remove image',
        cht: '移除圖片',
    },
    uploadImageFail: {
        eng: 'Failed to upload image',
        cht: '圖片上傳失敗',
    },
    viewImage: {
        eng: 'View image',
        cht: '檢視圖片',
    },

    //統計頁
    statChannels: {
        eng: 'Channels',
        cht: '頻道數',
    },
    statMessages: {
        eng: 'Messages',
        cht: '訊息數',
    },
    statTasks: {
        eng: 'Tasks',
        cht: '任務總數',
    },
    statPending: {
        eng: 'Pending',
        cht: '待處理',
    },
    statRunning: {
        eng: 'Running',
        cht: '處理中',
    },
    statDone: {
        eng: 'Done',
        cht: '已完成',
    },
    statError: {
        eng: 'Error',
        cht: '失敗',
    },
    //未引用, 保留供日後使用
    // statTotal: {
    //     eng: 'Total',
    //     cht: '總計',
    // },
    statsOverview: {
        eng: 'Overview',
        cht: '系統概況',
    },
    statTaskBreakdown: {
        eng: 'Task breakdown',
        cht: '任務狀態分布',
    },

    //後台管理
    channelLevels: {
        eng: 'Levels',
        cht: '階層',
    },
    //未引用, 保留供日後使用
    // channelLevelsHint: {
    //     eng: 'Hierarchy (separate with dots, e.g. ProjectA.BackendTeam)',
    //     cht: '階層（以英文句點分隔，如 電商平台改版.後端組）',
    // },
    selectChannelForMembers: {
        eng: 'Select a channel to manage members',
        cht: '選擇頻道以管理成員',
    },
    memberHuman: {
        eng: 'Human',
        cht: '人類',
    },
    memberAgent: {
        eng: 'Agent',
        cht: 'Agent',
    },
    membersEmpty: {
        eng: 'No members in this channel yet',
        cht: '此頻道尚無成員',
    },
    deleteMemberConfirm: {
        eng: 'Are you sure you want to delete the selected members?',
        cht: '確定要刪除所選成員嗎？',
    },

}


let init = (opt = {}) => {

    //kpLangExt
    let kpLangExt = get(opt, 'kpLangExt')
    if (!iseobj(kpLangExt)) {
        kpLangExt = {}
    }

    //webName
    let webName = get(opt, 'webName')
    if (!iseobj(webName)) {
        webName = {}
    }

    //webDescription
    let webDescription = get(opt, 'webDescription')
    if (!iseobj(webDescription)) {
        webDescription = {}
    }

    //kp
    let kp = {}

    //kpLang
    kp = {
        ...kp,
        ...kpLang,
    }

    //ext kpLangExt
    if (iseobj(kpLangExt)) {
        kp = {
            ...kp,
            ...kpLangExt,
        }
    }

    //webName
    if (iseobj(webName)) {
        kp = {
            ...kp,
            webName: {
                ...webName,
            },
        }
    }

    //webDescription
    if (iseobj(webDescription)) {
        kp = {
            ...kp,
            webDescription: {
                ...webDescription,
            },
        }
    }

    let langs = [
        'eng',
        'cht',
    ]

    let r = {}
    each(langs, (lang) => {

        //kpText
        let kpText = {}
        each(kp, (v, k) => {
            kpText[k] = v[lang]
        })

        //save
        r[lang] = kpText

    })

    return r
}


export default init
