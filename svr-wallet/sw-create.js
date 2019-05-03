// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.

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
        .then(async keys => {
            const res = await module.exports.walletInit(store, { 
                mpk: keys.masterPrivateKey,
            //email: `s+${emailEntropyBase36}@scoop.tech`
            })
            return res
        })
    },
    
    walletInit: async (store, p, e_storedAssetsRaw) => {
        var { mpk } = p
        log.cmd('walletInit')
        
        // validate
        const svrWallet = require('./sw-wallet')
        const invalidMpk = await svrWallet.validateMpk(mpk)
        if (invalidMpk.err) return invalidMpk
        log.param('mpk', mpk)

        const apk = (await Keygen.generateMasterKeys(mpk)).publicKeys.active
        log.param('apk', apk)
    
        const h_mpk = utilsWallet.pbkdf2(apk, mpk)
        //const e_email = utilsWallet.aesEncryption(apk, h_mpk, email)
        //const md5_email = MD5(email).toString()
    
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

            console.log('generateWalletsResult', generateWalletsResult)

            if (!generateWalletsResult && e_storedAssetsRaw) {
                return new Promise((resolve) => resolve({ err: `Decrypt failed - MPK is probably incorrect` }))
            }
            
            if (configWallet.CLI_SAVE_LOADED_WALLET_KEY === true) {
                global.loadedWalletKeys = { mpk }
            }

            return { ok: { 
                        generateWalletsResult: generateWalletsResult.map(p => { return {
                               symbol: p.symbol,
                            addresses: p.addresses.map(p2 => p2.addr).join(', ')
                        }} ),
                        mpk, apk,
                   }}
        })
        .catch(err => {
            return { err: err.message || err.toString() }
        })
    },
}