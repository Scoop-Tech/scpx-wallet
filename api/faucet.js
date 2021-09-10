// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2021 Dominic Morris.

const API = require('./api').axiosApi

const utilsWallet = require('../utils')

module.exports = {
    drip: (owner, e_email, btcTestAddr, ethTestAddr, hideToast = false) => {
        const req = { owner, e_email, btc_test_addr: btcTestAddr, eth_test_addr: ethTestAddr }
        
        debugger
        console.log(`POST drip - owner=${owner}`)
        return API.post(`faucet`, req)
        .then(res => {
            if (res && res.data && hideToast == false) {
                console.log('res', res)
                debugger                
                if (res.data.res === 'ok') {
                    if (res.data.btc_test.txid !== undefined) {
                        utilsWallet.getAppWorker().postMessageWrapped({ 
                            msg: 'NOTIFY_USER', 
                           data: { type: 'success', 
                            headline: 'Received Test Bitcoin!', 
                                info: 'Testnet Bitcoin', 
                                txid: res.data.btc_test.txid
                        }})
                    }
                    if (res.data.eth_test.txid !== undefined) {
                        utilsWallet.getAppWorker().postMessageWrapped({ 
                            msg: 'NOTIFY_USER', 
                           data: { type: 'success', 
                            headline: 'Received Test Ethereum!', 
                                info: 'Ropsten Ethereum', 
                                txid: res.data.eth_test.txid
                        }})
                    }
                }
            }
            return res.data
        })
        .catch(err => {
            //const msg = e.response && e.response.data ? e.response.data.toString() : e.toString()
            //utilsWallet.logErr(msg)
            debugger
            utilsWallet.getAppWorker().postMessageWrapped({ msg: 'NOTIFY_USER', data: { type: 'error', headline: 'Server Error', info: err.toString() }})
        })
    }
}
