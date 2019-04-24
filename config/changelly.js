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
    
        getCurrenciesFull: 'getCurrenciesFull',
        getMinAmount: 'getMinAmount',
        getEstReceiveAmount: 'getExchangeAmount',
        createTransaction: 'createTransaction',
        getStatus: 'getStatus',
        getTransactions: 'getTransactions',
    
        getFixRate: 'getFixRate',
        createFixTransaction: 'createFixTransaction',
    }
}