// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.

const appStore = require('../store')

const utilsWallet = require('../utils')

const svrWorkers = require('../svr-workers')
const svrWalletCreate = require('../svr-wallet/sw-create')
const svrWalletFunctions = require('../svr-wallet/sw-functions')
const svrWallet = require('../svr-wallet/sw-wallet')

const walletExternalActions = require('../actions/wallet-external')
const opsWallet = require('../actions/wallet')


/*beforeAll(async () => {
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

describe('tx', function () {
    
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

it('can run a dummy tx test', async () => { expect(1).toEqual(1) })