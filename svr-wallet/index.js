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

const walletFunctions = require('./functions')

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
          eosActiveWallet: undefined, // todo
        callbackProcessed: (ret, totalReqCount) => {}
        })
        .then(res => {
            
            if (configWallet.CLI_SAVE_LOADED_WALLET_KEYS === true) {
                loadedWalletKeys = { mpk, apk }
                log.warn('\nNOTE: Cached MPK & APK')
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
    
    /*walletDump: async (store, p) => {
        var { mpk, apk, s, tx } = p
    
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

        const storeState = store.getState()
        if (!storeState) return new Promise((resolve) => resolve({ err: 'invalid store state' }))
        const wallet = storeState.wallet
        if (!wallet || !wallet.assetsRaw || !wallet.assets) return new Promise((resolve) => resolve({ err: 'no loaded wallet' }))
    
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
    },*/
    
    // general functions: for a loaded wallet
    walletFunction: (fn, store, p) => {
        debugger

        // sanity check - app worker present
        const appWorker = utilsWallet.getMainThreadGlobalScope().appWorker
        if (!appWorker) throw 'No app worker'
    
        // param check - store is valid, if supplied
        var storeState = undefined
        if (store !== null) {
            storeState = store.getState()
            if (!storeState) return new Promise((resolve) => resolve({ err: 'Invalid store state' }))
            const wallet = storeState.wallet
            if (!wallet || !wallet.assetsRaw || !wallet.assets) return new Promise((resolve) => resolve({ err: 'No loaded wallet' }))
        }

        // param check - apk/mpk are valid, if supplied - take from cache, if setup
        if (p !== null) {
            var { mpk, apk } = p

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

            debugger
            p = {...p, apk, mpk}
        }

        switch (fn) {
            case 'DUMP':
                return walletFunctions.dump(appWorker, store, p)

            case 'CONNECT': 
                return walletFunctions.connectData(appWorker, store, p)

            default: 
                return new Promise((resolve) => resolve({ err: 'Invalid wallet function' }))
        }
    },
}

function validateMpkApk(mpk, apk) {
    if (!mpk) return new Promise((resolve) => resolve({ err: 'invalid MPK' }))
    if (!apk) return new Promise((resolve) => resolve({ err: 'invalid APK' }))
    if (mpk.length < 53) return new Promise((resolve) => resolve({ err: 'MPK too short (53 chars min)' }))
    if (apk.length < 53) return new Promise((resolve) => resolve({ err: 'APK too short (53 chars min)' }))
    return undefined
}
