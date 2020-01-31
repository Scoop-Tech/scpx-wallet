
import * as utils from '../utils'

// create encrypted user data payload for post to server 
// note: uses different salt to mpk encryption (plaintext for settings/userData is well known)
export function createEncryptedJson_FromUserData(userData) {
    console.log(`createEncryptedJson_FromUserData...`)
    var e_userDataJson = utils.aesEncryption(
        utils.getStorageContext().opk, 
        document.hjs_mpk || utils.getStorageContext().PATCH_H_MPK, // #READ
        JSON.stringify(userData))
    var data = {
        settingsJson: e_userDataJson // "settingsJson" - legacy name; it should really be called userDataJson
    }
    const ret = JSON.stringify(data)
    return ret
}

export function getUserData_FromEncryptedJson(dataJson) {
    var dataObject = JSON.parse(dataJson) // ???, opk)
    var e_userDataJson = dataObject.settingsJson // as above
    
    var opk = utils.getStorageContext().opk
    var pt_userDataJson = utils.aesDecryption(
        opk, 
        document.hjs_mpk || utils.getStorageContext().PATCH_H_MPK, //#READ
        e_userDataJson)

    console.log(`getSettingsFromDataJson: pt_userDataJson.len=${pt_userDataJson.length}`)
    const o_userData = JSON.parse(pt_userDataJson)
    return o_userData
}

export function getOptionValue(settings, key) {
    var ndx = settings.options.findIndex((p) => p.key === key)
    if (ndx == -1) return undefined
    //console.log(`getSetting ${key} ndx=${ndx}`)
    return settings.options[ndx].value
}

