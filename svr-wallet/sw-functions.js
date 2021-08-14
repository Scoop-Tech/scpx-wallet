// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2021 Dominic Morris.

const _ = require('lodash')

const configWallet = require('../config/wallet')
const configExternal  = require('../config/wallet-external')
const opsWallet = require('../actions/wallet')
const walletExternal = require('../actions/wallet-external')
const utilsWallet = require('../utils')

const log = require('../sw-cli-log')

//
// general wallet functions
//

module.exports = {
    
    // connects 3PBP sockets, and requests initial load for all assets in the current wallet
    walletConnect: async (appWorker, store, p) => {
        log.cmd('walletConnect')

        return new Promise( (resolve) => {
            appWorker.postMessageWrapped({ msg: 'INIT_WEB3_SOCKET', data: {} })
            appWorker.postMessageWrapped({ msg: 'INIT_INSIGHT_SOCKETIO', data: {} })
            
            const listener = function(event) {
                var input = utilsWallet.unpackWorkerResponse(event)
                if (input) {
                    const data = input.data
                    const msg = input.msg
                    if (msg === 'BLOCKBOOK_ISOSOCKETS_DONE') {
                        
                        //log.info('data=', data)
                        //log.info('BLOCKBOOK_ISOSOCKETS_DONE: data.symbolsConnected=', data.symbolsConnected)
                        //log.info('BLOCKBOOK_ISOSOCKETS_DONE: data.symbolsNotConnected=', data.symbolsNotConnected)

                        const storeState = store.getState()
                        if (storeState.wallet && storeState.wallet.assets) {
                            // connect addr monitors & populate all assets
                            appWorker.postMessageWrapped({ msg: 'DISCONNECT_ADDRESS_MONITORS', data: { wallet: storeState.wallet } })
                            appWorker.postMessageWrapped({ msg: 'CONNECT_ADDRESS_MONITORS', data: { wallet: storeState.wallet } })
                            
                            if (data.symbolsConnected.length > 0) {
                                log.info('walletConnect - triggering loadAllAsets...')
                                opsWallet.loadAllAssets({ bbSymbols_SocketReady: data.symbolsConnected, store })
                                .then(p => {
                                    resolve({ ok: true })
                                })
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
    
            appWorker.postMessageWrapped({ msg: 'INIT_BLOCKBOOK_ISOSOCKETS', data: { timeoutMs: configWallet.VOLATILE_SOCKETS_REINIT_SECS * 0.75 * 1000, walletFirstPoll: true } })
            appWorker.postMessageWrapped({ msg: 'INIT_GETH_ISOSOCKETS', data: {} })
            
            // volatile sockets reconnect / keep-alive timer
            log.info(`walletConnect - setting volatile sockets reconnector...`)
            const globalScope = utilsWallet.getMainThreadGlobalScope()
            globalScope.volatileSockets_intId = setInterval(() => {
                if (globalScope.appWorker) {
                    try {
                        globalScope.appWorker.postMessageWrapped({ msg: 'INIT_BLOCKBOOK_ISOSOCKETS', data: { timeoutMs: configWallet.VOLATILE_SOCKETS_REINIT_SECS * 0.75 * 1000 } })
                        globalScope.appWorker.postMessageWrapped({ msg: 'INIT_GETH_ISOSOCKETS', data: {} })
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
        var { mpk, apk, symbol, txs, keys, txid } = p
        const h_mpk = utilsWallet.pbkdf2(apk, mpk)
        const state = store.getState()
        const wallet = state.wallet
        const syncInfo = state.syncInfo
        log.cmd('walletDump')

        // params
        const filterSymbol = symbol && symbol.length > 0 ? symbol : undefined
        const dumpTxs = utilsWallet.isParamTrue(txs)
        const dumpPrivKeys = utilsWallet.isParamTrue(keys)
        const dumpTxid = txid && txid.length > 0 ? txid : undefined
        log.param('mpk', process.env.NODE_ENV === 'test' ? '[secure]' : mpk)
        log.param('symbol', filterSymbol)
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
            var addrNdx = 0
            const assetOut = { 
                assetName,
                accounts: null,
                syncInfo: syncInfo[meta.symbol],

                // addresses
                addresses: walletAsset.addresses.map(a_n => { 
                    const addrBal = walletExternal.get_combinedBalance(walletAsset, addrNdx)
                    //const all_txs = walletExternal.getAll_txs(walletAsset)
                    //const protect_op_tx = a_n.nonStd_protectOp_txid ? all_txs.find(p2 => p2.txid == a_n.nonStd_protectOp_txid) : undefined
                    return { 
                               ndx: addrNdx++,
                              addr: a_n.addr, 
                              path: a_n.path,
                   protect_op_txid: a_n.nonStd_protectOp_txid,
                   //protect_op_tx,
                        du_balConf: utilsWallet.toDisplayUnit(addrBal.conf, walletAsset),
                      du_balUnconf: utilsWallet.toDisplayUnit(addrBal.unconf, walletAsset),
                }}),
                
                countAll_txs: walletExternal.getAll_txs(walletAsset).length,
                all_txs: dumpTxs || dumpTxid ? walletExternal.getAll_txs(walletAsset) : undefined,
                
                countAll_local_txs: walletExternal.getAll_local_txs(walletAsset).length,
                local_txs: dumpTxs || dumpTxid ? walletExternal.getAll_local_txs(walletAsset) : undefined,
                
                countAll_unconfirmed_txs: walletExternal.getAll_unconfirmed_txs(walletAsset).length,
                unconfirmed_txs: dumpTxs || dumpTxid ? walletExternal.getAll_unconfirmed_txs(walletAsset) : undefined,

                du_balConf: utilsWallet.toDisplayUnit(bal.conf, walletAsset),
                du_balUnconf: utilsWallet.toDisplayUnit(bal.unconf, walletAsset),
            }
            if (dumpTxid) {
                assetOut.all_txs = assetOut.all_txs.filter(p => p.txid == dumpTxid)
                assetOut.local_txs = assetOut.local_txs.filter(p => p.txid == dumpTxid)
                assetOut.all_txs = assetOut.all_txs.filter(p => p.txid == dumpTxid)
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

        const balances = wallet.assets
        .filter(p => utilsWallet.isParamEmpty(symbol) || p.symbol.toLowerCase() === symbol.toLowerCase())
        .map(asset => {
            const bal = walletExternal.get_combinedBalance(asset)
            if (bal.conf > 0 || bal.unconf > 0) {
                const ret = {
                    symbol: asset.symbol,
                      conf: utilsWallet.toDisplayUnit(bal.conf, asset),
                    unconf: utilsWallet.toDisplayUnit(bal.unconf, asset)
                }
                var addrNdx = 0
                ret.addresses = asset.addresses.map(p => { 
                    const addrBal = walletExternal.get_combinedBalance(asset, addrNdx)
                    return { 
                         ndx: addrNdx++,
                        addr: p.addr, 
                  du_balConf: utilsWallet.toDisplayUnit(addrBal.conf, asset),
                du_balUnconf: utilsWallet.toDisplayUnit(addrBal.unconf, asset),
                }})
                return ret
            }
            else return null
        })
        .filter(p => p !== null)
        return Promise.resolve({ ok: { balances } })
    }
}
