// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2023 Dominic Morris.

const utils = require('../utils')

module.exports = {

    // create encrypted user data payload for post to server 
    // note: uses different salt to mpk encryption (plaintext for settings/userData is well known)
    createEncryptedJson_FromUserData: (userData) => {
        const e_userDataJson = utils.aesEncryption(
            utils.getStorageContext().opk, 
            utils.getHashedMpk(), // #READ
            JSON.stringify(userData))
        const data = {
            settingsJson: e_userDataJson // "settingsJson" - legacy name; it should really be called userDataJson
        }
        const ret = JSON.stringify(data)
        return ret
    },

    getUserData_FromEncryptedJson: (dataJson) => {
        const dataObject = JSON.parse(dataJson)
        const e_userDataJson = dataObject.settingsJson
        
        var opk = utils.getStorageContext().opk
        var pt_userDataJson = utils.aesDecryption(
            opk, 
            utils.getHashedMpk(), //#READ
            e_userDataJson)

        const o_userData = JSON.parse(pt_userDataJson)
        return o_userData
    },

    getOptionValue: (settings, key)  => {
        const ndx = settings.options.findIndex((p) => p.key === key)
        if (ndx == -1) return undefined
        return settings.options[ndx].value
    }

}