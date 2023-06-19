// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2023 Dominic Morris.

const API = require('./api').axiosApi
const BigDecimal = require('js-big-decimal')

const utilsWallet = require('../utils')

module.exports = {
    drip: (owner, e_email, btcTestAddr, ethTestAddr, ) => {
        const req = { owner, e_email, btc_test_addr: btcTestAddr, eth_test_addr: ethTestAddr }
        
        console.log(`POST drip - owner=${owner}`)
        return API.post(`faucet`, req)
        .then(res => {
            return res.data
        })
        .catch(err => {
            //const msg = e.response && e.response.data ? e.response.data.toString() : e.toString()
            //utilsWallet.reportErr(msg)
            utilsWallet.getAppWorker().postMessageWrapped({ msg: 'NOTIFY_USER', data: { type: 'error', headline: 'Server Error', info: err.toString() }})
        })
    }
}
