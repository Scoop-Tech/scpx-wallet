// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2020 Dominic Morris.

const Keygen = require('eosjs-keygen').Keygen
const _ = require('lodash')
const BigDecimal = require('js-big-decimal')

const configWallet = require('../config/wallet')
const walletExternal = require('../actions/wallet-external')

const opsWallet = require('../actions/wallet')

const utilsWallet = require('../utils')

const exchangeActions = require('../actions/exchange')
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
        if (!asset) Promise.resolve({ err: `Invalid asset symbol "${symbol}"` })

        const feeData = await opsWallet.getAssetFeeData(asset)

        return Promise.resolve({ ok: { feeData } })
    },

    // use exchange service to convert from one asset to another
    assetConvert: async (appWorker, store, p) => {
        var { mpk, apk, value, symbol, to, from } = p
        const h_mpk = utilsWallet.pbkdf2(apk, mpk)

        log.cmd('asset-convert')
        log.param('mpk', process.env.NODE_ENV === 'test' ? '[secure]' : mpk)
        log.param('symbol', symbol)
        log.param('value', value)
        log.param('to', to)
        log.param('from', from)

        // XS - get currency statuses
        await exchangeActions.XS_getCurrencies(store)
        const exchangeState = store.getState().userData.exchange
        if (!exchangeState) return Promise.resolve({ err: "Failed to get exchange state" })

        //console.dir(exchangeState)
/*
{ cur_xsTx: {},
  currencies:
   [ { name: 'btc',
       ticker: 'btc',
       fullName: 'Bitcoin',
       enabled: true,
       fixRateEnabled: true,
       payinConfirmations: 2,
       extraIdName: null,
       addressUrl: 'https://www.blockchain.com/btc/address/%1$s',
       transactionUrl: 'https://www.blockchain.com/btc/tx/%1$s',
       image: 'https://web-api.changelly.com/api/coins/btc.png',
       fixedTime: 1200000 },
     { name: 'eth',
       ticker: 'eth',
       fullName: 'Ethereum',
       enabled: true,
       fixRateEnabled: true,
       payinConfirmations: 15,
       extraIdName: null,
       addressUrl: 'https://changelly.enjinx.io/eth/address/%1$s/transactions',
       transactionUrl: 'https://changelly.enjinx.io/eth/transaction/%1$s',
       image: 'https://web-api.changelly.com/api/coins/eth.png',
       ...
*/

        // validate from and to symbols
        var { err, wallet, asset, du_sendValue } = await utilsWallet.validateSymbolValue(store, symbol, value)
        if (err) return Promise.resolve({ err })
        var { err } = await utilsWallet.validateSymbolValue(store, to, value)
        if (err) return Promise.resolve({ err })
        
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
        if (asset.type === configWallet.WALLET_TYPE_ACCOUNT) { // account: use specific address index
            if (utilsWallet.isParamEmpty(from)) return Promise.resolve({ err: `From address is required` })
            sendFromAddrNdx = asset.addresses.findIndex(p => p.addr.toLowerCase() === from.toLowerCase())
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
        const bal = walletExternal.get_combinedBalance(asset, sendFromAddrNdx)
        const du_balConf = utilsWallet.toDisplayUnit(bal.conf, asset)
        log.info('du_sendValue', du_sendValue)
        log.info('du_balConf', du_balConf)
        log.info('du_fee', du_fee)
        
        // const bd_sendValue = new BigDecimal(du_sendValue)
        // const bd_balConf = new BigDecimal(du_balConf)
        // const bd_fee = new BigDecimal(du_fee)
        // log.info('bd_sendValue', bd_sendValue.getPrettyValue())
        // log.info('bd_balConf', bd_balConf.getPrettyValue())
        // log.info('bd_fee', bd_fee.getPrettyValue())
        // const remaining = bd_balConf.subtract(bd_sendValue).subtract(bd_fee)
        // log.info('remaining', remaining.getPrettyValue())

        if (du_sendValue + du_fee > du_balConf) return Promise.resolve({ err: `Insufficient confirmed balance` })

        // todo: execute XS
        //...

        return Promise.resolve({ ok: 'WIP...' })
    }
}
