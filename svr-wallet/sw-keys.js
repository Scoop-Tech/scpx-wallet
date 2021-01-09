// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2021 Dominic Morris.

const _ = require('lodash')

const configWallet = require('../config/wallet')
const opsWallet = require('../actions/wallet')
const utilsWallet = require('../utils')

const filePersist = require('./sw-file-persist')
const serverPersist = require('./sw-server-persist')
const functions = require('./sw-functions')

const log = require('../sw-cli-log')

//
// general wallet functions
//

module.exports = {
    
    // adds a sub-asset receive address
    walletAddAddress: async (appWorker, store, p) => {
        var { mpk, apk, symbol, save } = p
        const h_mpk = utilsWallet.pbkdf2(apk, mpk)
        log.cmd('walletAddAddress')
        
        // validate
        const wallet = store.getState().wallet
        if (utilsWallet.isParamEmpty(symbol)) return Promise.resolve({ err: `Asset symbol is required` })
        const asset = wallet.assets.find(p => p.symbol.toLowerCase() === symbol.toLowerCase())
        if (!asset) return Promise.resolve({ err: `Invalid asset symbol "${symbol}"` })

        // exec
        return opsWallet.generateNewAddress({
                    store: store,
                      apk: apk,
                    h_mpk: h_mpk,
                assetName: asset.name,
        })
        .then(async (walletAddAddr) => {
            if (!walletAddAddr) return Promise.resolve({ err: "Unknown error" })
            if (walletAddAddr.err) return Promise.resolve({ err: walletAddAddr.err })

            const walletConnect = await functions.walletConnect(appWorker, store, {})
            
            // handle save
            var walletSave = undefined
            if (utilsWallet.isParamTrue(save)) {
                walletSave = await saveWallet(appWorker, store, mpk)
            }
            else {
                global.loadedWallet.dirty = true
                utilsWallet.setTitle()
            }

            return Promise.resolve({ ok: { walletAddAddr, walletConnect, walletSave } })
        })
        .catch(err => {
            return Promise.resolve({ err })
        })
    },

    // adds a sub-asset receive address
    walletAddPrivKeys: async (appWorker, store, p) => {
        var { mpk, apk, symbol, privKeys } = p
        const h_mpk = utilsWallet.pbkdf2(apk, mpk)
        log.cmd('walletAddPrivKeys')
        
        // validate
        const wallet = store.getState().wallet
        if (utilsWallet.isParamEmpty(symbol)) return Promise.resolve({ err: `Asset symbol is required` })
        const asset = wallet.assets.find(p => p.symbol.toLowerCase() === symbol.toLowerCase())
        if (!asset) return Promise.resolve({ err: `Invalid asset symbol "${symbol}"` })

        // validate privkeys
        if (utilsWallet.isParamEmpty(privKeys)) return Promise.resolve({ err: `Private key list is required` })
        const privKeyList = privKeys.split(',')
        if (!privKeyList || privKeyList.length == 0) return Promise.resolve({ err: `Invalid private key list - use comma separation` })
        var regex = asset.addressType === configWallet.ADDRESS_TYPE_ETH 
            ? configWallet.REGEX_ETH
            : asset.symbol.includes('_TEST')
                ? configWallet.REGEX_WIF_UTXO_TESTNETS
                : configWallet.REGEX_WIF_UTXO_MAINNETS
        for (var i=0 ; i < privKeyList.length ; i++) {
            if (!privKeyList[i].match(regex)) { 
                return Promise.resolve({ err: `Invalid private key "${privKeyList[i]}"` }) 
            }
        }

        // exec
        return opsWallet.importPrivKeys({
                    store: store,
                      apk: apk,
                    h_mpk: h_mpk,
                assetName: asset.name,
             addrKeyPairs: privKeyList.map(p => { return { privKey: p }}),
        })
        .then(async (importPrivKeys) => {
            if (!importPrivKeys) return Promise.resolve({ err: "Unknown error" })
            if (importPrivKeys.err) return Promise.resolve({ err: importPrivKeys.err })

            var walletConnect
            if (importPrivKeys.importedAddrCount > 0) {
                global.loadedWallet.dirty = true
                walletConnect = await functions.walletConnect(appWorker, store, {})
            }

            utilsWallet.setTitle()
            return Promise.resolve({ ok: { importPrivKeys, walletConnect } })
        })
        .catch(err => {
            return Promise.resolve({ err })
        })
    },

    // removes an imported account and associated private keys
    walletRemoveImportAccount: async (appWorker, store, p) => {
        var { mpk, apk, symbol, accountName } = p
        const h_mpk = utilsWallet.pbkdf2(apk, mpk)
        log.cmd('walletRemoveImportAccount')
        
        // validate
        const wallet = store.getState().wallet
        if (utilsWallet.isParamEmpty(symbol)) return Promise.resolve({ err: `Asset symbol is required` })
        const asset = wallet.assets.find(p => p.symbol.toLowerCase() === symbol.toLowerCase())
        if (!asset) return Promise.resolve({ err: `Invalid asset symbol "${symbol}"` })

        if (utilsWallet.isParamEmpty(accountName)) return Promise.resolve({ err: `Account name is required` })
        if (!asset.addresses.some(addr => addr.accountName === accountName && addr.path.startsWith("i"))) { // "i" for non-BIP44 (imported) acount
            return Promise.resolve({ err: `Import account not found` })
        }

        // exec
        return opsWallet.removeImportedAccounts({
                    store: store,
                      apk: apk,
                    h_mpk: h_mpk,
                assetName: asset.name,
           removeAccounts: [accountName],
        })
        .then(async (removeImportedAccounts) => {
            if (!removeImportedAccounts) return Promise.resolve({ err: "Unknown error" })
            if (removeImportedAccounts.err) return Promise.resolve({ err: removeImportedAccounts.err })

            var walletConnect
            if (removeImportedAccounts.removedAddrCount > 0) {
                global.loadedWallet.dirty = true
                walletConnect = await functions.walletConnect(appWorker, store, {})
            }

            utilsWallet.setTitle()
            return Promise.resolve({ ok: { removeImportedAccounts, walletConnect } })
        })
        .catch(err => {
            return Promise.resolve({ err })
        })
    },
}

function saveWallet(appWorker, store, mpk) {
    var saveOp
    if (global.loadedWallet.file && global.loadedWallet.file.name) { 
        // save to file
        saveOp = filePersist.walletFileSave(appWorker, store, { mpk, force: true })
    }
    else if (global.loadedServerWallet) {
        // save to server
        saveOp = serverPersist.walletServerSave(appWorker, store, { mpk })
    }
    else throw ('Unexpected loaded wallet state - unable to save.')
    return saveOp
}