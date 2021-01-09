// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2021 Dominic Morris.

const bitcoinJsLib = require('bitcoinjs-lib')
//const bip68 = require('bip68')
const bip65 = require('bip65')
const _ = require('lodash')

const walletShared = require('./wallet-shared')
const utilsWallet = require('../utils')
const { syslog } = require('winston/lib/winston/config')

const DSIGCTLV_ID_v1 = "PROTECT_OP:CLTV:v1.0" //Buffer.from('PROTECT_OP:CLTV:v1.0', 'utf8')

module.exports = {

    scan_NonStdOutputs: (params) => {
        const { asset, store } = params
        if (!asset) throw 'asset is required'
        if (!store) throw 'store is required'

        const ownStdAddresses = asset.addresses.filter(p => !p.accountNonStd).map(p => { return p.addr })
        utilsWallet.log(`scan_NonStdOutputs, asset=`, asset)

        // scan tx's, look for ones that conform to our v1 PROTECT_OP -- i.e. 4 outputs:
        //
        //   * vout=0 p2sh non-standard (P2SH(DSIG/CLTV)) output
        //   * vout=1 op_return (versioning)
        //   * vout=2 p2sh zero output (beneficiary) - ID by: zero-value
        //   * vout=3 p2sh change output (benefactor) - ID by: matching one of our own addresses
        //
        // then, harvest the p2sh-addr and add it to our nonStd addr's list... (wallet-shared.addNonStdAddress_DsigCltv...)
        asset.addresses.filter(p => !p.accountNonStd).forEach(a => { 
            a.txs.forEach(async tx => { // DMS: todo - change mempool_process_BB_UtxoTx() to pass UTXO data into local_tx structs; can then include/combine pending tx's here, to detect faster
                
                // if already parsed this TX and determined that it is a protect_op, skip it
                if (tx.p_op_addrNonStd !== undefined) { 
                    utilsWallet.log(`scan_NonStdOutputs already defined tx.p_op_addrNonStd txid=${tx.txid}, nop.`, tx.utxo_vout)
                    return
                }
                
                if (!tx.utxo_vout) return
                if (tx.utxo_vout.length != 4) return    // required anatomy...
                if (tx.utxo_vout[0].value == 0) return  // protected output (dsigCltv)
                if (tx.utxo_vout[1].value != 0) return  // op_return output (versioning)
                if (tx.utxo_vout[2].value != 0) return  // beneficiary zero-value output (identification)
              //if (tx.utxo_vout[3].value == 0) return  // benefactor change output (change) -- allow zero change

                if (!tx.utxo_vout.every(utxo => utxo.scriptPubKey !== undefined // sanity checks
                     && utxo.scriptPubKey.addresses !== undefined 
                     && utxo.scriptPubKey.addresses.length == 1)) return 

                var txProtectOpDateTime = undefined
                tx.utxo_vout.forEach(utxo => { // look for our protect_op version id in an op_return output at index vout=1 
                    if (utxo && utxo.scriptPubKey && utxo.scriptPubKey.hex && utxo.scriptPubKey.hex.length > 2 && utxo.n == 1) {
                        const firstOp = parseInt('0x' + utxo.scriptPubKey.hex.substring(0,2))
                        if (firstOp == bitcoinJsLib.script.OPS.OP_RETURN) {
                            const asm = bitcoinJsLib.script.decompile(Buffer.from(utxo.scriptPubKey.hex, 'hex'))
                            if (asm && asm.length == 2) {
                                const data = asm[1].toString()
                                //if (Buffer.compare(data, DSIGCTLV_ID_v1) == 0) {
                                //if (data.compare(DSIGCTLV_ID_v1, 0, DSIGCTLV_ID_v1.length, 0) == 0) {
                                if (data.startsWith(DSIGCTLV_ID_v1)) {
                                    console.log('OP_RETURN data=', data)
                                    const ss = data.split('|')
                                    console.log('ss', ss)
                                    if (ss && ss.length == 2 && isNumeric(ss[1])) {
                                        txProtectOpDateTime = new Date(Number(ss[1]) * 1000)
                                    }
                                }
                            }   
                            //console.log(`tx=${tx.txid}, asm=`, asm)
                        }
                    }
                })

                if (txProtectOpDateTime) {
                    utilsWallet.log(`scan_NonStdOutputs found: txid=${tx.txid} - txProtectOpDateTime=${txProtectOpDateTime} tx.utxo_vout=`, tx.utxo_vout)

                    // DMS - todo(?) - need to push these state changes through a reducer, and persist them?
                    Object.defineProperty(tx, 'p_op_addrNonStd', { get: () => { return tx.utxo_vout[0].scriptPubKey.addresses[0] }})
                    Object.defineProperty(tx, 'p_op_addrBeneficiary', {  get: () => { return tx.utxo_vout[2].scriptPubKey.addresses[0] }})
                    Object.defineProperty(tx, 'p_op_addrBenefactor', { get: () => { return tx.utxo_vout[3].scriptPubKey.addresses[0] }})
                    Object.defineProperty(tx, 'p_op_valueProtected', { get: () => { return tx.utxo_vout[0].value }})

                    // how are we - benefactor or beneficiary
                    Object.defineProperty(tx, 'p_op_weAreBeneficiary', { get: () => { return ownStdAddresses.some(p => p == tx.p_op_addrBeneficiary) }})
                    Object.defineProperty(tx, 'p_op_weAreBenefactor', { get: () => { return ownStdAddresses.some(p => p == tx.p_op_addrBenefactor) }})

                    // grab the locktime out of the op_return
                    Object.defineProperty(tx, 'p_op_unlockDateTime', { get: () => { return txProtectOpDateTime }})
                    
                    utilsWallet.log(`p_op_valueProtected=${tx.p_op_valueProtected}`)
                    utilsWallet.log(`p_op_addrNonStd=${tx.p_op_addrNonStd}`)
                    utilsWallet.log(`p_op_addrBeneficiary=${tx.p_op_addrBeneficiary}`)
                    utilsWallet.log(`p_op_addrBenefactor=${tx.p_op_addrBenefactor}`)
                    utilsWallet.log(`p_op_weAreBeneficiary=${tx.p_op_weAreBeneficiary}`)
                    utilsWallet.log(`p_op_weAreBenefactor=${tx.p_op_weAreBenefactor}`)
                    utilsWallet.log(`p_op_unlockDateTime=${tx.p_op_unlockDateTime}`)
                    utilsWallet.log(`p_op_unlockDateTime.toLocaleString()=`, tx.p_op_unlockDateTime.toLocaleString()) // show on history...

                    // add the non-standard output address to the wallet
                    await walletShared.addNonStdAddress_DsigCltv({
                     dsigCltvP2shAddr: tx.p_op_addrNonStd,
                                store,
                      userAccountName: utilsWallet.getStorageContext().owner,
                      eosActiveWallet: undefined,
                            assetName: asset.name,
                                  apk: utilsWallet.getStorageContext().apk,
                              e_email: utilsWallet.getStorageContext().e_email,
                                h_mpk: utilsWallet.getHashedMpk(), //document.hjs_mpk || utils.getBrowserStorage().PATCH_H_MPK //#READ
                    })
                }

                //const hasOpReturn = tx.utxo_vout.filter(p => p.scriptPubKey.type)
                //if (
                //tx.utxo_vout.forEach(vout => {})
            })
        })
    },

    createTxHex_BTC_P2SH: (params) => {
        const { asset, validationMode, addrPrivKeys, txSkeleton, dsigCltvSpenderPubKey } = params
        const opsWallet = require('./wallet')
        const network = opsWallet.getUtxoNetwork(asset.symbol)
        var tx, hex, vSize, byteLength  
    
        const pstx = new bitcoinJsLib.Psbt({ network })
        pstx.setVersion(2)
        console.log(`createTxHex_BTC_P2SH (dsigCltvSpenderPubKey=${dsigCltvSpenderPubKey})`)

        // add the outputs
        txSkeleton.outputs.forEach(output => {
            if (output.change == false && dsigCltvSpenderPubKey !== undefined) { // non-standard output
                console.log(`pstx/addOutput PROTECT_OP [P2SH(DSIG/CLTV)] (dsigCltvSpenderPubKey=${dsigCltvSpenderPubKey})`, output)
                
                //const sequence = bip68.encode({ blocks: 10 }) // 10 blocks from now
                const lockTime = bip65.encode({ utc: (Math.floor(Date.now() / 1000)) + (3600 * 24 * 1) }); // 1 hr from now
                console.log('lockTime', new Date(lockTime).toString())

                const cltvSpender = bitcoinJsLib.ECPair.fromPublicKey(Buffer.from(dsigCltvSpenderPubKey, 'hex'))

                var wif = addrPrivKeys.find(p => { return p.addr === output.address }).privKey
                const nonCltvSpender = bitcoinJsLib.ECPair.fromWIF(wif, network)
                utilsWallet.softNuke(keyPair)
                utilsWallet.softNuke(wif)
    
                function dsigCltv(spenderWithCltv, spenderWithoutCltv, lockTime) {
                    return bitcoinJsLib.script.fromASM(
                      `
                      OP_IF
                          ${bitcoinJsLib.script.number.encode(lockTime).toString('hex')}
                          OP_CHECKLOCKTIMEVERIFY
                          OP_DROP
                      OP_ELSE
                          ${spenderWithoutCltv.publicKey.toString('hex')}
                          OP_CHECKSIGVERIFY
                      OP_ENDIF
                      ${spenderWithCltv.publicKey.toString('hex')}
                      OP_CHECKSIG
                    `.trim().replace(/\s+/g, ' ')
                )}

                // P2SH(P2WSH(MSIG/CLTV))
                const p2wsh = bitcoinJsLib.payments.p2wsh({ redeem: { output: dsigCltv(cltvSpender, nonCltvSpender, lockTime), network }, network })
                const p2sh = bitcoinJsLib.payments.p2sh({ redeem: p2wsh, network: network })
                //or, seems also can do unwrapped p2sh (???) i.e. 
                //     ...const p2sh = bitcoinJsLib.payments.p2sh({redeem: { output: dsigCltv(spenderWithCltv, spenderWithoutCltv, sequence), network }, network: network })
                
                pstx.addOutput({
                    script: p2sh.output,
                    value: Number(Number(output.value).toFixed(0))
                })

                // embed data
                const data = Buffer.from(`${DSIGCTLV_ID_v1}|${lockTime}`, 'utf8') //DSIGCTLV_ID_v1 
                console.log(`OP_RETURN data.length=`, data.length) // max 80 bytes (node defaults; not consensus rule)
                const embed = bitcoinJsLib.payments.embed({data: [data]})
                pstx.addOutput({script: embed.output, value: 0, })

                // & reference the beneficiary address (so it can retrieve this TX and parse the embedded data)
                const ctlvSpenderP2sh = bitcoinJsLib.payments.p2sh({ redeem: bitcoinJsLib.payments.p2wpkh({ pubkey: Buffer.from(dsigCltvSpenderPubKey, 'hex'), network }), network })
                pstx.addOutput({ address: ctlvSpenderP2sh.address, value: Number(Number(0).toFixed(0)) })
            }
            else { // standard NP2WPKH
                console.log(`pstx/addOutput [P2SH(P2WPKH)]`, output)
                pstx.addOutput({ 
                    address: output.address, 
                    value: Number(Number(output.value).toFixed(0))
                })
            }
        })

        // add the inputs
        for (var i = 0; i < txSkeleton.inputs.length; i++) {
            const input = txSkeleton.inputs[i]
            //console.log(`pstx/addInput - input[${i}]`, input)

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
        //console.log('pstx/setup', pstx)

        // sign
        for (var i = 0; i < txSkeleton.inputs.length; i++) {
            const input = txSkeleton.inputs[i]
            //console.log(`pstx/sign - input[${i}]`, input)

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
        //console.log('pstx/signed', pstx)

        // validation mode - compute base vSize for skeleton tx (with fixed two outputs)
        const inc_tx = pstx.extractTransaction(true)
        const inc_vs = inc_tx.virtualSize()
        const inc_bl = inc_tx.byteLength()
        //utilsWallet.log('inc_tx.virtualSize=', inc_vs)
        //utilsWallet.log('inc_tx.byteLength=', inc_bl)
        vSize = inc_vs // tx is fully complete & signed; these are final values
        byteLength = inc_bl
        tx = inc_tx
        //console.log('pstx/inc_tx', inc_tx)
        console.log('pstx/inc_tx.toHex()', inc_tx.toHex())

        if (!validationMode) { // exec mode
            hex = inc_tx.toHex()
            utilsWallet.log(`*** createTxHex (wallet-external UTXO bitcoin-js P2SH) ${asset.symbol}, hex.length, hex=`, hex.length, hex)
        }

        return { tx, hex, vSize, byteLength }
    },
}

function isNumeric(n) {
    return !isNaN(parseFloat(n)) && isFinite(n);
}