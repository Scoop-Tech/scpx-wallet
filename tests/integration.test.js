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

const PAUSE_MS = 5000

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
    // it('socketio_tmp', async () => {
    //     const io = require('socket.io-client')
    //     const result = await new Promise(async (resolve, reject) => {
    //         const URL = require('url').URL;
    //         const ws_url = new URL('wss://eth1.trezor.io')
    //         const socket = io('wss://eth1.trezor.io', {
    //             transports: ['websocket'],
    //             extraHeaders: {
    //                 "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36",
    //                 "Connection": "Upgrade",
    //                 "Upgrade": "websocket",
    //                 "Sec-WebSocket-Extensions": "permessage-deflate; client_max_window_bits",
    //                 "Sec-WebSocket-Version": "13",
    //                 "Accept-Encoding": "gzip, deflate, br",
    //                 "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
    //                 "Cache-Control": "no-cache",
    //                 "Pragma": "no-cache",
    //                 "Host": ws_url.hostname, //"eth1.trezor.io", //,
    //                 "Origin": ws_url.origin.replace('wss', 'https') //"https://eth1.trezor.io", //ws_url.origin.replace('wss', 'https'),
    //             }
    //         })
    //         console.log('socket', socket)
    //         const Web3 = require('web3')
    //         const web3 = new Web3(new Web3.providers.HttpProvider('https://ac-dev0.net:10545'))
    //         const height = await web3.eth.getBlockNumber()
    //         console.log('height', height)
    //         socket.send({ // get tx's
    //             method: 'getAddressTxids',  
    //             params: [ ['0xeEafeb77E47d31B957a55461b212DeE328fC316D'], 
    //                         { 
    //                             start: height,
    //                             end: 0,
    //                             queryMempoolOnly: false
    //                         }
    //                     ]
    //         }, (data) => { 
    //             console.log('data', data)
    //             resolve()                
    //         })
    //     })
    //     expect.assertions(1)
    //     const o = {} 
    //     expect(o).toBeDefined()
    // })

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
            //console.log('results', results)
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
    if (!serverTestWallet.mpk) { 
        console.warn(`Missing config: see .env.example, and populate all fields - skipping some tests...`)
    }
    else {
        it('can dump a wallet', async () => {
            expect.assertions(3)
            const result = await new Promise(async (resolve, reject) => {
                const init = await svrWalletCreate.walletInit(appWorker, appStore, { mpk: serverTestWallet.mpk })
                const connect = await svrWalletFunctions.walletConnect(appWorker, appStore, {})
                const dump = await svrRouter.fn(appWorker, appStore, { mpk: init.ok.mpk, txs: true, }, 'DUMP')
                resolve( { init, connect, dump })
            })
            expect(result.init.ok).toBeDefined()
            expect(result.connect.ok).toBeDefined()
            expect(result.dump.ok).toBeDefined()
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
    
                const dumpAfter = await svrRouter.fn(appWorker, appStore, { mpk, txs: true, keys: true }, 'DUMP')
                const btcTest = dumpAfter.ok.find(p => p.assetName === 'btc(t)')
                console.dir(btcTest)
                if (btcTest.accounts.length != 2) {
                    console.error('unexpected no. of accounts...') 
                }
                if (btcTest.addresses.filter(p => p.path.startsWith("~i/")).length != 2) {
                    console.error('unexpected no. of addresses in import account...')
                }
                console.dir('btcTest.accounts.len', btcTest.accounts.length)
    
                const balanceImported = await svrRouter.fn(appWorker, appStore, { mpk }, 'BALANCE') //await Promise.resolve(setTimeout(() => {}, 2000))
                console.dir(balanceImported)
    
                // remove priv-keys
                const removeBtcTest = !configWallet.WALLET_INCLUDE_BTC_TEST ? undefined :
                    await svrRouter.fn(appWorker, appStore, { mpk, symbol: 'BTC_TEST', accountName: 'Import #1 Test Bitcoin' }, 'REMOVE-PRIV-KEYS')
    
                const removeZecTest = !configWallet.WALLET_INCLUDE_ZEC_TEST ? undefined :
                    await svrRouter.fn(appWorker, appStore, { mpk, symbol: 'ZEC_TEST', accountName: 'Import #1 ZEC#' }, 'REMOVE-PRIV-KEYS')
    
                const removeEthTest = !configWallet.WALLET_INCLUDE_ETH_TEST ? undefined :
                    await svrRouter.fn(appWorker, appStore, { mpk, symbol: 'ETH_TEST', accountName: 'Import #1 ETH#' }, 'REMOVE-PRIV-KEYS')
    
                const balanceRemoved = await svrRouter.fn(appWorker, appStore, { mpk }, 'BALANCE')
    
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
    }

    it('can create a new in-memory wallet', async () => {
        expect.assertions(1)
        const result = await new Promise(async (resolve, reject) => {
            resolve(await svrWalletCreate.walletNew(appWorker, appStore))
        })
        expect(result.ok).toBeDefined()
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
})

// testnet integration suite
describe('transactions', function () {
    if (!serverTestWallet.mpk) { 
        debugger
        console.warn(`Missing config: see .env.example, and populate all fields - skipping some tests...`)
    }
    else {
        it('can push a standard tx for P2SH{P2WSH} BTC_TEST', async () => {
            if (configWallet.WALLET_INCLUDE_BTC_TEST) {
                const serverLoad = await svrRouter.fn(appWorker, appStore, { mpk: serverTestWallet.mpk, email: serverTestWallet.email }, 'SERVER-LOAD')
                //await new Promise((resolve) => setTimeout(() => { resolve() }, 1000)) // allow time for reducers to populate store
                await sendTestnetTx(appStore, serverLoad, 'BTC_TEST')
            }
        })

        it('2 can push a standard tx for P2SH{P2WSH} ZEC_TEST', async () => {
            if (configWallet.WALLET_INCLUDE_ZEC_TEST) {
                const serverLoad = await svrRouter.fn(appWorker, appStore, { mpk: serverTestWallet.mpk, email: serverTestWallet.email }, 'SERVER-LOAD')
                //await new Promise((resolve) => setTimeout(() => { resolve() }, 1000))
                await sendTestnetTx(appStore, serverLoad, 'ZEC_TEST')
            }
        })

        it('3 can push a standard tx for account-based ETH_TEST', async () => {
            if (configWallet.WALLET_INCLUDE_ETH_TEST) {
                var serverLoad = await svrRouter.fn(appWorker, appStore, { mpk: serverTestWallet.mpk, email: serverTestWallet.email }, 'SERVER-LOAD')
                //await new Promise((resolve) => setTimeout(() => { resolve() }, 1000))

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

        // create PROTECT_OP
        // ### "-26: min relay fee not met, 1 < 381" -- race condition with fee oracle?
        it('can push a non-standard PROTECT_OP tx for P2SH{DSIG/CLTV} BTC_TEST [, and benefactor can reclaim immediately - wip]', async () => {
            if (configWallet.WALLET_INCLUDE_BTC_TEST) {
                
                const serverLoad = await svrRouter.fn(appWorker, appStore, { mpk: serverTestWallet.mpk, email: serverTestWallet.email }, 'SERVER-LOAD')
                const { p2shAddr, txid } = await createDsigCltvTx(appStore, serverLoad, 'BTC_TEST', 3042/*sats*/, 12/*dsigLockHours*/)
                console.log('txid', txid)
                console.log('p2shAddr', p2shAddr)

                const opPause = new Promise((resolve) => {
                    setTimeout(async () => {
                        const dump = await svrRouter.fn(appWorker, appStore, { mpk: serverTestWallet.mpk, txs: true, symbol: 'BTC_TEST' }, 'DUMP')
                        console.dir(dump) // looking for the new non-std addr to be here...

                        // WIP... ## complication on testing benefactor can reclaim is the pending p_op TX: it doesn't trigger the new non-std addr detection...

                        //
                        // after p_op...
                        //  >>> local_tx on CLI SENDER... FIXED THIS PATH... # non-std addr's updates ok.
                        //      BUT... local_tx doesn't have the p_op fields added - WCORE_SET_ENRICHED_TXS only looking at addr-tx's ?
                        //
                        //  >>> local_tx on GUI (mempool-tx path)... contains NO utxo_vin / vout... 
                        //          worker-addr-monitor.subAddr_Blockbook
                        //            getDetailedTransaction
                        //              worker-blockbook-mempool.mempool_process_BB_UtxoTx
                        //               ( INSTEAD OF (e.g. eth) "ASSET_REFRESH_ADDR_MONITOR" >>> refreshAssetsFull]... can just use this instead?

                                // block_no: -1
                                // date: Sat Feb 06 2021 07:55:18 GMT+0000 (Greenwich Mean Time) {}
                                // fees: 0.00000496
                                // isIncoming: false
                                // sendToSelf: false
                                // toOrFrom: "2NFxmbtNGUbuMEahEY2EkKcNHU1mPfGoNvn"
                                // txid: "c643c7872b58918344b69eaad907b853041747cfa7091559af235728001fa07b"
                                // value:
                                // 5
                                // e-7

                        //
                        // NEED TO TRIGGER A getAddressFull_Blockbook_v3() ... this will pick up the pending_tx from BB
                        //  (overwrites pending????) ... 
                        //
                        // >>>>
                        //  TODO >>> make new CLI cmd to RefreshAssetFull: test effect calling this immediately after doing P_OP...
                        // >>>>
                        //
                        //  AND PROCESS IT TO INCLUDE THE p_op FIELDS,
                        // THEN NEED TO TRIGGER A NEW_NON_STD_SCAN...?
                        // 
                        // CONFIRMED FLOW... 
                        //  (1) "PUSH DONE - BTC_TEST"... a4ae5de9065f34c2174e717e62f49d3bbee303c32ff304448db7f8aae9590b1e
                        //  (2) "bitcoind/addresstxid"...  (>> getDetailedTransaction)
                        //  (3) "mempool_process_BB_UtxoTx"... (txInLocalTxs=true)
                        //    >> NEED TO ENRICH LOCAL_TX W/ EXACT SAME FIELDS AS IN worker-blockbook::enrichTx()
                        //    >>   .hex
                        //    >>   
                        //
                        resolve('paused')
                    }, 3000)
                })
                const data = await opPause
                console.log('data', data)

                //
                // TODO: test - "benefactor can reclaim immediately"...
                //  (1) ./wd... find 
                //   ./ptx spendFullUtxo=... -v... 
                //      (wallet-external layer: should have asset-refresh full immediately after submitting tx??)
                //
                // TODO: test - "beneficiary can't reclaim early"...
                //
            }
        })

        // spend PROTECT_OP(s)
        it('can spend PROTECT_OP UTXOs for BTC_TEST', async () => {
            expect.assertions(1)
            if (configWallet.WALLET_INCLUDE_BTC_TEST) {
                const serverLoad = await svrRouter.fn(appWorker, appStore, { mpk: serverTestWallet.mpk, email: serverTestWallet.email }, 'SERVER-LOAD')
                expect(serverLoad.ok).toBeDefined()

                // spend PROTECT_OP(s) (>1)
                const opPause = new Promise((resolve) => {
                    setTimeout(async () => { // ### hack/fixme - wait for non-std scanning to finish (see ADD_NON_STANDARD_ADDRESSES for todo, re. signal-complete)
                    
                        // dump wallet, look for p_op UTXOs (e.g. CLI: ./wd --s btc_test)
                        // const dump = await svrRouter.fn(appWorker, appStore, { mpk: serverLoad.ok.walletInit.ok.mpk, symbol: 'BTC_TEST', }, 'DUMP')
                        // expect(dump.ok && dump.ok.length == 1).toBeTruthy()
                        // const p_op_utxos = dump.ok[0].addresses.filter(p => p.protect_op_txid !== undefined)
                        // console.log(`${p_op_utxos.map(p => p.protect_op_txid).join(',')}`)

                        // or better: use CLAIMABLE-LIST
                        // const cll = await svrRouter.fn(appWorker, appStore, { mpk: serverLoad.ok.walletInit.ok.mpk, symbol: 'BTC_TEST', }, 'CLAIMABLE-LIST')
                        // const weAreBenefactor = cll.ok.claimable.filter(p => p.protect_op_tx.p_op_weAreBenefactor == true)
                        // const weAreBenificiary = cll.ok.claimable.filter(p => p.protect_op_tx.p_op_weAreBeneficiary == true)
                        // const claimableUtxos = cll.ok.claimable.filter(p => p.utxos.length > 0 && p.utxos[0].satoshis > 0).map(p => p.utxos[0])
                        // var claimableSpend = {}
                        // if (claimableUtxos.length > 0) {

                            claimableClaim = await svrRouter.fn(appWorker, appStore, { mpk: serverLoad.ok.walletInit.ok.mpk, symbol: 'BTC_TEST', }, 'CLAIMABLE-CLAIM')
                            console.dir(claimableClaim)

                            /* // underlying CLIs:
                                DONE: combining n p_op UTXOs 
                                    ./txp --s btc_test --v 0.000021 --to 2N86aMtHDFsGLcqVfodDb3itwHENctFmJNF --spendFullUtxos bbeeddd415b99b1e5c0a9aac35db1c1191a455588221a31f28e47df947fe95ad:0,e795f5dbad9133d6e982b5e4ec5d411d00dd3e008fae151aa6dda330ae384cdc:0,044aa692623fb9c48a1df3b491a39c50db2d079c88a0b6254db416405f6f5cea:0,ca211f082863933890a805eab9ec3a11ea0fc0179f83017398cdb4a1b03fb602:0,e3122a1d55e38998bc774e502f504c41766a79b21a169cc160c5489d9befd6ac:0

                                DONE: combining 1x p_op UTXO && 1x standard UTXO...
                                    ./txp --s btc_test --v 0.00632557 --to 2N86aMtHDFsGLcqVfodDb3itwHENctFmJNF --spendFullUtxos 5d027d45036f2c4aeef08da69a454f59030109e5bc112384d019eb9eac9a89ab:1,96263f6fbd3f8aa7bb48299734a94db98ec1f9ae80df1f4af16e480a3644324b:0

                                TODO: test combining p_op_weAreBeneficiary=true && p_op_weAreBeneficiary=false...
                                    ...
                            */

                            // ./wd needs to be able to filter by addr, and show utxos v. clearly...

                        //}

                        resolve({ claimableUtxos }) //p_op_utxos, cll)

                    }, 1000 * 10) // ###
                })
                const { claimableUtxos, claimableSpend } = await opPause
                expect(claimableUtxos !== undefined).toBeTruthy()
            }
        })
    }

    // create PROTECT_OP
    async function createDsigCltvTx(store, serverLoad, testSymbol, sats, dsigLockHours) {
        expect.assertions(7 + 5)
        const mpk = serverLoad.ok.walletInit.ok.mpk
        
        const result = await new Promise(async (resolve, reject) => {
            // setup
            const wallet = store.getState().wallet
            if (testSymbol !== 'BTC_TEST') throw `${testSymbol} is not supported for tests`
            const asset = wallet.assets.find(p => p.symbol === testSymbol)
            if (!asset) throw `${testSymbol} is not configured`
            const bal = walletExternal.get_combinedBalance(asset)
            if (!bal.avail.isGreaterThan(0)) throw 'Invalid testnet balance data'
            if (asset.addresses.length < 3) throw 'Invalid test asset address setup - test protect op needs 3 addresses setup'

            // push p2sh(1/2 dsig+cltv) tx
            const avail = utilsWallet.toDisplayUnit(bal.avail, asset)
            const sendValue = sats ? sats / 100000000 : 0.0000042
            if (avail < sendValue) throw 'Insufficient test currency'
            const dsigCltvPubKey = '03c470a9632d4a472f402fd5c228ff3e47d23bf8e80313b213c8d63bf1e7ffc667' // beneficiary - testnets3@scoop.tech, BTC# addrNdx 0: 2MwyFPaa7y5BLECBLhF63WZVBtwSPo1EcMJ
            const txGetFee = await svrRouter.fn(appWorker, appStore, { mpk, symbol: testSymbol, value: sendValue, dsigCltvPubKey }, 'TX-GET-FEE')
            if (!txGetFee || txGetFee.err) throw txGetFee.err || 'Failed getting TX fee'
            console.log('sendValue', sendValue)
            console.log('txGetFee', txGetFee)
            const txFee = txGetFee.ok.txFee
            const nonCltvSpender = asset.addresses[0].addr
            const txPush = await svrRouter.fn(appWorker, appStore,
                { mpk, symbol: testSymbol,
                        value: sendValue,
                           to: nonCltvSpender, // PROTECT_OP = benefactor (aka nonCltvSpender)...
               dsigCltvPubKey,                 //            + beneficiary pubKey -- see: createTxHex_BTC_P2SH()
                dsigLockHours
                }, 'TX-PUSH')

            console.log(`...PROTECT_OP ${sendValue} BTC... nonCltvSpender=${nonCltvSpender}, dsigCltvPubKey=${dsigCltvPubKey}`)
            resolve({ serverLoad, txFee, txPush })
        })

        expect(result.serverLoad.ok).toBeDefined()
        expect(result.serverLoad.ok.walletInit.ok.walletConnect.ok).toBeDefined()
        expect(result.txFee).toBeDefined()
        expect(Number(result.txFee.fee)).toBeGreaterThan(0)
        expect(result.txFee.inputsCount).toBeGreaterThan(0)
        expect(Number(result.txFee.utxo_satPerKB)).toBeGreaterThan(0)
        expect(Number(result.txFee.utxo_vsize)).toBeGreaterThan(0)
        
        expect(result.txPush.ok).toBeDefined()
        expect(result.txPush.ok.psbt).toBeDefined()
        const txOutputs = result.txPush.ok.psbt.txOutputs
        expect(txOutputs).toBeDefined()
        expect(Number(txOutputs.length)).toBeGreaterThan(0)
        expect(txOutputs[0].address).toBeDefined()
        
        return { p2shAddr: txOutputs[0].address, txid: result.txPush.ok.txid }
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
