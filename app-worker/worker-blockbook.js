// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.

const isoWs = require('isomorphic-ws')
const BigNumber = require('bignumber.js')

const configWS = require('../config/websockets')
const configExternal = require('../config/wallet-external')
const configWallet = require('../config/wallet')

const walletUtxo = require('../actions/wallet-utxo')
const actionsWallet = require('../actions')

const utilsWallet = require('../utils')

module.exports = {

    // BB v3
    getAddressFull_Blockbook_v3: (wallet, asset, address, utxo_mempool_spentTxIds, allDispatchActions) => {
        return getAddressFull_Blockbook_v3(wallet, asset, address, utxo_mempool_spentTxIds, allDispatchActions)
    },
    getAddressBalance_Blockbook_v3: (asset, address) =>  {
        return getAddressBalance_Blockbook_v3(asset, address)
    },

    // converts blockbook tx format to insight-api format
    mapTx_BlockbookToInsight: (asset, bbTx) => {
        return mapTx_BlockbookToInsight(asset, bbTx)
    },

    // called for initial block-sync state - distinct from new blocks
    // also -- called for keep-alives of the WS connections (for direct trezor node connections)
    getSyncInfo_Blockbook_v3: (symbol, receivedBlockNo = undefined, receivedBlockTime = undefined) => {
        return getSyncInfo_Blockbook_v3(symbol, receivedBlockNo, receivedBlockTime)
    },

    // blockbook isosockets: note this is needed for a different BB API/interface compared to get_BlockbookSocketIo()
    // considered VOLATILE -- no built-in reconnect
    isosocket_Setup_Blockbook: (networkConnected, networkStatusChanged, loaderWorker) => {
        return isosocket_Setup_Blockbook(networkConnected, networkStatusChanged, loaderWorker)
    },

    isosocket_send_Blockbook: (x, method, params, callback) => {
       return isosocket_send_Blockbook(x, method, params, callback)
    }
}

// BB v3
function getAddressFull_Blockbook_v3(wallet, asset, address, utxo_mempool_spentTxIds, allDispatchActions) {
    const symbol = asset.symbol
    utilsWallet.debug(`getAddressFull_Blockbook_v3 ${symbol}...`)

    return new Promise((resolve, reject) => {
        isosocket_send_Blockbook(symbol, 'getAccountInfo',  {
              descriptor: address,
                 details: 'txids', // { basic | balance | txids | txs }
                    page: undefined, 
                pageSize: configWallet.WALLET_MAX_TX_HISTORY || 888, 
                    from: undefined, 
                      to: undefined, 
          contractFilter: undefined
        }, (txData) => {

            if (!txData) { utilsWallet.error(`## getAddressFull_Blockbook_v3 ${symbol} ${address} - no txData!`); reject(); return }
    
            // axiosRetry(axios, CONST.AXIOS_RETRY_EXTERNAL)
            // axios.get(configExternal.walletExternal_config[symbol].api.utxo(address))
            // .then(async (utxoData) => {
            isosocket_send_Blockbook(symbol, 'getAccountUtxo', {
                descriptor: address
            } , async (utxoData) => {

                if (!utxoData) { utilsWallet.error(`## getAddressFull_Blockbook_v3 ${symbol} ${address} - no utxoData!`); reject(); return }                

                utilsWallet.debug(`getAddressFull_Blockbook_v3 ${symbol} ${address} - txData.txs.len=${txData.txs}, utxoData.length=${utxoData.length}`)

                // utxo's
                const utxos = utxoData.map(p => { return { satoshis: Number(p.value), txid: p.txid, vout: p.vout, } })                

                // tx's
                const totalTxCount = txData.txs
                const addrTxs = txData.txids || []
    
                // filter: new tx's, or known tx's that aren't yet enriched, or unconfirmed tx's
                const assetAddress = asset.addresses.find(p => p.addr == address)
                const newMinimalTxs = addrTxs.filter(p => 
                    !assetAddress.txs.some(p2 => p2.txid == p 
                        && p2.isMinimal == false
                        && p2.block_no != -1)
                )
                .map(p => { return { txid: p, isMinimal: true } }) // TX_MINIMAL 
    
                const res = {
                    balance: txData.balance,
                    unconfirmedBalance: txData.unconfirmedBalance,
                    utxos,
                    totalTxCount,
                    cappedTxs: addrTxs.length < totalTxCount, 
                }
    
                if (newMinimalTxs.length > 0) {
                    // queue enrich tx actions
                    const enrichOps = newMinimalTxs.map((tx) => { return enrichTx(wallet, asset, tx, address) })
    
                    // update batch
                    await Promise.all(enrichOps)
                    .then((enrichedTxs) => {
                        const dispatchTxs = enrichedTxs.filter(p => p != null)
                        if (dispatchTxs.length > 0) {
                            utilsWallet.debug(`getAddressFull_Blockbook_v3 ${symbol} ${address} - enrichTx done for ${dispatchTxs.length} tx's - requesting WCORE_SET_ENRICHED_TXS...`)
    
                            const dispatchAction = {
                                type: actionsWallet.WCORE_SET_ENRICHED_TXS,
                                payload: { updateAt: new Date(), symbol: asset.symbol, addr: address, txs: dispatchTxs, res }
                            }
                            allDispatchActions.push(dispatchAction)
                        }
                    })
                }
    
                // pass through the state update -- in v1 getAddressFull format
                const ret = Object.assign({}, res, { txs: newMinimalTxs } )
                resolve(ret)
            })
        })
    })
}

// converts blockbook tx format to insight-api format
function mapTx_BlockbookToInsight(asset, bbTx) {
    const insightTx = {
           txid: bbTx.txid,
        version: bbTx.version,
      blockhash: (bbTx.blockhash !== undefined ? bbTx.blockhash : bbTx.blockHash !== undefined ? bbTx.blockHash : undefined),
    blockheight: (bbTx.blockheight == 0 || bbTx.blockHeight == 0) ? -1 : (bbTx.blockheight != undefined ? bbTx.blockheight : bbTx.blockHeight !== undefined ? bbTx.blockHeight : undefined),
  confirmations: bbTx.confirmations,
           time: (bbTx.blocktime !== undefined ? bbTx.blocktime : bbTx.blockTime !== undefined ? bbTx.blockTime : undefined),
      blocktime: (bbTx.blocktime !== undefined ? bbTx.blocktime : bbTx.blockTime !== undefined ? bbTx.blockTime : undefined),
       valueOut: Number(utilsWallet.toDisplayUnit(new BigNumber(bbTx.value), asset)),
        valueIn: Number(utilsWallet.toDisplayUnit(new BigNumber(bbTx.valueIn), asset)),
           fees: Number(utilsWallet.toDisplayUnit(new BigNumber(bbTx.fees), asset)),
         //size: bbTx.hex.length,
    }
    insightTx.vin = bbTx.vin.map(p => {
        return {
            txid: p.txid, 
            vout: p.vout,
        sequence: p.sequence,
               n: p.n,
            addr: p.addresses[0],
        valueSat: Number(p.value),
           value: Number(utilsWallet.toDisplayUnit(new BigNumber(p.value), asset)),
            //doubleSpentTxID: null,
            //scriptSig: ...
        }
    })
    insightTx.vout = bbTx.vout.map(p => {
        return {
            value: utilsWallet.toDisplayUnit(new BigNumber(p.value), asset),
                n: p.n,
     scriptPubKey: { hex: p.hex, addresses: p.addresses,
                //asm: null,
                //type: null,
                   },
      //spentTxId: null, 
     //spentIndex: null, 
    //spentHeight: null,
        }
    })
    //console.log('bbTx', bbTx)
    //console.log('insightTx', insightTx)

    return insightTx
}

function getAddressBalance_Blockbook_v3(asset, address) {
    const symbol = asset.symbol

    utilsWallet.debug(`getAddressBalance_Blockbook_v3 ${symbol} ${address}...`)
    
    return new Promise((resolve, reject) => {
        const params = {
            descriptor: address, details: 'balance', // { basic | balance | txids | txs }
            page: undefined, pageSize: 10, from: undefined, to: undefined, contractFilter: undefined
        }

        isosocket_send_Blockbook(symbol, 'getAccountInfo', params, (data) => {
            utilsWallet.debug(`getAddressBalance_Blockbook_v3 ${symbol} ${address} - data=`, data)
            if (data) {
                resolve({
                    symbol,
                    balance: new BigNumber(data.balance),
                    unconfirmedBalance: new BigNumber(data.unconfirmedBalance),
                    address,
                })
            }
            else {
                resolve({ symbol, balance: new BigNumber(0), unconfirmedBalance: new BigNumber(0) })
            }
        })
    })
}

// called for initial block-sync state - distinct from new blocks
function getSyncInfo_Blockbook_v3(symbol, receivedBlockNo = undefined, receivedBlockTime = undefined) {
    isosocket_send_Blockbook(symbol, 'getInfo', {}, (data) => {

        const dispatchActions = []

        dispatchActions.push({
            type: actionsWallet.SET_ASSET_BLOCK_INFO,
         payload: {  symbol,
            receivedBlockNo: receivedBlockNo || data.bestheight || data.bestHeight,
          receivedBlockTime: receivedBlockTime || new Date().getTime() }
        })

        if (symbol === 'ETH') { // eth mainnet - update erc20s
            const erc20_symbols = Object.keys(configExternal.erc20Contracts)
            erc20_symbols.forEach(erc20_symbol => {
                dispatchActions.push({
                    type: actionsWallet.SET_ASSET_BLOCK_INFO,
                 payload: {  symbol: erc20_symbol,
                    receivedBlockNo: receivedBlockNo || data.bestheight,
                  receivedBlockTime: receivedBlockTime || new Date().getTime() }
                })
            })
        }

        // update batch
        self.postMessage({ msg: 'REQUEST_DISPATCH_BATCH', status: 'DISPATCH', data: { dispatchActions } })
    })
}

// blockbook isosockets: note this is needed for a different BB API/interface compared to get_BlockbookSocketIo()
// considered VOLATILE -- no built-in reconnect
function isosocket_Setup_Blockbook(networkConnected, networkStatusChanged, loaderWorker) {
    const setupSymbols = []
    utilsWallet.debug(`appWorker >> ${self.workerId} isosocket_Setup_Blockbook...`)

    for (var assetSymbol in configWS.blockbook_ws_config) {
        if (assetSymbol === 'ETH_TEST' && !configWallet.WALLET_INCLUDE_ETH_TEST) continue
        if (assetSymbol === 'LTC_TEST' && !configWallet.WALLET_INCLUDE_LTC_TEST) continue
        if (assetSymbol === 'ZEC_TEST' && !configWallet.WALLET_INCLUDE_ZEC_TEST) continue
        if (assetSymbol === 'BTC_TEST' && !configWallet.WALLET_INCLUDE_BTC_TEST) continue

        setupSymbols.push(
            (function (x) {

                // if we're called more than once, then the socket object already exists
                if (self.blockbookIsoSockets[x] !== undefined) { // safari refocus handling
                    if (self.blockbookIsoSockets[x].readyState == 2 || self.blockbookIsoSockets[x].readyState == 3) { // if "closing" or "closed" respectively (connecting=0, open=1)
                        utilsWallet.warn(`appWorker >> ${self.workerId} isosocket_Setup_Blockbook ${x} - found disconnected socket for ${x} - nuking it!`)
                        self.blockbookIsoSockets[x].close()
                        self.blockbookIsoSockets[x] = undefined
                    }
                }

                // initial / main path
                if (self.blockbookIsoSockets[x] === undefined) { // connect & init

                    utilsWallet.debug(`appWorker >> ${self.workerId} blockbookIsoSockets ${x}... wsUrl=`, configWS.blockbook_ws_config[x].url, { logServerConsole: true })

                    self.blockbookIsoSockets[x] = new isoWs(configWS.blockbook_ws_config[x].url + "/websocket") 
                    var socket = self.blockbookIsoSockets[x]
                    socket.symbol = x // add a property to the socket object, for logging in case it won't connect
                    self.blockbookIsoSockets_messageID[x] = 0 // init early, testing...
                    self.blockbookIsoSockets_pendingMessages[x] = {}
                    self.blockbookIsoSockets_subscriptions[x] = {}

                    // socket lifecycle
                    socket.onopen = () => {
                        utilsWallet.debug(`appWorker >> ${self.workerId} blockbookIsoSockets ${x} - connect...`)
                        try {

                            // setup (exactly once) a keep-alive timer; needed for direct Trezor WS connections to stop server idle drops
                            if (self.blockbookIsoSockets_keepAliveIntervalID[x] === undefined) {
                                self.blockbookIsoSockets_keepAliveIntervalID[x] = 
                                    setInterval(() => {
                                        isosocket_send_Blockbook(x, 'getInfo', {}, (data) => {
                                            //utilsWallet.log(`keep-alive isoWS ${x} getInfo`, data)
                                        })
                                       // note: rate limiting of WS requests by trezor
                                    }, 1000 * 30)
                            }

                            if (!loaderWorker) {
                                if (configWS.blockbook_ws_config[x].subBlocks === true) {
                                    // subscribe new block from BB -- note, no new TX subscription in BB 
                                    const method = 'subscribeNewBlock'
                                    const params = {}
                                    if (self.blockbookIsoSockets_subId_NewBlock[x]) {
                                        delete self.blockbookIsoSockets_subscriptions[x][self.blockbookIsoSockets_subId_NewBlock[x]]
                                        self.blockbookIsoSockets_subId_NewBlock[x] = ""
                                    }
                                    self.blockbookIsoSockets_subId_NewBlock[x] = isosocket_sub_Blockbook(x, method, params, function (result) {
                                        if (!configWallet.DISABLE_BLOCK_UPDATES)  {

                                            if (result) {
                                                if (result.subscribed === true) {
                                                    utilsWallet.debug(`appWorker >> ${self.workerId} blockbookIsoSockets ${x} - block - subscribed OK`)
                                                }
                                                else {
                                                    const receivedBlockNo = result.height
                                                    utilsWallet.logMajor('cyan','black', `appWorker >> ${self.workerId} BB BLOCK ${x} - ${receivedBlockNo}`)

                                                    // save blockheight & time on asset
                                                    self.postMessage({ msg: 'REQUEST_DISPATCH_BATCH', status: 'DISPATCH',
                                                                      data: { dispatchActions: [{ 
                                                                            type: actionsWallet.SET_ASSET_BLOCK_INFO,
                                                                         payload: { symbol: x, receivedBlockNo, receivedBlockTime: new Date().getTime() }} ] }
                                                    })

                                                    // requery balance check for asset on new block - updates confirmed counts
                                                    self.postMessage({ msg: 'REQUEST_STATE', status: 'REQ',
                                                                      data: { stateItem: 'ASSET', stateKey: x, context: 'ASSET_REFRESH_NEW_BLOCK' } })                                            
 
                                                    //
                                                    // NOTE: this *duplicates* functionality in worker-geth;
                                                    //       we aren't getting up-to-date data from BB getAddressTxids when we trigger from worker-geth
                                                    //       (it's an edge case: seems to only trigger when receiving two same/identical TX's in a short period)
                                                    //

                                                    // eth - same for all erc20s
                                                    if (x === 'ETH' || x === 'ETH_TEST') {
                                                        const erc20_symbols = Object.keys(configExternal.erc20Contracts)
                                                        erc20_symbols.forEach(erc20_symbol => {

                                                            const meta = configWallet.getMetaBySymbol(erc20_symbol)
                                                            console.log(`BB ${x} -> ${erc20_symbol} -> ${meta.isErc20_Ropsten}`)
                                                            if ((x === 'ETH'      && !meta.isErc20_Ropsten)
                                                             || (x === 'ETH_TEST' && meta.isErc20_Ropsten)) {

                                                                self.postMessage({ msg: 'REQUEST_DISPATCH_BATCH', status: 'DISPATCH',
                                                                    data: { dispatchActions: [{ 
                                                                       type: actionsWallet.SET_ASSET_BLOCK_INFO,
                                                                    payload: { symbol: erc20_symbol, receivedBlockNo, receivedBlockTime: new Date().getTime() }} ] }
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
                                                    }
                                                }
                                            }
                                        }
                                    })
                                }
                            }
                        }
                        catch (err) { utilsWallet.error(`### appWorker >> ${self.workerId} blockbookIsoSockets ${x} - connect, err=`, err) }
                    }
                    socket.onclose = () => {
    
                        utilsWallet.warn(`appWorker >> ${self.workerId} blockbookIsoSockets ${x} - onclose...`)
                        self.blockbookIsoSockets[x] = undefined // nuke this so volatileSockets_ReInit() triggers another setup
                        try {
                            // reconnect - this supplements volatileSockets_ReInit() for faster reconnection
                            isosocket_Setup_Blockbook(networkConnected, networkStatusChanged)
                        }
                        catch (err) { utilsWallet.error(`### appWorker >> ${self.workerId} blockbookIsoSockets ${x} - onclose callback, err=`, err) }
                    }

                    //
                    // manual message id <-> callback handling
                    //
                    socket.onmessage = (msg) => {
                        if (msg && msg.data) {
                            var resp = JSON.parse(msg.data)
                            var callback = self.blockbookIsoSockets_pendingMessages[x][resp.id]
                            if (callback != undefined) {
                                delete self.blockbookIsoSockets_pendingMessages[x][resp.id]
                                callback(resp.data)
                            } else {
                                callback = self.blockbookIsoSockets_subscriptions[x][resp.id]
                                if (callback != undefined) {
                                    callback(resp.data)
                                }
                                else {
                                    utilsWallet.error(`### appWorker >> ${self.workerId} blockbookIsoSockets ${x} - UNKNOWN MESSAGE: no callback, msg =`, msg)
                                }                                
                            }
                        }
                    }

                    return x
                }
            })(assetSymbol)
        )
    }
    return setupSymbols.filter(p => p !== undefined)
}

function isosocket_send_Blockbook(x, method, params, callback) {
    if (self.blockbookIsoSockets[x] === undefined) {
        utilsWallet.error(`appWorker >> ### ${self.workerId} isosocket_send_Blockbook ${x} - ignoring: NO SOCKET SETUP`)
        return
    }
    if (self.blockbookIsoSockets[x].readyState != 1) {
        utilsWallet.warn(`appWorker >> ### ${self.workerId} isosocket_send_Blockbook ${x} - ignoring: invalid socket readyState=`, self.blockbookIsoSockets[x].readyState)
        return
    }

    var id = self.blockbookIsoSockets_messageID[x].toString()
    self.blockbookIsoSockets_messageID[x]++
    self.blockbookIsoSockets_pendingMessages[x][id] = callback
    var req = { id, method, params }
    self.blockbookIsoSockets[x].send(JSON.stringify(req))
    return id
}

function enrichTx(wallet, asset, tx, pollAddress) {
    return new Promise((resolve, reject) => {

        // wallet owner is part of cache key because of relative fields: tx.sendToSelf and tx.isIncoming 
        const cacheKey = `${asset.symbol}_${wallet.owner}_txid_${tx.txid}` 
        const ownAddresses = asset.addresses.map(p => { return p.addr })

        //utilsWallet.log(`** enrichTx - ${asset.symbol} ${tx.txid}...`)

        // try cache first
        utilsWallet.txdb_getItem(cacheKey)
        .then((cachedTx) => {
            if (cachedTx && cachedTx.block_no != -1) { // requery unconfirmed tx's
                cachedTx.fromCache = true
                utilsWallet.debug(`** enrichTx - ${asset.symbol} ${tx.txid} RET-CACHE`)

                resolve(cachedTx) // return from cache
            }
            else {
                isosocket_send_Blockbook(asset.symbol, 'getTransaction', { txid: tx.txid }, (bbTx) => {

                    if (bbTx) {

                        const insightTx = mapTx_BlockbookToInsight(asset, bbTx)
                        
                        // map tx (prunes vins, drops vouts)
                        const mappedTx = walletUtxo.map_insightTxs([insightTx], ownAddresses)[0]
                        //utilsWallet.log(`** enrichTx - ${asset.symbol} ${tx.txid} - adding to cache, mappedTx=`, mappedTx)

                        // add to cache
                        mappedTx.addedToCacheAt = new Date()
                        utilsWallet.txdb_setItem(cacheKey, mappedTx)
                        .then(() => {
                            utilsWallet.log(`** enrichTx - ${asset.symbol} ${tx.txid} - added to cache ok`)
                            mappedTx.fromCache = false
                            resolve(mappedTx)
                        })
                        .catch((err) => {
                            utilsWallet.logErr(err)
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
            utilsWallet.logErr(err)
            utilsWallet.error('## enrichTx - error=', err)
            resolve(null)
        })
    })
}

function isosocket_sub_Blockbook(x, method, params, callback) {
    if (self.blockbookIsoSockets[x] === undefined) {
        utilsWallet.error(`appWorker >> ${self.workerId} isosocket_sub_Blockbook ${x} - ignoring: NO SOCKET SETUP`)
        return
    }
    if (self.blockbookIsoSockets[x].readyState != 1) {
        utilsWallet.warn(`appWorker >> ### ${self.workerId} isosocket_sub_Blockbook ${x} - ignoring: invalid socket readyState=`, self.blockbookIsoSockets[x].readyState)
        return
    }

    var id = self.blockbookIsoSockets_messageID[x].toString()
    self.blockbookIsoSockets_messageID[x]++
    self.blockbookIsoSockets_subscriptions[x][id] = callback
    var req = { id, method,params }
    self.blockbookIsoSockets[x].send(JSON.stringify(req))
    return id
}

function isosocket_unsub_Blockbook(method, id, params, callback) {
    if (self.blockbookIsoSockets[x] === undefined) {
        utilsWallet.error(`appWorker >> ${self.workerId} isosocket_unsub_Blockbook ${x} - ignoring: NO SOCKET SETUP`)
        return
    }
    if (self.blockbookIsoSockets[x].readyState != 1) {
        utilsWallet.warn(`appWorker >> ### ${self.workerId} isosocket_unsub_Blockbook ${x} - ignoring: invalid socket readyState=`, self.blockbookIsoSockets[x].readyState)
        return
    }

    delete self.blockbookIsoSockets_subscriptions[x][id]
    self.blockbookIsoSockets_pendingMessages[x][id] = callback
    var req = { id, method, params }
    self.blockbookIsoSockets[x].send(JSON.stringify(req))
    return id
}