// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2025 Dominic Morris.

const _ = require('lodash')

const { USERDATA_UPDATE_FBASE, USERDATA_UPDATE_OPTION, USERDATA_UPDATE_AUTOCONVERT } = require('.')
const { updateDataJsonApi } = require('../api/user-data')

const { createEncryptedJson_FromUserData, getOptionValue } = require('./user-data-helpers')
const configWallet = require('../config/wallet')

const utils = require('../utils')

module.exports = {

    settingsUpdateOption: (p) => {
        const { key, newValue, saveNow } = p
        console.log(`settings - settingsChange: ${key}=${newValue}, saveNow=${saveNow}`)
        return dispatch => {
            dispatch({ type: USERDATA_UPDATE_OPTION, key, payload: { 
                newValue, 
                   owner: utils.getStorageContext().owner, 
                    save: saveNow === undefined || saveNow === true 
                            ? true : false 
            }})
        }
    },

    settingsUpdateFirebase: (p) =>  { 
        console.log(`settings - settingsUpdateFirebase: email,photoURL=`, p.email, p.photoURL)
        return dispatch => {
            dispatch({ type: USERDATA_UPDATE_FBASE, payload: { email: p.email, photoURL: p.photoURL, }})
        }
    },

    settingsUpdateAutoConvert: (p) => {
        console.log(`settings - settingsUpdateAutoConvert: fromSyncInfo, fromSymbol, toSymbol=`, p.fromSyncInfo, p.fromSymbol, p.toSymbol)
        return dispatch => {
            dispatch({ type: USERDATA_UPDATE_AUTOCONVERT, payload: { 
                fromSyncInfo: p.fromSyncInfo, 
                  fromSymbol: p.fromSymbol, 
                    toSymbol: p.toSymbol, 
                       owner: utils.getStorageContext().owner
            }})
        }
    },

    userData_SaveAll: (p) =>  { 
        var { userData, hideToast } = p
        if (configWallet.WALLET_ENV === "SERVER") hideToast = false

        if (utils.getStorageContext().owner !== null) {
            if (userData !== undefined && userData !== null) {
                // remove redundant / transient exchange fields
                const prunedUserData = _.cloneDeep(userData)
                delete prunedUserData.exchange.cur_fromSymbol
                delete prunedUserData.exchange.cur_toSymbol
                delete prunedUserData.exchange.cur_minAmount
                delete prunedUserData.exchange.cur_maxAmount
                delete prunedUserData.exchange.cur_fixedRateId
                delete prunedUserData.exchange.cur_estReceiveAmount
                delete prunedUserData.exchange.currencies

                // dbg - remove any integer keys, e.g. 608: "6", 607: "h", ... 
                // (these seem to result from dev-time flipping between encrypted and unencrypted stores)
                const keys = Object.keys(prunedUserData)
                keys.forEach(key => {
                    if (Number.isInteger(Number(key))) {
                        delete prunedUserData[key]
                    }
                })

                // write user beta testing opt in/out value to browser storage
                const userOptInBetaTest = getOptionValue(prunedUserData, "OPT_BETA_TESTER")
                utils.getStorageContext().OPT_BETA_TESTER = userOptInBetaTest

                // update server user data field
                const dataJsonPayload = createEncryptedJson_FromUserData(prunedUserData)
                if (dataJsonPayload) {
                    updateDataJsonApi(utils.getStorageContext().owner, dataJsonPayload, utils.getStorageContext().e_email, hideToast)
                    .then(res => {
                        //console.log(res)
                    })
                    .catch(error => {
                        utils.reportErr(error)
                        console.log(`## settingsSaveAll FAIL ${error.message}`, error)
                        let msg = "Unknown Error"
                        try {
                            msg = error.response.data.msg || error.message || "Unknown Error"
                        }
                        catch (_) {
                            msg = error.message || "Unknown Error"
                        }
                    })
                } else console.warn(`## settingsSaveAll - ignoring: got undefined dataJsonPayload!`)
            } else console.warn(`## settingsSaveAll - ignoring: undefined settings passed!`)
        } else console.warn(`## settingsSaveAll - ignoring: not logged in!`)
    }
}