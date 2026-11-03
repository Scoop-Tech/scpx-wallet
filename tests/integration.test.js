// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.
//
// scpx-wallet integration suite (in-process; real testnets).
//
// Test wallets come from ~/.config/scpx-wallet/e2e.env (or $E2E_ENV, or process env):
//   E2E_MPK_A    testnets4@d0m1.com - funded BTC_TEST / BTC_TEST2 (and Sepolia ETH_TEST)
//   E2E_EMAIL_A  testnets4@d0m1.com - for Data Storage Contract (scp-svr API) load/save
//   E2E_MPK_B    throwaway counterparty - PROTECT_OP beneficiary
// Sends use MINIMUM values (dust floor 546 sats; PROTECT_OP min gross 2438 sats). Never prints private keys.
//
// Run: npm test   (NODE_ENV=test, --experimental-worker, jest --runInBand)

require('dotenv').config()
const fs = require('fs')
const os = require('os')
const path = require('path')
const BigNumber = require('bignumber.js')
const bitcoinJsLib = require('bitcoinjs-lib')
const axios = require('axios')

const appStore = require('../store').store
const utilsWallet = require('../utils')
const svrWorkers = require('../svr-workers')
const svrWalletCreate = require('../svr-wallet/sw-create')
const svrWalletFunctions = require('../svr-wallet/sw-functions')
const svrRouter = require('../svr-wallet/sw-router')
const walletExternal = require('../actions/wallet-external')
const walletP2sh = require('../actions/wallet-btc-p2sh')
const configWallet = require('../config/wallet')

// --- test config ---
function loadE2EEnv() {
    const f = process.env.E2E_ENV || path.join(os.homedir(), '.config/scpx-wallet/e2e.env')
    const out = {}
    if (fs.existsSync(f)) for (const l of fs.readFileSync(f, 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) out[m[1]] = m[2].trim() }
    return Object.assign(out, process.env)
}
const ENV = loadE2EEnv()
const walletA = { mpk: ENV.E2E_MPK_A, email: ENV.E2E_EMAIL_A || 'testnets4@d0m1.com' }
const walletB = { mpk: ENV.E2E_MPK_B }
const HAVE_TEST_WALLETS = !!(walletA.mpk && walletB.mpk)
const BTC_TEST_BB = 'https://x-btc-testnet.d0m1.com:10009/api/v2'   // independent oracle (our Blockbook REST)
const MIN_SEND_BTC = '0.00000600'                                    // just above the 546-sat dust floor
const P_OP_LOCK_HOURS = 1

// ETH_TEST = Sepolia (chainId 11155111): Trezor Sepolia Blockbook (history) + publicnode RPC (balances, gas, broadcast)
const ETH_FAMILY = a => a.symbol === 'ETH' || a.symbol === 'ETH_TEST' || utilsWallet.isERC20(a)
const SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com'                     // independent oracle for ETH_TEST
const MIN_SEND_ETH = '0.000000001'                                                     // 1 gwei
async function sepoliaRpc(method, params) { return (await axios.post(SEPOLIA_RPC, { jsonrpc: '2.0', id: 1, method, params })).data.result }

// HARD SAFETY GUARD: tests may only ever move testnet coins. Any send-type command for a non-testnet symbol throws
// before it reaches the wallet (claimableClaim/assetConvert are also send paths).
const TESTNET_SYMBOLS = new Set(['BTC_TEST', 'BTC_TEST2', 'ETH_TEST'])
const SEND_CMDS = new Set(['TX-PUSH', 'CLAIMABLE-CLAIM', 'ASSET-CONVERT'])
{
    const fn = svrRouter.fn
    svrRouter.fn = (w, s, p, cmd) => {
        if (SEND_CMDS.has(cmd) && !TESTNET_SYMBOLS.has(String(p && p.symbol).toUpperCase())) throw new Error(`TEST SAFETY GUARD: refusing ${cmd} for non-testnet symbol "${p && p.symbol}"`)
        return fn(w, s, p, cmd)
    }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
async function waitFor(fn, ms, every = 3000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn().catch(() => undefined); if (v) return v; await sleep(every) } return undefined }
async function oracleTx(txid) { try { return (await axios.get(`${BTC_TEST_BB}/tx/${txid}`, { headers: { 'User-Agent': 'Mozilla/5.0' } })).data } catch (e) { return undefined } }

async function initWallet(w) {
    const init = await svrWalletCreate.walletInit(appWorker, appStore, { mpk: w.mpk })
    if (!init.ok) throw new Error(`walletInit failed: ${init.err}`)
    return init
}
// BTC_TEST public key for addr[0] - derived in-process from a keys:true dump; the WIF is never logged or returned
async function btcTestPubKey(w) {
    const dump = await svrRouter.fn(appWorker, appStore, { mpk: w.mpk, symbol: 'BTC_TEST', keys: true }, 'DUMP')
    const asset = dump.ok.find(p => p.assetName === 'btc(t)')
    const key = asset.accounts[0].keys.find(k => k.addr && k.addr.addr === asset.addresses[0].addr)
    const pub = bitcoinJsLib.ECPair.fromWIF(key.privKey, bitcoinJsLib.networks.testnet).publicKey.toString('hex')
    key.privKey = undefined
    return { pub, addr: asset.addresses[0].addr }
}
async function btcTestWifs(w, n) {
    // a fresh load only derives standard address index 0; add (in-memory) standard addresses until there are n keys
    const keysOf = async () => {
        const dump = await svrRouter.fn(appWorker, appStore, { mpk: w.mpk, symbol: 'BTC_TEST', keys: true }, 'DUMP')
        return dump.ok.find(p => p.assetName === 'btc(t)').accounts[0].keys.filter(k => k.privKey)
    }
    let keys = await keysOf()
    while (keys.length < n) {
        expect((await svrRouter.fn(appWorker, appStore, { mpk: w.mpk, symbol: 'BTC_TEST' }, 'ADD-ADDR')).ok).toBeDefined()
        keys = await keysOf()
    }
    return keys.slice(0, n).map(k => k.privKey).join(',')
}

beforeAll(async () => {
    global.loadedWallet = {}
    global.loadedServerWallet = {}
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 1000 * 60 * 40
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
        const create = await svrWalletCreate.walletNew(appWorker, appStore)
        expect(create.ok).toBeDefined()
        var wallet = appStore.getState().wallet
        const results = []
        for (const asset of wallet.assets) {
            results.push(await svrRouter.fn(appWorker, appStore, { symbol: asset.symbol, mpk: create.ok.mpk }, 'ADD-ADDR'))
        }
        wallet = appStore.getState().wallet
        expect(results.filter(p => p.ok).length).toEqual(wallet.assets.length)
        expect(wallet.assets.filter(p => p.addresses.length === 2).length).toEqual(wallet.assets.length)
    })

    it('can fetch suggested network fee rates for testnet UTXO assets (BTC_TEST, BTC_TEST2)', async () => {
        const create = await svrWalletCreate.walletNew(appWorker, appStore)
        expect(create.ok).toBeDefined()
        expect(create.ok.walletConnect.ok).toBeDefined()
        const assets = appStore.getState().wallet.assets.filter(a => TESTNET_SYMBOLS.has(a.symbol) && !ETH_FAMILY(a))
        expect(assets.length).toBeGreaterThan(0)
        for (const asset of assets) {
            const r = await svrRouter.fn(appWorker, appStore, { symbol: asset.symbol }, 'ASSET-GET-FEES')
            expect({ symbol: asset.symbol, ok: !!(r.ok && r.ok.feeData && r.ok.feeData.fast_satPerKB > 0) }).toEqual({ symbol: asset.symbol, ok: true })
        }
    })
    it('can fetch suggested network fee rates for ETH_TEST (Sepolia)', async () => {
        const create = await svrWalletCreate.walletNew(appWorker, appStore)
        expect(create.ok).toBeDefined()
        expect(appStore.getState().wallet.assets.find(a => a.symbol === 'ETH_TEST')).toBeDefined()
        const r = await svrRouter.fn(appWorker, appStore, { symbol: 'ETH_TEST' }, 'ASSET-GET-FEES')
        const f = r.ok && r.ok.feeData
        expect(f).toBeDefined()
        expect({ gasLimit: f.gasLimit > 0, fast: f.gasprice_fast > 0, fastest: f.gasprice_fastest >= f.gasprice_fast })
            .toEqual({ gasLimit: true, fast: true, fastest: true })
    })
    it('safety guard refuses a send for any non-testnet symbol', async () => {
        for (const symbol of ['BTC', 'BTC_SEG', 'BTC_SEG2', 'ETH', 'USDT']) {
            expect(() => svrRouter.fn(appWorker, appStore, { symbol, value: '0.00001', to: 'x' }, 'TX-PUSH')).toThrow(/TEST SAFETY GUARD/)
        }
    })
})

describe('wallet', function () {
    it('can create a new in-memory wallet', async () => {
        const result = await svrWalletCreate.walletNew(appWorker, appStore)
        expect(result.ok).toBeDefined()
    })

    it('can reinitialize a known wallet in-memory (deterministic addresses)', async () => {
        const result = await svrWalletCreate.walletInit(appWorker, appStore, { mpk: 'PW5KaarU5Jtg8dyQvM3CqYEz97T4rFozdAbXMfdBfmyRhafkuWKg6' })
        expect(result.ok).toBeDefined()
        const storeState = appStore.getState()
        expect(storeState.wallet.assets.find(p => p.symbol === 'ETH').addresses[0].addr).toEqual('0x5556903a7233b3cc04918843ccdb43b1cdabb044')
        expect(storeState.wallet.assets.find(p => p.symbol === 'BTC_SEG').addresses[0].addr).toEqual('3Px58xg8Lowmst7gb1anuuW6R5NQSimjvh')
    })

    it('can persist a wallet to and from file', async () => {
        const testWalletFile = `test${new Date().getTime()}`
        const create = await svrWalletCreate.walletNew(appWorker, appStore)
        const mpk = create.ok.mpk
        // core UTXO + account assets of a new wallet (the legacy P2PKH 'BTC' asset is not a core asset)
        const symbols = appStore.getState().wallet.assets.map(a => a.symbol).filter(s => ['ETH', 'BTC_SEG', 'BTC_SEG2', 'BTC_TEST'].includes(s))
        expect(symbols.sort()).toEqual(['BTC_SEG', 'BTC_SEG2', 'BTC_TEST', 'ETH'])
        for (const symbol of symbols) expect((await svrRouter.fn(appWorker, appStore, { mpk, symbol }, 'ADD-ADDR')).ok).toBeDefined()
        expect((await svrRouter.fn(appWorker, appStore, { mpk, name: testWalletFile }, 'SAVE')).ok).toBeDefined()
        expect((await svrRouter.fn(appWorker, appStore, { mpk, name: testWalletFile }, 'LOAD')).ok).toBeDefined()
        const assets = appStore.getState().wallet.assets
        for (const symbol of symbols) expect({ symbol, n: assets.find(p => p.symbol === symbol).addresses.length }).toEqual({ symbol, n: 2 })
        for (const f of fs.readdirSync('.').filter(f => f.includes(testWalletFile))) fs.unlinkSync(f) // tidy up
    })

    if (!HAVE_TEST_WALLETS) {
        it.skip('[SKIPPED: no test wallets - create ~/.config/scpx-wallet/e2e.env, see .env.example]', () => {})
        return
    }

    it('can connect the test wallet to 3PBPs', async () => {
        const init = await initWallet(walletA)
        expect(init.ok.walletConnect.ok).toBeDefined()
    })

    it('can dump a wallet (no keys unless asked)', async () => {
        await initWallet(walletA)
        const dump = await svrRouter.fn(appWorker, appStore, { mpk: walletA.mpk, txs: true }, 'DUMP')
        expect(dump.ok).toBeDefined()
        expect(JSON.stringify(dump.ok)).not.toMatch(/"privKey":"[^"]+"/)
    })

    it('can persist a wallet to and from the Data Storage Contract (scp-svr API + EOS DSC)', async () => {
        const serverLoad = await svrRouter.fn(appWorker, appStore, { mpk: walletA.mpk, email: walletA.email }, 'SERVER-LOAD')
        expect(serverLoad.err).toBeUndefined()
        expect(serverLoad.ok).toBeDefined()
        const serverSave = await svrRouter.fn(appWorker, appStore, { mpk: serverLoad.ok.walletInit.ok.mpk }, 'SERVER-SAVE')
        expect(serverSave.err).toBeUndefined()
        expect(serverSave.ok).toBeDefined()
    })

    it('can import and remove private keys (BTC_TEST, using the test wallet\'s own keys)', async () => {
        await initWallet(walletA)
        const wifs = await btcTestWifs(walletA, 2)
        const create = await svrWalletCreate.walletNew(appWorker, appStore)
        expect(create.ok).toBeDefined()
        const mpk = create.ok.mpk
        const imported = await svrRouter.fn(appWorker, appStore, { mpk, symbol: 'BTC_TEST', privKeys: wifs }, 'ADD-PRIV-KEYS')
        expect(imported.ok.importPrivKeys.importedAddrCount).toEqual(2)
        const balance = await waitFor(async () => {
            const b = await svrRouter.fn(appWorker, appStore, { mpk }, 'BALANCE')
            const btc = b.ok && b.ok.balances.find(p => p && p.symbol === 'BTC_TEST')
            return btc && Number(btc.conf) > 0 ? btc : undefined
        }, 120000)
        expect(balance).toBeDefined()
        const accountName = appStore.getState().wallet.assets.find(p => p.symbol === 'BTC_TEST').addresses.find(a => a.path.startsWith('~i')).accountName
        const removed = await svrRouter.fn(appWorker, appStore, { mpk, symbol: 'BTC_TEST', accountName }, 'REMOVE-PRIV-KEYS')
        expect(removed.ok.removeImportedAccounts.removedAddrCount).toEqual(2)
    })
    it('can import and remove private keys for ETH_TEST (using the test wallet\'s own key)', async () => {
        await initWallet(walletA)
        const dump = await svrRouter.fn(appWorker, appStore, { mpk: walletA.mpk, symbol: 'ETH_TEST', keys: true }, 'DUMP')
        const ethTest = dump.ok.find(p => p.assetName === 'eth(t)')
        const addrA = ethTest.addresses[0].addr
        const key = ethTest.accounts[0].keys.find(k => k.privKey && k.addr && k.addr.addr === addrA)
        const privKey = key.privKey
        key.privKey = undefined
        const create = await svrWalletCreate.walletNew(appWorker, appStore)
        expect(create.ok).toBeDefined()
        const mpk = create.ok.mpk
        const imported = await svrRouter.fn(appWorker, appStore, { mpk, symbol: 'ETH_TEST', privKeys: privKey }, 'ADD-PRIV-KEYS')
        expect(imported.ok.importPrivKeys.importedAddrCount).toEqual(1)
        const importedAddr = appStore.getState().wallet.assets.find(p => p.symbol === 'ETH_TEST').addresses.find(a => a.path.startsWith('~i'))
        expect(importedAddr.addr.toLowerCase()).toEqual(addrA.toLowerCase())
        const balance = await waitFor(async () => {
            const b = await svrRouter.fn(appWorker, appStore, { mpk }, 'BALANCE')
            const eth = b.ok && b.ok.balances.find(p => p && p.symbol === 'ETH_TEST')
            return eth && Number(eth.conf) > 0 ? eth : undefined
        }, 120000)
        expect(balance).toBeDefined()
        const removed = await svrRouter.fn(appWorker, appStore, { mpk, symbol: 'ETH_TEST', accountName: importedAddr.accountName }, 'REMOVE-PRIV-KEYS')
        expect(removed.ok.removeImportedAccounts.removedAddrCount).toEqual(1)
    })
})

describe('transactions', function () {
    if (!HAVE_TEST_WALLETS) {
        it.skip('[SKIPPED: no test wallets - create ~/.config/scpx-wallet/e2e.env, see .env.example]', () => {})
        return
    }

    for (const symbol of ['BTC_TEST', 'BTC_TEST2']) {
        it(`can push a minimum standard tx for ${symbol === 'BTC_TEST' ? 'P2SH{P2WSH}' : 'P2WPKH'} ${symbol} (seen by independent oracle)`, async () => {
            await initWallet(walletA)
            const asset = appStore.getState().wallet.assets.find(p => p.symbol === symbol)
            const to = asset.addresses[asset.addresses.length - 1].addr
            const txGetFee = await svrRouter.fn(appWorker, appStore, { mpk: walletA.mpk, symbol, value: MIN_SEND_BTC }, 'TX-GET-FEE')
            expect(txGetFee.err).toBeUndefined()
            expect(Number(txGetFee.ok.txFee.fee)).toBeGreaterThan(0)
            expect(Number(txGetFee.ok.txFee.utxo_satPerKB)).toBeGreaterThan(0)
            expect(Number(txGetFee.ok.txFee.utxo_vsize)).toBeGreaterThan(0)
            const txPush = await svrRouter.fn(appWorker, appStore, { mpk: walletA.mpk, symbol, value: MIN_SEND_BTC, to }, 'TX-PUSH')
            expect(txPush.err).toBeUndefined()
            expect(txPush.ok.txid).toBeDefined()
            expect(await waitFor(() => oracleTx(txPush.ok.txid), 60000)).toBeDefined()
        })
    }
    it.skip('can push a standard tx for ZEC_TEST [SKIPPED: ZEC_TEST disabled in config (WALLET_INCLUDE_ZEC_TEST=false)]', () => {})
    it(`can push a minimum standard tx for account-based ETH_TEST (Sepolia self-send ${MIN_SEND_ETH}; mined status 1 on an independent node)`, async () => {
        await initWallet(walletA)
        const addr = appStore.getState().wallet.assets.find(p => p.symbol === 'ETH_TEST').addresses[0].addr
        const txGetFee = await svrRouter.fn(appWorker, appStore, { mpk: walletA.mpk, symbol: 'ETH_TEST', value: MIN_SEND_ETH }, 'TX-GET-FEE')
        expect(txGetFee.err).toBeUndefined()
        expect(Number(txGetFee.ok.txFee.eth_gasLimit)).toBeGreaterThan(0)
        expect(Number(txGetFee.ok.txFee.eth_gasPrice)).toBeGreaterThan(0)
        const txPush = await svrRouter.fn(appWorker, appStore, { mpk: walletA.mpk, symbol: 'ETH_TEST', value: MIN_SEND_ETH, to: addr, from: addr }, 'TX-PUSH')
        expect(txPush.err).toBeUndefined()
        expect(txPush.ok.txid).toBeDefined()
        const receipt = await waitFor(() => sepoliaRpc('eth_getTransactionReceipt', [txPush.ok.txid]), 240000)
        expect(receipt && receipt.status).toEqual('0x1')
    })

    // --- PROTECT_OP: P2SH{ IF <lockTime> CLTV DROP <beneficiary> CHECKSIG ELSE <benefactor> CHECKSIG ENDIF } ---
    // Order matters: benefactor claims everything claimable, so the beneficiary's matured outputs are claimed first,
    // the benefactor only reclaims the output it created for that purpose, and a second output is left to mature for the next run.
    describe('PROTECT_OP (timelocked 1-of-2 P2SH, BTC_TEST)', function () {
        let pubA, pubB, pop1, pop2

        it('setup: derive benefactor (A) and beneficiary (B) BTC_TEST public keys', async () => {
            await initWallet(walletB); pubB = await btcTestPubKey(walletB)
            await initWallet(walletA); pubA = await btcTestPubKey(walletA)
            expect(pubA.pub).toMatch(/^0[23][0-9a-f]{64}$/)
            expect(pubB.pub).toMatch(/^0[23][0-9a-f]{64}$/)
        })

        it('beneficiary (B) can claim matured PROTECT_OPs from earlier runs (CLAIMABLE-CLAIM)', async () => {
            await initWallet(walletB)
            const list = await waitFor(async () => { const r = await svrRouter.fn(appWorker, appStore, { mpk: walletB.mpk, symbol: 'BTC_TEST' }, 'CLAIMABLE-LIST'); return r.ok ? r : undefined }, 60000)
            expect(list).toBeDefined()
            const matured = list.ok.claimable.filter(p => p.protect_op_tx.p_op_weAreBeneficiary)
            console.log(`PROTECT_OP: ${matured.length} matured output(s) claimable by beneficiary`)
            if (matured.length === 0) { console.log('PROTECT_OP: nothing matured yet (first run, or < lock + median-time lag) - beneficiary claim checked on a later run'); return }
            const claim = await svrRouter.fn(appWorker, appStore, { mpk: walletB.mpk, symbol: 'BTC_TEST' }, 'CLAIMABLE-CLAIM')
            expect(claim.err).toBeUndefined()
            expect(claim.ok.txPush.err).toBeUndefined()
            expect(claim.ok.txPush.ok.txid).toBeDefined()
            const tx = await waitFor(() => oracleTx(claim.ok.txPush.ok.txid), 60000)
            expect(tx).toBeDefined()
            for (const m of matured) expect(tx.vin.some(v => v.txid === m.protect_op_tx.txid)).toBe(true)
        })

        async function createPop(purpose) {
            await initWallet(walletA)
            const value = new BigNumber(walletP2sh.P_OP_MIN_GROSS).div(1e8).toString()
            const fee = await svrRouter.fn(appWorker, appStore, { mpk: walletA.mpk, symbol: 'BTC_TEST', value, dsigCltvPubKey: pubB.pub }, 'TX-GET-FEE')
            expect(fee.err).toBeUndefined()
            const push = await svrRouter.fn(appWorker, appStore, {
                mpk: walletA.mpk, symbol: 'BTC_TEST', value, to: pubA.addr, dsigCltvPubKey: pubB.pub, dsigLockHours: P_OP_LOCK_HOURS }, 'TX-PUSH')
            expect(push.err).toBeUndefined()
            expect(push.ok.txid).toBeDefined()
            const tx = await waitFor(() => oracleTx(push.ok.txid), 60000)
            expect(tx).toBeDefined()
            console.log(`PROTECT_OP (${purpose}) txid=${push.ok.txid}`)
            return { txid: push.ok.txid, tx }
        }

        // independent structural check: decode OP_RETURN, rebuild the redeem script, P2SH address must match vout[0]
        function verifyPopStructure(tx) {
            expect(tx.vout.length).toEqual(5)
            const opRet = tx.vout[1].hex
            expect(opRet.startsWith('6a4c50')).toBe(true)                           // OP_RETURN PUSHDATA1 80
            const data = Buffer.from(opRet.slice(6), 'hex')
            expect(data.slice(0, 4).toString('hex')).toEqual('481fe761')            // PROTECT_OP id/version stamp v1
            expect(data.slice(4, 37).toString('hex')).toEqual(pubB.pub)             // pubKeyA = beneficiary (CLTV spender)
            expect(data.slice(37, 70).toString('hex')).toEqual(pubA.pub)            // pubKeyB = benefactor
            const lockTime = data.readUInt32BE(70) * 256 + data.readUInt32BE(74)    // wallet's 64-bit packing (hi>>8, lo&0xff)
            expect(data.readUInt16BE(78)).toEqual(P_OP_LOCK_HOURS)
            const nowSec = Math.floor(Date.now() / 1000)
            expect(lockTime).toBeGreaterThan(nowSec + 3600 * P_OP_LOCK_HOURS - 3600) // ~ now + lockHours
            expect(lockTime).toBeLessThan(nowSec + 3600 * P_OP_LOCK_HOURS + 600)
            const redeem = bitcoinJsLib.script.fromASM(
                `OP_IF ${bitcoinJsLib.script.number.encode(lockTime).toString('hex')} OP_CHECKLOCKTIMEVERIFY OP_DROP ${pubB.pub} OP_CHECKSIG ` +
                `OP_ELSE ${pubA.pub} OP_CHECKSIG OP_ENDIF`)
            const p2sh = bitcoinJsLib.payments.p2sh({ redeem: { output: redeem, network: bitcoinJsLib.networks.testnet }, network: bitcoinJsLib.networks.testnet })
            expect(tx.vout[0].addresses[0]).toEqual(p2sh.address)                   // the locked output really is our script
            expect(Number(tx.vout[2].value)).toEqual(walletP2sh.P_OP_DUST)            // beneficiary ID output = dust
            expect(Number(tx.vout[3].value)).toBeGreaterThanOrEqual(walletP2sh.P_OP_DUST) // benefactor change >= dust
            expect(Number(tx.vout[4].value)).toBeGreaterThanOrEqual(walletP2sh.P_OP_DUST) // dev fee >= dust
            return { lockTime, p2shAddr: p2sh.address }
        }

        it(`benefactor (A) can create a minimum PROTECT_OP (${walletP2sh.P_OP_MIN_GROSS} sats, lock ${P_OP_LOCK_HOURS}h, beneficiary B): structure verified independently`, async () => {
            pop1 = await createPop('benefactor-reclaim')
            Object.assign(pop1, verifyPopStructure(pop1.tx))
        })

        it('benefactor (A) can reclaim its PROTECT_OP output immediately (before the lock)', async () => {
            expect(pop1).toBeDefined()
            // wait for the wallet's non-standard output scan to pick up the P2SH output, then spend exactly that UTXO
            const utxo = await waitFor(async () => {
                await initWallet(walletA)
                const a = appStore.getState().wallet.assets.find(p => p.symbol === 'BTC_TEST')
                const p = a.addresses.find(x => x.nonStd_protectOp_txid === pop1.txid && x.utxos && x.utxos.length > 0)
                return p ? p.utxos.find(u => u.txid === pop1.txid) : undefined
            }, 30 * 60000, 20000)
            expect(utxo).toBeDefined()
            const value = new BigNumber(utxo.satoshis).div(1e8).toString()
            const push = await svrRouter.fn(appWorker, appStore, { mpk: walletA.mpk, symbol: 'BTC_TEST', value, to: pubA.addr, spendFullUtxos: `${pop1.txid}:${utxo.vout}` }, 'TX-PUSH')
            expect(push.err).toBeUndefined()
            const tx = await waitFor(() => oracleTx(push.ok.txid), 60000)
            expect(tx).toBeDefined()
            expect(tx.vin.some(v => v.txid === pop1.txid && (v.vout || 0) === utxo.vout)).toBe(true)
        })

        it('beneficiary (B) cannot claim a PROTECT_OP before its lock time; it is left to mature for the next run', async () => {
            pop2 = await createPop('beneficiary-matures-next-run')
            verifyPopStructure(pop2.tx)
            await initWallet(walletB)
            const seen = await waitFor(async () => {
                const all = walletExternal.getAll_txs(appStore.getState().wallet.assets.find(p => p.symbol === 'BTC_TEST'))
                return all.find(t => t.txid === pop2.txid)
            }, 10 * 60000, 15000)
            if (seen) expect(seen.p_op_weAreBeneficiary).toBe(true)
            const list = await svrRouter.fn(appWorker, appStore, { mpk: walletB.mpk, symbol: 'BTC_TEST' }, 'CLAIMABLE-LIST')
            expect(list.ok.claimable.some(p => p.protect_op_tx.txid === pop2.txid)).toBe(false)
        })
    })
})
