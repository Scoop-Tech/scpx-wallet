// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2023 Dominic Morris.

const axios = require('axios')
const { axiosApi } = require('./api')

module.exports = { 
    toXsSymbol: (symbol) => { 
        return symbol.toUpperCase() === 'BTC_SEG'  || symbol.toUpperCase() === 'BTC_SEG2' || symbol.toUpperCase() === 'BTC_TEST2' ? 'btc' 
             : symbol.toUpperCase() === 'BCHABC' ? 'bch'
             : symbol.toUpperCase() === 'USDT' ? 'usdt20'
             : symbol.toLowerCase()
    },

    xs_changelly_Sign: (rpcParams) => {
        const req = { rpc_params: rpcParams }
        //axiosRetry(axios, CONST.AXIOS_RETRY_EXTERNAL)
        return axiosApi.post(`xs/c/sign`, req)
        .then(res => {
            if (res && res.data) {
                return res.data
            }
            else  {
                console.error('## xs_changelly_Sign POST, no data')
                return null
            }
        })
        .catch(err => {
            console.error('## xs_changelly_Sign POST, err= ', err)
            return null
        })    
    }
}