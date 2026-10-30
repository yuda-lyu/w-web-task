import getDiag from 'wsemi/src/getDiag.mjs'
import { getUrlSecrets } from 'w-serv-orm/src/getDiagBrief.mjs'


/**
 * 產生本套件之外來值遮罩出口(wsemi之getDiag實例，只用其diag.err與diag.mask，不作診斷輸出)
 *
 * 外來值＝後端、驅動或使用端回呼之錯誤(原文可能含連線字串、帳密、權杖)，離開本套件前(對外reject與throw、回遠端之msg、寫入srLog之msg與err)須經diag.err或diag.mask；
 * 本套件自身以固定詞彙(i18n key或字面)組成之reject不經遮罩。規格見dspec〈診斷輸出與遮罩〉D3，規則見sgud/rule/rulebook_backend.md R-ORMDIAG-07
 *
 * 秘密來源為部署端給之ORM連線位址url，分類沿用w-serv-orm之getUrlSecrets(單一定義，本套件不另寫等價實作)：連線字串(含://或@)列為網址(帳密為憑證，對外錯誤值亦遮)，
 * 其餘(lmdb、lowdb等之檔案位置)列為儲存路徑(只遮診斷輸出，對外錯誤值不遮，dspec Q3)；未列為秘密之憑證形態(網址帳密、password=、Bearer等)由wsemi之樣式規則遮罩
 *
 * @param {String} url 輸入資料庫連線位址字串，即WWebTask之url
 * @returns {Function} 回傳wsemi之diag函數，另帶err、mask(此處不呼叫diag本身)
 */
function genDiag(url) {
    return getDiag({}, { secrets: getUrlSecrets(url) })
}


export default genDiag
