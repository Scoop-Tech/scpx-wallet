// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2021 Dominic Morris.

const CircularBuffer = require("circular-buffer")
const io  = require('socket.io-client')
const axios = require('axios')
//const axiosRetry = require('axios-retry')
const BigNumber = require('bignumber.js')

const configWS = require('../config/websockets')
const configExternal = require('../config/wallet-external')
const configWallet = require('../config/wallet')

const actionsWallet = require('../actions')
const walletUtxo = require('../actions/wallet-utxo')

const utilsWallet = require('../utils')

module.exports = {

    // insight tx and block subscriptions (diagnostics and balance polling, respectively)
    socketio_Setup_Insight: (networkConnected, networkStatusChanged, loaderWorker) => {
        //utilsWallet.debug('appWorker >> ${self.workerId} insight_Setup...')

        for (var assetSymbol in configWS.insightApi_ws_config) {
            if (assetSymbol === 'LTC_TEST' && !configWallet.WALLET_INCLUDE_LTC_TEST) continue
            if (assetSymbol === 'ZEC_TEST' && !configWallet.WALLET_INCLUDE_ZEC_TEST) continue
            if (assetSymbol === 'BTC_TEST' && !configWallet.WALLET_INCLUDE_BTC_TEST) continue

            (function (x) {
                try {

                    // if we're called more than once, then the socket object already exists
                    if (self.insightSocketIos[x] !== undefined) { // safari refocus handling

                        // it may however be disconnected (e.g. when resuming from phone lock)
                        // in this case, we detect it here and tear down the socket 
                        if (self.insightSocketIos[x].connected === false) {

                            utilsWallet.warn(`appWorker >> ${self.workerId} INSIGHT WS ${x} - io: found disconnected socket for ${x} - nuking it!`)

                            // important to tear down this existing socket properly (duplicates otherwise, and duplicate event handlers & flows - very bad)
                            self.insightSocketIos[x].off()
                            self.insightSocketIos[x].disconnect()
                            self.insightSocketIos[x] = undefined

                            // rest of this fn. will now recreate the socket
                        }
                    }

                    // initial / main path
                    if (self.insightSocketIos[x] === undefined) { // connect & init
                        //networkConnected(x, true) // init UI
                        //networkStatusChanged(x, null)
        
                        //utilsWallet.debug(`appWorker >> ${self.workerId} INSIGHT WS ${x} - io: ${configWS.insightApi_ws_config[x].url}...`, null, { logServerConsole: true })

                        self.insightSocketIos[x] = io(configWS.insightApi_ws_config[x].url, { transports: ['websocket'] })
                        var socket = self.insightSocketIos[x]

                        //
                        // socket lifecycle
                        //
                        socket.on('connect', () => {
                            //utilsWallet.debug(`appWorker >> ${self.workerId} INSIGHT WS ${x} - IO - connect...`)
                            try {
                                if (!loaderWorker) {
                                    networkConnected(x, true)
                                    networkStatusChanged(x, { insight_url: configWS.insightApi_ws_config[x].url })
                                    socket.emit('subscribe', 'inv') // subscribe new tx and new blocks
                                }
                            }
                            catch (err) { utilsWallet.error(`### appWorker >> ${self.workerId} INSIGHT WS ${x} - IO - connect(1), err=`, err) }
                        })
                        socket.on('connect_failed', function () {
                            utilsWallet.error(`appWorker >> ${self.workerId} INSIGHT WS ${x} - IO - connect_failed`)
                            try {
                                if (!loaderWorker) {
                                    networkConnected(x, false)
                                    networkStatusChanged(x, { insight_url: configWS.insightApi_ws_config[x].url })
                                }
                            }
                            catch (err) { utilsWallet.error(`### appWorker >> ${self.workerId} INSIGHT WS ${x} - IO - connect_failed, err=`, err) }
                        })
                        socket.on('connect_error', function (socketErr) {
                            utilsWallet.error(`appWorker >> ${self.workerId} INSIGHT WS ${x} - IO - connect_error, socketErr=`, socketErr.message)
                            try {
                                if (!loaderWorker) {
                                    networkConnected(x, false)
                                    networkStatusChanged(x, { insight_url: configWS.insightApi_ws_config[x].url })
                                }
                            }
                            catch (err) { utilsWallet.error(`### appWorker >> ${self.workerId} INSIGHT WS ${x} - IO - connect_error, err=`, err) }
                        })

                        socket.on('disconnect', function () {
                            utilsWallet.warn(`appWorker >> ${self.workerId} INSIGHT WS ${x} - IO - disconnect`)
                            try {
                                if (!loaderWorker) {
                                    networkConnected(x, false)
                                    networkStatusChanged(x)
                                }
                            }
                            catch (err) { utilsWallet.error(`### appWorker >> ${self.workerId} INSIGHT WS ${x} - IO - disconnect, err=`, err) }
                        })
                        socket.on('reconnect', () => {
                            utilsWallet.warn(`appWorker >> ${self.workerId} INSIGHT WS ${x} - IO - reconnect...`)
                            try {
                                if (!loaderWorker) {
                                    networkConnected(x, true)
                                    networkStatusChanged(x)
                                    socket.emit('subscribe', 'inv')
                                }
                            }
                            catch (err) { utilsWallet.error(`### appWorker >> ${self.workerId} INSIGHT WS ${x} - IO - reconnect, err=`, err) }
                        })
                        socket.on('reconnect_failed', function () {
                            utilsWallet.warn(`appWorker >> ${self.workerId} INSIGHT WS ${x} - IO - reconnect_failed`)
                            try {
                                if (!loaderWorker) {
                                    networkConnected(x, false)
                                    networkStatusChanged(x)
                                }
                            }
                            catch (err) { utilsWallet.error(`### appWorker >> ${self.workerId} INSIGHT WS ${x} - IO - reconnect_failed, err=`, err) }
                        })

                        socket.on('error', function (socketErr) {
                            utilsWallet.warn(`appWorker >> ${self.workerId} INSIGHT WS ${x} - IO - error, socketErr=`, socketErr)
                            try {
                                if (!loaderWorker) {
                                    networkConnected(x, false)
                                    networkStatusChanged(x)
                                }
                            }
                            catch (err) { utilsWallet.error(`### appWorker >> ${self.workerId} INSIGHT WS ${x} - IO - error, err=`, err) }
                        })

                        //                                
                        // subscriptions - new tx's and new blocks
                        //
                        if (!loaderWorker) {
                            socket.on('tx', (tx) => {

                                //utilsWallet.log(`appWorker >> ${self.workerId} INSIGHT TX ${x}`, x)
                                
                                // btc.com's "insight" server produces some weird responses (tx event is missing txid)
                                if (tx.txid === undefined) {
                                    tx.txid = `@${Date.now().toString()}`
                                }

                                // calc spot mempool TPS over last BUF_CAP mempool tx's received
                                const BUF_CAP = 5
                                var mempool_tps = 0
                                if (!self.mempool_tpsBuf[x]) self.mempool_tpsBuf[x] = new CircularBuffer(BUF_CAP)
                                if (!self.mempool_tot[x]) self.mempool_tot[x] = 0
                                //console.log(self.mempool_tpsBuf[x])
                                if (!self.mempool_tpsBuf[x].toarray().some(p => p.txid == tx.txid)) {
                                    self.mempool_tpsBuf[x].push({ txid: tx.txid, timestamp: new Date().getTime() })
                                    self.mempool_tot[x]++
                                    //console.log('pushed...')
                                }
                                //console.log(`${x}: mempool_tpsBuf[x].size()=${mempool_tpsBuf[x].size()}`)
                                if (mempool_tpsBuf[x].size() == BUF_CAP) {
                                    const buf1 = mempool_tpsBuf[x].get(0)
                                    const buf2 = mempool_tpsBuf[x].get(BUF_CAP - 1)
                                    const ms = buf2.timestamp - buf1.timestamp
                                    mempool_tps = BUF_CAP / (ms/1000)
                                    //console.log(`${x}: tot=${self.mempool_tot[x]} buf1=${buf1.timestamp} buf2=${buf2.timestamp} ms=${ms} mempool_tps=${mempool_tps}`)
                                }

                                // average the spot mempool TPS values - trying to deal with network transmit spikes
                                const AVG_CAP = 10
                                if (!self.mempool_tpsAvg[x]) self.mempool_tpsAvg[x] = new CircularBuffer(AVG_CAP)
                                if (mempool_tps < 15) { // gross hack: some insight servers are spitting out batches of tx's in bursts; no idea why - e.g. https://insight.dash.org/insight/
                                    self.mempool_tpsAvg[x].push(mempool_tps)
                                }
                                const tps_values = self.mempool_tpsAvg[x].toarray()
                                const mempool_tps_avg = tps_values.reduce((a,b) => a+b, 0) / tps_values.length

                                // throttle these to max n per sec
                                //const sinceLastTx = new Date().getTime() - self.lastTx[x]
                                //if (isNaN(sinceLastTx) || sinceLastTx > 500) {
                                //    self.lastTx[x] = new Date().getTime()

                                // Jan '21 - don't call this at all for tx's (perf)
                                //    networkStatusChanged(x, { txid: tx.txid, mempool_tps: mempool_tps_avg, insight_url: configWS.insightApi_ws_config[x].url })
                                
                                //}
                            })
                            socket.on('block', (blockHash) => {
                                if (configWallet.WALLET_DISABLE_BLOCK_UPDATES) return
                                
                                if (configWS.insightApi_ws_config[x].subBlocks === false) {
                                    //utilsWallet.debug(`appWorker >> ${self.workerId} INSIGHT WS ${x} - IO - ignoring block: subBlocks=false`)
                                }
                                else {
                                    try {
                                        // requery balance check for asset on new block
                                        self.postMessage({ 
                                            msg: 'REQUEST_STATE', status: 'REQ',
                                            data: { stateItem: 'ASSET', stateKey: x, context: 'ASSET_REFRESH_NEW_BLOCK' } })

                                        // get reeived block height & time
                                        //axiosRetry(axios, configWallet.AXIOS_RETRY_3PBP)
                                        axios.get(configExternal.walletExternal_config[x].api.block(blockHash))
                                        .then((resBlockData) => {
                                            if (resBlockData && resBlockData.data) {
                                                const receivedBlockNo = resBlockData.data.height
                                                const receivedBlockTime = new Date(resBlockData.data.time * 1000)
                                    
                                                utilsWallet.logMajor('green','white', `appWorker >> ${self.workerId} INSIGHT BLOCK ${x} ${receivedBlockNo} ${receivedBlockTime}`)
                                    
                                                // get node sync status
                                                getSyncInfo_Insight(x, receivedBlockNo, receivedBlockTime)
                                            }
                                        })
                                    }
                                    catch (err) { utilsWallet.error(`### appWorker >> ${self.workerId} INSIGHT BLOCK ${x}, err=`, err) }
                                }
                            })
                        }
                    }
                }
                catch(err) {
                    utilsWallet.error(`appWorker >> ${self.workerId} INSIGHT WS ${x} - io: ${configWS.insightApi_ws_config[x].url}, err=`, err)
                    utilsWallet.trace()
                    networkConnected(x, false)
                    networkStatusChanged(x)
                }
            })(assetSymbol)
        }
    },

    getAddressBalance_Insight: (asset, address) => {
        const symbol = asset.symbol
        //utilsWallet.debug(`getAddressBalance_Insight v2_addrBal ${symbol}...`)

        return new Promise((resolve, reject) => {
            
            const axiosLongtimeout = axios.create({ timeout: 5000 } )
            //axiosRetry(axiosLongtimeout, configWallet.AXIOS_RETRY_3PBP)
            axiosLongtimeout.get(configExternal.walletExternal_config[symbol].api.v2_addrBal(address) + '&dt=' + new Date().getTime())
            
            .then(res => {
                if (res && res.data) {
                    resolve({
                        symbol, 
                        balance: new BigNumber(res.data.balanceSat),
                        unconfirmedBalance: new BigNumber(res.data.unconfirmedBalanceSat),
                        address,
                    })
                }
                else {
                    resolve(null) // allow batch promise.all calls to try all
                    utilsWallet.error(`### getAddressBalance_Insight ${symbol} v2_addrBal - unexpected or missing insight data`)
                }
            })
            .catch(err => {
                resolve(null) 
                utilsWallet.error(`### getAddressBalance_Insight ${symbol} v2_addrBal, err=`, err)
            })
            .finally(() => {
                resolve(null) 
            })
        })
    },

    // UTXO v2 -- gets balance and last n raw tx id's - one op.
    getAddressFull_Insight_v2: (wallet, asset, pollAddress, utxo_mempool_spentTxIds, allDispatchActions) => {
        const symbol = asset.symbol
        //utilsWallet.debug(`getAddressFull_Insight_v2 ${symbol}...`)

        //axiosRetry(axios, configWallet.AXIOS_RETRY_3PBP)
        const from = 0
        const to = (configWallet.WALLET_MAX_TX_HISTORY || 888) - 1
        return Promise.all([
            axios.get(configExternal.walletExternal_config[symbol].api.v2_addrData(pollAddress, from, to)),
            axios.get(configExternal.walletExternal_config[symbol].api.utxo(pollAddress))
        ]).then(async ([addrInfo, utxoInfo]) => {

            if (addrInfo && utxoInfo && addrInfo.data && utxoInfo.data) {
                var utxos = utxoInfo.data
                var addrData = addrInfo.data

                // prune unused utxo data
                //console.log('insight_utxos', utxos)
                utxos = utxos.map(p => {
                    return {
                        //address: p.address, 
                        //amount,
                        //confirmations,
                        //height,
                        satoshis: p.satoshis,
                        scriptPubKey, // DMS -- test this!!! -- needs to hold .addresses[], .hex, & .type...
                        txid: p.txid,
                        vout: p.vout,
                    }
                })

                // tx's
                const totalTxCount = addrData.txApperances + addrData.unconfirmedTxApperances // sp!

                // filter: new tx's, or known tx's that aren't yet enriched, or unconfirmed tx's
                const assetAddress = asset.addresses.find(p => p.addr == pollAddress)
                const newMinimalTxs = addrData.transactions.filter(p => 
                    !assetAddress.txs.some(p2 => p2.txid == p
                        && p2.isMinimal == false 
                        && p2.block_no != -1)
                )
                .map(p => { return { txid: p, isMinimal: true } }) // TX_MINIMAL 

                const res = 
                {
                    balance: addrData.balanceSat,
                    unconfirmedBalance: addrData.unconfirmedBalanceSat,
                    //txs: new_txs, 
                    utxos,
                    totalTxCount,
                    cappedTxs: addrData.transactions.length < totalTxCount
                }

                if (newMinimalTxs.length > 0) {
                    // queue enrich tx actions (will either take from the cache, or fetch, prune & populate the cache)
                    const enrichOps = newMinimalTxs.map((tx) => { return enrichTx(wallet, asset, tx, pollAddress) })

                    // update batch
                    await Promise.all(enrichOps)
                    .then((enrichedTxs) => {
                        const dispatchTxs = enrichedTxs.filter(p => p != null)
                        if (dispatchTxs.length > 0) {
                            //utilsWallet.debug(`getAddressFull_Insight_v2 ${symbol} ${pollAddress} - enrichTx done for ${dispatchTxs.length} tx's - requesting WCORE_SET_ENRICHED_TXS...`)

                            const dispatchAction = {
                                type: actionsWallet.WCORE_SET_ENRICHED_TXS,
                                payload: { updateAt: new Date(), symbol: asset.symbol, addr: pollAddress, txs: dispatchTxs, res}
                            }
                            allDispatchActions.push(dispatchAction)
                        }
                    })
                }

                // pass through the state update -- in v1 getAddressFull format
                const ret = Object.assign({}, res, { txs: newMinimalTxs } )
                return ret
            }
            else {
                utilsWallet.error(`### getAddressFull_Insight_v2 ${symbol} no insight data`)
            }
        })
        .catch((err) => {
            utilsWallet.error(`### getAddressFull_Insight_v2 ${symbol}, err=`, err)
        })
    },

    getSyncInfo_Insight: (symbol, receivedBlockNo = undefined, receivedBlockTime = undefined, networkStatusChanged = undefined) => {
        return getSyncInfo_Insight(symbol, receivedBlockNo, receivedBlockTime, networkStatusChanged)
    }
}

function getSyncInfo_Insight(symbol, receivedBlockNo = undefined, receivedBlockTime = undefined, networkStatusChanged = undefined) {
    if (symbol === 'LTC_TEST' && !configWallet.WALLET_INCLUDE_LTC_TEST) return
    if (symbol === 'ZEC_TEST' && !configWallet.WALLET_INCLUDE_ZEC_TEST) return
    if (symbol === 'BTC_TEST' && !configWallet.WALLET_INCLUDE_BTC_TEST) return

    if (configExternal.walletExternal_config[symbol] === undefined ||
        configExternal.walletExternal_config[symbol].api == undefined ||
        configExternal.walletExternal_config[symbol].api.sync === undefined) {
        utilsWallet.info(`appWorker >> ${self.workerId} getSyncInfo_Insight ${symbol} - ignoring: not setup for asset`)
        return
    }
    axios.get(configExternal.walletExternal_config[symbol].api.sync())
    .then(syncData => {
        if (syncData && syncData.data) {
            const insightSyncStatus = syncData.data.status
            const insightSyncBlockChainHeight = syncData.data.blockChainHeight
            const insightSyncHeight = syncData.data.height
            const insightSyncError = syncData.data.error

            utilsWallet.log(`appWorker >> ${self.workerId} getSyncInfo_Insight ${symbol} - request dispatch SET_ASSET_BLOCK_INFO...`)

            const dispatchActions = []
            const updateSymbols = [symbol]
            if (symbol === 'BTC') { // don't send redundant requests: causes 429's - use BTC's request for BTC_SEG
                updateSymbols.push('BTC_SEG')
                updateSymbols.push('BTC_SEG2')
            }
            if (symbol === 'BTC') {  
                updateSymbols.forEach(p =>  {
                    dispatchActions.push({ 
                        type: actionsWallet.SET_ASSET_BLOCK_INFO,
                     payload: { symbol: p,
                                receivedBlockNo: receivedBlockNo || insightSyncBlockChainHeight,
                                receivedBlockTime: receivedBlockTime || new Date().getTime(),
                                insightSyncStatus, insightSyncBlockChainHeight, insightSyncHeight, insightSyncError
                    }})
                })
            }

            self.postMessage({ msg: 'REQUEST_DISPATCH_BATCH', status: 'DISPATCH', data: { dispatchActions } })

            // TODO: (as needed) - calc block_tps avg, per worker-geth & worker-blockbook
            //...

            // update lights
            if (networkStatusChanged) {
                updateSymbols.forEach(p =>  {
                    networkStatusChanged(p, { 
                    block_no: receivedBlockNo, 
                 insight_url: configWS.insightApi_ws_config[p].url })
                })
            }
        }
    })
}

function enrichTx(wallet, asset, tx, pollAddress) {
    return new Promise((resolve, reject) => {

        // wallet owner is part of cache key because of relative fields: tx.sendToSelf and tx.isIncoming 
        const cacheKey = `${asset.symbol}_${wallet.owner}_txid_${tx.txid}` 
        const ownAddresses = asset.addresses.map(p => { return p.addr })

        //utilsWallet.log(`** enrichTx - ${asset.symbol} ${tx.txid}...`)

        // try cache first
        //utilsWallet.idb_tx.getItem(cacheKey)
        utilsWallet.txdb_getItem(cacheKey)
        .then((cachedTx) => {
            if (cachedTx && cachedTx.block_no != -1) { // requery unconfirmed tx's
                cachedTx.fromCache = true
                utilsWallet.log(`** enrichTx - ${asset.symbol} ${tx.txid} RET-CACHE`)
                resolve(cachedTx) // return from cache
            }
            else {
                //axiosRetry(axios, configWallet.AXIOS_RETRY_3PBP)
                axios.get(configExternal.walletExternal_config[asset.symbol].api.v2_tx(tx.txid))
                .then((txData) => {
                    if (txData && txData.data) {
                        // map tx (prunes vins, drops vouts)
                        var mappedTx = walletUtxo.map_insightTxs([txData.data], ownAddresses, asset)[0]
                        //utilsWallet.log(`** enrichTx - ${asset.symbol} ${tx.txid} - adding to cache, mappedTx=`, mappedTx)

                        // add to cache
                        mappedTx.addedToCacheAt = new Date()
                        //utilsWallet.idb_tx.setItem(cacheKey, mappedTx)
                        utilsWallet.txdb_setItem(cacheKey, mappedTx)
                        .then(() => {
                            utilsWallet.log(`** enrichTx - ${asset.symbol} ${tx.txid} - added to cache ok`)
                            mappedTx.fromCache = false
                            resolve(mappedTx)
                        })
                        .catch((err) => {
                            utilsWallet.reportErr(err)
                            utilsWallet.error(`## enrichTx - ${asset.symbol} ${tx.txid} - error writing cache=`, err)

                            resolve(null) // allow all enrich ops to run
                        })
                    }
                    else {
                        utilsWallet.warn(`enrichTx - ${asset.symbol} ${tx.txid} - no data from insight`)
                        resolve(null)
                    }
                })
            }
        })
        .catch((err) => {
            utilsWallet.reportErr(err)
            utilsWallet.error('## enrichTx - error=', err)
            resolve(null)
        })
    })
}