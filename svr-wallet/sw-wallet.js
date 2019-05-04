// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.

const Keygen = require('eosjs-keygen').Keygen

const BigNumber = require('bignumber.js')
const MD5 = require('crypto-js').MD5
const _ = require('lodash')

const { Worker, isMainThread, parentPort } = require('worker_threads')

const configWallet = require('../config/wallet')
const walletActions = require('../actions/wallet')
const opsWallet = require('../actions/wallet')
const utilsWallet = require('../utils')

const functions = require('./sw-functions')
const filePersist = require('./sw-file-persist')
const serverPersist = require('./sw-server-persist')
const asset = require('./sw-asset')
const tx = require('./sw-tx')

const log = require('../cli-log')

//
// validates & routes wallet functions
//

module.exports = {

    validateMpk: (mpk) => { return validateMpk(mpk) },

    // general functions: for a loaded wallet
    walletFunction: async (store, p, fn) => {
        const mpkRequired = (fn === 'DUMP' || fn === 'ADD-ADDR' || fn === 'LOAD' || fn === 'SERVER-LOAD')
        const loadedWalletRequired = (fn !== 'LOAD' && fn !== 'SERVER-LOAD')
        const connectedWalletRequired = (fn === 'BALANCE' || fn === 'TX-GET-FEE' || fn === 'ASSET-GET-FEES')

        // sanity check - app worker present
        const appWorker = utilsWallet.getMainThreadGlobalScope().appWorker
        if (!appWorker) throw 'No app worker'
    
        // param/state check - store is valid and wallet is loaded, if supplied and applicable
        var storeState = undefined
        if (store !== null) {
            // state check - store is valid 
            storeState = store.getState()
            if (!storeState) return new Promise((resolve) => resolve({ err: 'Invalid store state' }))
            const wallet = storeState.wallet

            // state check - wallet is loaded
            if (loadedWalletRequired) {
                if (!wallet || !wallet.assetsRaw || !wallet.assets)  {
                    return new Promise((resolve) => resolve({ err: 'No loaded wallet: create a new one with ".wn"' }))
                }
            }

            // state check - wallet is connected (all assets have data populated from 3PBPs)
            if (connectedWalletRequired) {
                if (wallet.assets.some(p => !p.lastAssetUpdateAt)) {
                    return new Promise((resolve) => resolve({ err: 
                        `Wallet is not connected to 3PBPs: connect it with ".wc"`
                    }))
                }
            }
        } else throw('Store is required')

        // param check - check apk/mpk are valid if required & supplied, & take from cache if required and not supplied
        if (mpkRequired) {
            if (p !== null) {
                var { mpk } = p
                if (global.loadedWalletKeys.mpk && !mpk) { 
                    mpk = global.loadedWalletKeys.mpk
                }
                const invalidMpk = await validateMpk(mpk)
                if (invalidMpk.err) return invalidMpk

                const apk = (await Keygen.generateMasterKeys(mpk)).publicKeys.active
                p = {...p, apk, mpk}
            }
            else return new Promise((resolve) => resolve({ err: 'MPK is required' }))
        }

        // route
        var walletFn
        switch (fn) {
            case 'CONNECT':        walletFn = functions.connectData; break;
            case 'DUMP':           walletFn = functions.walletDump; break;
            case 'ADD-ADDR':       walletFn = functions.walletAddAddress; break;
            case 'BALANCE':        walletFn = functions.walletBalance; break;
            case 'SAVE':           walletFn = filePersist.walletFileSave; break;
            case 'LOAD':           walletFn = filePersist.walletFileLoad; break;
            
            case 'ASSET-GET-FEES': walletFn = asset.getNetworkFees; break; 
            case 'SERVER-LOAD':    walletFn = serverPersist.walletServerLoad; break; // ##
            case 'TX-GET-FEE':     walletFn = tx.txGetFee; break; // ##

            default: return new Promise((resolve) => resolve({ err: 'Invalid wallet function' }))
        }
        return walletFn(appWorker, store, p)
    },
}

function validateMpk(mpk) {
    if (!mpk) return new Promise((resolve) => resolve({ err: 'MPK is required' }))
    if (mpk.length < 53) return new Promise((resolve) => resolve({ err: 'MPK too short (53 chars min)' }))
    var apk = undefined
    try {
        return Keygen.generateMasterKeys(mpk).then(keys => {
            return new Promise((resolve) => resolve({ ok: true }))
        }).catch(err => {
            log.error(err)
            return new Promise((resolve) => resolve({ err: 'Invalid MPK' }))
        })
    }
    catch(err) {
        log.error(err)
        return new Promise((resolve) => resolve({ err: 'Invalid MPK' }))
    }
}
