'use strict';

const Keygen = require('eosjs-keygen').Keygen

const BigNumber = require('bignumber.js')
const MD5 = require('crypto-js').MD5
const _ = require('lodash')

const configWallet = require('../config/wallet')
const walletActions = require('../actions/wallet')
const utilsWallet = require('../utils')
const opsWallet = require('../actions/wallet')
const log = require('../cli-log')

const swWallet = require('./sw-wallet')

//
// handles in-memory creation of new wallets and sub-asset private keys
//

module.exports = {

    walletNew: (store) => {
        //const emailEntropyBase36 = new BigNumber(BigNumber.random(80).times(1e80).toFixed()).toString(36)
        
        return Keygen.generateMasterKeys()
        .then(keys => {
            const res = module.exports.walletInit(store, { 
                mpk: keys.masterPrivateKey,
                apk: keys.publicKeys.active,
              //email: `s+${emailEntropyBase36}@scoop.tech`
            })
            return res
        })
    },
    
     walletInit: async (store, p) => {
        var { mpk, apk } = p
        
        // validate
        const invalidMpkApk = swWallet.validateMpkApk(mpk, apk)
        if (invalidMpkApk) return invalidMpkApk
        log.info(`  mpk: ${mpk}`, `(param)`)
        log.info(`  apk: ${apk}`, `(param)`)
    
        const h_mpk = utilsWallet.pbkdf2(apk, mpk)
        //const e_email = utilsWallet.aesEncryption(apk, h_mpk, email)
        //const md5_email = MD5(email).toString()
    
        log.info(`h_mpk: ${h_mpk}`, '(hased MPK)')
        log.info(`  apk: ${apk}`,   '(active public key)')
    
        // exec
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
                log.warn(`NOTE: Cached MPK & APK in memory (CLI_SAVE_LOADED_WALLET_KEYS == true)`)
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

}