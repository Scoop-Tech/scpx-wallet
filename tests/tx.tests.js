
// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.

const appStore = require('../store')

const utilsWallet = require('../utils')

const svrWorkers = require('../svr-workers')
const svrWalletCreate = require('../svr-wallet/sw-create')
const svrWalletFunctions = require('../svr-wallet/sw-functions')
const svrWallet = require('../svr-wallet/sw-wallet')

const walletExternalActions = require('../actions/wallet-external')
const opsWallet = require('../actions/wallet')

it('can run a dummy tx test', async () => { expect(1).toEqual(1) })

/*
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
    it('can compute estimated tx fees for BTC_TEST', async () => {
        const result = await new Promise(async (resolve, reject) => {

            const create = await svrWalletCreate.walletNew(appStore.store)
            const storeState = appStore.getState()
            const wallet = storeState.wallet
            const asset = wallet.assets.find(p => p.symbol === 'BTC_TEST')

            //const feeData = await opsWallet.getAssetFeeData(asset)

            // ##########################
            // TODO: this should be a wallet-fn ...
            //       web3 issue ... >> want wallet-server-load to *properly* exercise multi-eth addr's w/ lots of tx's in each ...
            //       ----
            //      btc_test (insight api) issue ... (computeFee)

    //         const fee = await walletExternalActions.computeTxFee({
    //              asset: asset,
    //            feeData: feeData,
    //          sendValue: 0,
    // encryptedAssetsRaw: asset.assetsRaw, 
    //         useFastest: false, useSlowest: false, 
    //       activePubKey: create.ok.apk,
    //              h_mpk: create.ok.mpk,
    //        })

            resolve({ ok: true })
        })
        expect(result.ok).toBeDefined()
    })
})

*/