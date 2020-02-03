// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2020 Dominic Morris.

const Keygen = require('eosjs-keygen').Keygen
const _ = require('lodash')

const configWallet = require('../config/wallet')
const walletExternal = require('../actions/wallet-external')

const opsWallet = require('../actions/wallet')

const utilsWallet = require('../utils')

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

        // validate
        var { err, wallet, asset, du_sendValue } = await utilsWallet.validateSymbolValue(store, from, value)
        if (err) return Promise.resolve({ err })
        var { err } = await utilsWallet.validateSymbolValue(store, to, value)
        if (err) return Promise.resolve({ err })

        return Promise.resolve({ ok: 'WIP...' })
    }
}
