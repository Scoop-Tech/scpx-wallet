// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2021 Dominic Morris.

const bitcoinJsLib = require('bitcoinjs-lib')
//const bip68 = require('bip68')
const bip65 = require('bip65')
const _ = require('lodash')

const actionsWallet = require('../actions')
const utilsWallet = require('../utils')
const { syslog } = require('winston/lib/winston/config')

const DSIGCTLV_ID_vCur = Buffer.from( // (max 6 bytes)
    `12100504` + // protect_op ID stamp (4 bytes)
    `ab03`,      // flags/version
'hex') 

function dsigCltv(cltvSpender, nonCltvSpender, lockTime) {
    return bitcoinJsLib.script.fromASM( // ...??
      `
      OP_IF
          ${bitcoinJsLib.script.number.encode(lockTime).toString('hex')}
          OP_CHECKLOCKTIMEVERIFY
          OP_DROP
          ${cltvSpender.publicKey.toString('hex')}
          OP_CHECKSIG
        OP_ELSE
          ${nonCltvSpender.publicKey.toString('hex')}
          OP_CHECKSIG
      OP_ENDIF
    `.trim().replace(/\s+/g, ' ')
)}

module.exports = {

    scan_NonStdOutputs: (params) => {
        const { asset, dispatchActions, nonStdAddrs_Txs } = params
        if (!asset) throw 'asset is required'
        if (!nonStdAddrs_Txs) throw 'nonStdAddrs_Txs is required'
        if (!dispatchActions) throw 'dispatchActions is required'

        const ownStdAddresses = asset.addresses.filter(p => !p.isNonStdAddr).map(p => { return p.addr })
        utilsWallet.log(`scan_NonStdOutputs, asset=`, asset)

        // scan tx's, look for ones that conform to our v1 PROTECT_OP -- i.e. 4 outputs:
        //
        //   * vout=0 p2sh non-standard (P2SH(DSIG/CLTV)) output, unspent
        //   * vout=1 op_return (versioning)
        //   * vout=2 p2sh zero output (beneficiary) - ID by: zero-value
        //   * vout=3 p2sh change output (benefactor) - ID by: matching one of our own addresses
        //
        // then, harvest the p2sh-addr and add it to our nonStd addr's list... (wallet-shared.addNonStdAddress_DsigCltv...)
        asset.addresses.filter(p => !p.isNonStdAddr)
        .forEach(a => { 
            a.txs.forEach(async tx => { // DMS: todo - change mempool_process_BB_UtxoTx() to pass UTXO data into local_tx structs; can then include/combine pending tx's here, to detect faster
                
                // if already parsed this TX and determined that it is a protect_op, skip it
                if (tx.p_op_addrNonStd !== undefined) { 
                    utilsWallet.log(`scan_NonStdOutputs already defined tx.p_op_addrNonStd txid=${tx.txid}, nop.`, tx.utxo_vout)
                    return
                }

                // if (tx.txid === 'dfe0b28deea5d88585868ea3d8de3d89818ba32f549ab776cca9118a7208d405') {
                //     debugger
                // }
                
                // see also: worker-blockbook::enrichTx()...
                if (!tx.utxo_vout) return
                if (tx.utxo_vout.length != 4) return    // required anatomy...
                if (tx.utxo_vout[0].value == 0) return  // protected output (dsigCltv)
                if (tx.utxo_vout[1].value != 0) return  // op_return output (versioning)
                if (tx.utxo_vout[2].value != 0) return  // beneficiary zero-value output (identification)
              //if (tx.utxo_vout[3].value == 0) return  // benefactor change output (change) -- allow zero change

                if (!tx.utxo_vout.every(utxo => utxo.scriptPubKey !== undefined // sanity checks
                     && utxo.scriptPubKey.addresses !== undefined 
                     && utxo.scriptPubKey.addresses.length == 1)) return 

                var txProtectOpTimelock = undefined
                var txProtectOpDateTime = undefined
                var pubKeyBeneficiary = undefined
                var pubKeyBenefactor = undefined
                tx.utxo_vout.forEach(utxo => { // look for our protect_op version id in an op_return output at index vout=1 
                    if (utxo && utxo.scriptPubKey && utxo.scriptPubKey.hex && utxo.scriptPubKey.hex.length > 2 && utxo.n == 1) {
                        const firstOp = parseInt('0x' + utxo.scriptPubKey.hex.substring(0,2))
                        if (firstOp == bitcoinJsLib.script.OPS.OP_RETURN) {
                            const asm = bitcoinJsLib.script.decompile(Buffer.from(utxo.scriptPubKey.hex, 'hex'))
                            if (asm && asm.length == 2 && asm[1].buffer !== undefined) {
                                //const data = asm[1].toString()

                                const { buf_idVer, buf_pubKeyA, buf_pubKeyB, lockTime } = disassembleDsigCsvOpReturnBuffer(Buffer.from(asm[1]))
                                if (buf_idVer) {
                                    // console.log('buf_idVer', buf_idVer.toString('hex'))
                                    // console.log('DSIGCTLV_ID_vCur', DSIGCTLV_ID_vCur.toString('hex'))
                                    // console.log('Buffer.compare(buf_idVer, DSIGCTLV_ID_vCur)', Buffer.compare(buf_idVer, DSIGCTLV_ID_vCur))
                                    // console.log('buf_pubKeyA', buf_pubKeyA.toString('hex'))
                                    // console.log('buf_pubKeyB', buf_pubKeyB.toString('hex'))
                                    // console.log('lockTime', lockTime)
                                    if (Buffer.compare(buf_idVer, DSIGCTLV_ID_vCur) == 0) {
                                        txProtectOpTimelock = lockTime
                                        txProtectOpDateTime = new Date(Number(lockTime) * 1000)
                                        pubKeyBeneficiary = buf_pubKeyA
                                        pubKeyBenefactor = buf_pubKeyB
                                        //console.log('txProtectOpDateTime=', txProtectOpDateTime)
                                    }
                                }
                            }   
                            //console.log(`tx=${tx.txid}, asm=`, asm)
                        }
                    }
                })

                if (txProtectOpDateTime) {
                    utilsWallet.log(`scan_NonStdOutputs found: txid=${tx.txid} - txProtectOpDateTime=${txProtectOpDateTime} tx.utxo_vout=`, tx.utxo_vout)

                    const _tx = _.cloneDeep(tx)
                    _tx.p_op_addrNonStd = tx.utxo_vout[0].scriptPubKey.addresses[0]
                    _tx.p_op_addrBeneficiary = tx.utxo_vout[2].scriptPubKey.addresses[0]
                    _tx.p_op_addrBenefactor = tx.utxo_vout[3].scriptPubKey.addresses[0]
                    _tx.p_op_valueProtected = tx.utxo_vout[0].value
                    _tx.p_op_weAreBeneficiary = ownStdAddresses.some(p => p == _tx.p_op_addrBeneficiary)
                    _tx.p_op_weAreBenefactor = ownStdAddresses.some(p => p == _tx.p_op_addrBenefactor)
                    _tx.p_op_lockTime = txProtectOpTimelock
                    _tx.p_op_unlockDateTime = txProtectOpDateTime
                    _tx.p_op_pubKeyBeneficiary = pubKeyBeneficiary.toString('hex')
                    _tx.p_op_pubKeyBenefactor = pubKeyBenefactor.toString('hex')

                    const dispatchAction = {
                        type: actionsWallet.WCORE_SET_ENRICHED_TXS,
                     payload: { updateAt: new Date(), 
                                  symbol: asset.symbol,
                                    addr: a.addr,
                                     txs: [_tx],
                                     res: undefined }
                    }
                    dispatchActions.push(dispatchAction)

                    utilsWallet.log(`p_op_valueProtected=${_tx.p_op_valueProtected}`)
                    utilsWallet.log(`p_op_addrNonStd=${_tx.p_op_addrNonStd}`)
                    utilsWallet.log(`p_op_addrBeneficiary=${_tx.p_op_addrBeneficiary}`) // show on history...
                    utilsWallet.log(`p_op_addrBenefactor=${_tx.p_op_addrBenefactor}`) // show on history...
                    utilsWallet.log(`p_op_weAreBeneficiary=${_tx.p_op_weAreBeneficiary}`)
                    utilsWallet.log(`p_op_weAreBenefactor=${_tx.p_op_weAreBenefactor}`)
                    utilsWallet.log(`p_op_unlockDateTime=${_tx.p_op_unlockDateTime}`)
                    utilsWallet.log(`p_op_unlockDateTime.toLocaleString()=`, _tx.p_op_unlockDateTime.toLocaleString()) // show on history...
                    utilsWallet.log(`p_op_pubKeyBeneficiary=${_tx.p_op_pubKeyBeneficiary}`)
                    utilsWallet.log(`p_op_pubKeyBenefactor=${_tx.p_op_pubKeyBenefactor}`)

                    //if (!nonStdAddrs_Txs.includes(_tx.p_op_addrNonStd)) {
                    if (!nonStdAddrs_Txs.some(p => p.protect_op_txid == tx.txid)) {
                        nonStdAddrs_Txs.push({ nonStdAddr: _tx.p_op_addrNonStd, protect_op_txid: tx.txid})
                    }
                }
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

        //
        // add the outputs
        //
        txSkeleton.outputs.forEach(output => {
            if (output.change == false && dsigCltvSpenderPubKey !== undefined) { // non-standard output
                console.log(`pstx/addOutput PROTECT_OP [P2SH(DSIG/CLTV)] (dsigCltvSpenderPubKey=${dsigCltvSpenderPubKey})`, output)
                
                //const sequence = bip68.encode({ blocks: 10 }) // 10 blocks from now
                const lockTime = bip65.encode({ utc: (Math.floor(Date.now() / 1000)) + (3600 * 1) }); // 1 hr from now
                console.log('lockTime', new Date(lockTime).toString())

                const cltvSpender = bitcoinJsLib.ECPair.fromPublicKey(Buffer.from(dsigCltvSpenderPubKey, 'hex'))
                console.log('cltvSpender.publicKey.length=', cltvSpender.publicKey.length)

                var wif = addrPrivKeys.find(p => { return p.addr === output.address }).privKey
                const nonCltvSpender = bitcoinJsLib.ECPair.fromWIF(wif, network)
                utilsWallet.softNuke(keyPair)
                utilsWallet.softNuke(wif)
    
                // P2SH(P2WSH(MSIG/CLTV))
                //const p2wsh = bitcoinJsLib.payments.p2wsh({ redeem: { output: dsigCltv(cltvSpender, nonCltvSpender, lockTime), network }, network })
                //const p2sh = bitcoinJsLib.payments.p2sh({ redeem: p2wsh, network: network })
                
                // or, unwrapped P2SH (MSIG/CLTV)
                const p2sh = bitcoinJsLib.payments.p2sh({ redeem: { output: dsigCltv(cltvSpender, nonCltvSpender, lockTime), network }, network: network })
                
                pstx.addOutput({
                    script: p2sh.output,
                    value: Number(Number(output.value).toFixed(0))
                })

                //
                // embed data -- 
                //   TODO: for unlocking...
                //   OMG! it's v. tight!! --- 2x compressed pubKeys (33) = 66 bytes + 8 bytes (64-bit) for lockTime = 6 bytes for ID...
                // https://stackoverflow.com/questions/14730980/nodejs-write-64bit-unsigned-integer-to-buffer/14731148
                //
                const data = assembleDsigCsvOpReturnBuffer(lockTime, cltvSpender.publicKey, nonCltvSpender.publicKey) // Buffer.from(`${DSIGCTLV_ID_vCur}|${lockTime}`, 'utf8')
                console.log(`OP_RETURN data.length=`, data.length) // max 80 bytes, and max 1 op_return (node defaults - not consensus rules)
                const embed = bitcoinJsLib.payments.embed({data: [data]})
                pstx.addOutput({script: embed.output, value: 0 })

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

        //
        // add the inputs
        //
        for (var i = 0; i < txSkeleton.inputs.length; i++) {
            const input = txSkeleton.inputs[i]
            //console.log(`pstx/addInput - input[${i}]`, input)

            if (input.utxo.scriptPubKey.type !== 'scripthash') throw 'Unexpected (non-P2SH) UTXO'

            // create p2sh redeem script
            const assetAddress = asset.addresses.find(p => p.addr == input.utxo.address)
            if (!assetAddress) throw `Couldn't look up UTXO address in wallet`
            const inputTx = utilsWallet.getAll_txs(asset).find(p => p.txid == input.utxo.txid)
            if (!inputTx) throw `Couldn't look up UTXO TX in wallet`
            console.log('inputTx', inputTx)

            if (inputTx.utxo_vout[input.utxo.vout].scriptPubKey.hex != input.utxo.scriptPubKey.hex) throw `scriptPubKey hex sanity check failed`
            const isDsigCltvInput = input.utxo.address == inputTx.p_op_addrNonStd 
            //console.log('input', input)
            //console.log('assetAddress', assetAddress)
            //console.log('isDsigCltvInput', isDsigCltvInput)
            var p2shRedeemScript 
            if (isDsigCltvInput) { // DSIG/CLTV input - construct custom redeem script
                if (!validationMode) {
                    debugger
                }
                if (inputTx.p_op_lockTime === undefined || inputTx.hex === undefined
                    || inputTx.p_op_pubKeyBeneficiary === undefined || inputTx.p_op_pubKeyBenefactor === undefined) throw `inputTx sanity check(s) failed`

                pstx.setLocktime(inputTx.p_op_lockTime)
                const cltvSpender = bitcoinJsLib.ECPair.fromPublicKey(Buffer.from(inputTx.p_op_pubKeyBeneficiary, 'hex'))
                const nonCltvSpender = bitcoinJsLib.ECPair.fromPublicKey(Buffer.from(inputTx.p_op_pubKeyBenefactor, 'hex'))
                const redeemScript = dsigCltv(cltvSpender, nonCltvSpender, inputTx.p_op_lockTime)
                pstx.addInput({
                    // ## "nLocktime lock is not in effect, because all sequence numbers are set to 0xFFFFFFFF....""
                    hash: input.utxo.txid, index: input.utxo.vout, sequence: 0xffffffff, // ### ?!!
                    nonWitnessUtxo: Buffer.from(inputTx.hex,'hex'),
                    redeemScript: Buffer.from(redeemScript, 'hex')
                })

                var wif1 = addrPrivKeys.find(p => { return p.addr === (inputTx.p_op_weAreBeneficiary ? inputTx.p_op_addrBeneficiary : inputTx.p_op_addrBenefactor) }).privKey
                console.log('inputTx.p_op_weAreBenefactor', inputTx.p_op_weAreBenefactor)
                console.log('inputTx.p_op_weAreBeneficiary', inputTx.p_op_weAreBeneficiary)
                console.log('signing WIF addr', addrPrivKeys.find(p => { return p.addr === (inputTx.p_op_weAreBeneficiary ? inputTx.p_op_addrBeneficiary : inputTx.p_op_addrBenefactor) }).addr)
                var keyPair1 = bitcoinJsLib.ECPair.fromWIF(wif1, network)
                //var wif2 = addrPrivKeys[1].privKey
                //var keyPair2 = bitcoinJsLib.ECPair.fromWIF(wif2, network)
                try {
                    pstx.signInput(i, keyPair1)
                    //pstx.signInput(i, keyPair2)
                    //pstx.validateSignaturesOfInput(i)
                    pstx.finalizeInput(i, (inputIndex, input, script) => {
                        const decompiled = bitcoinJsLib.script.decompile(script)
                        if (!decompiled || decompiled[0] !== bitcoinJsLib.opcodes.OP_IF) throw `Bad script`
                        //if (inputTx.p_op_weAreBeneficiary) { // cltvSpender, push OP_TRUE
                            const ret = {
                                finalScriptSig: bitcoinJsLib.payments.p2sh({ 
                                    redeem: {
                                        input: bitcoinJsLib.script.compile([
                                            input.partialSig[0].signature,
                                            inputTx.p_op_weAreBeneficiary ? bitcoinJsLib.opcodes.OP_TRUE : bitcoinJsLib.opcodes.OP_FALSE,
                                        ]),
                                        output: redeemScript,
                                    }
                                }).input
                            }
                            console.dir('ret', ret)
                            return ret
                        //}
                    })
                }
                finally {
                    utilsWallet.softNuke(keyPair1)
                    utilsWallet.softNuke(wif1)
                    //utilsWallet.softNuke(keyPair2)
                    //utilsWallet.softNuke(wif2)
                }
            }
            else { // normal P2SH output - construct standard OP_EQUAL redeem script from the public key
                var wif = addrPrivKeys.find(p => { return p.addr === input.utxo.address }).privKey
                var keyPair = bitcoinJsLib.ECPair.fromWIF(wif, network)
                try {
                    const p2wpkh = bitcoinJsLib.payments.p2wpkh({pubkey: keyPair.publicKey, network}) 
                    const p2sh = bitcoinJsLib.payments.p2sh({redeem: p2wpkh, network}) 
                    p2shRedeemScript = p2sh.redeem.output.toString('hex')
                    pstx.addInput({ // P2SH(P2WPKH)
                        hash: input.utxo.txid, index: input.utxo.vout, sequence: 0xfffffffe,
                        witnessUtxo: { script: Buffer.from(input.utxo.scriptPubKey.hex, 'hex'), value: input.utxo.satoshis },     
                        redeemScript: Buffer.from(p2shRedeemScript, 'hex')
                    })
                    pstx.signInput(i, keyPair)
                    pstx.validateSignaturesOfInput(i)
                    pstx.finalizeInput(i)
                }
                finally {
                    utilsWallet.softNuke(keyPair)
                    utilsWallet.softNuke(wif)
                }
            }
            // const asmRedeemScript = bitcoinJsLib.script.decompile(Buffer.from(redeemScript, 'hex'))
            // console.log('redeemScript', redeemScript)
            // console.dir(asmRedeemScript)
            // pstx.addInput({ 
            //     hash: input.utxo.txid, 
            //     index: input.utxo.vout,
            //     sequence: 0xfffffffe, // ????
            //     witnessUtxo: { // only for P2SH(P2WPKH) -- according to junderw witnessUtxo wouldn't be used for a P2SH() wrapping something other than a P2WPKH 
            //         // scriptPubKey (locking script) of prevout: 
            //         script: Buffer.from(input.utxo.scriptPubKey.hex, 'hex'), // e.g. OP_HASH160 f828d2054506c46bc81fcfd5cd1d410b8b408b2e OP_EQUAL
            //         // amount of satoshis in the prevout:
            //         value: input.utxo.satoshis
            //     },     
            //     // P2SH redeem output (redeemScript)
            //     redeemScript: Buffer.from(redeemScript, 'hex')
            //     // witnessScript: input.witnessScript // = p2wsh redeem output 
            //     // nonWitnessUtxo: Buffer.from(input.utxo.scriptPubKey.hex, 'hex')
            // })
        }
        //console.log('pstx/setup', pstx)

        // sign
        // for (var i = 0; i < txSkeleton.inputs.length; i++) {
        //     const input = txSkeleton.inputs[i]
        //     //console.log(`pstx/sign - input[${i}]`, input)

        //     //if (!input.redeemScript && !input.witnessScript) { //  i.e. if it's a "regular" input (not protected) 
        //         var wif = addrPrivKeys.find(p => { return p.addr === input.utxo.address }).privKey
        //         var keyPair = bitcoinJsLib.ECPair.fromWIF(wif, network)
        //         try {
        //             pstx.signInput(i, keyPair)
        //             pstx.validateSignaturesOfInput(i)
        //             pstx.finalizeInput(i)
        //         }
        //         finally {
        //             utilsWallet.softNuke(keyPair)
        //             utilsWallet.softNuke(wif)
        //         }
        //     //}
        //     //else { // i.e. if input.redeemScript || intput.witnessScript...
        //     //     psbt.finalizeInput(
        //     //          i, 
        //     //          getFinalScripts({    ==> ...csvGetFinalScripts() in csv.spec.ts example...
        //     //              inputScript: input.inputScript, 
        //     //              network 
        //     //     })
        //     //}
        // }
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

function assembleDsigCsvOpReturnBuffer(lockTime, buf_pubKeyA, buf_pubKeyB) {
    const buf_lockTime = write64bitToBuf(lockTime)
    const buf_combined = Buffer.concat([DSIGCTLV_ID_vCur, buf_pubKeyA, buf_pubKeyB, buf_lockTime])
    return buf_combined
}
function disassembleDsigCsvOpReturnBuffer(buf) {
    if (buf.length != 80) return {}
    const buf_idVer = buf.slice(0, 6)
    const buf_pubKeyA = buf.slice(6, 6 + 33)
    const buf_pubKeyB = buf.slice(39, 39 + 33)
    const buf_lockTime = buf.slice(72, 72 + 8)
    const lockTime = read64bitFromBuf(buf_lockTime)
    return { buf_idVer, buf_pubKeyA, buf_pubKeyB, lockTime } 
}
function write64bitToBuf(i) {
    const buf = Buffer.alloc(8)
    buf.writeUInt32BE(i >> 8, 0)     // write the high order bits (shifted over)
    buf.writeUInt32BE(i & 0x00ff, 4) // write the low order bits
    return buf
}
function read64bitFromBuf(buf) {
    var bufInt = (buf.readUInt32BE(0) << 8) + buf.readUInt32BE(4)
    return bufInt
}