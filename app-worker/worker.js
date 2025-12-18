// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2023 Dominic Morris.

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
const configExternal = require('../config/wallet-external')
const actionsWallet = require('../actions')
const walletExternal = require('../actions/wallet-external')
const walletP2shBtc = require('../actions/wallet-btc-p2sh')
const utilsWallet = require('../utils')
//import SubWorker_GetAddrFull from 'worker-loader!./subworker-get-addr-full.js'

// setup
var workerThreads = undefined
try {
    workerThreads = require('worker_threads') 
} catch(err) {
    console.warn(`Failed to require(worker_threads): browser-env assumed...`)
}
const workerId = !workerThreads ? new Date().getTime() : workerThreads.threadId
if (workerThreads) { // server
    workerThreads.parentPort.onmessage = handler
    self = global
    self.postMessage = (msg) => { return workerThreads.parentPort.postMessage(msg) }
}
else { // browser
    onmessage = handler
}
self.window = self // for web3, and utilsWallet.getMainThreadGlobalScope in web worker context
self.workerId = !workerThreads ? new Date().getTime() : workerThreads.threadId

// sockets & webs3s
self.priceSocket = undefined  // socket.io-client
self.insightSocketIos = {}    // socket.io-client
self.blockbookSocketIos = {}  // socket.io-client
self.bb_Sockets = {} // isomorphic-ws
self.bb_Sockets_messageID = []
self.bb_Sockets_pendingMessages = []
self.bb_Sockets_subscriptions = []
self.bb_Sockets_subId_NewBlock = []
self.bb_Sockets_keepAliveIntervalID = []
self.bb_Sockets_aborted = false

self.insight_OwnAddrTxIds = {}    // server sending >1 new tx notification - processed inbound tx list; disregard if tx is already in this list (one list for all assets, probably fine!)
self.blockbook_OwnAddrTxIds = {}  // "
self.geth_BlockNos = {}           // similar issue to address monitors: geth web3 sub - disregard if block already processed (polled) -- seeing sometimes same block sent twice

self.geth_Sockets = {}            // eth - isomorphic-ws - used for slightly faster tx and block polling compared to web3 subscriptions
self.web3_Sockets = {}            // eth - web3 socket for faster balance polling compared to HttpProvider

// tx subscriptions - for throttling and TPS calcs
// self.mempool_tpsBuf = {}
// self.mempool_tpsAvg = {}
// self.mempool_tot = {}
// self.blocks_time = {}
// self.blocks_tps = {}
// self.blocks_height = {}
function resetConnectionStats() {
    self.mempool_tpsBuf = {}
    self.mempool_tpsAvg = {}
    self.mempool_tot = {}
    self.blocks_time = {}
    self.blocks_tps = {}
    self.blocks_height = {}
}
resetConnectionStats()

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

utilsWallet.logMajor('green','white', `... appWorker - ${configWallet.WALLET_VER} (${configWallet.WALLET_ENV}) >> ${workerId} - workerThreads(node): ${workerThreads !== undefined} - init ...`, null, { logServerConsole: true })

//
// handler: for main-thread postMessage ==> app-worker
//
async function handler(e) {
    if (!e) { utilsWallet.error(`appWorker >> ${workerId} no event data`); return Promise.resolve() }
    const eventData = e.data !== undefined && e.data.data !== undefined ? e.data : e // node 10 experimental worker threads vs node 13 / brower env
    if (!eventData.msg || !eventData.data) { utilsWallet.error(`appWorker >> ${workerId} bad event, workerThreads=${workerThreads} e=`, e); return Promise.resolve() }

    const msg = eventData.msg
    const data = eventData.data

    // StMaster - read & apply passed stm payload (i.e. dynamic add to walletConfig et al...)
    //utilsWallet.log(`StMaster - (app-worker) got data... >> ${workerId} - workerThreads(node): ${workerThreads !== undefined}`, data)
    if (data !== undefined) {
        if (data.stm_ApiPayload !== undefined) {
            if (configWallet.get_stm_ApiPayload() === undefined) {
                utilsWallet.log(`StMaster - (app-worker) setting stm_ApiPayload... >> ${workerId} - workerThreads(node): ${workerThreads !== undefined}`, data.stm_ApiPayload)
                configWallet.set_stm_ApiPayload(data.stm_ApiPayload)
                utilsWallet.log(`StMaster - (app-worker) set stm_ApiPayload... >> ${workerId} - configWallet.get_stm_ApiPayload()=`, configWallet.get_stm_ApiPayload())
                await configWallet.getSupportedWalletTypes()
            }
        }
    }
    
    switch (msg) {

        case 'SERVER_INIT_TX_DB':  // setup tx db cache (dirty - replaces node-persist)
            //utilsWallet.debug(`appWorker >> ${self.workerId} INIT_SERVER_DIRTY_DB...`, null, { logServerConsole: true })
            dirtyDbInit()
            break
        // ## broken -- see dirtyDbClear
        // case 'SERVER_NUKE_TX_DB': 
        //     //utilsWallet.debug(`appWorker >> ${self.workerId} SERVER_NUKE_TX_DB...`)
        //     dirtyDbClear()
        //     break

        case 'DIAG_PING': {
            //utilsWallet.debug(`appWorker >> ${self.workerId} DIAG_PING...`)
            const pongTime = new Date().getTime()
            self.postMessage({ msg: 'DIAG_PONG', status: 'RES', data: { pongTime } })
            break
        }

        case 'NOTIFY_USER': {
            // posts the notification payload back to the main thread, so it can display accordingly
            // (toastr notification in browser, console log on server)
            //utilsWallet.debug(`appWorker >> ${self.workerId} NOTIFY_USER...`, data)
            self.postMessage({ msg: 'NOTIFY_USER', status: 'RES', data })
            break
        }

        case 'CONNECT_PRICE_SOCKET': {
            //utilsWallet.debug(`appWorker >> ${self.workerId} CONNECT_PRICE_SOCKET...`)
            workerPrices.priceSocket_Connect()
            break
        }
        case 'FETCH_PRICES': {
            workerPrices.fetch()
            break
        }
        case 'DISCONNECT_PRICE_SOCKET': {
            //utilsWallet.debug(`appWorker >> ${self.workerId} DISCONNECT_PRICE_SOCKET...`)
            workerPrices.priceSocket_Disconnect()
            break            
        }

        case 'INIT_INSIGHT_SOCKETIO': { // INSIGHT: OBSOLETE / NOT USED ANY MORE
            //utilsWallet.debug(`appWorker >> ${self.workerId} INIT_INSIGHT_SOCKETIO...`)
            workerInsight.socketio_Setup_Insight(networkConnected, networkStatusChanged, data.loaderWorker)
            Object.values(configWallet.walletsMeta).filter(p => p.type === configWallet.WALLET_TYPE_UTXO && !p.use_BBv3).forEach(p => { 
                if (!configWallet.getSupportedMetaKeyBySymbol(p.symbol)) return
                GetSyncInfo(p.symbol)
            })
            break
        }

        case 'INIT_GETH_ISOSOCKETS': {
            //utilsWallet.debug(`appWorker >> ${self.workerId} INIT_GETH_ISOSOCKETS...`)
            const setupCount = workerGeth.isosocket_Setup_Geth(networkConnected, networkStatusChanged, data.loaderWorker, data.walletSymbols)
            if (setupCount > 0) {
                utilsWallet.log(`appWorker >> ${self.workerId} INIT_GETH_ISOSOCKETS - DONE - (re)connected=`, setupCount, { logServerConsole: true })
            }
            break
        }
        case 'DISCONNECT_GETH_ISOSOCKETS': {
            resetConnectionStats()
            const disconnectCount = workerGeth.isosocket_Disconnect_Geth(networkConnected, networkStatusChanged, data.loaderWorker, data.walletSymbols)
            if (disconnectCount > 0) {
                utilsWallet.log(`appWorker >> ${self.workerId} DISCONNECT_GETH_ISOSOCKETS - DONE - disconnected=`, disconnectCount, { logServerConsole: true })
            }
            break
        }

        case 'INIT_BLOCKBOOK_ISOSOCKETS': {
            self.bb_Sockets_aborted = false
            const walletFirstPoll = data.walletFirstPoll == true
            const timeoutMs = data.timeoutMs

            const setupSymbols = workerBlockbook.isosocket_Setup_Blockbook(networkConnected, networkStatusChanged, data.loaderWorker, data.walletSymbols)
            if (setupSymbols.length > 0 || walletFirstPoll) {
                utilsWallet.logMajor('pink', 'green', `appWorker >> ${self.workerId} INIT_BLOCKBOOK_ISOSOCKETS... setupSymbols=`, setupSymbols)

                const startWaitAt = new Date().getTime()
                const wait_intId = setInterval(() => { // wait/poll for all sockets to be ready, then postback either success all or some failed

                    // if first wallet login, report on all asset sockets, otherwise just on those that were connected 
                    const bbSocketValues = 
                        walletFirstPoll
                        ? Object.values(self.bb_Sockets)
                        : Object.values(self.bb_Sockets).filter(p => p === undefined || setupSymbols.some(p2 => p2 === p.symbol))

                    const bbSocketKeys =
                        walletFirstPoll
                        ? Object.keys(self.bb_Sockets)
                        : setupSymbols

                    const allReady = bbSocketValues.some(p => !p || p.readyState != 1) === false

                    const symbolsConnected = bbSocketValues.filter(p => p && p.readyState == 1).map(p => p && p.symbol)
                    const displaySymbolsConnected = _.uniq(
                        bbSocketValues.filter(p => p && p.readyState == 1).map(p => Object.values(configWallet.walletsMeta).find(p2 => p2.symbol === p.symbol).displaySymbol)
                    )
                    const symbolsNotConnected = bbSocketValues.filter(p => p && p.readyState != 1).map(p => p.symbol).concat(bbSocketKeys.filter(p => self.bb_Sockets[p] === undefined))

                    const elapsedMs = new Date().getTime() - startWaitAt
                    //utilsWallet.debug(`appWorker >> ${self.workerId} INIT_BLOCKBOOK_ISOSOCKETS - elapsedMs=${elapsedMs} - allReady=`, allReady, { logServerConsole: true })
                    if (self.bb_Sockets_aborted) { // received disconnect (logout) signal?
                        clearInterval(wait_intId)
                        utilsWallet.log(`appWorker >> ${self.workerId} INIT_BLOCKBOOK_ISOSOCKETS - ABORTED`, null, { logServerConsole: true })
                        self.postMessage({ msg: 'BLOCKBOOK_ISOSOCKETS_DONE', status: 'RES', data: { walletFirstPoll, aborted: true } }) 
                    }
                    if (allReady) { // all requested connections setup
                        clearInterval(wait_intId)
                        if (symbolsConnected.length > 0) {
                            utilsWallet.logMajor('pink', 'green', `appWorker >> ${self.workerId} INIT_BLOCKBOOK_ISOSOCKETS - DONE - (re)connected=`, symbolsConnected.join(','), { logServerConsole: true })
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
            Object.values(configWallet.walletsMeta).filter(p => p.type === configWallet.WALLET_TYPE_UTXO && p.use_BBv3).forEach(p => { 
                if (!configWallet.getSupportedMetaKeyBySymbol(p.symbol)) return
                GetSyncInfo(p.symbol)
            })
            break
        }
        case 'DISCONNECT_BLOCKBOOK_ISOSOCKETS': {
            resetConnectionStats()
            self.bb_Sockets_aborted = true
            self.bb_Sockets = {}
            const disconnectCount = workerBlockbook.isosocket_Disconnect_Blockbook(networkConnected, networkStatusChanged, data.loaderWorker, data.walletSymbols)
            if (disconnectCount > 0) {
                utilsWallet.log(`appWorker >> ${self.workerId} DISCONNECT_BLOCKBOOK_ISOSOCKETS - DONE - disconnected=`, disconnectCount, { logServerConsole: true })
            }
            break
        }

        case 'INIT_WEB3_SOCKET': {
            //utilsWallet.debug(`appWorker >> ${self.workerId} INIT_WEB3_SOCKET...`)
            
            var setupCount = workerWeb3.web3_Setup_SocketProvider(data.walletSymbols)
            
            //if (data.wallet && data.wallet.assets) {
                // TODO: take in data.wallet; iterate erc20's; call totalSupply() & postback 
                // const mainnetErc20s = data.wallet.assets.filter(p => p.addressType === configWallet.ADDRESS_TYPE_ETH && utilsWallet.isERC20(p) && !p.isErc20_Ropsten);
                // const testnetErc20s = data.wallet.assets.filter(p => p.addressType === configWallet.ADDRESS_TYPE_ETH && utilsWallet.isERC20(p) && p.isErc20_Ropsten);
                // utilsWallet.warn(`INIT_WEB3_SOCKET - mainnetErc20s`, mainnetErc20s)
                // utilsWallet.warn(`INIT_WEB3_SOCKET - testnetErc20s`, testnetErc20s)
                //...
            //}
            Object.values(configWallet.walletsMeta).filter(p => p.type === configWallet.WALLET_TYPE_ACCOUNT).forEach(p => { 
                if (!configWallet.getSupportedMetaKeyBySymbol(p.symbol)) return
                GetSyncInfo(p.symbol)
            })

            if (setupCount > 0) {
                utilsWallet.log(`appWorker >> ${self.workerId} INIT_WEB3_SOCKET - DONE - connected=`, setupCount, { logServerConsole: true })
            }
            break
        }
        case 'DISCONNECT_WEB3_SOCKET': {
            resetConnectionStats()
            const disconnectCount = workerWeb3.web3_Disconnect_SocketProvider(data.walletSymbols)
            if (disconnectCount > 0) {
                utilsWallet.log(`appWorker >> ${self.workerId} DISCONNECT_WEB3_SOCKET - DONE - disconnected=`, disconnectCount, { logServerConsole: true })
            }
            break
        }

        case 'GET_ETH_TX_FEE_WEB3': {
            //utilsWallet.debug(`appWorker >> ${self.workerId} GET_ETH_TX_FEE_WEB3...`)
            workerWeb3.getGasPrices(data.asset, data.params).then(result => {
                utilsWallet.log('GET_ETH_TX_FEE_WEB3_DONE: posting back', result)
                self.postMessage({ msg: 'GET_ETH_TX_FEE_WEB3_DONE', status: 'RES', data: { fees: result, assetSymbol: data.asset.symbol } }) 
            })
            break
        }

        case 'GET_ETH_ESTIMATE_TX_GAS':
            //utilsWallet.debug(`appWorker >> ${self.workerId} GET_ETH_ESTIMATE_TX_GAS...`)
            workerWeb3.estimateGasTx(data.asset, data.params).then(result => {
                utilsWallet.log('GET_ETH_ESTIMATE_TX_GAS_DONE: posting back', result)
                self.postMessage({ msg: 'GET_ETH_ESTIMATE_TX_GAS_DONE', status: 'RES', data: { fees: result, assetSymbol: data.asset.symbol } }) 
            })
            break

        case 'GET_ETH_TX_HEX_WEB3': {
            //utilsWallet.debug(`appWorker >> ${self.workerId} GET_ETH_TX_HEX_WEB3...`)
            workerWeb3.createTxHex_Eth(data.asset, data.params, data.privateKey).then(result => {
                utilsWallet.log('GET_ETH_TX_HEX_WEB3: posting back', result)
                self.postMessage({ msg: 'GET_ETH_TX_HEX_WEB3_DONE', status: 'RES', data: { txHex: result, assetSymbol: data.asset.symbol } }) 
            })
            break
        }
        case 'GET_ERC20_TX_HEX_WEB3':  {
            //utilsWallet.debug(`appWorker >> ${self.workerId} GET_ERC20_TX_HEX_WEB3...`)
            workerWeb3.createTxHex_erc20(data.asset, data.params, data.privateKey).then(result => {
                utilsWallet.log('GET_ERC20_TX_HEX_WEB3: posting back', result)
                self.postMessage({ msg: 'GET_ERC20_TX_HEX_WEB3_DONE', status: 'RES', data: { txHex: result, assetSymbol: data.asset.symbol } }) 
            })
            break
        }
        case 'PUSH_TX_WEB3': {
            //utilsWallet.debug(`appWorker >> ${self.workerId} PUSH_TX_WEB3...`)
            workerWeb3.pushRawTransaction_Account(data.payTo, data.asset, data.txHex).then(result => {
                utilsWallet.log('PUSH_TX_WEB3: posting back', result)
                self.postMessage({ msg: 'PUSH_TX_WEB3_DONE', status: 'RES', data: { res: result.res, err: result.err, assetSymbol: data.asset.symbol } }) 
            })
            break            
        }

        case 'PUSH_TX_BLOCKBOOK': {
            //utilsWallet.debug(`appWorker >> ${self.workerId} PUSH_TX_BLOCKBOOK...`)
            workerPushTx.blockbook_pushTx(data.asset, data.txhex, data.wallet)
            break
        }

        case 'CONNECT_ADDRESS_MONITORS': {
            //utilsWallet.debug(`appWorker >> ${self.workerId} CONNECT_ADDRESS_MONITORS...`)
            if (data && data.wallet) {
                workerAddressMonitor.addressMonitors_Sub_Unsub(data.wallet, true)
            }
            break
        }
        case 'DISCONNECT_ADDRESS_MONITORS': {
            //utilsWallet.debug(`appWorker >> ${self.workerId} DISCONNECT_ADDRESS_MONITORS...`)
            if (data && data.wallet) {
                workerAddressMonitor.addressMonitors_Sub_Unsub(data.wallet, false)
            }
            break
        }

        case 'STATE_RESPONSE': {
            //utilsWallet.debug(`appWorker >> ${self.workerId} STATE_RESPONSE`)
            const stateItem = data.stateItem
            const stateKey = data.stateKey
            const value = data.value
            const context = data.context
            if (stateItem === 'ASSET') {
                const { asset, wallet, ux } = value

                // process balance (& tx/utxo) updates
                if (context === 'ASSET_REFRESH_ADDR_MONITOR') {  // caller is an address monitor
                    //utilsWallet.log('DBG1 - ASSET_REFRESH_ADDR_MONITOR')
                    refreshAssetsFull([asset], wallet) 
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
                            refreshAssetsFull([asset], wallet)
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
        }

        //
        // asset refresh requests - note: request to refresh an erc20 asset are actually requests to update eth
        //
        case 'REFRESH_ASSET_BALANCE': {
            //utilsWallet.debug(`appWorker >> ${self.workerId} REFRESH_ASSET_BALANCE ${data.asset.symbol}...`)
            refreshAssetBalance(data.asset, data.wallet)
            break
        }
        case 'REFRESH_ASSET_FULL': {
            utilsWallet.logMajor('magenta','blue', `appWorker >> ${self.workerId} REFRESH_ASSET_FULL ${data.asset.symbol}...`, null, { logServerConsole: true })
            refreshAssetsFull([data.asset], data.wallet)
            break
        }
        case 'REFRESH_MULTI_ASSET_FULL': {
            utilsWallet.warn(`appWorker >> ${self.workerId} REFRESH_MULTI_ASSET_FULL ${data.assets.map(p => p.symbol).join()}...`)
            refreshAssetsFull(data.assets, data.wallet)
            break
        }

        case 'POST_OFFLINE_CHECK': {
            //utilsWallet.debug(`appWorker >> ${self.workerId} POST_OFFLINE_CHECK...`)
            postOfflineCheck()
            break
        }

        // arbitrary address balances -- used by privkey import; consolidated return format, unlike wallet-external
        case 'GET_ANY_ADDRESS_BALANCE': {
            const addrs = data.addrs
            utilsWallet.logMajor('magenta', 'blue', `appWorker >> ${self.workerId} GET_ANY_ADDRESS_BALANCE... asset, addrs=`, data.asset, data.addrs)
            //debugger
            if (data.asset.symbol === 'ETH' || data.asset.symbol === 'ETH_TEST' || utilsWallet.isERC20(data.asset.symbol)) {
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
        case 'GET_SYNC_INFO': {
            //if (configWallet.getSupportedMetaKeyBySymbol(data.symbol)) {
                GetSyncInfo(data.symbol)
            //}
            break
        }

        // scan for non-standard addresses - add any found to our address-monitor list
        case 'SCAN_NON_STANDARD_ADDRESSES': {
            utilsWallet.logMajor('magenta','blue', `appWorker >> ${self.workerId} SCAN_NON_STANDARD_ADDRESSES ${data.asset.symbol}...`, null, { logServerConsole: true })
            const dispatchActions = []
            const nonStdAddrs_Txs = [] // { nonStdAddr, protect_op_txid }
            walletP2shBtc.scan_NonStdOutputs({ asset: data.asset, dispatchActions, nonStdAddrs_Txs },)
            var mergedDispatchActions = mergeDispatchActions(data.asset, dispatchActions)
          
            if (mergedDispatchActions.length > 0) {
                //utilsWallet.logMajor('magenta','blue', `appWorker >> ${self.workerId} SCAN_NON_STANDARD_ADDRESSES ${data.asset.symbol}, mergedDispatchActions=`, mergedDispatchActions, { logServerConsole: true })
                self.postMessage({ msg: 'REQUEST_DISPATCH_BATCH', status: 'DISPATCH', data: { dispatchActions: mergedDispatchActions } })
            }
            else utilsWallet.log(`appWorker >> ${self.workerId} SCAN_NON_STANDARD_ADDRESSES... no dispatch actions found`)
            
            if (nonStdAddrs_Txs.length > 0) {
                //utilsWallet.logMajor('magenta','blue', `appWorker >> ${self.workerId} SCAN_NON_STANDARD_ADDRESSES ${data.asset.symbol}, nonStdAddrs_Txs=`, nonStdAddrs_Txs, { logServerConsole: true })
                self.postMessage({ msg: 'ADD_NON_STANDARD_ADDRESSES', status: 'EXEC', data: { asset: data.asset, nonStdAddrs_Txs } })
            }
            else utilsWallet.log(`appWorker >> ${self.workerId} SCAN_NON_STANDARD_ADDRESSES... no new non-std addr's found`)
            break
        }
    }
    return Promise.resolve()

    function GetSyncInfo(symbol) {
        if ((symbol === 'ZEC_TEST'  && !configWallet.WALLET_INCLUDE_ZEC_TEST)
         || (symbol === 'LTC_TEST'  && !configWallet.WALLET_INCLUDE_LTC_TEST)
         || (symbol === 'BTC_TEST'  && !configWallet.WALLET_INCLUDE_BTC_TEST)
         || (symbol === 'BTC_TEST2' && !configWallet.WALLET_INCLUDE_BTC_TEST)
         || (symbol === 'ETH_TEST'  && !configWallet.WALLET_INCLUDE_ETH_TEST)
        ) {
            return
        }

        const meta = configWallet.getMetaBySymbol(symbol)
        if (meta.type === configWallet.WALLET_TYPE_UTXO) {
            // don't send redundant requests: causes 429's
            // (BTC_SEG's GetSyncInfo will update BTC_SEG2)
            // if (symbol === 'BTC_SEG2' || symbol === 'BTC_TEST2') return 

            if (meta.use_BBv3) {
                //utilsWallet.log(`appWorker >> ${self.workerId} ${symbol} GET_SYNC_INFO...`)
                workerBlockbook.getSyncInfo_Blockbook_v3(symbol, undefined, undefined, networkStatusChanged)
            }
            else {
                workerInsight.getSyncInfo_Insight(symbol, undefined, undefined, networkStatusChanged)
            }
        }
        else if (meta.type === configWallet.WALLET_TYPE_ACCOUNT) {
            if (symbol === 'ETH' || symbol === 'ETH_TEST') {
                //utilsWallet.log(`appWorker >> ${self.workerId} ${symbol} GET_SYNC_INFO...`)
                workerGeth.getSyncInfo_Geth(symbol, undefined, undefined, networkStatusChanged)
            }
        }
    }

    //
    // main actions for asset address balance & tx updates
    // these fn's populate the store data after retrieving data from 3PBPs (blockbook, insight, web3)
    //
    function refreshAssetsFull(assets, wallet) { //}, utxo_known_spentTxIds) {

        var allDispatchActions = []
        const refreshAssetOps = assets.map((asset) => { 
            return new Promise((resolveAssetOp, rejectAssetOp) => {

                // !! different creation semantics for node? (maybe not after v13 upgrade)
                // const subWorker = new SubWorker_GetAddrFull()
                // subWorker.addEventListener('message', e => {
                //     const message = e.data;
                //     console.log(`[From subWorker]: ${message}`);
                // })
                // subWorker.postMessage({asset, wallet});
                // but this approach fails -- because get_BlockbookSocketIo() socket can't be shared to the child worker

                //****
                workerAddressMempool.mempool_get_BB_txs(asset, wallet) //, (utxo_mempool_spentTxIds) => {

                //utilsWallet.debug(`appWorker >> ${self.workerId} refreshAssetsFull ${asset.symbol}`) // - utxo_mempool_spentTxIds=`, utxo_mempool_spentTxIds)
                //console.time(`refreshAssetFull_${asset.symbol}`)
    
                // get BB scoket, for account types (needed for ETH v2)
                var bbSocket
                if (asset.type === configWallet.WALLET_TYPE_ACCOUNT && asset.symbol !== 'EOS') {
                    bbSocket = get_BlockbookSocketIo(asset)
                }
            
                // when called from worker-pushtx, we can augment BB's mempool (which lags) with known spent txid's
                // deprecated - utxo_known_spentTxIds
                //const spentTxIds = _.uniq(utxo_mempool_spentTxIds.concat(utxo_known_spentTxIds))
    
                // query each address
                var assetDispatchActions = []
                const refreshAddrOps = asset.addresses.map(a => {
                    return new Promise((resolveAddrOp, rejectAddrOp) => {
                        const addrNdx = asset.addresses.findIndex(p => p.addr === a.addr)
    
                        workerExternal.getAddressFull_External({ wallet, asset, addrNdx, bbSocket, /*utxo_mempool_spentTxIds: spentTxIds,*/ }, (result) => {
                            const { dispatchActions, error } = result
                            
                            if (error) {
                                // Dispatch error state for this address
                                utilsWallet.error(`## refreshAssetsFull - ${asset.symbol} addrNdx=${addrNdx} - fetch error: ${error}`)
                                const errorAction = {
                                    type: actionsWallet.WCORE_SET_ADDRESS_FETCH_ERROR,
                                    payload: {
                                         symbol: asset.symbol,
                                        addrNdx: addrNdx,
                                          error: error,
                                       updateAt: new Date()
                                    }
                                }
                                assetDispatchActions = [...assetDispatchActions, errorAction]
                            }
                            else if (dispatchActions && dispatchActions.length > 0) {
                                assetDispatchActions = [...assetDispatchActions, ...dispatchActions]
                            }
                            
                            resolveAddrOp() // Always resolve to let other addresses continue
                        })
                })})
                //****

                Promise.all(refreshAddrOps)
                .then((res) => {
                    // web3 eth cleanup -- needed for ETH dedicatedWeb3 cleanup
                    for (var addrNdx=0 ; addrNdx < asset.addresses.length ; addrNdx++) {
                        workerExternal.getAddressFull_Cleanup({ wallet, asset, addrNdx })
                    }

                    // merge asset dispatch actions
                    if (assetDispatchActions.length > 0) {
                        //utilsWallet.log(`appWorker >> ${self.workerId} - refreshAssetsFull - ${asset.symbol} - allDispatchActions.length=${allDispatchActions.length}`)
                        allDispatchActions = [...allDispatchActions, ...mergeDispatchActions(asset, assetDispatchActions)]
                    }
                    resolveAssetOp()
                })
            })
        })

        Promise.all(refreshAssetOps)
        .then((res) => {
            // dispatch merged asset actions to reducer - all assets, all addresses one batch 
            if (allDispatchActions.length > 0) {
                utilsWallet.log(`appWorker >> ${self.workerId} - refreshAssetsFull - ${assets.map(p => p.symbol).join()} - allDispatchActions.length=${allDispatchActions.length}`)
                self.postMessage({ msg: 'REQUEST_DISPATCH_BATCH', status: 'DISPATCH', data: { dispatchActions: allDispatchActions } } ) // post dispatch batch request
            }
        })
    }

    function refreshAssetBalance(asset, wallet) {
        workerAddressMempool.mempool_get_BB_txs(asset, wallet) //, (utxo_mempool_spentTxIds) => {

        //utilsWallet.debug(`appWorker >> ${self.workerId} refreshAssetBalance ${asset.symbol}`) // - utxo_mempool_spentTxIds=`, utxo_mempool_spentTxIds)

        // get BB scoket, for account types (needed for ETH v2)
        var bbSocket
        if (asset.type === configWallet.WALLET_TYPE_ACCOUNT && asset.symbol !== 'EOS') {
            bbSocket = get_BlockbookSocketIo(asset)
        }

        var allDispatchActions = []
        const refreshOps = asset.addresses.map(a => {
            return new Promise((resolve, reject) => {
                const addrNdx = asset.addresses.findIndex(p => p.addr === a.addr)
                workerExternal.getAddressBalance_External({ wallet, asset, addrNdx, /*utxo_mempool_spentTxIds,*/ bbSocket },
                    (result) => {
                        const { dispatchActions, error } = result
                        
                        if (error) {
                            // Dispatch error state for this address
                            utilsWallet.error(`## refreshAssetBalance - ${asset.symbol} addrNdx=${addrNdx} - fetch error: ${error}`)
                            const errorAction = {
                                type: actionsWallet.WCORE_SET_ADDRESS_FETCH_ERROR,
                                payload: {
                                    symbol: asset.symbol,
                                    addrNdx: addrNdx,
                                    error: error,
                                    updateAt: new Date()
                                }
                            }
                            allDispatchActions = [...allDispatchActions, errorAction]
                        }
                        else if (dispatchActions && dispatchActions.length > 0) {
                            allDispatchActions = [...allDispatchActions, ...dispatchActions]
                        }
                        
                        resolve() // Always resolve to let other addresses continue
                    })
        })})

        Promise.all(refreshOps)
        .then((res) => {
            if (allDispatchActions.length > 0) {
                //utilsWallet.debug(`appWorker >> ${self.workerId} refreshAssetBalance - ${asset.symbol} allDispatchActions.length=${allDispatchActions.length}`)

                allDispatchActions = mergeDispatchActions(asset, allDispatchActions)
                self.postMessage({ msg: 'REQUEST_DISPATCH_BATCH', status: 'DISPATCH', data: { dispatchActions: allDispatchActions } } ) // post dispatch batch request
            }
        })
    }

    // perf - transmogrify multiple WCORE_SET_ADDRESS_FULL / WCORE_SET_ENRICHED_TXS actions into a single WCORE_SET_ADDRESSES_FULL_MULTI / WCORE_SET_ENRICHED_TXS_MULTI
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

    function networkStatusChanged(symbol, info) {
        ////utilsWallet.debug(`appWorker >> ${self.workerId} networkStatusChanged ${symbol} txid=${txid}`)
        self.postMessage({ msg: 'NETWORK_STATUS_CHANGE', status: 'ok', data: { symbol, info } })
    }
    function networkConnected(symbol, connected) {
        //utilsWallet.debug(`appWorker >> ${self.workerId} networkConnected ${symbol} connected=${connected}`)
        self.postMessage({ msg: 'NETWORK_CONNECTED_CHANGE', status: 'ok', data: { symbol, connected } }) 
    }
}

self.get_BlockbookSocketIo = function(asset) { 
    const socketToUse = 
          asset.symbol === 'ETH_TEST' || asset.isErc20_Ropsten ? 'ETH_TEST'
        : utilsWallet.isERC20(asset) ? 'ETH'
        : asset.symbol

    var socket = self.blockbookSocketIos[socketToUse]

    if (socket === undefined) {
        if (configWS.blockbook_ws_config[socketToUse] === undefined) {
            utilsWallet.error(`appWorker >> ${self.workerId} get_BlockbookSocketIo ${asset.symbol}: no socket config!`)
        }
        else {
            try {
                //utilsWallet.debug(`appWorker >> ${self.workerId} get_BlockbookSocketIo ${asset.symbol}: creating new socket...`)
                const ws_url = new URL(configWS.blockbook_ws_config[socketToUse].url)
                
                // custom reconnect options - not too fast; we have a global volatile sockets reconnector that will handle disconnects
                socket = io(configWS.blockbook_ws_config[socketToUse].url, {
                    transports: ['websocket'],
                    reconnection: true,
                    reconnectionDelay: 5000,        // Start at 5 seconds
                    reconnectionDelayMax: 60000,    // Max 60 seconds
                    reconnectionAttempts: 5,        // Give up after 5 tries
                    timeout: 10000,                 // Connection timeout
                    transportOptions: {
                        websocket: {
                              extraHeaders: {
                                "User-Agent": configExternal.blockbookHeaders["User-Agent"], //"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36",
                                "Connection": configExternal.blockbookHeaders["Connection"], //"Upgrade",
                                "Upgrade": configExternal.blockbookHeaders["Upgrade"], //"websocket",
                                "Sec-WebSocket-Extensions": configExternal.blockbookHeaders["Sec-WebSocket-Extensions"], //"permessage-deflate; client_max_window_bits",
                                "Sec-WebSocket-Version": configExternal.blockbookHeaders["Sec-WebSocket-Version"], //"13",
                                "Accept-Encoding": configExternal.blockbookHeaders["Accept-Encoding"], //"gzip, deflate, br",
                                "Accept-Language": configExternal.blockbookHeaders["Accept-Language"], //"en-US,en;q=0.9,id;q=0.8",
                                "Cache-Control": configExternal.blockbookHeaders["Cache-Control"], //"no-cache",
                                "Pragma": configExternal.blockbookHeaders["Pragma"], //"no-cache",
                                "Host": ws_url.hostname,
                                "Origin": ws_url.origin.replace('wss', 'https'),
                            } 
                        }
                    }
                })
                self.blockbookSocketIos[socketToUse] = socket
                
                socket.on('connect', function() { 
                    utilsWallet.log(`appWorker >> ${self.workerId} BLOCKBOOK WS ${asset.symbol} - IO - connected ${ws_url.toString()}`)
                })
                socket.on('reconnect', () => {
                    utilsWallet.warn(`appWorker >> ${self.workerId} BLOCKBOOK WS ${asset.symbol} - IO - reconnected ${ws_url.toString()}`)
                })   
            } 
            catch(err) {
                utilsWallet.error(`appWorker >> ${self.workerId} BLOCKBOOK WS ${asset.symbol} - IO - err ${ws_url.toString()}`, err)
            }
        }
    }
    return socket
}
