// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.

const appStore = require('../store')

const utilsWallet = require('../utils')

const svrWorkers = require('../svr-workers')
const svrWalletCreate = require('../svr-wallet/sw-create')
const svrWalletFunctions = require('../svr-wallet/sw-functions')
const svrWallet = require('../svr-wallet/sw-wallet')

beforeAll(async () => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 1000 * 60
    await svrWorkers.workers_init(appStore.store)
})

afterAll(async () => {
    await new Promise((resolve) => {
        setTimeout(async () => {
            await svrWorkers.workers_terminate()
            resolve()
        }, 1000)
    }) // allow time for console log to flush, also - https://github.com/nodejs/node/issues/21685
})

describe('asset', function () {

    it('can create a new receive address for all asset types', async () => {
        const result = await new Promise(async (resolve, reject) => {
            const create = await svrWalletCreate.walletNew(appStore.store)
            const wallet = appStore.store.getState().wallet
            var countOk = 0
            wallet.assets.forEach(async (asset) => {
                const add = await svrWallet.walletFunction(appStore.store, { s: asset.symbol }, 'ADD-ADDR')
                if (add.ok) countOk++
            })
            resolve({ create, countOk })
        })
        const wallet = appStore.store.getState().wallet
        expect(result.create.ok).toBeDefined()
        expect(result.create.countOk).toEqual(wallet.assets.length)
    })
})
