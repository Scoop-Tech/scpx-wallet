// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2025 Dominic Morris.

const Eos = require('eosjs')
const { Keygen } = require('eosjs-keygen')
const { SHA256, MD5 } = require('crypto-js')
const _ = require('lodash')

const walletActions = require('../actions')
const opsWallet = require('../actions/wallet')
const walletShared = require('../actions/wallet-shared')

const configWallet = require('../config/wallet')
const configEos = require('../config/eos')

const apiDataContract = require('../api/data-contract')
const utilsWallet = require('../utils')

const svrWalletCreate = require('./sw-create')
const log = require('../sw-cli-log')

const exchangeActions = require('../actions/exchange')
const { ExchangeStatusEnum } = require('../exchange/constants')
const userDataActions = require('../actions/user-data')
const userDataHelper = require('../actions/user-data-helpers')

//
// wallet Data Storage Contract (API+EOS chain, aka "server") persistence
//

module.exports = {

    walletServerSave: async (appWorker, store, p) => {
        var { mpk } = p
        log.cmd('walletServerSave')
        log.param('mpk', configWallet.IS_TEST? '[secure]' : mpk)
        const keys = await Keygen.generateMasterKeys(mpk)
        const apk = keys.publicKeys.active
        log.param('apk', apk)
       
        // validate
        const { owner, email } = global.loadedServerWallet
        if (!owner || !email) return Promise.resolve({ err: `No server wallet currently loaded` })
        const h_mpk = utilsWallet.pbkdf2(apk, keys.masterPrivateKey)
        const e_email = utilsWallet.aesEncryption(apk, h_mpk, email)
        const wallet = store.getState().wallet
        if (!wallet || !wallet.assetsRaw) throw 'No wallet supplied'

        // decrypt 
        var pt_rawAssets = utilsWallet.aesDecryption(apk, h_mpk, wallet.assetsRaw)
        if (!pt_rawAssets) return Promise.resolve({ err: `Decrypt failed - MPK is probably incorrect` })
        var pt_rawAssetsObj = JSON.parse(pt_rawAssets)

        // post
        return apiDataContract.updateAssetsJsonApi({ 
            owner, 
            encryptedAssetsJSONRaw: walletShared.encryptPrunedAssets(pt_rawAssetsObj, apk, h_mpk),
            e_email,
            showNotification: false
        })
        .then(res => {
            if (!res) return Promise.resolve({ err: `DSC API: invalid or missing response data` })
            if (!res.res === "ok") return Promise.resolve({ err: `DSC API: update failed` })

            global.loadedWallet.dirty = false
            utilsWallet.setTitle()

            return { ok: { res } }
        })
        .finally(() => {
            utilsWallet.softNuke(pt_rawAssets)
            utilsWallet.softNuke(pt_rawAssetsObj)
        })
    },

    walletServerLoad: async (appWorker, store, p) => {
        var { mpk, email } = p
        log.cmd('walletServerLoad')
        log.param('mpk', configWallet.IS_TEST ? '[secure]' : mpk)
        var keys = await Keygen.generateMasterKeys(mpk)
        const apk = keys.publicKeys.active
        log.param('apk', apk)

        // validate
        if (utilsWallet.isParamEmpty(email)) return Promise.resolve({ err: `Pseudo-email is required` })
        log.param('e', configWallet.IS_TEST ? '[secure]' : email)
        const config = Object.assign({ keyProvider: [keys.privateKeys.owner, keys.privateKeys.active] }, configEos.scpEosConfig)
        const eos = Eos(config)
        const h_mpk = utilsWallet.pbkdf2(apk, keys.masterPrivateKey)
        const e_email = utilsWallet.aesEncryption(apk, h_mpk, email)
        const h_email = MD5(email).toString()
        const keyAccounts = await utilsWallet.getAccountsByAuthorizer_Wrapper(keys.publicKeys.owner, configEos.scpEosConfig.httpEndpoint)
        utilsWallet.softNuke(keys)

        if (!(keyAccounts.account_names && keyAccounts.account_names.length > 0 && keyAccounts.account_names[0] !== undefined)) { 
            return Promise.resolve({ err: `No key account(s) found by public key` })
        }

        // login 
        return apiDataContract.login_v2Api(h_email, e_email)
        .then(async (res) => {
            if (!res || !res.owner || res.owner.length == 0 || !res.e_email || res.e_email.length == 0) { 
                return Promise.resolve({ err: `DSC API: invalid or missing response data` })
            }
            if (!res.res === "ok") {
                return Promise.resolve({ err: `DSC API: login failed` })
            }
            if (!keyAccounts.account_names.includes(res.owner)) {
                return Promise.resolve({ err: `DSC API: user mismatch (1)` })
            }
            const pt_email = utilsWallet.aesDecryption(apk, h_mpk, res.e_email)
            if (pt_email !== email) { // (server has already validated this on login_v2)
                return Promise.resolve({ err: `DSC API: user mismatch (2)` })
            }
            if (!res.assetsJSON || res.assetsJSON.length == 0) {
                return Promise.resolve({ err: `DSC API: no assets data returned` })
            }
            if (!res.dataJSON || res.dataJSON.length == 0) {
                return Promise.resolve({ err: `DSC API: no user data returned` })
            }

            const owner = res.owner
            const walletInit = await svrWalletCreate.walletInit(appWorker, store, { mpk, apk }, res.assetsJSON)
            if (walletInit.err) resolve(walletInit)
            if (walletInit.ok) {
                // update storage context
                global.storageContext.e_email = e_email

                // set user-data from server-loaded wallet
                store.dispatch({ type: walletActions.USERDATA_SET_FROM_SERVER, dataJson: res.dataJSON, payload: {} })

                // update last loaded in user-data
                var userData = store.getState().userData
                store.dispatch({ type: walletActions.USERDATA_UPDATE_LASTLOAD, payload: { 
                       owner,
                    newValue: { browser: false, server: true, datetime: new Date().toString() }
                }})

                // post back to server
                userData = store.getState().userData
                userDataActions.userData_SaveAll({ userData, hideToast: true })

                // poll any pending XS statuses
                const { wallet, userData: { exchange: { cur_xsTx } } } = store.getState()
                //log.info('walletServerLoad - cur_xsTx', cur_xsTx)
                if (wallet && wallet.assets && cur_xsTx) {
                    wallet.assets.forEach(asset => {
                        const xsTx = cur_xsTx[asset.symbol]
                        if (xsTx && xsTx.cur_xsTxStatus !== ExchangeStatusEnum.done     // internal status - web wallet sets to this status explicitly (when user has confirmed)
                                 && xsTx.cur_xsTxStatus !== ExchangeStatusEnum.finished // changelly status - (server wallet final status)
                                 && xsTx.cur_xsTxStatus !== ExchangeStatusEnum.failed   // "
                                 && xsTx.cur_xsTxStatus !== ExchangeStatusEnum.expired  // "
                                 && xsTx.cur_xsTxStatus !== ExchangeStatusEnum.refunded // "
                                 && xsTx.cur_xsTxStatus !== ExchangeStatusEnum.overdue  // "
                                 && xsTx.cur_xsTxStatus !== ExchangeStatusEnum.hold     // "
                        ) {
                            store.dispatch(exchangeActions.XS_pollExchangeStatus(store, asset, xsTx, utilsWallet.getStorageContext().owner))
                        }
                    })
                }

                // server-loaded wallet; set server wallet field
                global.loadedWallet.dirty = false
                utilsWallet.setTitle(`SERVER WALLET - ${email} / ${owner}`)
                global.loadedServerWallet = { owner, email }
            }
            return { ok: { owner, email, walletInit } }
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
