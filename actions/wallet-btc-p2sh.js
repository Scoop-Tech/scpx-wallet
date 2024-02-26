// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2023 Dominic Morris.

const bitcoinJsLib = require('bitcoinjs-lib')
const bip65 = require('bip65')
const _ = require('lodash')
const BigNumber = require('bignumber.js')

const walletShared = require('./wallet-shared')
const actionsWallet = require('../actions')
const utilsWallet = require('../utils')
const configWallet = require('../config/wallet')
const { walletExternal_config } = require('../config/wallet-external')

const DSIGCTLV_ID_vCur = Buffer.from( // (max 4 bytes)
    `481fe761`  // protect_op ID stamp: "12100504" + "xx", where xx=p_op version; v1 = 1210050401 = 0x481fe761
, 'hex')

function dsigCltv(cltvSpender, nonCltvSpender, lockTime) {
    return bitcoinJsLib.script.fromASM(
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

const P_OP_DUST = 546
const P_OP_DUST_BTC = new BigNumber(P_OP_DUST).div(100000000).toString()
const P_OP_MIN_GROSS = P_OP_DUST * 3 + 800 // min. 2 dust tracking outputs + 1 dust dev fee output, plus something reasonably greater than dust
const P_OP_DEV_FEE_PERC = 0.005 // 0.5% developer fee

module.exports = {

    P_OP_DUST,
    P_OP_DUST_BTC,
    P_OP_MIN_GROSS,

    scan_NonStdOutputs: (params) => {
        const { asset, dispatchActions, nonStdAddrs_Txs } = params
        if (!asset) throw 'asset is required'
        if (!nonStdAddrs_Txs) throw 'nonStdAddrs_Txs is required'
        if (!dispatchActions) throw 'dispatchActions is required'

        const ownStdAddresses = asset.addresses.filter(p => !p.isNonStdAddr).map(p => { return p.addr })
        utilsWallet.log(`scan_NonStdOutputs ${asset.symbol}`)

        // scan standard tx's, look for ones that conform to our v1 PROTECT_OP -- i.e. 4 outputs:
        //
        //   * vout=0 p2sh non-standard (P2SH(DSIG/CLTV)) output (>= P_OP_MIN_LOCKED)
        //   * vout=1 op_return (versioning)
        //   * vout=2 p2sh zero output (beneficiary) == P_OP_DUST       (for beneficiary ID)
        //   * vout=3 p2sh change output (benefactor) >= P_OP_DUST      (for benefactor ID)
        //   * vout=4 p2sh dev_fee output (developer)
        //
        // then, harvest the p2sh-addr and add it to our nonStd addr's list... (wallet-shared.addNonStdAddress_DsigCltv...)
        asset.addresses.filter(p => !p.isNonStdAddr)
        .forEach(a => { 
            const include_localTxs = asset.local_txs
                .filter(p => p.utxo_vin !== undefined) // UTXO v2 - skip minimal tx's
                .filter(p => 
                    p.utxo_vin.some(p2 => p2.addr == a.addr) ||
                    p.utxo_vout.some(p2 => p2.scriptPubKey.addresses.includes(a.addr)
            ))

            const txs = a.txs.concat(include_localTxs)
            txs.forEach(async tx => {

                // if already parsed this TX and determined that it is a protect_op, skip it
                if (tx.p_op_addrNonStd !== undefined) { 
                    //utilsWallet.debug(`scan_NonStdOutputs already defined tx.p_op_addrNonStd txid=${tx.txid}, nop.`, tx.utxo_vout)
                    return
                }

                // see also: worker-blockbook::enrichTx()...
                if (!tx.utxo_vout) { 
                    return
                }
                if (tx.utxo_vout.length != 5) return                // required anatomy...
                if (tx.utxo_vout[0].value == 0) return              // protected output (dsigCltv)
                if (tx.utxo_vout[1].value != 0) return              // op_return output (versioning)
                if (tx.utxo_vout[2].value != P_OP_DUST_BTC) return  // beneficiary ID output - must be dust
                if (tx.utxo_vout[3].value < P_OP_DUST_BTC) return   // benefactor change output - at least dust
                if (tx.utxo_vout[4].value < P_OP_DUST_BTC) return   // dev_fee - at least dust

                if (!tx.utxo_vout.every(utxo => utxo.scriptPubKey !== undefined // sanity checks
                     && utxo.scriptPubKey.addresses !== undefined 
                     && utxo.scriptPubKey.addresses.length == 1)) {
                    return
                }

                var txProtectOpTimelock = undefined
                var txProtectOpDateTime = undefined
                var txProtectOpLockHours = undefined
                var pubKeyBeneficiary = undefined
                var pubKeyBenefactor = undefined
                tx.utxo_vout.forEach(utxo => { // look for our protect_op version id in an op_return output at index vout=1 
                    if (utxo && utxo.scriptPubKey && utxo.scriptPubKey.hex && utxo.scriptPubKey.hex.length > 2 && utxo.n == 1) { // op_return output
                        const firstOp = parseInt('0x' + utxo.scriptPubKey.hex.substring(0,2))
                        if (firstOp == bitcoinJsLib.script.OPS.OP_RETURN) {
                            const asm = bitcoinJsLib.script.decompile(Buffer.from(utxo.scriptPubKey.hex, 'hex'))
                            if (asm && asm.length == 2 && asm[1].buffer !== undefined) {
                                const { buf_idVer, buf_pubKeyA, buf_pubKeyB, lockTime, lockHours } = disassembleDsigCsvOpReturnBuffer(Buffer.from(asm[1]))
                                if (buf_idVer) {
                                    if (Buffer.compare(buf_idVer, DSIGCTLV_ID_vCur) == 0) {
                                        txProtectOpTimelock = lockTime
                                        txProtectOpLockHours = lockHours
                                        txProtectOpDateTime = new Date(Number(lockTime) * 1000)
                                        pubKeyBeneficiary = buf_pubKeyA
                                        pubKeyBenefactor = buf_pubKeyB
                                        //utilsWallet.debug('txProtectOpDateTime=', txProtectOpDateTime)
                                    }
                                }
                            }   
                        }
                    }
                })
                var addrBenefactor
                if (pubKeyBenefactor) {
                    addrBenefactor = walletShared.getUtxoTypeAddressFromPubKeyHex(pubKeyBenefactor.toString('hex'), asset.symbol)
                }

                if (txProtectOpDateTime && addrBenefactor) {
                    //console.log(`got p_op TX: ${tx.txid}`, tx)
                    // 5443b88413f52a760d1fd29c8da9ddb3a2f3ce9e7bd99d618f3b9c239cab978a 
                    // 1edc7195bb257e7dd2065dc822c14bc30efcb8144ef2367d4707a76c3439253c 
                    // 362315858525c8e71a3d7e6744edf967bae5cad668f8b90946d249c997ddee5c 

                    const _tx = _.cloneDeep(tx)
                    _tx.p_op_addrNonStd = tx.utxo_vout[0].scriptPubKey.addresses[0]
                    _tx.p_op_addrBeneficiary = tx.utxo_vout[2].scriptPubKey.addresses[0]
                    _tx.p_op_addrBenefactor = addrBenefactor
                    _tx.p_op_addrDevFee = tx.utxo_vout[4].scriptPubKey.addresses[0]

                    _tx.p_op_valueProtected = tx.utxo_vout[0].value
                    _tx.p_op_valueBeneficiaryDust = tx.utxo_vout[2].value
                    _tx.p_op_valueChange = tx.utxo_vout[3].value
                    _tx.p_op_valueDevFee = tx.utxo_vout[4].value
                    _tx.p_op_valueBenefactorProtectionCost = _tx.p_op_valueBeneficiaryDust + _tx.p_op_valueDevFee // + tx fees

                    _tx.p_op_weAreBeneficiary = ownStdAddresses.some(p => p == _tx.p_op_addrBeneficiary)
                    _tx.p_op_weAreBenefactor = ownStdAddresses.some(p => p == _tx.p_op_addrBenefactor)
                    _tx.p_op_weAreDeveloper = ownStdAddresses.some(p => p == _tx.p_op_addrDevFee)

                    _tx.p_op_lockTime = txProtectOpTimelock // filetime
                    _tx.p_op_unlockDateTime = txProtectOpDateTime // datetime
                    _tx.p_op_lockHours = txProtectOpLockHours // hrs to lock
                    
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
                    utilsWallet.log(`p_op_addrBeneficiary=${_tx.p_op_addrBeneficiary}`)
                    utilsWallet.log(`p_op_addrBenefactor=${_tx.p_op_addrBenefactor}`)
                    utilsWallet.log(`p_op_weAreBeneficiary=${_tx.p_op_weAreBeneficiary}`)
                    utilsWallet.log(`p_op_weAreBenefactor=${_tx.p_op_weAreBenefactor}`)
                    utilsWallet.log(`p_op_unlockDateTime=${_tx.p_op_unlockDateTime}`)
                    utilsWallet.log(`p_op_unlockDateTime.toLocaleString()=`, _tx.p_op_unlockDateTime.toLocaleString())
                    utilsWallet.log(`p_op_lockHours=`, _tx.p_op_lockHours)
                    utilsWallet.log(`p_op_pubKeyBeneficiary=${_tx.p_op_pubKeyBeneficiary}`)
                    utilsWallet.log(`p_op_pubKeyBenefactor=${_tx.p_op_pubKeyBenefactor}`)
                    utilsWallet.log(`p_op_addrDevFee=${_tx.p_op_addrDevFee}`)
                    utilsWallet.log(`p_op_valueDevFee=${_tx.p_op_valueDevFee}`)

                    if (!nonStdAddrs_Txs.some(p => p.protect_op_txid == tx.txid)) {
                        nonStdAddrs_Txs.push({ nonStdAddr: _tx.p_op_addrNonStd, protect_op_txid: tx.txid})
                    }
                }
            })
        })
    },

    createTxHex_BTC_P2SH: (params) => {
        const { asset, validationMode, addrPrivKeys, txSkeleton, dsigCltvSpenderPubKey, dsigCltvSpenderLockHours } = params
        const allTxs = utilsWallet.getAll_txs(asset)
        const network = walletShared.getUtxoNetwork(asset.symbol)
        const devFeeAddr = walletExternal_config[asset.symbol].donate
        let devFee = 0
        var tx, hex, vSize, byteLength  
    
        const psbt = new bitcoinJsLib.Psbt({ network })
        psbt.setVersion(2)
        utilsWallet.log(`createTxHex_BTC_P2SH validationMode=${validationMode} devFeeAddr=${devFeeAddr} (dsigCltvSpenderPubKey=${dsigCltvSpenderPubKey}), txSkeleton=`, txSkeleton)
        
        // 
        // validate P_OP params -
        //
        //   if caller specifies dsigCltvSpenderPubKey, then:
        //      output[0] placeholder - must have format: { addr: BENEFACTOR_ADDR (will be overridden),      value: PROTECT_AMOUNT (>= P_OP_MIN_GROSS, will have 2x dust & dev fee (at minimum, dust) subtracted) }
        //      output[1] change      - must have format: { addr: BENEFACTOR_ADDR (must match first output), value: >=0 (will be padded up to P_OP_DUST as necessary) } 
        //
        //      ...we will calculate and add here inline a dev_fee at output[2] (taking from PROTECT_AMOUNT)
        //
        //   then, dynamically we will transform input[0] into the following 3 inputs:
        //      + we will insert the P2SH non-standard (P2SH(DSIG/CLTV)) locking output
        //      + we will insert the OP_RETURN (versioning & data) output
        //      + we will insert the P2SH beneficiary ID output
        //
        //   i.e. dsigCltvSpenderPubKey ? output.len(2) ==> output.len(5) { 0: locking, 1: op_return, 2: P2SH (beneficiary ID), 3: P2SH change (benefactor ID), 4: P2SH dev_fee }
        //
        //    to satisfy nodes' min-relay/dust requirements:
        //      + we will insert the beneficiary ID output with P_OP_DUST (taking from PROTECT_AMOUNT)
        //      + we will pad the mandatory change ouput up to P_OP_DUST (taking from PROTECT_AMOUNT)
        //
        // https://bitcoin.stackexchange.com/questions/10986/what-is-meant-by-bitcoin-dust
        // https://www.coindesk.com/tech/2020/08/18/dust-attacks-make-a-mess-in-bitcoin-wallets-but-there-could-be-a-fix/
        //
        if (dsigCltvSpenderPubKey !== undefined) {
            if (txSkeleton.outputs.length != 2) throw 'P_OP: bad # outputs'
            if (txSkeleton.outputs[0].adress != txSkeleton.outputs[1].adress) throw 'P_OP: output mismatch'
            if (txSkeleton.outputs[0].value < P_OP_MIN_GROSS) throw 'P_OP: bad P_OP_MIN_GROSS'
            if (!txSkeleton.outputs[1].change) throw 'P_OP: missing explicit change output'

            // insert the dev fee output
            const protectAmount = new BigNumber(txSkeleton.outputs[0].value)
            devFee = new BigNumber(protectAmount.times(0.005).toFixed(0))// 0.5% dev fee
            if (devFee.lt(new BigNumber(P_OP_DUST))) { // pad dev fee up to dust
                devFee = new BigNumber(P_OP_DUST)
            }
            const protectValueNet = protectAmount.minus(devFee)
           
            console.log('protectAmount.toString()', protectAmount.toString())
            console.log('devFee.toString())', devFee.toString())
            console.log('protectValueNet.toString())', protectValueNet.toString())

            // console.log('protectAmount', protectAmount.precision(0))
            // console.log('devFee', devFee.precision(0))
            // console.log('protectValueNet', protectValueNet.precision(0))

            // add dev fee output
            const devFeeOutput = { address: devFeeAddr, value: Number(devFee.toString()) }
            txSkeleton.outputs.push(devFeeOutput)
            //txSkeleton.outputs[0].value -= devFee.precision(0) // take off the dev fee
            txSkeleton.outputs[0].value = Number(new BigNumber(txSkeleton.outputs[0].value).minus(devFee).toFixed(0))
            
            // take off one dust amount: it will used in the beneficiary ID output
            //txSkeleton.outputs[0].value -= P_OP_DUST * 1 
            txSkeleton.outputs[0].value = Number(new BigNumber(txSkeleton.outputs[0].value).minus(new BigNumber(P_OP_DUST * 1)).toFixed(0))
            
            // pad change up to min. dust output - ensures a change output for consistent anatomy
            if (new BigNumber(txSkeleton.outputs[1].value).lt(new BigNumber(P_OP_DUST))) { 
                const dustDelta = new BigNumber(P_OP_DUST).minus(new BigNumber(txSkeleton.outputs[1].value))
                txSkeleton.outputs[0].value = Number(new BigNumber(txSkeleton.outputs[0].value).minus(dustDelta).toFixed(0))
                txSkeleton.outputs[1].value = Number(new BigNumber(txSkeleton.outputs[1].value).plus(dustDelta).toFixed(0))
            }   

            //   * vout=0 p2sh non-standard (P2SH(DSIG/CLTV)) output (>= P_OP_MIN_LOCKED)
            //   * vout=1 op_return (versioning, pubkeys x2 + timelock value)
            //   * vout=2 p2sh beneficiary ID output (beneficiary) == P_OP_DUST (for beneficiary ID)
            //   * vout=3 p2sh change output (benefactor) >= P_OP_DUST          (for benefactor ID)
            //   * vout=4 p2sh dev_fee output (developer) >= P_OP_DUST          (for dev fee)
            
            //txSkeleton.outputs[0].value -= P_OP_DUST * 1 // take another one off for the change benefactor ID (change) output
            //txSkeleton.outputs[1].value = P_OP_DUST
        }

        //
        // add the outputs
        //
        txSkeleton.outputs.forEach(output => {
            if (output.change == false && dsigCltvSpenderPubKey !== undefined) { // PROTECT_OP non-standard output (1 dummy output in skeleton ==> 3 outputs)

                if (dsigCltvSpenderLockHours === undefined || !Number.isInteger(dsigCltvSpenderLockHours) || dsigCltvSpenderLockHours > 0xffff) { 
                    throw `P_OP: dsigCltvSpenderLockHours`
                }
                
                // get params for locking script
                const lockHours = Number(dsigCltvSpenderLockHours)
                const lockTime = bip65.encode({ utc: (Math.floor(Date.now() / 1000)) + (3600 * lockHours) }) 
                const cltvSpender = bitcoinJsLib.ECPair.fromPublicKey(Buffer.from(dsigCltvSpenderPubKey, 'hex'))
                var nonCltvSpender
                var wif = addrPrivKeys.find(p => { return p.addr === output.address }).privKey
                try {
                    nonCltvSpender = bitcoinJsLib.ECPair.fromWIF(wif, network)
                } 
                finally { utilsWallet.softNuke(keyPair); utilsWallet.softNuke(wif) }

                // vout=0 - p2sh non-standard (P2SH(DSIG/CLTV)) output
                //const p2wsh = bitcoinJsLib.payments.p2wsh({ redeem: { output: dsigCltv(cltvSpender, nonCltvSpender, lockTime), network }, network })
                //const p2sh = bitcoinJsLib.payments.p2sh({ redeem: p2wsh, network: network })
                // or, unwrapped P2SH(DSIG/CLTV):
                const p2sh = bitcoinJsLib.payments.p2sh({ redeem: { output: dsigCltv(cltvSpender, nonCltvSpender, lockTime), network }, network })
                psbt.addOutput({
                    script: p2sh.output,
                    value: Number(Number(output.value).toFixed(0))
                })

                // vout=1 op_return (versioning)
                //   embed data
                const data = assembleDsigCsvOpReturnBuffer(lockTime, lockHours, cltvSpender.publicKey, nonCltvSpender.publicKey)
                const embed = bitcoinJsLib.payments.embed({data: [data]})
                psbt.addOutput({script: embed.output, value: 0 })
                //utilsWallet.debug(`OP_RETURN data.length=`, data.length) // max 80 bytes, and max 1 op_return (node defaults - not consensus rules)

                // vout=2 p2sh beneficiary ID output (beneficiary) == P_OP_DUST (for beneficiary ID)
                //   reference the beneficiary address (so it can retrieve this TX and parse the embedded data)
                const ctlvSpenderP2sh = bitcoinJsLib.payments.p2sh({ redeem: bitcoinJsLib.payments.p2wpkh({ pubkey: Buffer.from(dsigCltvSpenderPubKey, 'hex'), network }), network })
                psbt.addOutput({ address: ctlvSpenderP2sh.address, value: Number(Number(P_OP_DUST).toFixed(0)) })

            }
            else { // standard P2SH output (for dsigCltvSpenderPubKey: change or dev_fee)
                psbt.addOutput({ 
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

            if (input.utxo.scriptPubKey.type !== 'scripthash') throw 'Unexpected (non-P2SH) UTXO'

            // create p2sh redeem script
            const assetAddress = asset.addresses.find(p => p.addr == input.utxo.address)
            if (!assetAddress) throw `Couldn't look up UTXO address in wallet`
            
            // const inputTx = allTxs.find(p => p.txid == input.utxo.txid)
            // if (!inputTx) { 
            //     console.log(allTxs.map(p => p.txid).join(','))
            //     debugger
            //     throw `Couldn't look up UTXO TX in wallet`
            // }
            // if (inputTx.utxo_vout[input.utxo.vout].scriptPubKey.hex != input.utxo.scriptPubKey.hex) throw `scriptPubKey hex sanity check failed`
            // const isDsigCltvInput = input.utxo.address == inputTx.p_op_addrNonStd 
            const p_opTx = allTxs.find(p => p.p_op_addrNonStd == input.utxo.address)
            const isDsigCltvInput = p_opTx !== undefined

            if (isDsigCltvInput) { // DSIG/CLTV input - use custom redeem script
                utilsWallet.log(`psbt/addInput - DSIG/CLTV input[${i}]`, input)
                if (p_opTx.p_op_lockTime === undefined || p_opTx.hex === undefined
                    || p_opTx.p_op_pubKeyBeneficiary === undefined || p_opTx.p_op_pubKeyBenefactor === undefined) throw `inputTx sanity check(s) failed`

                if (p_opTx.p_op_weAreBeneficiary) {
                   psbt.setLocktime(p_opTx.p_op_lockTime)
                }

                const cltvSpender = bitcoinJsLib.ECPair.fromPublicKey(Buffer.from(p_opTx.p_op_pubKeyBeneficiary, 'hex'))
                const nonCltvSpender = bitcoinJsLib.ECPair.fromPublicKey(Buffer.from(p_opTx.p_op_pubKeyBenefactor, 'hex'))
                const dsigCltvRedeemScript = dsigCltv(cltvSpender, nonCltvSpender, p_opTx.p_op_lockTime)
                
                const inputTx = allTxs.find(p => p.txid == input.utxo.txid)
                psbt.addInput({
                    hash: input.utxo.txid, index: input.utxo.vout, sequence: 0xfffffffe,
                    nonWitnessUtxo: Buffer.from(inputTx.hex, 'hex'),
                    redeemScript: Buffer.from(dsigCltvRedeemScript, 'hex')
                })
            }
            else { // normal P2SH output - construct standard OP_EQUAL redeem script from the public key
                utilsWallet.log(`psbt/addInput - P2SH input[${i}]`, input)
                var wif = addrPrivKeys.find(p => { return p.addr === input.utxo.address }).privKey
                var keyPair = bitcoinJsLib.ECPair.fromWIF(wif, network)
                try {
                    const p2wpkh = bitcoinJsLib.payments.p2wpkh({pubkey: keyPair.publicKey, network}) 
                    const p2sh = bitcoinJsLib.payments.p2sh({redeem: p2wpkh, network}) 
                    const p2shRedeemScript = p2sh.redeem.output.toString('hex')
                    psbt.addInput({ // P2SH(P2WPKH)
                        hash: input.utxo.txid, index: input.utxo.vout, sequence: 0xfffffffe,
                        witnessUtxo: { script: Buffer.from(input.utxo.scriptPubKey.hex, 'hex'), value: input.utxo.satoshis },     
                        redeemScript: Buffer.from(p2shRedeemScript, 'hex')
                    })
                }
                finally { utilsWallet.softNuke(keyPair); utilsWallet.softNuke(wif) }
            }
        }

        //
        // sign
        //
        for (var i = 0; i < txSkeleton.inputs.length; i++) {
            const input = txSkeleton.inputs[i]
            //const inputTx = utilsWallet.getAll_txs(asset).find(p => p.txid == input.utxo.txid)
            //const isDsigCltvInput = input.utxo.address == inputTx.p_op_addrNonStd 
            const p_opTx = allTxs.find(p => p.p_op_addrNonStd == input.utxo.address)
            const isDsigCltvInput = p_opTx !== undefined

            if (isDsigCltvInput) {
                const cltvSpender = bitcoinJsLib.ECPair.fromPublicKey(Buffer.from(p_opTx.p_op_pubKeyBeneficiary, 'hex'))
                const nonCltvSpender = bitcoinJsLib.ECPair.fromPublicKey(Buffer.from(p_opTx.p_op_pubKeyBenefactor, 'hex'))
                const dsigCltvRedeemScript = dsigCltv(cltvSpender, nonCltvSpender, p_opTx.p_op_lockTime)
                const signingAddr = p_opTx.p_op_weAreBeneficiary ? p_opTx.p_op_addrBeneficiary : p_opTx.p_op_addrBenefactor

                // sanity check
                var cltvSpender_addr, nonCltvSpender_addr
                try {
                    cltvSpender_addr = walletShared.getUtxoTypeAddressFromPubKeyHex(p_opTx.p_op_pubKeyBeneficiary, asset.symbol)
                    nonCltvSpender_addr = walletShared.getUtxoTypeAddressFromPubKeyHex(p_opTx.p_op_pubKeyBenefactor, asset.symbol)
                }
                catch(ex) {
                    console.warn(ex)
                }
                if (signingAddr != cltvSpender_addr && signingAddr != nonCltvSpender_addr) throw 'Unexpected pubkey(s) vs signer'

                var wif = addrPrivKeys.find(p => { return p.addr === signingAddr }).privKey
                var keyPair = bitcoinJsLib.ECPair.fromWIF(wif, network)
                try {
                    psbt.signInput(i, keyPair)
                    psbt.finalizeInput(i, (inputIndex, input, script) => {
                        const decompiled = bitcoinJsLib.script.decompile(script)
                        if (!decompiled || decompiled[0] !== bitcoinJsLib.opcodes.OP_IF) throw `Bad script`
                        const ret = {
                            finalScriptSig: bitcoinJsLib.payments.p2sh({ 
                                redeem: {
                                    input: bitcoinJsLib.script.compile([
                                        input.partialSig[0].signature,
                                        p_opTx.p_op_weAreBeneficiary ? bitcoinJsLib.opcodes.OP_TRUE : bitcoinJsLib.opcodes.OP_FALSE,
                                    ]),
                                    output: dsigCltvRedeemScript,
                                }
                            }).input
                        }
                        return ret
                    })
                }
                finally { utilsWallet.softNuke(keyPair); utilsWallet.softNuke(wif) }            
            }
            else {
                var wif = addrPrivKeys.find(p => { return p.addr === input.utxo.address }).privKey
                var keyPair = bitcoinJsLib.ECPair.fromWIF(wif, network)
                try {
                    psbt.signInput(i, keyPair)
                    psbt.validateSignaturesOfInput(i)
                    psbt.finalizeInput(i)
                }
                finally { utilsWallet.softNuke(keyPair); utilsWallet.softNuke(wif) }
            }
        }
        //utilsWallet.log('psbt/signed', psbt)

        // validation mode - compute base vSize for skeleton tx (with fixed two outputs)
        const inc_tx = psbt.extractTransaction(true)
        console.log('inc_tx', inc_tx)
        const inc_vs = inc_tx.virtualSize()
        const inc_bl = inc_tx.byteLength()
        vSize = inc_vs // tx is fully complete & signed; these are final values
        byteLength = inc_bl
        tx = inc_tx
        //utilsWallet.log('inc_tx.virtualSize=', inc_vs)
        //utilsWallet.log('inc_tx.byteLength=', inc_bl)
        //utilsWallet.log('psbt/inc_tx', inc_tx)
        //utilsWallet.log('psbt/inc_tx.toHex()', inc_tx.toHex())

        if (!validationMode) {
            hex = inc_tx.toHex()
            utilsWallet.log(`*** createTxHex (wallet-external UTXO bitcoin-js P2SH) ${asset.symbol}, hex.length, hex=`, hex.length, hex)
        }

        return { tx, hex, vSize, byteLength, psbt }
    },
}

function isNumeric(n) {
    return !isNaN(parseFloat(n)) && isFinite(n);
}

function assembleDsigCsvOpReturnBuffer(lockTime, lockHours, buf_pubKeyA, buf_pubKeyB) {
    if (lockHours > 0xffff) throw 'lockHours overflow'
    const buf_lockTime = write64bitToBuf(lockTime)
    const buf_lockHours = write16bitToBuf(lockHours)
    const buf_combined = Buffer.concat([DSIGCTLV_ID_vCur, buf_pubKeyA, buf_pubKeyB, buf_lockTime, buf_lockHours])
    return buf_combined
}
function disassembleDsigCsvOpReturnBuffer(buf) {
    if (buf.length != 80) return {}
    const buf_idVer = buf.slice(0, 4)
    const buf_pubKeyA = buf.slice(4, 4 + 33)
    const buf_pubKeyB = buf.slice(37, 37 + 33)
    const buf_lockTime = buf.slice(70, 70 + 8)
    const lockTime = read64bitFromBuf(buf_lockTime)
    const buf_lockHours = buf.slice(78, 78 + 2)
    const lockHours = read16bitFromBuf(buf_lockHours)
    return { buf_idVer, buf_pubKeyA, buf_pubKeyB, lockTime, lockHours }
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
function write16bitToBuf(i) {
    const buf = Buffer.alloc(2)
    buf.writeUInt16BE(i, 0)
    return buf
}
function read16bitFromBuf(buf) {
    var bufInt = buf.readUInt16BE(0)
    return bufInt
}
