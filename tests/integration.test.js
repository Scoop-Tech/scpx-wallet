// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.

const BigNumber = require('bignumber.js')

const appStore = require('../store').store
const utilsWallet = require('../utils')

const svrWorkers = require('../svr-workers')
const svrWalletCreate = require('../svr-wallet/sw-create')
const svrWalletFunctions = require('../svr-wallet/sw-functions')
const svrWallet = require('../svr-wallet/sw-wallet')

const walletExternal = require('../actions/wallet-external')
const opsWallet = require('../actions/wallet')

// todo: https://github.com/Scoop-Tech/scpx-wallet/issues/22
// note: for manual coverage upload:  "codecov -t f65ece69-8be4-4cd8-bb6f-c397d2dbc967"

// testnet account - please help keep it topped up!
const serverTestWallet = {
        mpk: 'PW5JF9k3njzJ3F7fYgPTAKcHg1uDXoKonXhHpfDs4Sw2fJcwgHxVT',
      email: 'testnets@scoop.tech',
       keys: { 
           BTC_TEST: 'cR5Hhuf5RLe2B7j3DAgswUtph392pPNjcQpGFrMNrKYwMdPkZRbA,cTrdm9ohncpVDmJzqBqRBWpTNdM6r9VaEigSNNRFRVwBx5TgGKKR',
           ZEC_TEST: 'cNNtEmxCycmuTgdSLXNXPhLnGruMcz5NkZDQqfzVUrQnVgJyxeTX,cSGxJXBWQpL7a9t5wyovWjdQFKskBKm2Fo66QyPVqPJtyJQvq6mp',
           ETH_TEST: 'f1bcee63112cbcdecfe29da04ddd91d9278382fe2db8e060c77e84599da71ae0,804b5c750a68bfd59365f6353ac22272e217d38fc9badd10e1e93feb0e5f375a'
       }
}

beforeAll(async () => {
    global.loadedWallet = {}
    global.loadedServerWallet = {}

    console.log('process.env.NODE_ENV:', process.env.NODE_ENV)

    jasmine.DEFAULT_TIMEOUT_INTERVAL = 1000 * 60 * 3
    await svrWorkers.init(appStore)
})
afterAll(async () => {
    await new Promise((resolve) => {
        setTimeout(async () => {
            await svrWorkers.terminate()
            resolve()
        }, 2000)
    }) // allow time for console log to flush, also - https://github.com/nodejs/node/issues/21685
})

// CI integration suite 

describe('asset', function () {
    it('can create a new receive address for all asset types', async () => {
        expect.assertions(3)
        const result = await new Promise(async (resolve, reject) => {
            const create = await svrWalletCreate.walletNew(appWorker, appStore)
            var wallet = appStore.getState().wallet
            const ops = wallet.assets.map(asset => { 
                return svrWallet.fn(appWorker, appStore, { symbol: asset.symbol, mpk: create.ok.mpk }, 'ADD-ADDR')
            })
            const results = await Promise.all(ops)
            const countOk = results.filter(p => p.ok).length
            
            wallet = appStore.getState().wallet
            const countAdded = wallet.assets.filter(p => p.addresses.length === 2).length

            resolve({ create, countOk, countAdded })
        })
        const wallet = appStore.getState().wallet
        expect(result.create.ok).toBeDefined()
        expect(result.countOk).toEqual(wallet.assets.length)
        expect(result.countAdded).toEqual(wallet.assets.length)
    })

    it('can fetch suggested network fee rates for all asset types', async () => {
        expect.assertions(3)
        const result = await new Promise(async (resolve, reject) => {
            const create = await svrWalletCreate.walletNew(appWorker, appStore)
            const wallet = appStore.getState().wallet
            
            const ops = wallet.assets.map(asset => { 
                return svrWallet.fn(appWorker, appStore, { symbol: asset.symbol }, 'ASSET-GET-FEES')
            })
            const results = await Promise.all(ops)
            const countOk = results.filter(p => p.ok && p.ok.feeData &&
                (p.ok.feeData.fast_satPerKB || (p.ok.feeData.gasLimit && p.ok.feeData.gasprice_fast))).length
            const countAssets = wallet.assets.length

            resolve({ create, countOk, countAssets })
        })
        expect(result.create.ok).toBeDefined()
        expect(result.create.ok.walletConnect.ok).toBeDefined()
        expect(result.countOk).toEqual(result.countAssets)
    })
})

describe('wallet', function () {
    it('can create a new in-memory wallet', async () => {
        expect.assertions(1)
        const result = await new Promise(async (resolve, reject) => {
            resolve(await svrWalletCreate.walletNew(appWorker, appStore))
        })
        expect(result.ok).toBeDefined()
    })
    
    it('can dump a wallet', async () => {
        expect.assertions(3)
        const result = await new Promise(async (resolve, reject) => {
            const init = await svrWalletCreate.walletInit(appWorker, appStore, { mpk: serverTestWallet.mpk })
            const connect = await svrWalletFunctions.walletConnect(appWorker, appStore, {})
            const dump = await svrWallet.fn(appWorker, appStore, { mpk: init.ok.mpk, txs: true, keys: true }, 'DUMP')
            resolve( { init, connect, dump })
        })
        expect(result.init.ok).toBeDefined()
        expect(result.connect.ok).toBeDefined()
        expect(result.dump.ok).toBeDefined()
    })

    it('can reinitialize a known wallet in-memory', async () => {
        expect.assertions(3)
        const result = await new Promise(async (resolve, reject) => {
            const res = await svrWalletCreate.walletInit(appWorker, appStore, {
                mpk: "PW5KaarU5Jtg8dyQvM3CqYEz97T4rFozdAbXMfdBfmyRhafkuWKg6"
            })
            resolve(res)
        })
        expect(result.ok).toBeDefined()
        const storeState = appStore.getState()
        const eth = storeState.wallet.assets.find(p => p.symbol === 'ETH')
        const btc = storeState.wallet.assets.find(p => p.symbol === 'BTC_SEG')
        expect(eth.addresses[0].addr).toEqual('0x5556903a7233b3cc04918843ccdb43b1cdabb044')
        expect(btc.addresses[0].addr).toEqual('3Px58xg8Lowmst7gb1anuuW6R5NQSimjvh')
    })

    it('can persist a wallet to and from file', async function () {
        expect.assertions(11)
        const testWalletFile = `test${new Date().getTime()}`
        const result = await new Promise(async (resolve, reject) => {
            const create    = await svrWalletCreate.walletNew(appWorker, appStore)
            const mpk = create.ok.mpk
            const addEth    = await svrWallet.fn(appWorker, appStore, { mpk, symbol: 'ETH' }, 'ADD-ADDR')
            const addBtc    = await svrWallet.fn(appWorker, appStore, { mpk, symbol: 'BTC' }, 'ADD-ADDR')
            const addBtcSeg = await svrWallet.fn(appWorker, appStore, { mpk, symbol: 'BTC_SEG' }, 'ADD-ADDR')
            const addZec    = await svrWallet.fn(appWorker, appStore, { mpk, symbol: 'ZEC' }, 'ADD-ADDR')
            const save      = await svrWallet.fn(appWorker, appStore, { mpk, name: testWalletFile }, 'SAVE')
            const load      = await svrWallet.fn(appWorker, appStore, { mpk, name: testWalletFile }, 'LOAD')
            resolve({ create, addEth, addBtc, addBtcSeg, addZec, save, load })
        })
        expect(result.create.ok).toBeDefined()
        expect(result.addEth.ok).toBeDefined()
        expect(result.addBtc.ok).toBeDefined()
        expect(result.addBtcSeg.ok).toBeDefined()
        expect(result.addZec.ok).toBeDefined()
        expect(result.save.ok).toBeDefined()
        expect(result.load.ok).toBeDefined()

        const storeState = appStore.getState()
        const eth = storeState.wallet.assets.find(p => p.symbol === 'ETH')
        const btc = storeState.wallet.assets.find(p => p.symbol === 'BTC')
        const btcSeg = storeState.wallet.assets.find(p => p.symbol === 'BTC_SEG')
        const zec = storeState.wallet.assets.find(p => p.symbol === 'ZEC')
        expect(eth.addresses.length).toEqual(2)
        expect(btc.addresses.length).toEqual(2)
        expect(btcSeg.addresses.length).toEqual(2)
        expect(zec.addresses.length).toEqual(2)
    })

    it('can persist a wallet to and from the Data Storage Contract', async function () {
        expect.assertions(2)
        const result = await new Promise(async (resolve, reject) => {
            const serverLoad = await svrWallet.fn(appWorker, appStore, { mpk: serverTestWallet.mpk, email: serverTestWallet.email }, 'SERVER-LOAD')
            const serverSave = await svrWallet.fn(appWorker, appStore, { mpk: serverLoad.ok.walletInit.ok.mpk }, 'SERVER-SAVE')
            resolve({ serverLoad, serverSave })
        })
        expect(result.serverLoad.ok).toBeDefined()
        expect(result.serverSave.ok).toBeDefined()
    })

    it('can connect a wallet to 3PBPs', async () => {
        expect.assertions(2)
        const result = await new Promise(async (resolve, reject) => {
            const init = await svrWalletCreate.walletInit(appWorker, appStore, { mpk: serverTestWallet.mpk })
            resolve({ init })
        })
        expect(result.init.ok).toBeDefined()
        expect(result.init.ok.walletConnect.ok).toBeDefined()
    })

    it('can import and remove private keys', async () => {
        expect.assertions(14)

        const result = await new Promise(async (resolve, reject) => {
            const create = await svrWalletCreate.walletNew(appWorker, appStore)
            const mpk = create.ok.mpk
            
            const importBtcTest = await svrWallet.fn(appWorker, appStore, 
                { mpk, symbol: 'BTC_TEST', privKeys: serverTestWallet.keys.BTC_TEST }, 'ADD-PRIV-KEYS')

            const importZecTest = await svrWallet.fn(appWorker, appStore, 
                { mpk, symbol: 'ZEC_TEST', privKeys: serverTestWallet.keys.ZEC_TEST }, 'ADD-PRIV-KEYS')

            const importEthTest = await svrWallet.fn(appWorker, appStore, 
                { mpk, symbol: 'ETH_TEST', privKeys: serverTestWallet.keys.ETH_TEST }, 'ADD-PRIV-KEYS')

            //await Promise.resolve(setTimeout(() => {}, 2000))
            const balanceImported = await svrWallet.fn(appWorker, appStore, { mpk }, 'BALANCE')

            const removeBtcTest = await svrWallet.fn(appWorker, appStore, 
                { mpk, symbol: 'BTC_TEST', accountName: 'Import #1 BTC#' }, 'REMOVE-PRIV-KEYS')

            const removeZecTest = await svrWallet.fn(appWorker, appStore, 
                { mpk, symbol: 'ZEC_TEST', accountName: 'Import #1 ZEC#' }, 'REMOVE-PRIV-KEYS')

            const removeEthTest = await svrWallet.fn(appWorker, appStore, 
                { mpk, symbol: 'ETH_TEST', accountName: 'Import #1 ETH#' }, 'REMOVE-PRIV-KEYS')

            //await Promise.resolve(setTimeout(() => {}, 2000))
            const balanceRemoved = await svrWallet.fn(appWorker, appStore, { mpk }, 'BALANCE')

            resolve({ create,
                        importBtcTest, importZecTest, importEthTest, balanceImported,
                        removeBtcTest, removeZecTest, removeEthTest, balanceRemoved })
        })

        expect(result.create.ok).toBeDefined()
        expect(result.create.ok.walletConnect.ok).toBeDefined()
        
        expect(result.importBtcTest.ok.importPrivKeys.importedAddrCount).toEqual(2)
        expect(result.importZecTest.ok.importPrivKeys.importedAddrCount).toEqual(2)
        expect(result.importEthTest.ok.importPrivKeys.importedAddrCount).toEqual(2)
        expect(Number(result.balanceImported.ok.balances.find(p => p.symbol === 'BTC_TEST').conf)).toBeGreaterThan(0)
        expect(Number(result.balanceImported.ok.balances.find(p => p.symbol === 'ZEC_TEST').conf)).toBeGreaterThan(0)
        expect(Number(result.balanceImported.ok.balances.find(p => p.symbol === 'ETH_TEST').conf)).toBeGreaterThan(0)

        expect(result.removeBtcTest.ok.removeImportedAccounts.removedAddrCount).toEqual(2)
        expect(result.removeZecTest.ok.removeImportedAccounts.removedAddrCount).toEqual(2)
        expect(result.removeEthTest.ok.removeImportedAccounts.removedAddrCount).toEqual(2)
        expect(Number(result.balanceRemoved.ok.balances.find(p => p.symbol === 'BTC_TEST').conf)).toEqual(0)
        expect(Number(result.balanceRemoved.ok.balances.find(p => p.symbol === 'ZEC_TEST').conf)).toEqual(0)
        expect(Number(result.balanceRemoved.ok.balances.find(p => p.symbol === 'ETH_TEST').conf)).toEqual(0)
    })
})

// testnet integration suite
describe('testnets', function () {

    it('can connect 3PBP (Insight REST API), create tx hex, compute tx fees and push a tx for UTXO-model BTC_TEST', async () => {
        const serverLoad = await svrWallet.fn(appWorker, appStore, { mpk: serverTestWallet.mpk, email: serverTestWallet.email }, 'SERVER-LOAD')
        await new Promise((resolve) => setTimeout(() => { resolve() }, 1000)) // allow time for reducers to populate store
        await sendTestnetTx(appStore, serverLoad, 'BTC_TEST')
    })

    it('can connect 3PBP (Blockbook WS API), create tx hex, compute tx fees and push a tx for UTXO-model ZEC_TEST', async () => {
        const serverLoad = await svrWallet.fn(appWorker, appStore, { mpk: serverTestWallet.mpk, email: serverTestWallet.email }, 'SERVER-LOAD')
        await new Promise((resolve) => setTimeout(() => { resolve() }, 1000))
        await sendTestnetTx(appStore, serverLoad, 'ZEC_TEST')
    })

    it('can connect 3PBP (Blockbook WS API + Geth RPC), create tx hex, compute tx fees and push a tx for account-model ETH_TEST', async () => {
        const serverLoad = await svrWallet.fn(appWorker, appStore, { mpk: serverTestWallet.mpk, email: serverTestWallet.email }, 'SERVER-LOAD')
        await new Promise((resolve) => setTimeout(() => { resolve() }, 1000))
        await sendTestnetTx(appStore, serverLoad, 'ETH_TEST')
    })

    async function sendTestnetTx(store, serverLoad, testSymbol) {
        expect.assertions(8)
        const mpk = serverLoad.ok.walletInit.ok.mpk
        
        const result = await new Promise(async (resolve, reject) => {

            // load test wallet, check test asset
            const wallet = store.getState().wallet
            
            const asset = wallet.assets.find(p => p.symbol === testSymbol)
            if (!asset) throw `${testSymbol} is not configured`

            // validate test asset state
            const bal = walletExternal.get_combinedBalance(asset)
            if (!bal.avail.isGreaterThan(0)) throw 'Invalid testnet balance data'
            if (asset.addresses.length < 2) throw 'Invalid test asset address setup'

            // send testnet tx from the higher balance address to the lower
            const sendAddrNdx = asset.addresses[0].balance > asset.addresses[1].balance ? 0 : 1
            const receiveAddrNdx = sendAddrNdx == 1 ? 0 : 1
            var du_sendBalance = Number(utilsWallet.toDisplayUnit(new BigNumber(asset.addresses[sendAddrNdx].balance), asset))
            const sendValue = (du_sendBalance * 0.1).toFixed(6)
            if (sendValue < 0.00001) throw 'Insufficient test currency'

            // get tx fee
            const txGetFee = await svrWallet.fn(appWorker, appStore, { mpk, symbol: testSymbol, value: sendValue }, 'TX-GET-FEE')
            const txFee = txGetFee.ok.txFee

            // push tx
            const txPush = await svrWallet.fn(appWorker, appStore,
                { mpk, symbol: testSymbol,
                        value: sendValue,
                           to: asset.addresses[receiveAddrNdx].addr,
                         from: asset.addresses[sendAddrNdx].addr
                }, 'TX-PUSH')

            const txid = txPush.ok.txid
           
            resolve({ serverLoad, txFee, txid })
        })
        
        expect(result.serverLoad.ok).toBeDefined()
        expect(result.serverLoad.ok.walletInit.ok.walletConnect.ok).toBeDefined()
        expect(result.txFee).toBeDefined()
        expect(Number(result.txFee.fee)).toBeGreaterThan(0)
        expect(result.txFee.inputsCount).toBeGreaterThan(0)
        if (testSymbol === 'ETH_TEST') {
            expect(Number(result.txFee.eth_gasLimit)).toBeGreaterThan(0)
            expect(Number(result.txFee.eth_gasPrice)).toBeGreaterThan(0)
        }
        else {
            expect(Number(result.txFee.utxo_satPerKB)).toBeGreaterThan(0)
            expect(Number(result.txFee.utxo_vsize)).toBeGreaterThan(0)
        }
        expect(result.txid).toBeDefined()
    }
})
