// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2023 Dominic Morris.

const BigNumber = require('bignumber.js')
//const axios = require('axios')
const _ = require('lodash')
const CircularBuffer = require("circular-buffer")

const configExternal = require('../config/wallet-external')
const configWallet = require('../config/wallet')
const erc20ABI = require('../config/erc20ABI')
const configWS = require('../config/websockets')

//const abiDecoder = require('abi-decoder')
const InputDataDecoder = require('ethereum-input-data-decoder')
const decoderErc20 = new InputDataDecoder(require('../config/erc20ABI').abi)

const actionsWallet = require('../actions')

const utilsWallet = require('../utils')
const workerBlockbook = require('./worker-blockbook')
const workerBlockbookWs = require('./worker-blockbook-ws')

const cache_bb_addressTxs = {}

// IDB tx cache entry format (worker-account): a per-tx bundle of per-asset views { v, txid, block_no, eth, erc20: { SYM } },
// keyed `ETH{_TEST}_<owner>_txid_<txid>` as before. Entries of the old format (one web3-mapped tx, no `v`) are re-fetched
// and overwritten on first use.
const TX_CACHE_V = 2

// in-flight Blockbook tx fetches by cache key: concurrent ETH + ERC20 refreshes of one address share one getTransaction
const bb_txInflight = {}

module.exports = {
    getAddressFull_Account_v2: async (wallet, asset, pollAddress, bbSocket, allDispatchActions, callback) => {
        return getAddressFull_Account_v2(wallet, asset, pollAddress, bbSocket, allDispatchActions, callback)
    },
    getAddressBalance_Account: (symbol, address) => {
        return getAddressBalance_Account(symbol, address)
    },
    getAddressFull_Cleanup: (wallet, asset, address) => {
        return getAddressFull_Cleanup(wallet, asset, address)
    },

    // web3 tx/receipt/block -> wallet tx (pure; for tests)
    mapTx_web3: (wallet, asset, tx, txData, txReceipt, blockData, ownAddresses, pollAddress, fromWei) => {
        return mapTx_web3(wallet, asset, tx, txData, txReceipt, blockData, ownAddresses, pollAddress, fromWei)
    },

    // Blockbook getTransaction -> { eth, erc20: { SYM } } wallet txs (pure; for tests)
    mapTxBundle_blockbook: (wallet, bbTx, ownAddresses, pollAddress, erc20Contracts) => {
        return mapTxBundle_blockbook(wallet, bbTx, ownAddresses, pollAddress, erc20Contracts)
    },
    // Blockbook getTransaction -> the wallet tx for one asset (ETH or ERC20), or undefined if not in that asset's history (pure; for tests)
    mapTx_blockbook: (wallet, asset, bbTx, ownAddresses, pollAddress, erc20Contracts) => {
        const bundle = mapTxBundle_blockbook(wallet, bbTx, ownAddresses, pollAddress, erc20Contracts)
        return bundle ? txView(bundle, asset) || undefined : undefined
    },
    // one tx through the cache + Blockbook enrichment path, with an injectable Blockbook send(method, params, cb) (for tests)
    enrichTx_blockbook: (wallet, asset, txid, pollAddress, send) => {
        return enrichTx(wallet, asset, { txid }, pollAddress, send)
    },
    TX_CACHE_V,
}

//
// address full 
// use Blockbook websocket interface for both eth & erc20's (balances & tx lists)
//  (a) blockscout has serious lag on reporting tx's -- also, have observed tx's being reported, then disappearing only to reappear later
//  (b) if we use blockbook, we have exactly the same model as utxo's -- i.e. cached IndexedDB and keyed on txid: faster, more reliable and less bandwidth
//
async function getAddressFull_Account_v2(wallet, asset, pollAddress, bbSocket, allDispatchActions, callback) {
    utilsWallet.debug(`*** getAddressFull_Account_v2 ${asset.symbol} (${pollAddress})...`)
    if (asset.symbol === 'EOS') { callback( { balance: 0, unconfirmedBalance: 0, txs: [], cappedTxs: false }, null ); return } // todo
    
    // ETH v2
    const wsSymbol = asset.symbol === 'ETH_TEST' || asset.isErc20_Ropsten ? 'ETH_TEST'
                   : asset.symbol === 'ETH' || utilsWallet.isERC20(asset) ? 'ETH'
                   : asset.symbol
    const Web3 = require('web3')
    if (self.web3_Sockets[wsSymbol] && self.web3_Sockets[wsSymbol].currentProvider.connection.readyState != 1) {
        self.web3_Sockets[wsSymbol] = undefined 
    }
    const web3 = self.web3_Sockets[wsSymbol] || new Web3(new Web3.providers.HttpProvider(configExternal.walletExternal_config[wsSymbol].httpProvider))
    // utilsWallet.log(`*** getAddressFull_Account_v2 ${asset.symbol} (${pollAddress}), web3=`, web3)
    utilsWallet.log(`*** getAddressFull_Account_v2 ${asset.symbol} (${pollAddress}), currentProvider.host=`, web3.currentProvider.host)

    var height
    var balData
    try {
        // Add timeout to prevent infinite hanging on offline nodes
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout: Node did not respond')), 3000) // 3 second timeout
        )
        height = await Promise.race([
            web3.eth.getBlockNumber(),
            timeoutPromise
        ])
        
        utilsWallet.log(`*** getAddressFull_Account_v2 ${asset.symbol} (${pollAddress}), height=`, height)

        // balance - web3 (also with timeout protection)
        balData = await getAddressBalance_Account(asset.symbol, pollAddress)
    }
    catch(ex) { 
        const errorMsg = `Failed to fetch account data from ${web3.currentProvider.host}: ${ex.message || ex.toString()}`
        utilsWallet.error(`## ${errorMsg}`)
        callback(null, errorMsg)
        return
    }

    // address tx's - BB
    if (!cache_bb_addressTxs[wsSymbol]) cache_bb_addressTxs[wsSymbol] = {}
    if (!cache_bb_addressTxs[wsSymbol][pollAddress]) cache_bb_addressTxs[wsSymbol][pollAddress] = new CircularBuffer(1)
    const cache = cache_bb_addressTxs[wsSymbol][pollAddress]
    const bbSend = (method, params, cb) => workerBlockbook.isosocket_send_Blockbook(wsSymbol, method, params, cb)

    try {
        // get address tx's from BB; used cached value if present (erc20 optimization)
        if (cache.size() > 0 && cache.get(0).height == height) {
            processBB_data(cache.get(0).data) // process from cache
        }
        else {
            // tx history via Blockbook websocket getAccountInfo (legacy socket.io getAddressTxids removed in Blockbook 0.6)
            utilsWallet.log(`getAccountInfo ${asset.symbol} (${wsSymbol}) height=${height}`)
            workerBlockbookWs.getAddressTxids(bbSend, pollAddress, configWallet.WALLET_MAX_TX_HISTORY)
            .then((txids) => {
                const data = { result: txids }
                cache.push({ height, data }) // cache
                processBB_data(data)
            }, (err) => { // Blockbook error / timeout / socket not open: report it (the callback was never called, hanging the fetch)
                const errorMsg = `Failed to fetch tx history from Blockbook: ${err && err.message ? err.message : String(err)}`
                utilsWallet.error(`## getAddressFull_Account_v2 ${asset.symbol} ${pollAddress} - ${errorMsg}`)
                callback(null, errorMsg)
            })
        }
        function processBB_data(data) {
            if (data && data.result) {
                //console.log(`data for -- ERC20'S!! DEDUPE ME!!! ${asset.symbol} @ height=${height} data.length=${data.result.length} pollAddress=${pollAddress} data.result=`, data.result) //, data)

                // if (asset.symbol === 'ETH' && pollAddress === '0xa24faebc2c6330b5122f6c3b7b5a1707f61baa5b') {
                //     debugger
                // }

                // to support erc20's we have to cap *after* filtering out the ETH tx's
                // (uncapped tx's will get populated in full to IDB cache but won't make it to browser local or session storage)
                // i.e. here we must get everything
                const totalTxCount = data.result.length // overridden below, when all dispatchTxs are fetched
                var txids = data.result

                // ## this does not work at all, now that we aren't capping the initial fetch
                // filter: new tx's, or known tx's that aren't yet enriched, or unconfirmed tx's
                // const new_txs = txids.filter(p => // only new tx that have
                //     // NO existing asset tx that is...
                //     !assetAddress.txs.some(p2 => p2.txid == p // matching
                //         && p2.isMinimal == false // and enriched
                //         && p2.block_no != -1) // and confirmed
                // )
                // instead, we do the filtering of dispatchTxs after the enriching:
                const assetAddress = asset.addresses.find(p => p.addr == pollAddress)

                //
                // queue enrich tx actions (will either take from the cache, or fetch, map & populate the cache)
                // each tx: Blockbook getTransaction (one "heavy" call, capped in flight per socket by isosocket_send_Blockbook),
                // mapped for ETH and every known ERC20 at once (mapTxBundle_blockbook); web3 only as a per-tx fallback
                //
                    // enrich *all* the tx's (we will get from IDB cache if already enriched, so could be worse)
                    const enrichOps = txids.map((txid) => { 
                        return enrichTx(wallet, asset, { txid }, pollAddress, bbSend)
                    })

                    const res = {
                        balance: balData.bal, 
             unconfirmedBalance: "0",
                            txs: [],
                   totalTxCount, // see below - tmp value
                      cappedTxs: txids.length < totalTxCount // see below - tmp value
                    }
                    
                    // await all done, then callback (for asset store update)
                    if (enrichOps.length > 0) {
                        Promise.all(enrichOps)
                        .then((enrichedTxs) => {

                            // if (asset.symbol === 'NEXO' && pollAddress === '0x23fa93bcabb452a9964d5b49777f2462bb632587') {
                            //     debugger
                            // }

                            // remove any pure eth tx's that were filtered out for an erc20 asset
                            const dispatchTxs = enrichedTxs.filter(p => p != null)
                            res.totalTxCount = dispatchTxs.length

                            if (dispatchTxs.length > 0) {
                                //utilsWallet.debug(`getAddressFull_Account_v2 ${asset.symbol} ${pollAddress} - enrichTx done for ${dispatchTxs.length} tx's - dispatching to update tx's...`)

                                // to properly support erc20's, we need to slice top *after* filtering out eth tx's
                                // (quite different to utxo/BBv3 implementation)
                                const dispatchTxs_Top = dispatchTxs.slice(0, configWallet.WALLET_MAX_TX_HISTORY)  // already sorted desc

                                //res.totalTxCount = dispatchTxs.length
                                res.cappedTxs = dispatchTxs_Top.length < dispatchTxs.length

                                //
                                // filter
                                // only update state for new tx's, known tx's that aren't yet enriched, or unconfirmed tx's
                                // ** this is v. important, to get consistent balance values while tx's are pending **
                                //
                                const dispatchTxs_Top_toUpdate = dispatchTxs_Top.filter(p => // only tx that have
                                    // NO existing asset tx that is...
                                    !assetAddress.txs.some(p2 => p2.txid == p.txid // matching
                                        && p2.isMinimal == false                   // and enriched
                                        && p2.block_no != -1)                      // and confirmed
                                )

                                res.txs = dispatchTxs_Top_toUpdate

                                if (dispatchTxs_Top_toUpdate.length > 0) {
                                    const dispatchAction = {
                                        type: actionsWallet.WCORE_SET_ENRICHED_TXS,
                                     payload: { updateAt: new Date(), symbol: asset.symbol, addr: pollAddress, txs: dispatchTxs_Top_toUpdate, res }
                                    }
                                    allDispatchActions.push(dispatchAction)
                                }
                            }

                            //console.log(`data for ${asset.symbol} data.length=${data.result.length} pollAddress=${pollAddress} dispatchTxs.length=${dispatchTxs.length}: CALLBACK 1`)
                            callback(res, null)
                        })
                        .catch((err) => {
                            const errorMsg = `Failed to enrich transactions: ${err.message || err.toString()}`
                            utilsWallet.error(`## getAddressFull_Account_v2 ${asset.symbol} ${pollAddress} - enrichOps.all FAIL, err=`, err)
                            callback(null, errorMsg)
                        })
                    }
                    else {
                        //console.log(`data for ${asset.symbol} data.length=${data.result.length} pollAddress=${pollAddress}: CALLBACK 2`)
                        callback(res, null)
                    }

                //}) // dedicatedWeb3.currentProvider.on("connect" 
            }
            else {
                debugger
                callback(null, 'No data from Blockbook')
            }
        }
    }
    catch(err) {
        debugger
        const errorMsg = `Failed to fetch address data: ${err.message || err.toString()}`
        utilsWallet.error(`### getAddressFull_Account_v2 ${asset.symbol} ${pollAddress} - err=`, err)
        callback(null, errorMsg)
    }
}

// cleanup 
async function getAddressFull_Cleanup(wallet, asset, address) {
    //utilsWallet.debug(`getAddressFull_Cleanup(account) - ${asset.symbol} ${address}...`)
    closeDedicatedWeb3Socket(asset, address)
}

// tx processing, w/ dedicated web3 instance 
var dedicatedWeb3 = []
function closeDedicatedWeb3Socket(asset, pollAddress) {
    // ### buggy - causes race condition on getTxDetails_web3() usage below
    // try {
    //     const web3Key = (asset.symbol === 'ETH_TEST' || asset.isErc20_Ropsten ? 'ETH_TEST' : 'ETH') + '_' + pollAddress
    //     if (dedicatedWeb3[web3Key]) {
    //         dedicatedWeb3[web3Key] = undefined
    //         dedicatedWeb3[web3Key].currentProvider.connection.close()
    //         utilsWallet.log(`closeDedicatedWeb3Socket ${asset.symbol} ${web3Key} - closed dedicated socket OK`)
    //     }
    // }
    // catch(err) {
    //     utilsWallet.warn(`closeDedicatedWeb3Socket ${asset.symbol} ${web3Key} - FAIL closing web3 dedicated socket, err=`, err)
    // }
}

// 'ETH' or 'ETH_TEST': the chain an account asset (ETH or ERC20) lives on (Blockbook / web3 socket key, tx cache key prefix)
function accountChain(asset) {
    return asset.symbol === 'ETH_TEST' || asset.isErc20_Ropsten ? 'ETH_TEST' : 'ETH'
}

// one asset's view of a tx bundle (a copy: callers flag it fromCache etc.); null if the tx isn't in that asset's history
function txView(bundle, asset, fromCache) {
    const view = utilsWallet.isERC20(asset)
        ? (bundle.erc20 ? bundle.erc20[asset.symbol] : undefined) // erc20: only txs moving that token to/from us
        : bundle.eth                                               // eth: every tx of the address
    if (!view) return null
    const ret = Object.assign({}, view)
    if (fromCache !== undefined) ret.fromCache = fromCache
    return ret
}

//
// enrich one tx of an ETH-chain address for one asset (ETH or ERC20): IDB tx cache first (confirmed txs only - unconfirmed
// are re-queried every time), else Blockbook getTransaction mapped for ETH *and* every known ERC20 in one go (cached as one
// bundle: the ETH asset and its ERC20 assets share the address, so whichever asset refreshes first fetches for all of them).
// Resolves the asset's wallet tx, or null (not in this asset's history, or not mappable yet). Never rejects.
//
function enrichTx(wallet, asset, tx, pollAddress, bbSend) {
    // cache key is ETH{_TEST} always --> i.e. erc20 tx's are cached with their eth tx
    // wallet owner is part of cache key because of relative fields: tx.sendToSelf and tx.isIncoming
    const chain = accountChain(asset)
    const cacheKey = `${chain}_${wallet.owner}_txid_${tx.txid}`
    const ownAddresses = asset.addresses.map(p => { return p.addr })

    return utilsWallet.txdb_getItem(cacheKey)
    .then((cached) => {
        if (cached && cached.v === TX_CACHE_V && cached.block_no !== -1) { // confirmed, current format: from cache
            return txView(cached, asset, true)
        }
        // not in cache, old format, or unconfirmed: query (one fetch per tx, shared by concurrent asset refreshes)
        var fetch = bb_txInflight[cacheKey]
        if (!fetch) {
            fetch = bb_txInflight[cacheKey] = fetchTxBundle(bbSend, wallet, asset, tx.txid, cacheKey, ownAddresses, pollAddress)
            const done = () => { if (bb_txInflight[cacheKey] === fetch) delete bb_txInflight[cacheKey] }
            fetch.then(done, done)
        }
        return fetch.then(bundle => bundle ? txView(bundle, asset, false) : null)
    })
    .catch((err) => {
        utilsWallet.reportErr(err)
        utilsWallet.error(`## enrichTx - ${asset.symbol} ${tx.txid} - error=`, err)
        return null
    })
}

// Blockbook getTransaction -> bundle (cached if confirmed); web3 fallback if Blockbook can't serve the tx. Never rejects.
function fetchTxBundle(bbSend, wallet, asset, txid, cacheKey, ownAddresses, pollAddress) {
    return new Promise((resolve) => {
        if (!bbSend) { resolve({ error: 'no Blockbook socket' }); return }
        try { bbSend('getTransaction', { txid }, (data) => resolve(data)) }
        catch (err) { resolve({ error: err.message || String(err) }) }
    })
    .then((data) => {
        if (!data || data.error || !data.txid) {
            const err = !data ? 'no data' : data.error ? (data.error.message || data.error) : 'no txid'
            utilsWallet.warn(`enrichTx - ${asset.symbol} ${txid} - Blockbook getTransaction failed (${err}): web3 fallback`)
            return fetchTxBundle_web3(wallet, asset, txid, ownAddresses, pollAddress)
        }
        var bundle
        try {
            bundle = mapTxBundle_blockbook(wallet, data, ownAddresses, pollAddress)
        }
        catch (err) { // a mapping error drops only this tx
            utilsWallet.error(`## enrichTx - ${asset.symbol} ${txid} - error mapping Blockbook tx, err=`, err)
            return null
        }
        if (!bundle) return null       // not mappable yet (pending contract creation): re-queried next time
        if (bundle.block_no === -1) return bundle // unconfirmed: never cached; re-queried until it confirms
        bundle.addedToCacheAt = new Date().getTime()
        return utilsWallet.txdb_setItem(cacheKey, bundle)
        .then(() => bundle, (err) => {
            utilsWallet.reportErr(err)
            utilsWallet.error('## enrichTx - error writing cache=', err)
            return bundle
        })
    })
    .catch((err) => {
        utilsWallet.error(`## enrichTx - ${asset.symbol} ${txid} - fetchTxBundle err=`, err)
        return null
    })
}

//
// web3 fallback (slow: tx + receipt + block per tx, over a dedicated web3 websocket per poll address): only for a tx that
// Blockbook couldn't serve (request timeout / socket down). The result is not cached - the next refresh retries Blockbook.
// ####  SINGLETON WEB3 INSTANCE IS INTERMITANTLY DYING WHEN RECEIVING/SENDING LARGE VOLUMES OF TX DATA ON IMPORTED ETH ADDR's ####
// testing shows it seems to be related to the same web3/socket being used by this fn. for >1 pollAddress;
// maintaining *one socket per poll-address* seems to cure this
//
const WEB3_FALLBACK_TIMEOUT_MS = 30000 // a provider that never connects must not hang the address fetch
function fetchTxBundle_web3(wallet, asset, txid, ownAddresses, pollAddress) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            utilsWallet.warn(`enrichTx - ${asset.symbol} ${txid} - web3 fallback: no result after ${WEB3_FALLBACK_TIMEOUT_MS}ms`)
            resolve(null)
        }, WEB3_FALLBACK_TIMEOUT_MS)
        const done = (mappedTx) => { clearTimeout(timer); resolve(mappedTx) }
        fetchTx_web3(done, wallet, asset, txid, ownAddresses, pollAddress)
    })
    .then((mappedTx) => {
        if (!mappedTx) return null
        if (mappedTx.block_no === null || mappedTx.block_no === undefined) mappedTx.block_no = -1 // pending (web3 blockNumber null)
        const erc20 = {}
        if (mappedTx.erc20 !== undefined) erc20[mappedTx.erc20] = mappedTx
        return { v: 'web3', txid, block_no: mappedTx.block_no, eth: mappedTx, erc20 }
    })
}
function fetchTx_web3(resolve, wallet, asset, txid, ownAddresses, pollAddress) {
    try {
        const chain = accountChain(asset)
        const web3Key = chain + '_' + pollAddress
        if (dedicatedWeb3[web3Key] === undefined) {
            const Web3 = require('web3')
            dedicatedWeb3[web3Key] = new Web3(new Web3.providers.WebsocketProvider(configWS.geth_ws_config[chain].url))
        }
        if (dedicatedWeb3[web3Key].currentProvider.connection.readyState != 1) {
            dedicatedWeb3[web3Key].currentProvider.on("connect", function() {
                getTxDetails_web3(resolve, dedicatedWeb3[web3Key], wallet, asset, { txid }, ownAddresses, pollAddress)
            })
        }
        else {
            getTxDetails_web3(resolve, dedicatedWeb3[web3Key], wallet, asset, { txid }, ownAddresses, pollAddress)
        }
    }
    catch (err) {
        utilsWallet.error(`## enrichTx - ${asset.symbol} ${txid} - web3 fallback err=`, err)
        resolve(null)
    }
}

// web3 tx + receipt + block -> resolve(mapTx_web3 wallet tx) or resolve(null); never rejects
function getTxDetails_web3(resolve, web3, wallet, asset, tx, ownAddresses, pollAddress) {
    const symbol = asset.symbol
    if (!web3) {
        utilsWallet.warn('getTxDetails_web3 - null web3!')
        resolve(null)
        return
    }
    web3.eth.getTransaction(tx.txid)
    .then((txData) => {
        if (!txData) {
            utilsWallet.error(`enrichTx - no tx data from web3`)
            resolve(null)
            return
        }
        return web3.eth.getTransactionReceipt(tx.txid)
        .then((txReceipt) => {
            return web3.eth.getBlock(txData.blockNumber) // block (for timestamp)
            .then((blockData) => {
                if (!blockData) {
                    utilsWallet.error(`enrichTx - no block data from web3`)
                    resolve(null)
                    return
                }
                // map tx (eth or known erc20); a mapping error drops only this tx
                var mappedTx
                try {
                    mappedTx = mapTx_web3(wallet, asset, tx, txData, txReceipt, blockData, ownAddresses, pollAddress, web3.utils.fromWei)
                }
                catch (err) {
                    utilsWallet.error(`## enrichTx - ${symbol} ${tx.txid} - error mapping tx, err=`, err)
                    resolve(null)
                    return
                }
                if (!mappedTx) {
                    utilsWallet.warn(`** enrichTx - ${symbol} ${tx.txid} IGNORE-TX (no mappedTx)`)
                }
                resolve(mappedTx || null)
            })
        })
    })
    .catch(err => {
        utilsWallet.error(`## getTxDetails_web3 FAIL - tx.txid=${tx.txid}, err=`, err)
        resolve(null)
    })
}

//
// web3 tx (+ receipt, block) -> wallet tx (EXTERNAL_TX, enriched), for ETH or a known ERC20. Pure (no I/O): exported for tests.
// Contract creation (txData.to == null): an ETH tx "to" the created contract (txReceipt.contractAddress), flagged
// isContractCreation; it used to throw (txData.to.toLowerCase()) and the tx was silently dropped from the history.
// Returns undefined if the tx can't be mapped (e.g. an excluded erc20).
//
function mapTx_web3(wallet, asset, tx, txData, txReceipt, blockData, ownAddresses, pollAddress, fromWei) {
    // contract creation: no `to`; the tx goes "to" the created contract (receipt)
    const isContractCreation = !txData.to
    const txTo = txData.to || (txReceipt && txReceipt.contractAddress) || null
    const txTo_lc = txTo ? txTo.toLowerCase() : null
    // contract creation with no receipt yet (pending; contract address unknown): not mapped (not cached), so it is re-enriched
    // once mined. A null account_to would reach appWorkerCallbacks' utilsWallet.isERC20(enrichTx.account_to) and throw.
    if (isContractCreation && !txTo) return undefined

    // reverted status (usually will be due to erc20 gas too low)
    const txFailedReverted = txReceipt !== null && txReceipt !== undefined && !(txReceipt.status == '0x1' || txReceipt.status == 1)
    const blockTimestamp = blockData.timestamp

    const weAreSender = ownAddresses.some(ownAddr => ownAddr.toLowerCase() === txData.from.toLowerCase())

    // if (//tx.txid === '0x1bc5b94180d2b7521a1a1ca2b8be5eaf5106abee5b5965fa7594447ca7af97fa' || //  non-erc20: "transferEth" - no decode
    //     //tx.txid === '0x1d9018dd37fc010df2d20bf9151f3e25a34f1a55a125141faaa52386c872aa1b' // unsupported erc20 (AMB)
    //      tx.txid === '0x7d52ed1cc204d66b7f9b583c43db3e94bfbb019810cf45e72f8a47052e66eab9' //  non-erc20 "multisend" - no decode
    // ) { 
    //     debugger
    // }

    // is an erc20 tx? - includes unknown ERC20 types
    const decodedData = decoderErc20.decodeData(txData.input)
    var erc20_transferTo
    if (decodedData && decodedData.method === "transfer" && decodedData.inputs && decodedData.inputs.length > 1) {
        erc20_transferTo = ('0x' + decodedData.inputs[0]).toLowerCase()
    }
    const isErc20_transfer = ownAddresses.some(ownAddr => ownAddr.toLowerCase() === erc20_transferTo)
                          || ownAddresses.some(ownAddr => ownAddr.toLowerCase() === txData.from.toLowerCase())

    // known erc20 tx?
    const known_erc20s = Object.keys(configExternal.erc20Contracts).map(p => { return { erc20_addr: configExternal.erc20Contracts[p], symbol: p } })
    const known_erc20 = isContractCreation ? undefined : known_erc20s.find(p => { return p.erc20_addr.toLowerCase() === txTo_lc })

    // if (symbol === 'SD1A_TEST' && tx.txid == '0xde72f0883a1f937134d5795cb00223c88f2d41963353786e2a0f614657f93897') {
    //     debugger
    // }

    // map tx (eth or known erc20)
    var mappedTx
    var processAsEthTx = true
    if (known_erc20 !== undefined) {
        if (decodedData) {
            if (decodedData.method === "transfer" && decodedData.inputs && decodedData.inputs.length > 1) {
                const param_to = '0x' + decodedData.inputs[0] 
                const tokenValue = decodedData.inputs[1] 

                const bn_tokenValue = new BigNumber(tokenValue)
                const assetErc20 = wallet.assets.find(p => p.symbol === known_erc20.symbol )
                const du_value = assetErc20 
                    ? utilsWallet.toDisplayUnit(bn_tokenValue, assetErc20) 
                    : undefined

                if (tokenValue !== undefined && du_value !== undefined) {
                    const sendToSelf = 
                           ownAddresses.some(ownAddr => ownAddr.toLowerCase() === param_to.toLowerCase())
                        && ownAddresses.some(ownAddr => ownAddr.toLowerCase() === txData.from.toLowerCase())

                    mappedTx = { // EXTERNAL_TX (enriched) - ERC20
                        erc20: known_erc20.symbol,
               erc20_contract: txData.to,
                         date: new Date(blockTimestamp * 1000), 
                         txid: tx.txid,
                    isMinimal: false,
                   isIncoming: !weAreSender,
                   sendToSelf,
                        value: Number(du_value),
                     toOrFrom: !weAreSender ? txData.from : txData.to,
                   account_to: param_to.toLowerCase(),
                 account_from: txData.from.toLowerCase(),
                     block_no: txData.blockNumber, 
                         fees: weAreSender
                                ? Number((new BigNumber(txData.gas).div(new BigNumber(1000000000))).times((new BigNumber(txData.gasPrice).div(new BigNumber(1000000000)))))
                                : 0,
             txFailedReverted,
                        nonce: txData.nonce,
                    }

                    processAsEthTx = false
                }
            }
        }
    }

    if (processAsEthTx) { // ETH TX
        const sendToSelf =
               txTo_lc !== null && ownAddresses.some(ownAddr => ownAddr.toLowerCase() === txTo_lc)
            && ownAddresses.some(ownAddr => ownAddr.toLowerCase() === txData.from.toLowerCase())

        mappedTx = { // EXTERNAL_TX (enriched) - ETH 
                 erc20: undefined,
                  date: new Date(blockTimestamp * 1000), 
                  txid: tx.txid,
             isMinimal: false,
            isIncoming: !weAreSender, 
            sendToSelf,
                 value: Number(fromWei(txData.value, 'ether')),
              toOrFrom:  !weAreSender ? txData.from : txTo,
            account_to: txTo_lc, 
          account_from: txData.from.toLowerCase(),
              block_no: txData.blockNumber, 
                  fees: weAreSender
                        ? Number((new BigNumber(txData.gas).div(new BigNumber(1000000000))).times((new BigNumber(txData.gasPrice).div(new BigNumber(1000000000)))))
                        : 0,
       txFailedReverted,
                  nonce: txData.nonce,
        }

        // unknown (unsupported) erc20 transfer? e.g. 0x1d9018dd37fc010df2d20bf9151f3e25a34f1a55a125141faaa52386c872aa1b (airdrop AMB)
        if (erc20_transferTo) {
            mappedTx.account_to = erc20_transferTo
            mappedTx.erc20_isUnsupported = true
        }

        // this condition is happening when we're involved in a nonstandard (non-payable fallback) TX, but we fail to decode an erc20 transfer() method;
        // (e.g. 0x7d52ed1cc204d66b7f9b583c43db3e94bfbb019810cf45e72f8a47052e66eab9: "multisend()")
        // the result is an unknown receiver (mappedTx.account_to: the non-standard erc20 contract addr)
        const weAreSenderOrReceiver = weAreSender || (mappedTx.account_to ? ownAddresses.some(ownAddr => ownAddr.toLowerCase() === mappedTx.account_to.toLowerCase()) : false)
        if (weAreSenderOrReceiver === false) {
            mappedTx.account_to = pollAddress
            mappedTx.isNonErc20_ContractParam = true
        }
    }
    if (mappedTx && isContractCreation) mappedTx.isContractCreation = true
    return mappedTx
}

//
// Blockbook 0.6 ETH tx (websocket getTransaction / getAccountInfo details:'txs' item) -> wallet txs (EXTERNAL_TX, enriched),
// one view per asset, each with the same shape as mapTx_web3's output. Pure (no I/O): exported for tests.
//
// Returns a bundle { v, txid, block_no, eth, erc20: { SYMBOL: tx } }, or null if the tx can't be mapped yet:
//   eth    the ETH asset's view. Every tx of the address is in ETH history (as with web3): ETH sends/receives, contract calls,
//          contract creations, and token txs - a tx moving a known token and no ETH is tagged erc20/erc20_contract
//          (like the local erc20_ethFeeTx: the UI shows its ETH fee if outgoing, and hides it if incoming).
//   erc20  one view per KNOWN token - configExternal.erc20Contracts, the code's (historical) erc20 list, matched by contract
//          address (never by Blockbook's symbol: spam tokens fake "USDT", "TUSD" ...) - that moved a non-zero amount to or from
//          us in this tx, per its tokenTransfers (Transfer events): direct transfer() calls, but also tokens moved through
//          routers (transferFrom), mints (from 0x0, e.g. faucets) and airdrops. Value = |net amount| for us, direction = sign.
//          Zero-value token transfers (address poisoning: a 0-token transferFrom "from" us to a look-alike address) are ignored.
//          A direct transfer() call to a known token with no Transfer event (reverted, or pending) is decoded from the call data.
// Fees: the fee actually paid (Blockbook `fees` = gasUsed x effective gas price) once mined - mapTx_web3 reported the
// maximum (gas limit x gas price); while pending, gas limit x gas price. Counted only when we sent the tx (erc20 too).
//
const WEI_PER_ETH = new BigNumber(10).pow(18)
const ERC20_TRANSFER_METHOD = '0xa9059cbb' // transfer(address,uint256)

function lc(s) { return s ? String(s).toLowerCase() : s }
function bb_firstAddr(io) {
    return io && io.length > 0 && io[0] && io[0].addresses && io[0].addresses.length > 0 ? io[0].addresses[0] : undefined
}

function mapTxBundle_blockbook(wallet, bbTx, ownAddresses, pollAddress, erc20Contracts) {
    if (!bbTx || !bbTx.txid) return null
    const own = (ownAddresses || []).map(lc)
    const isOwn = (a) => !!a && own.indexOf(lc(a)) !== -1
    const es = bbTx.ethereumSpecific || {}
    const txFrom = bb_firstAddr(bbTx.vin)
    if (!txFrom) return null

    // contract creation: no `to`; the tx goes "to" the created contract
    const txToAddr = bb_firstAddr(bbTx.vout)
    const isContractCreation = !txToAddr
    const txTo = txToAddr || es.createdContract || null
    // pending contract creation (contract address unknown): not mapped (not cached), so it is re-enriched once mined.
    // A null account_to would reach appWorkerCallbacks' utilsWallet.isERC20(enrichTx.account_to) and throw.
    if (isContractCreation && !txTo) return null
    const txTo_lc = lc(txTo)

    const block_no = bbTx.blockHeight > 0 ? bbTx.blockHeight : -1 // Blockbook: -1 (or 0) while in the mempool
    const blockTime = bbTx.blockTime > 0 ? bbTx.blockTime : Math.floor(new Date().getTime() / 1000) // mempool: first-seen time
    const weAreSender = isOwn(txFrom)
    const feeWei = block_no !== -1 && bbTx.fees !== undefined
        ? new BigNumber(bbTx.fees)                                                    // paid: gasUsed x effective gas price
        : new BigNumber(es.gasLimit || 0).times(new BigNumber(es.gasPrice || 0))     // pending: the most it can cost
    const common = {
             date: new Date(blockTime * 1000),
             txid: bbTx.txid,
        isMinimal: false,
         block_no,
             fees: weAreSender ? Number(feeWei.div(WEI_PER_ETH).toFixed()) : 0,
 txFailedReverted: es.status === 0, // Blockbook status: 1 ok, 0 failed (reverted), -1 pending
            nonce: es.nonce,
    }

    // known erc20s, by lowercase contract address
    const contracts = erc20Contracts || configExternal.erc20Contracts
    const knownByAddr = {}
    Object.keys(contracts).forEach(sym => { if (contracts[sym]) knownByAddr[lc(contracts[sym])] = sym })
    const decimalsOf = (sym, bbDecimals) => {
        const walletAsset = wallet && wallet.assets ? wallet.assets.find(p => p.symbol === sym) : undefined
        const d = walletAsset && walletAsset.decimals !== undefined ? walletAsset.decimals : bbDecimals
        return typeof d === 'number' && d >= 0 ? d : undefined
    }
    const du = (bn, decimals) => Number(bn.div(new BigNumber(10).pow(decimals)).toFixed())

    // token transfers to/from us: known erc20s summed per token, the rest (unknown/unsupported tokens, NFTs) kept aside
    const byToken = {}
    const otherOwn = []
    const tokenTransfers = bbTx.tokenTransfers || []
    tokenTransfers.forEach(tt => {
        const tIn = isOwn(tt.to), tOut = isOwn(tt.from)
        if (!tIn && !tOut) return
        const contract = tt.contract || tt.token
        const sym = knownByAddr[lc(contract)]
        const fungible = tt.type === 'ERC20' || tt.standard === 'ERC20' || (tt.type === undefined && tt.standard === undefined)
        if (!sym || !fungible || tt.value === undefined || decimalsOf(sym, tt.decimals) === undefined) { otherOwn.push(tt); return }
        const v = new BigNumber(tt.value)
        if (v.isZero()) return // zero-value transfer of a known token: address poisoning, ignored
        const t = byToken[sym] || (byToken[sym] = { contract, decimals: decimalsOf(sym, tt.decimals), in: new BigNumber(0), out: new BigNumber(0), self: new BigNumber(0) })
        const k = tIn && tOut ? 'self' : tIn ? 'in' : 'out'
        t[k] = t[k].plus(v)
        const topKey = 'top_' + k // the largest transfer each way: its counterparty is the tx's "to or from" for us
        if (!t[topKey] || v.gt(t[topKey].v)) t[topKey] = { tt, v }
    })

    const erc20 = {}
    Object.keys(byToken).forEach(sym => {
        const t = byToken[sym]
        const net = t.in.minus(t.out)
        var isIncoming, sendToSelf, value, top
        if (net.gt(0))      { isIncoming = true;  sendToSelf = false; value = net;           top = t.top_in }
        else if (net.lt(0)) { isIncoming = false; sendToSelf = false; value = net.negated(); top = t.top_out }
        else                { isIncoming = !weAreSender; sendToSelf = true; value = t.self.gt(0) ? t.self : t.in; top = t.top_self || t.top_in || t.top_out }
        erc20[sym] = Object.assign({ // EXTERNAL_TX (enriched) - ERC20
                     erc20: sym,
            erc20_contract: t.contract,
                isIncoming,
                sendToSelf,
                     value: du(value, t.decimals),
                  toOrFrom: isIncoming && !sendToSelf ? top.tt.from : top.tt.to,
                account_to: lc(top.tt.to),
              account_from: lc(top.tt.from),
        }, common)
    })

    // a direct transfer(to, value) call: decoded from the call data
    const data = es.data || ''
    var transferTo, transferValue
    if (lc(data.slice(0, 10)) === ERC20_TRANSFER_METHOD && data.length >= 138) {
        transferTo = '0x' + lc(data.slice(34, 74))
        transferValue = new BigNumber(data.slice(74, 138), 16)
    }
    // ... to a known erc20 that emitted no Transfer event (reverted, or pending): the erc20 view from the call data (as mapTx_web3)
    const toSym = !isContractCreation && txTo_lc ? knownByAddr[txTo_lc] : undefined
    if (transferTo && toSym && !erc20[toSym] && (weAreSender || isOwn(transferTo))
        && !tokenTransfers.some(tt => lc(tt.contract || tt.token) === txTo_lc) && decimalsOf(toSym) !== undefined) {
        erc20[toSym] = Object.assign({ // EXTERNAL_TX (enriched) - ERC20 (from call data)
                     erc20: toSym,
            erc20_contract: txTo,
                isIncoming: !weAreSender,
                sendToSelf: weAreSender && isOwn(transferTo),
                     value: du(transferValue, decimalsOf(toSym)),
                  toOrFrom: !weAreSender ? txFrom : transferTo,
                account_to: transferTo,
              account_from: lc(txFrom),
        }, common)
    }

    const eth = Object.assign({ // EXTERNAL_TX (enriched) - ETH
                 erc20: undefined,
            isIncoming: !weAreSender,
            sendToSelf: txTo_lc !== null && isOwn(txTo_lc) && weAreSender,
                 value: Number(new BigNumber(bbTx.value || 0).div(WEI_PER_ETH).toFixed()),
              toOrFrom: !weAreSender ? txFrom : txTo,
            account_to: txTo_lc,
          account_from: lc(txFrom),
    }, common)
    const syms = Object.keys(erc20)
    if (syms.length > 0 && new BigNumber(bbTx.value || 0).isZero()) {
        // a token tx (moves no ETH itself): tagged with the token (prefer one we sent)
        const sym = syms.find(p => !erc20[p].isIncoming) || syms[0]
        eth.erc20 = sym
        eth.erc20_contract = erc20[sym].erc20_contract
    }
    else {
        // unknown (unsupported) token moved to/from us (e.g. an airdrop, a token not in erc20Contracts), or a direct transfer()
        // of one that emitted nothing: as mapTx_web3's erc20_transferTo
        const unk = otherOwn.find(tt => isOwn(tt.to)) || otherOwn[0]
        const unsupportedTo = unk ? lc(unk.to) : transferTo && !toSym ? transferTo : undefined
        if (unsupportedTo) {
            eth.account_to = unsupportedTo
            eth.erc20_isUnsupported = true
        }
        // we're involved in a contract call that moved nothing (we can see) to/from us, e.g. a third party's multisend or a
        // zero-value token transferFrom: unknown receiver, attributed to the polled address (as mapTx_web3)
        const weAreSenderOrReceiver = weAreSender || (eth.account_to ? isOwn(eth.account_to) : false)
        if (weAreSenderOrReceiver === false) {
            eth.account_to = pollAddress
            eth.isNonErc20_ContractParam = true
        }
    }
    if (isContractCreation) eth.isContractCreation = true

    return { v: TX_CACHE_V, txid: bbTx.txid, block_no, eth, erc20 }
}

//
// get balance
//
async function getAddressBalance_Account(symbol, address) {
    //utilsWallet.debug(`getAddressBalance_Account ${symbol} (${address})...`)

    switch (symbol) {
        case 'EOS': // todo
            return { bal: "0", symbol, address }

        case 'ETH':
        case 'ETH_TEST':    
            const wei = await getETHAddressBalance_api(symbol, address)
            if (configWallet.ETH_COALESCE_DUST_TO_ZERO && wei > 0 && wei <= configWallet.ETH_DUST_WEI) {
                utilsWallet.log(`getAddressBalance_Account ${symbol} - rounding dust (balance) wei value ${wei}`)
                return { bal: "0", symbol, address }
            }
            return { bal: wei, symbol, address }

        default:
            const erc20_balance = await getERC20AddressBalance_api(symbol, address) 
            return { bal: erc20_balance, symbol, address }
    }
}

function getETHAddressBalance_api(symbol, address) {

    //if (configWallet.ETH_USEWEB3_ACCOUNT_BALANCES) {
        //utilsWallet.debug(`*** getETHAddressBalance_api (using web3) (ACCOUNT) ${symbol} (${address})...`)

        return new Promise((resolve, reject) => {
            const Web3 = require('web3')

            if (self.web3_Sockets[symbol] && self.web3_Sockets[symbol].currentProvider.connection.readyState != 1) {
                self.web3_Sockets[symbol] = undefined 
            }

            const web3 = self.web3_Sockets[symbol] || new Web3(new Web3.providers.HttpProvider(configExternal.walletExternal_config[symbol].httpProvider))
            
            // Add timeout to prevent infinite hanging
            const timeoutPromise = new Promise((_, timeoutReject) => 
                setTimeout(() => timeoutReject(new Error('Timeout: Node did not respond')), 3000)
            )
            
            Promise.race([
                web3.eth.getBalance(address),
                timeoutPromise
            ])
            .then(balWei => {
                resolve(balWei.toString())
            })
            .catch((err) => {
                utilsWallet.warn(`### getETHAddressBalance_api (using web3) ${symbol} (${address}) FAIL - err=`, err)
                reject(err)
            })
        })
    //}
    // else {
    //     //utilsWallet.debug(`*** getETHAddressBalance_api (using api) (ACCOUNT) ${symbol} (${address})...`)

    //     return new Promise((resolve, reject) => {
    //         //axiosRetry(axios, configWallet.AXIOS_RETRY_3PBP)
    //         axios.get(configExternal.walletExternal_config[symbol].api.balance(address) + `&noCache=${new Date().getTime()}`)
    //             .then(res => {
    //                 if (res && res.status === 200 && res.data && res.data.message === "OK") {
    //                     var balWei = res.data.result
    //                     utilsWallet.log(`*** getETHAddressBalance_api (using api) ${symbol} (${address}), balWei=`, balWei)
    //                     resolve(balWei.toString())
    //                 } else {
    //                     const err = `### getETHAddressBalance_api (using api) ${symbol} (${address}) UNEXPECTED DATA; balance undefined ###`
    //                     utilsWallet.warn(err)
    //                     reject(err)
    //                 }
    //             })
    //             .catch((err) => {
    //                 utilsWallet.warn(`### getETHAddressBalance_api (using api) ${symbol} (${address}) FAIL - err=`, err)
    //                 reject(err)
    //             })
    //     })
    // }
}

function getERC20AddressBalance_api(symbol, address) {
    //if (configWallet.ETH_ERC20_USEWEB3_TOKEN_BALANCES) {
        //utilsWallet.debug(`*** getERC20AddressBalance_api ${symbol} (${address}) web3...`)

        return new Promise((resolve, reject) => {
            const Web3 = require('web3')

            const meta = configWallet.getMetaBySymbol(symbol)
            const wsSymbol = meta.isErc20_Ropsten ? 'ETH_TEST' : 'ETH'

            if (self.web3_Sockets[wsSymbol] && self.web3_Sockets[wsSymbol].currentProvider.connection.readyState != 1) {
                self.web3_Sockets[wsSymbol] = undefined 
            }
            
            const web3 = self.web3_Sockets[wsSymbol] || new Web3(new Web3.providers.HttpProvider(configExternal.walletExternal_config[symbol].httpProvider))
            const tknAddress = (address).substring(2)
            const contractData = ('0x70a08231000000000000000000000000' // balanceOf
                                + tknAddress)                          // (address)
            const contractAddress = configExternal.walletExternal_config[symbol].contractAddress
            
            // Add timeout to prevent infinite hanging
            const timeoutId = setTimeout(() => {
                reject(new Error('Timeout: Node did not respond'))
            }, 3000)
            
            web3.eth.call({
                to: contractAddress,
                data: contractData
            },
            web3.eth.defaultBlock,
                (err, result) => {
                    clearTimeout(timeoutId)
                    if (result) {
                        const tokens = web3.utils.toBN(result)
                        // if (symbol === 'SD1A_TEST') {
                        //     utilsWallet.warn(`OK: getERC20AddressBalance_api ${symbol} (${address}) web3 - tokens=`, tokens.toString())
                        // }
                        resolve(tokens.toString())
                    }
                    else {
                        utilsWallet.warn(`### getERC20AddressBalance_api ${symbol} (${address}) web3 FAIL - err=`, err)
                        reject(err)
                    }
                });
        })
    // }
    // else {
    //     //utilsWallet.debug(`*** getERC20AddressBalance_api (using api) (ACCOUNT) ${symbol} (${address})...`)

    //     return new Promise((resolve, reject) => {
    //         //axiosRetry(axios, configWallet.AXIOS_RETRY_3PBP)
    //         axios.get(configExternal.walletExternal_config[symbol].api.balance(address) + `&noCache=${new Date().getTime()}`)
    //             .then(res => {
    //                 if (res && res.status === 200 && res.data && res.data.message === "OK") {
    //                     var balWei = res.data.result

    //                     resolve(balWei.toString())
    //                 } else {
    //                     const err = `### getERC20AddressBalance_api ${symbol} (${address}) UNEXPECTED DATA; balance undefined ###`
    //                     utilsWallet.warn(err)
    //                     reject(err)
    //                 }
    //             })
    //             .catch((err) => {
    //                 utilsWallet.warn(`### getERC20AddressBalance_api ${symbol} (${address}) FAIL - err=`, err)
    //                 reject(err)
    //             })
    //     })
    // }
}

// export function getERC20AddressBalance_web3(symbol, address) {
// utilsWallet.log(`*** getERC20AddressBalance_web3 (ACCOUNT) ${symbol} (${address})...`)
// return new Promise((resolve, reject) => {
//     const Web3 = require('web3')
//     const web3 = new Web3()
//     web3.setProvider(
//         new Web3.providers.HttpProvider(configExternal.walletExternal_config[symbol].httpProvider)
//     );
//     const tknAddress = (address).substring(2);
//     const contractData = ('0x70a08231000000000000000000000000' + tknAddress);
//     const contractAddress = configExternal.walletExternal_config[symbol].contractAddress
//     web3.eth.call({
//         to: contractAddress, 
//         data: contractData  
//         }, (err, result) => {
//         if (result) { 
//             const tokens = web3.utils.toBN(result).toString();
//             const value = web3.utils.fromWei(tokens, 'ether')
//             resolve(Number(value))
//         }
//         else {
//             reject(err)
//         }
//     });
//     })
// }

// http://qnimate.com/calculating-nonce-for-raw-transactions-in-geth/
// NOTE: this is *not* the way to do it! getTransactionCount(... 'pending') works on latest Geth, far better.
// export async function getNonce(web3, address) {
//     var ret = web3.eth.getTransactionCount(address)
//         .then(async (result) => {
//             var txCount = result // mined tx count
//             var txpool_content = await axios.post(ethHttpProvider, { method: "txpool_content", params: [], jsonrpc: "2.0", id: new Date().getTime() })
//             utilsWallet.log('getNonce -- txpool_content=', txpool_content)
//             if (!txpool_content || !txpool_content.data || !txpool_content.data.result || !txpool_content.data.result.pending) {
//                 utilsWallet.warn(`getNonce -- no txpool_content; on testnet? -- multiple tx's won't be accepted until previous tx's are mined!`)
//             }
//             else {
//                 // could use txpool_content.pending for faster receives? (shomehow?) 
//                 const pending = txpool_content.data.result.pending
//                 utilsWallet.log('pending=', pending)
//                 console.time('process tx_pool')
//                 const txpool_addrs = Object.keys(pending)
//                 utilsWallet.log('txpool_addrs=', txpool_addrs)
//                 for (var i=0 ; i < txpool_addrs.length ; i++) {
//                     const addrKey = txpool_addrs[i]
//                     var pendingForAddr = pending[addrKey]
//                     if (pendingForAddr && addrKey.toLowerCase() === address.toLowerCase()) {
//                         const pendingTxCount = Object.keys(pendingForAddr).length
//                         utilsWallet.log(`getNonce -- ${address} pendingForAddr, pendingTxCount=`, pendingForAddr, pendingTxCount)
//                         txCount = txCount + pendingTxCount // + pending tx count
//                         break
//                     }
//                 }
//                 console.timeEnd('process tx_pool')
//             } 
//             return txCount
//         })
//         .catch(err => {
//             utilsWallet.warn(`## getNonce FAIL, err=`, err)
//         })
//     return ret
// }

// (eth v1 -- using blockscout & web3)
/*export function getAddressFull_Account(asset, pollAddress) {
    const symbol = asset.symbol
    const ownAddresses = asset.addresses.map(p => { return p.addr })

    utilsWallet.log(`*** getAddressFull_Account ${symbol} (${pollAddress})...`)
    if (symbol === 'EOS') { return Promise.resolve({ balance: 0, unconfirmedBalance: 0, txs: [] }) } // todo

    axiosRetry(axios, configWallet.AXIOS_RETRY_3PBP)
    return Promise.all([
        getAddressBalance_Account(symbol, pollAddress),
        axios.get(configExternal.walletExternal_config[symbol].api.txlist(pollAddress) + `&noCache=${new Date().getTime()}`)
    ]).then((res) => {

            utilsWallet.log(`getAddressFull_Account ${symbol} res=`, res)

        var txs = []
        var balance = 0
        var cappedTxs = false
        if (!res || res === undefined || res.length < 2) {
            utilsWallet.warn(`getAddressFull_Account ${symbol} -- unexpected data!`)
        }
        else {
            balance = res[0]
            if (res[1].data.result === undefined) {
                utilsWallet.warn(`getAddressFull_Account ${symbol} -- no data.result!`)
            }
            else {
                //utilsWallet.log(`getAddressFull_Account ${symbol} addr=${pollAddress} -- got ${res[1].data.result.length} from ${configExternal.walletExternal_config[symbol].api.txlist(pollAddress)}...`)

                const sorted_txs_desc = res[1].data.result.sort((a, b) => {
                    return a.timeStamp > b.timeStamp ? -1 : a.timeStamp < b.timeStamp ? -1 : 0
                })

                // tx's 
                txs = sorted_txs_desc
                    .slice(0, configWallet.WALLET_MAX_TX_HISTORY) // cap 
                    .map(tx => {

                        const isIncoming = tx.from !== pollAddress

                        const sendToSelf = ownAddresses.some(p => p === tx.to.toLowerCase())
                            && ownAddresses.some(p => p === tx.from.toLowerCase())

                        const gasPrice = tx.gasPrice / 1000000000
                        const fees = tx.gasUsed * gasPrice / 1000000000

                        const Web3 = require('web3')
                        const web3 = self.web3_Sockets || new Web3(new Web3.providers.HttpProvider(configExternal.walletExternal_config[symbol].httpProvider))

                        return { // EXTERNAL_TX
                            isMinimal: false,
                            isIncoming,
                            sendToSelf,
                            date: new Date(tx.timeStamp * 1000),
                            value: Number(web3.utils.fromWei(tx.value, 'ether')),
                            txid: tx.hash,
                            toOrFrom: isIncoming ? tx.from : tx.to,
                            block_no: tx.blockNumber,
                            //confirmations: tx.confirmations,
                            fees: fees
                        }
                    }).sort((a, b) => {
                        return (a.date > b.date) ? -1 : ((b.date > a.date) ? 1 : 0)
                    })

                cappedTxs = res[1].data.result.length > txs.length
            }
        }

        return {
            balance, // wei 
            unconfirmedBalance: "0",
            txs,
            cappedTxs,
        }
    })
}*/