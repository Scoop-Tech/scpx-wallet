// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.

require('dotenv').config();

const BigNumber = require('bignumber.js')

const appStore = require('../store').store
const utilsWallet = require('../utils')

const svrWorkers = require('../svr-workers')
const svrWalletCreate = require('../svr-wallet/sw-create')
const svrWalletFunctions = require('../svr-wallet/sw-functions')
const svrRouter = require('../svr-wallet/sw-router')

const walletExternal = require('../actions/wallet-external')
const opsWallet = require('../actions/wallet')

const configWallet = require('../config/wallet')

// todo: https://github.com/Scoop-Tech/scpx-wallet/issues/22
// note: for manual coverage upload:  "codecov -t f65ece69-8be4-4cd8-bb6f-c397d2dbc967"

// testnets 
const serverTestWallet = {
      mpk: process.env.TESTNETS2_MPK,
    email: process.env.TESTNETS2_EMAIL,
     keys: { 
        BTC_TEST: process.env.TESTNETS2_KEYS_BTC_TEST,
        ZEC_TEST: process.env.TESTNETS2_KEYS_ZEC_TEST,
        ETH_TEST: process.env.TESTNETS2_KEYS_ETH_TEST,
    }
}

beforeAll(async () => {
    global.loadedWallet = {}
    global.loadedServerWallet = {}

    console.log('process.env.NODE_ENV:', process.env.NODE_ENV)

    jasmine.DEFAULT_TIMEOUT_INTERVAL = 1000 * 60 * 10
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

describe('asset', function () {

    it('can create a new receive address for all asset types', async () => {
        expect.assertions(3)
        const result = await new Promise(async (resolve, reject) => {
            const create = await svrWalletCreate.walletNew(appWorker, appStore)
            var wallet = appStore.getState().wallet
            
            const results = []
            for (var i=0 ; i < wallet.assets.length ; i++) {
                const asset = wallet.assets[i]
                results.push(await svrRouter.fn(appWorker, appStore, { symbol: asset.symbol, mpk: create.ok.mpk }, 'ADD-ADDR'))
            }
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
                return svrRouter.fn(appWorker, appStore, { symbol: asset.symbol }, 'ASSET-GET-FEES')
            })
            const results = await Promise.all(ops)
            console.log('results', results)
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
            const dump = await svrRouter.fn(appWorker, appStore, { mpk: init.ok.mpk, txs: true, keys: true }, 'DUMP')
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
            const addEth    = await svrRouter.fn(appWorker, appStore, { mpk, symbol: 'ETH' }, 'ADD-ADDR')
            const addBtc    = await svrRouter.fn(appWorker, appStore, { mpk, symbol: 'BTC' }, 'ADD-ADDR')
            const addBtcSeg = await svrRouter.fn(appWorker, appStore, { mpk, symbol: 'BTC_SEG' }, 'ADD-ADDR')
            const addZec    = await svrRouter.fn(appWorker, appStore, { mpk, symbol: 'ZEC' }, 'ADD-ADDR')
            const save      = await svrRouter.fn(appWorker, appStore, { mpk, name: testWalletFile }, 'SAVE')
            const load      = await svrRouter.fn(appWorker, appStore, { mpk, name: testWalletFile }, 'LOAD')
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
            const serverLoad = await svrRouter.fn(appWorker, appStore, { mpk: serverTestWallet.mpk, email: serverTestWallet.email }, 'SERVER-LOAD')
            const serverSave = await svrRouter.fn(appWorker, appStore, { mpk: serverLoad.ok.walletInit.ok.mpk }, 'SERVER-SAVE')
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
        var expectAssertions = 2
        if (configWallet.WALLET_INCLUDE_BTC_TEST) expectAssertions += 3
        if (configWallet.WALLET_INCLUDE_ZEC_TEST) expectAssertions += 3
        if (configWallet.WALLET_INCLUDE_ETH_TEST) expectAssertions += 3
        expect.assertions(expectAssertions)

        const result = await new Promise(async (resolve, reject) => {
            const create = await svrWalletCreate.walletNew(appWorker, appStore)
            const mpk = create.ok.mpk
            const balancePrior = await svrRouter.fn(appWorker, appStore, { mpk }, 'BALANCE')
            //console.log('balancePrior', balancePrior)

            // import priv-keys
            const importBtcTest = !configWallet.WALLET_INCLUDE_BTC_TEST ? undefined :
                await svrRouter.fn(appWorker, appStore, { mpk, symbol: 'BTC_TEST', privKeys: serverTestWallet.keys.BTC_TEST }, 'ADD-PRIV-KEYS')

            const importZecTest = !configWallet.WALLET_INCLUDE_ZEC_TEST ? undefined :
                await svrRouter.fn(appWorker, appStore, { mpk, symbol: 'ZEC_TEST', privKeys: serverTestWallet.keys.ZEC_TEST }, 'ADD-PRIV-KEYS')

            const importEthTest = !configWallet.WALLET_INCLUDE_ETH_TEST ? undefined :
                await svrRouter.fn(appWorker, appStore, { mpk, symbol: 'ETH_TEST', privKeys: serverTestWallet.keys.ETH_TEST }, 'ADD-PRIV-KEYS')

            const balanceImported = await svrRouter.fn(appWorker, appStore, { mpk }, 'BALANCE') //await Promise.resolve(setTimeout(() => {}, 2000))

            // remove priv-keys
            const removeBtcTest = !configWallet.WALLET_INCLUDE_BTC_TEST ? undefined :
                await svrRouter.fn(appWorker, appStore, { mpk, symbol: 'BTC_TEST', accountName: 'Import #1 BTC#' }, 'REMOVE-PRIV-KEYS')

            const removeZecTest = !configWallet.WALLET_INCLUDE_ZEC_TEST ? undefined :
                await svrRouter.fn(appWorker, appStore, { mpk, symbol: 'ZEC_TEST', accountName: 'Import #1 ZEC#' }, 'REMOVE-PRIV-KEYS')

            const removeEthTest = !configWallet.WALLET_INCLUDE_ETH_TEST ? undefined :
                await svrRouter.fn(appWorker, appStore, { mpk, symbol: 'ETH_TEST', accountName: 'Import #1 ETH#' }, 'REMOVE-PRIV-KEYS')

            const balanceRemoved = await svrRouter.fn(appWorker, appStore, { mpk }, 'BALANCE') //await Promise.resolve(setTimeout(() => {}, 2000))

            resolve({ create,
                      importBtcTest, importZecTest, importEthTest, balanceImported,
                      removeBtcTest, removeZecTest, removeEthTest, balanceRemoved,
                      balancePrior })
        })

        expect(result.create.ok).toBeDefined()
        expect(result.create.ok.walletConnect.ok).toBeDefined()

        if (configWallet.WALLET_INCLUDE_BTC_TEST) {
            expect(result.importBtcTest.ok.importPrivKeys.importedAddrCount).toEqual(2)
            expect(result.removeBtcTest.ok.removeImportedAccounts.removedAddrCount).toEqual(2)
            expect(Number(result.balanceImported.ok.balances.find(p => p.symbol === 'BTC_TEST').conf)).toBeGreaterThan(0)
        }

        if (configWallet.WALLET_INCLUDE_ZEC_TEST) {
            expect(result.importZecTest.ok.importPrivKeys.importedAddrCount).toEqual(2)
            expect(result.removeZecTest.ok.removeImportedAccounts.removedAddrCount).toEqual(2)
            expect(Number(result.balanceImported.ok.balances.find(p => p.symbol === 'ZEC_TEST').conf)).toBeGreaterThan(0)
        }

        if (configWallet.WALLET_INCLUDE_ETH_TEST) {
            expect(result.importEthTest.ok.importPrivKeys.importedAddrCount).toEqual(2)
            expect(result.removeEthTest.ok.removeImportedAccounts.removedAddrCount).toEqual(2)
            expect(Number(result.balanceImported.ok.balances.find(p => p.symbol === 'ETH_TEST').conf)).toBeGreaterThan(0)
        }
    })
})

// testnet integration suite
describe('transactions', function () {

    it('can connect 3PBP (Blockbook WS API), create tx hex, compute tx fees and push a standard tx for P2SH(P2WSH) BTC_TEST', async () => {
        if (configWallet.WALLET_INCLUDE_BTC_TEST) {
            const serverLoad = await svrRouter.fn(appWorker, appStore, { mpk: serverTestWallet.mpk, email: serverTestWallet.email }, 'SERVER-LOAD')
            await new Promise((resolve) => setTimeout(() => { resolve() }, 1000)) // allow time for reducers to populate store
            await sendTestnetTx(appStore, serverLoad, 'BTC_TEST')
        }
    })

    it('can connect 3PBP (Blockbook WS API), create tx hex, compute tx fees and push a standard tx for P2SH(P2WSH) ZEC_TEST', async () => {
        if (configWallet.WALLET_INCLUDE_ZEC_TEST) {
            const serverLoad = await svrRouter.fn(appWorker, appStore, { mpk: serverTestWallet.mpk, email: serverTestWallet.email }, 'SERVER-LOAD')
            await new Promise((resolve) => setTimeout(() => { resolve() }, 1000))
            await sendTestnetTx(appStore, serverLoad, 'ZEC_TEST')
        }
    })

    it('can connect 3PBP (Blockbook WS API + Geth RPC), create tx hex, compute tx fees and push a standard tx for account-based ETH_TEST', async () => {
        if (configWallet.WALLET_INCLUDE_ETH_TEST) {
            var serverLoad = await svrRouter.fn(appWorker, appStore, { mpk: serverTestWallet.mpk, email: serverTestWallet.email }, 'SERVER-LOAD')
            await new Promise((resolve) => setTimeout(() => { resolve() }, 1000))

            // ## ETH_TEST on DSR-saved testnets2@scoop.tech is sometimes dropping second address...
            // no idea why (no repro in wallet front end)... suspected: some side-effect of automated tests?
            var wallet = appStore.getState().wallet
            var asset = wallet.assets.find(p => p.symbol === 'ETH_TEST')
            if (asset.addresses.length < 2) { // hack: add second addr & reload
                await svrRouter.fn(appWorker, appStore, { symbol: 'ETH_TEST', mpk: serverTestWallet.mpk }, 'ADD-ADDR')
                wallet = appStore.getState().wallet
                asset = wallet.assets.find(p => p.symbol === 'ETH_TEST')
            }

            await sendTestnetTx(appStore, serverLoad, 'ETH_TEST')
        }
    })

    it('can connect 3PBP (Blockbook WS API), create tx hex, compute tx fees and push a non-standard tx for P2SH(DSIG/CLTV) BTC_TEST', async () => {
        if (configWallet.WALLET_INCLUDE_BTC_TEST) {
            const serverLoad = await svrRouter.fn(appWorker, appStore, { mpk: serverTestWallet.mpk, email: serverTestWallet.email }, 'SERVER-LOAD')
            await new Promise((resolve) => setTimeout(() => { resolve() }, 1000)) // allow time for reducers to populate store
            await sendTestnetDsigCltvTx(appStore, serverLoad, 'BTC_TEST', )
        }
    })

    async function sendTestnetDsigCltvTx(store, serverLoad, testSymbol) {
        expect.assertions(7)
        const mpk = serverLoad.ok.walletInit.ok.mpk
        
        const result = await new Promise(async (resolve, reject) => {
            // setup
            const wallet = store.getState().wallet
            if (testSymbol !== 'BTC_TEST') throw `${testSymbol} is not supported` 
            const asset = wallet.assets.find(p => p.symbol === testSymbol)
            if (!asset) throw `${testSymbol} is not configured`
            const bal = walletExternal.get_combinedBalance(asset)
            if (!bal.avail.isGreaterThan(0)) throw 'Invalid testnet balance data'
            if (asset.addresses.length < 3) throw 'Invalid test asset address setup - test protect op needs 3 addresses setup'

            // configure protected UTXO tx, aka "protect_op"
            //  == send-to-self, std-addr index 0
            //     w/ P2SH CLTV script output to define an additional time-locked (OP_CHECKLOCKTIMEVERIFY) "beneficiary" address
            const sendAddrNdx = 0 //asset.addresses[0].balance > asset.addresses[1].balance ? 0 : 1 // benefactor's source coin
            const receiveAddrNdx = 0 //sendAddrNdx == 1 ? 0 : 1 // benefactor's output consolidated (protected) coin - primary output spender, no timelock
            var du_sendBalance = Number(utilsWallet.toDisplayUnit(new BigNumber(asset.addresses[sendAddrNdx].balance), asset))
            console.log('du_sendBalance', du_sendBalance)
            const sendValue = 0.0050//(du_sendBalance * 0.5).toFixed(6) // consolidate & protect % of the source coin
            //if (sendValue < 0.00001) throw 'Insufficient test currency'

            // push p2sh(1/2 dsig+cltv) tx
            const txGetFee = await svrRouter.fn(appWorker, appStore, { mpk, symbol: testSymbol, value: sendValue }, 'TX-GET-FEE')
            console.log('sendValue', sendValue)
            console.log('txGetFee', txGetFee)
            const txFee = txGetFee.ok.txFee
            const nonCltvSpender = asset.addresses[receiveAddrNdx].addr 
            const dsigCltvPubKey = '03c470a9632d4a472f402fd5c228ff3e47d23bf8e80313b213c8d63bf1e7ffc667' // "beneficiary" - testnets3, BTC# addrNdx 0: 2MwyFPaa7y5BLECBLhF63WZVBtwSPo1EcMJ
            const txPush = await svrRouter.fn(appWorker, appStore,
                { mpk, symbol: testSymbol,
                        value: sendValue,
                           to: nonCltvSpender, // "benefactor" - send to self (the non-change output to this addr gets overriden in createTxHex_BTC_P2SH()...)
               dsigCltvPubKey, 
               // todo: add param singleUtxo { txid, vout } -- for spend specific UTXO (DMS reset/reclaim)
                }, 'TX-PUSH')

            console.log(`...PROTECT_OP ${sendValue} BTC... nonDsigCltvAddr=${nonCltvSpender}, dsigCltvPubKey=${dsigCltvPubKey}`)
            resolve({ serverLoad, txFee, txPush })
        })

        expect(result.serverLoad.ok).toBeDefined()
        expect(result.serverLoad.ok.walletInit.ok.walletConnect.ok).toBeDefined()
        expect(result.txFee).toBeDefined()
        expect(Number(result.txFee.fee)).toBeGreaterThan(0)
        expect(result.txFee.inputsCount).toBeGreaterThan(0)
        expect(Number(result.txFee.utxo_satPerKB)).toBeGreaterThan(0)
        expect(Number(result.txFee.utxo_vsize)).toBeGreaterThan(0)
        console.log('txPush', result.txPush)
        //expect(result.txid).toBeDefined()
    }

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
            if (asset.addresses.length < 2) throw 'Invalid test asset address setup - testnet tx needs 2 addresses setup'

            // send testnet tx from the higher balance address to the lower
            const sendAddrNdx = asset.addresses[0].balance > asset.addresses[1].balance ? 0 : 1
            const receiveAddrNdx = sendAddrNdx == 1 ? 0 : 1
            var du_sendBalance = Number(utilsWallet.toDisplayUnit(new BigNumber(asset.addresses[sendAddrNdx].balance), asset))
            const sendValue = (du_sendBalance * 0.1).toFixed(6)
            if (sendValue < 0.00001) throw 'Insufficient test currency'

            // get tx fee
            const txGetFee = await svrRouter.fn(appWorker, appStore, { mpk, symbol: testSymbol, value: sendValue }, 'TX-GET-FEE')
            const txFee = txGetFee.ok.txFee

            // push tx
            const txPush = await svrRouter.fn(appWorker, appStore, { 
                    mpk, 
                 symbol: testSymbol,
                  value: sendValue,
                     to: asset.addresses[receiveAddrNdx].addr,
                   from: asset.symbol === 'ETH_TEST' ? asset.addresses[sendAddrNdx].addr : undefined
            }, 'TX-PUSH')

            console.log('txPush', txPush)
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
