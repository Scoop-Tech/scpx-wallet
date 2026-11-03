// Lean OFFLINE tests (Node 14, in-process) for the wallet's ETH / ERC20 history mapping - app-worker/worker-account.js:
//   mapTxBundle_blockbook / mapTx_blockbook (Blockbook 0.6 getTransaction -> per-asset wallet txs) on saved real-chain
//   fixtures (tests/lean/fixtures/eth-bb-*.json; re-fetch with fixtures/fetch-eth-fixtures.mjs): plain ETH transfer (both
//   directions), reverted tx, contract creation (own + a third party's), USDT transfer() in/out, USDC/USDT received via a
//   router, ETH->USDT swap, spam mint/airdrops, address poisoning, a look-alike "USDT", Sepolia faucet mint, Sepolia
//   self-send and USDC_TEST transfer. Known tokens = configExternal.erc20Contracts (the code's historical erc20 list),
//   matched by contract address.
//   - shape parity with the legacy web3 mapper (mapTx_web3) on the same txs (publicnode tx/receipt/block in each fixture)
//   - synthetic variants: pending, pending contract creation, reverted transfer() with no Transfer event
//   - enrichTx_blockbook (cache + Blockbook path) over a mock send: one getTransaction per tx shared by ETH + ERC20 assets,
//     confirmed txs cached, unconfirmed re-queried, old-format cache entries replaced
// Nothing touches the network. Run: node tests/lean/eth-mapping.node14.js
'use strict'
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert')
const REPO = path.resolve(__dirname, '../..')
const FIX = path.join(__dirname, 'fixtures')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'scpx-lean-ethmap-'))
process.chdir(TMP) // the wallet's winston logs land here; deleted at the end
process.on('exit', () => { try { process.chdir(os.tmpdir()); fs.rmdirSync(TMP, { recursive: true }) } catch (e) {} })
process.on('unhandledRejection', (e) => { console.error('✖ unhandled rejection:', e && e.stack || e); process.exit(1) })

global.self = global
Object.assign(self, { bb_Sockets: {}, bb_Sockets_messageID: {}, bb_Sockets_pendingMessages: {}, bb_Sockets_subscriptions: {},
    web3_Sockets: {}, geth_Sockets: {}, workerId: 'lean-ethmap' })
self.window = self
self.postMessage = () => {}
global.txdb_dirty = require(`${REPO}/node_modules/dirty`)() // in-memory tx cache

const BigNumber = require(`${REPO}/node_modules/bignumber.js`)
const configWallet = require(`${REPO}/config/wallet`)
const configExternal = require(`${REPO}/config/wallet-external`)
const wa = require(`${REPO}/app-worker/worker-account`)
const utilsWallet = require(`${REPO}/utils`)
const fm = require(`${REPO}/node_modules/web3-core-helpers`).formatters
const fromWei = require(`${REPO}/node_modules/web3-utils`).fromWei
if (!process.env.LEAN_VERBOSE) for (const k of ['log', 'info', 'warn', 'debug']) console[k] = () => {} // wallet logging

const fixture = name => JSON.parse(fs.readFileSync(path.join(FIX, `${name}.json`), 'utf8'))
const clone = o => JSON.parse(JSON.stringify(o))
const results = []
async function step(name, fn) {
    const t0 = Date.now()
    try { const note = await fn(); results.push(['✔', name, Date.now() - t0, note]) }
    catch (e) { results.push(['✖', name, Date.now() - t0, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e)]) }
}

const meta = k => configWallet.walletsMeta[k]
const watch = (k, addrs) => Object.assign({ addresses: addrs.map(a => ({ addr: a, txs: [] })), local_txs: [] }, meta(k))
const MAINNET = ['ethereum', 'usdt', 'usdc'], SEPOLIA = ['eth(t)', 'usdt(t)', 'usdc(t)']
const walletFor = (f, own) => ({ owner: 'lean', assets: (f.net === 'sepolia' ? SEPOLIA : MAINNET).map(k => watch(k, [own || f.ownAddress])) })
const ethKey = f => (f.net === 'sepolia' ? 'eth(t)' : 'ethereum')
const lc = s => s && s.toLowerCase()

function bundleOf(name, own) {
    const f = fixture(name), o = own || f.ownAddress
    const wallet = walletFor(f, o)
    return { f, wallet, b: wa.mapTxBundle_blockbook(wallet, clone(f.getTransaction), [o], o) }
}
// legacy web3 mapping of the same tx (publicnode objects formatted by web3's own output formatters), for one asset
function web3Map(f, assetKey, own) {
    const o = own || f.ownAddress, wallet = walletFor(f, o)
    const txData = fm.outputTransactionFormatter(clone(f.web3.tx))
    const receipt = fm.outputTransactionReceiptFormatter(clone(f.web3.receipt))
    const block = fm.outputBlockFormatter(clone(f.web3.block))
    return wa.mapTx_web3(wallet, meta(assetKey), { txid: f.txid }, txData, receipt, block, [o], o, fromWei)
}
const bbFeeEth = f => Number(new BigNumber(f.getTransaction.fees).div('1e18').toFixed())
const expectCommon = (v, f, weSent) => {
    const t = f.getTransaction
    assert.strictEqual(v.txid, f.txid); assert.strictEqual(v.isMinimal, false)
    assert.strictEqual(v.block_no, t.blockHeight); assert.strictEqual(v.date.getTime(), t.blockTime * 1000)
    assert.strictEqual(v.nonce, t.ethereumSpecific.nonce)
    assert.strictEqual(v.fees, weSent ? bbFeeEth(f) : 0, 'fees: actually paid if we sent it, else 0')
}

async function offline() {
    // ---------------- ETH ----------------
    await step('plain ETH transfer: incoming for the receiver, outgoing for the sender; parity with mapTx_web3', () => {
        const { f, b } = bundleOf('eth-bb-plain-transfer')
        const e = b.eth, sender = f.getTransaction.vin[0].addresses[0]
        assert.deepStrictEqual(Object.keys(b.erc20), [])
        assert.strictEqual(e.isIncoming, true); assert.strictEqual(e.sendToSelf, false); assert.strictEqual(e.value, 0.2)
        assert.strictEqual(e.erc20, undefined); assert.strictEqual(e.toOrFrom, sender); assert.strictEqual(e.account_to, lc(f.ownAddress))
        assert.strictEqual(e.account_from, lc(sender)); assert.strictEqual(e.txFailedReverted, false)
        assert.strictEqual(e.erc20_isUnsupported, undefined); assert.strictEqual(e.isNonErc20_ContractParam, undefined)
        expectCommon(e, f, false)
        const out = bundleOf('eth-bb-plain-transfer', sender).b.eth
        assert.strictEqual(out.isIncoming, false); assert.strictEqual(out.toOrFrom, f.ownAddress); assert.ok(out.fees > 0)
        expectCommon(out, f, true)
        // same values as the legacy mapper, except fees (now the fee paid: gasUsed x price; web3 path: gas limit x price)
        for (const [o, v] of [[f.ownAddress, e], [sender, out]]) {
            const w = web3Map(f, 'ethereum', o)
            assert.deepStrictEqual(Object.assign({}, v, { fees: 0 }), Object.assign({}, w, { fees: 0 }))
            assert.ok(v.fees <= w.fees)
        }
    })
    await step('reverted tx (status 0): txFailedReverted, fee still counted; parity with mapTx_web3', () => {
        const { f, b } = bundleOf('eth-bb-failed')
        assert.strictEqual(f.getTransaction.ethereumSpecific.status, 0)
        const e = b.eth
        assert.strictEqual(e.txFailedReverted, true); assert.strictEqual(e.isIncoming, false); assert.strictEqual(e.value, 0)
        assert.strictEqual(e.account_to, lc(f.getTransaction.vout[0].addresses[0])); assert.ok(e.fees > 0)
        expectCommon(e, f, true)
        const w = web3Map(f, 'ethereum')
        assert.strictEqual(w.txFailedReverted, true)
        assert.deepStrictEqual(Object.assign({}, e, { fees: 0 }), Object.assign({}, w, { fees: 0 }))
        assert.ok(e.fees < w.fees, `paid ${e.fees} < limit-based ${w.fees}`)
    })
    await step('contract creation (own): to = createdContract, isContractCreation; parity with mapTx_web3 (receipt.contractAddress)', () => {
        const { f, b } = bundleOf('eth-bb-contract-creation-own')
        const created = f.getTransaction.ethereumSpecific.createdContract
        assert.ok(created && !f.getTransaction.vout[0].addresses)
        const e = b.eth
        assert.strictEqual(e.isContractCreation, true); assert.strictEqual(e.isIncoming, false)
        assert.strictEqual(e.account_to, lc(created)); assert.strictEqual(e.toOrFrom, created)
        assert.strictEqual(lc(created), lc(f.web3.receipt.contractAddress))
        expectCommon(e, f, true)
        const w = web3Map(f, 'ethereum')
        assert.deepStrictEqual(Object.assign({}, e, { fees: 0, toOrFrom: lc(e.toOrFrom) }), Object.assign({}, w, { fees: 0, toOrFrom: lc(w.toOrFrom) }))
    })
    await step('contract creation by a third party airdropping a spam token + real TUSD dust: TUSD view (historical erc20 list), ETH view tagged', () => {
        const { f, b } = bundleOf('eth-bb-contract-creation-airdrop')
        assert.deepStrictEqual(Object.keys(b.erc20), ['TUSD'])
        const t = b.erc20.TUSD
        assert.strictEqual(lc(t.erc20_contract), lc(configExternal.erc20Contracts.TUSD))
        assert.strictEqual(t.isIncoming, true); assert.strictEqual(t.value, 0.0001, 'TUSD not in the wallet: Blockbook decimals (18)')
        assert.strictEqual(t.account_to, lc(f.ownAddress)); expectCommon(t, f, false)
        assert.strictEqual(b.eth.erc20, 'TUSD'); assert.strictEqual(b.eth.isIncoming, true); assert.strictEqual(b.eth.isContractCreation, true)
        assert.strictEqual(b.eth.value, 0)
    })
    await step('Sepolia self-send: sendToSelf, outgoing; parity with mapTx_web3', () => {
        const { f, b } = bundleOf('eth-bb-sepolia-self-send')
        const e = b.eth
        assert.strictEqual(e.sendToSelf, true); assert.strictEqual(e.isIncoming, false); assert.strictEqual(e.value, 1e-9)
        expectCommon(e, f, true)
        const w = web3Map(f, 'eth(t)')
        assert.deepStrictEqual(Object.assign({}, e, { fees: 0 }), Object.assign({}, w, { fees: 0 }))
    })

    // ---------------- ERC20 ----------------
    await step('USDT transfer() out: USDT view -1600 to the recipient; ETH view = the fee tx (erc20 tagged, value 0)', () => {
        const { f, b } = bundleOf('eth-bb-usdt-transfer-out')
        const t = b.erc20.USDT, rcpt = f.getTransaction.tokenTransfers[0].to
        assert.deepStrictEqual(Object.keys(b.erc20), ['USDT'])
        assert.strictEqual(t.erc20, 'USDT'); assert.strictEqual(t.erc20_contract, f.getTransaction.vout[0].addresses[0])
        assert.strictEqual(t.isIncoming, false); assert.strictEqual(t.sendToSelf, false); assert.strictEqual(t.value, 1600)
        assert.strictEqual(t.account_to, lc(rcpt)); assert.strictEqual(t.account_from, lc(f.ownAddress)); assert.strictEqual(t.toOrFrom, rcpt)
        expectCommon(t, f, true)
        assert.strictEqual(b.eth.erc20, 'USDT'); assert.strictEqual(b.eth.erc20_contract, t.erc20_contract); assert.strictEqual(b.eth.value, 0)
        assert.strictEqual(b.eth.isIncoming, false); assert.strictEqual(b.eth.fees, t.fees)
        // legacy web3: same erc20 tx, except toOrFrom (was the token contract, now the recipient - as the local tx) and fees
        const w = web3Map(f, 'usdt')
        assert.strictEqual(lc(w.toOrFrom), lc(t.erc20_contract))
        assert.deepStrictEqual(Object.assign({}, t, { fees: 0, toOrFrom: 0 }), Object.assign({}, w, { fees: 0, toOrFrom: 0 }))
        // as an asset view: USDT gets it, USDC doesn't, ETH gets the fee tx
        const own = [f.ownAddress]
        assert.strictEqual(wa.mapTx_blockbook({ assets: [] }, meta('usdc'), f.getTransaction, own, own[0]), undefined)
        assert.strictEqual(wa.mapTx_blockbook({ assets: [] }, meta('usdt'), f.getTransaction, own, own[0]).value, 1600)
        assert.strictEqual(wa.mapTx_blockbook({ assets: [] }, meta('ethereum'), f.getTransaction, own, own[0]).erc20, 'USDT')
    })
    await step('USDT transfer() in: USDT view +693.070627 from the sender; parity with mapTx_web3', () => {
        const { f, b } = bundleOf('eth-bb-usdt-transfer-in')
        const t = b.erc20.USDT, sender = f.getTransaction.vin[0].addresses[0]
        assert.strictEqual(t.isIncoming, true); assert.strictEqual(t.value, 693.070627); assert.strictEqual(t.toOrFrom, sender)
        assert.strictEqual(t.account_to, lc(f.ownAddress)); assert.strictEqual(t.fees, 0); expectCommon(t, f, false)
        assert.strictEqual(b.eth.erc20, 'USDT'); assert.strictEqual(b.eth.isIncoming, true) // hidden in the UI's ETH history (as before)
        const w = web3Map(f, 'usdt')
        assert.deepStrictEqual(t, w)
    })
    await step('USDC received via the 1inch router (tx.to = router): USDC view +147.841919 (web3 path: listed only as an ETH contract call)', () => {
        const { f, b } = bundleOf('eth-bb-usdc-router-in')
        assert.deepStrictEqual(Object.keys(b.erc20), ['USDC'], 'YFI is not a wallet erc20')
        const t = b.erc20.USDC, router = f.getTransaction.vout[0].addresses[0]
        assert.strictEqual(t.isIncoming, true, 'direction from the token flow, although we sent the tx'); assert.strictEqual(t.value, 147.841919)
        assert.strictEqual(lc(t.erc20_contract), lc(configExternal.erc20Contracts.USDC)); assert.strictEqual(t.toOrFrom, router)
        expectCommon(t, f, true)
        assert.strictEqual(b.eth.erc20, 'USDC'); assert.strictEqual(b.eth.isIncoming, false); assert.strictEqual(b.eth.toOrFrom, router)
        const w = web3Map(f, 'usdc')
        assert.strictEqual(w.erc20, undefined, 'legacy: not a USDC tx')
    })
    await step('USDT received from the router for sUSD: USDT view +419.554618 (sUSD: unknown, ignored)', () => {
        const { f, b } = bundleOf('eth-bb-usdt-router-swap-in')
        assert.deepStrictEqual(Object.keys(b.erc20), ['USDT'])
        assert.strictEqual(b.erc20.USDT.isIncoming, true); assert.strictEqual(b.erc20.USDT.value, 419.554618); expectCommon(b.erc20.USDT, f, true)
        assert.strictEqual(b.eth.erc20, 'USDT'); assert.strictEqual(b.eth.erc20_isUnsupported, undefined)
    })
    await step('swap paying 0.0605 ETH for USDT: ETH view is a plain ETH send (-0.0605), USDT view +249.722489', () => {
        const { f, b } = bundleOf('eth-bb-usdt-swap-eth')
        assert.strictEqual(b.eth.erc20, undefined); assert.strictEqual(b.eth.value, 0.0605); assert.strictEqual(b.eth.isIncoming, false)
        assert.strictEqual(b.eth.isNonErc20_ContractParam, undefined); expectCommon(b.eth, f, true)
        assert.strictEqual(b.erc20.USDT.isIncoming, true); assert.strictEqual(b.erc20.USDT.value, 249.722489)
        assert.strictEqual(b.erc20.USDT.account_from, lc(f.getTransaction.tokenTransfers.find(t => lc(t.to) === lc(f.ownAddress)).from))
    })
    await step('spam mint (from 0x0) + spam airdrop of unknown tokens: no erc20 view; ETH view erc20_isUnsupported to us (+0)', () => {
        for (const name of ['eth-bb-mint-airdrop', 'eth-bb-spam-airdrop']) {
            const { f, b } = bundleOf(name)
            assert.deepStrictEqual(Object.keys(b.erc20), [], name)
            assert.strictEqual(b.eth.erc20_isUnsupported, true, name); assert.strictEqual(b.eth.account_to, lc(f.ownAddress), name)
            assert.strictEqual(b.eth.isIncoming, true); assert.strictEqual(b.eth.value, 0); assert.strictEqual(b.eth.isNonErc20_ContractParam, undefined)
            expectCommon(b.eth, f, false)
        }
    })
    await step('address poisoning (0 real USDT "from" us to a look-alike): NOT in USDT history; ETH view = contract call (as web3)', () => {
        const { f, b } = bundleOf('eth-bb-usdt-poisoning')
        const tt = f.getTransaction.tokenTransfers.find(t => lc(t.from) === lc(f.ownAddress))
        assert.strictEqual(lc(tt.contract), lc(configExternal.erc20Contracts.USDT)); assert.strictEqual(tt.value, '0')
        assert.deepStrictEqual(Object.keys(b.erc20), [])
        assert.strictEqual(b.eth.isNonErc20_ContractParam, true); assert.strictEqual(b.eth.account_to, f.ownAddress)
        const w = web3Map(f, 'ethereum')
        assert.deepStrictEqual(b.eth, w)
    })
    await step('look-alike token with symbol "USDT" (other contract): not USDT - matched by contract address, not symbol', () => {
        const { f, b } = bundleOf('eth-bb-fake-usdt')
        const fake = f.getTransaction.tokenTransfers.find(t => lc(t.from) === lc(f.ownAddress))
        assert.strictEqual(fake.symbol, 'USDT'); assert.notStrictEqual(lc(fake.contract), lc(configExternal.erc20Contracts.USDT))
        assert.deepStrictEqual(Object.keys(b.erc20), [])
        assert.strictEqual(b.eth.erc20_isUnsupported, true); assert.strictEqual(b.eth.isNonErc20_ContractParam, true)
    })
    await step('Sepolia faucet mint (from 0x0, tx.to = faucet): USDT_TEST view +1000; ETH view = the fee tx', () => {
        const { f, b } = bundleOf('eth-bb-sepolia-faucet-mint')
        assert.deepStrictEqual(Object.keys(b.erc20), ['USDT_TEST'])
        const t = b.erc20.USDT_TEST
        assert.strictEqual(t.isIncoming, true); assert.strictEqual(t.value, 1000); assert.strictEqual(t.account_from, '0x0000000000000000000000000000000000000000')
        assert.strictEqual(lc(t.erc20_contract), lc(configExternal.erc20Contracts.USDT_TEST)); expectCommon(t, f, true)
        assert.strictEqual(b.eth.erc20, 'USDT_TEST'); assert.strictEqual(b.eth.isIncoming, false); assert.strictEqual(b.eth.value, 0)
        assert.strictEqual(web3Map(f, 'usdt(t)').erc20, undefined, 'legacy: not a USDT_TEST tx')
    })
    await step('Sepolia USDC_TEST transfer() out: parity with mapTx_web3 (except toOrFrom = recipient, fees = paid)', () => {
        const { f, b } = bundleOf('eth-bb-sepolia-usdc-transfer-out')
        const t = b.erc20.USDC_TEST
        assert.strictEqual(t.isIncoming, false); assert.strictEqual(t.value, 0.01); expectCommon(t, f, true)
        const w = web3Map(f, 'usdc(t)')
        assert.deepStrictEqual(Object.assign({}, t, { fees: 0, toOrFrom: 0 }), Object.assign({}, w, { fees: 0, toOrFrom: 0 }))
    })
    await step('every view has (at least) the legacy web3 shape: same keys as mapTx_web3 for the same asset', () => {
        const names = fs.readdirSync(FIX).filter(n => /^eth-bb-.*\.json$/.test(n)).map(n => n.replace(/\.json$/, ''))
        let n = 0
        for (const name of names) {
            const { f, b } = bundleOf(name)
            const ethV = b.eth, w = web3Map(f, ethKey(f))
            if (!w) continue
            // the legacy ETH view of a known-token transfer() was the erc20 tx itself: compare like with like.
            // Conditional flags (erc20_isUnsupported / isNonErc20_ContractParam) legitimately differ where a tx is now recognised
            // as a known-token tx (e.g. a router delivery): every other legacy key must be there.
            const mine = w.erc20 ? b.erc20[w.erc20] : ethV
            const conditional = ['erc20_isUnsupported', 'isNonErc20_ContractParam']
            const missing = Object.keys(w).filter(k => !(k in mine) && conditional.indexOf(k) === -1)
            assert.deepStrictEqual(missing, [], `${name}: keys missing vs mapTx_web3`)
            n++
        }
        return `${n} fixtures`
    })

    // ---------------- synthetic variants ----------------
    await step('pending (mempool) tx: block_no -1, fee = gas limit x price, not reverted', () => {
        const f = fixture('eth-bb-usdt-transfer-out'), t = clone(f.getTransaction)
        Object.assign(t, { blockHeight: -1, confirmations: 0, blockHash: undefined })
        t.ethereumSpecific.status = -1; delete t.ethereumSpecific.gasUsed
        const b = wa.mapTxBundle_blockbook({ assets: [] }, t, [f.ownAddress], f.ownAddress)
        assert.strictEqual(b.block_no, -1); assert.strictEqual(b.eth.block_no, -1); assert.strictEqual(b.erc20.USDT.block_no, -1)
        assert.strictEqual(b.erc20.USDT.txFailedReverted, false)
        const es = t.ethereumSpecific
        assert.strictEqual(b.eth.fees, Number(new BigNumber(es.gasLimit).times(es.gasPrice).div('1e18').toFixed()))
    })
    await step('pending contract creation (no createdContract yet): not mapped (null), so it is re-queried', () => {
        const f = fixture('eth-bb-contract-creation-own'), t = clone(f.getTransaction)
        Object.assign(t, { blockHeight: -1 }); delete t.ethereumSpecific.createdContract
        assert.strictEqual(wa.mapTxBundle_blockbook({ assets: [] }, t, [f.ownAddress], f.ownAddress), null)
    })
    await step('reverted USDT transfer() (no Transfer event): USDT view from the call data, REVERTED', () => {
        const f = fixture('eth-bb-usdt-transfer-out'), t = clone(f.getTransaction)
        t.tokenTransfers = []; t.ethereumSpecific.status = 0
        // decimals from the wallet's USDT asset (no Transfer event: no Blockbook decimals; as mapTx_web3, needs the asset)
        assert.deepStrictEqual(Object.keys(wa.mapTxBundle_blockbook({ assets: [] }, t, [f.ownAddress], f.ownAddress).erc20), [])
        const b = wa.mapTxBundle_blockbook({ assets: [meta('usdt')] }, t, [f.ownAddress], f.ownAddress)
        const u = b.erc20.USDT
        assert.strictEqual(u.txFailedReverted, true); assert.strictEqual(u.value, 1600); assert.strictEqual(u.isIncoming, false)
        assert.strictEqual(u.account_to, lc(f.getTransaction.tokenTransfers[0].to)); assert.strictEqual(b.eth.erc20, 'USDT')
    })
    await step('wallet asset decimals win over Blockbook decimals; unknown decimals -> treated as unsupported', () => {
        const f = fixture('eth-bb-usdt-transfer-out')
        const w = { assets: [Object.assign({}, meta('usdt'), { decimals: 4 })] }
        assert.strictEqual(wa.mapTxBundle_blockbook(w, clone(f.getTransaction), [f.ownAddress], f.ownAddress).erc20.USDT.value, 160000)
        const t = clone(f.getTransaction); delete t.tokenTransfers[0].decimals
        const b = wa.mapTxBundle_blockbook({ assets: [] }, t, [f.ownAddress], f.ownAddress)
        assert.deepStrictEqual(Object.keys(b.erc20), []); assert.strictEqual(b.eth.erc20_isUnsupported, true)
    })

    // ---------------- enrichment path (cache + Blockbook), mock send ----------------
    await step('enrichTx_blockbook: one getTransaction shared by ETH/USDT/USDC; confirmed cached; unconfirmed re-queried; old cache format replaced', async () => {
        const f = fixture('eth-bb-usdt-transfer-out'), own = f.ownAddress
        const wallet = { owner: 'lean-enrich', assets: MAINNET.map(k => watch(k, [own])) }
        const [eth, usdt, usdc] = wallet.assets
        const sent = []
        let reply = clone(f.getTransaction)
        const send = (method, params, cb) => { sent.push(`${method}:${params.txid}`); setTimeout(() => cb(clone(reply)), 20) }
        // concurrent refresh of the three assets: one fetch
        const [a, b, c] = await Promise.all([eth, usdt, usdc].map(asset => wa.enrichTx_blockbook(wallet, asset, f.txid, own, send)))
        assert.strictEqual(sent.length, 1, `getTransaction calls: ${sent}`)
        assert.strictEqual(a.erc20, 'USDT'); assert.strictEqual(a.fromCache, false)
        assert.strictEqual(b.value, 1600); assert.strictEqual(c, null)
        const key = `ETH_${wallet.owner}_txid_${f.txid}`
        const cached = await utilsWallet.txdb_getItem(key)
        assert.strictEqual(cached.v, wa.TX_CACHE_V); assert.strictEqual(cached.erc20.USDT.value, 1600)
        // again: all from the cache
        const b2 = await wa.enrichTx_blockbook(wallet, usdt, f.txid, own, send)
        assert.strictEqual(sent.length, 1); assert.strictEqual(b2.fromCache, true); assert.strictEqual(b2.value, 1600)
        assert.strictEqual(cached.erc20.USDT.fromCache, undefined, 'the cached bundle is not mutated')
        // unconfirmed: never cached, re-queried on every refresh
        const p = clone(f.getTransaction); p.txid = '0x' + 'ab'.repeat(32); p.blockHeight = -1; p.ethereumSpecific.status = -1
        reply = p
        const u1 = await wa.enrichTx_blockbook(wallet, eth, p.txid, own, send)
        const u2 = await wa.enrichTx_blockbook(wallet, usdt, p.txid, own, send)
        assert.strictEqual(u1.block_no, -1); assert.strictEqual(u2.block_no, -1); assert.strictEqual(sent.length, 3)
        assert.strictEqual(await utilsWallet.txdb_getItem(`ETH_${wallet.owner}_txid_${p.txid}`), undefined)
        // an old-format (web3-mapped) cache entry is refetched and replaced
        const o = clone(f.getTransaction); o.txid = '0x' + 'cd'.repeat(32); reply = o
        const oldKey = `ETH_${wallet.owner}_txid_${o.txid}`
        await utilsWallet.txdb_setItem(oldKey, { txid: o.txid, erc20: undefined, block_no: 1, value: 0, isMinimal: false })
        const r = await wa.enrichTx_blockbook(wallet, usdt, o.txid, own, send)
        assert.strictEqual(sent.length, 4); assert.strictEqual(r.value, 1600)
        assert.strictEqual((await utilsWallet.txdb_getItem(oldKey)).v, wa.TX_CACHE_V)
        // Sepolia assets use their own cache key prefix and Blockbook (ETH_TEST)
        const sw = { owner: 'lean-enrich', assets: SEPOLIA.map(k => watch(k, [own])) }
        reply = clone(f.getTransaction)
        await wa.enrichTx_blockbook(sw, sw.assets[1], f.txid, own, send)
        assert.strictEqual(sent.length, 5, 'ETH_TEST cache is separate from ETH')
        return `${sent.length} getTransaction calls`
    })
    await step('enrichTx_blockbook: unmappable tx resolves null (no throw, nothing cached)', async () => {
        const own = '0xFfB3B82D6BAe4E1C341E7423069C695Eee1b4C78'
        const wallet = { owner: 'lean-enrich2', assets: MAINNET.map(k => watch(k, [own])) }
        const bad = { txid: '0x' + 'ef'.repeat(32), vin: [], vout: [] } // no sender
        const r = await wa.enrichTx_blockbook(wallet, wallet.assets[0], bad.txid, own, (m, p, cb) => cb(clone(bad)))
        assert.strictEqual(r, null)
        assert.strictEqual(await utilsWallet.txdb_getItem(`ETH_lean-enrich2_txid_${bad.txid}`), undefined)
    })
}

;(async () => {
    let rc = 0
    try { await offline() } catch (e) { results.push(['✖', 'setup', 0, e.stack || e.message]); rc = 1 }
    process.stdout.write('\nLEAN eth-mapping results (offline)\n')
    for (const [s, n, ms, note] of results) process.stdout.write(`  ${s} ${n} (${ms}ms)${note ? ' - ' + note : ''}\n`)
    if (results.some(r => r[0] === '✖')) rc = 1
    process.stdout.write(`  ${results.filter(r => r[0] === '✔').length}/${results.length} passed\n`)
    process.exit(rc)
})()
