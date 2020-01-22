// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2020 Dominic Morris.

//const Eos = require('eosjs')
//const { Keygen } = require('eosjs-keygen')
//const { SHA256, MD5 } = require('crypto-js')
//const _ = require('lodash')

// const walletActions = require('../actions')
// const opsWallet = require('../actions/wallet')

// const configWallet = require('../config/wallet')
// const configEos = require('../config/eos')

const utilsWallet = require('../utils')

const svrWalletCreate = require('./sw-create')
const log = require('../sw-cli-log')

//
// wallet file persistence
//

module.exports = {

    walletFileSave: (appWorker, store, p) => {
        var { mpk, name, force } = p
        log.cmd('walletFileSave')

        const e_assetsRaw = store.getState().wallet.assetsRaw

        // validate
        var loadedFilename = undefined
        if (global.loadedWallet.file && global.loadedWallet.file.name) {
            loadedFilename = global.loadedWallet.file.name
        }
        if (name) {
            if (name.toString().match(/^[a-z0-9_-]+$/i) == null) return Promise.resolve({ err: `Wallet name must be alphanumeric characters only` })
        }

        if (utilsWallet.isParamEmpty(name)) {
            if (!loadedFilename)  {
                return Promise.resolve({ err: `Wallet name is required` })
            }
            else {
                name = loadedFilename
            }
        }

        const fileName = `./wallet_${name.toString()}.dat`
        log.param('fileName', fileName)

        var overwrite = false
        if (utilsWallet.isParamTrue(force)) {
            overwrite = true
        }

        // check overwrite
        const fs = require('fs')
        const exists = fs.existsSync(fileName)
        if (exists && !overwrite) return Promise.resolve({ err: `File ${fileName} already exists. Use --force to overwrite.` })

        // exec
        return new Promise((resolve) => {
            fs.writeFile(fileName, e_assetsRaw, function (err) {

                if (err) resolve({ err })
                else {
                    log.warn(`the MPK used to generate this wallet will be required to load it from file.`)

                    global.loadedWallet.file = { name }
                    global.loadedWallet.dirty = false
                    utilsWallet.setTitle(`FILE WALLET - ${fileName}`)
                    resolve({ ok: { fileName, mpk } })
                }
            })
        })
    },

    walletFileLoad: (appWorker, store, p) => {
        var { mpk, name } = p
        log.cmd('walletFileLoad')

        // validate
        if (utilsWallet.isParamEmpty(name)) return Promise.resolve({ err: `Wallet name is required` })
        if (name.toString().match(/^[a-z0-9_-]+$/i) == null) return Promise.resolve({ err: `Wallet name must be alphanumeric characters only` })
        const fileName = `./wallet_${name.toString()}.dat`

        // check exists
        const fs = require('fs')
        const exists = fs.existsSync(fileName)
        if (!exists) return Promise.resolve({ err: `File ${fileName} not found.` })

        // exec
        return new Promise((resolve) => {
            fs.readFile(fileName, "utf8", function (err, data) {
                if (err) resolve({ err })
                else {
                    if (!data || data.length == 0) { 
                        resolve({ err: `No data in file ${fileName}.` })
                        return
                    }

                    const e_storedAssetsRaw = data.toString()
                    log.info(`Read wallet ${fileName} data OK - length=`, e_storedAssetsRaw.length)

                    svrWalletCreate.walletInit(appWorker, store, { mpk }, e_storedAssetsRaw)
                    .then(walletInit => {
                        if (walletInit.err) resolve(walletInit)
                        if (walletInit.ok) {
                            global.loadedWallet.file = { name }
                            global.loadedWallet.dirty = false
                            utilsWallet.setTitle(`FILE WALLET - ${fileName}`)
                        }
                        resolve({ ok: { fileName, walletInit } })
                    })
                }
            })
        })
    },
}
