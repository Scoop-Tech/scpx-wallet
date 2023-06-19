// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2023 Dominic Morris.

const baseURL = 'https://api.changelly.com'

module.exports = {
    changellyConfig: {
        baseURL: baseURL,
        headers: (sign) => {
            return {
                'api-key': 'd32d86363c3a4103b25aa96ac4473c70',
                'sign': sign.toString(), 
                'Content-type': 'application/json'
            }
        },
    
        // standard API
        getCurrenciesFull: 'getCurrenciesFull',
        getMinAmount: 'getMinAmount',
        getEstReceiveAmount: 'getExchangeAmount',
        createTransaction: 'createTransaction',
        getStatus: 'getStatus',
        getTransactions: 'getTransactions',
    
        // fixed rate API
        getFixRate: 'getFixRate',                       // v1
        getPairsParams: 'getPairsParams',               // new v2
        getFixRateForAmount: 'getFixRateForAmount',     // new v2
        createFixTransaction: 'createFixTransaction',   // v1 / v2
    }
}