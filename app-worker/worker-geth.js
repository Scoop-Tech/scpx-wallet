// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.

const CircularBuffer = require("circular-buffer")
const isoWs = require('isomorphic-ws')

const actionsWallet = require('../actions')

const configWS = require('../config/websockets')
const configWallet = require('../config/wallet')
const configExternal = require('../config/wallet-external')

const utilsWallet = require('../utils')

module.exports = {
    getSyncInfo_Geth: (symbol, receivedBlockNo = undefined, receivedBlockTime = undefined, networkStatusChanged = undefined) => {
        return getSyncInfo_Geth(symbol, receivedBlockNo, receivedBlockTime, networkStatusChanged)
    },

    // geth tx and block subscriptions (diagnostics and balance polling, respectively)
    // considered VOLATILE -- no built-in reconnect
    isosocket_Setup_Geth: (networkConnected, networkStatusChanged, loaderWorker) => {
        var setupCount = 0
        utilsWallet.debug(`appWorker >> ${self.workerId} geth_Setup...`)

        for (var assetSymbol in configWS.geth_ws_config) {
            if (assetSymbol === 'ETH_TEST' && !configWallet.WALLET_INCLUDE_ETH_TEST) continue

            setupCount +=
                (function (x) {

                    // if we're called more than once, then the socket object already exists
                    if (self.geth_Sockets[x] !== undefined) { // safari refocus handling

                        // it may however be disconnected (e.g. when resuming from phone lock)
                        // in this case, we detect it here and tear down the socket 
                        if (self.geth_Sockets[x].readyState == 2 || self.geth_Sockets[x].readyState == 3) { // if "closing" or "closed" respectively (connecting=0, open=1)

                            utilsWallet.warn(`appWorker >> ${self.workerId} isosocket_Setup_Geth - ${x}: found disconnected socket for ${x} - nuking it!`)

                            self.geth_Sockets[x].close()
                            self.geth_Sockets[x] = undefined

                            // rest of this fn. will now recreate the socket
                        }
                    }

                    // initial / main path
                    if (self.geth_Sockets[x] === undefined) { // connect & init
                        // networkConnected(x, true) // init UI
                        // networkStatusChanged(x, null)
    
                        utilsWallet.debug(`appWorker >> ${self.workerId} isosocket_Setup_Geth ${x}, wsUrl=`, configWS.geth_ws_config[x].url, { logServerConsole: true })

                        //debugger
                        self.geth_Sockets[x] = new isoWs(configWS.geth_ws_config[x].url) //, { origin: 'https://x.scoop.tech' } 
                        var socket = self.geth_Sockets[x]

                        //
                        // socket lifecycle
                        //
                        socket.onopen = () => {
                            utilsWallet.debug(`appWorker >> ${self.workerId} isosocket_Setup_Geth ${x} - connect...`)
                            try {
                                if (!loaderWorker) {
                                    networkConnected(x, true)
                                    networkStatusChanged(x, { geth_url: configWS.geth_ws_config[x].url})

                                    // subscribe new tx
                                    socket.send(`{"method":"eth_subscribe","params":["newPendingTransactions"],"id":1,"jsonrpc":"2.0"}`)

                                    // subscribe new blocks
                                    if (configWS.geth_ws_config[x].subBlocks === true) {
                                        socket.send(`{"method":"eth_subscribe","params":["newHeads"],"id":2,"jsonrpc":"2.0"}`)
                                    }

                                    // test - sub TUSD
                                    //socket.send(`{"method":"eth_subscribe","params":["logs", {"address": "0x0000000000085d4780b73119b644ae5ecd22b376"}],"id":3,"jsonrpc":"2.0"}`)
                                }
                            }
                            catch (err) { utilsWallacket.error(`### appWorker >> ${self.workerId} isosocket_Setup_Geth ${x} - connect, err=`, err) }
                        }
                        socket.onclose = () => {
                            utilsWallet.warn(`appWorker >> ${self.workerId} isosocket_Setup_Geth ${x} - onclose...`)
                            self.geth_Sockets[x] = undefined // nuke this so volatileSockets_ReInit() triggers another setup
                            try {
                                if (!loaderWorker) {
                                    networkConnected(x, false)
                                    networkStatusChanged(x, { geth_url: configWS.geth_ws_config[x].url})
                                }
                            }
                            catch (err) { utilsWallet.error(`### appWorker >> ${self.workerId} isosocket_Setup_Geth ${x} - onclose callback, err=`, err) }
                        }
                        socket.onerror = (e) => {
                            utilsWallet.warn(`appWorker >> ${self.workerId} isosocket_Setup_Geth ${x} - onerror...`)
                            self.geth_Sockets[x] = undefined 
                            try {
                                if (!loaderWorker) {
                                    networkConnected(x, false)
                                    networkStatusChanged(x, { geth_url: configWS.geth_ws_config[x].url })
                                }
                            }
                            catch (err) { utilsWallet.error(`### appWorker >> ${self.workerId} isosocket_Setup_Geth ${x} - onerror callback, err=`, err) }
                        }
                        console.log('socket', socket)

                        //                                  
                        // subscriptions - new tx's and new blocks
                        //
                        if (!loaderWorker) {
                            var tx_subId
                            var block_subId
                            //var tusd_subId
    
                            socket.onmessage = (msg) => {
                                if (msg && msg.data) {
                                    const o_data = JSON.parse(msg.data)

                                    if (o_data.id) {
                                        if (o_data.id == 1) { // tx sub ID
                                            tx_subId = o_data.result
                                            utilsWallet.debug(`appWorker >> ${self.workerId} isosocket_Setup_Geth ${x} - tx sub setup, id=`, tx_subId)
                                        }
                                        else if (o_data.id == 2) { // block sub ID
                                            block_subId = o_data.result
                                            utilsWallet.debug(`appWorker >> ${self.workerId} isosocket_Setup_Geth ${x} - block sub setup, id=`, block_subId)
                                        }
                                        // else if (o_data.id == 3) { // test sub TUSD
                                        //     tusd_subId = o_data.result
                                        //     utilsWallet.log(`appWorker >> ${self.workerId} isosocket_Setup_Geth ${x} - TUSD-test sub setup, id=`, tusd_subId)
                                        // }
                                    }

                                    else if (o_data.method && o_data.method === "eth_subscription" && o_data.params) {
                                        // if (o_data.params.subscription === tusd_subId) {
                                        //     utilsWallet.log(`appWorker >> ${self.workerId} isosocket_Setup_Geth ${x} - TUSD-test sub DATA, o_data.params.result=`, o_data.params.result)
                                        // }
                                        if (o_data.params.subscription === tx_subId) {
                                            //console.log('o_data', o_data)
                                            //utilsWallet.log(`appWorker >> ${self.workerId} GETH WS ${x} - isoWS - TX`)

                                            // ###
                                            //
                                            // circular buffer for slightly better mempool tps est.?
                                            //
                                            // change footer ui so it can update tps OR last tx OR ... (not all at same time)
                                            //
                                            // add block TPS (actual) distinct from mempool tps (insight & geth)
                                            //

                                            const txid = o_data.params.result
                                            // if (!self.gethAllTxs[x]) self.gethAllTxs[x] = []
                                            // if (self.gethAllTxs[x].includes(txid.toLowerCase())) {
                                            //     console.warn(`dupe geth txid ${x}!`, txid)
                                            // }
                                            // else  {
                                                // calc mempool tps (actually, the rate at which we're streaming from the mempool;
                                                // geth seems to want to give us all the current mempool tx's, not just new ones)
                                                const BUF_CAP = 50
                                                var mempool_tps = 0
                                                if (!self.mempool_tpsBuf[x]) self.mempool_tpsBuf[x] = new CircularBuffer(BUF_CAP)
                                                if (!self.mempool_tot[x]) self.mempool_tot[x] = 0
                                                //console.log(self.mempool_tpsBuf[x])
                                                if (!self.mempool_tpsBuf[x].toarray().some(p => p.txid == txid)) {
                                                    self.mempool_tpsBuf[x].push({ txid, timestamp: new Date().getTime() })
                                                    self.mempool_tot[x]++
                                                    //console.log('pushed...')
                                                }
                                                //console.log(`${x}: mempool_tpsBuf[x].size()=${mempool_tpsBuf[x].size()}`)
                                                if (mempool_tpsBuf[x].size() == BUF_CAP) {
                                                    const buf1 = mempool_tpsBuf[x].get(0)
                                                    const buf2 = mempool_tpsBuf[x].get(BUF_CAP - 1)
                                                    const ms = buf2.timestamp - buf1.timestamp
                                                    mempool_tps = BUF_CAP / (ms/1000)
                                                    //console.log(`${x}: tot=${self.mempool_tot[x]} buf1=${buf1.timestamp} buf2=${buf2.timestamp} ms=${ms} tps=${tps}`)
                                                }


                                                // throttle these to max n per sec
                                                //const sinceLastTx = new Date().getTime() - self.lastTx[x]
                                                //if (isNaN(sinceLastTx) || sinceLastTx > 500) {
                                                //    self.lastTx[x] = new Date().getTime()

                                                    // ## the rate calc'd above is the streaming rate of all txpool to client; it's not rate of newly
                                                    // added to txpool - behaviour is confusing/different compared to insight mempool subscription
                                                    networkStatusChanged(x, { txid, 
                                                        mempool_tps: 0, // ## don't pass the value in - it's not accurate
                                                        geth_url: configWS.geth_ws_config[x].url })
                                                        
                                                //}
                                            //}
                                        }
                                        else if (o_data.params.subscription === block_subId) {
                                            if (!configWallet.DISABLE_BLOCK_UPDATES) {

                                                if (configWS.geth_ws_config[x].subBlocks === false) {
                                                    utilsWallet.debug(`appWorker >> ${self.workerId} GETH BLOCK WS ${x} - ignoring block: subBlocks=false`)
                                                }
                                                else {
                                                    const blockData = o_data.params.result
                                                    const receivedBlockNo = parseInt(blockData.number, 16)
                                                    const receivedBlockTime = new Date(blockData.timestamp * 1000)

                                                    if (!self.geth_BlockNos[x]) self.geth_BlockNos[x] = []
                                                    if (self.geth_BlockNos[x].some(p => p === receivedBlockNo)) {
                                                        utilsWallet.warn(`appWorker >> ${self.workerId} GETH BLOCK WS ${x} - ${receivedBlockNo} ${receivedBlockTime} - ignoring, already seen this blockNo`)
                                                    }
                                                    else {
                                                        self.geth_BlockNos[x].push(receivedBlockNo)
                                                        
                                                        utilsWallet.logMajor('blue','white', `appWorker >> ${self.workerId} GETH BLOCK WS ${x} - ${receivedBlockNo} ${receivedBlockTime}`) //, blockData)
                                                        try {
                                                            const dispatchActions = []

                                                            // save blockheight & time on asset eth[_test] asset
                                                            // dispatchActions.push({
                                                            //     type: actionsWallet.SET_ASSET_BLOCK_INFO,
                                                            //  payload: { symbol: x, receivedBlockNo, receivedBlockTime }
                                                            // })

                                                            // // update lights - block tps
                                                            // networkStatusChanged(x, { txid: undefined, mempool_tps: undefined, 
                                                            //     block_no: receivedBlockNo })
                                                            getSyncInfo_Geth(x, receivedBlockNo, undefined, networkStatusChanged)

                                                            // requery balance check for asset on new block - updates confirmed counts (this will trigger erc20 refresh from 3PBP as necessary)
                                                            self.postMessage({ 
                                                                 msg: 'REQUEST_STATE', status: 'REQ',
                                                                data: { stateItem: 'ASSET', stateKey: x, context: 'ASSET_REFRESH_NEW_BLOCK' }
                                                            })
                                                            
                                                            // eth - same for all erc20s
                                                            //if (x === 'ETH' || x === 'ETH_TEST') {
                                                                const erc20_symbols = Object.keys(configExternal.erc20Contracts)
                                                                erc20_symbols.forEach(erc20_symbol => {

                                                                    const meta = configWallet.getMetaBySymbol(erc20_symbol)
                                                                    //console.log(`GETH ${x} -> ${erc20_symbol} -> ${meta.isErc20_Ropsten}`)
                                                                    if ((x === 'ETH'      && !meta.isErc20_Ropsten)
                                                                     || (x === 'ETH_TEST' && meta.isErc20_Ropsten)) {

                                                                        // save blockheight & time on asset erc20 asset
                                                                        dispatchActions.push({
                                                                            type: actionsWallet.SET_ASSET_BLOCK_INFO,
                                                                         payload: { symbol: erc20_symbol, receivedBlockNo, receivedBlockTime }
                                                                        })

                                                                        //
                                                                        // todo? (perf - but probably rapidly diminishing returns here)
                                                                        //  change REQUEST_STATE to accept [] of asset for update in 
                                                                        //  a single batch via ASSET_REFRESH_NEW_BLOCK -> refreshAssetFull/refreshAssetBalance
                                                                        //   (the latter two fn's would return [] of dispatchActions and caller (worker.js) would 
                                                                        //    send one batch of actions to update eth+[erc20's] in one hit)
                                                                        //
                                                                        self.postMessage({ 
                                                                            msg: 'REQUEST_STATE', status: 'REQ',
                                                                           data: { stateItem: 'ASSET', stateKey: erc20_symbol, context: 'ASSET_REFRESH_NEW_BLOCK' } 
                                                                        })
                                                                    }
                                                                })
                                                            //}

                                                            // update batch
                                                            self.postMessage({ msg: 'REQUEST_DISPATCH_BATCH', status: 'DISPATCH', data: { dispatchActions } })
                                                        }
                                                        catch (err) { utilsWallet.error(`### appWorker >> ${self.workerId} GETH BLOCK ${x}, err=`, err) }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        return 1
                    }
                    return 0
                })(assetSymbol)
        }
        return setupCount
    }
}

async function getSyncInfo_Geth(symbol, _receivedBlockNo = undefined, _receivedBlockTime = undefined, networkStatusChanged = undefined) {
    if (symbol !== 'ETH' && symbol !== 'ETH_TEST') return

    if (!self.ws_web3[symbol] || self.ws_web3[symbol].currentProvider.connection.readyState != 1) {
        utilsWallet.warn(`appWorker >> ${self.workerId} getSyncInfo_Geth ${symbol} - ignoring: web3 WS not setup & ready for asset`)
        return
    }

    // get block - exact time & tx count
    const receivedBlockNo = _receivedBlockNo || (await self.ws_web3[symbol].eth.getBlockNumber())
    const curBlock = await self.ws_web3[symbol].eth.getBlock(receivedBlockNo)
    const txCount = curBlock.transactions.length
    const receivedBlockTime = /*_receivedBlockTime ||*/ curBlock.timestamp

    self.postMessage({ msg: 'REQUEST_DISPATCH_BATCH', status: 'DISPATCH', data: { dispatchActions: [{ 
        type: actionsWallet.SET_ASSET_BLOCK_INFO,
     payload: { symbol, receivedBlockNo, receivedBlockTime }} ] }
    })

    // get prev block - exact time; for block TPS
    if (!self.blocks_time[symbol]) self.blocks_time[symbol] = []
    if (!self.blocks_time[symbol][receivedBlockNo - 1]) {
        const prevBlock = await self.ws_web3[symbol].eth.getBlock(receivedBlockNo - 1)
        self.blocks_time[symbol][receivedBlockNo - 1] = prevBlock.timestamp
    }
    const prevBlockTime = self.blocks_time[symbol][receivedBlockNo - 1]
    const block_time = receivedBlockTime - prevBlockTime
    const block_tps = block_time > 0 ? txCount / block_time : 0

    // console.log(`${symbol} blockData`, blockData)
    // console.log(`${symbol} txCount`, txCount)
    // console.log(`${symbol} receivedBlockTime`, receivedBlockTime)

    // update lights - block tps
    if (networkStatusChanged) {
        networkStatusChanged(symbol, { 
             block_no: receivedBlockNo, 
        block_txCount: txCount,
            block_tps,
           block_time,
             geth_url: configWS.geth_ws_config[symbol].url
        })
    }
}
