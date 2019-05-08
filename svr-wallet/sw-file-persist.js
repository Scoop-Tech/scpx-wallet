// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.

const Eos = require('eosjs')
const { Keygen } = require('eosjs-keygen')
const { SHA256, MD5 } = require('crypto-js')
const _ = require('lodash')

const walletActions = require('../actions')
const opsWallet = require('../actions/wallet')

const configWallet = require('../config/wallet')
const configEos = require('../config/eos')

const utilsWallet = require('../utils')

const svrWalletCreate = require('./sw-create')
const log = require('../cli-log')

//
// wallet file persistence
//

module.exports = {

    walletFileSave: (appWorker, store, p) => {
        var { mpk, n, f } = p
        log.cmd('walletFileSave')

        const e_assetsRaw = store.getState().wallet.assetsRaw

        // validate
        if (utilsWallet.isParamEmpty(n)) return Promise.resolve({ err: `Wallet name is required` })
        if (n.toString().match(/^[a-z0-9_-]+$/i) == null) return Promise.resolve({ err: `Wallet name must be alphanumeric characters only` })
        const fileName = `./wallet_${n.toString()}.dat`

        var overwrite = false
        if (utilsWallet.isParamTrue(f)) {
            overwrite = true
        }

        // check overwrite
        const fs = require('fs')
        const exists = fs.existsSync(fileName)
        if (exists && !overwrite) return Promise.resolve({ err: `File ${fileName} already exists. Use --f to overwrite.` })

        // exec
        return new Promise((resolve) => {
            fs.writeFile(fileName, e_assetsRaw, function (err) {

                if (err) resolve({ err })
                else {
                    log.warn(`the MPK used to generate this wallet will be required to load it from file.`)

                    global.global.loadedWallet.dirty = false
                    utilsWallet.setTitle()
                    resolve({ ok: { fileName, mpk } })
                }
            })
        })
    },

    walletFileLoad: (appWorker, store, p) => {
        var { mpk, n } = p
        log.cmd('walletFileLoad')

        // validate
        if (utilsWallet.isParamEmpty(n)) return Promise.resolve({ err: `Wallet name is required` })
        if (n.toString().match(/^[a-z0-9_-]+$/i) == null) return Promise.resolve({ err: `Wallet name must be alphanumeric characters only` })
        const fileName = `./wallet_${n.toString()}.dat`

        // check exists
        const fs = require('fs')
        const exists = fs.existsSync(fileName)
        if (!exists) return Promise.resolve({ err: `File ${fileName} not found.` })

        // exec
        return new Promise((resolve) => {
            fs.readFile(fileName, "utf8", function (err, data) {
                if (err) resolve({ err })
                else {
                    if (!data || data.length == 0) return Promise.resolve({ err: `No data in file ${fileName}.` })

                    const e_storedAssetsRaw = data.toString()
                    log.info(`Read wallet ${fileName} data OK - length=`, e_storedAssetsRaw.length)

                    svrWalletCreate.walletInit(appWorker, store, { mpk }, e_storedAssetsRaw)
                    .then(walletInit => {
                        if (walletInit.err) resolve(walletInit)
                        if (walletInit.ok) {
                            global.global.loadedWallet.dirty = false
                            utilsWallet.setTitle(`FILE WALLET - ${fileName}`)
                        }
                        resolve({ ok: { fileName, walletInit } })
                    })
                }
            })
        })
    },
}
