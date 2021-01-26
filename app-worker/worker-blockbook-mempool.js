// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2021 Dominic Morris.

const BigNumber = require('bignumber.js')
const InputDataDecoder = require('ethereum-input-data-decoder')

const configExternal = require('../config/wallet-external')
const decoder = new InputDataDecoder(require('../config/erc20ABI').abi)

const workerBlockbook = require('./worker-blockbook')
const walletUtxo = require('../actions/wallet-utxo')
const actionsWallet = require('../actions')

const utilsWallet = require('../utils')

module.exports = {

    //
    // ** get mempool tx's - using blockbook **
    //
    // BB v3 -- now all utxo types can get mempool tx's directly from their primary sources (insight API or Blockbook)
    // (so, this fn. so no longer required for BTC_SEG); it's only now needed for eth to get pending inbound...
    //
    //  -- but note, re. ETH:  (BB limitation?) we're not getting eth outbound mempool tx's
    //
    mempool_get_BB_txs: (asset, wallet) => { //}, callback) => {
        if (asset.symbol !== 'ETH' && asset.symbol !== 'ETH_TEST') { // nop unless ETH
            //callback([])
            return
        }

        var socket = self.get_BlockbookSocketIo(asset)
        if (socket === undefined) { 
            //callback([]); 
            return
        }

        try {
            const ownAddresses = asset.addresses.map(p => { return p.addr })
            utilsWallet.debug(`appWorker >> ${self.workerId} mempool_get_BB_txs - ${asset.symbol} - fetching mempool for addresses:`, ownAddresses)

            const mempool_spent_txids = []
            socket.send({ method: 'getAddressTxids', params: [ownAddresses, { /*start: 20000000, end: 0,*/ queryMempoolOnly: true }] }, (data) => {
                
                utilsWallet.debug(`${asset.symbol} - getAddressTxids data`, data)

                if (data && data.result) {
                    var mempool_txids = data.result

                    if (mempool_txids.length > 0) {
                        //if (asset.symbol === 'ETH') {
                            // can't getDetailedTransaction for ETH from BB (just doesn't return data); must use web3

                            const web3 = self.ws_web3[asset.symbol] // socket instance
                            if (!web3) {
                                utilsWallet.warn(`appWorker >> ${self.workerId} mempool_get_BB_txs - ${asset.symbol} - singleton web3 socket provider is not available!`); return
                            }

                            const allTxFetches = mempool_txids.map(txid => {
                                return new Promise((resolve, reject) => {
                                    // we got the mempool entry from BB, but we're calling web3 against a different node... not at all ideal!
                                    //utilsWallet.log(`appWorker >> ${self.workerId} mempool_get_BB_txs - ${asset.symbol} - web3 getTx, txid=`, txid)

                                    web3.eth.getTransaction(txid)
                                        .then((tx) => {
                                            if (tx !== undefined && tx !== null) { // observed
                                                //utilsWallet.log('eth mempool tx detail (from web3)=', tx)

                                                // blockbook is giving us confirmed tx's sometimes in it's "mempool" (sometimes days old)
                                                if (tx.blockNumber !== null) {
                                                    utilsWallet.warn(`appWorker >> ${self.workerId} mempool_get_BB_txs - ${asset.symbol} - got a confirmed tx from blockbook mempool: ignoring! tx=`, tx)
                                                }
                                                else {
                                                    const erc20s = Object.keys(configExternal.erc20Contracts).map(p => { return { erc20_addr: configExternal.erc20Contracts[p], symbol: p } })
                                                    const erc20 = erc20s.find(p => { return p.erc20_addr.toLowerCase() === tx.to.toLowerCase() })
                                                    const weAreSender = ownAddresses.some(ownAddr => ownAddr.toLowerCase() === tx.from.toLowerCase())
                                                    mempool_process_BB_EthTx(web3, wallet, asset, txid, tx, weAreSender, erc20)
                                                }
                                            }
                                            resolve()
                                        })
                                })
                            })
                            Promise.all(allTxFetches)
                                .then((values) => { // done adding local_tx, if any
                                    // could do -- remove any local_tx that aren't in the mempool, e.g...
                                    // wallet.assets.forEach(walletAsset => {
                                    //     if (walletAsset.symbol === 'ETH' || walletAsset.symbol === 'ETH_TEST' || utilsWallet.isERC20(walletAsset)) {
                                    //         const remove_local_txids = walletAsset.local_txs.filter(p => { return !mempool_txids.some(p2 => p2 === p.txid) })
                                    //         utilsWallet.log(`TODO: remove local_tx(s) from ${walletAsset.symbol}`, remove_local_txids)
                                    //     }
                                    // })
                                    //web3 = null
                                    //callback([])
                                })
                        //}
                        // not needed, now btc_seg is using BB with proper segwit support
                        /*else if (asset.symbol === 'BTC_SEG') {
                            //debugger
                            const allTxFetches = mempool_txids.map(txid => {
                                return new Promise((resolve, reject) => {

                                    socket.send({ method: 'getDetailedTransaction', params: [txid] }, (bb_txData) => {
                                        if (bb_txData && bb_txData.result) {
                                            const tx = bb_txData.result
                                            //utilsWallet.log('blockbook mempool tx = ', tx)

                                            const weAreSender = tx.inputs.some(p => { return ownAddresses.some(p2 => p2 === p.address) })
                                            mempool_process_BB_UtxoTx(wallet, asset, txid, tx, weAreSender, ownAddresses, mempool_spent_txids)
                                        }
                                        resolve()
                                    })
                                })
                            })
                            Promise.all(allTxFetches)
                                .then((values) => { // done adding local_tx, if any
                                    utilsWallet.log(`appWorker >> ${self.workerId} mempool_get_BB_txs - ${asset.symbol} - got ${mempool_spent_txids.length} spent txids in the mempool...`, mempool_spent_txids)
                                    callback(mempool_spent_txids)
                                })
                        }*/
                        //else callback([])
                    }
                    //else callback([])
                }
                //else callback([])
            })
        }
        catch (err) {
            utilsWallet.error(`### appWorker >> ${self.workerId} mempool_get_BB_txs - ${asset.symbol}, err=`, err)
            callback([])
        }
    },

    //
    // these blockbook processors are shared: used by the by direct mempool query (above) and also
    // used by the worker-addr-monitor on receipt of bitcoind/addresstxid data
    //
    mempool_process_BB_UtxoTx: (web3, wallet, asset, txid, tx, weAreSender, erc20) => {
        return mempool_process_BB_UtxoTx(web3, wallet, asset, txid, tx, weAreSender, erc20)
    },

    mempool_process_BB_EthTx: (web3, wallet, asset, txid, tx, weAreSender, erc20) => {
        return mempool_process_BB_EthTx(web3, wallet, asset, txid, tx, weAreSender, erc20)
    }
}

function mempool_process_BB_UtxoTx(wallet, asset, txid, tx, weAreSender, ownAddresses, mempool_spent_txids) {
    
    // send to self - all inputs and outputs are ours
    
    //debugger
    const sendToSelf = 
        tx.inputs.every(p => ownAddresses.some(p2 => p2 === p.address))
    && tx.outputs.every(p => ownAddresses.some(p2 => p2 === p.address))

    if (weAreSender) {

        // keep track of utxos input txids, for removal from the lagging insight-api utxo list
        tx.inputs.map(p => { return p.txid }).forEach(txid => {
            mempool_spent_txids.push(txid)
        })

        // push local_tx - outbound
        ownAddresses.forEach(ownAddr => {

            const du_fee = Number(new BigNumber(tx.feeSatoshis).div(100000000))

            const valueFromAddr = tx.inputs
                .filter(input => { return input.address === ownAddr })
                .reduce((sum, p) => { return sum.plus(new BigNumber(p.satoshis).div(100000000)) }, new BigNumber(0))

            const valueChange = tx.outputs
                .filter(output => { return ownAddresses.some(addr => { return addr === output.address }) })
                .reduce((sum, p) => { return sum.plus(new BigNumber(p.satoshis).div(100000000)) }, new BigNumber(0))

            const netValueSent = Number(valueFromAddr.minus(valueChange).minus(new BigNumber(du_fee)))

            if (valueFromAddr.isGreaterThan(0)) {
                if (!asset.local_txs.some(p => p.txid === txid) && // not in local_txs
                    !asset.addresses.some(addr => addr.txs.some(tx => tx.txid === txid))) // not in external txs
                {
                    const outbound_tx = { // LOCAL_TX (UTXO) OUT
                        sendToSelf,
                        isIncoming: false,
                        date: new Date(),
                        value: Number(netValueSent),
                        txid,
                        toOrFrom: tx.outputs[0].address,
                        block_no: -1,
                        fees: du_fee
                    }
                    postMessage({
                        msg: 'REQUEST_DISPATCH', status: 'DISPATCH',
                        data: {
                            dispatchType: actionsWallet.WCORE_PUSH_LOCAL_TX,
                         dispatchPayload: { symbol: asset.symbol, tx: outbound_tx }
                        }
                    })
                }
            }
        })
    }
    else {
        // push local_tx - inbound
        ownAddresses.forEach(ownAddr => {
            const valueToAddr = tx.outputs
                .filter(p => { return p.address === ownAddr })
                .reduce((sum, p) => { return sum.plus(new BigNumber(p.satoshis).div(100000000)) }, new BigNumber(0))

            if (valueToAddr.isGreaterThan(0) 
                || tx.outputs.some(p => p.address === ownAddr) // DMS: we want to pick up by-design zero-value dsigCltv outputs immediately
            ) {
                if (!asset.local_txs.some(p => p.txid === txid) &&
                    !asset.addresses.some(addr => addr.txs.some(tx => tx.txid === txid))) {
                    const inbound_tx = { // LOCAL_TX (UTXO) IN
                        sendToSelf,
                        isIncoming: true,
                        date: new Date(),
                        value: Number(valueToAddr),
                        txid,
                        toOrFrom: tx.inputs[0].address, // there is no spoon
                        block_no: -1,
                        fees: Number(new BigNumber(tx.feeSatoshis).div(100000000))
                    }

                    utilsWallet.log(`mempool_process_BB_UtxoTx - ${txid} REQUEST_DISPATCH: WCORE_PUSH_LOCAL_TX...`)

                    postMessage({
                         msg: 'REQUEST_DISPATCH', status: 'DISPATCH',
                        data: {
                            dispatchType: actionsWallet.WCORE_PUSH_LOCAL_TX,
                         dispatchPayload: { symbol: asset.symbol, tx: inbound_tx }
                        }
                    })
                }
            }
        })
    }

    // DMS TODO - we need to enrich the local_tx w/ p_op data;
    //      (to do this, we trigger getAddressFull_Blockbook_v3() ... ... 'REFRESH_ASSET_FULL')
    //  OR, maybe this should happen after the non-std address has been added...
    //postMessage({ msg: 'REQUEST_REFRESH_ASSET_FULL', status: 'REFRESH', data: { symbol: asset.symbol } })
}

function mempool_process_BB_EthTx(web3, wallet, asset, txid, tx, weAreSender, erc20) {
    var new_local_tx

    //
    // ** ETH: if we are receiver... **
    //         hard requirement: this is the only way receiver will get notified, ahead of a new block with the confirmed tx
    //
    // ** ETH: if we are sender... **
    //         BB (own nodes and trezor nodes) are *not* giving us our own tx's in mempool (?!)
    //

    var inboundSymbol
    const ownAddresses = asset.addresses.map(p => p.addr)

    utilsWallet.log('mempool_process_BB_EthTx: erc20=', erc20)
    if (erc20 !== undefined) { // ERC20
        inboundSymbol = erc20.symbol

        const decodedData = decoder.decodeData(tx.input)

        const erc20Asset = wallet.assets.find(p => { return p.symbol === inboundSymbol })

        const txAlready_in_local_txs = erc20Asset.local_txs.some(p => p.txid === txid)
        const txAlready_in_external_txs = asset.addresses.some(addr => addr.txs.some(tx => tx.txid === txid))
        if (txAlready_in_external_txs) { 
            utilsWallet.warn(`mempool_process_BB_EthTx ${inboundSymbol} - mempool_process_BB_EthTx - got confirmed tx from BB reported in mempool - will ignore (txid=${txid})`)
        }
        if (txAlready_in_local_txs) { 
            utilsWallet.warn(`mempool_process_BB_EthTx ${inboundSymbol} - got tx from BB already in local_tx - will ignore (txid=${txid})`)
        }
        utilsWallet.log(`mempool_process_BB_EthTx ${inboundSymbol} - ${txid} txAlready_in_local_txs=${txAlready_in_local_txs}, txAlready_in_external_txs=${txAlready_in_external_txs}`)

        if (!txAlready_in_local_txs && !txAlready_in_external_txs) {
            if (decodedData) {
                if (decodedData.method === "transfer" && decodedData.inputs && decodedData.inputs.length > 1) {

                    const param_to = '0x' + decodedData.inputs[0] 
                    const tokenValue = decodedData.inputs[1] 

                    const sendToSelf =
                       ownAddresses.some(ownAddr => ownAddr.toLowerCase() === param_to.toLowerCase())
                    && ownAddresses.some(ownAddr => ownAddr.toLowerCase() === tx.from.toLowerCase())

                    const du_value = utilsWallet.toDisplayUnit(new BigNumber(tokenValue), erc20Asset)
                    
                    if (erc20Asset && tokenValue) {
                        new_local_tx = { // LOCAL_TX (ERC20) IN or OUT
                            erc20: erc20Asset.symbol,
                            erc20_contract: tx.to,
                            txid,
                            isIncoming: !weAreSender,
                            sendToSelf, 

                            date: new Date(),
                            value: Number(du_value),
                            toOrFrom: tx.from,
                            account_to: param_to.toLowerCase(),
                            account_from: tx.from.toLowerCase(),
                            block_no: -1,
                            fees: weAreSender
                                ? Number((new BigNumber(tx.gas).div(new BigNumber(1000000000))).times((new BigNumber(tx.gasPrice).div(new BigNumber(1000000000)))))
                                : 0
                        }
                    }
                }
            }
        }
    }
    else { // ETH || ETH_TEST
        inboundSymbol = asset.symbol

        const txAlready_in_local_txs = asset.local_txs.some(p => p.txid === txid)
        const txAlready_in_external_txs = asset.addresses.some(addr => addr.txs.some(tx => tx.txid === txid))
        if (txAlready_in_external_txs) { 
            utilsWallet.warn(`mempool_process_BB_EthTx ${inboundSymbol} - got confirmed tx from BB reported in mempool - will ignore (txid=${txid})`)
        }
        if (txAlready_in_local_txs) { 
            utilsWallet.warn(`mempool_process_BB_EthTx ${inboundSymbol} - got tx from BB already in local_tx - will ignore (txid=${txid})`)
        }
        utilsWallet.log(`mempool_process_BB_EthTx ${inboundSymbol} - ${txid} txAlready_in_local_txs=${txAlready_in_local_txs}, txAlready_in_external_txs=${txAlready_in_external_txs}`)

        if (!txAlready_in_local_txs && !txAlready_in_external_txs) {

            const sendToSelf =
                ownAddresses.some(ownAddr => ownAddr.toLowerCase() === tx.to.toLowerCase())
             && ownAddresses.some(ownAddr => ownAddr.toLowerCase() === tx.from.toLowerCase())

            new_local_tx = { // LOCAL_TX (ETH) IN or OUT
                txid,
                isIncoming: !weAreSender, 
                sendToSelf,

                date: new Date(),
                value: Number(web3.utils.fromWei(tx.value, 'ether')),
                toOrFrom: tx.from,
                account_to: tx.to.toLowerCase(), 
                account_from: tx.from.toLowerCase(),
                block_no: -1, 
                fees: weAreSender
                    ? Number((new BigNumber(tx.gas).div(new BigNumber(1000000000))).times((new BigNumber(tx.gasPrice).div(new BigNumber(1000000000)))))
                    : 0
            }
        }
    }

    // write new local_tx, if any
    if (new_local_tx !== undefined) {
        utilsWallet.log(`mempool_process_BB_EthTx ${inboundSymbol} - ${txid} REQUEST_DISPATCH: WCORE_PUSH_LOCAL_TX...`)

        postMessage({
            msg: 'REQUEST_DISPATCH', status: 'DISPATCH',
            data: {
                dispatchType: actionsWallet.WCORE_PUSH_LOCAL_TX,
             dispatchPayload: { symbol: inboundSymbol, tx: new_local_tx }
            }
        })
    }
}
