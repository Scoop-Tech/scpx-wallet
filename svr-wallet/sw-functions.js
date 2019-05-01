// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.

const _ = require('lodash')

const configWallet = require('../config/wallet')
const walletActions = require('../actions/wallet')
const walletExternalActions = require('../actions/wallet-external')
const utilsWallet = require('../utils')

const opsWallet = require('../actions/wallet')

const log = require('../cli-log')

//
// general wallet functions
//

module.exports = {
    
    // connects 3PBP sockets, and requests initial load for all assets in the current wallet
    connectData: (appWorker, store, p) => {
        log.cmd('connectData')

        return new Promise((resolve) => {
    
            appWorker.postMessage({ msg: 'INIT_WEB3_SOCKET', data: {} })
            appWorker.postMessage({ msg: 'INIT_INSIGHT_SOCKETIO', data: {} })
            
            function blockbookListener(event) {
                if (event && event.data && event.msg) {
                    const data = event.data
                    const msg = event.msg
    
                    if (msg === 'BLOCKBOOK_ISOSOCKETS_DONE') {
                        const storeState = store.getState()
                        if (storeState.wallet && storeState.wallet.assets) {
                            appWorker.postMessage({ msg: 'DISCONNECT_ADDRESS_MONITORS', data: { wallet: storeState.wallet } })
    
                            appWorker.postMessage({ msg: 'CONNECT_ADDRESS_MONITORS', data: { wallet: storeState.wallet } })
    
                            walletActions.loadAllAssets({ bbSymbols_SocketReady: data.symbolsConnected, store })
                            .then(p => {
                                resolve({ ok: true })
                            })
                        }
                        else {
                            resolve({ ok: false })
                        }
    
                        appWorker.removeListener('message', blockbookListener)
                    }
                }
            }
            appWorker.on('message', blockbookListener)
    
            appWorker.postMessage({ msg: 'INIT_BLOCKBOOK_ISOSOCKETS', data: { timeoutMs: configWallet.VOLATILE_SOCKETS_REINIT_SECS * 0.75 * 1000, walletFirstPoll: true } })
            appWorker.postMessage({ msg: 'INIT_GETH_ISOSOCKETS', data: {} }) 
            var volatileReInit_intId = setInterval(() => {
                appWorker.postMessage({ msg: 'INIT_BLOCKBOOK_ISOSOCKETS', data: { timeoutMs: configWallet.VOLATILE_SOCKETS_REINIT_SECS * 0.75 * 1000 } })
                appWorker.postMessage({ msg: 'INIT_GETH_ISOSOCKETS', data: {} })
            }, configWallet.VOLATILE_SOCKETS_REINIT_SECS * 1000)
    
        })
    },

    // dumps current wallet asset data
    walletDump: (appWorker, store, p) => {
        var { mpk, apk, s, txs, privkeys } = p
        log.cmd('walletDump')
        log.param(`mpk`, mpk, `(param)`)
        log.param(`apk`, apk, `(param)`)

        // extract filter symbol, if any
        var filterSymbol
        if (s && s.length > 0) {
            filterSymbol = s
            log.param(`s`, filterSymbol, `(param)`)
        }

        // dump tx's, if specified
        var dumpTxs = false
        if (utilsWallet.isParamTrue(txs)) {
            dumpTxs = true
            log.param(`tx`, dumpTxs, `(param)`)
        }

        // dump privkeys, if specified
        var dumpPrivKeys = false
        if (utilsWallet.isParamTrue(privkeys)) {
            dumpPrivKeys = true
            log.param(`privkeys`, dumpPrivKeys, `(param)`)
        }
        
        const h_mpk = utilsWallet.pbkdf2(apk, mpk)
        const wallet = store.getState().wallet
    
        // decrypt raw assets (private keys) from the store
        var pt_assetsJson
        try {
            pt_assetsJson = utilsWallet.aesDecryption(apk, h_mpk, wallet.assetsRaw)
        }
        catch (err) {
            return new Promise((resolve) => resolve({ err: `Decrypt failed (${err.message} - MPK and APK are probably incorrect` }))
        }
        var pt_assetsObj = JSON.parse(pt_assetsJson)
    
        // match privkeys to addresses by HD path in the displayable assets (unencrypted) store 
        var allPathKeyAddrs = []
        Object.keys(pt_assetsObj).forEach(assetName => {
            pt_assetsObj[assetName].accounts.forEach(account => {
                account.privKeys.forEach(privKey => {
                    var pathKeyAddr = {
                        assetName,
                        path: privKey.path,
                        privKey: privKey.privKey,
                    }
                    const meta = configWallet.walletsMeta[assetName]
    
                    // get corresponding addr, lookup by HD path
                    const walletAsset = wallet.assets.find(p => p.symbol === meta.symbol)
                    const walletAddr = walletAsset.addresses.find(p => p.path === privKey.path)
    
                    pathKeyAddr.symbol = meta.symbol
                    pathKeyAddr.accountName = walletAddr.accountName
                    pathKeyAddr.addr = _.cloneDeep(walletAddr)

                    if (!dumpTxs) {
                        delete pathKeyAddr.addr.txs
                        delete pathKeyAddr.addr.utxos
                    }
                    if (!dumpPrivKeys) {
                        delete pathKeyAddr.addr.privKey
                    }
                    
                    if (filterSymbol === undefined || filterSymbol.toLowerCase() === meta.symbol.toLowerCase()) {
                        allPathKeyAddrs.push(pathKeyAddr)
                    }
                })
            })
        })
    
        utilsWallet.softNuke(pt_assetsJson)
        utilsWallet.softNuke(pt_assetsObj)
    
        return new Promise((resolve) => {
            resolve({ ok: allPathKeyAddrs })
        })
    },

    // adds a sub-asset receive address
    walletAddAddress: async (appWorker, store, p) => {
        var { mpk, apk, s } = p
        log.cmd('walletAddAddress')
        log.param(`mpk`, mpk, `(param)`)
        log.param(`apk`, apk, `(param)`)
        
        // validate
        const wallet = store.getState().wallet
        if (!s) return new Promise((resolve) => resolve({ err: `Asset symbol is required` }))
        const asset = wallet.assets.find(p => p.symbol.toLowerCase() === s.toLowerCase())
        if (!asset) return new Promise((resolve) => resolve({ err: `Invalid asset symbol "${s}"` }))
        log.param(`s`, asset.symbol, `(param)`)

        const h_mpk = utilsWallet.pbkdf2(apk, mpk)
        log.param(`h_mpk`, h_mpk, `(hased MPK)`)

        // exec
        return opsWallet.generateNewAddress({
                    store: store,
             activePubKey: apk,
                    h_mpk: h_mpk,
                assetName: asset.name,
          userAccountName: undefined, // no EOS persistence for server wallets - not required
                  e_email: undefined, // no EOS persistence for server wallets - not required
          eosActiveWallet: undefined, // todo
        })
        .then(generateNewAddressResult => {

            // (re)connect addr monitors
            // return module.exports.connectData(appWorker, store, p)
            // .then(connectDataResult => {
            //     return new Promise((resolve) => resolve({ ok: { generateNewAddressResult, connectDataResult } } ))
            // })
            return new Promise((resolve) => resolve({ ok: { generateNewAddressResult } } ))
        })
        .catch(err => {
            return new Promise((resolve) => resolve({ err: err.message || err.toString() } ))
        })
    },

    // displays combined balances (for all addresses) 
    walletBalance: (appWorker, store, p) => {
        var { s } = p
        log.cmd('walletBalance')
        
        const wallet = store.getState().wallet
        if (wallet.assets.some(p => !p.lastAssetUpdateAt)) {
            return new Promise((resolve) => resolve({ err: 
                `One or more assets' balance data has not yet been loaded. Have you connected the wallet with ".wc"?`
            }))
        }

        const balances = wallet.assets.map(asset => {
            const bal = walletExternalActions.get_combinedBalance(asset)
            return {
                symbol: asset.symbol,
                  conf: utilsWallet.toDisplayUnit(bal.conf, asset),
                unconf: utilsWallet.toDisplayUnit(bal.unconf, asset)
            }
        })
        return new Promise((resolve) => resolve({ ok: { balances } } ))
    }
}
