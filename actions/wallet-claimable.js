// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2023 Dominic Morris.

const bitcoinJsLib = require('bitcoinjs-lib')
const bitgoUtxoLib = require('bitgo-utxo-lib')
const bchAddr = require('bchaddrjs')
const BigNumber = require('bignumber.js')
const _ = require('lodash')

const actionsWallet = require('.')
const walletExternal = require('./wallet-external')

const configWallet = require('../config/wallet')
const configExternal = require('../config/wallet-external')

const utilsWallet = require('../utils')



module.exports = {

    //
    // lists all claimable p_op tx's (tx.p_op_weAreBenefactor || (tx.p_op_weAreBeneficiary && date.now > tx.p_op_lockTime))
    //
    claimable_List: (p) => {
        const { asset } = p
        if (!asset) throw 'Invalid or missing asset'
        if (!asset.OP_CLTV) throw `Invalid p_op for ${asset.symbol}`

        const all_txs = walletExternal.getAll_txs(asset)
        const p_addrs = asset.addresses
            .filter(a => a.path.startsWith('~p/'))
            .filter(a => a.utxos !== undefined && a.utxos.length > 0)
            .filter(a => { 
                const protect_op_tx = all_txs.find(p2 => p2.txid == a.nonStd_protectOp_txid)
                return (protect_op_tx.p_op_weAreBenefactor
                    || (protect_op_tx.p_op_weAreBeneficiary && new Date() > protect_op_tx.p_op_unlockDateTime))
            })
            .map(a => { 
                const protect_op_tx = all_txs.find(p => p.txid == a.nonStd_protectOp_txid)
                return Object.assign(a, { protect_op_tx })
            })
        return p_addrs
    },

    //
    // spends ("reclaims" if we are benefactor, or "claim" if we are beneficiary) a specific p_op txid output
    //  (or, spends all claimable p_op tx's if no txid supplied)
    //
    // (all claims output to the first standard address, as a standard UTXO)
    //
    claimable_Claim: async (asset) => {
        //...
    },

}