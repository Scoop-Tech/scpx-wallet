import BigNumber from 'bignumber.js'
import axios from 'axios'
import axiosRetry from 'axios-retry'

import * as configWallet from '../config/wallet'
import * as configExternal from '../config/wallet-external'
import * as utilsWallet from '../utils'

//
// works in two modes: estimate or execute 
//   in estimate mode we don't yet know the exact fee (it will vary with the final tx vbyte size)
//   in execute mode we have the final vbyte size, so we are passed in the exact fee
//
export function getUtxo_InputsOutputs(symbol, params, throwOnInsufficient = true) {
    console.log(`*** getUtxo_InputsOutputs ${symbol}, params=`, params)

    // validation
    if (!params || !params.feeSatoshis || !params.utxos) {
        console.error(`## getUtxo_InputsOutputs - invalid params`)
        if (throwOnInsufficient) return Promise.reject("Invalid parameters")
        else return
    }
    if (params.utxos.length === 0) {
        console.warn(`## getUtxo_InputsOutputs - no utxos; zero-balance?`)
        if (throwOnInsufficient) return Promise.reject("Insufficient funds")
        else return
    }

    // sort avalable utxos by descending balance
    const utxos = params.utxos.sort((a, b) => { return (b.satoshis - a.satoshis) })

    // this is either an estimated fee, or an exact amount depending on the call stack
    const feeSatoshisAssumed = new BigNumber(params.feeSatoshis)

    // get total output value required
    var valueNeeded = new BigNumber(0)
    for (var i = 0; i < params.outputs.length; i++) {
        valueNeeded = valueNeeded.plus(new BigNumber(params.outputs[i].value))
    }

    // gather sufficient utxos as inputs
    var inputsTotalValue = new BigNumber(0)
    var inputNdx = 0
    var inputsNeeded = []
    for (var i = 0; i < utxos.length; i++) {
        inputsTotalValue = inputsTotalValue.plus(new BigNumber(utxos[i].satoshis))
        inputsNeeded.push({ utxo: utxos[i], ndx: inputNdx })
        inputNdx++
        //console.log(`utxo ndx ${i} (utxos[i].satoshis=${utxos[i].satoshis}), inputsTotalValue=${inputsTotalValue.toString()} of ${valueNeeded.toString()} (value) + ${feeSatoshisAssumed.toString()} (fee)...`)
        if (inputsTotalValue.gt(valueNeeded.plus(feeSatoshisAssumed))) {
            //console.log(`** sufficient utxo's **`)
            break
        }
    }

    // validate enough utxo's exist
    if (inputsTotalValue.lt(valueNeeded.plus(feeSatoshisAssumed))) {
        if (throwOnInsufficient) {
            return Promise.reject("Insufficient funds")
        }
        else {
            console.log(`getUtxo_InputsOutputs - insufficient UTXOs to construct TX: ignoring on estimate path.`)
        }
    }

    // format inputs and outputs
    const inputs = inputsNeeded.map(input => { return { utxo: input.utxo, ndx: input.ndx } })
    var outputs = params.outputs.map(output => { return { address: output.receiver, value: output.value } })

    // unspent output - to self, if it's not dust 
    var unspentValue = inputsTotalValue.minus(valueNeeded).minus(feeSatoshisAssumed)
    console.log(`*** getUtxo_InputsOutputs ${symbol}, inputsTotalValue, unspentValue, feeSatoshisAssumed=`, inputsTotalValue.toString(), unspentValue.toString(), feeSatoshisAssumed.toString())
    if (unspentValue.gt(feeSatoshisAssumed)) { // the definition of "dust" is up to individual nodes, but generally < network fee is reasonably considered to be dust
        outputs.push({
            address: params.changeAddress, // multi-addr: fixing change to addr0 for now
            value: unspentValue.toString()
        })
    }

    const txSkeleton = { inputs, outputs }
    console.log(`*** getUtxo_InputsOutputs ${symbol}, txSkeleton=`, txSkeleton)

    return txSkeleton
}

export function pushRawTransaction_Utxo(wallet, asset, txhex, callback) {
    console.log(`*** pushRawTransaction_Utxo ${asset.logsymbol} (${txhex})...`)

    if (asset.use_BBv3) {

        // push with blockbook
        // register message handler for web worker's BB push
        const listener = function(event) {
            if (event && event.data && event.data.data) {
                const postback = event.data.data
                const msg = event.data.msg
                if (postback && msg === 'PUSH_TX_BLOCKBOOK_DONE') {
                    if (postback.txhex === txhex) {
                        document.appWorker.removeEventListener('message', listener)
                        
                        const mappedTx = postback.mappedTx
                        const err = postback.error
                        if (err) {
                            callback(null, err)
                        }
                        else {
                            if (!mappedTx) {
                                callback(null, 'No transaction')
                            }
                            else {
                                callback({ tx: mappedTx })
                            }
                        }
                    }
                }
            }
        }
        document.appWorker.addEventListener('message', listener)

        // request worker BB push
        document.appWorker.postMessage({ msg: 'PUSH_TX_BLOCKBOOK', data: { asset, txhex, wallet } }) 
    }
    else { // push tx with insight-api
        axios
        .post(configExternal.walletExternal_config[asset.symbol].api.push_tx, { rawtx: txhex })
        .then(res => {
            // fetch tx full
            const txid = res.data.txid
            axios.get(configExternal.walletExternal_config[asset.symbol].api.tx(txid))
                .then(txRes => {
                    // map and return local tx
                    const ownAddresses = asset.addresses.map(p => { return p.addr })
                    const tx = map_insightTxs([txRes.data], ownAddresses)[0]
                    callback({ tx })
                })
        })
        .catch(err => {
            console.error(`### pushRawTransaction_Utxo ${asset.symbol} (${txhex}) err=`, err)
            callback(null, err)
        })
    }
}

export function estimateFees_Utxo(symbol) {
    console.log(`fees - estimateFees_Utxo ${symbol}...`)
    axiosRetry(axios, configWallet.AXIOS_RETRY_3PBP)

    var ret = {} // { fastest_satPerKB, fast_satPerKB, slow_satPerKB } // from oracle(s)

    // BTC - Bitpay recommended: https://www.bitgo.com/api/v1/tx/fee?numBlocks=2 
    if (symbol === 'BTC' || symbol === 'BTC_SEG' || symbol === 'BTC_TEST') {
        return axios.get(configExternal.btcFeeOracle_BitGo)
        .then(res => {
            if (res && res.data && res.data.feeByBlockTarget) {
                // {"feePerKb":10096,"cpfpFeePerKb":10096,"numBlocks":2,"confidence":80,"multiplier":1,
                //   "feeByBlockTarget":{"1":10096,"3":9752,"4":6289,"5":5385,"8":3327,"9":3138,"10":1202,"11":1060,"21":1018,"42":1000}}
                var keys = Object.keys(res.data.feeByBlockTarget).map(p => Number(p)).sort((a, b) => { return a > b ? +1 : a < b ? -1 : 0 })

                ret.fastest_satPerKB = res.data.feeByBlockTarget[keys[0]]
                ret.fast_satPerKB = keys.length > 1 ? res.data.feeByBlockTarget[keys[1]] : Math.floor(ret.fastest_satPerKB / 2)
                ret.slow_satPerKB = keys.length > 3 ? res.data.feeByBlockTarget[keys[3]] : Math.floor(ret.fast_satPerKB / 2)
            }
            return ret
        })
    }
    else if (symbol === 'LTC') { // https://bitcoin.stackexchange.com/questions/53821/where-can-i-find-the-current-fee-level-for-ltc
        return axios.get(configExternal.ltcFeeOracle_BlockCypher)
        .then(res => {
            if (res && res.data && res.data) {
                // axios.get(configExternal.walletExternal_config[symbol].api.estimate_fee)
                // .then(nodeRes => {
                //var nodeEst = nodeRes.data[2] * 100000000
                //debugger
                ret.fastest_satPerKB = res.data.high_fee_per_kb

                // getting insufficient priority from node for much less than the highest value - todo: would like a more deterministic fee estimate!
                ret.fast_satPerKB = ret.fastest_satPerKB // Math.ceil(ret.fastest_satPerKB * 0.8)
                ret.slow_satPerKB = ret.fastest_satPerKB // Math.ceil(ret.fastest_satPerKB * 0.7)

                return ret
                //})
            }
        })
    }
    else if (symbol === 'ZEC') {
        return new Promise((resolve, reject) => {
            ret.fastest_satPerKB = Math.floor(0.0001 * 100000000)
            ret.fast_satPerKB = ret.fastest_satPerKB
            ret.slow_satPerKB = ret.fastest_satPerKB
            resolve(ret)
        })
    }
    else if (symbol === 'DASH') {
        return axios.get(configExternal.dashFeeOracle_BlockCypher)
        .then(res => {
            if (res && res.data) {
                ret.fastest_satPerKB = res.data.high_fee_per_kb
                ret.fast_satPerKB = ret.fastest_satPerKB 
                ret.slow_satPerKB = ret.fastest_satPerKB 
                return ret
            }
        })
    }
    else if (symbol === 'VTC') {
        return axios.get(configExternal.vtcFeeOracle_Blockbook)
        .then(res => {
            if (res && res.data && res.data.result) {
                const satPerByte = Math.ceil(Number(utilsWallet.toCalculationUnit(res.data.result, { type: configWallet.WALLET_TYPE_UTXO } )) * 1.1)
                ret.fastest_satPerKB = satPerByte.toString()
                ret.fast_satPerKB = ret.fastest_satPerKB 
                ret.slow_satPerKB = ret.fastest_satPerKB 
                return ret
            }
        })
    }
    else if (symbol === 'QTUM') {
        return axios.get(configExternal.qtumFeeOracle_Blockbook)
        .then(res => {
            if (res && res.data && res.data.result) {
                const satPerByte = Math.ceil(Number(utilsWallet.toCalculationUnit(res.data.result, { type: configWallet.WALLET_TYPE_UTXO } )) * 1.1)
                ret.fastest_satPerKB = satPerByte.toString()
                ret.fast_satPerKB = ret.fastest_satPerKB 
                ret.slow_satPerKB = ret.fastest_satPerKB 
                return ret
            }
        })
    }
    else if (symbol === 'DGB') {
        return axios.get(configExternal.dgbFeeOracle_Blockbook)
        .then(res => {
            if (res && res.data && res.data.result) {
                const satPerByte = Math.ceil(Number(utilsWallet.toCalculationUnit(res.data.result, { type: configWallet.WALLET_TYPE_UTXO } )) * 1.1)
                ret.fastest_satPerKB = satPerByte.toString()
                ret.fast_satPerKB = ret.fastest_satPerKB 
                ret.slow_satPerKB = ret.fastest_satPerKB 
                return ret
            }
        })
    }
    else if (symbol === 'BCHABC') {
        return axios.get(configExternal.bchabcFeeOracle_Blockbook)
        .then(res => {
            if (res && res.data && res.data.result) {
                const satPerByte = Math.ceil(Number(utilsWallet.toCalculationUnit(res.data.result, { type: configWallet.WALLET_TYPE_UTXO } )) * 1.1)
                ret.fastest_satPerKB = satPerByte.toString() * 10
                ret.fast_satPerKB =  satPerByte.toString() * 5
                ret.slow_satPerKB = satPerByte.toString()
                return ret
            }
        })
    }
    else {
        console.error(`## estimateFees_Utxo -- unsupported ${symbol}`)
    }

}

export function map_insightTxs(txs, ownAddresses) {
    return txs.map(tx => {

        // if (tx.txid === '58b601fe28b55730630e372eccd42f1b4b9ea04a499a82d164b209eb44d47f70') {
        //     debugger
        // }

        // we class a tx as outgoing if any of our addresses contributed to the utxo inputs; it is incoming otherwise. 
        // (doing it this way round correctly abstracts away or ignores change utxo outputs - they are at the utxo level "incoming")
        const isIncoming = tx.vin.some(p => {
            return ownAddresses.some(p2 => {
                return p2 === p.addr
            })
        }) === false

        var value = 0
        var toOrFrom
        var isFromShieldedAddr = false

        if (isIncoming) {
            if (tx.vin.length === 0) { // from a shielded addr?
                isFromShieldedAddr = true
                toOrFrom = "** shielded **"
            }
            else {
                toOrFrom = tx.vin[0].addr // there is no spoon. but let's pretend
            }
        }

        // special case: we sent to ourself -- all inputs and outputs are ours
        var sendToSelf = false
        if (tx.vout.every(p => {
            return ownAddresses.some(p2 => { // all outputs are ours
                return p.scriptPubKey && p.scriptPubKey.addresses && p.scriptPubKey.addresses[0] === p2
            })
        })) {

            if (tx.vin.length > 0 // inputs are not shielded
                && tx.vin.every(p => {
                return ownAddresses.some(p2 => { // all inputs are ours
                    return p.addr === p2
                })
            })) {

                value = 0
                toOrFrom = tx.vin[0].addr
                sendToSelf = true
            }
        }

        if (!sendToSelf) {
            for (var i = 0; i < tx.vout.length; i++) {

                // incoming: tx value is the value of the *sum* of the outpust that are to one of our addresses
                if (isIncoming && tx.vout[i].scriptPubKey.addresses //&& tx.vout[i].scriptPubKey.addresses[0] === address) {  
                    && ownAddresses.some(p => { return p === tx.vout[i].scriptPubKey.addresses[0] }) === true) {

                    value = Number(new BigNumber(value).plus(new BigNumber(tx.vout[i].value)))
                }

                // outgoing: tx value is the value of the *sum* of the outputs that are not our addresses (allows for sendmany tx's later)
                else if (!isIncoming && tx.vout[i].scriptPubKey.addresses //&& tx.vout[i].scriptPubKey.addresses[0] !== address) {
                    && ownAddresses.some(p => { return p === tx.vout[i].scriptPubKey.addresses[0] }) === false) {

                    value = Number(new BigNumber(value).plus(new BigNumber(tx.vout[i].value)))

                    toOrFrom = tx.vout[i].scriptPubKey.addresses[0] // still no spoon
                }
            }
        }

        // prune vin -- only our own inputs
        const pruned_vin = tx.vin
            .filter(p => { return ownAddresses.some(p2 => p2 == p.addr) })
            .map(p => { return {
                // these two are directly used
                addr: p.addr, valueSat: p.valueSat,

                // these not used, but probably will be useful - could prune them further
                txid: p.txid,
                sequence: p.sequence,
                vout: p.vout,
                n: p.n,
                
                // note - p.scriptSig is the storage killer
            }} )

        // prune vout completely -- not currently used
        const pruned_vout = []

        return { // EXTERNAL_TX
            isMinimal: false,
            isIncoming,
            sendToSelf,
            date: new Date(tx.time * 1000),
            value: value,
            txid: tx.txid,
            toOrFrom,
            block_no: tx.blockheight,
            fees: tx.fees,
            utxo_vin: pruned_vin, 
            utxo_vout: pruned_vout, 
            isFromShieldedAddr,
        }
    })
}