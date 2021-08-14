// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2021 Dominic Morris.

const Keygen = require('eosjs-keygen').Keygen
const bitcoinJsLib = require('bitcoinjs-lib')
const BigNumber = require('bignumber.js')
const _ = require('lodash')

const configWallet = require('../config/wallet')
const walletExternal = require('../actions/wallet-external')

const opsWallet = require('../actions/wallet')
const opsWalletClaimable = require('../actions/wallet-claimable')

const utilsWallet = require('../utils')

const log = require('../sw-cli-log')

//
// PROTECT_OP (P2SH(DSIG/CLTV)) aka "claimable" wallet functions
//

module.exports = {

    claimableList: async (appWorker, store, p) => {
        var { mpk, apk, symbol } = p
        log.cmd('claimableList')
        log.param('symbol', symbol)

        if (utilsWallet.isParamEmpty(symbol)) return Promise.resolve({ err: `Asset symbol is required` })
        //if (symbol.toUpperCase() !== 'BTC_TEST') return Promise.resolve({ err: `Invalid p_op for ${symbol.toUpperCase()}` })
        const wallet = store.getState().wallet
        const asset = wallet.assets.find(p => p.symbol.toLowerCase() === symbol.toLowerCase())

        return new Promise((resolve) => {
            const claimable = opsWalletClaimable.claimable_List({ asset })
            resolve({ ok: { claimable } })
        })
    },

    claimableClaim: async (appWorker, store, p) => {
        var { mpk, apk, symbol } = p
        const h_mpk = utilsWallet.pbkdf2(apk, mpk)
        log.cmd('claimableSpend')
        log.param('mpk', process.env.NODE_ENV === 'test' ? '[secure]' : mpk)
        log.param('symbol', symbol)

        if (utilsWallet.isParamEmpty(symbol)) return Promise.resolve({ err: `Asset symbol is required` })
        if (symbol.toUpperCase() !== 'BTC_TEST') return Promise.resolve({ err: `Invalid p_op for ${symbol.toUpperCase()}` })
        const wallet = store.getState().wallet
        const asset = wallet.assets.find(p => p.symbol.toLowerCase() === symbol.toLowerCase())

        return new Promise((resolve) => {

            resolve({ ok: { txid: 'TODO_multi_spend_txs...', } })
        })
    },

}
