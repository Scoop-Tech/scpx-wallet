// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2025 Dominic Morris.

const API = require('./api').axiosApi
const utilsWallet = require('../utils')
const configWallet = require('../config/wallet')

module.exports = {

    login_v2Api: (h_email, e_email) => {
        const req = { h_email, e_email }
        utilsWallet.log(`POST login_v2...`)
        return API.post(`login_v2`, req)
        .then(res => {
            utilsWallet.log(`login_v2 POST - ok`)
            return res.data
        })
    },

    createAccountApi: (h_email, e_email, publicKeys) => {
        const req = { e_email, h_email, publicKeys: publicKeys }

        utilsWallet.log('POST account...')
        return API.post(`account`, req)
        .then(res => {
            utilsWallet.log('account POST - ok' + JSON.stringify(res, 2, null))
            if (res && res.data) {
                // gets in the way of browser auto-save popups, doesn't add much value:
                // utilsWallet.getAppWorker().postMessageWrapped({ msg: 'NOTIFY_USER',
                //     data: { type: 'success', headline: 'Created Wallet!', info: 'Wrote Scoop chain', txid: res.data.txid, position: "top-center" } })
            }
            return res.data
        })
        .catch(err => {
            const msg = err.response && err.response.data && err.response.data.msg ? err.response.data.msg : JSON.stringify(err)
            utilsWallet.reportErr(msg)
            //utilsWallet.getAppWorker().postMessageWrapped({ msg: 'NOTIFY_USER', data:  { type: 'error', headline: 'Create Account Failed', info: msg }})
            throw msg
        })
    },

    updateAssetsJsonApi: ({ owner, encryptedAssetsJSONRaw, e_email, showNotification }) => { 
        const req = { owner, assetsJSONRaw: encryptedAssetsJSONRaw, e_email }

        utilsWallet.log(`POST assets...`)
        return API.post(`assets`, req)
        .then(res => {
            utilsWallet.log(`assets POST - ok`)
            if (res && res.data) {
                if (showNotification) {
                    utilsWallet.getAppWorker().postMessageWrapped({ msg: 'NOTIFY_USER',
                        data: { type: 'success', headline: 'Saved Wallet', info: 'Updated Scoop chain', txid: res.data.txid } })
                }
                return res.data
            }
        })
        .catch(e => {
            const msg = e.response && e.response.data ? e.response.data.toString() : e.toString()
            utilsWallet.reportErr(msg)
            utilsWallet.getAppWorker().postMessageWrapped({ msg: 'NOTIFY_USER', data:  { type: 'error', headline: 'Server Error', info: msg }})
        })
    },    
    
}