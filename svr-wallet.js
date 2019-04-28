'use strict';

const Keygen = require('eosjs-keygen').KeyGgen
const BigNumber = require('bignumber.js')
const MD5 = require('crypto-js').MD5

const { Worker, isMainThread, parentPort } = require('worker_threads')

const configWallet = require('./config/wallet')
const walletActions = require('./actions/wallet')
const utilsWallet = require('./utils')

const opsWallet = require('./actions/wallet')

const log = require('./cli-log')

// loaded wallet apk and mpk are into this object
var loadedWalletKeys = {}

module.exports = {

    walletNew: (store) => {
        //const emailEntropyBase36 = new BigNumber(BigNumber.random(80).times(1e80).toFixed()).toString(36)
    
        return Keygen.generateMasterKeys()
        .then(keys => {
            const res = walletLoad(store, { 
                mpk: keys.masterPrivateKey,
                apk: keys.publicKeys.active,
              //email: `s+${emailEntropyBase36}@scoop.tech`
            })
            return res
        })
    },
    
     walletLoad: async (store, p) => {
        var { mpk, apk } = p
        
        // if (!apk || apk.length < 53) {
        //     const newKeys = await Keygen.generateMasterKeys()
        //     apk = newKeys.publicKeys.active
        //     log.info(`No APK or invalid APK supplied - new random from eosjs-keygen: ${apk}`)
        // }
    
        const invalidMpkApk = validateMpkApk(mpk, apk)
        if (invalidMpkApk) return invalidMpkApk
        log.info(`  mpk: ${mpk}\t\t\t(param)`)
        log.info(`  apk: ${apk}\t\t\t(param)`)
    
        const h_mpk = utilsWallet.pbkdf2(apk, mpk)
        //const e_email = utilsWallet.aesEncryption(apk, h_mpk, email)
        //const md5_email = MD5(email).toString()
    
        log.info(`h_mpk: ${h_mpk}\t(hased MPK)`)
        log.info(`  apk: ${apk}\t\t\t(active public key)`)
    
        return opsWallet.generateWallets({
                    store: store,
             activePubKey: apk,
                    h_mpk: h_mpk,
          userAccountName: undefined, // no EOS persistence for server wallets - not required
                  e_email: undefined, // no EOS persistence for server wallets - not required
           e_serverAssets: undefined, // new account
          eosActiveWallet: undefined, // TODO -- REMOVE THIS (or handle it properly -- maybe by key import only to start with?)
        callbackProcessed: (ret, totalReqCount) => {}
        })
        .then(res => {
            
            if (configWallet.CLI_SAVE_LOADED_WALLET_KEYS === true) {
                loadedWalletKeys = { mpk, apk }
                log.info('* Cached MPK & APK *')
                return { ok: { "wallet-load": `.wl --mpk ${mpk} --apk ${apk}`,
                               "wallet-dump": `.wd` } }
            }
            else {
                return { ok: { "wallet-load": `.wl --mpk ${mpk} --apk ${apk}`,
                               "wallet-dump": `.wd --mpk ${mpk} --apk ${apk}` } }
            }
        })
        .catch(err => {
            return { err: err.message || err.toString() }
        })
    },
    
    walletDump: async (store, p) => {
        var { mpk, apk, s } = p
    
        // take apk/mpk from cache if present and not on cmdline
        if (loadedWalletKeys.mpk && !mpk) { 
            mpk = loadedWalletKeys.mpk
            log.info(`mpk: ${mpk} (cache)`)
        }
        else log.info(`mpk: ${mpk} (param)`)
    
        if (loadedWalletKeys.apk && !apk) {
            apk = loadedWalletKeys.apk
            log.info(`apk: ${apk} (cache)`)
        }
        else log.info(`apk: ${apk} (param)`)
        
        const invalidMpkApk = validateMpkApk(mpk, apk)
        if (invalidMpkApk) return invalidMpkApk
    
        // extract filter symbol, if any
        var filterSymbol
        if (s && s.length > 0) {
            filterSymbol = s
            log.info(`  s: ${filterSymbol} (param)`)
        }
    
        const storeState = store.getState()
        if (!storeState) return new Promise((resolve) => resolve({ err: 'invalid store state' }))
        const wallet = storeState.wallet
        if (!wallet || !wallet.assets_raw || !wallet.assets) return new Promise((resolve) => resolve({ err: 'no loaded wallet' }))
    
        const h_mpk = utilsWallet.pbkdf2(apk, mpk)
    
        // decrypt raw assets (private keys) from the store
        var pt_assetsJson
        try {
            pt_assetsJson = utilsWallet.aesDecryption(apk, h_mpk, wallet.assets_raw)
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
                    pathKeyAddr.addr = walletAddr
                    
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
    
    walletConnect: (store) => {
        const globalScope = utilsWallet.getMainThreadGlobalScope()
        const appWorker = globalScope.appWorker
        if (!appWorker) throw 'No app worker'
    
        const storeState = store.getState()
        if (!storeState) return new Promise((resolve) => resolve({ err: 'invalid store state' }))
        const wallet = storeState.wallet
        //if (!wallet || !wallet.assets_raw || !wallet.assets) return new Promise((resolve) => resolve({ err: 'no loaded wallet' }))
    
        return new Promise((resolve) => {
    
            appWorker.postMessage({ msg: 'INIT_WEB3_SOCKET', data: {} })
            appWorker.postMessage({ msg: 'INIT_INSIGHT_SOCKETIO', data: {} })
            
            function blockbookListener(event) {
                if (event && event.data && event.msg) {
                    const data = event.data
                    const msg = event.msg
    
                    if (msg === 'BLOCKBOOK_ISOSOCKETS_DONE') {
    
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

function validateMpkApk(mpk, apk) {
    if (!mpk) return new Promise((resolve) => resolve({ err: 'invalid MPK' }))
    if (!apk) return new Promise((resolve) => resolve({ err: 'invalid APK' }))
    if (mpk.length < 53) return new Promise((resolve) => resolve({ err: 'MPK too short (53 chars min)' }))
    if (apk.length < 53) return new Promise((resolve) => resolve({ err: 'APK too short (53 chars min)' }))
    return undefined
}
