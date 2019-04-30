'use strict';

const _ = require('lodash')

const configWallet = require('../config/wallet')
const walletActions = require('../actions/wallet')
const utilsWallet = require('../utils')

const opsWallet = require('../actions/wallet')

const swCreate = require('./sw-create')

const log = require('../cli-log')

//
// wallet file persistence
//

module.exports = {
    walletSave: (appWorker, store, p) => {
        var { mpk, apk, n, f } = p
        log.cmd('walletSave')
        log.param(`apk`, apk, `(param)`)
        log.param(`mpk`, mpk, `(param)`)

        const e_assetsRaw = store.getState().wallet.assetsRaw

        // validate
        if (!n || n.length === 0 || n === true) return new Promise((resolve) => resolve({ err: `Wallet name is required` }))
        if (n.toString().match(/^[a-z0-9]+$/i) == null) return new Promise((resolve) => resolve({ err: `Wallet name must be alphanumeric characters only` }))
        const fileName = `./wallet_${n.toString()}.dat`
        log.param('n', fileName, '(param)')

        var overwrite = false
        if (utilsWallet.isParamTrue(f)) {
            overwrite = true
            log.param(`f`, overwrite, `(param)`)
        }

        // check overwrite
        const fs = require('fs')
        const exists = fs.existsSync(fileName)
        if (exists && !overwrite) return new Promise((resolve) => resolve({ err: `File ${fileName} already exists. Use --f to overwrite.` }))

        // exec
        return new Promise((resolve) => {
            fs.writeFile(fileName, e_assetsRaw, function (err) {

                if (err) resolve({ err })
                else {
                    log.warn(`the supplied MPK and APK will be required to load this wallet.`)
                    resolve({ ok: fileName })
                }
            })
        })
    },

    walletLoad: (appWorker, store, p) => {
        var { mpk, apk, n } = p
        log.cmd('walletLoad')
        log.param(`apk`, apk, `(param)`)
        log.param(`mpk`, mpk, `(param)`)

        // validate
        if (!n || n.length == 0) return new Promise((resolve) => resolve({ err: `Wallet name is required` }))
        if (n.toString().match(/^[a-z0-9]+$/i) == null) return new Promise((resolve) => resolve({ err: `Wallet name must be alphanumeric characters only` }))
        const fileName = `./wallet_${n.toString()}.dat`
        log.param('n', fileName, '(param)')

        // check exists
        const fs = require('fs')
        const exists = fs.existsSync(fileName)
        if (!exists) return new Promise((resolve) => resolve({ err: `File ${fileName} not found.` }))

        // exec
        return new Promise((resolve) => {
            fs.readFile(fileName, "utf8", function (err, data) {
                if (err) resolve({ err })
                else {
                    if (!data || data.length == 0) return new Promise((resolve) => resolve({ err: `No data in file ${fileName}.` }))

                    const e_storedAssetsRaw = data.toString()
                    log.info(`Read wallet ${fileName} data OK - length=`, e_storedAssetsRaw.length)

                    swCreate.walletInit(store, { mpk, apk }, e_storedAssetsRaw)
                    .then(walletInitResult => {
                        if (walletInitResult.err) resolve(walletInitResult)
                        resolve({ ok: { fileName, walletInitResult } })
                    })
                }
            })
        })
    },

}
