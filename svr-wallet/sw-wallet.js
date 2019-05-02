// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.

const Keygen = require('eosjs-keygen').Keygen

const BigNumber = require('bignumber.js')
const MD5 = require('crypto-js').MD5
const _ = require('lodash')

const { Worker, isMainThread, parentPort } = require('worker_threads')

const configWallet = require('../config/wallet')
const walletActions = require('../actions/wallet')
const utilsWallet = require('../utils')

const opsWallet = require('../actions/wallet')
const log = require('../cli-log')

const svrWalletFunctions = require('./sw-functions')
const svrWalletPersist = require('./sw-persist')

//
// validates & routes wallet functions
//

module.exports = {

    validateMpkApk: (mpk, apk) => { return validateMpkApk(mpk, apk) },

    // general functions: for a loaded wallet
    walletFunction: (store, p, fn) => {
        const apkMpkRequired = (fn === 'DUMP' || fn === 'ADD-ADDR' || fn === 'LOAD')

        // sanity check - app worker present
        const appWorker = utilsWallet.getMainThreadGlobalScope().appWorker
        if (!appWorker) throw 'No app worker'
    
        // param check - store is valid and wallet is loaded, if supplied and applicable
        var storeState = undefined
        if (store !== null) {
            storeState = store.getState()
            if (!storeState) return new Promise((resolve) => resolve({ err: 'Invalid store state' }))
            if (fn !== 'LOAD') {
                const wallet = storeState.wallet
                if (!wallet || !wallet.assetsRaw || !wallet.assets)  {
                    return new Promise((resolve) => resolve({ err: 'No loaded wallet' }))
                }
            }
        }

        // param check - check apk/mpk are valid if required & supplied, & take from cache if setup
        if (apkMpkRequired) {
            if (p !== null) {
                var { mpk, apk } = p

                if (global.loadedWalletKeys.mpk && !mpk) { 
                    mpk = global.loadedWalletKeys.mpk
                    //log.param(`mpk`, mpk, `(cache)`)
                }
                //else log.param(`mpk`, mpk, `(param)`)
            
                if (global.loadedWalletKeys.apk && !apk) {
                    apk = global.loadedWalletKeys.apk
                    //log.param(`apk`, apk, `(cache)`)
                }
                //else log.param(`apk`, apk, `(param)`)
                
                const invalidMpkApk = validateMpkApk(mpk, apk)
                if (invalidMpkApk) return invalidMpkApk

                p = {...p, apk, mpk}
            }
            else return new Promise((resolve) => resolve({ err: 'MPK and APK are required' }))
        }

        // route
        var walletFn
        switch (fn) {
            case 'CONNECT':  walletFn = svrWalletFunctions.connectData; break;
            case 'DUMP':     walletFn = svrWalletFunctions.walletDump; break;
            case 'ADD-ADDR': walletFn = svrWalletFunctions.walletAddAddress; break;
            case 'SAVE':     walletFn = svrWalletPersist.walletSave; break;
            case 'LOAD':     walletFn = svrWalletPersist.walletLoad; break;
            case 'BALANCE':  walletFn = svrWalletFunctions.walletBalance; break;
            default: return new Promise((resolve) => resolve({ err: 'Invalid wallet function' }))
        }
        return walletFn(appWorker, store, p)
    },
}

function validateMpkApk(mpk, apk) {
    if (!mpk) return new Promise((resolve) => resolve({ err: 'MPK is required' }))
    if (!apk) return new Promise((resolve) => resolve({ err: 'APK is required' }))
    if (mpk.length < 53) return new Promise((resolve) => resolve({ err: 'MPK too short (53 chars min)' }))
    if (apk.length < 53) return new Promise((resolve) => resolve({ err: 'APK too short (53 chars min)' }))
    return undefined
}
