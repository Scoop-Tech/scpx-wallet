// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2020 Dominic Morris.

const Keygen = require('eosjs-keygen').Keygen
const _ = require('lodash')

const configWallet = require('../config/wallet')
const walletExternal = require('../actions/wallet-external')

const opsWallet = require('../actions/wallet')

const utilsWallet = require('../utils')

const exchangeActions = require('../actions/exchange')
const { toXsSymbol } = require('../api/xs-changelly')

const log = require('../sw-cli-log')

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
    convert: async (appWorker, store, p) => {
        var { mpk, apk, value, to, from } = p
        const h_mpk = utilsWallet.pbkdf2(apk, mpk)

        // XS - get currency statuses
        await exchangeActions.XS_getCurrencies(store)
        const exchangeState = store.getState().userData.exchange
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

        // validate
        var { err, wallet, asset, du_sendValue } = await utilsWallet.validateSymbolValue(store, from, value)
        if (err) return Promise.resolve({ err })
        var { err } = await utilsWallet.validateSymbolValue(store, to, value)
        if (err) return Promise.resolve({ err })
        
        const currencies = exchangeState.currencies
        const xsFrom = currencies.find(p => p.name === toXsSymbol(from))
        const xsTo = currencies.find(p => p.name === toXsSymbol(to))
        if (!xsFrom) return Promise.resolve({ err: `Unsupported XS from symbol "${from}"` })
        if (!xsTo) return Promise.resolve({ err: `Unsupported XS to symbol "${to}"` })
        if (_.eq(xsFrom, xsTo)) return Promise.resolve({ err: `From and to assets must be different` })

        if (!xsFrom.enabled) return Promise.resolve({ err: `XS from asset "${from}" is not currently enabled (maintenance)` })
        if (!xsTo.enabled) return Promise.resolve({ err: `XS to asset "${to}" is not currently enabled (maintenance)` })

        return Promise.resolve({ ok: 'WIP...' })
    }
}
