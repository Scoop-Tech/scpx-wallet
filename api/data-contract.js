// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.

const API = require('./api').axiosApi
const utilsWallet = require('../utils')
const configWallet = require('../config/wallet')

module.exports = {

    login_v2Api: (emailHash, encryptedEmail) => {
        const req = { emailHash, email: encryptedEmail }
        utilsWallet.log(`POST login_v2...`)
        return API.post(`login_v2`, req)
        .then(res => {
            utilsWallet.log(`login_v2 POST - ok`)
            return res.data
        })
    },

    createAccountApi: (email, hashedEmail, publicKeys) => {
        const req = { email: email, emailHash: hashedEmail, publicKeys: publicKeys }

        utilsWallet.log('POST account...')
        return API.post(`account`, req)
        .then(res => {
            utilsWallet.log('account POST - ok' + JSON.stringify(res, 2, null))
            if (res && res.data) {
                utilsWallet.getAppWorker().postMessage({ msg: 'NOTIFY_USER',
                    data: { type: 'success', headline: 'Created Wallet', info: 'Wrote Scoop chain', txid: res.data.txid } })
            }
            return res.data
        })
        .catch(e => {
            const msg = e.response && e.response.data ? e.response.data.msg : e.toString()
            utilsWallet.logErr(msg)
            utilsWallet.getAppWorker().postMessage({ msg: 'NOTIFY_USER', data:  { type: 'error', headline: 'Server Error', info: msg }})
        })
    },

    updateAssetsJsonApi: (accountName, encryptedAssetsJSONRaw, encryptedEmail) => { 
        const req = { accountName, assetsJSONRaw: encryptedAssetsJSONRaw, email: encryptedEmail }

        utilsWallet.log(`POST assets...`)
        return API.post(`assets`, req)
        .then(res => {
            utilsWallet.log(`assets POST - ok`)

            if (res && res.data) {
                utilsWallet.getAppWorker().postMessage({ msg: 'NOTIFY_USER',
                data: { type: 'success', headline: 'Saved Wallet', info: 'Updated Scoop chain', txid: res.data.txid } })
                return res.data
            }
        })
        .catch(e => {
            const msg = e.response && e.response.data ? e.response.data.msg : e.toString()
            utilsWallet.logErr(msg)
            utilsWallet.getAppWorker().postMessage({ msg: 'NOTIFY_USER', data:  { type: 'error', headline: 'Server Error', info: msg }})
        })
    },    
    
}