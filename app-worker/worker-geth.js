// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.

const isoWs = require('isomorphic-ws')

const actionsWallet = require('../actions')

const configWS = require('../config/websockets')
const configWallet = require('../config/wallet')
const configExternal = require('../config/wallet-external')

const utilsWallet = require('../utils')


module.exports = {
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
                    if (self.gethSockets[x] !== undefined) { // safari refocus handling

                        // it may however be disconnected (e.g. when resuming from phone lock)
                        // in this case, we detect it here and tear down the socket 
                        if (self.gethSockets[x].readyState == 2 || self.gethSockets[x].readyState == 3) { // if "closing" or "closed" respectively (connecting=0, open=1)

                            utilsWallet.warn(`appWorker >> ${self.workerId} isosocket_Setup_Geth - ${x}: found disconnected socket for ${x} - nuking it!`)

                            self.gethSockets[x].close()
                            self.gethSockets[x] = undefined

                            // rest of this fn. will now recreate the socket
                        }
                    }

                    // initial / main path
                    if (self.gethSockets[x] === undefined) { // connect & init

                        utilsWallet.debug(`appWorker >> ${self.workerId} isosocket_Setup_Geth ${x}, wsUrl=`, configWS.geth_ws_config[x].url, { logServerConsole: true })

                        //debugger
                        self.gethSockets[x] = new isoWs(configWS.geth_ws_config[x].url) //, { origin: 'https://x.scoop.tech' } 
                        var socket = self.gethSockets[x]

                        //
                        // socket lifecycle
                        //
                        socket.onopen = () => {
                            utilsWallet.debug(`appWorker >> ${self.workerId} isosocket_Setup_Geth ${x} - connect...`)
                            try {
                                if (!loaderWorker) {
                                    networkConnected(x, true)
                                    networkStatusChanged(x)

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
                            self.gethSockets[x] = undefined // nuke this so volatileSockets_ReInit() triggers another setup
                            try {
                                if (!loaderWorker) {
                                    networkConnected(x, false)
                                    networkStatusChanged(x)
                                }
                            }
                            catch (err) { utilsWallet.error(`### appWorker >> ${self.workerId} isosocket_Setup_Geth ${x} - onclose callback, err=`, err) }
                        }

                        //                                  
                        // subscriptions - new tx's and new blocks
                        //
                        if (!loaderWorker) {
                            var tx_subId
                            var block_subId
                            //var tusd_subId
    
                            socket.onmessage = (msg) => {
                                if (msg && msg.data) {
                                    const o_data = JSON.parse(msg.data) // perf?

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
                                            //utilsWallet.log(`appWorker >> ${self.workerId} GETH WS ${x} - isoWS - TX`)

                                            // throttle these to max n per sec
                                            const sinceLastTx = new Date().getTime() - self.lastTx[x]
                                            if (isNaN(sinceLastTx) || sinceLastTx > 200) {
                                                self.lastTx[x] = new Date().getTime()
                                                networkStatusChanged(x, o_data.params.result)
                                            }
                                        }
                                        else if (o_data.params.subscription === block_subId) {
                                            if (!configWallet.DISABLE_BLOCK_UPDATES)  {

                                                if (configWS.geth_ws_config[x].subBlocks === false) {
                                                    utilsWallet.debug(`appWorker >> ${self.workerId} GETH BLOCK WS ${x} - ignoring block: subBlocks=false`)
                                                }
                                                else {
                                                    const blockData = o_data.params.result
                                                    const receivedBlockNo = parseInt(blockData.number, 16)
                                                    const receivedBlockTime = new Date(blockData.timestamp * 1000)

                                                    if (self.gethBlockNos.some(p => p === receivedBlockNo)) {
                                                        utilsWallet.warn(`appWorker >> ${self.workerId} GETH BLOCK WS ${x} - ${receivedBlockNo} ${receivedBlockTime} - ignoring, already seen this blockNo`)
                                                    }
                                                    else {
                                                        self.gethBlockNos.push(receivedBlockNo)
                                                        
                                                        utilsWallet.logMajor('blue','white', `appWorker >> ${self.workerId} GETH BLOCK WS ${x} - ${receivedBlockNo} ${receivedBlockTime}`) //, blockData)
                                                        try {
                                                            const dispatchActions = []

                                                            // save blockheight & time on asset
                                                            dispatchActions.push({
                                                                type: actionsWallet.SET_ASSET_BLOCK_INFO,
                                                            payload: { symbol: x, receivedBlockNo, receivedBlockTime }
                                                            })

                                                            // requery balance check for asset on new block - updates confirmed counts (this will trigger erc20 refresh from 3PBP as necessary)
                                                            self.postMessage({ 
                                                                 msg: 'REQUEST_STATE', status: 'REQ',
                                                                data: { stateItem: 'ASSET', stateKey: x, context: 'ASSET_REFRESH_NEW_BLOCK' }
                                                            })
                                                            
                                                            // eth mainnet - same for all erc20s
                                                            if (x === 'ETH') {
                                                                const erc20_symbols = Object.keys(configExternal.erc20Contracts)
                                                                erc20_symbols.forEach(erc20_symbol => {

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
                                                                })
                                                            }

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
