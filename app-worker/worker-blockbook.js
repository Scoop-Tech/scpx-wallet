// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2025 Dominic Morris.

const _ = require('lodash')

const configWS = require('../config/websockets')
const configExternal = require('../config/wallet-external')
const configWallet = require('../config/wallet')

const axios = require('axios'); configExternal.blockbookHeaders.set(axios, configExternal.blockbookHeaders)

const isoWs = require('isomorphic-ws')
const workerBlockbookWs = require('./worker-blockbook-ws')
const BigNumber = require('bignumber.js')
const CircularBuffer = require("circular-buffer")

const walletUtxo = require('../actions/wallet-utxo')
const actionsWallet = require('../actions')

const utilsWallet = require('../utils')

const cache_bb_blocks = {}

//
// Per-socket in-flight cap for "heavy" Blockbook requests (one full tx / block each). Trezor's public Blockbooks drop the
// websocket (close 1006, no replies) at ~50-64 such requests in flight; 32 was the observed edge, 8 measured safe.
// The wallet fires one getTransactionSpecific per UTXO and one getTransaction per new tx, so busy addresses need the cap.
// Requests over the cap are queued (FIFO) per socket; cheap index reads (getAccountInfo, getAccountUtxo, getInfo,
// subscribe*, sendTransaction, ...) are never queued. Override: configWallet.WALLET_BB_HEAVY_MAX_INFLIGHT or
// isosocket_config_Blockbook({ heavyMaxInFlight }).
//
const BB_HEAVY_METHODS = ['getTransaction', 'getTransactionSpecific', 'getBlock']
const bb_config = {
    heavyMaxInFlight: configWallet.WALLET_BB_HEAVY_MAX_INFLIGHT > 0 ? configWallet.WALLET_BB_HEAVY_MAX_INFLIGHT : 8,
    heavyTimeoutMs: 15000, // per request, from when it is actually sent (not while queued); was 3s, too short under load
}

module.exports = {

    // BB v3
    getAddressFull_Blockbook_v3: (wallet, asset, address, utxo_mempool_spentTxIds, allDispatchActions) => {
        return getAddressFull_Blockbook_v3(wallet, asset, address, utxo_mempool_spentTxIds, allDispatchActions)
    },
    getAddressBalance_Blockbook_v3: (asset, address) => {
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
    isosocket_Setup_Blockbook: (networkConnected, networkStatusChanged, loaderWorker, walletSymbols) => {
        return isosocket_Setup_Blockbook(networkConnected, networkStatusChanged, loaderWorker, walletSymbols)
    },
    isosocket_Disconnect_Blockbook: (networkConnected, networkStatusChanged, loaderWorker, walletSymbols) => {
        return isosocket_Disconnect_Blockbook(networkConnected, networkStatusChanged, loaderWorker, walletSymbols)
    },

    isosocket_send_Blockbook: (x, method, params, callback) => {
        return isosocket_send_Blockbook(x, method, params, callback)
    },
    isosocket_sub_Blockbook: (x, method, params, callback) => {
        return isosocket_sub_Blockbook(x, method, params, callback)
    },

    // heavy-request limiter settings: { heavyMaxInFlight, heavyTimeoutMs }; returns the current settings
    isosocket_config_Blockbook: (settings) => {
        if (settings && settings.heavyMaxInFlight > 0) bb_config.heavyMaxInFlight = settings.heavyMaxInFlight
        if (settings && settings.heavyTimeoutMs > 0) bb_config.heavyTimeoutMs = settings.heavyTimeoutMs
        return Object.assign({}, bb_config)
    },

    // the address's UTXOs from one getTransactionSpecific result (see filterUtxos_TxSpecific)
    filterUtxos_TxSpecific: (address, utxo, utxoSpecificData) => {
        return filterUtxos_TxSpecific(address, utxo, utxoSpecificData)
    },

    // internals, exported for the lean tests (tests/lean/utxo-mapping.node14.js)
    _test: {
        onMessage: (x, msg) => isosocket_onMessage_Blockbook(x, msg),
        failSocket: (socket, reason) => isosocket_failAll_Blockbook(socket, reason),
        BB_HEAVY_METHODS,
    },
}

// BB v3
function getAddressFull_Blockbook_v3(wallet, asset, address, utxo_mempool_spentTxIds, allDispatchActions) {
    const symbol = asset.symbol
    //utilsWallet.log(`getAddressFull_Blockbook_v3 ${symbol}...`)

    return new Promise((resolve, reject) => {
        // don't attempt the fetch on a socket that isn't open: fail with a transient error that callers retry,
        // rather than recording a fetch error (which marks the asset as loaded, with no data)
        if (!isosocket_isOpen_Blockbook(symbol)) {
            reject(new Error('BB_SOCKET_NOT_OPEN'))
            return
        }
        isosocket_send_Blockbook(symbol, 'getAccountInfo', {
            descriptor: address,
            details: 'txids', // { basic | balance | txids | txs }
            page: undefined,
            pageSize: configWallet.WALLET_MAX_TX_HISTORY || 888,
            from: undefined,
            to: undefined,
            contractFilter: undefined
        }, (balanceAndTxData) => {

            if (!balanceAndTxData) { 
                utilsWallet.error(`## getAddressFull_Blockbook_v3 ${symbol} ${address} - no balanceAndTxData!`); 
                reject(new Error('No balanceAndTxData from Blockbook')); 
                return 
            }
            if (balanceAndTxData.error) {
                utilsWallet.error(`## getAddressFull_Blockbook_v3 ${symbol} ${address} - BB error:`, balanceAndTxData.error);
                reject(new Error(`Blockbook error: ${balanceAndTxData.error}`));
                return
            }

            // axiosRetry(axios, CONST.AXIOS_RETRY_EXTERNAL)
            // axios.get(configExternal.walletExternal_config[symbol].api.utxo(address))
            // .then(async (utxoData) => {
            isosocket_send_Blockbook(symbol, 'getAccountUtxo', { descriptor: address }, (utxosData) => { (async () => { // async body: a throw rejects (never hangs the caller)

                // if (address === '2NFsNU7FJusZeNiCAHwHJvjw1UBLT1hw6iv') {
                //     debugger
                // }

                if (!utxosData) { 
                    utilsWallet.error(`## getAddressFull_Blockbook_v3 ${symbol} ${address} - no utxosData`); 
                    reject(new Error('No utxosData from Blockbook')); 
                    return 
                }
                if (utxosData.error) {
                    utilsWallet.error(`## getAddressFull_Blockbook_v3 ${symbol} ${address} - errored utxosData`, utxosData.error); 
                    reject(new Error(`Blockbook UTXO error: ${JSON.stringify(utxosData.error)}`));
                    return
                }
                if (!Array.isArray(utxosData)) {
                    utilsWallet.error(`## getAddressFull_Blockbook_v3 ${symbol} ${address} - invalid utxosData type`); 
                    reject(new Error('Invalid utxosData type from Blockbook'));
                    return
                }
                // one getTransactionSpecific per distinct txid (an address can hold several outputs of one tx);
                // these are "heavy" requests: isosocket_send_Blockbook caps how many are in flight per socket
                const utxoTxids = _.uniq(utxosData.map(utxo => utxo.txid))
                const getUtxoSpecificOps = utxoTxids.map(txid => {
                    return new Promise((resolveSpecificUtxoOp) => {
                        isosocket_send_Blockbook(symbol, 'getTransactionSpecific', { txid }, (utxoSpecificData) => {
                            try {
                                if (!utxoSpecificData) { utilsWallet.error(`## getAddressFull_Blockbook_v3 ${symbol} ${txid} - no utxoSpecificData!`); resolveSpecificUtxoOp([]); return }
                                if (utxoSpecificData.error) {
                                    // 10:07:15.116 [SW-ERR] ## getAddressFull_Blockbook_v3 BTC_TEST dce42dd5cc1d0810f6a5fba36e3965ee16dcb0b2b936c7feb18a9ffc1dd73b08 - error on getTransactionSpecific: "txid dce42dd5cc1d0810f6a5fba36e3965ee16dcb0b2b936c7feb18a9ffc1dd73b08: 500 Internal Server Error invalid character 'W' looking for beginning of value"
                                    // # seems inconsistent on btc_test; care if it repro's on mainnet -- NEW RATE LIMIT ON BLOCKBOCK NODES?
                                    utilsWallet.error(`## getAddressFull_Blockbook_v3 ${symbol} ${txid} - error on getTransactionSpecific: ${JSON.stringify(utxoSpecificData.error.message || utxoSpecificData.error)}`);
                                    resolveSpecificUtxoOp([]);
                                    return
                                }
                                if (!utxoSpecificData.vout) { utilsWallet.error(`## getAddressFull_Blockbook_v3 ${symbol} ${txid} - no utxoSpecificData.vout!`); resolveSpecificUtxoOp([]); return }

                                // all of this address's UTXOs in this tx
                                resolveSpecificUtxoOp(_.flatten(utxosData.filter(utxo => utxo.txid === txid)
                                    .map(utxo => filterUtxos_TxSpecific(address, utxo, utxoSpecificData))))
                            }
                            catch (err) {
                                utilsWallet.error(`## getAddressFull_Blockbook_v3 ${symbol} ${txid} - error mapping getTransactionSpecific, err=`, err)
                                resolveSpecificUtxoOp([])
                            }
                        })
                    })
                })
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
                const addrTxs = _.union(_.uniq(utxosData.map(p => p.txid)), balanceAndTxData.txids || [])
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
                const ret = Object.assign({}, res, { txs: newMinimalTxs })
                resolve(ret)
            })().catch((err) => {
                utilsWallet.error(`## getAddressFull_Blockbook_v3 ${symbol} ${address} - err=`, err)
                reject(err instanceof Error ? err : new Error(String(err)))
            }) })
        })
    })
}

//
// The UTXO(s) of `address` for one getAccountUtxo entry `utxo` ({ txid, vout, value }), from that tx's
// getTransactionSpecific (raw node format). Matched on output index AND address, for any spendable script type:
//   - scriptPubKey.addresses[] (older bitcoind / zcashd / Zebra: P2PKH, P2SH, ...)
//   - scriptPubKey.address (singular; Bitcoin Core >= 22, e.g. Core 29 on btc1/2/3.trezor.io: pubkeyhash (legacy P2PKH),
//     scripthash, witness_v0_keyhash, witness_v0_scripthash, witness_v1_taproot)
// OP_RETURN (nulldata) outputs are never UTXOs: they used to be added here (0-sat, for every utxo of the tx). Nothing reads
// them from the UTXO list (PROTECT_OP reads its OP_RETURN data from the tx's outputs, utxo_vout); spend paths filtered them out.
// Plain ES2015 (also bundled into scpx-app).
//
function filterUtxos_TxSpecific(address, utxo, utxoSpecificData) {
    const ret = []
    if (!utxo || !utxoSpecificData || !Array.isArray(utxoSpecificData.vout)) return ret
    for (var j = 0; j < utxoSpecificData.vout.length; j++) {
        const utxoSpecific = utxoSpecificData.vout[j]
        const spk = utxoSpecific && utxoSpecific.scriptPubKey
        if (!spk) continue
        if (utxo.vout != utxoSpecific.n) continue
        if (spk.type === 'nulldata') continue
        const isOurs = (Array.isArray(spk.addresses) && spk.addresses.indexOf(address) !== -1)
                    || (spk.address !== undefined && spk.address == address)
        if (!isOurs) continue
        ret.push({
            satoshis: Number(new BigNumber(utxoSpecific.value).times(1e8).toString()), // node format: value in whole coins
            txid: utxo.txid,
            vout: utxoSpecific.n,
            scriptPubKey: {
                addresses: spk.addresses !== undefined ? spk.addresses : [spk.address], // consumers read addresses[]
                hex: spk.hex,
                type: spk.type,
            }
        })
    }
    return ret
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

    // coinbase inputs have no addresses (and no value): they used to throw here, which hung enrichTx for any address
    // with a coinbase (mining payout) in its history. Shielded (ZEC z->t / t->z) txs have vin [] / vout [].
    insightTx.vin = (bbTx.vin || []).map(p => {
        return {
            txid: p.txid,
            vout: p.vout,
            sequence: p.sequence,
            n: p.n,
            addr: p.addresses && p.addresses.length > 0 ? p.addresses[0] : undefined,
            valueSat: Number(p.value || 0),
            value: Number(utilsWallet.toDisplayUnit(new BigNumber(p.value || 0), asset)),
            coinbase: p.coinbase !== undefined ? true : undefined,
            //doubleSpentTxID: null,
            //scriptSig: ...
        }
    })
    insightTx.vout = (bbTx.vout || []).map(p => {
        return {
            value: utilsWallet.toDisplayUnit(new BigNumber(p.value), asset),
            n: p.n,
            scriptPubKey: {
                hex: p.hex, addresses: p.addresses,
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
                if (data.error) {
                    reject(new Error(`Blockbook balance error: ${JSON.stringify(data.error)}`))
                }
                else {
                    resolve({
                        symbol,
                        balance: new BigNumber(data.balance),
                        unconfirmedBalance: new BigNumber(data.unconfirmedBalance),
                        address,
                    })
                }
            }
            else {
                reject(new Error('No data from Blockbook for balance'))
            }
        })
    })
}

// called for initial block-sync state - and new blocks
function getSyncInfo_Blockbook_v3(symbol, _receivedBlockNo = undefined, _receivedBlockTime = undefined, networkStatusChanged = undefined) {
    utilsWallet.log(`getSyncInfo_Blockbook_v3 ${symbol}...`)

    // cache BB rest data so we can reuse across tests (across wallet load/worker load cycles) - we get 429's otherwise
    // block header fields (time, txCount) via the Blockbook websocket getBlock (pageSize 1). Was the REST /api/v2/block:
    // Trezor's public Blockbooks send no CORS headers, so in the browser REST failed and Trezor-backed assets (BTC_SEG,
    // BTC_SEG2) never got block info. Cached (last 10) so repeated sync-info calls don't re-fetch (429s).
    async function bb_getBlock(blockNo, page) {
        if (!cache_bb_blocks[symbol]) cache_bb_blocks[symbol] = new CircularBuffer(10)
        const key = `${blockNo}:${page}`
        const cache = cache_bb_blocks[symbol]
        for (var i = 0; i < cache.size(); i++) { if (cache.get(i).key === key) return cache.get(i).data }
        // some Blockbooks don't serve websocket getBlock at all (ZEC on Zebra: "Not supported"): remember that, don't re-ask
        if (!self.bb_getBlockUnsupported) self.bb_getBlockUnsupported = {}
        if (self.bb_getBlockUnsupported[symbol]) return null
        return new Promise((resolve) => {
            isosocket_send_Blockbook(symbol, 'getBlock', { id: String(blockNo), page: page || 1, pageSize: 1 }, (data) => {
                if (data && data.error && data.error.message && /not supported/i.test(data.error.message)) {
                    utilsWallet.warn(`getSyncInfo_Blockbook_v3 ${symbol} - websocket getBlock not supported by this Blockbook; block time falls back to the local clock`)
                    self.bb_getBlockUnsupported[symbol] = true
                }
                if (!data || data.error || !data.time) return resolve(null)
                const block = { time: data.time, txCount: data.txCount, height: data.height, hash: data.hash }
                cache.push({ key, data: block })
                resolve(block)
            })
        })
    }

    // get node sync info
    isosocket_send_Blockbook(symbol, 'getInfo', {}, (data) => { (async () => { // async body: errors are logged, never unhandled
        utilsWallet.log(`getInfo ${symbol}, data=`, data)

        if (!configExternal.walletExternal_config[symbol] || !configExternal.walletExternal_config[symbol].api) return
        if (!data || data.error) {
            utilsWallet.warn(`getSyncInfo_Blockbook_v3 ${symbol} - getInfo failed: ${JSON.stringify(data && data.error)}`)
            if (!_receivedBlockNo) return
            data = {}
        }
        const dispatchActions = []

        // get current block - exact time & tx count
        const receivedBlockNo = _receivedBlockNo || data.bestheight || data.bestHeight
        const curBlock = receivedBlockNo ? await bb_getBlock(receivedBlockNo, 1) : null
        //utilsWallet.log(`getInfo ${symbol}, curBlock=`, curBlock)
        const txCount = curBlock ? (curBlock.txCount ? curBlock.txCount : 0) : undefined

        // block time (unix seconds, as Blockbook's getBlock). Fallback when getBlock is unavailable (ZEC: "Not supported";
        // or a transient error): the time the block was announced (subscribeNewBlock passes ms), else now - so that
        // SET_ASSET_BLOCK_INFO (block height) is still dispatched. blockTimeIsEstimate marks the fallback.
        const blockTimeIsEstimate = !(curBlock && curBlock.time)
        const receivedBlockTime = !blockTimeIsEstimate ? curBlock.time
            : Math.floor((_receivedBlockTime ? (_receivedBlockTime > 1e12 ? _receivedBlockTime / 1000 : _receivedBlockTime) : Date.now() / 1000))

        // get prev block - exact time; for block TPS
        const cacheSymbol = symbol === 'BTC_SEG2' ? 'BTC_SEG' : symbol === 'BTC_TEST2' ? 'BTC_TEST' : symbol // don't send synonymous requests (http 429)
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
        if (symbol === 'BTC_SEG') {
            updateSymbols.push('BTC_SEG2')
        }
        if (symbol === 'BTC_TEST') {
            updateSymbols.push('BTC_TEST2')
        }

        // BIP113 median-time-past, for PROTECT_OP (CLTV) assets: a time-locked output is spendable once lockTime < MTP.
        // MTP can run well ahead of (testnet4) or ~1h behind (mainnet) wall-clock time, so the UI needs it for unlock
        // estimates and claim gating. Fetched once per new block (cached by height); never blocks the block-info update.
        var medianTimePast
        const assetMeta = configWallet.getMetaBySymbol(symbol)
        if (assetMeta && assetMeta.OP_CLTV && receivedBlockNo) {
            if (!self.bb_mtpCache) self.bb_mtpCache = {}
            const cached = self.bb_mtpCache[cacheSymbol]
            if (cached && cached.height === receivedBlockNo) medianTimePast = cached.mtp
            else {
                medianTimePast = await Promise.race([
                    workerBlockbookWs.getMedianTimePast((m, p, cb) => isosocket_send_Blockbook(symbol, m, p, cb))
                        .then(r => { self.bb_mtpCache[cacheSymbol] = { height: receivedBlockNo, mtp: r.mtp }; return r.mtp }),
                    new Promise(r => setTimeout(() => r(undefined), 10000)),
                ]).catch(err => { utilsWallet.warn(`getSyncInfo ${symbol} - median-time-past unavailable: ${err.message}`); return cached ? cached.mtp : undefined })
            }
        }

        // update batch - to state
        if (receivedBlockNo && receivedBlockTime) {
            updateSymbols.forEach(p => {
                dispatchActions.push({
                    type: actionsWallet.SET_ASSET_BLOCK_INFO,
                    payload: Object.assign({ symbol: p, receivedBlockNo, receivedBlockTime, blockTimeIsEstimate }, medianTimePast !== undefined ? { medianTimePast } : {})
                })
            })
            if (symbol === 'ETH' || symbol === 'ETH_TEST') { // eth[_test] - update erc20s
                const erc20_symbols = Object.keys(configExternal.erc20Contracts)
                erc20_symbols.forEach(erc20_symbol => {
                    const meta = configWallet.getMetaBySymbol(erc20_symbol)
                    if ((symbol === 'ETH' && !meta.isErc20_Ropsten)
                        || (symbol === 'ETH_TEST' && meta.isErc20_Ropsten)) {
                        dispatchActions.push({
                            type: actionsWallet.SET_ASSET_BLOCK_INFO,
                            payload: { symbol: erc20_symbol, receivedBlockNo, receivedBlockTime }
                        })
                    }
                })
            }
        }
        self.postMessage({ msg: 'REQUEST_DISPATCH_BATCH', status: 'DISPATCH', data: { dispatchActions } })

        // update lights - block tps
        if (receivedBlockNo && txCount && block_time > 0) {
            if (networkStatusChanged) {
                updateSymbols.forEach(p => {
                    networkStatusChanged(p, {
                        block_no: receivedBlockNo,
                        block_txCount: txCount,
                        block_tps: self.blocks_tps[cacheSymbol].reduce((a, b) => a + b, 0) / self.blocks_tps[cacheSymbol].length,
                        block_count: self.blocks_tps[cacheSymbol].length,
                        block_time,
                        bb_url: configWS.blockbook_ws_config[p].url
                    })
                })
            }
        }
    })().catch((err) => { utilsWallet.error(`## getSyncInfo_Blockbook_v3 ${symbol} - err=`, err) }) })
}

function isosocket_Disconnect_Blockbook(networkConnected, networkStatusChanged, loaderWorker, walletSymbols) {
    var disconnectCount = 0
    for (var x in configWS.blockbook_ws_config) {
        if (self.bb_Sockets[x] !== undefined) {

            if (self.bb_Sockets[x].readyState == 0 || self.bb_Sockets[x].readyState == 1) { // connecting || open
                self.bb_Sockets[x].close()
                self.bb_Sockets[x] = undefined
                disconnectCount++
            }

            if (!loaderWorker) {
                networkConnected(x, false)
                networkStatusChanged(x, {})
            }
        }
    }
    return disconnectCount
}

// blockbook isosockets: note this is needed for a different BB API/interface compared to get_BlockbookSocketIo()
// considered VOLATILE -- no built-in reconnect
function isosocket_Setup_Blockbook(networkConnected, networkStatusChanged, loaderWorker, walletSymbols) {
    const setupSymbols = []
    //utilsWallet.debug(`appWorker >> ${self.workerId} isosocket_Setup_Blockbook...`)

    for (var assetSymbol in configWS.blockbook_ws_config) {

        // exclude if not in the loaded wallet
        if (walletSymbols && walletSymbols.length > 0) {
            if (!walletSymbols.includes(assetSymbol)) {
                utilsWallet.warn(`appWorker >> ${self.workerId} isosocket_Setup_Blockbook (skipping ${assetSymbol} - not in wallet) walletSymbols=`, walletSymbols, { logServerConsole: true })
                continue
            } else {
                utilsWallet.log(`appWorker >> ${self.workerId} isosocket_Setup_Blockbook - proceeding with ${assetSymbol} - in wallet; walletSymbols=`, walletSymbols, { logServerConsole: true })
            }
        }

        // static exclusions
        if (assetSymbol === 'ETH_TEST') { if (!configWallet.WALLET_INCLUDE_ETH_TEST) continue }
        else if (assetSymbol === 'LTC_TEST') { if (!configWallet.WALLET_INCLUDE_LTC_TEST) continue }
        else if (assetSymbol === 'ZEC_TEST') { if (!configWallet.WALLET_INCLUDE_ZEC_TEST) continue }
        else if (assetSymbol === 'BTC_TEST') { if (!configWallet.WALLET_INCLUDE_BTC_TEST) continue }
        else if (assetSymbol === 'BTC_TEST2') { if (!configWallet.WALLET_INCLUDE_BTC_TEST) continue }
        else if (!configWallet.getSupportedMetaKeyBySymbol(assetSymbol)) {
            utilsWallet.warn(`appWorker >> ${self.workerId} isosocket_Setup_Blockbook (skipping ${assetSymbol} - getSupportedMetaKeyBySymbol lookup failed)`, null, { logServerConsole: true })
            continue
        }

        setupSymbols.push(
            (function (x) {
                // if we're called more than once, then the socket object already exists
                if (self.bb_Sockets[x] !== undefined) { // safari refocus handling
                    if (self.bb_Sockets[x].readyState == 2 || self.bb_Sockets[x].readyState == 3) { // if "closing" or "closed" respectively (connecting=0, open=1)
                        utilsWallet.warn(`appWorker >> ${self.workerId} isosocket_Setup_Blockbook ${x} - found disconnected socket for ${x} - nuking it!`)
                        self.bb_Sockets[x].close()
                        self.bb_Sockets[x] = undefined
                    }
                }

                // initial / main path
                if (self.bb_Sockets[x] === undefined) { // connect & init
                    // networkConnected(x, true) // init UI
                    // networkStatusChanged(x, null)

                    const ws_url = new URL(configWS.blockbook_ws_config[x].url)
                    utilsWallet.warn(`appWorker >> ${self.workerId} bb_Sockets CONNECTING!!! ${x}... hostname=${ws_url.hostname} origin=${ws_url.origin} ws_url=`, ws_url, { logServerConsole: true })

                    self.bb_Sockets[x] = new isoWs(configWS.blockbook_ws_config[x].url + "/websocket", configWallet.WALLET_ENV === "BROWSER" ? undefined : {
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
                    var socket = self.bb_Sockets[x]
                    socket.symbol = x // add a property to the socket object, for logging in case it won't connect
                    self.bb_Sockets_messageID[x] = 0 // init early, testing...
                    self.bb_Sockets_pendingMessages[x] = {}
                    socket.bb_pending = self.bb_Sockets_pendingMessages[x] // this socket's requests (ids restart at 0 per socket)
                    self.bb_Sockets_subscriptions[x] = {}
                    if (self.bb_Sockets_timedOut) self.bb_Sockets_timedOut[x] = {}

                    // socket lifecycle
                    socket.onerror = (err) => {
                        utilsWallet.error(`appWorker >> ${self.workerId} bb_Sockets ${x} - ## onerror: type=${err.type}, msg=${err.message}, err=`, err.error)
                    }
                    socket.onopen = () => {
                        utilsWallet.log(`appWorker >> ${self.workerId} bb_Sockets ${x} - connected ok...`)
                        try {

                            // setup (exactly once) a keep-alive timer; needed for direct Trezor WS connections to stop server idle drops
                            if (self.bb_Sockets_keepAliveIntervalID[x] === undefined) {
                                self.bb_Sockets_keepAliveIntervalID[x] =
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

                                // Blockbook subscriptions don't survive a reconnect: re-establish any address subscription
                                // (worker-addr-monitor registers it in self.bb_addrSubs[x])
                                if (self.bb_addrSubs && self.bb_addrSubs[x]) {
                                    const addrSub = self.bb_addrSubs[x]
                                    addrSub.subId = workerBlockbookWs.subscribeAddresses(
                                        (method, params, cb) => isosocket_sub_Blockbook(x, method, params, cb), addrSub.addresses, addrSub.onTxid, addrSub.onAck)
                                    utilsWallet.log(`appWorker >> ${self.workerId} bb_Sockets ${x} - (re)subscribed ${addrSub.addresses.length} address(es)`)
                                }

                                if (configWS.blockbook_ws_config[x].subBlocks === true) {
                                    //
                                    // subscribe new block from BB -- note, no new TX subscription in BB 
                                    //
                                    const method = 'subscribeNewBlock'
                                    const params = {}
                                    if (self.bb_Sockets_subId_NewBlock[x]) {
                                        delete self.bb_Sockets_subscriptions[x][self.bb_Sockets_subId_NewBlock[x]]
                                        self.bb_Sockets_subId_NewBlock[x] = ""
                                    }
                                    self.bb_Sockets_subId_NewBlock[x] = isosocket_sub_Blockbook(x, method, params, function (result) {
                                        if (!configWallet.WALLET_DISABLE_BLOCK_UPDATES) {

                                            if (result) {
                                                if (result.subscribed === true) {
                                                    //utilsWallet.debug(`appWorker >> ${self.workerId} bb_Sockets ${x} - block - subscribed OK`)
                                                }
                                                else {
                                                    const receivedBlockNo = result.height
                                                    const receivedBlockTime = new Date().getTime() // TODO: getBlock & use actual

                                                    utilsWallet.logMajor('cyan', 'black', `appWorker >> ${self.workerId} BB BLOCK ${x} - ${receivedBlockNo}`)

                                                    // save blockheight & time on asset
                                                    getSyncInfo_Blockbook_v3(x, receivedBlockNo, receivedBlockTime, networkStatusChanged)

                                                    // requery balance check for asset on new block - updates confirmed counts
                                                    self.postMessage({
                                                        msg: 'REQUEST_STATE', status: 'REQ',
                                                        data: { stateItem: 'ASSET', stateKey: x, context: 'ASSET_REFRESH_NEW_BLOCK' }
                                                    })

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
                                                                if ((x === 'ETH' && !meta.isErc20_Ropsten)
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
                        catch (err) { utilsWallet.error(`### appWorker >> ${self.workerId} bb_Sockets ${x} - connect, err=`, err) }
                    }
                    socket.onclose = (evt) => {
                        // fail this socket's queued + in-flight requests now (they would otherwise each wait for a timeout)
                        const failed = isosocket_failAll_Blockbook(socket, 'Blockbook socket closed')
                        utilsWallet.warn(`appWorker >> ${self.workerId} bb_Sockets ${x} - closed (code=${evt && evt.code}), failed ${failed} pending request(s)`)
                        if (self.bb_Sockets[x] !== undefined && self.bb_Sockets[x] !== socket) return // late close of a replaced socket: leave the new one alone
                        self.bb_Sockets[x] = undefined // nuke this so volatileSockets_ReInit() triggers another setup
                        try {
                            // reconnect - this supplements volatileSockets_ReInit() for faster reconnection
                            // UPDATE: allow explicit disconnects
                            //isosocket_Setup_Blockbook(networkConnected, networkStatusChanged)

                            // ##
                            // very ugly - but worker-geth:socket.onclose isn't triggering reliably - this is, for some reason
                            self.geth_Sockets[x] = undefined // help worker-geth
                            if (!loaderWorker) {
                                networkConnected(x, false)
                                networkStatusChanged(x)
                            }
                        }
                        catch (err) { utilsWallet.error(`### appWorker >> ${self.workerId} bb_Sockets ${x} - onclose callback, err=`, err) }
                    }

                    //
                    // manual message id <-> callback handling (never throws: see isosocket_onMessage_Blockbook)
                    //
                    socket.onmessage = (msg) => {
                        isosocket_onMessage_Blockbook(x, msg, socket)
                    }

                    return x
                }
            })(assetSymbol)
        )
    }
    return setupSymbols.filter(p => p !== undefined)
}

function isosocket_isOpen_Blockbook(x) {
    return self.bb_Sockets[x] !== undefined && self.bb_Sockets[x].readyState == 1
}

function isosocket_send_Blockbook(x, method, params, callback) {
    const socket = self.bb_Sockets[x]
    if (socket === undefined) {
        utilsWallet.warn(`appWorker >> ### ${self.workerId} isosocket_send_Blockbook ${x} - ignoring: NO SOCKET SETUP`)
        if (callback) {
            callback({ error: 'Blockbook socket not initialized' })
        }
        return
    }
    if (socket.readyState != 1) {
        utilsWallet.warn(`appWorker >> ### ${self.workerId} isosocket_send_Blockbook ${x} - ignoring: invalid socket readyState=`, socket.readyState)
        if (callback) {
            callback({ error: `Blockbook socket not ready (readyState=${socket.readyState})` })
        }
        return
    }

    // heavy requests (full tx / block): at most bb_config.heavyMaxInFlight in flight per socket, the rest queue (FIFO)
    if (BB_HEAVY_METHODS.indexOf(method) !== -1) {
        const heavy = isosocket_heavyState_Blockbook(socket)
        if (heavy.inFlight >= bb_config.heavyMaxInFlight) {
            heavy.queue.push({ method, params, callback })
            if (heavy.queue.length > heavy.maxQueued) heavy.maxQueued = heavy.queue.length
            return undefined // gets its id when a slot frees up
        }
        return isosocket_sendHeavy_Blockbook(x, socket, method, params, callback)
    }
    return isosocket_sendNow_Blockbook(x, socket, method, params, callback)
}

// per-socket limiter state (on the socket object, so a reconnect starts clean)
function isosocket_heavyState_Blockbook(socket) {
    if (!socket.bb_heavy) socket.bb_heavy = { inFlight: 0, queue: [], maxInFlight: 0, maxQueued: 0 }
    return socket.bb_heavy
}

function isosocket_sendHeavy_Blockbook(x, socket, method, params, callback) {
    const heavy = isosocket_heavyState_Blockbook(socket)
    heavy.inFlight++
    if (heavy.inFlight > heavy.maxInFlight) heavy.maxInFlight = heavy.inFlight
    var released = false
    return isosocket_sendNow_Blockbook(x, socket, method, params, (data) => {
        if (!released) { // reply, timeout, send failure or socket close: free the slot first (even if the callback throws)
            released = true
            heavy.inFlight--
            isosocket_drainHeavy_Blockbook(x, socket)
        }
        if (callback) callback(data)
    })
}

function isosocket_drainHeavy_Blockbook(x, socket) {
    const heavy = isosocket_heavyState_Blockbook(socket)
    while (heavy.queue.length > 0 && heavy.inFlight < bb_config.heavyMaxInFlight) {
        const q = heavy.queue.shift()
        if (self.bb_Sockets[x] !== socket || socket.readyState != 1) {
            bb_safeCallback(q.callback, { error: 'Blockbook socket closed' })
            continue
        }
        isosocket_sendHeavy_Blockbook(x, socket, q.method, q.params, q.callback)
    }
}

function isosocket_sendNow_Blockbook(x, socket, method, params, callback) {
    var id = self.bb_Sockets_messageID[x].toString()
    self.bb_Sockets_messageID[x]++

    // this socket's own pending map: a reconnect installs a new map and restarts ids at 0, so a stale timeout
    // must never touch (or call back for) the new socket's request with the same id
    if (!socket.bb_pending) socket.bb_pending = self.bb_Sockets_pendingMessages[x]
    const pending = socket.bb_pending

    // Set up timeout for this request: 3s by default; longer for broadcasts (a premature timeout after a successful
    // broadcast would report failure for a tx that was actually sent), for paged account history, and for heavy
    // requests (full tx / block: these can queue server-side behind each other)
    const timeoutMs = method === 'sendTransaction' ? 30000
                    : method === 'getAccountInfo' ? 10000
                    : BB_HEAVY_METHODS.indexOf(method) !== -1 ? bb_config.heavyTimeoutMs
                    : 3000
    var timeoutId
    const wrapped = (data) => { // clears the timeout on reply
        clearTimeout(timeoutId)
        if (callback) {
            callback(data)
        }
    }
    timeoutId = setTimeout(() => {
        if (pending[id] === wrapped) {
            delete pending[id]
            if (!self.bb_Sockets_timedOut) self.bb_Sockets_timedOut = {}
            if (!self.bb_Sockets_timedOut[x]) self.bb_Sockets_timedOut[x] = {}
            self.bb_Sockets_timedOut[x][id] = method // so a late reply is reported as such, not as an unknown message
            utilsWallet.error(`## isosocket_send_Blockbook ${x} ${method} - timeout after ${timeoutMs}ms`)
            if (callback) {
                callback({ error: 'Blockbook request timeout' })
            }
        }
    }, timeoutMs)
    pending[id] = wrapped

    var req = { id, method, params }
    try {
        socket.send(JSON.stringify(req))
    }
    catch (err) {
        utilsWallet.error(`## isosocket_send_Blockbook ${x} ${method} - send failed: ${err.message}`)
        if (pending[id] === wrapped) {
            delete pending[id]
            wrapped({ error: `Blockbook send failed: ${err.message}` })
        }
    }
    return id
}

// a callback that throws must not break the caller's loop (queue drain, socket-close flush)
function bb_safeCallback(callback, data) {
    if (!callback) return
    try { callback(data) }
    catch (err) { utilsWallet.error(`## bb_safeCallback - callback threw, err=`, err) }
}

// fail every queued and in-flight request of a socket (it closed): callers get an error now instead of a timeout later
function isosocket_failAll_Blockbook(socket, reason) {
    if (!socket) return 0
    const err = { error: reason || 'Blockbook socket closed' }
    var n = 0
    if (socket.bb_heavy) {
        const queued = socket.bb_heavy.queue
        socket.bb_heavy.queue = []
        queued.forEach(q => { n++; bb_safeCallback(q.callback, err) })
    }
    const pending = socket.bb_pending
    if (pending) {
        Object.keys(pending).forEach(id => {
            const cb = pending[id]
            delete pending[id]
            n++
            bb_safeCallback(cb, err)
        })
    }
    return n
}

// manual message id <-> callback dispatch. Never throws: a bad frame or a throwing callback is logged and skipped,
// so it can't stop the processing of later replies (which would hang every pending request on this socket)
function isosocket_onMessage_Blockbook(x, msg, socket) {
    if (!msg || !msg.data) return
    var resp
    try {
        resp = JSON.parse(msg.data)
    }
    catch (err) {
        utilsWallet.error(`### appWorker >> ${self.workerId} bb_Sockets ${x} - unparseable message (${String(msg.data).length} chars): ${err.message}`)
        return
    }
    if (!resp || typeof resp !== 'object') return
    const pending = (socket && socket.bb_pending) || self.bb_Sockets_pendingMessages[x] || {}
    const subs = self.bb_Sockets_subscriptions[x] || {}
    try {
        if (typeof process !== 'undefined' && process.env && process.env.BB_WS_DEBUG === x) utilsWallet.log(`BB_WS_DEBUG ${x} rx id=${resp.id} keys=${Object.keys(resp.data || {}).join(',')} pending=${!!pending[resp.id]} sub=${!!subs[resp.id]}`)
        var callback = pending[resp.id]
        if (callback != undefined) {
            delete pending[resp.id]
            callback(resp.data)
        } else {
            callback = subs[resp.id]
            if (callback != undefined) {
                callback(resp.data)
            }
            else if (self.bb_Sockets_timedOut && self.bb_Sockets_timedOut[x] && self.bb_Sockets_timedOut[x][resp.id] !== undefined) {
                utilsWallet.warn(`appWorker >> ${self.workerId} bb_Sockets ${x} - late reply (after timeout) for ${self.bb_Sockets_timedOut[x][resp.id]} id=${resp.id}`)
                delete self.bb_Sockets_timedOut[x][resp.id]
            }
            else {
                utilsWallet.error(`### appWorker >> ${self.workerId} bb_Sockets ${x} - UNKNOWN MESSAGE: no callback, id=${resp.id} keys=${Object.keys(resp.data || {}).join(',')}`)
            }
        }
    }
    catch (err) {
        utilsWallet.error(`### appWorker >> ${self.workerId} bb_Sockets ${x} - message callback threw (id=${resp.id}), err=`, err)
    }
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
                                // if (tx.txid == '5443b88413f52a760d1fd29c8da9ddb3a2f3ce9e7bd99d618f3b9c239cab978a' || 
                                //     tx.txid == '1edc7195bb257e7dd2065dc822c14bc30efcb8144ef2367d4707a76c3439253c' || 
                                //     tx.txid == '362315858525c8e71a3d7e6744edf967bae5cad668f8b90946d249c997ddee5c') {
                                //     console.log(`bbTx p_op ${tx.txid}`, bbTx)
                                // }

                                // a mapping error must not leave this promise unresolved (it hung the whole address fetch)
                                var insightTx, mappedTx
                                try {
                                    insightTx = mapTx_BlockbookToInsight(asset, bbTx)

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
                                    mappedTx = walletUtxo.map_insightTxs([insightTx], ownAddresses, asset)[0]
                                    //utilsWallet.log(`** enrichTx - ${asset.symbol} ${tx.txid} - adding to cache, mappedTx=`, mappedTx)
                                }
                                catch (err) {
                                    utilsWallet.error(`### enrichTx - ${asset.symbol} ${tx.txid} - error mapping BB tx, err=`, err)
                                    resolve(null)
                                    return
                                }

                                // add to cache
                                mappedTx.addedToCacheAt = new Date()
                                utilsWallet.txdb_setItem(cacheKey, mappedTx)
                                    .then(() => {
                                        utilsWallet.log(`** enrichTx (worker-blockbook) - ${asset.symbol} ${tx.txid} - added to cache ok`)
                                        mappedTx.fromCache = false
                                        resolve(mappedTx)
                                    })
                                    .catch((err) => {
                                        utilsWallet.reportErr(err)
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
                utilsWallet.reportErr(err)
                utilsWallet.error('## enrichTx - error=', err)
                resolve(null)
            })
    })
}

function isosocket_sub_Blockbook(x, method, params, callback) {
    if (self.bb_Sockets[x] === undefined) {
        utilsWallet.warn(`appWorker >> ${self.workerId} isosocket_sub_Blockbook ${x} - ignoring: NO SOCKET SETUP`)
        return
    }
    if (self.bb_Sockets[x].readyState != 1) {
        utilsWallet.warn(`appWorker >> ### ${self.workerId} isosocket_sub_Blockbook ${x} - ignoring: invalid socket readyState=`, self.bb_Sockets[x].readyState)
        return
    }

    var id = self.bb_Sockets_messageID[x].toString()
    self.bb_Sockets_messageID[x]++
    self.bb_Sockets_subscriptions[x][id] = callback
    var req = { id, method, params }
    self.bb_Sockets[x].send(JSON.stringify(req))
    return id
}

function isosocket_unsub_Blockbook(method, id, params, callback) {
    if (self.bb_Sockets[x] === undefined) {
        utilsWallet.warn(`appWorker >> ${self.workerId} isosocket_unsub_Blockbook ${x} - ignoring: NO SOCKET SETUP`)
        return
    }
    if (self.bb_Sockets[x].readyState != 1) {
        utilsWallet.warn(`appWorker >> ### ${self.workerId} isosocket_unsub_Blockbook ${x} - ignoring: invalid socket readyState=`, self.bb_Sockets[x].readyState)
        return
    }

    delete self.bb_Sockets_subscriptions[x][id]
    self.bb_Sockets_pendingMessages[x][id] = callback
    var req = { id, method, params }
    self.bb_Sockets[x].send(JSON.stringify(req))
    return id
}