const axios = require('axios')

const { changellyConfig } = require('../config/changelly')
const { xs_changelly_Sign } = require('./xs-changelly')
const { toXsSymbol } = require('./xs-changelly')

module.exports = {

    getCurrenciesFullApi: () => {
        const params = {}
        return genParamsAndSign(changellyConfig.getCurrenciesFull, params)
        .then(tuples => {
            if (tuples) {
                //axiosRetry(axios, CONST.AXIOS_RETRY_EXTERNAL)
                return axios.post(changellyConfig.baseURL, tuples.params, { headers: changellyConfig.headers(tuples.sign) })
                .then(res => {
                    return res.data
                })
            }
        })
    },

    // variable/estimated rates (standard api)
    getMinAmountApi: async (p) => {
        const params = { from: toXsSymbol(p.fromSymbol), to: toXsSymbol(p.toSymbol) }
        return genParamsAndSign(changellyConfig.getMinAmount, params)
        .then(tuples => {
            if (tuples) {
                //axiosRetry(axios, CONST.AXIOS_RETRY_EXTERNAL)
                return axios.post(changellyConfig.baseURL, tuples.params, { headers: changellyConfig.headers(tuples.sign) })
                .then(res => {
                    return res.data
                })
            }
        })
    },
    getEstReceiveAmountApi: async (p) => {
        const params = { from: toXsSymbol(p.fromSymbol), to: toXsSymbol(p.toSymbol), amount: p.amount }
        return genParamsAndSign(changellyConfig.getEstReceiveAmount, params)
        .then(tuples => {
            if (tuples) {
                //axiosRetry(axios, CONST.AXIOS_RETRY_EXTERNAL)
                return axios.post(changellyConfig.baseURL, tuples.params, { headers: changellyConfig.headers(tuples.sign) })
                .then(res => {
                    return res.data
                })
            }
        })
    },

    // fixed-rate api
    getFixRateApi: async (p) => { // v1 (deprecated Dec 1st 2019) -- TODO: remove, once "invalid ccy pair" is resolved in v2
        const params = [ { from: toXsSymbol(p.fromSymbol), to: toXsSymbol(p.toSymbol), amount: p.amount } ] // api can handle bulk list, but we call with a single pair

        return genParamsAndSign(changellyConfig.getFixRate, params)
        .then(tuples => {
            if (tuples) {
                //axiosRetry(axios, CONST.AXIOS_RETRY_EXTERNAL)
                return axios.post(changellyConfig.baseURL, tuples.params, { headers: changellyConfig.headers(tuples.sign) })
                .then(res => {
                    if (!res || !res.data || !res.data.result || !res.data.result.length == 1) {
                        console.error('getFixRateApi unexpected data, res=', res)
                        return null
                    }
                    return res.data.result[0]
                })
                .catch(err => {
                    utils.logErr(err)
                    console.error('getFixRateApi FAIL, err=', err)
                    return null
                })
            }
        })
    },
    getPairsParamsApi: async (p) => { // v2
        const params = [ { from: toXsSymbol(p.fromSymbol), to: toXsSymbol(p.toSymbol) } ]
        return genParamsAndSign(changellyConfig.getPairsParams, params)
        .then(tuples => {
            if (tuples) {
                //axiosRetry(axios, CONST.AXIOS_RETRY_EXTERNAL)
                return axios.post(changellyConfig.baseURL, tuples.params, { headers: changellyConfig.headers(tuples.sign) })
                .then(res => {
                    console.log('v2 - getPairsParams, res', res)
                    return res.data.result[0]
                })
            }
        })
    },
    getFixRateForAmountApi: async (p) => { // v2
        const params = [ { from: toXsSymbol(p.fromSymbol), to: toXsSymbol(p.toSymbol), amount: p.amount, amountFrom: p.amountFrom }] // api can return for >1
        return genParamsAndSign(changellyConfig.getFixRateForAmount, params)
        .then(tuples => {
            if (tuples) {
                //axiosRetry(axios, CONST.AXIOS_RETRY_EXTERNAL)
                return axios.post(changellyConfig.baseURL, tuples.params, { headers: changellyConfig.headers(tuples.sign) })
                .then(res => {
                    console.log('v2 - getFixRateForAmountApi, res', res)
                    if (!res || !res.data || !res.data.result || !res.data.result.length == 1) {
                        console.error('getFixRateForAmountApi unexpected data, res=', res)
                        return null
                    }
                    return res.data.result[0]
                })
                .catch(err => {
                    utils.logErr(err)
                    console.error('getFixRateForAmountApi FAIL, err=', err)
                    return null
                })
            }
        })
    },

    // create xs tx - variable 
    createTransactionApi: async (p) => {
        const params = { from: toXsSymbol(p.fromSymbol), to: toXsSymbol(p.toSymbol), address: p.receiveAddress, amount: p.amount, refundAddress: p.refundAddress }
        return genParamsAndSign(changellyConfig.createTransaction, params)
        .then(tuples => {
            //axiosRetry(axios, CONST.AXIOS_RETRY_EXTERNAL)
            return axios.post(changellyConfig.baseURL, tuples.params, { headers: changellyConfig.headers(tuples.sign) })
            .then(res => {
                return res.data
            })
        })
    },

    // create xs tx - fixed (w/ rateId)
    createTransactionFixedApi: async (p) => {
        const params = { from: toXsSymbol(p.fromSymbol), to: toXsSymbol(p.toSymbol), address: p.receiveAddress, amount: p.amount, refundAddress: p.refundAddress, rateId: p.rateId }
        console.log('XS - createTransactionFixedApi, params=', params)
        return genParamsAndSign(changellyConfig.createFixTransaction, params)
        .then(tuples => {
            //axiosRetry(axios, CONST.AXIOS_RETRY_EXTERNAL)
            return axios.post(changellyConfig.baseURL, tuples.params, { headers: changellyConfig.headers(tuples.sign) })
            .then(res => {
                return res.data
            })
        })
    },

    getStatusApi: async (xsTxId) => {
        const params = { id: xsTxId }
        return genParamsAndSign(changellyConfig.getStatus, params)
        .then(tuples => {
            if (tuples) {
                //axiosRetry(axios, CONST.AXIOS_RETRY_EXTERNAL)
                return axios.post(changellyConfig.baseURL, tuples.params, { headers: changellyConfig.headers(tuples.sign) })
                .then(res => {
                    return res.data
                })
            }
        })
    },

    getTransactionsApi: async (p) => {
        const params = { currency: toXsSymbol(p.currency), address: p.payinAddress, limit: 888, offset: 0 }
        return genParamsAndSign(changellyConfig.getTransactions, params)
        .then(tuples => {
            if (tuples) {
                //axiosRetry(axios, CONST.AXIOS_RETRY_EXTERNAL)
                return axios.post(changellyConfig.baseURL, tuples.params, { headers: changellyConfig.headers(tuples.sign) })
                .then(res => {
                    return res.data
                })
            }
        })
    }
}

var apiId = 0
async function genParamsAndSign(method, params) {
    const rpcParams = { id: apiId++, jsonrpc: '2.0', method, params }
    const res = await xs_changelly_Sign(JSON.stringify(rpcParams))
    if (!res || !res.data) {
        console.error('## xs_changelly_Sign fail')
        return null
    }
    else {
        const remoteSig = res.data
        return { params: rpcParams, sign: remoteSig }
    }
}

// function toXsSymbol(symbol) {
//     return symbol === 'BTC_SEG' || symbol === 'BTC_SEG2' ? 'btc' 
//          : symbol === 'BCHABC' ? 'bch'
//          : symbol === 'USDT' ? 'usdt20'
//          : symbol
// }
