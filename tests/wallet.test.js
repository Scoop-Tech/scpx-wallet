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

describe('wallet', function () {

    it('can create a new wallet', async () => {
        const result = await new Promise(async (resolve, reject) => {
            resolve(await svrWalletCreate.walletNew(appStore.store))
        })
        expect(result.ok).toBeDefined()
    })
      
    it('can dump a wallet', async () => {
        const result = await new Promise(async (resolve, reject) => {
            const create = await svrWalletCreate.walletNew(appStore.store)
            const dump = await svrWallet.walletFunction(appStore.store, {}, 'DUMP')
            resolve( { create, dump })
        })
        expect(result.create.ok).toBeDefined()
        expect(result.dump.ok).toBeDefined()
    })

    it('can reinitialize a known wallet', async () => {
        const result = await new Promise(async (resolve, reject) => {
            const res = await svrWalletCreate.walletInit(appStore.store, {
                mpk: "PW5KaarU5Jtg8dyQvM3CqYEz97T4rFozdAbXMfdBfmyRhafkuWKg6",
                apk: "EOS6zgkUZ9Eextd98fxnRP5PpH43XucbP3jVEeuXMHLiqvX7QsmeP",
            })
            resolve(res)
        })
        expect(result.ok).toBeDefined()
        const storeState = appStore.store.getState()
        const eth = storeState.wallet.assets.find(p => p.symbol === 'ETH')
        const btc = storeState.wallet.assets.find(p => p.symbol === 'BTC_SEG')
        expect(eth.addresses[0].addr).toEqual('0x5556903a7233b3cc04918843ccdb43b1cdabb044')
        expect(btc.addresses[0].addr).toEqual('3Px58xg8Lowmst7gb1anuuW6R5NQSimjvh')
    })

    it('can connect a wallet to 3PBPs', async () => {
        const globalScope = utilsWallet.getMainThreadGlobalScope()
        const result = await new Promise(async (resolve, reject) => {
            const create = await svrWalletCreate.walletNew(appStore.store)
            const connect = await svrWalletFunctions.connectData(globalScope.appWorker, appStore.store, {})
            resolve({ create, connect })
        })
        expect(result.create.ok).toBeDefined()
        expect(result.connect.ok).toBeDefined()
    })

    it('can persist a wallet', async function () {
        const testWalletFile = `test${new Date().getTime()}`
        const result = await new Promise(async (resolve, reject) => {
            const create = await svrWalletCreate.walletNew(appStore.store)
            const save = await svrWallet.walletFunction(appStore.store, { n: testWalletFile }, 'SAVE')
            const load = await svrWallet.walletFunction(appStore.store, { n: testWalletFile }, 'LOAD')
            resolve({ create, save, load })
        })
        expect(result.create.ok).toBeDefined()
        expect(result.save.ok).toBeDefined()
        expect(result.load.ok).toBeDefined()
    })
})
