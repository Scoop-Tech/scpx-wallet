// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2023 Dominic Morris.

const Keygen = require('eosjs-keygen').Keygen
const bitcoinJsLib = require('bitcoinjs-lib')
const BigNumber = require('bignumber.js')
const _ = require('lodash')

const tx = require('./sw-tx')

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
        const wallet = store.getState().wallet
        const asset = wallet.assets.find(p => p.symbol.toLowerCase() === symbol.toLowerCase())
        if (!asset.OP_CLTV) return Promise.resolve({ err: `Invalid p_op for ${symbol.toUpperCase()}` })

        return new Promise((resolve) => {
            const claimable = opsWalletClaimable.claimable_List({ asset })
            resolve({ ok: { claimable } })
        })
    },

    claimableClaim: async (appWorker, store, p) => {
        var { mpk, apk, symbol } = p
        const h_mpk = utilsWallet.pbkdf2(apk, mpk)
        log.cmd('claimableClaim')
        log.param('mpk', configWallet.IS_TEST ? '[secure]' : mpk)
        log.param('symbol', symbol)

        if (utilsWallet.isParamEmpty(symbol)) return Promise.resolve({ err: `Asset symbol is required` })
        const wallet = store.getState().wallet
        const asset = wallet.assets.find(p => p.symbol.toLowerCase() === symbol.toLowerCase())
        if (!asset.OP_CLTV) return Promise.resolve({ err: `Invalid p_op for ${symbol.toUpperCase()}` })

        return new Promise(async (resolve) => {

            const claimable = opsWalletClaimable.claimable_List({ asset })
            const weAreBenefactor = claimable.filter(p => p.protect_op_tx.p_op_weAreBenefactor == true)
            const weAreBenificiary = claimable.filter(p => p.protect_op_tx.p_op_weAreBeneficiary == true)
            const claimableUtxos = claimable.filter(p => p.utxos.length > 0 && p.utxos[0].satoshis > 0).map(p => p.utxos[0])
            var txFee = {}, txPush = {}
            if (claimableUtxos.length > 0) {

                const spendFullUtxos = claimable.map(p => `${p.protect_op_tx.txid}:${p.utxos[0].vout}`).join(',')
                const cu_sumValue = claimable.map(p => new BigNumber(p.utxos[0].satoshis)).reduce((a,b) => a.plus(b), new BigNumber(0))
                const du_sumValue = utilsWallet.toDisplayUnit(cu_sumValue, asset)
                log.info('du_sumValue', du_sumValue)

                // // get fee - just for interest, we don't use it
                // txFee = await tx.txGetFee(appWorker, store, { mpk, apk,
                //           symbol: symbol,
                //            value: du_sumValue,
                //   spendFullUtxos,
                // })
                // const cu_sumValueLessFee = cu_sumValue.minus(utilsWallet.toCalculationUnit(txFee.ok.txFee.fee, asset))
                // const du_sumValueLessFee = utilsWallet.toDisplayUnit(cu_sumValueLessFee, asset)

                // push tx - when specifying specific UTXOs, tx.Push will deduct the fee for us
                txPush = await tx.txPush(appWorker, store, { mpk, apk,
                          symbol: symbol,
                           value: du_sumValue,
                              to: asset.addresses[0].addr, 
                  spendFullUtxos,
                })
            }

            resolve({ ok: { txPush } })
        })
    },

    
    claimableReset: async (appWorker, store, p) => {
        var { mpk, apk, symbol } = p
        const h_mpk = utilsWallet.pbkdf2(apk, mpk)
        log.cmd('claimableReset')
        log.param('mpk', configWallet.IS_TEST ? '[secure]' : mpk)
        log.param('symbol', symbol)

        if (utilsWallet.isParamEmpty(symbol)) return Promise.resolve({ err: `Asset symbol is required` })
        const wallet = store.getState().wallet
        const asset = wallet.assets.find(p => p.symbol.toLowerCase() === symbol.toLowerCase())
        if (!asset.OP_CLTV) return Promise.resolve({ err: `Invalid p_op for ${symbol.toUpperCase()}` })

        return new Promise(async (resolve) => {
            const claimable = opsWalletClaimable.claimable_List({ asset })
            const resetable = claimable.filter(p => p.protect_op_tx.p_op_weAreBenefactor == true)

            resetable.forEach(resetUtxo => {
                log.info('(TODO) ...resetUtxo', resetUtxo)
            })
            
            resolve({ ok: { resetable } })
        })
    },

}
