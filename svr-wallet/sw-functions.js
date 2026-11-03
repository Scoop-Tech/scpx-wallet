// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2025 Dominic Morris.

const _ = require('lodash')

const configWallet = require('../config/wallet')
const configExternal  = require('../config/wallet-external')
const opsWallet = require('../actions/wallet')
const walletExternal = require('../actions/wallet-external')
const utilsWallet = require('../utils')

const log = require('../sw-cli-log')

// Blockbook/geth socket symbols for the LOADED wallet (its own assets); before a wallet is loaded: the core asset list
async function walletSocketSymbols(store) {
    const state = store && store.getState ? store.getState() : undefined
    if (state && state.wallet && state.wallet.assets && state.wallet.assets.length > 0) {
        return _.uniq(state.wallet.assets.map(p => p.symbol))
    }
    return (await configWallet.getSupportedWalletTypes()).filter(p => configWallet.isCoreAssetMetaKey(p)).map(p => configWallet.walletsMeta[p].symbol)
}

// fetch-health of an asset: a backend outage must never read as a real 0 balance.
//   balance === undefined -> never successfully fetched (unknown: dumped as null, not "0")
//   fetchError            -> last fetch attempt failed (balance, if any, is stale)
function addrBalanceKnown(a_n) { return a_n.balance !== undefined && a_n.unconfirmedBalance !== undefined }
function assetFetchHealth(asset, bal) {
    const errAddrs = asset.addresses.filter(p => p.fetchError !== undefined)
    return {
                fetchError: errAddrs.length > 0 ? errAddrs.map(p => `${p.addr}: ${p.fetchError}`).join('; ') : undefined,
          hasAddressErrors: bal ? bal.hasAddressErrors === true : errAddrs.length > 0,
       allAddressesFetched: bal ? bal.allAddressesFetched === true : false,
              balanceKnown: asset.addresses.every(addrBalanceKnown),
         lastAssetUpdateAt: asset.lastAssetUpdateAt,
    }
}

//
// general wallet functions
//

module.exports = {
    
    // connects 3PBP sockets, and requests initial load for all assets in the current wallet
    walletConnect: async (appWorker, store, p) => {
        log.cmd('walletConnect')

        return new Promise( async (resolve) => {
            appWorker.postMessageWrapped({ msg: 'INIT_WEB3_SOCKET', data: {} })
            //appWorker.postMessageWrapped({ msg: 'INIT_INSIGHT_SOCKETIO', data: {} }) // INSIGHT: OBSOLETE / NOT USED ANY MORE
            
            const listener = function(event) {
                var input = utilsWallet.unpackWorkerResponse(event)
                if (input) {
                    const data = input.data
                    const msg = input.msg
                    // only OUR reply: the periodic volatile-socket reinit also posts BLOCKBOOK_ISOSOCKETS_DONE (walletFirstPoll=false),
                    // typically with nothing connected (dead feeds) - taking that one left this promise pending forever
                    if (msg === 'BLOCKBOOK_ISOSOCKETS_DONE' && data && data.walletFirstPoll === true) {
                        
                        //log.info('data=', data)
                        //log.info('BLOCKBOOK_ISOSOCKETS_DONE: data.symbolsConnected=', data.symbolsConnected)
                        //log.info('BLOCKBOOK_ISOSOCKETS_DONE: data.symbolsNotConnected=', data.symbolsNotConnected)

                        const storeState = store.getState()
                        if (storeState.wallet && storeState.wallet.assets) {
                            // connect addr monitors & populate all assets
                            appWorker.postMessageWrapped({ msg: 'DISCONNECT_ADDRESS_MONITORS', data: { wallet: storeState.wallet } })
                            appWorker.postMessageWrapped({ msg: 'CONNECT_ADDRESS_MONITORS', data: { wallet: storeState.wallet } })
                            
                            if (!data.aborted) {
                                // load even if no socket is ready yet: loadAllAssets retries assets whose socket wasn't open
                                // (previously no else-branch: an empty symbolsConnected left this promise pending forever)
                                log.info('walletConnect - triggering loadAllAsets...')
                                opsWallet.loadAllAssets({ bbSymbols_SocketReady: data.symbolsConnected || [], store })
                                .then(p => {
                                    resolve({ ok: true })
                                })
                                .catch(err => { log.error(err); resolve({ ok: false }) })
                            }
                            else {
                                resolve({ ok: false, err: 'walletConnect aborted (disconnect requested)' })
                            }
                        }
                        else {
                            resolve({ ok: false })
                        }
                        
                        appWorker.removeEventListener('message', listener)
                    }
                }
            }
            appWorker.addEventListener('message', listener)
    
            //const walletSymbols = ['BTC']
            // feb '24 - only load core assets (= the loaded wallet's assets)
            const walletSymbols = await walletSocketSymbols(store)
            utilsWallet.log('walletSymbols=', walletSymbols)
            appWorker.postMessageWrapped({ msg: 'INIT_BLOCKBOOK_ISOSOCKETS', data: { walletSymbols, timeoutMs: configWallet.SOCKET_TIMEOUT_MS, walletFirstPoll: true } })
            appWorker.postMessageWrapped({ msg: 'INIT_GETH_ISOSOCKETS', data: { walletSymbols } })
            
            // volatile sockets reconnect / keep-alive timer
            log.info(`walletConnect - setting volatile sockets reconnector...`)
            const globalScope = utilsWallet.getMainThreadGlobalScope()
            // one reconnect timer per process: each walletConnect (re-login, wallet switch) used to add another, never cleared
            if (globalScope.volatileSockets_intId) clearInterval(globalScope.volatileSockets_intId)
            globalScope.volatileSockets_intId = setInterval(async () => {
                if (globalScope.appWorker) {
                    try {
                        // walletSymbols MUST be inside `data` (the worker reads data.walletSymbols): it used to be posted outside it,
                        // so every reconnect opened sockets for every configured Blockbook (BTC legacy, LTC, DASH, DGB - not in the wallet)
                        const walletSymbols = await walletSocketSymbols(store)
                        //console.log('walletSymbols (setInterval)=', walletSymbols)
                        globalScope.appWorker.postMessageWrapped({ msg: 'INIT_BLOCKBOOK_ISOSOCKETS', data: { walletSymbols, timeoutMs: configWallet.SOCKET_TIMEOUT_MS } })
                        globalScope.appWorker.postMessageWrapped({ msg: 'INIT_GETH_ISOSOCKETS', data: { walletSymbols } })
                    }
                    catch(err) {
                        utilsWallet.warn(err)
                    }
                }
            }, configWallet.VOLATILE_SOCKETS_REINIT_SECS * 1000)
    
        })
    },

    // dumps current wallet asset data
    walletDump: (appWorker, store, p) => {
        var { mpk, apk, symbol, addr, txs, keys, txid, } = p
        const h_mpk = utilsWallet.pbkdf2(apk, mpk)
        const state = store.getState()
        const wallet = state.wallet
        const syncInfo = state.syncInfo
        log.cmd('walletDump')

        // params
        const filterSymbol = symbol && symbol.length > 0 ? symbol : undefined
        const filterAddr = addr && addr.length > 0 ? addr : undefined
        const dumpTxs = utilsWallet.isParamTrue(txs)
        const dumpPrivKeys = utilsWallet.isParamTrue(keys)
        const dumpTxid = txid && txid.length > 0 ? txid : undefined
        log.param('mpk', '[secure]')
        log.param('symbol', filterSymbol)
        log.param('addr', filterAddr)
        log.param('txs', dumpTxs)
        log.param('keys', dumpPrivKeys)
        log.param('txid', dumpTxid)

        // decrypt raw assets (private keys) from the store
        var pt_rawAssets = utilsWallet.aesDecryption(apk, h_mpk, wallet.assetsRaw)
        if (!pt_rawAssets) return Promise.resolve({ err: `Decrypt failed - MPK is probably incorrect` })
        var pt_rawAssetsObj = JSON.parse(pt_rawAssets)
    
        // match privkeys to addresses by HD path in the displayable assets (unencrypted) store 
        var dumpOut = []
        Object.keys(pt_rawAssetsObj).forEach(assetName => {
            const meta = configWallet.walletsMeta[assetName]
            const walletAsset = wallet.assets.find(p => p.symbol === meta.symbol)

            const bal = walletExternal.get_combinedBalance(walletAsset, -1)
            const health = assetFetchHealth(walletAsset, bal)
            var addrNdx = 0
            const assetOut = { 
                assetName,
                accounts: null,
                syncInfo: syncInfo[meta.symbol],
                isReadOnly: configWallet.isReadOnlyAsset(walletAsset) || undefined,

                // fetch health: never read a backend outage as a 0 balance (du_bal* are null when never fetched)
                fetchError: health.fetchError,
                hasAddressErrors: health.hasAddressErrors,
                allAddressesFetched: health.allAddressesFetched,
                lastAssetUpdateAt: health.lastAssetUpdateAt,

                // addresses
                addresses: walletAsset.addresses.map(a_n => { 
                    const addrBal = walletExternal.get_combinedBalance(walletAsset, addrNdx)
                    //const all_txs = walletExternal.getAll_txs(walletAsset)
                    //const protect_op_tx = a_n.nonStd_protectOp_txid ? all_txs.find(p2 => p2.txid == a_n.nonStd_protectOp_txid) : undefined
                    const known = addrBalanceKnown(a_n)
                    return { 
                               ndx: addrNdx++,
                              addr: a_n.addr, 
                              path: a_n.path,
                   protect_op_txid: a_n.nonStd_protectOp_txid,
                   //protect_op_tx,
                        du_balConf: known ? utilsWallet.toDisplayUnit(addrBal.conf, walletAsset) : null,
                      du_balUnconf: known ? utilsWallet.toDisplayUnit(addrBal.unconf, walletAsset) : null,
                        fetchError: a_n.fetchError,
                   lastAddrFetchAt: a_n.lastAddrFetchAt,
                           //utxos: a_n.utxos,
                }}),
                
                countAll_txs: walletExternal.getAll_txs(walletAsset).length,
                all_txs: dumpTxs || dumpTxid ? walletExternal.getAll_txs(walletAsset) : undefined,
                
                countAll_local_txs: walletExternal.getAll_local_txs(walletAsset).length,
                local_txs: dumpTxs || dumpTxid ? walletExternal.getAll_local_txs(walletAsset) : undefined,
                
                countAll_unconfirmed_txs: walletExternal.getAll_unconfirmed_txs(walletAsset).length,
                unconfirmed_txs: dumpTxs || dumpTxid ? walletExternal.getAll_unconfirmed_txs(walletAsset) : undefined,

                du_balConf: health.balanceKnown ? utilsWallet.toDisplayUnit(bal.conf, walletAsset) : null,
                du_balUnconf: health.balanceKnown ? utilsWallet.toDisplayUnit(bal.unconf, walletAsset) : null,
            }
            if (dumpTxid) {
                assetOut.all_txs = assetOut.all_txs.filter(p => p.txid == dumpTxid)
                assetOut.local_txs = assetOut.local_txs.filter(p => p.txid == dumpTxid)
                assetOut.all_txs = assetOut.all_txs.filter(p => p.txid == dumpTxid)
            }
            if (filterAddr) {
                assetOut.addresses = assetOut.addresses.filter(p => p.addr == filterAddr)
            }
            
            const accountsOut = []
            pt_rawAssetsObj[assetName].accounts.forEach(account => {
                const accountOut = {
                    accountName: account.name,
                }

                var keysOut = []
                account.privKeys.forEach(privKey => { // ##
                    const pathKeyAddr = {
                             path: privKey.path,
                          privKey: privKey.privKey,
                    }

                    if (filterSymbol === undefined || filterSymbol.toLowerCase() === meta.symbol.toLowerCase()) {
                        // get corresponding addr, lookup by HD path
                        const walletAddr = walletAsset.addresses.find(p => p.path === privKey.path)

                        pathKeyAddr.symbol = meta.symbol
                        pathKeyAddr.addr = _.cloneDeep(walletAddr)
                        pathKeyAddr.addr.explorerPath = configExternal.walletExternal_config[meta.symbol].explorerPath(walletAddr.addr)
                        pathKeyAddr.addr.utxoCount = pathKeyAddr.addr.utxos.length
                        if (!dumpTxs) {
                            delete pathKeyAddr.addr.txs
                            delete pathKeyAddr.addr.utxos
                        }
                        else {
                            pathKeyAddr.addr.txs.forEach(tx => {
                                tx.txExplorerPath = configExternal.walletExternal_config[meta.symbol].txExplorerPath(tx.txid)
                            })
                        }
                        if (!dumpPrivKeys) {
                            pathKeyAddr.privKey = undefined
                        }
                        
                        keysOut.push(pathKeyAddr)
                    }
                })
                if (keysOut.length > 0) {
                    accountOut.keys = keysOut
                    accountsOut.push(accountOut)
                }
            })
            if (accountsOut.length > 0) {
                assetOut.accounts = accountsOut
                dumpOut.push(assetOut)
            }
        })
    
        utilsWallet.softNuke(pt_rawAssets)
        utilsWallet.softNuke(pt_rawAssetsObj)
    
        return new Promise((resolve) => {
            resolve({ ok: dumpOut })
        })
    },

    // displays combined balances (for all addresses) 
    walletBalance: (appWorker, store, p) => {
        var { symbol } = p
        log.cmd('walletBalance')

        // validate
        const wallet = store.getState().wallet
        if (!utilsWallet.isParamEmpty(symbol)) { 
            const asset = wallet.assets.find(p => p.symbol.toLowerCase() === symbol.toLowerCase())
            if (!asset) return Promise.resolve({ err: `Invalid asset symbol "${symbol}"` })
        }

        // non-zero balances, PLUS every asset whose fetch failed or never completed (with the error): a backend outage must
        // never read as "no balance". fetchErrors lists them all (empty when every queried asset fetched OK).
        const fetchErrors = []
        const balances = wallet.assets
        .filter(p => utilsWallet.isParamEmpty(symbol) || p.symbol.toLowerCase() === symbol.toLowerCase())
        .map(asset => {
            const bal = walletExternal.get_combinedBalance(asset)
            const health = assetFetchHealth(asset, bal)
            const unhealthy = health.hasAddressErrors || !health.balanceKnown
            if (unhealthy) {
                asset.addresses.filter(p => p.fetchError !== undefined || !addrBalanceKnown(p)).forEach(p => {
                    fetchErrors.push({ symbol: asset.symbol, addr: p.addr, error: p.fetchError !== undefined ? String(p.fetchError) : 'balance not fetched (yet)' })
                })
            }
            if (bal.conf > 0 || bal.unconf > 0 || unhealthy) {
                const ret = {
                    symbol: asset.symbol,
                      conf: health.balanceKnown ? utilsWallet.toDisplayUnit(bal.conf, asset) : null,
                    unconf: health.balanceKnown ? utilsWallet.toDisplayUnit(bal.unconf, asset) : null,
                }
                if (unhealthy) {
                    ret.fetchError = health.fetchError || 'balance not fetched (yet)'
                    ret.hasAddressErrors = health.hasAddressErrors
                    ret.allAddressesFetched = health.allAddressesFetched
                }
                var addrNdx = 0
                ret.addresses = asset.addresses.map(p => { 
                    const addrBal = walletExternal.get_combinedBalance(asset, addrNdx)
                    const known = addrBalanceKnown(p)
                    return { 
                         ndx: addrNdx++,
                        addr: p.addr, 
                  du_balConf: known ? utilsWallet.toDisplayUnit(addrBal.conf, asset) : null,
                du_balUnconf: known ? utilsWallet.toDisplayUnit(addrBal.unconf, asset) : null,
                  fetchError: p.fetchError,
                }})
                return ret
            }
            else return null
        })
        .filter(p => p !== null)
        return Promise.resolve({ ok: { balances, fetchErrors } })
    }
}
