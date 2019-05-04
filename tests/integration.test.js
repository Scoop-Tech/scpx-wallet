// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.

const appStore = require('../store')

const utilsWallet = require('../utils')

const svrWorkers = require('../svr-workers')
const svrWalletCreate = require('../svr-wallet/sw-create')
const svrWalletFunctions = require('../svr-wallet/sw-functions')
const svrWallet = require('../svr-wallet/sw-wallet')

const walletExternalActions = require('../actions/wallet-external')
const opsWallet = require('../actions/wallet')

beforeAll(async () => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 1000 * 60 * 2
    await svrWorkers.workers_init(appStore.store)
})
afterAll(async () => {
    await new Promise((resolve) => {
        setTimeout(async () => {
            await svrWorkers.workers_terminate()
            resolve()
        }, 2000)
    }) // allow time for console log to flush, also - https://github.com/nodejs/node/issues/21685
})

describe('asset', function () {

    it('can create a new receive address for all asset types', async () => {
        const result = await new Promise(async (resolve, reject) => {
            const create = await svrWalletCreate.walletNew(appStore.store)
            var wallet = appStore.store.getState().wallet
            const ops = wallet.assets.map(asset => { 
                return svrWallet.walletFunction(appStore.store, { s: asset.symbol }, 'ADD-ADDR')
            })
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

    it('can fetch suggested network fee rates for all asset types', async () => {
        const result = await new Promise(async (resolve, reject) => {
            const appWorker = utilsWallet.getAppWorker()
            const create = await svrWalletCreate.walletNew(appStore.store)
            const connect = await svrWalletFunctions.connectData(appWorker, appStore.store, {})
            const wallet = appStore.store.getState().wallet
            
            const ops = wallet.assets.map(asset => { 
                return svrWallet.walletFunction(appStore.store, { s: asset.symbol }, 'ASSET-GET-FEES')
            })
            const results = await Promise.all(ops)
            const countOk = results.filter(p => p.ok && p.ok.feeData &&
                (p.ok.feeData.fast_satPerKB || (p.ok.feeData.gasLimit && p.ok.feeData.gasprice_fast))).length
            const countAssets = wallet.assets.length

            resolve({ create, connect, countOk, countAssets })
        })
        expect(result.create.ok).toBeDefined()
        expect(result.connect.ok).toBeDefined()
        expect(result.countOk).toEqual(result.countAssets)
    })
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
        const result = await new Promise(async (resolve, reject) => {
            const appWorker = utilsWallet.getAppWorker()
            const create = await svrWalletCreate.walletNew(appStore.store)
            const connect = await svrWalletFunctions.connectData(appWorker, appStore.store, {})
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
            const load = await svrWallet.walletFunction(appStore.store, { mpk: create.ok.mpk, n: testWalletFile }, 'LOAD')
            resolve({ create, save, load })
        })
        expect(result.create.ok).toBeDefined()
        expect(result.save.ok).toBeDefined()
        expect(result.load.ok).toBeDefined()
    })
})

/*describe('tx', function () {
    
    it('can compute fees for a specific transacation for all asset types', async () => {
        const result = await new Promise(async (resolve, reject) => {

            const appWorker = utilsWallet.getAppWorker()
            const create = await svrWalletCreate.walletNew(appStore.store)
            const connect = await svrWalletFunctions.connectData(appWorker, appStore.store, {})
            const wallet = appStore.store.getState().wallet
            
            const ops = wallet.assets.map(asset => { 
                return new Promise(async (resolve, reject) => {

                    // get recommended network fee rates
                    const feeData = await opsWallet.getAssetFeeData(asset) 

                    // ##########################
                    // #####   btc_test (insight api) issue ... (computeFee)

                    // get specific tx fee
                    const txFee = await walletExternalActions.computeTxFee({
                              asset: asset,
                            feeData: feeData,
                          sendValue: 0,
                 encryptedAssetsRaw: wallet.assetsRaw, 
                         useFastest: false, useSlowest: false, 
                       activePubKey: create.ok.apk,
                              h_mpk: create.ok.h_mpk,
                    })
                    resolve(txFee.fee)
                })
            })
            const results = await Promise.all(ops)
            const countOk = results.filter(p => p.fee && Number(p.fee) > 0).length
            const countAssets = wallet.assets.length

            resolve({ create, connect, countOk, countAssets })
        })
        expect(result.create.ok).toBeDefined()
        expect(result.connect.ok).toBeDefined()
        expect(result.countOk).toEqual(result.countAssets)
    })
})*/

//it('can run a dummy test', async () => { expect(1).toEqual(1) })