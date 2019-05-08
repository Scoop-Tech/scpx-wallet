// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.

const Keygen = require('eosjs-keygen').Keygen

const functions = require('./sw-functions')
const keys = require('./sw-keys')
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
    fn: async (appWorker, store, p, fn) => {
        if (!appWorker) throw 'No app worker'

        const mpkRequired =
            (fn === 'DUMP' || fn === 'ADD-ADDR' || fn === 'ADD-PRIV-KEYS' || fn === 'REMOVE-PRIV-KEYS'
          || fn === 'LOAD' || fn === 'SAVE' || fn === 'SERVER-LOAD' || fn === 'SERVER-SAVE'
          || fn === 'TX-GET-FEE' || fn === 'TX-PUSH')
        
        const loadedWalletRequired =
            (fn !== 'LOAD' && fn !== 'SERVER-LOAD')

        const connectedWalletRequired =
            (fn === 'BALANCE' || fn === 'TX-GET-FEE' || fn === 'ASSET-GET-FEES' || fn === 'TX-PUSH')
    
        // param/state check - store is valid and wallet is loaded, if supplied and applicable
        var storeState = undefined
        if (store !== null) {
            // state check - store is valid 
            storeState = store.getState()
            if (!storeState) return Promise.resolve({ err: 'Invalid store state' })
            const wallet = storeState.wallet

            // state check - wallet is loaded
            if (loadedWalletRequired) {
                if (!wallet || !wallet.assetsRaw || !wallet.assets)  {
                    return Promise.resolve({ err: 'No loaded wallet: create a new one with ".wn"' })
                }
            }

            // state check - wallet is connected (all assets have data populated from 3PBPs)
            if (connectedWalletRequired) {
                if (wallet.assets.some(p => !p.lastAssetUpdateAt)) {
                    return Promise.resolve({ err: 
                        `Wallet is not connected to 3PBPs: connect it with ".wc"`
                    })
                }
            }
        } else throw('Store is required')

        // param check - check apk/mpk are valid if required & supplied, & take from cache if required and not supplied
        if (mpkRequired) {
            if (p !== null) {
                var { mpk } = p
                if (global.loadedWallet.keys && global.loadedWallet.keys.mpk && !mpk) { 
                    mpk = global.loadedWallet.keys.mpk
                }
                const invalidMpk = await validateMpk(mpk)
                if (invalidMpk.err) return invalidMpk

                const apk = (await Keygen.generateMasterKeys(mpk)).publicKeys.active
                p = {...p, apk, mpk}
            }
            else return Promise.resolve({ err: 'MPK is required' })
        }

        // route
        var walletFn
        switch (fn) {
            case 'CONNECT':           walletFn = functions.walletConnect; break;
            case 'DUMP':              walletFn = functions.walletDump; break;
            
            case 'ADD-ADDR':          walletFn = keys.walletAddAddress; break;
            case 'ADD-PRIV-KEYS':     walletFn = keys.walletAddPrivKeys; break;
            case 'REMOVE-PRIV-KEYS':  walletFn = keys.walletRemoveImportAccount; break;
            
            case 'BALANCE':           walletFn = functions.walletBalance; break;
            case 'SAVE':              walletFn = filePersist.walletFileSave; break;
            case 'LOAD':              walletFn = filePersist.walletFileLoad; break;
            
            case 'SERVER-LOAD':       walletFn = serverPersist.walletServerLoad; break; 
            case 'SERVER-SAVE':       walletFn = serverPersist.walletServerSave; break; 
            
            case 'ASSET-GET-FEES':    walletFn = asset.getNetworkFees; break;
            case 'TX-GET-FEE':        walletFn = tx.txGetFee; break;
            case 'TX-PUSH':           walletFn = tx.txPush; break;

            default: return Promise.resolve({ err: 'Invalid wallet function' })
        }
        return walletFn(appWorker, store, p)
    },
}

function validateMpk(mpk) {
    if (!mpk) return Promise.resolve({ err: 'MPK is required' })
    if (mpk.length < 53) return Promise.resolve({ err: 'MPK too short (53 chars min)' })
    try {
        return Keygen.generateMasterKeys(mpk).then(keys => {
            return Promise.resolve({ ok: true })
        }).catch(err => {
            log.error(err)
            return Promise.resolve({ err: 'Invalid MPK' })
        })
    }
    catch(err) {
        log.error(err)
        return Promise.resolve({ err: 'Invalid MPK' })
    }
}