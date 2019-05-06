// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.

const io = require('socket.io-client')
const BigNumber = require('bignumber.js')
const _ = require('lodash')
const workerPrices = require('./worker-prices')
const workerWeb3 = require('./worker-web3')
const workerInsight = require('./worker-insight')
const workerGeth = require('./worker-geth')
const workerAddressMempool = require('./worker-blockbook-mempool')
const workerAddressMonitor = require('./worker-addr-monitor')
const workerPushTx = require('./worker-pushtx')
const workerExternal  = require('./worker-external')
const workerBlockbook = require('./worker-blockbook')
const workerAccount = require('./worker-account')
const workerUtxo = require('./worker-insight')
const configWS = require('../config/websockets')
const configWallet = require('../config/wallet')
const walletExternal = require('../actions/wallet-external')
const utilsWallet = require('../utils')

// setup
var workerThreads = undefined
try {
    workerThreads = require('worker_threads') 
} catch(err) {} // expected - when running in browser
const workerId = !workerThreads ? new Date().getTime() : workerThreads.threadId
if (workerThreads) { // server
    workerThreads.parentPort.onmessage = handler
    self = global
    self.postMessage = (msg) => { return workerThreads.parentPort.postMessage(msg) }
}
else { // browser
    onmessage = handler
}

// sockets & webs3s
self.priceSocket = undefined  // socket.io-client
self.insightSocketIos = {}    // socket.io-client
self.blockbookSocketIos = {}  // socket.io-client
self.blockbookIsoSockets = {} // isomorphic-ws
self.blockbookIsoSockets_messageID = []
self.blockbookIsoSockets_pendingMessages = []
self.blockbookIsoSockets_subscriptions = []
self.blockbookIsoSockets_subId_NewBlock = []

self.insightAddrTxs = []    // server sending >1 new tx notification - processed inbound tx list; disregard if tx is already in this list (one list for all assets, probably fine!)
self.blockbookAddrTxs = []  // "
self.gethBlockNos = []      // similar issue to address monitors: geth web3 sub - disregard if block already processed (polled) -- seeing sometimes same block sent twice

self.gethSockets = {}       // eth - isomorphic-ws - used for slightly faster tx and block polling compared to web3 subscriptions
self.ws_web3 = {}           // eth - web3 socket for faster balance polling compared to HttpProvider

// tx subscriptions - for throttling and TPS calcs
self.lastTx = {}
self.firstTx = {}
self.countTx = {}

self.window = self // for web3, and utilsWallet.getMainThreadGlobalScope in web worker context

self.workerId = !workerThreads ? new Date().getTime() : workerThreads.threadId

self.dirtyDbFile = 'scp_tx.db'

// error handlers
if (configWallet.WALLET_ENV === "SERVER") {
    if (!configWallet.IS_DEV) {
        process.on('unhandledRejection', (reason, promise) => {
        utilsWallet.error(`## unhandledRejection (appWorker) - ${reason}`, promise, { logServerConsole: true })
        })
        process.on('uncaughtException', (err, origin) => {
            utilsWallet.error(`## uncaughtException (appWorker) - ${err.toString()}`, origin, { logServerConsole: true })
        })
    }
}

utilsWallet.logMajor('green','white', `... appWorker - ${configWallet.WALLET_VER} (${configWallet.WALLET_ENV}) >> ${workerId} - init ...`, null, { logServerConsole: true })

function handler(e) {
    if (!e) { utilsWallet.error(`appWorker >> ${workerId} no event data`); return }

    const eventData = !workerThreads ? e.data : e
    if (!eventData.msg || !eventData.data) { utilsWallet.error(`cpuWorker >> ${workerId} bad event, e=`, e); return }
    const msg = eventData.msg
    const data = eventData.data
    switch (msg) {

        case 'SERVER_INIT_TX_DB':  // setup tx db cache (dirty - replaces node-persist)
            utilsWallet.debug(`appWorker >> ${self.workerId} INIT_SERVER_DIRTY_DB...`)
            dirtyDbInit()
            break
        // ## broken -- see dirtyDbClear
        // case 'SERVER_NUKE_TX_DB': 
        //     utilsWallet.debug(`appWorker >> ${self.workerId} SERVER_NUKE_TX_DB...`)
        //     dirtyDbClear()
        //     break

        case 'DIAG_PING':
            utilsWallet.debug(`appWorker >> ${self.workerId} DIAG_PING...`)
            const pongTime = new Date().getTime()
            self.postMessage({ msg: 'DIAG_PONG', status: 'RES', data: { pongTime } })
            break

        case 'NOTIFY_USER': 
            // posts the notification payload back to the main thread, so it can display accordingly
            // (toastr notification in browser, console log on server)
            utilsWallet.debug(`appWorker >> ${self.workerId} NOTIFY_USER...`, data)
            self.postMessage({ msg: 'NOTIFY_USER', status: 'RES', data })
            break

        case 'CONNECT_PRICE_SOCKET':
            utilsWallet.debug(`appWorker >> ${self.workerId} CONNECT_PRICE_SOCKET...`)
            workerPrices.priceSocket_Connect()
            break
        case 'FETCH_PRICES': 
            workerPrices.fetch()
            break

        case 'DISCONNECT_PRICE_SOCKET':
            utilsWallet.debug(`appWorker >> ${self.workerId} DISCONNECT_PRICE_SOCKET...`)
            workerPrices.priceSocket_Disconnect()
            break            

        case 'INIT_INSIGHT_SOCKETIO':
            utilsWallet.debug(`appWorker >> ${self.workerId} INIT_INSIGHT_SOCKETIO...`)
            workerInsight.socketio_Setup_Insight(networkConnected, networkStatusChanged)
            break

        case 'INIT_GETH_ISOSOCKETS':
            utilsWallet.debug(`appWorker >> ${self.workerId} INIT_GETH_ISOSOCKETS...`)
            var setupCount = workerGeth.isosocket_Setup_Geth(networkConnected, networkStatusChanged)
            if (setupCount > 0) {
                utilsWallet.log(`appWorker >> ${self.workerId} INIT_GETH_ISOSOCKETS - DONE - (re)connected=`, setupCount, { logServerConsole: true })
            }
            break
        case 'INIT_BLOCKBOOK_ISOSOCKETS':
            utilsWallet.debug(`appWorker >> ${self.workerId} INIT_BLOCKBOOK_ISOSOCKETS...`)
            const setupSymbols = workerBlockbook.isosocket_Setup_Blockbook(networkConnected, networkStatusChanged)
            const walletFirstPoll = data.walletFirstPoll == true
            const timeoutMs = data.timeoutMs

            if (setupSymbols.length > 0 || walletFirstPoll) {
                
                const startWaitAt = new Date().getTime()
                const wait_intId = setInterval(() => { // wait/poll for all sockets to be ready, then postback either success all or some failed

                    // if first wallet login, report on all asset sockets, otherwise just on those that were connected 
                    const bbSocketValues = //Object.values(self.blockbookIsoSockets)
                        walletFirstPoll
                        ? Object.values(self.blockbookIsoSockets)
                        : Object.values(self.blockbookIsoSockets).filter(p => p === undefined || setupSymbols.some(p2 => p2 === p.symbol))

                    const bbSocketKeys = //Object.keys(self.blockbookIsoSockets)
                        walletFirstPoll
                        ? Object.keys(self.blockbookIsoSockets)
                        : setupSymbols

                    const allReady = bbSocketValues.some(p => !p || p.readyState != 1) === false

                    const symbolsConnected = bbSocketValues.filter(p => p && p.readyState == 1).map(p => p && p.symbol)
                    const symbolsNotConnected = bbSocketValues.filter(p => p && p.readyState != 1).map(p => p.symbol).concat(bbSocketKeys.filter(p => self.blockbookIsoSockets[p] === undefined))

                    const elapsedMs = new Date().getTime() - startWaitAt
                    utilsWallet.debug(`appWorker >> ${self.workerId} INIT_BLOCKBOOK_ISOSOCKETS - elapsedMs=${elapsedMs} - allReady=`, allReady, { logServerConsole: true })
                    if (allReady) { // all requested connections setup
                        clearInterval(wait_intId)
                        if (symbolsConnected.length > 0) {
                            utilsWallet.log(`appWorker >> ${self.workerId} INIT_BLOCKBOOK_ISOSOCKETS - DONE - (re)connected=`, symbolsConnected.join(','), { logServerConsole: true })
                        }
                        self.postMessage({ msg: 'BLOCKBOOK_ISOSOCKETS_DONE', status: 'RES', data: { walletFirstPoll, symbolsConnected, symbolsNotConnected } }) 
                    }
                    else { // some failed
                        if (elapsedMs > timeoutMs) {
                            clearInterval(wait_intId)
                            utilsWallet.error(`appWorker >> ${self.workerId} INIT_BLOCKBOOK_ISOSOCKETS - ## timeout elapsed: sockets still not all readyState=1 ##`, null, { logServerConsole: true })
                            self.postMessage({ msg: 'BLOCKBOOK_ISOSOCKETS_DONE', status: 'RES', data: { walletFirstPoll, symbolsConnected, symbolsNotConnected } }) 
                        }
                    }
                }, 888)
            }
            break
        
        case 'INIT_WEB3_SOCKET':
            utilsWallet.debug(`appWorker >> ${self.workerId} INIT_WEB3_SOCKET...`)
            var setupCount = workerWeb3.web3_SetupSocketProvider()
            if (setupCount > 0) {
                utilsWallet.log(`appWorker >> ${self.workerId} INIT_WEB3_SOCKET - DONE - connected=`, setupCount, { logServerConsole: true })
            }
            break
        case 'WEB3_GET_ESTIMATE_FEE':
            utilsWallet.debug(`appWorker >> ${self.workerId} WEB3_GET_ESTIMATE_FEE...`)
            const asset = data.asset
            const params = data.params
            workerWeb3.estimateGasInEther(asset, params).then(fees => {
                utilsWallet.log('WEB3_GET_ESTIMATE_FEE_DONE: posting back', fees)
                self.postMessage({ msg: 'WEB3_GET_ESTIMATE_FEE_DONE', status: 'RES', data: { fees, assetSymbol: asset.symbol } }) 
            })
            break

        case 'CONNECT_ADDRESS_MONITORS':
            utilsWallet.debug(`appWorker >> ${self.workerId} CONNECT_ADDRESS_MONITORS...`)
            if (data && data.wallet) {
                workerAddressMonitor.addressMonitors_Sub_Unsub(data.wallet, true)
            }
            break

        case 'DISCONNECT_ADDRESS_MONITORS': 
            utilsWallet.debug(`appWorker >> ${self.workerId} DISCONNECT_ADDRESS_MONITORS...`)
            if (data && data.wallet) {
                workerAddressMonitor.addressMonitors_Sub_Unsub(data.wallet, false)
            }
        break

        case 'STATE_RESPONSE':
            utilsWallet.debug(`appWorker >> ${self.workerId} STATE_RESPONSE`)
            const stateItem = data.stateItem
            const stateKey = data.stateKey
            const value = data.value
            const context = data.context
            if (stateItem === 'ASSET') {
                const { asset, wallet, ux } = value

                // process balance (& tx/utxo) updates
                if (context === 'ASSET_REFRESH_ADDR_MONITOR') {  // caller is an address monitor
                    //utilsWallet.log('DBG1 - ASSET_REFRESH_ADDR_MONITOR')

                    refreshAssetFull(asset, wallet) 
                }
                else if (context === 'ASSET_REFRESH_NEW_BLOCK') { // caller is new block subscriber
                    
                    const pendingInitialLoad = wallet.assets.filter(p => p.lastAssetUpdateAt === undefined)
                    if (pendingInitialLoad.length > 0) {
                        utilsWallet.warn(`appWorker >> ${self.workerId} - ASSET_REFRESH_NEW_BLOCK - ${asset.symbol} - not all assets yet loaded: ignoring - pendingInitialLoad=`, pendingInitialLoad.map(p => p.symbol).join(', '))
                    }
                    else {
                        // if we have pending tx's, we want to do a full update, otherwise a lightweight balance update is sufficient
                        const unconfirmed_txs = walletExternal.getAll_unconfirmed_txs(asset)
                        const local_txs = walletExternal.getAll_local_txs(asset)
                        if (unconfirmed_txs.length > 0 || local_txs.length > 0) {
                            //utilsWallet.log('DBG1 - ASSET_REFRESH_NEW_BLOCK ' + asset.symbol + ' got pending txs -- doing full update...')
                            refreshAssetFull(asset, wallet)
                        }
                        else {
                            //utilsWallet.log('DBG1 - ASSET_REFRESH_NEW_BLOCK ' + asset.symbol + ' no pending txs -- doing light update (balance refresh)...')
                            refreshAssetBalance(asset, wallet)
                        }
                    }
                }
            }
            else {
                utilsWallet.warn(`appWorker >> ${self.workerId} unexpected stateItem=`, stateItem)
            }
            break

        //
        // asset refresh requests - note: request to refresh an erc20 asset are actually requests to update eth
        //
        case 'REFRESH_ASSET_BALANCE': {
            utilsWallet.debug(`appWorker >> ${self.workerId} REFRESH_ASSET_BALANCE ${data.asset.symbol}...`)
            // var updateAsset = data.asset
            // if (utils.isERC20(data.asset)) { 
            //     updateAsset = data.wallet.assets.find(p => p.symbol === 'ETH')
            // }
            refreshAssetBalance(data.asset, data.wallet)
            break
        }
        case 'REFRESH_ASSET_FULL': {
            utilsWallet.debug(`appWorker >> ${self.workerId} REFRESH_ASSET_FULL ${data.asset.symbol}...`)
            // var updateAsset = data.asset
            // if (utils.isERC20(data.asset)) { 
            //     updateAsset = data.wallet.assets.find(p => p.symbol === 'ETH')
            // }
            refreshAssetFull(data.asset, data.wallet)
            break
        }

        case 'PUSH_TX_BLOCKBOOK':
            utilsWallet.debug(`appWorker >> ${self.workerId} PUSH_TX_BLOCKBOOK...`)
            workerPushTx.blockbook_pushTx(data.asset, data.txhex, data.wallet)
            break

        case 'POST_OFFLINE_CHECK': 
            utilsWallet.debug(`appWorker >> ${self.workerId} POST_OFFLINE_CHECK...`)
            postOfflineCheck()
            break

        // arbitrary address balances -- used by privkey import; consolidated return format, unlike wallet-external
        case 'GET_ANY_ADDRESS_BALANCE': {
            const addrs = data.addrs
            utilsWallet.debug(`appWorker >> ${self.workerId} GET_ANY_ADDRESS_BALANCE... asset, addrs=`, data.asset, data.addrs)
            //debugger
            if (data.asset.symbol === 'ETH' || utilsWallet.isERC20(data.asset.symbol)) {
                
                const ops = data.addrs.map(addr => { return workerAccount.getAddressBalance_Account(data.asset.symbol, addr, false) })
                Promise.all(ops)
                .then(results => {
                    const balanceData =  
                        results.filter(p => p != null)
                        .map(p => { return { 
                            addr: p.address,
                            bal: {
                                symbol: data.asset.symbol,
                                balance: new BigNumber(p.bal).toString(),
                                unconfirmedBalance: new BigNumber(0).toString(),
                            }
                        }})
                    self.postMessage({ msg: 'ADDRESS_BALANCE_RESULT', status: 'RES', data: balanceData })
                })
            }
            else {
                const balanceUpdateFn = data.asset.use_BBv3 //  BB WS interface bulk seems much better
                ? workerBlockbook.getAddressBalance_Blockbook_v3
                : workerInsight.getAddressBalance_Insight 

                const ops = data.addrs.map(addr => { return balanceUpdateFn(data.asset, addr, false) })
                Promise.all(ops)
                .then(results => { 
                    const balanceData =  
                        results.filter(p => p != null)
                        .map(p => { return { 
                            addr: p.address,
                            bal: {
                                symbol: data.asset.symbol,
                                balance: p.balance.toString(),
                                unconfirmedBalance: p.unconfirmedBalance.toString(),
                            }
                        }})
                    self.postMessage({ msg: 'ADDRESS_BALANCE_RESULT', status: 'RES', data: balanceData })
                })
            }
            break
        }

        // get initial block/sync info 
        case 'GET_SYNC_INFO':
            utilsWallet.debug(`appWorker >> ${self.workerId} ${data.symbol} GET_SYNC_INFO...`)
            const meta = configWallet.getMetaBySymbol(data.symbol)
            if (meta.type === configWallet.WALLET_TYPE_UTXO) {
                if (meta.use_BBv3) {
                    workerBlockbook.getSyncInfo_Blockbook_v3(data.symbol)
                }
                else {
                    workerInsight.getSyncInfo_Insight(data.symbol)
                }
            }
            else if (meta.type === configWallet.WALLET_TYPE_ACCOUNT) {
                ; // nop - we'll get sync info on next block (eth is fast enough)
            }
            break
    }

    //
    // main actions for asset address balance & tx updates
    // these fn's populate the store data after retrieving data from 3PBPs (blockbook, insight, web3)
    //
    function refreshAssetFull(asset, wallet, utxo_known_spentTxIds) {
        workerAddressMempool.mempool_get_BB_txs(asset, wallet, (utxo_mempool_spentTxIds) => {

            utilsWallet.debug(`appWorker >> ${self.workerId} refreshAssetFull ${asset.symbol} - utxo_mempool_spentTxIds=`, utxo_mempool_spentTxIds)

            // get BB scoket, for account types (needed for ETH v2)
            var bbSocket
            if (asset.type === configWallet.WALLET_TYPE_ACCOUNT && asset.symbol !== 'EOS') {
                bbSocket = get_BlockbookSocketIo(asset)
            }
        
            // when called from worker-pushtx, we can augment BB's mempool (which lags) with known spent txid's
            const spentTxIds = _.uniq(utxo_mempool_spentTxIds.concat(utxo_known_spentTxIds))

            var allDispatchActions = []
            const refreshOps = asset.addresses.map(a => {
                return new Promise((resolve, reject) => {
                    const addrNdx = asset.addresses.findIndex(p => p.addr === a.addr)
                    workerExternal.getAddressFull_External({ wallet, asset, addrNdx, bbSocket, utxo_mempool_spentTxIds: spentTxIds, },
                        (dispatchActions) => {
                            if (dispatchActions.length > 0) {
                                allDispatchActions = [...allDispatchActions, ...dispatchActions]
                            }
                            resolve()
                        })
            })})
            Promise.all(refreshOps)
            .then((res) => {
                if (allDispatchActions.length > 0) {
                    utilsWallet.log(`appWorker >> ${self.workerId} - refreshAssetFull - ${asset.symbol} - allDispatchActions.length=${allDispatchActions.length}`)
                    allDispatchActions = mergeDispatchActions(asset, allDispatchActions)
                    self.postMessage({ msg: 'REQUEST_DISPATCH_BATCH', status: 'DISPATCH', data: { dispatchActions: allDispatchActions } } ) // post dispatch batch request
                }
            })
        })
    }

    function refreshAssetBalance(asset, wallet) {

        workerAddressMempool.mempool_get_BB_txs(asset, wallet, (utxo_mempool_spentTxIds) => {
            utilsWallet.debug(`appWorker >> ${self.workerId} refreshAssetBalance ${asset.symbol} - utxo_mempool_spentTxIds=`, utxo_mempool_spentTxIds)

            // get BB scoket, for account types (needed for ETH v2)
            var bbSocket
            if (asset.type === configWallet.WALLET_TYPE_ACCOUNT && asset.symbol !== 'EOS') {
                bbSocket = get_BlockbookSocketIo(asset)
            }

            var allDispatchActions = []
            const refreshOps = asset.addresses.map(a => {
                return new Promise((resolve, reject) => {
                    const addrNdx = asset.addresses.findIndex(p => p.addr === a.addr)
                    workerExternal.getAddressBalance_External({ wallet, asset, addrNdx, utxo_mempool_spentTxIds, bbSocket },
                        (dispatchActions) => {
                            if (dispatchActions.length > 0) {
                                allDispatchActions = [...allDispatchActions, ...dispatchActions]
                            }
                            resolve()
                        })
            })})

            Promise.all(refreshOps)
            .then((res) => {
                if (allDispatchActions.length > 0) {
                    utilsWallet.log(`appWorker >> ${self.workerId} refreshAssetBalance - ${asset.symbol} allDispatchActions.length=${allDispatchActions.length}`)
                    allDispatchActions = mergeDispatchActions(asset, allDispatchActions)
                    self.postMessage({ msg: 'REQUEST_DISPATCH_BATCH', status: 'DISPATCH', data: { dispatchActions: allDispatchActions } } ) // post dispatch batch request
                }
            })
        })
    }

    // perf - transmogrify multiple WCORE_SET_ADDRESS_FULL actions into a single WCORE_SET_ADDRESSES_FULL_MULTI
    //        (results in one store update instead of thousands)
    function mergeDispatchActions(asset, allDispatchActions) {
       
        // n WCORE_SET_ADDRESS_FULL ==> 1 WCORE_SET_ADDRESSES_FULL_MULTI
        const setAddressFullActions = allDispatchActions.filter(p => p.type === 'WCORE_SET_ADDRESS_FULL')
        if (setAddressFullActions.length > 0) {
            const payloadAddresses = setAddressFullActions.map(p => p.payload.newAddr) // n payload.newAddr ==> 1 payload.newAddresses[]
            const newAction_setAddressFull_Multi = { 
                type: 'WCORE_SET_ADDRESSES_FULL_MULTI', 
                payload: { 
                    newAddresses: payloadAddresses,
                          symbol: asset.symbol,
                        updateAt: new Date()
                }
            }
            allDispatchActions = allDispatchActions.filter(p => p.type !== 'WCORE_SET_ADDRESS_FULL')
            allDispatchActions = allDispatchActions.concat(newAction_setAddressFull_Multi)
        }

        // n WCORE_SET_ENRICHED_TXS ==> 1 WCORE_SET_ENRICHED_TXS_MULTI
        const enrichTxActions = allDispatchActions.filter(p => p.type === 'WCORE_SET_ENRICHED_TXS')
        if (enrichTxActions.length > 0) {
            const payloadAddrTxs = enrichTxActions.map(p => { 
                return { addr: p.payload.addr, txs: p.payload.txs, res: p.payload.res } } ) // n payload.addr ==> 1 payload.addrTxs
            const newAction_setEnrichedTxs_Multi = { 
                type: 'WCORE_SET_ENRICHED_TXS_MULTI', 
                payload: { 
                    addrTxs: payloadAddrTxs,
                    symbol: asset.symbol,
                    updateAt: new Date()
                }
            }
            allDispatchActions = allDispatchActions.filter(p => p.type !== 'WCORE_SET_ENRICHED_TXS')
            allDispatchActions = allDispatchActions.concat(newAction_setEnrichedTxs_Multi)
        }

        return allDispatchActions
    }

    //
    // server file cache (npm dirty)
    // 
    function dirtyDbInit() {
        utilsWallet.log(`global.txdb_dirty: init...`, null, { logServerConsole: true })
        global.txdb_dirty = require('dirty')(self.dirtyDbFile)
        global.txdb_dirty.on('load', function() {
            utilsWallet.log(`global.txdb_dirty: init OK.`, null, { logServerConsole: true })
            self.postMessage({ msg: 'SERVER_INIT_TX_DB_DONE', status: 'RES', data: { } })
        })
    }
    /*function dirtyDbClear() { // ## broken
        utilsWallet.log(`global.txdb_dirty: clear...`, null, { logServerConsole: true })
        
        // this fails to actually delete lines - just appends new undefined lines (so key declarations are duplicated)
        // global.txdb_dirty.forEach((key,val) => {
        //     //global.txdb_dirty.rm(key, (e) => {
        //         global.txdb_dirty.set(key, undefined)   
        //         utilsWallet.log(`dirty: remove ${key}...`, { logServerConsole: true })
        //     //})
        // })
        
        // this works
        global.txdb_dirty.close()
        const fs = require('fs')
        const exists = fs.existsSync(self.dirtyDbFile)
        if (exists) {
            fs.unlinkSync(self.dirtyDbFile)
        }

        // but this (no matter how/where dirty is re-init'd) causes CLI commands to get written to the file after re-init (?!)
        //sglobal.txdb_dirty = require('dirty')(self.dirtyDbFile)

        // so we're left without a txdb, and no way to reinitialize it
        self.postMessage({ msg: 'SERVER_NUKE_TX_DB_DONE', status: 'RES', data: {} })
    }*/

    //
    // network, misc
    //
    function postOfflineCheck() {
        httpGetAsyncNoCache(configWallet.API_URL + 'ol', (xmlHttp) => {
            self.postMessage({ msg: 'OFFLINE_CHECK_RESPONSE', status: 'RES', data: {
                xmlHttpStatus: !xmlHttp ? undefined : xmlHttp.status,
                 responseText: !xmlHttp ? undefined : xmlHttp.responseText
            } })
            xmlHttp = null
        })
    }
    function httpGetAsyncNoCache(theUrl, callback) {
        var xmlHttp = new XMLHttpRequest()
        xmlHttp.onreadystatechange = function () {
            if (xmlHttp.readyState == 4)
                callback(xmlHttp)
        }
        xmlHttp.open("GET", theUrl + '?q=' + new Date().getTime(), true) // true for asynchronous 
        //xmlHttp.setRequestHeader('Cache-Control', 'no-cache')
        xmlHttp.send(null)
    }

    function networkStatusChanged(symbol, txid) {
        //utilsWallet.debug(`appWorker >> ${self.workerId} networkStatusChanged ${symbol} txid=${txid}`)
        self.postMessage({ msg: 'NETWORK_STATUS_CHANGE', status: 'ok', data: { symbol, txid } })
    }
    function networkConnected(symbol, connected) {
        utilsWallet.log(`appWorker >> ${self.workerId} networkConnected ${symbol} connected=${connected}`)
        self.postMessage({ msg: 'NETWORK_CONNECTED_CHANGE', status: 'ok', data: { symbol, connected } }) 
    }
}

self.get_BlockbookSocketIo = function(asset) { 
    const socketToUse = utilsWallet.isERC20(asset) ? 'ETH' : asset.symbol
    var socket = self.blockbookSocketIos[socketToUse]

    if (socket === undefined) {
        if (configWS.blockbook_ws_config[socketToUse] === undefined) {
            utilsWallet.error(`appWorker >> ${self.workerId} get_BlockbookSocketIo ${asset.symbol}: no socket config!`)
        }
        else {
            try {
                utilsWallet.log(`appWorker >> ${self.workerId} get_BlockbookSocketIo ${asset.symbol}: creating new socket...`)
                socket = io(configWS.blockbook_ws_config[socketToUse].url, { transports: ['websocket'] })
                self.blockbookSocketIos[socketToUse] = socket
                
                socket.on('connect', function() { 
                    utilsWallet.log(`appWorker >> ${self.workerId} BLOCKBOOK WS ${asset.symbol} - IO - connect...`)
                })
                socket.on('reconnect', () => {
                    utilsWallet.log(`appWorker >> ${self.workerId} BLOCKBOOK WS ${asset.symbol} - IO - reconnect...`)
                })   
            } 
            catch(err) {
                utilsWallet.error(`appWorker >> ${self.workerId} BLOCKBOOK WS - err=`, err)
                utilsWallet.trace()
            }
        }
    }
    return socket
}
