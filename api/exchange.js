import axios from 'axios'
//import axiosRetry from 'axios-retry'

//import { HmacSHA512 } from 'crypto-js'

import { changellyConfig } from '../config/changelly'
import { xs_changelly_Sign } from './xs'

//import * as CONST from '../constants'
//import * as utils from '../utils'

export function getCurrenciesFullApi() {
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
}

// variable/estimated rates (standard api)
export async function getMinAmountApi(p) {
    const params = { from: toXsSymbol(p.fromSymbol), to: toXsSymbol(p.toSymbol) }
    // if (params.from === 'BTC_SEG' || params.from === 'BTC_SEG2') params.from = 'BTC'
    // if (params.to === 'BTC_SEG' || params.to === 'BTC_SEG2') params.to = 'BTC'

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
}
export function getEstReceiveAmountApi(p) {
    const params = { from: toXsSymbol(p.fromSymbol), to: toXsSymbol(p.toSymbol), amount: p.amount }
    // if (params.from === 'BTC_SEG' || params.from === 'BTC_SEG2') params.from = 'BTC'
    // if (params.to === 'BTC_SEG' || params.to === 'BTC_SEG2') params.to = 'BTC'

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
}

// fixed-rate api
export function getFixRateApi(p) { // v1 (deprecated Dec 1st 2019) -- TODO: remove, once "invalid ccy pair" is resolved in v2
    const params = [ { from: toXsSymbol(p.fromSymbol), to: toXsSymbol(p.toSymbol), amount: p.amount } ] // api can handle bulk list, but we call with a single pair
    // if (params[0].from === 'BTC_SEG' || params[0].from === 'BTC_SEG2') params[0].from = 'BTC'
    // if (params[0].to === 'BTC_SEG' || params[0].to === 'BTC_SEG2') params[0].to = 'BTC'

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
}
export async function getPairsParamsApi(p) { // v2
    const params = [ { from: toXsSymbol(p.fromSymbol), to: toXsSymbol(p.toSymbol) } ]
    // if (params[0].from === 'BTC_SEG' || params[0].from === 'BTC_SEG2') params[0].from = 'BTC'
    // if (params[0].to === 'BTC_SEG' || params[0].to === 'BTC_SEG2') params[0].to = 'BTC'

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
}
export function getFixRateForAmountApi(p) { // v2
    const params = [ { 
              from: toXsSymbol(p.fromSymbol),
                to: toXsSymbol(p.toSymbol), amount: p.amount,
        amountFrom: p.amountFrom, //...
    }] // api can return for >1
    // if (params[0].from === 'BTC_SEG' || params[0].from === 'BTC_SEG2') params[0].from = 'BTC'
    // if (params[0].to === 'BTC_SEG' || params[0].to === 'BTC_SEG2') params[0].to = 'BTC'

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
}

// create xs tx - variable 
export function createTransactionApi(p) {
    const params = { from: toXsSymbol(p.fromSymbol), to: toXsSymbol(p.toSymbol), address: p.receiveAddress, amount: p.amount, refundAddress: p.refundAddress }
    // if (params.from === 'BTC_SEG' || params.from === 'BTC_SEG2') params.from = 'BTC'
    // if (params.to === 'BTC_SEG' || params.to === 'BTC_SEG2') params.to = 'BTC'

    return genParamsAndSign(changellyConfig.createTransaction, params)
    .then(tuples => {
        //axiosRetry(axios, CONST.AXIOS_RETRY_EXTERNAL)
        return axios.post(changellyConfig.baseURL, tuples.params, { headers: changellyConfig.headers(tuples.sign) })
        .then(res => {
            return res.data
        })
    })
}

// create xs tx - fixed (w/ rateId)
export function createTransactionFixedApi(p) {
    const params = { from: toXsSymbol(p.fromSymbol), to: toXsSymbol(p.toSymbol), address: p.receiveAddress, amount: p.amount, refundAddress: p.refundAddress, rateId: p.rateId }
    // if (params.from === 'BTC_SEG' || params.from === 'BTC_SEG2') params.from = 'BTC'
    // if (params.to === 'BTC_SEG' || params.to === 'BTC_SEG2') params.to = 'BTC'

    console.log('XS - createTransactionFixedApi, params=', params)
    return genParamsAndSign(changellyConfig.createFixTransaction, params)
    .then(tuples => {
        //axiosRetry(axios, CONST.AXIOS_RETRY_EXTERNAL)
        return axios.post(changellyConfig.baseURL, tuples.params, { headers: changellyConfig.headers(tuples.sign) })
        .then(res => {
            return res.data
        })
    })
}

export function getStatusApi(xsTxId) {
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
}

export function getTransactionsApi(p) {
    const params = { currency: toXsSymbol(p.fromSymbol), address: p.payinAddress, limit: 888, offset: 0 }
    //if (params.currency === 'BTC_SEG' || params.currency === 'BTC_SEG2') params.currency = 'BTC'
    
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

var apiId = 0
async function genParamsAndSign(method, params) {
    const rpcParams = { 
        id: apiId++, 
        jsonrpc: '2.0',
        method,
        params
    }
    
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

function toXsSymbol(symbol) {
    return symbol === 'BTC_SEG' || symbol === 'BTC_SEG2' ? 'btc' 
         : symbol === 'BCHABC' ? 'bch'
         : symbol === 'USDT' ? 'usdt20'
         : symbol
}