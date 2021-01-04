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

    createTxHex_BTC_P2SH: (params) => {
        const { asset, validationMode, addrPrivKeys, txSkeleton } = params
        const opsWallet = require('./wallet')
        const network = opsWallet.getUtxoNetwork(asset.symbol)
        var tx, hex, vSize, byteLength  
    
        const pstx = new bitcoinJsLib.Psbt({ network })
        pstx.setVersion(2)

        // add the outputs
        txSkeleton.outputs.forEach(output => { // TODO: seeing duplicate zero-value output here...
            utilsWallet.log(`pstx.addOutput`, output)
            pstx.addOutput({ 
                address: output.address, 
                value: Number(Number(output.value).toFixed(0))
            })
        })

        // add the inputs
        for (var i = 0; i < txSkeleton.inputs.length; i++) {
            const input = txSkeleton.inputs[i]
            console.log(`pstx/addInput - input[${i}]`, input)

            if (input.utxo.scriptPubKey.type !== 'scripthash') throw 'Unexpected (non-P2SH) UTXO'

            var wif = addrPrivKeys.find(p => { return p.addr === input.utxo.address }).privKey
            var keyPair = bitcoinJsLib.ECPair.fromWIF(wif, network)
            const p2wpkh = bitcoinJsLib.payments.p2wpkh({pubkey: keyPair.publicKey, network}) 
            const p2sh = bitcoinJsLib.payments.p2sh({redeem: p2wpkh, network}) 
            const redeemScript = p2sh.redeem.output.toString('hex')
            //console.log(''redeemScript, redeemScript)

            pstx.addInput({ 
                hash: input.utxo.txid, 
                index: input.utxo.vout,
                sequence: 0xfffffffe, // ????

                witnessUtxo: { // only for P2SH(P2WPKH) -- according to junderw witnessUtxo wouldn't be used for a P2SH() wrapping something other than a P2WPKH 
                    // scriptPubKey (locking script) of prevout: 
                    script: Buffer.from(input.utxo.scriptPubKey.hex, 'hex'), // e.g. OP_HASH160 f828d2054506c46bc81fcfd5cd1d410b8b408b2e OP_EQUAL

                    // amount of satoshis in the prevout:
                    value: input.utxo.satoshis
                },     
                
                // P2SH redeem output (redeemScript)
                redeemScript: Buffer.from(redeemScript, 'hex')

                // witnessScript: input.witnessScript // = p2wsh redeem output 
                // nonWitnessUtxo: Buffer.from(input.utxo.scriptPubKey.hex, 'hex')
            })

            utilsWallet.softNuke(keyPair)
            utilsWallet.softNuke(wif)
        }
        console.log('pstx/setup', pstx)

        // sign (todo? move validation path to use legacy txBuilder (for faster compute of virtualSize() & byteLength() without signing))
        for (var i = 0; i < txSkeleton.inputs.length; i++) {
            const input = txSkeleton.inputs[i]
            console.log(`pstx/sign - input[${i}]`, input)

            //if (!input.redeemScript && !input.witnessScript) { //  i.e. if it's a "regular" input (not protected) 
                var wif = addrPrivKeys.find(p => { return p.addr === input.utxo.address }).privKey
                var keyPair = bitcoinJsLib.ECPair.fromWIF(wif, network)

                pstx.signInput(i, keyPair)
                pstx.validateSignaturesOfInput(i)
                pstx.finalizeInput(i)

                utilsWallet.softNuke(keyPair)
                utilsWallet.softNuke(wif)
            //}
            //else { // i.e. if input.redeemScript || intput.witnessScript...
            //     psbt.finalizeInput(
            //          i, 
            //          getFinalScripts({    ==> ...csvGetFinalScripts() in csv.spec.ts example...
            //              inputScript: input.inputScript, 
            //              network 
            //     })
            //}
        }
        console.log('pstx/signed', pstx)

        // validation mode - compute base vSize for skeleton tx (with fixed two outputs)
        const inc_tx = pstx.extractTransaction()
        const inc_vs = inc_tx.virtualSize()
        const inc_bl = inc_tx.byteLength()
        utilsWallet.log('inc_tx.virtualSize=', inc_vs)
        utilsWallet.log('inc_tx.byteLength=', inc_bl)
        vSize = inc_vs // tx is fully complete & signed; these are final values
        byteLength = inc_bl
        tx = inc_tx
        console.log('pstx/inc_tx', inc_tx)
        console.log('pstx/inc_tx.toHex()', inc_tx.toHex())

        if (!validationMode) { // exec mode
            hex = inc_tx.toHex()
            utilsWallet.log(`*** createTxHex (wallet-external UTXO bitcoin-js P2SH) ${asset.symbol}, hex.length, hex=`, hex.length, hex)
        }

        return { tx, hex, vSize, byteLength }
    },
}
