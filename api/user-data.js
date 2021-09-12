// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2021 Dominic Morris.

const API = require('./api').axiosApi

const utilsWallet = require('../utils')

module.exports = {
    updateDataJsonApi: (owner, dataJSON, e_email, hideToast = false) => {
        const req = { owner, dataJSONRaw: dataJSON, e_email }
        
        if (dataJSON === undefined || dataJSON === null || dataJSON.length == 0) {
            utilsWallet.reportErr(`### updateDataJsonApi - invalid dataJSON passed - ignoring!`)
            return
        }
    
        //console.log(`POST updateDataJsonApi - owner=${owner}`)
        return API.post(`data`, req)
        .then(res => {
            if (res && res.data && hideToast == false) {
                utilsWallet.getAppWorker().postMessageWrapped({ msg: 'NOTIFY_USER', data:  { type: 'success', headline: 'Saved Settings', info: 'Updated Scoop chain', txid: res.data.txid }})
            }
            return res.data
        })
        .catch(e => {
            //const msg = e.response && e.response.data ? e.response.data.toString() : e.toString()
            //utilsWallet.reportErr(msg)
            utilsWallet.getAppWorker().postMessageWrapped({ msg: 'NOTIFY_USER', data: { type: 'error', headline: 'Server Error', info: e.toString() }})
        })
    }
}
