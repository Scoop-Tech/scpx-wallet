// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.

const BigNumber = require('bignumber.js')

const appStore = require('../store')
const utilsWallet = require('../utils')

const svrWorkers = require('../svr-workers')
const svrWalletCreate = require('../svr-wallet/sw-create')
const svrWalletFunctions = require('../svr-wallet/sw-functions')
const svrWallet = require('../svr-wallet/sw-wallet')

const walletExternal = require('../actions/wallet-external')
const opsWallet = require('../actions/wallet')

const serverTestWallet = { mpk: 'PW5JF9k3njzJ3F7fYgPTAKcHg1uDXoKonXhHpfDs4Sw2fJcwgHxVT', email: 'testnets@scoop.tech' }

beforeAll(async () => {
    global.loadedWalletKeys = {}
    global.loadedServerWallet = {}

    console.log('process.env.NODE_ENV:', process.env.NODE_ENV)

    jasmine.DEFAULT_TIMEOUT_INTERVAL = 1000 * 60 * 3
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

describe('travis', function () {

    describe('asset', function () {

        it('can create a new receive address for all asset types', async () => {
            const result = await new Promise(async (resolve, reject) => {
                const create = await svrWalletCreate.walletNew(appStore.store)
                var wallet = appStore.store.getState().wallet
                const ops = wallet.assets.map(asset => { 
                    return svrWallet.walletFunction(appStore.store, { s: asset.symbol, mpk: create.ok.mpk }, 'ADD-ADDR')
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

        it('can create a new in-memory wallet', async () => {
            const result = await new Promise(async (resolve, reject) => {
                resolve(await svrWalletCreate.walletNew(appStore.store))
            })
            expect(result.ok).toBeDefined()
        })
        
        it('can dump a wallet', async () => {
            const result = await new Promise(async (resolve, reject) => {
                const create = await svrWalletCreate.walletNew(appStore.store)
                const dump = await svrWallet.walletFunction(appStore.store, { mpk: create.ok.mpk }, 'DUMP')
                resolve( { create, dump })
            })
            expect(result.create.ok).toBeDefined()
            expect(result.dump.ok).toBeDefined()
        })

        it('can reinitialize in-memory a known wallet', async () => {
            const result = await new Promise(async (resolve, reject) => {
                const res = await svrWalletCreate.walletInit(appStore.store, {
                    mpk: "PW5KaarU5Jtg8dyQvM3CqYEz97T4rFozdAbXMfdBfmyRhafkuWKg6"
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

        it('can persist a wallet to and from file', async function () {
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

        it('can persist a wallet to and from the Data Storage Contract', async function () {
            const result = await new Promise(async (resolve, reject) => {
                const load = await svrWallet.walletFunction(appStore.store, { mpk: serverTestWallet.mpk, e: serverTestWallet.email }, 'SERVER-LOAD')
                const save = await svrWallet.walletFunction(appStore.store, { mpk: load.ok.walletInitResult.ok.mpk }, 'SERVER-SAVE')
                resolve({ load, save })
            })
            expect(result.load.ok).toBeDefined()
            expect(result.save.ok).toBeDefined()
        })

        it('can connect a wallet to 3PBPs', async () => {
            const result = await new Promise(async (resolve, reject) => {
                const appWorker = utilsWallet.getAppWorker()
                const init = await svrWalletCreate.walletInit(appStore.store, { mpk: serverTestWallet.mpk })
                const connect = await svrWalletFunctions.connectData(appWorker, appStore.store, {})
                resolve({ init, connect })
            })
            expect(result.init.ok).toBeDefined()
            expect(result.connect.ok).toBeDefined()
        })
    })
})

describe('testnets', function () {

    it('can connect 3PBP (Insight API), create tx hex and compute tx fees for BTC_TEST', async () => {
        const result = await new Promise(async (resolve, reject) => {
            // load test wallet, check test asset
            const appWorker = utilsWallet.getAppWorker()
            const load = await svrWallet.walletFunction(appStore.store, { mpk: serverTestWallet.mpk, e: serverTestWallet.email }, 'SERVER-LOAD')
            const connect = await svrWalletFunctions.connectData(appWorker, appStore.store, {})
            const wallet = appStore.store.getState().wallet
            const asset = wallet.assets.find(p => p.symbol === 'BTC_TEST')
            if (!asset) throw ('BTC_TEST is not configured')

            // validate test asset state
            const bal = walletExternal.get_combinedBalance(asset)
            if (!bal.avail.isGreaterThan(0)) throw('Invalid testnet balance data')
            if (asset.addresses.length < 2) throw('Invalid test asset address setup')

            // get network fee rate, compute null tx fee
            const feeData = await opsWallet.getAssetFeeData(asset)
            const txFee = await walletExternal.computeTxFee({
                              asset: asset,
                            feeData: feeData,
                          sendValue: 0,
                 encryptedAssetsRaw: wallet.assetsRaw, 
                         useFastest: false, useSlowest: false, 
                       activePubKey: load.ok.apk,
                              h_mpk: load.ok.h_mpk,
            })
            console.log('txFee asset=', txFee)

            //...

            // send tx... use server account so can topup easily, also server account can have 2 addr of each test type
            //            test can pick addr with greatest balance and send min amount to addr with smaller balance

            resolve({ load, connect, txFee })
        })
        expect(result.load.ok).toBeDefined()
        expect(result.connect.ok).toBeDefined()
        expect(result.txFee).toBeDefined()
        expect(result.txFee.fee).toBeGreaterThan(0)
        expect(result.txFee.inputsCount).toBeGreaterThan(0)
        expect(result.txFee.utxo_satPerKB).toBeGreaterThan(0)
        expect(result.txFee.utxo_vsize).toBeGreaterThan(0)
    })
})
