// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2021 Dominic Morris.

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

const cache_bb_addressTxs = {}

module.exports = {
    getAddressFull_Account_v2: async (wallet, asset, pollAddress, bbSocket, allDispatchActions, callback) => {
        return getAddressFull_Account_v2(wallet, asset, pollAddress, bbSocket, allDispatchActions, callback)
    },
    getAddressBalance_Account: (symbol, address) => {
        return getAddressBalance_Account(symbol, address)
    },
    getAddressFull_Cleanup: (wallet, asset, address) => {
        return getAddressFull_Cleanup(wallet, asset, address)
    }
}

//
// address full 
// use Blockbook websocket interface for both eth & erc20's (balances & tx lists)
//  (a) blockscout has serious lag on reporting tx's -- also, have observed tx's being reported, then disappearing only to reappear later
//  (b) if we use blockbook, we have exactly the same model as utxo's -- i.e. cached IndexedDB and keyed on txid: faster, more reliable and less bandwidth
//
async function getAddressFull_Account_v2(wallet, asset, pollAddress, bbSocket, allDispatchActions, callback) {
    //utilsWallet.debug(`*** getAddressFull_Account_v2 ${asset.symbol} (${pollAddress})...`)
    if (asset.symbol === 'EOS') { callback( { balance: 0, unconfirmedBalance: 0, txs: [], cappedTxs: false } ); return } // todo
    
    // ETH v2
    const wsSymbol = asset.symbol === 'ETH_TEST' || asset.isErc20_Ropsten ? 'ETH_TEST'
                   : asset.symbol === 'ETH' || utilsWallet.isERC20(asset) ? 'ETH'
                   : asset.symbol
    const Web3 = require('web3')
    if (self.ws_web3[wsSymbol] && self.ws_web3[wsSymbol].currentProvider.connection.readyState != 1) {
        self.ws_web3[wsSymbol] = undefined 
    }
    const web3 = self.ws_web3[wsSymbol] || new Web3(new Web3.providers.HttpProvider(configExternal.walletExternal_config[wsSymbol].httpProvider))

    var height
    try {
        height = await web3.eth.getBlockNumber()
    }
    catch(ex) { 
        utilsWallet.error(`## failed to get block height: ${asset.symbol} (${pollAddress})`)
        callback(null)
        return
    }

     // balance - web3
    const balData = await getAddressBalance_Account(asset.symbol, pollAddress)

    // address tx's - BB
    if (!cache_bb_addressTxs[wsSymbol]) cache_bb_addressTxs[wsSymbol] = {}
    if (!cache_bb_addressTxs[wsSymbol][pollAddress]) cache_bb_addressTxs[wsSymbol][pollAddress] = new CircularBuffer(1)
    const cache = cache_bb_addressTxs[wsSymbol][pollAddress]

    try {
        // get address tx's from BB; used cached value if present (erc20 optimization)
        if (cache.size() > 0 && cache.get(0).height == height) {
            processBB_data(cache.get(0).data) // process from cache
        }
        else {
            bbSocket.send({ // get tx's
                method: 'getAddressTxids',  
                params: [ [pollAddress], 
                            { start: height,// + 100, 
                              //end: height - 100000, // ~17 days
                                // UPDATE 1: suspected: end: 0 causing sometimes very, slow processing?
                                // UPDATE 2: CircularBuffer discards this path on erc20's - must be beneficial; reverting to end: 0
                                end: 0, // uncapped -- all TX's
                queryMempoolOnly: false }]
            }, (data) => { 
                cache.push({ height, data }) // cache
                processBB_data(data)
            })
        }
        function processBB_data(data) {
            if (data && data.result) {
                //console.log(`data for -- ERC20'S!! DEDUPE ME!!! ${asset.symbol} @ height=${height} data.length=${data.result.length} pollAddress=${pollAddress} bbSocket=`, bbSocket) //, data)

                // if (asset.symbol === 'NEXO' && pollAddress === '0x23fa93bcabb452a9964d5b49777f2462bb632587') {
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
                // queue enrich tx actions (will either take from the cache, or fetch, prune & populate the cache)
                // ####  SINGLETON WEB3 INSTANCE IS INTERMITANTLY DYING WHEN RECEIVING/SENDING LARGE VOLUMES OF TX DATA ON IMPORTED ETH ADDR's ####
                // testing shows it seems to be related to the same web3/socket being used by this fn. for >1 pollAddress;
                // maintaining *one socket per poll-address* seems to cure this
                //
                //const Web3 = require('web3')
                //const dedicatedWeb3 = new Web3(new Web3.providers.WebsocketProvider(configWS.geth_ws_config['ETH'].url)) 
                //dedicatedWeb3.currentProvider.on("connect", data => { 
                    
                    // enrich *all* the tx's (we will get from IDB cache if already enriched, so could be worse)
                    const enrichOps = txids.map((txid) => { 
                        return enrichTx(
                            //dedicatedWeb3,
                            wallet, asset, { txid }, pollAddress
                        )
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
                            callback(res)
                        })
                        .catch((err) => {
                            utilsWallet.error(`## getAddressFull_Account_v2 ${asset.symbol} ${pollAddress} - enrichOps.all FAIL, err=`, err)
                        })
                    }
                    else {
                        //console.log(`data for ${asset.symbol} data.length=${data.result.length} pollAddress=${pollAddress}: CALLBACK 2`)
                        callback(res)
                    }

                //}) // dedicatedWeb3.currentProvider.on("connect" 
            }
            else {
                debugger
                callback(null)
            }
        }
    }
    catch(err) {
        debugger
        utilsWallet.error(`### getAddressFull_Account_v2 ${asset.symbol} ${pollAddress} - err=`, err)
        callback(null)
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

function enrichTx(wallet, asset, tx, pollAddress) {
    return new Promise((resolve, reject) => { 
        const symbol = asset.symbol

        // cache key is ETH{_TEST} always --> i.e. erc20 tx's are cached as eth tx's
        // wallet owner is part of cache key because of relative fields: tx.sendToSelf and tx.isIncoming 
        const cacheKey = `${asset.symbol === 'ETH_TEST' || asset.isErc20_Ropsten ? 'ETH_TEST' : 'ETH'}_${wallet.owner}_txid_${tx.txid}` 
        const ownAddresses = asset.addresses.map(p => { return p.addr })

        //utilsWallet.debug(`** enrichTx - ${asset.symbol} ${tx.txid} ${configWallet.WALLET_ENV}...`)

        // try cache first
        utilsWallet.txdb_getItem(cacheKey)
        .then((cachedTx) => {

            // if (symbol === 'SD1A_TEST' && tx.txid == '0xde72f0883a1f937134d5795cb00223c88f2d41963353786e2a0f614657f93897') {
            //     debugger
            // }

            if (cachedTx && cachedTx.block_no != -1) { // requery unconfirmed cached tx's

                // if we are updating for erc20 asset, filter out eth or other erc20 assets
                if (utilsWallet.isERC20(asset) && cachedTx.erc20 !== asset.symbol) {
                    //utilsWallet.warn(`** enrichTx - ${symbol} ${tx.txid} IGNORE-CACHE (it's eth or another erc20) - cachedTx=`, cachedTx)
                    resolve(null) // these are not the droids we are looking for
                }
                else {
                    // we are updating for eth asset, or for erc20 and this is indeed an erc20 tx for that erc20 asset
                    cachedTx.fromCache = true
                    //utilsWallet.debug(`** enrichTx - ${symbol} ${tx.txid} RET-CACHE`)
                    resolve(cachedTx) 
                }
            }
            else { // not in cache, or unconfirmed in cache: query
                const web3Key = (asset.symbol === 'ETH_TEST' || asset.isErc20_Ropsten ? 'ETH_TEST' : 'ETH') + '_' + pollAddress
                if (dedicatedWeb3[web3Key] === undefined) {
                    const Web3 = require('web3')
                    
                    const wsSymbol = asset.symbol === 'ETH_TEST' || asset.isErc20_Ropsten ? 'ETH_TEST'
                                   : asset.symbol === 'ETH' || utilsWallet.isERC20(asset) ? 'ETH'
                                   : asset.symbol

                    dedicatedWeb3[web3Key] = new Web3(new Web3.providers.WebsocketProvider(configWS.geth_ws_config[wsSymbol].url)) 
                    //utilsWallet.debug('>> created dedicatedWeb3: OK.')
                }
                if (dedicatedWeb3[web3Key].currentProvider.connection.readyState != 1) {
                    dedicatedWeb3[web3Key].currentProvider.on("connect", function() { 
                        // ### buggy - race condition on closeDedicatedWeb3Socket()
                        // if (!dedicatedWeb3[web3Key]) {
                        //     debugger
                        // }
                        getTxDetails_web3(resolve, dedicatedWeb3[web3Key], wallet, asset, tx, cacheKey, ownAddresses, pollAddress)
                    })
                }
                else {
                    getTxDetails_web3(resolve, dedicatedWeb3[web3Key], wallet, asset, tx, cacheKey, ownAddresses, pollAddress)
                }
            }
        })
        .catch((err) => {
            debugger
            utilsWallet.logErr(err)
            utilsWallet.error('## enrichTx - error=', err)
            resolve(null)
        })
    })
}

function getTxDetails_web3(resolve, web3, wallet, asset, tx, cacheKey, ownAddresses, pollAddress) {
    const symbol = asset.symbol
    if (!web3) {
        utilsWallet.warn('getTxDetails_web3 - null web3!')
        resolve(null)
        return
    }

    // get tx
    utilsWallet.warn(`getTxDetails_web3 - ${symbol} ${tx.txid} calling web3 getTx...`)

    //self.geth_Sockets[symbol].send(`{"method":"eth_getTransactionByHash","params":["${tx.txid}"],"id":1,"jsonrpc":"2.0"}`)
    web3.eth.getTransaction(tx.txid)
    .then((txData) => {
        if (txData) {

            // get tx receipt
            web3.eth.getTransactionReceipt(tx.txid)
            .then((txReceipt) => {

                // get reverted status (usually will be due to erc20 gas too low)
                const txFailedReverted = txReceipt !== null && txReceipt !== undefined && !(txReceipt.status == '0x1' || txReceipt.status == 1)

                // get block (for timestamp)
                web3.eth.getBlock(txData.blockNumber) //Number(txData.blockNumber))
                .then((blockData) => {
                    if (blockData) {
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
                        const known_erc20 = known_erc20s.find(p => { return p.erc20_addr.toLowerCase() === txData.to.toLowerCase() })

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
                                            txFailedReverted
                                        }
                                        processAsEthTx = false
                                    }
                                }
                            }
                        }

                        if (processAsEthTx) { // ETH TX
                            const sendToSelf =
                                   ownAddresses.some(ownAddr => ownAddr.toLowerCase() === txData.to.toLowerCase())
                                && ownAddresses.some(ownAddr => ownAddr.toLowerCase() === txData.from.toLowerCase())

                            mappedTx = { // EXTERNAL_TX (enriched) - ETH 
                                     erc20: undefined,
                                      date: new Date(blockTimestamp * 1000), 
                                      txid: tx.txid,
                                 isMinimal: false,
                                isIncoming: !weAreSender, 
                                sendToSelf,
                                     value: Number(web3.utils.fromWei(txData.value, 'ether')),
                                  toOrFrom:  !weAreSender ? txData.from : txData.to,
                                account_to: txData.to.toLowerCase(), 
                              account_from: txData.from.toLowerCase(),
                                  block_no: txData.blockNumber, 
                                      fees: weAreSender
                                            ? Number((new BigNumber(txData.gas).div(new BigNumber(1000000000))).times((new BigNumber(txData.gasPrice).div(new BigNumber(1000000000)))))
                                            : 0,
                           txFailedReverted
                            }

                            // unknown (unsupported) erc20 transfer? e.g. 0x1d9018dd37fc010df2d20bf9151f3e25a34f1a55a125141faaa52386c872aa1b (airdrop AMB)
                            if (erc20_transferTo) {
                                mappedTx.account_to = erc20_transferTo
                                mappedTx.erc20_isUnsupported = true
                            }

                            // this condition is happening when we're involved in a nonstandard (non-payable fallback) TX, but we fail to decode an erc20 transfer() method;
                            // (e.g. 0x7d52ed1cc204d66b7f9b583c43db3e94bfbb019810cf45e72f8a47052e66eab9: "multisend()")
                            // the result is an unknown receiver (mappedTx.account_to: the non-standard erc20 contract addr)
                            const weAreSenderOrReceiver = weAreSender || ownAddresses.some(ownAddr => ownAddr.toLowerCase() === mappedTx.account_to.toLowerCase())
                            if (weAreSenderOrReceiver === false) {
                                mappedTx.account_to = pollAddress
                                mappedTx.isNonErc20_ContractParam = true
                            }
                        }

                        // we can fail to produce a mappedTx if we are excluding one specific erc20 in generateWallets() fn.
                        if (!mappedTx) {
                            //debugger
                            utilsWallet.warn(`** enrichTx - ${symbol} ${tx.txid} IGNORE-TX (no mappedTx)`)
                            resolve(null) // ### - perf: never gets cached -- TODO: return a minimal dodgy mappedTx, with a flag to exclude it from propagation to UI?
                            return
                        }

                        // add to cache
                        mappedTx.addedToCacheAt = new Date().getTime()
                        //utilsWallet.idb_tx.setItem(cacheKey, mappedTx)
                        utilsWallet.txdb_setItem(cacheKey, mappedTx)
                        .then(() => {
                            utilsWallet.log(`** enrichTx - ${symbol} ${tx.txid} - added to cache ok`)
                            mappedTx.fromCache = false

                            if (utilsWallet.isERC20(asset) && mappedTx.erc20 !== asset.symbol) {
                                utilsWallet.warn(`** enrichTx - ${symbol} ${tx.txid} IGNORE-TX (it's eth or another erc20) - mappedTx=`, mappedTx)
                                resolve(null) // ignore eth or unknown erc20 tx,when processing known erc20s
                            }
                            else {
                                resolve(mappedTx)
                            }
                        })
                        .catch((err) => {
                            //debugger
                            utilsWallet.logErr(err)
                            utilsWallet.error('## enrichTx - error writing cache=', err)
                            resolve(null)
                        })
                    }
                    else {
                        //debugger
                        utilsWallet.error(`enrichTx - no block data from web3`)
                        resolve(null)
                    }
                }) // getBlock 
                .catch(err => {
                    //debugger
                    utilsWallet.error(`## getBlock FAIL 1 - tx.txid=${tx.txid}, err=`, err)
                    resolve(null)
                })
            }) // getTransactionReceipt
            .catch(err => {
                //debugger
                utilsWallet.error(`## getTransactionReceipt FAIL 1 - tx.txid=${tx.txid}, err=`, err)
                resolve(null)
            })
        }
        else {
            //debugger
            utilsWallet.error(`enrichTx - no tx data from web3`)
            resolve(null)
        }
    }) // getTransaction
    .catch(err => {
        //debugger
        utilsWallet.error(`## getTransaction FAIL 1 - tx.txid=${tx.txid}, err=`, err)
        resolve(null)
    })
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

            if (self.ws_web3[symbol] && self.ws_web3[symbol].currentProvider.connection.readyState != 1) {
                self.ws_web3[symbol] = undefined 
            }

            const web3 = self.ws_web3[symbol] || new Web3(new Web3.providers.HttpProvider(configExternal.walletExternal_config[symbol].httpProvider))
            web3.eth.getBalance(address)
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

            if (self.ws_web3[wsSymbol] && self.ws_web3[wsSymbol].currentProvider.connection.readyState != 1) {
                self.ws_web3[wsSymbol] = undefined 
            }
            
            const web3 = self.ws_web3[wsSymbol] || new Web3(new Web3.providers.HttpProvider(configExternal.walletExternal_config[symbol].httpProvider))
            const tknAddress = (address).substring(2)
            const contractData = ('0x70a08231000000000000000000000000' // balanceOf
                                + tknAddress)                          // (address)
            const contractAddress = configExternal.walletExternal_config[symbol].contractAddress
            web3.eth.call({
                to: contractAddress,
                data: contractData
            },
            web3.eth.defaultBlock,
                (err, result) => {
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
                        const web3 = self.ws_web3 || new Web3(new Web3.providers.HttpProvider(configExternal.walletExternal_config[symbol].httpProvider))

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