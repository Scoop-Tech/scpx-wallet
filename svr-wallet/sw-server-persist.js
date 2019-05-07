// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.

const Eos = require('eosjs')
const { Keygen } = require('eosjs-keygen')
const { SHA256, MD5 } = require('crypto-js')
const _ = require('lodash')

const walletActions = require('../actions')
const opsWallet = require('../actions/wallet')

const configWallet = require('../config/wallet')
const configEos = require('../config/eos')

const apiDataContract = require('../api/data-contract')

const utilsWallet = require('../utils')

const svrWalletCreate = require('./sw-create')
const log = require('../cli-log')

//
// wallet Data Storage Contract (API+EOS chain, aka "server") persistence
//

module.exports = {

    walletServerSave: async (appWorker, store, p) => {
        var { mpk, e } = p
        log.cmd('walletServerSave')
        log.param('mpk', mpk)
        const keys = await Keygen.generateMasterKeys(mpk)
        const apk = keys.publicKeys.active
        log.param('apk', apk)
       
        // validate
        const { accountName, email } = global.loadedServerWallet
        if (!accountName || !email) return Promise.resolve({ err: `No server wallet currently loaded` })
        const h_mpk = utilsWallet.pbkdf2(apk, keys.masterPrivateKey)
        const e_email = utilsWallet.aesEncryption(apk, h_mpk, email)
        const wallet = store.getState().wallet
        if (!wallet || !wallet.assetsRaw) throw 'No wallet supplied'

        // decrypt 
        var pt_rawAssets = utilsWallet.aesDecryption(apk, h_mpk, wallet.assetsRaw)
        if (!pt_rawAssets) return Promise.resolve({ err: `Decrypt failed - MPK is probably incorrect` })
        var pt_rawAssetsObj = JSON.parse(pt_rawAssets)

        // post
        return apiDataContract.updateAssetsJsonApi(accountName, opsWallet.encryptPrunedAssets(pt_rawAssetsObj, apk, h_mpk), e_email)
        .then(res => {
            if (!res) {
                return Promise.resolve({ err: `DSC API: invalid or missing response data` })
            }             
            if (!res.res === "ok") { 
                return Promise.resolve({ err: `DSC API: update failed` })
            }
            return { ok: { res } }
        })
        .finally(() => {
            utilsWallet.softNuke(pt_rawAssets)
            utilsWallet.softNuke(pt_rawAssetsObj)
        })
    },

    walletServerLoad: async (appWorker, store, p) => {
        var { mpk, e } = p
        log.cmd('walletServerLoad')
        log.param('mpk', mpk)
        const keys = await Keygen.generateMasterKeys(mpk)
        const apk = keys.publicKeys.active
        log.param('apk', apk)

        // validate
        if (utilsWallet.isParamEmpty(e)) return Promise.resolve({ err: `Pseudo-email is required` })
        const email = e
        log.param('e', email)
        const config = Object.assign({ keyProvider: [keys.privateKeys.owner, keys.privateKeys.active] }, configEos.scpEosConfig)
        const eos = Eos(config)
        const h_mpk = utilsWallet.pbkdf2(apk, keys.masterPrivateKey)
        const e_email = utilsWallet.aesEncryption(apk, h_mpk, email)
        const h_email = MD5(email).toString()
        const keyAccounts = await eos.getKeyAccounts(keys.publicKeys.owner)
        if (!(keyAccounts.account_names && keyAccounts.account_names.length > 0 && keyAccounts.account_names[0] !== undefined)) { 
            return Promise.resolve({ err: `No key account(s) found by public key` })
        }

        // login 
        return apiDataContract.login_v2Api(h_email, e_email)
        .then(async (res) => {
            if (!res || !res.owner || res.owner.length == 0 || !res.encryptedEmail || res.encryptedEmail.length == 0) { 
                return Promise.resolve({ err: `DSC API: invalid or missing response data` })
            }
            if (!res.res === "ok") {
                return Promise.resolve({ err: `DSC API: login failed` })
            }
            if (!keyAccounts.account_names.includes(res.owner)) {
                return Promise.resolve({ err: `DSC API: user mismatch (1)` })
            }
            const pt_email = utilsWallet.aesDecryption(apk, h_mpk, res.encryptedEmail)
            if (pt_email !== email) { // (server has already validated this on login_v2)
                return Promise.resolve({ err: `DSC API: user mismatch (2)` })
            }
            if (!res.assetsJSON || res.assetsJSON.length == 0) {
                return Promise.resolve({ err: `DSC API: no assets data returned` })
            }

            const accountName = res.owner
            const walletInit = await svrWalletCreate.walletInit(appWorker, store, { mpk, apk }, res.assetsJSON)
            if (walletInit.err) resolve(walletInit)
            if (walletInit.ok) {
                utilsWallet.setTitle(`SERVER WALLET - ${email} / ${accountName}`)
                global.loadedServerWallet = { accountName, email }
            }
            return { ok: { accountName, email, walletInit } }
        })
        .catch(err => {
            if (err.response && err.response.statusText) {
                return Promise.resolve({ err: err.response.statusText })
            }
            else {
                return Promise.resolve({ err: err.message || err.toString() })
            }
        })
    },
}
