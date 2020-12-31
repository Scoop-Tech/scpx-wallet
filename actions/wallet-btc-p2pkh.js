// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2020 Dominic Morris.

const bitcoinJsLib = require('bitcoinjs-lib')
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

    createTxHex_BTC_P2PKH: (params) => {
        const { asset, validationMode, skipSigningOnValidation, addrPrivKeys, txSkeleton } = params
        const opsWallet = require('./wallet')
        const network = opsWallet.getUtxoNetwork(asset.symbol)
        var tx, hex, vSize, byteLength  

        const txb = new bitcoinJsLib.TransactionBuilder(network)
        txb.setVersion(1)

        // add the outputs
        txSkeleton.outputs.forEach(output => {
            utilsWallet.log(`txb.addOutput`, output)
            txb.addOutput(output.address, Number(Number(output.value).toFixed(0)))
        })

        // validation mode - compute base vSize for skeleton tx (with fixed two outputs)
        const inc_tx = txb.buildIncomplete()
        const inc_vs = inc_tx.virtualSize()
        const inc_bl = inc_tx.byteLength()
        utilsWallet.log('inc_tx.virtualSize=', inc_vs)
        utilsWallet.log('inc_tx.byteLength=', inc_bl)
        if (validationMode && skipSigningOnValidation) { // validation mode
            vSize = inc_vs + (asset.tx_perInput_vsize * txSkeleton.inputs.length) 
            byteLength = inc_bl + (asset.tx_perInput_byteLength * txSkeleton.inputs.length)
            tx = inc_tx
        }
        else { // exec mode
            // add the inputs
            for (var i = 0; i < txSkeleton.inputs.length; i++) {
                utilsWallet.log(`${asset.symbol} UTXO TX - input=`, txSkeleton.inputs[i])

                if (asset.symbol === "BTC_SEG2") { // P2WPKH Bech32
                    // https://github.com/bitcoinjs/bitcoinjs-lib/issues/999
                    var wif = addrPrivKeys.find(p => { return p.addr === txSkeleton.inputs[i].utxo.address }).privKey
                    var keyPair = bitcoinJsLib.ECPair.fromWIF(wif, network)
                    const scriptPubKey = bitcoinJsLib.payments.p2wpkh({ pubkey: keyPair.publicKey }).output
                    txb.addInput(txSkeleton.inputs[i].utxo.txid, txSkeleton.inputs[i].utxo.vout, null, scriptPubKey)
                    utilsWallet.softNuke(keyPair)
                    utilsWallet.softNuke(wif)
                }
                else { // legacy - P2PKH
                    txb.addInput(txSkeleton.inputs[i].utxo.txid, txSkeleton.inputs[i].utxo.vout)
                }
            }

            // sign
            // if (asset.symbol === "BTC_SEG" || asset.symbol === "BTC_TEST") { // P2SH(...)
            //     for (var i = 0; i < txSkeleton.inputs.length; i++) {
            //         var wif = addrPrivKeys.find(p => { return p.addr === txSkeleton.inputs[i].utxo.address }).privKey
            //         var keyPair = bitcoinJsLib.ECPair.fromWIF(wif, network)

            //         const p2wpkh = bitcoinJsLib.payments.p2wpkh({ pubkey: keyPair.publicKey, network })
            //         const p2sh = bitcoinJsLib.payments.p2sh({ redeem: p2wpkh, network })
            //         txb.sign(i, keyPair, p2sh.redeem.output, null, txSkeleton.inputs[i].utxo.satoshis)

            //         utilsWallet.softNuke(keyPair)
            //         utilsWallet.softNuke(wif)
            //     }
            // }
            // else
            if (asset.symbol === "BTC_SEG2") { // P2WPKH Bech32
                for (var i = 0; i < txSkeleton.inputs.length; i++) {
                    var wif = addrPrivKeys.find(p => { return p.addr === txSkeleton.inputs[i].utxo.address }).privKey
                    var keyPair = bitcoinJsLib.ECPair.fromWIF(wif, network)

                    txb.sign(i, keyPair, null, null, txSkeleton.inputs[i].utxo.satoshis)

                    utilsWallet.softNuke(keyPair)
                    utilsWallet.softNuke(wif)
                }
            }
            else { // legacy - P2PKH
                for (var i = 0; i < txSkeleton.inputs.length; i++) {
                    var wif = addrPrivKeys.find(p => { return p.addr === txSkeleton.inputs[i].utxo.address }).privKey
                    var keyPair = bitcoinJsLib.ECPair.fromWIF(wif, network)
                    txb.sign(i, keyPair)
                    utilsWallet.softNuke(keyPair)
                    utilsWallet.softNuke(wif)
                }
            }

            // complete tx
            tx = txb.build()
            const tx_vs = tx.virtualSize()
            vSize = tx_vs
            const tx_bl = tx.byteLength()
            byteLength = tx_bl
            utilsWallet.log('tx.virtualSize=', tx_vs) 
            utilsWallet.log('tx.byteLength=', tx_bl) 

            // dbg - estimated final virtualSize & byteLen vs actual
            const delta_vs = tx_vs - inc_vs
            const delta_vs_perInput = delta_vs / txSkeleton.inputs.length
            utilsWallet.log('dbg: delta_vs=', delta_vs)
            utilsWallet.log('dbg: delta_vs_perInput=', delta_vs_perInput) 
            const delta_bl = tx_bl - inc_bl
            const delta_bl_perInput = delta_bl / txSkeleton.inputs.length
            utilsWallet.log('dbg: delta_bl=', delta_bl)
            utilsWallet.log('dbg: delta_bl_perInput=', delta_bl_perInput)
            
            hex = tx.toHex()
            utilsWallet.log(`*** createTxHex (wallet-external UTXO bitcoin-js P2PKH || P2WPKH) ${asset.symbol}, hex.length, hex=`, hex.length, hex)
        }

        return { tx, hex, vSize, byteLength }
    }

}