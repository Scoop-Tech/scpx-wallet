'use strict';

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

const swFunctions = require('./sw-functions')

//
// validates & routes wallet functions
//

module.exports = {

    validateMpkApk: (mpk, apk) => validateMpkApk(mpk, apk),

    // general functions: for a loaded wallet
    walletFunction: (store, p, fn) => {
        const apkMpkRequired = (fn === 'DUMP' || fn === 'ADD-ADDR')

        // sanity check - app worker present
        const appWorker = utilsWallet.getMainThreadGlobalScope().appWorker
        if (!appWorker) throw 'No app worker'
    
        // param check - store is valid and wallet is loaded, if supplied
        var storeState = undefined
        if (store !== null) {
            storeState = store.getState()
            if (!storeState) return new Promise((resolve) => resolve({ err: 'Invalid store state' }))
            const wallet = storeState.wallet
            if (!wallet || !wallet.assetsRaw || !wallet.assets) return new Promise((resolve) => resolve({ err: 'No loaded wallet' }))
        }

        // param check - check apk/mpk are valid if required & supplied, & take from cache if setup
        if (apkMpkRequired) {
            if (p !== null) {
                var { mpk, apk } = p

                if (global.loadedWalletKeys.mpk && !mpk) { 
                    mpk = global.loadedWalletKeys.mpk
                    log.info(`mpk: ${mpk}`, `(cache)`)
                }
                else log.info(`mpk: ${mpk}`, `(param)`)
            
                if (global.loadedWalletKeys.apk && !apk) {
                    apk = global.loadedWalletKeys.apk
                    log.info(`apk: ${apk}`, `(cache)`)
                }
                else log.info(`apk: ${apk}`, `(param)`)
                
                const invalidMpkApk = validateMpkApk(mpk, apk)
                if (invalidMpkApk) return invalidMpkApk

                p = {...p, apk, mpk}
            }
            else return new Promise((resolve) => resolve({ err: 'MPK and APK are required' }))
        }

        // route
        var walletFn
        switch (fn) {
            case 'CONNECT':  walletFn = swFunctions.connectData; break;
            case 'DUMP':     walletFn = swFunctions.dump; break;
            case 'ADD-ADDR': walletFn = swFunctions.walletAddAddress; break;
            default: return new Promise((resolve) => resolve({ err: 'Invalid wallet function' }))
        }
        return walletFn(appWorker, store, p)
    },
}

function validateMpkApk(mpk, apk) {
    if (!mpk) return new Promise((resolve) => resolve({ err: 'Invalid MPK' }))
    if (!apk) return new Promise((resolve) => resolve({ err: 'Invalid APK' }))
    if (mpk.length < 53) return new Promise((resolve) => resolve({ err: 'MPK too short (53 chars min)' }))
    if (apk.length < 53) return new Promise((resolve) => resolve({ err: 'APK too short (53 chars min)' }))
    return undefined
}
