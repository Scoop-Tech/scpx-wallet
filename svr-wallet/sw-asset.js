// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2023 Dominic Morris.

const Keygen = require('eosjs-keygen').Keygen
const _ = require('lodash')
const BigDecimal = require('js-big-decimal')

const configWallet = require('../config/wallet')
const walletExternal = require('../actions/wallet-external')

const opsWallet = require('../actions/wallet')

const utilsWallet = require('../utils')

const exchangeActions = require('../actions/exchange')
const { isStatusExchangePending } = require('../exchange/constants')
const { toXsSymbol } = require('../api/xs-changelly')

const log = require('../sw-cli-log')
const tx = require('./sw-tx')

//
// transaction-related wallet functions
//

module.exports = {

    // gets suggested network fees from oracles
    getNetworkFees: async (appWorker, store, p) => {
        const { symbol } = p

        // validate
        const wallet = store.getState().wallet
        if (utilsWallet.isParamEmpty(symbol)) return Promise.resolve({ err: `Asset symbol is required` })
        const asset = wallet.assets.find(p => p.symbol.toLowerCase() === symbol.toLowerCase())
        if (!asset) return Promise.resolve({ err: `Invalid asset symbol "${symbol}"` })

        const feeData = await opsWallet.getAssetFeeData(asset)

        return Promise.resolve({ symbol, ok: { feeData } })
    },

    // use exchange service to convert from one asset to another
    assetConvert: async (appWorker, store, p) => {
        var { mpk, apk, value, symbol, to, from, status } = p
        const h_mpk = utilsWallet.pbkdf2(apk, mpk)
        const showStatus = utilsWallet.isParamTrue(status)

        log.cmd('asset-convert')
        log.param('mpk', configWallet.IS_TEST ? '[secure]' : mpk)
        log.param('symbol', symbol)
        log.param('value', value)
        log.param('to', to)
        log.param('from', from)
        log.param('status', showStatus)

        // display status of in-process XS transaction(s)
        if (showStatus) {
            const cur_xsTx = store.getState().userData.exchange.cur_xsTx
            if (!cur_xsTx) Promise.resolve({ ok: [] })
            const xsInfo = []
            Object.keys(cur_xsTx).map(symbol => {
                const xsTx = cur_xsTx[symbol]
                if (isStatusExchangePending(xsTx.cur_xsTxStatus)) {
                    xsInfo.push(xsTx)
                }
            })
            return Promise.resolve({ ok: xsInfo })
        }

        // XS - get currencies
        await exchangeActions.XS_getCurrencies(store)
        const exchangeState = store.getState().userData.exchange
        if (!exchangeState) return Promise.resolve({ err: "Failed to get exchange state" })
        console.dir(exchangeState)

        // validate from and to symbols
        var { err, wallet, asset: exchangeAsset, du_sendValue } = await utilsWallet.validateSymbolValue(store, symbol, value)
        if (err) return Promise.resolve({ err })
        var { err, asset: receiveAsset } = await utilsWallet.validateSymbolValue(store, to, value)
        if (err) return Promise.resolve({ err })

        // abort if XS tx already in process for this asset
        const cur_xsTx = exchangeState.cur_xsTx
        if (isStatusExchangePending(cur_xsTx[exchangeAsset.symbol].cur_xsTxStatus)) return Promise.resolve({ err: `Conversion already in process for ${exchangeAsset.displaySymbol}` })

        // validate XS status for supplied conversion currencies
        const currencies = exchangeState.currencies
        if (!currencies) return Promise.resolve({ err: "Failed to get exchange currencies state" })
        const xsFrom = currencies.find(p => p.name === toXsSymbol(symbol))
        const xsTo = currencies.find(p => p.name === toXsSymbol(to))
        if (!xsFrom) return Promise.resolve({ err: `Unsupported XS from symbol "${symbol}"` })
        if (!xsTo) return Promise.resolve({ err: `Unsupported XS to symbol "${to}"` })
        if (_.eq(xsFrom, xsTo)) return Promise.resolve({ err: `From and to assets must be different` })
        if (!xsFrom.enabled) return Promise.resolve({ err: `XS from asset "${symbol}" is currently disabled (maintenance)` })
        if (!xsTo.enabled) return Promise.resolve({ err: `XS to asset "${to}" is currently disabled (maintenance)` })

        // account-type: map supplied from-addr to addr-index
        var sendFromAddrNdx = -1 // utxo: use all available address indexes
        if (exchangeAsset.type === configWallet.WALLET_TYPE_ACCOUNT) { // account: use specific address index
            if (utilsWallet.isParamEmpty(from)) return Promise.resolve({ err: `From address is required` })
            sendFromAddrNdx = exchangeAsset.addresses.findIndex(p => p.addr.toLowerCase() === from.toLowerCase())
            if (sendFromAddrNdx == -1) return Promise.resolve({ err: `Invalid from address` })
        }

        // get fee
        const txGetFee = await tx.txGetFee(appWorker, store, { 
            mpk, apk, symbol, value
        })
        if (txGetFee.err) return Promise.resolve({ err: txGetFee.err })
        if (!txGetFee.ok || !txGetFee.ok.txFee || txGetFee.ok.txFee.fee === undefined) return Promise.resolve({ err: `Error computing TX fee` })
        const du_fee = Number(txGetFee.ok.txFee.fee)

        // validate sufficient balance
        const bal = walletExternal.get_combinedBalance(exchangeAsset, sendFromAddrNdx)
        const du_balConf = utilsWallet.toDisplayUnit(bal.conf, exchangeAsset)
        log.info('du_sendValue', du_sendValue)
        log.info('du_balConf', du_balConf)
        log.info('du_fee', du_fee)
        if (du_sendValue + du_fee > du_balConf) return Promise.resolve({ err: `Insufficient confirmed balance` })

        // get expected receive amount, and fixed rate ID (if fixed-rate pair)
        await exchangeActions.XS_setReceiveAsset(store, receiveAsset.symbol)
        const minAmount = await exchangeActions.XS_setExchangeAsset(store, exchangeAsset.symbol)
        if (minAmount === undefined) return Promise.resolve({ err: `Error getting min amount from XS for ${exchangeAsset.symbol}==>${receiveAsset.symbol}` })
        const userData = store.getState().userData
        await exchangeActions.XS_getEstReceiveAmount(store, userData.exchange.cur_fromSymbol, userData.exchange.cur_toSymbol, du_sendValue) 
        const userDataExchange = _.cloneDeep(store.getState().userData.exchange) 
        if (userDataExchange.cur_estReceiveAmount === undefined) return Promise.resolve({ err: `Error getting est. receive amount from XS for ${exchangeAsset.symbol}==>${receiveAsset.symbol}` })
        //delete userDataExchange.currencies // dbg output
        //console.log('userDataExchange', userDataExchange)

        // validate min/max amounts
        if (du_sendValue > Number(userDataExchange.cur_maxAmount)) return Promise.resolve({ err: `Send value too high - XS maximum allowable (${userDataExchange.cur_maxAmount})` })
        if (du_sendValue < Number(userDataExchange.cur_minAmount)) return Promise.resolve({ err: `Send value not enough - XS minimum allowable (${userDataExchange.cur_minAmount})` })

        // initiate XS
        const feeParams = { txFee:  _.cloneDeep(txGetFee.ok.txFee) }
        return exchangeActions.XS_initiateExchange(store, {
                   wallet,
            exchangeAsset,
             receiveAsset,
                   amount: du_sendValue,
     cur_estReceiveAmount: userDataExchange.cur_estReceiveAmount,
                feeParams,
                  addrNdx: sendFromAddrNdx,
                   rateId: userDataExchange.cur_fixedRateId,
                      apk,
                    h_mpk: utilsWallet.getHashedMpk(), //#READ
                    owner: utilsWallet.getStorageContext().owner,
        })
        .then(res => {
            const cur_xsTx = store.getState().userData.exchange.cur_xsTx
            return Promise.resolve({ ok: { xsTx: cur_xsTx[exchangeAsset.symbol] } })

            // todo: should set to status to "done" on finalized states - to match web bahavior (manual user ack)
        })
        .catch(err => {
            //console.error('XS_initiateExchange FAIL: err=', err)
            return Promise.resolve({ err })
        })
    }
}
