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
            var wallet = appStore.store.getState().wallet
            const ops = wallet.assets.map(asset => { return svrWallet.walletFunction(appStore.store, { s: asset.symbol }, 'ADD-ADDR') })
            const results = await Promise.all(ops)
            const countOk = results.filter(p => p.ok).length
            
            wallet = appStore.store.getState().wallet
            const countAdded = wallet.assets.filter(p => p.addresses.length === 2).length

            resolve({ create, countOk, countAdded })
        })
        const wallet = appStore.store.getState().wallet
        expect(result.create.ok).toBeDefined()
        expect(result.countOk).toEqual(wallet.assets.length)
        expect(result.countAdded).toEqual(wallet.assets.length)
    })
})

//it('can run a dummy asset test', async () => { expect(1).toEqual(1) })

