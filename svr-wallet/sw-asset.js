// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.

const Keygen = require('eosjs-keygen').Keygen
const _ = require('lodash')

const configWallet = require('../config/wallet')
const walletExternal = require('../actions/wallet-external')
const utilsWallet = require('../utils')

const opsWallet = require('../actions/wallet')

const log = require('../cli-log')

//
// transaction-related wallet functions
//

module.exports = {

    // gets suggested network fees from oracles
    getNetworkFees: async (appWorker, store, p) => {
        const { s } = p

        // validate
        const wallet = store.getState().wallet
        if (utilsWallet.isParamEmpty(s)) return Promise.resolve({ err: `Asset symbol is required` })
        const asset = wallet.assets.find(p => p.symbol.toLowerCase() === s.toLowerCase())
        if (!asset) Promise.resolve({ err: `Invalid asset symbol "${s}"` })

        const feeData = await opsWallet.getAssetFeeData(asset)

        return Promise.resolve({ ok: { feeData } })
    }
}
