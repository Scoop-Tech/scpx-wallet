// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2021 Dominic Morris.

const bitcoinJsLib = require('bitcoinjs-lib')
//        "@bitgo/utxo-lib": "^2.4.1",
//const bitgoUtxoLib = require('@bitgo/utxo-lib') //require('bitgo-utxo-lib') // -26: 16: old-consensus-branch-id (Expected c2d6d0b4, found e9ff75a6)
const bitgoUtxoLib = require('bitgo-utxo-lib') 

const bchAddr = require('bchaddrjs')
const BigNumber = require('bignumber.js')
const _ = require('lodash')

const actionsWallet = require('.')
const walletUtxo = require('./wallet-utxo')
const walletAccount = require('./wallet-account')

const configWallet = require('../config/wallet')
const configExternal = require('../config/wallet-external')

const utilsWallet = require('../utils')

module.exports = {

    createTxHex_Alts_P2PKH: (params) => {
        const { asset, validationMode, skipSigningOnValidation, addrPrivKeys, txSkeleton } = params
        const opsWallet = require('./wallet')
        const network = opsWallet.getUtxoNetwork(asset.symbol)
        var tx, hex, vSize, byteLength  

        if (asset.symbol === 'ZEC' || asset.symbol === 'ZEC_TEST') {
            //network.consensusBranchId["4"] = 4122551051 // 0xf5b9230b -- Heartwood -- https://github.com/BitGo/bitgo-utxo-lib/releases/tag/1.7.1
            //network.consensusBranchId["4"] = 3925833126 // 0xe9ff75a6 -- Canopy
            network.consensusBranchId["4"] = 0xc2d6d0b4 // NU5
        }
        utilsWallet.log(`createTxHex - network`, network)

        const txb = new bitgoUtxoLib.TransactionBuilder(network)
        if (asset.symbol === 'ZEC' || asset.symbol === 'ZEC_TEST') {
            txb.setVersion(bitgoUtxoLib.Transaction.ZCASH_SAPLING_VERSION) // sapling/blossom: v4
            txb.setVersionGroupId(0x892F2085) // sapling/blossom || NU5 w/ v4 TX
            txb.setExpiryHeight(0) // if non-zero, will be removed from mempool at this block height, if not yet mined
        }
        
        // add the outputs
        txSkeleton.outputs.forEach(output => {
            //utilsWallet.log(output)

            var outputAddress = output.address

            // bcash - remove prefix from cash addr from inputs and outputs, and convert to legacy 1 addr's
            if (asset.symbol === 'BCHABC') {
                if (outputAddress.startsWith("bitcoincash:")) {
                    outputAddress = bchAddr.toLegacyAddress(outputAddress.substring("bitcoincash:".length)) 
                }
                if (outputAddress.startsWith("q") || outputAddress.startsWith("C")) { // q or C - bch cash-addr or bch "bitpay" addr
                    outputAddress = bchAddr.toLegacyAddress(outputAddress)
                }
            }

            txb.addOutput(outputAddress, Number(Number(output.value).toFixed(0)))
        })
        
        // run faster when in validation mode (not sending for real) - skip signing, return incomplete tx and estimate final vsize
        const inc_tx = txb.buildIncomplete()
        const inc_vs = inc_tx.virtualSize()
        const inc_bl = inc_tx.byteLength()
        //utilsWallet.debug('inc_tx.virtualSize=', inc_vs)
        //utilsWallet.debug('inc_tx.byteLength=', inc_bl)
        if (validationMode && skipSigningOnValidation) { // validation mode
            vSize = inc_vs + (asset.tx_perInput_vsize * txSkeleton.inputs.length) 
            byteLength = inc_bl + (asset.tx_perInput_byteLength * txSkeleton.inputs.length)
            tx = inc_tx
        }
        else { // exec mode

            // add the inputs
            for (var i = 0; i < txSkeleton.inputs.length; i++) {
                utilsWallet.log(`${asset.symbol} TX input #${i} UTXO txid ${txSkeleton.inputs[i].utxo.txid} - input=`, txSkeleton.inputs[i])
                txb.addInput(txSkeleton.inputs[i].utxo.txid, txSkeleton.inputs[i].utxo.vout)
            }

            // sign the inputs
            for (var i = 0; i < txSkeleton.inputs.length; i++) {
                var wif = addrPrivKeys.find(p => { return p.addr === txSkeleton.inputs[i].utxo.address }).privKey
                var keyPair = bitgoUtxoLib.ECPair.fromWIF(wif, network)
                if (asset.symbol === 'ZEC' || asset.symbol === 'ZEC_TEST') {
                    txb.sign(i, keyPair, '', bitgoUtxoLib.Transaction.SIGHASH_SINGLE, txSkeleton.inputs[i].utxo.satoshis) // zec requires more data to sign
                }
                else if (asset.symbol === 'BCHABC') {
                    txb.sign(i,
                        keyPair, '',
                        bitgoUtxoLib.Transaction.SIGHASH_ALL | bitgoUtxoLib.Transaction.SIGHASH_BITCOINCASHBIP143,
                        txSkeleton.inputs[i].utxo.satoshis) 
                }
                else { 
                    txb.sign(i, keyPair)
                }
                
                utilsWallet.softNuke(keyPair)
                utilsWallet.softNuke(wif)
            }

            // complete tx
            tx = txb.build()
            const tx_vs = tx.virtualSize()
            vSize = tx_vs
            const tx_bl = tx.byteLength()
            byteLength = tx_bl

            // dbg - estimated final virtualSize & byteLen vs actual
            const delta_vs = tx_vs - inc_vs
            const delta_vs_perInput = delta_vs / txSkeleton.inputs.length
            const delta_bl = tx_bl - inc_bl
            const delta_bl_perInput = delta_bl / txSkeleton.inputs.length
            //utilsWallet.debug('tx.virtualSize=', tx_vs)
            //utilsWallet.debug('tx.byteLength=', tx_bl) 
            //utilsWallet.debug('dbg: delta_vs=', delta_vs)
            //utilsWallet.debug('dbg: delta_vs_perInput=', delta_vs_perInput) 
            //utilsWallet.debug('dbg: delta_bl=', delta_bl)
            //utilsWallet.debug('dbg: delta_bl_perInput=', delta_bl_perInput)

            if (!validationMode) { // exec mode
                hex = tx.toHex()
                utilsWallet.log(`*** createTxHex (wallet-external UTXO bitgo-utxo P2PKH) ${asset.symbol}, hex.length, hex=`, hex.length, hex)
            }
        }

        return { tx, hex, vSize, byteLength }
    }
}
