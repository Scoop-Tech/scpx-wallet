// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2020 Dominic Morris.

const Eos = require('eosjs')
const Keygen = require('eosjs-keygen').Keygen
const scpEosConfig = require('../config/eos').scpEosConfig

const BigNumber = require('bignumber.js')
//const MD5 = require('crypto-js').MD5
const _ = require('lodash')

const configWallet = require('../config/wallet')
const utilsWallet = require('../utils')
const opsWallet = require('../actions/wallet')

const functions = require('./sw-functions')
const log = require('../sw-cli-log')

//
// handles in-memory creation of new wallets and sub-asset private keys
//

module.exports = {

    walletNew: (appWorker, store) => {
        //const emailEntropyBase36 = new BigNumber(BigNumber.random(80).times(1e80).toFixed()).toString(36)
        log.cmd('walletNew')
        
        return Keygen.generateMasterKeys()
        .then(async keys => {
            const res = await module.exports.walletInit(appWorker, store, { 
                mpk: keys.masterPrivateKey,
            //email: `s+${emailEntropyBase36}@scoop.tech`
            })
            return res
        })
    },
    
    walletInit: async (appWorker, store, p, e_storedAssetsRaw) => {
        var { mpk } = p
        log.cmd('walletInit')
        
        // validate
        const svrWallet = require('./sw-router')
        const invalidMpk = await svrWallet.validateMpk(mpk)
        if (invalidMpk.err) return invalidMpk
        log.param('mpk', process.env.NODE_ENV === 'test' ? '[secure]' : mpk)

        var keys = await Keygen.generateMasterKeys(mpk)
        const apk = keys.publicKeys.active
        log.param('apk', apk)
    
        const h_mpk = utilsWallet.pbkdf2(apk, mpk)
        //const e_email = utilsWallet.aesEncryption(apk, h_mpk, email)
        //const md5_email = MD5(email).toString()
    
        // exec
        return opsWallet.generateWallets({
                    store: store,
                      apk: apk,
                    h_mpk: h_mpk,
          userAccountName: undefined,         // no default DSC persistence for server wallets - not required
                  e_email: undefined,         // "
        e_storedAssetsRaw: e_storedAssetsRaw, // undefined for a new wallet, otherwise supplied by wallet-load or by wallet-server-load
          eosActiveWallet: undefined, 
        callbackProcessed: (ret, totalReqCount) => {}
        })
        .then(async (generateWalletsResult) => {

            if (!generateWalletsResult && e_storedAssetsRaw) {
                return Promise.resolve({ err: `Decrypt failed - MPK is probably incorrect` })
            }
            
            // default in-memory wallet; clear server and file wallet fields
            global.loadedWallet.file = undefined
            global.loadedServerWallet = {}

            // save MPK
            if (configWallet.CLI_SAVE_KEY === true) {
                global.loadedWallet.keys = { mpk }
            }

            // setup storage context
            if (!global.storageContext) global.storageContext = {}
            
            const config = Object.assign({ keyProvider: [keys.privateKeys.owner, keys.privateKeys.active] }, scpEosConfig)
            const eos = Eos(config)
            const keyAccounts = await eos.getKeyAccounts(keys.publicKeys.owner)
            const owner = keyAccounts.account_names[0]
            global.storageContext.owner = owner
            
            global.storageContext.apk = keys.publicKeys.active
            global.storageContext.opk = keys.publicKeys.owner
            global.storageContext.PATCH_H_MPK = utilsWallet.pbkdf2(keys.publicKeys.active, keys.masterPrivateKey)
            utilsWallet.softNuke(keys)

            // (re)connect addr monitors
            const walletConnect = await functions.walletConnect(appWorker, store, {})

            utilsWallet.setTitle(`${apk}`)
            return { ok: { mpk, apk, h_mpk, walletConnect }}
        })
        .catch(err => {
            utilsWallet.softNuke(keys)
            return { err: err.message || err.toString() }
        })
    },
}