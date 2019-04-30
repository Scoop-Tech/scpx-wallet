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

//
// handles in-memory creation of new wallets and sub-asset private keys
//

module.exports = {

    walletNew: (store) => {
        //const emailEntropyBase36 = new BigNumber(BigNumber.random(80).times(1e80).toFixed()).toString(36)
        log.cmd('walletNew')
        
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
    
    walletInit: async (store, p, e_storedAssetsRaw) => {
        var { mpk, apk } = p
        log.cmd('walletInit')
        
        // validate
        const swWallet = require('./sw-wallet')
        const invalidMpkApk = swWallet.validateMpkApk(mpk, apk)
        if (invalidMpkApk) return invalidMpkApk
        log.param(`apk`, apk, `(param)`)
        log.param(`mpk`, mpk, `(param)`)
    
        const h_mpk = utilsWallet.pbkdf2(apk, mpk)
        //const e_email = utilsWallet.aesEncryption(apk, h_mpk, email)
        //const md5_email = MD5(email).toString()
        log.param(`h_mpk`, h_mpk, `(hased MPK)`)
    
        // exec
        return opsWallet.generateWallets({
                    store: store,
             activePubKey: apk,
                    h_mpk: h_mpk,
          userAccountName: undefined,         // no EOS persistence for server wallets - not required
                  e_email: undefined,         // no EOS persistence for server wallets - not required
        e_storedAssetsRaw: e_storedAssetsRaw, // undefined for a new wallet, otherwise supplied by wallet-load
          eosActiveWallet: undefined, 
        callbackProcessed: (ret, totalReqCount) => {}
        })
        .then(generateWalletsResult => {

            if (!generateWalletsResult && e_storedAssetsRaw) {
                return new Promise((resolve) => resolve({ err: `Decrypt failed - MPK and APK are probably incorrect` }))
            }
            
            if (configWallet.CLI_SAVE_LOADED_WALLET_KEYS === true) {
                global.loadedWalletKeys = { mpk, apk }
            }

            return { ok: { 
                        generateWalletsResult: generateWalletsResult.map(p => { return {
                               symbol: p.symbol,
                            addresses: p.addresses.map(p2 => p2.addr).join(', ')
                        }} ),
                        commands: {
                             "params": `--apk ${apk} --mpk ${mpk}`,
                        }
                    }}
        })
        .catch(err => {
            return { err: err.message || err.toString() }
        })
    },
}