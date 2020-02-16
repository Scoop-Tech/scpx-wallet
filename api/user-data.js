// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2020 Dominic Morris.

const API = require('./api').axiosApi

const utilsWallet = require('../utils')

module.exports = {
    updateDataJsonApi: (owner, dataJSON, e_email, hideToast = false) => {
        const req = { owner, dataJSONRaw: dataJSON, e_email }
        
        if (dataJSON === undefined || dataJSON === null || dataJSON.length == 0) {
            utilsWallet.logErr(`### updateDataJsonApi - invalid dataJSON passed - ignoring!`)
            return
        }
    
        //console.log(`POST updateDataJsonApi - owner=${owner}`)
        return API.post(`data`, req)
        .then(res => {
            //console.log(`updateDataJsonApi - ok`)
            if (res && res.data && hideToast == false) {
                utilsWallet.getAppWorker().postMessage({ msg: 'NOTIFY_USER', data:  { type: 'success', headline: 'Saved Settings', info: 'Updated Scoop chain', txid: res.data.txid }})
            }
            return res.data
        })
        .catch(e => {
            //const msg = e.response && e.response.data ? e.response.data.toString() : e.toString()
            //utilsWallet.logErr(msg)
            utilsWallet.getAppWorker().postMessage({ msg: 'NOTIFY_USER', data: { type: 'error', headline: 'Server Error', info: e.toString() }})
        })
    }
}
