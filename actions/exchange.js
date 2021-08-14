// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2021 Dominic Morris.

const _ = require('lodash')
const BigNumber = require('bignumber.js')
const BigDecimal = require('js-big-decimal')

const utilsWallet = require('../utils')

const { XS_SET_EXCHANGE_ASSET, XS_SET_RECEIVE_ASSET, XS_SET_MINMAX_AMOUNT, 
         XS_SET_EST_RECEIVE_AMOUNT, XS_SET_FIXED_RECEIVE_AMOUNT,
         XS_UPDATE_EXCHANGE_TX,
         XS_SET_CURRENCIES } = require('.')

const { getCurrenciesFullApi,
         getMinAmountApi, getEstReceiveAmountApi, getFixRateApi,
         getFixRateForAmountApi, getPairsParamsApi,
         createTransactionApi, createTransactionFixedApi, 
         getStatusApi, getTransactionsApi } = require('../api/exchange')
const { toXsSymbol } = require('../api/xs-changelly')

const { walletExternal_config } = require('../config/wallet-external')
const configWallet = require('../config/wallet')

const { createTxHex, createAndPushTx } = require('./wallet-external')
const { ExchangeStatusEnum } = require('../exchange/constants')

const USE_CHANGELLY_FIXEDRATE_V2 = false

var receiveAssetValue_intId
var exchangeStatusTimer_intId = []

module.exports = {

    // currency statuses
    XS_getCurrencies: (store) => {
        return getCurrenciesFullApi()
        .then(res => {
            if (res && res.result) {
                //console.log('XS - getCurrencies, res=', res)
                
                // disable erc20 usdt manually -- not supported by changelly (have asked them if they can add it)
                // TODO: changelly -- "If it's about ERC20 USDT, we have already listed it. The ticker is usdt20."
                // const usdt = res.result.find(p => p.name === 'usdt')
                // if (usdt) {
                //     usdt.enabled = false
                // }

                store.dispatch({ type: XS_SET_CURRENCIES, payload: res.result })
            }
        })
    },

    // currently selected from and to assets
    XS_setExchangeAsset: (store, assetSymbol) => {
        if (!assetSymbol) {
            console.error('XS - XS_setExchangeAsset - invalid params')
        }

        console.log(`XS - XS_setExchangeAsset - ${assetSymbol}`)
        store.dispatch({ type: XS_SET_EXCHANGE_ASSET, payload: assetSymbol })

        const cur_toSymbol = store.getState().userData.exchange.cur_toSymbol
        if (cur_toSymbol !== undefined) {
            return getMinAmount(store, assetSymbol, cur_toSymbol)
        }
        return null
    },
    XS_setReceiveAsset: (store, assetSymbol) => {
        console.log(`XS - XS_setReceiveAsset - ${assetSymbol}`)
        store.dispatch({ type: XS_SET_RECEIVE_ASSET, payload: assetSymbol })

        store.dispatch({ type: XS_SET_FIXED_RECEIVE_AMOUNT, payload: { derivedExpected: undefined, rateId: undefined } })
        store.dispatch({ type: XS_SET_EST_RECEIVE_AMOUNT,   payload: { derivedExpected: undefined, rateId: undefined } })

        const cur_fromSymbol = store.getState().userData.exchange.cur_fromSymbol
        if (cur_fromSymbol !== undefined && assetSymbol !== undefined) {
            return getMinAmount(store, cur_fromSymbol, assetSymbol)
        }
        return null
    },

    // min/max allowable for pair
    XS_getMinAmount: async (store, fromSymbol, toSymbol) => getMinAmount(store, fromSymbol, toSymbol),
    XS_clearMinAmount: () => {return { type: XS_SET_MINMAX_AMOUNT, payload: { min: 0, max: 0 } } },

    // estimate receive amount
    XS_getEstReceiveAmount: async (store, fromSymbol, toSymbol, amount) => getEstReceiveAmount(store, fromSymbol, toSymbol, amount),
    XS_getEstReceiveAmount_SetTimer: async (store, fromSymbol, toSymbol, amount) => {
        console.log(`XS_getEstReceiveAmount_SetTimer fromSymbol=${fromSymbol} toSymbol=${toSymbol}...`)
        getEstReceiveAmount_ClearTimer()
        getEstReceiveAmount(store, fromSymbol, toSymbol, amount)
        receiveAssetValue_intId = setInterval(() => {
            getEstReceiveAmount(store, fromSymbol, toSymbol, amount)
        }, configWallet.IS_DEV ? 20000 : 20000) // refresh frequently -- v2 fixed rate API rateId's expire after 30s!
    },
    XS_getEstReceiveAmount_ClearTimer: () => getEstReceiveAmount_ClearTimer(),

    // execute exchange
    XS_initiateExchange: (store, p) => {
        const { wallet, exchangeAsset, receiveAsset, amount, cur_estReceiveAmount, feeParams, addrNdx, rateId,
                apk, h_mpk, owner } = p
        
        getEstReceiveAmount_ClearTimer()

        return new Promise(async (resolve, reject) => {

            console.log(`XS - XS_initiateExchange (${rateId ? 'FIXED' : 'VARIABLE'}) - ${amount} ${exchangeAsset.symbol}==>${receiveAsset.symbol}, rateId=${rateId}...`)
            console.log('amount', amount)
            console.log('amount.toString()', amount.toString())

            // eth send-max rounding
            // get actual value amount that we will send - changelly requires an exact match for its fixed-rate api
            const payToDummy = [{ receiver: walletExternal_config[exchangeAsset.symbol].donate, value: amount }]
            const txHexAndValue = await createTxHex({
                                payTo: payToDummy,
                                asset: exchangeAsset,
                   encryptedAssetsRaw: wallet.assetsRaw,
                            feeParams: feeParams,
                             sendMode: false,
                      sendFromAddrNdx: addrNdx,
                                  apk, 
                                h_mpk, 
            })
            //console.log('DBG1 - txHexAndValue.cu_sendValue', txHexAndValue.cu_sendValue)

            const du_sendAmountActual = utilsWallet.toDisplayUnit(new BigNumber(txHexAndValue.cu_sendValue), exchangeAsset)
            //console.log('DBG1 - du_sendAmountActual=', du_sendAmountActual)

            // init changelly 
            var xsCreateTx
            if (rateId === undefined) {
                xsCreateTx = await createTransactionApi({  // variable-rate api
                    fromSymbol: exchangeAsset.symbol,
                      toSymbol: receiveAsset.symbol, 
                receiveAddress: receiveAsset.addresses[0].addr,  
                 refundAddress: exchangeAsset.addresses[addrNdx == -1 ? 0 : addrNdx].addr,
                        amount: du_sendAmountActual
                })
            }
            else {
                xsCreateTx = await createTransactionFixedApi({  // fixed-rate api
                  fromSymbol: exchangeAsset.symbol,
                    toSymbol: receiveAsset.symbol, 
              receiveAddress: receiveAsset.addresses[0].addr,  
               refundAddress: exchangeAsset.addresses[addrNdx == -1 ? 0 : addrNdx].addr,
                      rateId: rateId,
                      amount: du_sendAmountActual
                })
            }

            if (xsCreateTx) {
                if (xsCreateTx.error) {
                    console.error(`## XS - xsCreateTx - error=`, xsCreateTx.error)
                    utilsWallet.getAppWorker().postMessageWrapped({ msg: 'NOTIFY_USER', data: { type: 'error', headline: 'Exchange Error 6', info: `xsCreateTx - ${xsCreateTx.error.message}` }})
                    reject()
                    return
                }
                if (!xsCreateTx.result) {
                    console.error(`## XS - xsCreateTx - error=`, xsCreateTx.error)
                    utilsWallet.getAppWorker().postMessageWrapped({ msg: 'NOTIFY_USER', data: { type: 'error', headline: 'Exchange Error 10', info: `xsCreateTx - no result` }})
                    if (Sentry) {
                        Sentry.captureMessage(`!xsCreateTx.result, xsCreateTx=${JSON.stringify(xsCreateTx)}`)
                    }
                    reject()
                    return
                }

                // push tx: send to XS
                const payToActual = [{ receiver: xsCreateTx.result.payinAddress, value: amount }]
                createAndPushTx( {
                            store: store,
                            payTo: payToActual,
                           wallet: wallet,
                            asset: exchangeAsset,
                        feeParams: feeParams,
                  sendFromAddrNdx: addrNdx,
                              apk, 
                            h_mpk, 
                }, (res, err) => {

                    if (err) {
                        store.dispatch(setCurrentStatus({ from: exchangeAsset, status: ExchangeStatusEnum.done, owner })) // clear exchange status
                        if (exchangeStatusTimer_intId !== undefined) { 
                            clearTimeout(exchangeStatusTimer_intId)
                        }
                        console.error(`## XS - XS_initiateExchange (${rateId ? 'FIXED' : 'VARIABLE'}) - createAndPushTx - err=`, err)
                        utilsWallet.error(err)
                        utilsWallet.getAppWorker().postMessageWrapped({ msg: 'NOTIFY_USER', data:  { type: 'error', headline: 'Exchange Error 7', info: `createAndPushTx - ${err.message || err.toString()}` }})
                        reject()
                    }
                    else {
                        if (!res) {
                            store.dispatch(setCurrentStatus({ from: exchangeAsset, status: ExchangeStatusEnum.done, owner  })) // clear exchange status
                            if (exchangeStatusTimer_intId !== undefined) { 
                                clearTimeout(exchangeStatusTimer_intId)
                            }
                            utilsWallet.error(err)
                            utilsWallet.getAppWorker().postMessageWrapped({ msg: 'NOTIFY_USER', data:  { type: 'error', headline: 'Exchange Error 8', info: 'createAndPushTx - no data' }})
                            console.error(`## XS - XS_initiateExchange (${rateId ? 'FIXED' : 'VARIABLE'}) - createAndPushTx - no data`)
                            reject()
                        }
                        else {
                            utilsWallet.getAppWorker().postMessageWrapped({ msg: 'NOTIFY_USER', data:  { type: 'info',
                                headline: `${exchangeAsset.displaySymbol}: Broadcast TX`,
                                    info: `Node accepted`,
                                   desc1: `For exchange into ${receiveAsset.displayName}`,
                                    txid: res.tx.txid }})

                            // create exchange tx record
                            var xsTx = {}
                            xsTx[exchangeAsset.symbol] = {
                                  txid: res.tx.txid,
                                sentAt: new Date().getTime(),
                                    xs: xsCreateTx.result,
                            fromSymbol: exchangeAsset.symbol,
                              toSymbol: receiveAsset.symbol,
                            amountSent: amount,
                  cur_estReceiveAmount: cur_estReceiveAmount,
                           fixedRateId: rateId, 
                        cur_xsTxStatus: ExchangeStatusEnum.waiting,
                            }
                            store.dispatch({ type: XS_UPDATE_EXCHANGE_TX, 
                                          payload: { data: xsTx,
                                                     owner, //: utils.getBrowserStorage().owner 
                            } })

                            // poll for exchange status
                            store.dispatch(pollExchangeStatus(store, exchangeAsset, xsTx[exchangeAsset.symbol], owner))

                            //console.log(`Exchange - XS_initiateExchange - createAndPushTx OK`, res)
                            resolve()
                        }
                    }
                })
            }
            else {
                utilsWallet.getAppWorker().postMessageWrapped({ msg: 'NOTIFY_USER', data: { type: 'error', headline: 'Exchange Error 9', info: 'xsCreateTx - no data' }})
                console.error(`## XS - XS_initiateExchange (${rateId ? 'FIXED' : 'VARIABLE'}) - xsCreateTx - no data`)
                reject()
            }
        })
    },

    // get transaction(s)
    getTransaction: async (xsTx) => getTransaction(xsTx),

    // exchange status
    XS_pollExchangeStatus: (store, from, xsTx, owner) => pollExchangeStatus(store, from, xsTx, owner),
    //getExchangeStatus_SetTimer: (store, from, xsTx, owner) => getExchangeStatus_SetTimer(store, from, xsTx, owner),
    XS_setCurrentStatus: (p) => setCurrentStatus(p)
}

function setCurrentStatus(p) {
    const { from, status, owner } = p

    return (dispatch) => {
        
        if (status === ExchangeStatusEnum.done) { 
            // exchange completed and acknowledged by user (could be successful or otherwise)

            // stop polling
            //getExchangeStatus_ClearTimer()

            // TODO (history) -- should push the xsTx to a history queue, or similar ...

            // remove exchange tx
            // var xsTx = {}
            // xsTx[from.symbol] = undefined
            // dispatch({ type: XS_UPDATE_EXCHANGE_TX, payload: { data: xsTx, owner: utils.getBrowserStorage().owner } })
        }

        // update current exchange status
        var xsTx = {}
        xsTx[from.symbol] = {
            cur_xsTxStatus: status,
        }
        dispatch({ type: XS_UPDATE_EXCHANGE_TX, 
                payload: { data: xsTx, 
                          owner, //: utils.getBrowserStorage().owner 
        } })
    }
}

async function getTransaction(xsTx) {
    return getTransactionsApi({ currency: xsTx.xs.currencyFrom, address: xsTx.xs.payinAddress })
    .then(res => {
        if (res && res.result) {
            //console.log(`getTransactions - ${xsTx.xs.currencyFrom}, res=`, res)
            const txs = res.result.filter(p => p.id === xsTx.xs.id)
            if (txs.length != 1) {
                // it is possible that we may not get back the finalized xs tx data - getTransactionsApi() caps at the last 99 tx's
                // this can happen if we have executed many other XS tx's from the same fromCurrency since we last polled
                utilsWallet.logErr(`getTransactions - ${xsTx.xs.currencyFrom} - failed to get id ${xsTx.xs.id}`)
                return null
            }
            //console.log(`getTransactions - ${xsTx.xs.currencyFrom} - txid ${xsTx.xs.id} [0]=`, txs[0])
            return txs[0]
        }
    })
}
function pollExchangeStatus(store, from, xsTx, owner) { 
    return (dispatch) => {
        //getExchangeStatus_ClearTimer()

        //console.log(`XS - pollExchangeStatus - [XS ID ${xsTx.xs.id}]<==${from.symbol}...`)//, xsTx)

        getStatusApi(xsTx.xs.id)
        .then(res => {

            var continuePolling = true

            if (res) {
                if (res.error) {
                    console.error('XS - getStatusApi, error=', res.error)
                    return
                }
                var status = res.result 
                //console.log(`XS - pollExchangeStatus - ${from.symbol}==>[XS ID ${xsTx.xs.id}], status=`, status)
                if (status === 'sending') { 
                    status = ExchangeStatusEnum.receiving
                }

                // get current store state for this xs tx 
                var storeState = store.getState()
                if (storeState.userData.exchange && storeState.userData.exchange.cur_xsTx) {
                    const store_cur_xsTx = storeState.userData.exchange.cur_xsTx[from.symbol]

                    if (store_cur_xsTx) {

                        // has tx status changed? update store if so
                        if (store_cur_xsTx.cur_xsTxStatus !== status) {
                            dispatch(setCurrentStatus({ from, status, owner }))
                        }
                        
                        // is tx concluded? mark it finalized if so
                        if (status === 'finished' || status === 'failed' || status === 'refunded' || status === 'overdue' || status === 'hold') {
                            continuePolling = false
                        
                            storeState = store.getState() // refresh store state

                            // update store & notify -- only on actual state change
                            if (storeState.userData.exchange && storeState.userData.exchange.cur_xsTx) { 
                                const xsTx = storeState.userData.exchange.cur_xsTx[from.symbol]
                                if (xsTx && xsTx.cur_xsTxStatus !== status) { // state changed?

                                    // update the XS tx data with finalized data
                                    getTransaction(xsTx)
                                    .then((tx) => {
                                        if (storeState.userData.exchange && storeState.userData.exchange.cur_xsTx) { 
                                            const updated = _.cloneDeep(storeState.userData.exchange.cur_xsTx)
                                            if (updated[from.symbol]) {
                                                // edge-case: it is possible that we might fail to get the finalized tx data from changelly
                                                // in this case, don't overwrite what we do have
                                                if (tx) { 
                                                    updated[from.symbol].xs = tx
                                                }
                                                updated[from.symbol].cur_xsTxStatus = status
                                                dispatch({ type: XS_UPDATE_EXCHANGE_TX, payload: { data: updated, owner }})
                                            }
                                        }
                                    })

                                    // notify user - XS concluded
                                    utilsWallet.getAppWorker().postMessageWrapped({ msg: 'NOTIFY_USER', data: { type: status === 'finished' ? 'success' : 'error',
                                        headline: `${from.displaySymbol}: Exchange Completed`,
                                            info: `Status: ${status.toUpperCase()} (Changelly)`,
                                           desc1: `xsTx.xs.id: ${xsTx.xs.id}`, //`For exchange into ${receiveAsset.displayName}`,
                                            txid: undefined
                                    }})
                                }
                            }

                        }
                    }
                }
                else {
                    continuePolling = true
                }
            }
            else {
                console.error('XS - getStatusApi no data')
            }

            if (continuePolling) {
                dispatch(getExchangeStatus_SetTimer(store, from, xsTx, owner))
            }
        })
    }
}

function getExchangeStatus_SetTimer(store, from, xsTx, owner) {
    return (dispatch) => {
        //console.log(`XS - getExchangeStatus_SetTimer[${xsTx.xs.id}]`)//, xsTx)
        exchangeStatusTimer_intId[xsTx.xs.id] = setTimeout(() => {
            dispatch(pollExchangeStatus(store, from, xsTx, owner))
        }, configWallet.IS_DEV ? 10000 : 10000)
    }
}

function roundUp(decimals, value) {
    if (!decimals) {
        return value
    }
    const rounded = new BigDecimal(value).round(decimals, BigDecimal.RoundingModes.UP).getValue()
    return rounded
}

function getEstReceiveAmount_ClearTimer() {
    if (receiveAssetValue_intId !== undefined) {
        clearInterval(receiveAssetValue_intId)
    }
}

async function getEstReceiveAmount(store, fromSymbol, toSymbol, amount) {
    // clear first - prevents stale values showing
    store.dispatch({ type: XS_SET_FIXED_RECEIVE_AMOUNT, payload: { derivedExpected: undefined, rateId: undefined } })

    if (amount == 0 || !fromSymbol || !toSymbol) return

    const storeState = store.getState()
    if (!storeState || !storeState.userData || !storeState.userData.exchange || !storeState.userData.exchange.currencies) { 
        console.error('XS - getMinAmount - invalid store state')
        return null
    }

    const fromSymbolLookup = toXsSymbol(fromSymbol)
    const toSymbolLookup = toXsSymbol(toSymbol)

    const xsCcyFrom = storeState.userData.exchange.currencies.find((p) => { return p.name === fromSymbolLookup.toLowerCase() })
    const xsCcyTo = storeState.userData.exchange.currencies.find((p) => { return p.name === toSymbolLookup.toLowerCase() })

    //console.log(`getEstReceiveAmount - xsCcyFrom=`, xsCcyFrom)
    //console.log(`getEstReceiveAmount - xsCcyTo=`, xsCcyTo)
    if (!xsCcyFrom.fixRateEnabled || !xsCcyTo.fixRateEnabled) {  
        // variable-rate api
        const res = await getEstReceiveAmountApi({ fromSymbol, toSymbol, amount })
        if (res) {
            //console.log(`XS - getEstReceiveAmount (VARIABLE) - ${amount} ${fromSymbol}==>${toSymbol}, res=`, res)
            store.dispatch({ type: XS_SET_EST_RECEIVE_AMOUNT, payload: { result: res.result * configWallet.XS_CHANGELLY_VARRATE_MARKDOWN } })
        }
        else {
            utilsWallet.getAppWorker().postMessageWrapped({ msg: 'NOTIFY_USER', data:  { type: 'error', headline: 'Exchange Error 4', info: `getEstReceiveAmountApi - no data` }})
            console.error('XS - getEstReceiveAmount - getEstReceiveAmountApi - no data')
            return null
        }
    }
    else { 
        // fixed-rate api -- calc. expected amount, keep track of the rateId
        
        // (v1 - deprecated Dec 1st 2019)
        if (USE_CHANGELLY_FIXEDRATE_V2 == false) {
            const res = await getFixRateApi({ fromSymbol, toSymbol })
            if (res) {
                //console.log('getEstReceiveAmount - v1(dep) - fixed getFixRate', res);
                const rateId = res.id
                const fixedRate = res.result
                const derivedExpected = fixedRate * amount
                //console.log(`XS - getEstReceiveAmount (FIXED) - ${amount} ${fromSymbol}==>${toSymbol}, rateId=${rateId} derivedExpected=${derivedExpected}, fixedRes=`, res)
                store.dispatch({ type: XS_SET_FIXED_RECEIVE_AMOUNT, payload: { derivedExpected, rateId } })
            }
            else {
                utilsWallet.getAppWorker().postMessageWrapped({ msg: 'NOTIFY_USER', data:  { type: 'error', headline: 'Exchange Error 5', info: `getFixRateApi - no data` }})
                console.error('XS - getEstReceiveAmount - getFixRateApi - no data')
                return null
            }
        }
        else {
            // v2 - getFixRateForAmount
            // ### -- createTransactionFixedApi() returning "invalid currency pair" when using this rateId...
            const res = await getFixRateForAmountApi({ fromSymbol, toSymbol, amountFrom: amount })
            if (res) {
                const rateId = res.id 
                const fixedRate = res.result
                const derivedExpected = fixedRate * amount
                //console.log(`XS - getEstReceiveAmount (FIXED) - ${amount} ${fromSymbol}==>${toSymbol}, rateId=${rateId} derivedExpected=${derivedExpected}, fixedRes=`, res)
                store.dispatch({ type: XS_SET_FIXED_RECEIVE_AMOUNT, payload: { derivedExpected, rateId } })
            }
            else {
                utilsWallet.getAppWorker().postMessageWrapped({ msg: 'NOTIFY_USER', data:  { type: 'error', headline: 'Exchange Error 5', info: `getFixRateApi - no data` }})
                console.error('XS - getEstReceiveAmount - getFixRateApi - no data')
                return null
            }
        }
    }
}

async function getMinAmount(store, fromSymbol, toSymbol) {
    if (!fromSymbol || !toSymbol) { 
        console.error('XS - getMinAmount - invalid params')
        return null
    }
    if (fromSymbol === toSymbol) { return null }

    const storeState = store.getState()
    if (!storeState || !storeState.userData || !storeState.userData.exchange || !storeState.userData.exchange.currencies) { 
        console.error('XS - getMinAmount - invalid store state')
        return null
    }
    const fromSymbolXs = toXsSymbol(fromSymbol)
    const toSymbolXs = toXsSymbol(toSymbol)
    const xsCcyFrom = storeState.userData.exchange.currencies.find((p) => p.name === fromSymbolXs.toLowerCase())
    const xsCcyTo = storeState.userData.exchange.currencies.find((p) => p.name === toSymbolXs.toLowerCase())
    if (xsCcyFrom === undefined || xsCcyTo === undefined) {
        console.warn('XS - getMinAmount - xsCcyFrom||xsCcyFrom undefined in XS currency list - nop')
        return null
    }
    const metaFrom = configWallet.getMetaBySymbol(fromSymbol)
    if (!xsCcyFrom.fixRateEnabled || !xsCcyTo.fixRateEnabled) {  
        // variable-rate api
        const res = await getMinAmountApi({ fromSymbol, toSymbol })
        if (res && res.result) {
            const rounded = roundUp(
                metaFrom.decimals,
                (Number(res.result) * 1.1).toFixed(4) // hack: observed - mimatch on minimum reported vs. accepted, from changelly
            )
            store.dispatch({ type: XS_SET_MINMAX_AMOUNT, payload: {
                min: rounded,
                max: undefined // TODO: see below -- should be calling getPairsParams() and reading the float fields?
            }})
            //console.log('rounded', rounded.toString())
            return rounded
        }
        else {
            utilsWallet.getAppWorker().postMessageWrapped({ msg: 'NOTIFY_USER', data:  { type: 'error', headline: 'Exchange Error 2', info: `getMinAmountApi - no data` }})
            console.error('XS - getMinAmount - getMinAmountApi - no data')
            return null
        }
    }
    else { 
        // fixed-rate api (v1 - deprecated Dec 1st 2019)
        if (USE_CHANGELLY_FIXEDRATE_V2 == false) {
            const res = await getFixRateApi({ fromSymbol, toSymbol })
            if (res) {
                //console.log('getMinAmount - v1(dep) - fixed getFixRate', res);
                const rounded = roundUp(metaFrom.decimals, 
                                        (Number(res.min) * 1.1).toFixed(4)
                                    )
                store.dispatch({ type: XS_SET_MINMAX_AMOUNT, payload: { 
                    min: rounded, 
                    max: res.max
                }})
                //console.log('rounded', rounded.toString())
                return rounded
            }
            else {
                utilsWallet.getAppWorker().postMessageWrapped({ msg: 'NOTIFY_USER', data:  { type: 'error', headline: 'Exchange Error 3', info: `getFixRateApi - no data` }})
                console.error('XS - getMinAmount - getFixRateApi - no data')
                return null
            }
        }
        else {
            // new v2 - getPairsParams
            const res = await getPairsParamsApi({ fromSymbol, toSymbol }) // TODO: this API's float (variable) fields also replace getMinAmountApi()?
            if (res) {
                const roundedMin = roundUp(metaFrom.decimals, Number(res.minAmountFixed) * 1.1)
                store.dispatch({ type: XS_SET_MINMAX_AMOUNT, payload: { 
                    min: roundedMin, 
                    max: res.maxAmountFixed // TODO: is max amount used anywhere?! some are certainly capped by Changelly on fixed, e.g. TUSD max is ~ $8k...
                }})
                return roundedMin
            }
            else {
                utilsWallet.getAppWorker().postMessageWrapped({ msg: 'NOTIFY_USER', data:  { type: 'error', headline: 'Exchange Error 3', info: `getPairsParamsApi - no data` }})
                console.error('XS - getMinAmount - v2 getPairsParamsApi - no data')
                return null
            }
        }
    }
}