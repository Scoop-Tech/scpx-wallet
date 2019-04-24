const API = require('./api').axiosApi
const utilsWallet = require('../utils')

module.exports = {

    updateAssetsJsonApi: (accountName, encryptedAssetsJSONRaw, encryptedEmail) => { //}, hideToast = false) {
        const req = { accountName, assetsJSONRaw: encryptedAssetsJSONRaw, email: encryptedEmail }

        console.log(`updateAssetsJsonApi - accountName=${accountName} encryptedEmail=${encryptedEmail}`)

        return API.post(`assets`, req)
        .then(res => {
            console.log(`updateAssetsJsonApi - ok`)

            if (res && res.data) {
                // if (!hideToast) {
                //     utilsWallet.showToastr({ type: 'success', headline: 'Saved Wallet', info: 'Updated Scoop chain', txid: res.data.txid })
                // }
                return res.data
            }
        })
        .catch(e => {
            const msg = e.response && e.response.data ? e.response.data.msg : e.toString()
            utilsWallet.logErr(msg)
            //utilsWallet.showToastr({ type: 'error', headline: 'Server Error', info: msg })
        })
    },

}