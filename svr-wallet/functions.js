'use strict';

const Keygen = require('eosjs-keygen').KeyGgen
const BigNumber = require('bignumber.js')
const MD5 = require('crypto-js').MD5
const _ = require('lodash')

const { Worker, isMainThread, parentPort } = require('worker_threads')

const configWallet = require('../config/wallet')
const walletActions = require('../actions/wallet')
const utilsWallet = require('../utils')

const opsWallet = require('../actions/wallet')

const log = require('../cli-log')

module.exports = {
    dump: (appWorker, store, p) => {
        var { mpk, apk, s, tx } = p

        debugger

        // extract filter symbol, if any
        var filterSymbol
        if (s && s.length > 0) {
            filterSymbol = s
            log.info(`  s: ${filterSymbol} (param)`)
        }

        // dump tx's, if specified
        var dumpTxs = false
        if (utilsWallet.isParamTrue(tx)) {
            dumpTxs = true
            log.info(` tx: ${tx} (param)`)
        }
        
        const h_mpk = utilsWallet.pbkdf2(apk, mpk)
        const wallet = store.getState().wallet
    
        // decrypt raw assets (private keys) from the store
        var pt_assetsJson
        try {
            pt_assetsJson = utilsWallet.aesDecryption(apk, h_mpk, wallet.assetsRaw)
        }
        catch(err) {
            return new Promise((resolve) => resolve({ err: `decrypt failed (${err.message} - MPK and APK are probably incorrect` }))
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

    connectData: (appWorker, store, p) => {
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
    }
}
