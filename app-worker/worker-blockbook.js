// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2021 Dominic Morris.

const _ = require('lodash')

const configWS = require('../config/websockets')
const configExternal = require('../config/wallet-external')
const configWallet = require('../config/wallet')

const axios = require('axios'); configExternal.blockbookHeaders.set(axios, configExternal.blockbookHeaders)

const isoWs = require('isomorphic-ws')
const BigNumber = require('bignumber.js')
const CircularBuffer = require("circular-buffer")

const walletUtxo = require('../actions/wallet-utxo')
const actionsWallet = require('../actions')

const utilsWallet = require('../utils')

const cache_bb_blocks = {}

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

    // called for initial block-sync state - and from new blocks
    // also -- called for keep-alives of the WS connections (for direct trezor node connections)
    getSyncInfo_Blockbook_v3: (symbol, receivedBlockNo = undefined, receivedBlockTime = undefined, networkStatusChanged = undefined) => {
        return getSyncInfo_Blockbook_v3(symbol, receivedBlockNo, receivedBlockTime, networkStatusChanged)
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
    //utilsWallet.log(`getAddressFull_Blockbook_v3 ${symbol}...`)

    return new Promise((resolve, reject) => {
        isosocket_send_Blockbook(symbol, 'getAccountInfo',  {
              descriptor: address,
                 details: 'txids', // { basic | balance | txids | txs }
                    page: undefined, 
                pageSize: configWallet.WALLET_MAX_TX_HISTORY || 888, 
                    from: undefined, 
                      to: undefined, 
          contractFilter: undefined
        }, (balanceAndTxData) => {

            if (!balanceAndTxData) { utilsWallet.error(`## getAddressFull_Blockbook_v3 ${symbol} ${address} - no balanceAndTxData!`); reject(); return }
    
            // axiosRetry(axios, CONST.AXIOS_RETRY_EXTERNAL)
            // axios.get(configExternal.walletExternal_config[symbol].api.utxo(address))
            // .then(async (utxoData) => {
            isosocket_send_Blockbook(symbol, 'getAccountUtxo', {descriptor: address} , async (utxosData) => {
                
                if (!utxosData) { utilsWallet.error(`## getAddressFull_Blockbook_v3 ${symbol} ${address} - no utxosData`); reject(); return }                
                if (utxosData.error) {
                    utilsWallet.error(`## getAddressFull_Blockbook_v3 ${symbol} ${address} - errored utxosData`, utxosData.error); reject();
                    return
                }
                if (!Array.isArray(utxosData)) {
                    utilsWallet.error(`## getAddressFull_Blockbook_v3 ${symbol} ${address} - invalid utxosData type`); reject();
                    return
                }
                const getUtxoSpecificOps = utxosData.map(utxo => { return new Promise((resolveSpecificUtxoOp) => {
                    
                    isosocket_send_Blockbook(symbol, 'getTransactionSpecific', { txid: utxo.txid } , async (utxoSpecificData) => {
                        //utilsWallet.debug(`blockbook tx ${utxo.txid} for ${address} utxoSpecificData`, utxoSpecificData)

                        if (!utxoSpecificData) { utilsWallet.error(`## getAddressFull_Blockbook_v3 ${symbol} ${utxo.txid} - no utxoSpecificData!`); resolveSpecificUtxoOp([]); return }
                        if (utxoSpecificData.error) { 
                            //debugger
                            // 10:07:15.116 [SW-ERR] ## getAddressFull_Blockbook_v3 BTC_TEST dce42dd5cc1d0810f6a5fba36e3965ee16dcb0b2b936c7feb18a9ffc1dd73b08 - error on getTransactionSpecific: "txid dce42dd5cc1d0810f6a5fba36e3965ee16dcb0b2b936c7feb18a9ffc1dd73b08: 500 Internal Server Error invalid character 'W' looking for beginning of value"
                            // # seems inconsistent on btc_test; care if it repro's on mainnet -- NEW RATE LIMIT ON BLOCKBOCK NODES?
                            // TODO: setup own BTC_TEST BB NODE...
                            utilsWallet.error(`## getAddressFull_Blockbook_v3 ${symbol} ${utxo.txid} - error on getTransactionSpecific: ${JSON.stringify(utxoSpecificData.error.message)}`);
                            resolveSpecificUtxoOp([]);
                            return
                        }
                        if (!utxoSpecificData.vout) { utilsWallet.error(`## getAddressFull_Blockbook_v3 ${symbol} ${utxo.txid} - no utxoSpecificData.vout!`); resolveSpecificUtxoOp([]); return }

                        // DMS - add all UTXOs for this TX that correspond to the query account
                        //       (or, that are cross-address/account OP_RETURN embeded data UTXOs)
                        const resolveSpecificUtxos = []
                        for (var j = 0; j < utxoSpecificData.vout.length; j++) {
                            const utxoSpecific = utxoSpecificData.vout[j]
                          
                            // 
                            // DMS: we *include* OP_RETURN outputs - we'll use the op_return data to allow beneficiary & benefactor to create the locking script (i.e. the address)
                            //      for the "protected" non-standard P2SH(DSIG/CLTV) outputs...
                            //
                            if ((utxo.vout == utxoSpecific.n && (utxoSpecific.scriptPubKey.addresses !== undefined && utxoSpecific.scriptPubKey.addresses.includes(address)))
                                || (utxoSpecific.scriptPubKey.addresses === undefined && utxoSpecific.scriptPubKey.type === "nulldata")  // op_return
                            ) { 
                                resolveSpecificUtxos.push({
                                    satoshis: Number(new BigNumber(utxoSpecific.value).times(1e8).toString()), //Number(utxo.value),
                                    txid: utxo.txid, 
                                    vout: utxoSpecific.n, //utxo.vout
                                    scriptPubKey: {
                                        addresses: utxoSpecific.scriptPubKey.addresses,
                                        hex: utxoSpecific.scriptPubKey.hex,
                                        type: utxoSpecific.scriptPubKey.type,
                                    }
                                })
                            }
                        }
                        resolveSpecificUtxoOp(resolveSpecificUtxos)
                    })
                }) })
                const utxoSpecifics = await Promise.all(getUtxoSpecificOps)

                const utxosFlattened = _.flatten(utxoSpecifics)

                // utxo's
                // console.log('blockbook_utxoData', utxoData)
                // const utxos = utxoData.map(p => { return { 
                //     satoshis: Number(p.value), 
                //     txid: p.txid, 
                //     vout: p.vout,
                //     // TODO: *need* scriptPubKey.hex -- for new PSBT input...
                // } })

                // it turns out that getAccountInfo(txids) does *not* return PROTECT_OP TX's; so, we must union with getAccountUtxo()'s txids (which does return p_op UTXOs)
                const addrTxs =  _.union(_.uniq(utxosData.map(p => p.txid)), balanceAndTxData.txids || []) 
                const totalTxCount = addrTxs.length
    
                // filter: new tx's, or known tx's that aren't yet enriched, or unconfirmed tx's
                const assetAddress = asset.addresses.find(p => p.addr == address)
                const newMinimalTxs = addrTxs.filter(p => 
                    !assetAddress.txs.some(p2 => p2.txid == p 
                        && p2.isMinimal == false
                        && p2.block_no != -1)
                )
                .map(p => { return { txid: p, isMinimal: true } }) // TX_MINIMAL 
    
                const res = {
                    balance: balanceAndTxData.balance,
                    unconfirmedBalance: balanceAndTxData.unconfirmedBalance,
                    utxos: utxosFlattened,
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
                            //utilsWallet.debug(`getAddressFull_Blockbook_v3 ${symbol} ${address} - enrichTx done for ${dispatchTxs.length} tx's - requesting WCORE_SET_ENRICHED_TXS...`)
    
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

    if (bbTx.vin === undefined) {
        debugger
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

    //utilsWallet.debug(`getAddressBalance_Blockbook_v3 ${symbol} ${address}...`)
    
    return new Promise((resolve, reject) => {
        const params = {
            descriptor: address, details: 'balance', // { basic | balance | txids | txs }
            page: undefined, pageSize: 10, from: undefined, to: undefined, contractFilter: undefined
        }

        isosocket_send_Blockbook(symbol, 'getAccountInfo', params, (data) => {
            //utilsWallet.debug(`getAddressBalance_Blockbook_v3 ${symbol} ${address} - data=`, data)
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

// called for initial block-sync state - and new blocks
function getSyncInfo_Blockbook_v3(symbol, _receivedBlockNo = undefined, _receivedBlockTime = undefined, networkStatusChanged = undefined) {
    //utilsWallet.debug(`getSyncInfo_Blockbook_v3 ${symbol}...`)
    
    // cache BB rest data so we can reuse across tests (across wallet load/worker load cycles) - we get 429's otherwise
    async function bb_getBlock(blockNo, page) {
        //console.log('bb_getBlock - cache_bb_blocks', cache_bb_blocks)
        if (!cache_bb_blocks[symbol]) cache_bb_blocks[symbol] = new CircularBuffer(10)
        const url = configExternal.walletExternal_config[symbol].api.block(blockNo, page)
        const cache = cache_bb_blocks[symbol]
        if (cache.size() > 0 && cache.get(cache.size() - 1).url == url) {
            //console.log('bb_getBlock - returning cached for', url)
            return new Promise((resolve) => { resolve( cache.get(cache.size() - 1).data )})
        }
        else {
            //console.log('bb_getBlock - fetching for', url)
            return axios.get(url)
            .then(blockData => {
                if (!blockData || !blockData.data) return null
                //console.log(`caching for ${url}, data=`, blockData.data)
                cache.push({ url, data: blockData.data })
                //console.log(`returning for ${url}, data=`, blockData.data)
                return blockData.data
            })
            .catch(err => {
                //utilsWallet.error(`## bb_getBlock, err=`, err, { logServerConsole: true })
                return null
            })
        }
    }

    // get node sync info
    isosocket_send_Blockbook(symbol, 'getInfo', {}, async (data) => {
        if (!configExternal.walletExternal_config[symbol].api) return
        const dispatchActions = []

        // get current block - exact time & tx count
        const receivedBlockNo = _receivedBlockNo || data.bestheight || data.bestHeight
        const curBlock = await bb_getBlock(receivedBlockNo, 1)
        //console.log('curBlock', curBlock)
        const txCount = curBlock ? (curBlock.txCount ? curBlock.txCount : 0) : undefined
        const receivedBlockTime = curBlock ? curBlock.time : undefined

        // get prev block - exact time; for block TPS
        const cacheSymbol = symbol === 'BTC_SEG' || symbol === 'BTC_SEG2' ? 'BTC' : symbol // don't send synonymous requests (http 429)
        if (!self.blocks_time[cacheSymbol]) self.blocks_time[cacheSymbol] = []
        if (!self.blocks_tps[cacheSymbol]) self.blocks_tps[cacheSymbol] = []
        if (!self.blocks_height[cacheSymbol]) self.blocks_height[cacheSymbol] = 0
        var block_time = 0
        if (txCount && receivedBlockTime) {
            if (!self.blocks_time[cacheSymbol][receivedBlockNo - 1]) {
                const prevBlock = await bb_getBlock(receivedBlockNo - 1, 1)
                if (prevBlock) {
                    self.blocks_time[cacheSymbol][receivedBlockNo - 1] = prevBlock.time
                }
            }
            if (self.blocks_time[cacheSymbol][receivedBlockNo - 1]) {
                const prevBlockTime = self.blocks_time[cacheSymbol][receivedBlockNo - 1]
                block_time = receivedBlockTime - prevBlockTime

                if (self.blocks_height[cacheSymbol] < receivedBlockNo) {
                    self.blocks_height[cacheSymbol] = receivedBlockNo
                    self.blocks_tps[cacheSymbol].push(block_time > 0 ? txCount / block_time : 0)
                }
            }
        }
        else {
            //utilsWallet.warn(`## bb_getBlock - missing txCount || receivedBlockTime - probable 429`, null, { logServerConsole: true })
        }
        
        // update synonymous symbols
        const updateSymbols = [symbol]
        if (symbol === 'BTC') {
            updateSymbols.push('BTC_SEG')
            updateSymbols.push('BTC_SEG2')
        }

        // update batch - to state
        if (receivedBlockNo && receivedBlockTime) {
            updateSymbols.forEach(p => {
                dispatchActions.push({
                       type: actionsWallet.SET_ASSET_BLOCK_INFO,
                    payload: { symbol: p, receivedBlockNo, receivedBlockTime }
                })
            })
            if (symbol === 'ETH' || symbol === 'ETH_TEST') { // eth[_test] - update erc20s
                const erc20_symbols = Object.keys(configExternal.erc20Contracts)
                erc20_symbols.forEach(erc20_symbol => {
                    const meta = configWallet.getMetaBySymbol(erc20_symbol)
                    if ((symbol === 'ETH'      && !meta.isErc20_Ropsten)
                     || (symbol === 'ETH_TEST' && meta.isErc20_Ropsten)) {
                        dispatchActions.push({
                               type: actionsWallet.SET_ASSET_BLOCK_INFO,
                            payload: {  symbol: erc20_symbol, receivedBlockNo, receivedBlockTime }
                        })
                    }
                })
            }
        }
        self.postMessage({ msg: 'REQUEST_DISPATCH_BATCH', status: 'DISPATCH', data: { dispatchActions } })

        // update lights - block tps
        if (receivedBlockNo && txCount && block_time > 0) {
            if (networkStatusChanged) {
                updateSymbols.forEach(p =>  {
                    networkStatusChanged(p, { 
                        block_no: receivedBlockNo, 
                   block_txCount: txCount,
                       block_tps: self.blocks_tps[cacheSymbol].reduce((a,b) => a + b, 0) / self.blocks_tps[cacheSymbol].length,
                     block_count: self.blocks_tps[cacheSymbol].length,
                      block_time,
                          bb_url: configWS.blockbook_ws_config[p].url })
                })
            }
        }
    })
}

// blockbook isosockets: note this is needed for a different BB API/interface compared to get_BlockbookSocketIo()
// considered VOLATILE -- no built-in reconnect
function isosocket_Setup_Blockbook(networkConnected, networkStatusChanged, loaderWorker) {
    const setupSymbols = []
    //utilsWallet.debug(`appWorker >> ${self.workerId} isosocket_Setup_Blockbook...`)

    for (var assetSymbol in configWS.blockbook_ws_config) {

        if (assetSymbol === 'ETH_TEST') { if (!configWallet.WALLET_INCLUDE_ETH_TEST) continue }
        else if (assetSymbol === 'LTC_TEST') { if (!configWallet.WALLET_INCLUDE_LTC_TEST) continue }
        else if (assetSymbol === 'ZEC_TEST') { if (!configWallet.WALLET_INCLUDE_ZEC_TEST) continue }
        else if (assetSymbol === 'BTC_TEST') { if (!configWallet.WALLET_INCLUDE_BTC_TEST) continue }
        else if (!configWallet.getSupportedMetaKeyBySymbol(assetSymbol)) continue      

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
                    // networkConnected(x, true) // init UI
                    // networkStatusChanged(x, null)
    
                    const ws_url = new URL(configWS.blockbook_ws_config[x].url)
                    utilsWallet.warn(`appWorker >> ${self.workerId} blockbookIsoSockets ${x}... hostname=${ws_url.hostname} origin=${ws_url.origin} ws_url=`, ws_url, { logServerConsole: true })
                    
                    self.blockbookIsoSockets[x] = new isoWs(configWS.blockbook_ws_config[x].url + "/websocket", configWallet.WALLET_ENV === "BROWSER" ? undefined : {
                        headers: { 
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
                    }) 
                    var socket = self.blockbookIsoSockets[x]
                    socket.symbol = x // add a property to the socket object, for logging in case it won't connect
                    self.blockbookIsoSockets_messageID[x] = 0 // init early, testing...
                    self.blockbookIsoSockets_pendingMessages[x] = {}
                    self.blockbookIsoSockets_subscriptions[x] = {}

                    // socket lifecycle
                    socket.onerror = (err) => {
                        utilsWallet.error(`appWorker >> ${self.workerId} blockbookIsoSockets ${x} - ##`, err)
                    }
                    socket.onopen = () => {
                        utilsWallet.log(`appWorker >> ${self.workerId} blockbookIsoSockets ${x} - connected ok...`)
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
                                networkConnected(x, true) // init UI
                                networkStatusChanged(x, { bb_url: configWS.blockbook_ws_config[x].url })

                                if (configWS.blockbook_ws_config[x].subBlocks === true) {
                                    //
                                    // subscribe new block from BB -- note, no new TX subscription in BB 
                                    //
                                    const method = 'subscribeNewBlock'
                                    const params = {}
                                    if (self.blockbookIsoSockets_subId_NewBlock[x]) {
                                        delete self.blockbookIsoSockets_subscriptions[x][self.blockbookIsoSockets_subId_NewBlock[x]]
                                        self.blockbookIsoSockets_subId_NewBlock[x] = ""
                                    }
                                    self.blockbookIsoSockets_subId_NewBlock[x] = isosocket_sub_Blockbook(x, method, params, function (result) {
                                        if (!configWallet.WALLET_DISABLE_BLOCK_UPDATES)  {

                                            if (result) {
                                                if (result.subscribed === true) {
                                                    //utilsWallet.debug(`appWorker >> ${self.workerId} blockbookIsoSockets ${x} - block - subscribed OK`)
                                                }
                                                else {
                                                    const receivedBlockNo = result.height
                                                    const receivedBlockTime = new Date().getTime() // TODO: getBlock & use actual

                                                    utilsWallet.logMajor('cyan','black', `appWorker >> ${self.workerId} BB BLOCK ${x} - ${receivedBlockNo}`)

                                                    // save blockheight & time on asset
                                                    getSyncInfo_Blockbook_v3(x, receivedBlockNo, receivedBlockTime, networkStatusChanged)

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
                                                            if (meta == undefined) {
                                                                utilsWallet.error(`undefined wallet meta for ${erc20_symbol}`)
                                                            }
                                                            else {
                                                                //console.log(`BB ${x} -> ${erc20_symbol} -> ${meta.isErc20_Ropsten}`)
                                                                if ((x === 'ETH'      && !meta.isErc20_Ropsten)
                                                                 || (x === 'ETH_TEST' && meta.isErc20_Ropsten)) {

                                                                    // self.postMessage({ msg: 'REQUEST_DISPATCH_BATCH', status: 'DISPATCH',
                                                                    //     data: { dispatchActions: [{ 
                                                                    //        type: actionsWallet.SET_ASSET_BLOCK_INFO,
                                                                    //     payload: { symbol: erc20_symbol, receivedBlockNo, receivedBlockTime: new Date().getTime() }} ] }
                                                                    // })

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

                            // ##
                            // very ugly - but worker-geth:socket.onclose isn't triggering reliably - this is, for some reason
                            self.geth_Sockets[x] = undefined // help worker-geth
                            if (!loaderWorker) {
                                networkConnected(x, false)
                                networkStatusChanged(x)
                            }
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
                //utilsWallet.debug(`** enrichTx - ${asset.symbol} ${tx.txid} RET-CACHE`)

                resolve(cachedTx) // return from cache
            }
            else {
                isosocket_send_Blockbook(asset.symbol, 'getTransaction', { txid: tx.txid }, (bbTx) => {
                    if (bbTx) {
                        if (bbTx.error) {
                            utilsWallet.error(`### enrichTx - ${asset.symbol} ${tx.txid} - error from BB:`, bbTx.error)
                            resolve(null)
                        }
                        else {
                            // if (tx.txid == '0x58077838e7bf98c88f61a349e64c15816e19ccad8005df9aa33b65fc4c305ae0') {
                            //     debugger
                            // }

                            const insightTx = mapTx_BlockbookToInsight(asset, bbTx)

                            // DMS - detect protect_op TX's, and save txhex for these
                            //if (bbTx.version == 2 && bbTx.vout.length == 4 
                            //    && bbTx.vout[0].value > 0 && bbTx.vout[0].isAddress == true   // protected output (dsigCltv)
                            //    && bbTx.vout[1].value == 0 && bbTx.vout[1].isAddress == false // op_return output (versioning)
                            //    && bbTx.vout[2].value == 0 && bbTx.vout[2].isAddress == true  // beneficiary zero-value output (identification)
                            //    && bbTx.vout[3].isAddress == true                             // benefactor change output (change) -- allow zero change
                            //) {
                            // DMS - actually, we need the hex for all TX's -- see wallet-btc-p2sh::createTxHex_BTC_P2SH() and how it looks up inputTx;
                            // namely, if we send funds to a PROTECT_OP-generated address with a *standard* transaction, then we will the need the hex of this std-tx
                            // for createTxHex_BTC_P2SH() to be able to create dsigCltv() redeem script (i.e. spend it)
                                insightTx.hex = bbTx.hex
                            //}
                            
                            // map tx (prunes vins, drops vouts)
                            const mappedTx = walletUtxo.map_insightTxs([insightTx], ownAddresses, asset)[0]
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
                                resolve(null)
                            })
                        }
                    }
                    else {
                        utilsWallet.warn(`enrichTx - ${asset.symbol} ${tx.txid} - no data from BB`)
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