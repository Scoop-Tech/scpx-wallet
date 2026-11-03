// Lean tests (Node 14, in-process) for the wallet's Blockbook UTXO/ETH read path - app-worker/worker-blockbook.js + worker-account.js.
//   OFFLINE (saved real-chain fixtures in tests/lean/fixtures/, re-fetch with fixtures/fetch-fixtures.mjs):
//     - tx mapping (mapTx_BlockbookToInsight + map_insightTxs): ZEC v4 t->t, v6 z->t, v5 t->z, v6 coinbase; BTC coinbase, P2PKH.
//       Coinbase inputs (no addresses) used to throw, which hung enrichTx (and the whole address fetch) for mining addresses.
//     - UTXO filter (filterUtxos_TxSpecific): P2PKH as Core 29 returns it (singular scriptPubKey.address, type pubkeyhash) and
//       Zebra's addresses[] form; OP_RETURN (nulldata) outputs are never UTXOs.
//     - getAddressFull_Blockbook_v3 end-to-end over a mock websocket serving the fixtures (coinbase history resolves).
//     - websocket dispatch: a bad frame / throwing callback can't stop later replies.
//     - heavy-request limiter (getTransaction / getTransactionSpecific / getBlock): per-socket in-flight cap, FIFO queue,
//       cheap methods unthrottled, timeouts free slots, socket close fails queued + pending, stale timeouts after a reconnect.
//     - getSyncInfo for ZEC (websocket getBlock "Not supported"): block info still dispatched; no median-time-past attempt.
//     - ETH contract creation (to == null) is mapped, not dropped (worker-account mapTx_web3).
//   LIVE (READ-ONLY; skip with LEAN_OFFLINE=1): the wallet's own getAddressFull_Blockbook_v3 over real Trezor sockets vs oracles:
//     - BTC legacy P2PKH 1EvanBTC... (btc1): UTXOs == mempool.space
//     - heavy P2SH 38Umu... (btc2): UTXO count == mempool.space, no request timed out, socket still open, cap engaged
//     - ZEC t1cf9... (zec1): UTXOs == getAccountUtxo; ZEC mining address (all-coinbase history) loads; ZEC block info dispatched
// Nothing is signed or broadcast. No keys/MPK involved. Runs in a temp dir (wallet logs) that is deleted at the end.
// Run: node --experimental-worker tests/lean/utxo-mapping.node14.js
'use strict'
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert')
const REPO = path.resolve(__dirname, '../..')
const FIX = path.join(__dirname, 'fixtures')
const LIVE = process.env.LEAN_OFFLINE !== '1'
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'scpx-lean-utxo-'))
process.chdir(TMP) // the wallet's winston logs land here; deleted at the end (also on a crash)
process.on('exit', () => { try { process.chdir(os.tmpdir()); fs.rmdirSync(TMP, { recursive: true }) } catch (e) {} })
process.on('uncaughtException', (e) => { console.error('✖ uncaught exception:', e && e.stack || e); process.exit(1) })
process.on('unhandledRejection', (e) => { console.error('✖ unhandled rejection:', e && e.stack || e); process.exit(1) })

// worker modules run in-process, with `self` = global (as the research watch harness)
global.self = global
Object.assign(self, { bb_Sockets: {}, bb_Sockets_messageID: {}, bb_Sockets_pendingMessages: {}, bb_Sockets_subscriptions: {},
    bb_Sockets_subId_NewBlock: {}, bb_Sockets_keepAliveIntervalID: {}, web3_Sockets: {}, geth_Sockets: {},
    blocks_time: {}, blocks_tps: {}, blocks_height: {}, workerId: 'lean-utxo' })
self.window = self
const posted = []
self.postMessage = (m) => { posted.push(m) }
global.txdb_dirty = require(`${REPO}/node_modules/dirty`)() // in-memory tx cache

const BigNumber = require(`${REPO}/node_modules/bignumber.js`)
const axios = require(`${REPO}/node_modules/axios`)
const configWallet = require(`${REPO}/config/wallet`)
const wb = require(`${REPO}/app-worker/worker-blockbook`)
const workerAccount = require(`${REPO}/app-worker/worker-account`)
const walletUtxo = require(`${REPO}/actions/wallet-utxo`)
const walletShared = require(`${REPO}/actions/wallet-shared`)
const utilsWallet = require(`${REPO}/utils`)

// count wallet error logs that are request timeouts (the wallet logs, then swallows them)
const errLog = []
const origError = utilsWallet.error
utilsWallet.error = function () { errLog.push(Array.prototype.map.call(arguments, a => (a && a.message) || String(a)).join(' ')); return origError.apply(this, arguments) }

const fixture = name => JSON.parse(fs.readFileSync(path.join(FIX, `${name}.json`), 'utf8'))
const sleep = ms => new Promise(r => setTimeout(r, ms))
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what}: no result after ${ms}ms (hang)`)), ms))])
const results = []
async function step(name, fn) {
    const t0 = Date.now()
    try { const note = await fn(); results.push(['✔', name, Date.now() - t0, note]) }
    catch (e) { results.push(['✖', name, Date.now() - t0, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e)]) }
}

// a displayable asset as actions/wallet.js builds it, with known public (watch) addresses - no keys
function watchAsset(metaKey, addrs) {
    const meta = configWallet.walletsMeta[metaKey]
    const addresses = addrs.map((a, i) => walletShared.newWalletAddressFromPrivKey({ assetName: metaKey, accountName: 'watch', key: { path: `~w/${i}` }, knownAddr: a, symbol: meta.symbol }))
    return Object.assign({ addresses, local_txs: [] }, meta)
}
function mapFixture(name, ownAddresses) {
    const f = fixture(name)
    const asset = configWallet.walletsMeta[f.symbol === 'ZEC' ? 'zcash' : 'bitcoin']
    const insightTx = wb.mapTx_BlockbookToInsight(asset, f.getTransaction)
    const mapped = walletUtxo.map_insightTxs([insightTx], ownAddresses || [f.ownAddress], asset)[0]
    return { f, insightTx, mapped }
}
const sumOwnOut = (f, own) => f.getTransaction.vout.filter(v => (v.addresses || [])[0] === own).reduce((s, v) => s.plus(v.value), new BigNumber(0)).div(1e8).toNumber()

// mock Blockbook websocket for symbol x: handler(method, params) -> reply data (undefined: no automatic reply)
function mockSocket(x, handler) {
    const sock = { readyState: 1, sent: [], send(json) {
        const r = JSON.parse(json); sock.sent.push(r)
        const d = handler ? handler(r.method, r.params, r.id) : undefined
        if (d !== undefined) setImmediate(() => reply(sock, r.id, d))
    } }
    self.bb_Sockets[x] = sock; self.bb_Sockets_messageID[x] = 0; self.bb_Sockets_pendingMessages[x] = {}; self.bb_Sockets_subscriptions[x] = {}
    sock.x = x
    return sock
}
function reply(sock, id, data) { wb._test.onMessage(sock.x, { data: JSON.stringify({ id, data }) }, sock) }
function fixtureHandler(names, accountInfo, accountUtxo) {
    const byTxid = {}; names.forEach(n => { const f = fixture(n); byTxid[f.txid] = f })
    return (method, params) => {
        if (method === 'getAccountInfo') return accountInfo
        if (method === 'getAccountUtxo') return accountUtxo
        if (method === 'getTransaction') return byTxid[params.txid] ? byTxid[params.txid].getTransaction : { error: { message: 'not in fixtures' } }
        if (method === 'getTransactionSpecific') return byTxid[params.txid] && byTxid[params.txid].getTransactionSpecific || { error: { message: 'not in fixtures' } }
        return { error: { message: `mock: ${method} not handled` } }
    }
}
function fetchFull(asset, address) {
    const wallet = { owner: 'lean-watch', assets: [asset] }, acts = []
    return wb.getAddressFull_Blockbook_v3(wallet, asset, address, [], acts).then(res => ({ res, acts }))
}
const utxoKey = u => `${u.txid}:${u.vout}:${u.satoshis !== undefined ? u.satoshis : u.value}`

async function offline() {
    // ---------------- tx mapping ----------------
    await step('map ZEC v4 t->t (d07504f4): send-to-self, value = all outputs', () => {
        const { f, mapped } = mapFixture('zec-v4-t2t')
        assert.strictEqual(mapped.isIncoming, false); assert.strictEqual(mapped.sendToSelf, true)
        assert.strictEqual(mapped.value, sumOwnOut(f, f.ownAddress))
        assert.strictEqual(mapped.utxo_vin.length, 1)
    })
    await step('map ZEC v6 z->t (vin []): incoming from shielded, value = own outputs', () => {
        const { f, mapped } = mapFixture('zec-v6-z2t')
        assert.strictEqual(f.getTransaction.vin.length, 0)
        assert.strictEqual(mapped.isIncoming, true); assert.strictEqual(mapped.isFromShieldedAddr, true)
        assert.strictEqual(mapped.toOrFrom, '** shielded **'); assert.ok(mapped.value > 0); assert.strictEqual(mapped.value, sumOwnOut(f, f.ownAddress))
    })
    await step('map ZEC v5 t->z (vout []): outgoing, no transparent value', () => {
        const { f, mapped } = mapFixture('zec-v5-t2z')
        assert.strictEqual(f.getTransaction.vout.length, 0)
        assert.strictEqual(mapped.isIncoming, false); assert.strictEqual(mapped.value, 0)
        assert.strictEqual(mapped.utxo_vin.length, f.getTransaction.vin.length)
    })
    for (const name of ['zec-v6-coinbase', 'btc-coinbase-800000']) {
        await step(`map ${name}: coinbase input (no addresses) does not throw; incoming, value = own outputs`, () => {
            const raw = fixture(name).getTransaction
            assert.ok(raw.vin.length === 1 && raw.vin[0].addresses === undefined && raw.vin[0].coinbase, 'fixture is a real coinbase')
            const { f, insightTx, mapped } = mapFixture(name)
            assert.strictEqual(insightTx.vin[0].addr, undefined); assert.strictEqual(insightTx.vin[0].valueSat, 0); assert.strictEqual(insightTx.vin[0].coinbase, true)
            assert.strictEqual(mapped.isIncoming, true); assert.strictEqual(mapped.sendToSelf, false)
            assert.ok(mapped.value > 0); assert.strictEqual(mapped.value, sumOwnOut(f, f.ownAddress))
            assert.strictEqual(mapped.block_no, f.getTransaction.blockHeight); assert.strictEqual(mapped.utxo_vin.length, 0)
        })
    }
    for (const name of ['btc-p2pkh-opreturn', 'btc-p2pkh']) {
        await step(`map ${name}: P2PKH incoming, value = own output`, () => {
            const { f, mapped } = mapFixture(name)
            assert.strictEqual(mapped.isIncoming, true); assert.strictEqual(mapped.value, sumOwnOut(f, f.ownAddress)); assert.ok(mapped.value > 0)
        })
    }

    // ---------------- UTXO filter ----------------
    await step('UTXO filter: BTC Core 29 P2PKH (singular address, pubkeyhash) is found; OP_RETURN outputs never are', () => {
        const f = fixture('btc-p2pkh-opreturn'), spec = f.getTransactionSpecific
        const vo = spec.vout.find(v => v.n === 2)
        assert.strictEqual(vo.scriptPubKey.type, 'pubkeyhash'); assert.strictEqual(vo.scriptPubKey.address, f.ownAddress); assert.strictEqual(vo.scriptPubKey.addresses, undefined)
        assert.deepStrictEqual(f.getAccountUtxo.map(u => u.vout), [2])
        const got = wb.filterUtxos_TxSpecific(f.ownAddress, f.getAccountUtxo[0], spec)
        assert.deepStrictEqual(got.map(utxoKey), f.getAccountUtxo.map(utxoKey))
        assert.strictEqual(got[0].scriptPubKey.type, 'pubkeyhash'); assert.deepStrictEqual(got[0].scriptPubKey.addresses, [f.ownAddress]); assert.ok(got[0].scriptPubKey.hex)
        const opReturn = spec.vout.find(v => v.scriptPubKey.type === 'nulldata')
        assert.ok(opReturn, 'fixture has an OP_RETURN output')
        assert.deepStrictEqual(wb.filterUtxos_TxSpecific(f.ownAddress, { txid: f.txid, vout: opReturn.n }, spec), [], 'nulldata is never a utxo')
        for (const v of spec.vout) for (const u of wb.filterUtxos_TxSpecific(f.ownAddress, { txid: f.txid, vout: v.n }, spec)) assert.notStrictEqual(u.scriptPubKey.type, 'nulldata')
    })
    await step('UTXO filter: ZEC (Zebra) addresses[] form, two outputs of one tx', () => {
        const f = fixture('zec-v4-t2t'), spec = f.getTransactionSpecific
        assert.ok(spec.vout.every(v => Array.isArray(v.scriptPubKey.addresses)))
        const got = [].concat.apply([], f.getAccountUtxo.map(u => wb.filterUtxos_TxSpecific(f.ownAddress, u, spec)))
        assert.deepStrictEqual(got.map(utxoKey).sort(), f.getAccountUtxo.map(utxoKey).sort())
    })
    await step('UTXO filter: other address / missing vout / bad input -> nothing', () => {
        const f = fixture('btc-p2pkh-opreturn'), spec = f.getTransactionSpecific
        assert.deepStrictEqual(wb.filterUtxos_TxSpecific('1JoMXkJ8C7RjTYA8S6STYvjY9wifFc3pAK', f.getAccountUtxo[0], spec), [])
        assert.deepStrictEqual(wb.filterUtxos_TxSpecific(f.ownAddress, { txid: f.txid, vout: 99 }, spec), [])
        assert.deepStrictEqual(wb.filterUtxos_TxSpecific(f.ownAddress, f.getAccountUtxo[0], {}), [])
        assert.deepStrictEqual(wb.filterUtxos_TxSpecific(f.ownAddress, undefined, spec), [])
    })

    // ---------------- getAddressFull_Blockbook_v3 over a mock socket ----------------
    await step('getAddressFull (mock BTC socket): P2PKH UTXOs found, no OP_RETURN utxo, both txs enriched, getTransactionSpecific once per txid', async () => {
        const a = fixture('btc-p2pkh-opreturn'), b = fixture('btc-p2pkh'), addr = a.ownAddress
        const utxos = [].concat(a.getAccountUtxo, b.getAccountUtxo)
        const sock = mockSocket('BTC', fixtureHandler(['btc-p2pkh-opreturn', 'btc-p2pkh'], { balance: '1111111', unconfirmedBalance: '0', txids: [a.txid, b.txid] }, utxos))
        const { res, acts } = await withTimeout(fetchFull(watchAsset('bitcoin', [addr]), addr), 5000, 'getAddressFull')
        assert.deepStrictEqual(res.utxos.map(utxoKey).sort(), utxos.map(utxoKey).sort())
        assert.ok(res.utxos.every(u => u.scriptPubKey.type === 'pubkeyhash'))
        const enriched = acts.filter(p => p.type === 'WCORE_SET_ENRICHED_TXS').map(p => p.payload.txs.length)
        assert.deepStrictEqual(enriched, [2])
        assert.strictEqual(sock.sent.filter(r => r.method === 'getTransactionSpecific').length, 2)
    })
    await step('getAddressFull (mock ZEC socket): coinbase + t->z history resolves (used to hang), duplicate-txid UTXOs fetched once', async () => {
        const cb = fixture('zec-v6-coinbase'), t2z = fixture('zec-v5-t2z'), t2t = fixture('zec-v4-t2t'), addr = cb.ownAddress
        // the miner's history (coinbase, t->z) + a tx holding two utxos, served for the miner address (mock: content, not ownership, matters)
        const spec = JSON.parse(JSON.stringify(t2t.getTransactionSpecific)); spec.vout.forEach(v => { v.scriptPubKey.addresses = [addr] })
        const utxos = t2t.getAccountUtxo
        const handler = fixtureHandler(['zec-v6-coinbase', 'zec-v5-t2z', 'zec-v4-t2t'], { balance: '1', unconfirmedBalance: '0', txids: [cb.txid, t2z.txid] }, utxos)
        const sock = mockSocket('ZEC', (m, p) => m === 'getTransactionSpecific' ? spec : handler(m, p))
        const { res, acts } = await withTimeout(fetchFull(watchAsset('zcash', [addr]), addr), 5000, 'getAddressFull')
        assert.deepStrictEqual(res.utxos.map(utxoKey).sort(), utxos.map(utxoKey).sort())
        assert.strictEqual(sock.sent.filter(r => r.method === 'getTransactionSpecific').length, 1, 'one getTransactionSpecific for 2 utxos of one tx')
        const txs = [].concat.apply([], acts.filter(p => p.type === 'WCORE_SET_ENRICHED_TXS').map(p => p.payload.txs))
        assert.deepStrictEqual(txs.map(t => t.txid).sort(), [cb.txid, t2z.txid, t2t.txid].sort())
        const cbTx = txs.find(t => t.txid === cb.txid)
        assert.strictEqual(cbTx.isIncoming, true); assert.strictEqual(cbTx.value, sumOwnOut(cb, addr))
    })

    // ---------------- websocket dispatch ----------------
    await step('onmessage: bad JSON frame and a throwing callback do not stop later replies', () => {
        const x = 'MOCK_DISPATCH'
        self.bb_Sockets_pendingMessages[x] = {}; self.bb_Sockets_subscriptions[x] = {}
        const got = []
        self.bb_Sockets_pendingMessages[x]['1'] = () => { throw new Error('boom (expected)') }
        self.bb_Sockets_pendingMessages[x]['2'] = d => got.push(d)
        self.bb_Sockets_subscriptions[x]['9'] = d => { got.push(d); throw new Error('sub boom (expected)') }
        assert.doesNotThrow(() => wb._test.onMessage(x, { data: '{not json' }))
        assert.doesNotThrow(() => wb._test.onMessage(x, { data: JSON.stringify({ id: '1', data: { a: 1 } }) }))
        assert.doesNotThrow(() => wb._test.onMessage(x, { data: JSON.stringify({ id: '9', data: { s: 1 } }) }))
        assert.doesNotThrow(() => wb._test.onMessage(x, { data: JSON.stringify({ id: '2', data: { b: 2 } }) }))
        assert.doesNotThrow(() => wb._test.onMessage(x, { data: 'null' }))
        assert.deepStrictEqual(got, [{ s: 1 }, { b: 2 }])
        assert.strictEqual(self.bb_Sockets_pendingMessages[x]['1'], undefined)
    })

    // ---------------- heavy-request limiter ----------------
    await step('limiter: <= cap heavy requests in flight, FIFO queue drains, cheap methods unthrottled', async () => {
        const cfg = wb.isosocket_config_Blockbook()
        assert.strictEqual(cfg.heavyMaxInFlight, configWallet.WALLET_BB_HEAVY_MAX_INFLIGHT > 0 ? configWallet.WALLET_BB_HEAVY_MAX_INFLIGHT : 8, 'default cap 8')
        assert.ok(cfg.heavyTimeoutMs >= 10000, 'heavy timeout >= 10s')
        const x = 'MOCK_LIMIT', cap = cfg.heavyMaxInFlight
        const sock = mockSocket(x) // manual replies
        const done = []
        for (let i = 0; i < 30; i++) wb.isosocket_send_Blockbook(x, i % 3 === 0 ? 'getTransaction' : i % 3 === 1 ? 'getTransactionSpecific' : 'getBlock', { i }, d => done.push(d.i))
        assert.strictEqual(sock.sent.length, cap, `only ${cap} heavy sent`)
        for (let i = 0; i < 20; i++) wb.isosocket_send_Blockbook(x, i % 2 ? 'getAccountInfo' : 'getInfo', { cheap: i }, () => {})
        wb.isosocket_send_Blockbook(x, 'subscribeNewBlock', {}, () => {})
        assert.strictEqual(sock.sent.length, cap + 21, 'cheap methods are sent immediately while heavy ones are capped')
        let maxInFlight = 0
        while (done.length < 30) {
            const inflight = sock.sent.filter(r => r.params.i !== undefined && !r.replied)
            maxInFlight = Math.max(maxInFlight, inflight.length)
            assert.ok(inflight.length > 0 && inflight.length <= cap, `in flight ${inflight.length}`)
            const r = inflight[0]; r.replied = true
            reply(sock, r.id, { i: r.params.i })
        }
        assert.strictEqual(maxInFlight, cap)
        assert.deepStrictEqual(done, Array.from({ length: 30 }, (_, i) => i), 'FIFO order')
        assert.strictEqual(sock.bb_heavy.inFlight, 0); assert.strictEqual(sock.bb_heavy.queue.length, 0)
        assert.strictEqual(sock.bb_heavy.maxInFlight, cap); assert.strictEqual(sock.bb_heavy.maxQueued, 30 - cap)
        // cheap requests still pending -> fail them so their timers don't linger
        wb._test.failSocket(sock, 'test cleanup')
    })
    await step('limiter: a timed-out heavy request frees its slot; a throwing callback frees its slot', async () => {
        const prev = wb.isosocket_config_Blockbook()
        wb.isosocket_config_Blockbook({ heavyMaxInFlight: 2, heavyTimeoutMs: 200 })
        try {
            const x = 'MOCK_TIMEOUT', sock = mockSocket(x)
            const got = []
            wb.isosocket_send_Blockbook(x, 'getTransaction', { i: 0 }, d => { got.push(['0', d]); throw new Error('callback boom (expected)') })
            wb.isosocket_send_Blockbook(x, 'getTransaction', { i: 1 }, d => got.push(['1', d]))  // never answered -> times out
            wb.isosocket_send_Blockbook(x, 'getTransaction', { i: 2 }, d => got.push(['2', d]))
            wb.isosocket_send_Blockbook(x, 'getTransaction', { i: 3 }, d => got.push(['3', d]))
            assert.strictEqual(sock.sent.length, 2)
            reply(sock, sock.sent[0].id, { ok: 0 })                       // callback throws (caught by dispatch); slot must still free
            assert.strictEqual(sock.sent.length, 3, 'queued #2 sent after #0 replied (even though its callback threw)')
            reply(sock, sock.sent[2].id, { ok: 2 })
            assert.strictEqual(sock.sent.length, 4)
            await sleep(450)                                               // #1 (and #3) time out
            assert.deepStrictEqual(got.map(g => g[0]).sort(), ['0', '1', '2', '3'])
            assert.deepStrictEqual(got.find(g => g[0] === '1')[1], { error: 'Blockbook request timeout' })
            assert.strictEqual(sock.bb_heavy.inFlight, 0)
        } finally { wb.isosocket_config_Blockbook(prev) }
    })
    await step('limiter: socket close fails queued + in-flight requests at once; queue never sends on a replaced socket', async () => {
        const x = 'MOCK_CLOSE', sock = mockSocket(x), got = []
        const cap = wb.isosocket_config_Blockbook().heavyMaxInFlight
        for (let i = 0; i < cap + 5; i++) wb.isosocket_send_Blockbook(x, 'getTransactionSpecific', { i }, d => got.push(d))
        wb.isosocket_send_Blockbook(x, 'getAccountUtxo', {}, d => got.push(d))
        sock.readyState = 3; self.bb_Sockets[x] = undefined
        const n = wb._test.failSocket(sock, 'Blockbook socket closed')
        assert.strictEqual(n, cap + 5 + 1)
        assert.strictEqual(got.length, cap + 6); assert.ok(got.every(d => d.error === 'Blockbook socket closed'))
        assert.strictEqual(sock.sent.length, cap + 1, 'nothing more sent after close')
        assert.strictEqual(sock.bb_heavy.inFlight, 0)
    })
    await step('reconnect: a stale timeout of the old socket never hits the new socket\'s request with the same id', async () => {
        const prev = wb.isosocket_config_Blockbook()
        wb.isosocket_config_Blockbook({ heavyTimeoutMs: 150 })
        try {
            const x = 'MOCK_RECONNECT', got = []
            mockSocket(x)
            wb.isosocket_send_Blockbook(x, 'getTransaction', { old: 1 }, d => got.push(['old', d])) // id 0 on the old socket, never answered
            const sock2 = mockSocket(x)                                                           // reconnect: new pending map, ids restart at 0
            wb.isosocket_send_Blockbook(x, 'getTransaction', { new: 1 }, d => got.push(['new', d]))
            assert.strictEqual(sock2.sent[0].id, '0')
            await sleep(100); reply(sock2, '0', { fresh: true })
            await sleep(150)
            assert.deepStrictEqual(got.find(g => g[0] === 'new'), ['new', { fresh: true }])
            assert.deepStrictEqual(got.find(g => g[0] === 'old'), ['old', { error: 'Blockbook request timeout' }])
            assert.strictEqual(got.length, 2)
        } finally { wb.isosocket_config_Blockbook(prev) }
    })

    // ---------------- ZEC block info ----------------
    await step('getSyncInfo ZEC (getBlock "Not supported"): SET_ASSET_BLOCK_INFO dispatched; getBlock asked once; no MTP', async () => {
        assert.ok(!configWallet.getMetaBySymbol('ZEC').OP_CLTV, 'ZEC has no OP_CLTV (no median-time-past path)')
        const sock = mockSocket('ZEC', (m) => m === 'getInfo' ? { bestHeight: 3539335 } : m === 'getBlock' ? { error: { message: 'Not supported' } } : { error: { message: 'unexpected ' + m } })
        const runOnce = async (blockNo, blockTimeMs) => {
            posted.length = 0
            wb.getSyncInfo_Blockbook_v3('ZEC', blockNo, blockTimeMs)
            for (let i = 0; i < 100 && !posted.length; i++) await sleep(20)
            const acts = [].concat.apply([], posted.filter(p => p.msg === 'REQUEST_DISPATCH_BATCH').map(p => p.data.dispatchActions))
            return acts.filter(a => a.type === 'SET_ASSET_BLOCK_INFO')
        }
        const t0 = Math.floor(Date.now() / 1000)
        const a1 = await runOnce()
        assert.strictEqual(a1.length, 1); assert.strictEqual(a1[0].payload.symbol, 'ZEC'); assert.strictEqual(a1[0].payload.receivedBlockNo, 3539335)
        assert.ok(Math.abs(a1[0].payload.receivedBlockTime - t0) < 5, 'estimated block time = now (unix seconds)')
        assert.strictEqual(a1[0].payload.blockTimeIsEstimate, true); assert.strictEqual(a1[0].payload.medianTimePast, undefined)
        const a2 = await runOnce(3539336, 1790000000123)                    // new-block path passes ms
        assert.strictEqual(a2[0].payload.receivedBlockNo, 3539336); assert.strictEqual(a2[0].payload.receivedBlockTime, 1790000000)
        assert.strictEqual(sock.sent.filter(r => r.method === 'getBlock').length, 1, 'getBlock not re-asked once known unsupported')
        self.bb_getBlockUnsupported = {}
    })

    // ---------------- ETH contract creation ----------------
    await step('ETH mapTx_web3: contract creation (to == null) is mapped, not dropped', () => {
        const f = fixture('eth-contract-creation')
        const fm = require(`${REPO}/node_modules/web3-core-helpers`).formatters
        const fromWei = require(`${REPO}/node_modules/web3-utils`).fromWei
        const txData = fm.outputTransactionFormatter(JSON.parse(JSON.stringify(f.tx)))
        const receipt = fm.outputTransactionReceiptFormatter(JSON.parse(JSON.stringify(f.receipt)))
        const block = fm.outputBlockFormatter(JSON.parse(JSON.stringify(f.block)))
        assert.strictEqual(txData.to, null, 'web3-formatted contract creation has to == null')
        const asset = configWallet.walletsMeta['ethereum'], wallet = { assets: [] }, creator = txData.from
        // we created the contract: outgoing "to" the created contract
        const m1 = workerAccount.mapTx_web3(wallet, asset, { txid: f.txid }, txData, receipt, block, [creator.toLowerCase()], creator.toLowerCase(), fromWei)
        assert.strictEqual(m1.isIncoming, false); assert.strictEqual(m1.isContractCreation, true); assert.strictEqual(m1.erc20, undefined)
        assert.strictEqual(m1.account_to, f.receipt.contractAddress.toLowerCase()); assert.strictEqual(m1.toOrFrom.toLowerCase(), f.receipt.contractAddress.toLowerCase())
        assert.strictEqual(m1.value, 0); assert.strictEqual(m1.block_no, parseInt(f.tx.blockNumber, 16)); assert.strictEqual(m1.txFailedReverted, false)
        assert.strictEqual(m1.date.getTime(), parseInt(f.block.timestamp, 16) * 1000); assert.ok(m1.fees > 0)
        // seen from an address that isn't the creator (it was in 0xBE0e...'s history): mapped, attributed to the polled address
        const poll = '0xbe0eb53f46cd790cd13851d5eff43d12404d33e8'
        const m2 = workerAccount.mapTx_web3(wallet, asset, { txid: f.txid }, txData, receipt, block, [poll], poll, fromWei)
        assert.strictEqual(m2.isIncoming, true); assert.strictEqual(m2.account_to, poll); assert.strictEqual(m2.isNonErc20_ContractParam, true); assert.strictEqual(m2.fees, 0)
        // no receipt (pending; contractAddress unknown): no throw, not mapped (re-enriched once mined; never account_to null)
        const m3 = workerAccount.mapTx_web3(wallet, asset, { txid: f.txid }, txData, null, block, [creator.toLowerCase()], creator.toLowerCase(), fromWei)
        assert.strictEqual(m3, undefined)
    })
}

// ---------------- LIVE (read-only) ----------------
const UA = { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 20000 }
const mempool = async p => (await axios.get(`https://mempool.space/api/${p}`, UA)).data
const bbCall = (x, method, params) => new Promise(res => wb.isosocket_send_Blockbook(x, method, params, res))

async function live() {
    // drop the mocks; open the real sockets the wallet would (loaderWorker: no UI callbacks / subscriptions)
    for (const k of Object.keys(self.bb_Sockets)) delete self.bb_Sockets[k]
    self.bb_getBlockUnsupported = {}
    const syms = ['BTC', 'BTC_SEG', 'ZEC']
    wb.isosocket_Setup_Blockbook(() => {}, () => {}, true, syms)
    const t0 = Date.now()
    while (!syms.every(s => self.bb_Sockets[s] && self.bb_Sockets[s].readyState === 1)) {
        if (Date.now() - t0 > 45000) throw new Error('Blockbook sockets not open: ' + syms.filter(s => !(self.bb_Sockets[s] && self.bb_Sockets[s].readyState === 1)))
        await sleep(100)
    }

    await step('LIVE btc1 legacy P2PKH 1EvanBTC...: wallet UTXOs == mempool.space /utxo (no OP_RETURN utxo)', async () => {
        const addr = '1EvanBTCS99Vfgknz9vt8XauYsMgiVPfb6'
        const [oracle, { res }] = await Promise.all([mempool(`address/${addr}/utxo`), withTimeout(fetchFull(watchAsset('bitcoin', [addr]), addr), 90000, 'getAddressFull')])
        assert.ok(oracle.length > 0)
        assert.deepStrictEqual(res.utxos.map(utxoKey).sort(), oracle.map(utxoKey).sort())
        assert.ok(res.utxos.every(u => u.scriptPubKey.type === 'pubkeyhash'))
        return `${res.utxos.length} utxos, balance ${res.balance}`
    })
    await step('LIVE btc2 heavy P2SH 38Umu...: UTXO count == mempool.space, every tx enriched, no request timeout, socket open, cap engaged', async () => {
        const addr = '38UmuUqPCrFmQo4khkomQwZ4VbY2nZMJ67', x = 'BTC_SEG'
        const errBefore = errLog.length
        const [oracle, { res, acts }] = await Promise.all([mempool(`address/${addr}/utxo`), withTimeout(fetchFull(watchAsset('btc(s)', [addr]), addr), 180000, 'getAddressFull')])
        const errs = errLog.slice(errBefore)
        const timeouts = errs.filter(e => /timeout after/.test(e)), closed = errs.filter(e => /socket closed|not ready|NO SOCKET/i.test(e))
        assert.strictEqual(timeouts.length, 0, `request timeouts: ${timeouts.slice(0, 3).join(' / ')}`)
        assert.strictEqual(closed.length, 0, closed.slice(0, 3).join(' / '))
        assert.ok(self.bb_Sockets[x] && self.bb_Sockets[x].readyState === 1, 'socket still open')
        assert.deepStrictEqual(res.utxos.map(utxoKey).sort(), oracle.map(utxoKey).sort(), 'utxos == mempool.space')
        const enriched = [].concat.apply([], acts.filter(p => p.type === 'WCORE_SET_ENRICHED_TXS').map(p => p.payload.txs))
        assert.strictEqual(enriched.length, res.txs.length, `all ${res.txs.length} txs enriched`)
        const h = self.bb_Sockets[x].bb_heavy, cap = wb.isosocket_config_Blockbook().heavyMaxInFlight
        assert.ok(h.maxInFlight <= cap && h.maxQueued > 0, `cap engaged: maxInFlight ${h.maxInFlight}, maxQueued ${h.maxQueued}`)
        return `${res.utxos.length} utxos (oracle ${oracle.length}), ${enriched.length} txs enriched, maxInFlight ${h.maxInFlight}, maxQueued ${h.maxQueued}`
    })
    await step('LIVE zec1 t1cf9...: wallet UTXOs == getAccountUtxo, balance > 0', async () => {
        const addr = 't1cf9PNYWAaF5u54nuQV9ki3G6LwE3dB4bi'
        const { res } = await withTimeout(fetchFull(watchAsset('zcash', [addr]), addr), 120000, 'getAddressFull')
        const oracle = await bbCall('ZEC', 'getAccountUtxo', { descriptor: addr })
        assert.ok(Array.isArray(oracle) && oracle.length > 0)
        assert.deepStrictEqual(res.utxos.map(utxoKey).sort(), oracle.map(utxoKey).sort())
        assert.ok(new BigNumber(res.balance).gt(0))
        return `${res.utxos.length} utxos, balance ${res.balance}, ${res.txs.length} txs`
    })
    await step('LIVE zec1 mining address t1MKn34K... (coinbase history): resolves, every tx enriched (used to hang)', async () => {
        const addr = 't1MKn34KBa8Xh4g8qU8psibBXvURafphVn7', errBefore = errLog.length
        const { res, acts } = await withTimeout(fetchFull(watchAsset('zcash', [addr]), addr), 180000, 'getAddressFull')
        const enriched = [].concat.apply([], acts.filter(p => p.type === 'WCORE_SET_ENRICHED_TXS').map(p => p.payload.txs))
        assert.ok(res.txs.length > 0); assert.strictEqual(enriched.length, res.txs.length)
        const coinbases = enriched.filter(t => t.isIncoming && t.utxo_vin.length === 0 && !t.isFromShieldedAddr).length
        assert.ok(coinbases > 0, 'coinbase txs in history')
        assert.strictEqual(errLog.slice(errBefore).filter(e => /timeout after/.test(e)).length, 0, 'no request timeouts')
        return `${enriched.length} txs enriched (${coinbases} coinbase-like), ${res.utxos.length} utxos`
    })
    await step('LIVE zec1 getSyncInfo: block info dispatched although getBlock is "Not supported"', async () => {
        posted.length = 0
        wb.getSyncInfo_Blockbook_v3('ZEC')
        for (let i = 0; i < 300 && !posted.length; i++) await sleep(50)
        const info = await bbCall('ZEC', 'getInfo', {})
        const acts = [].concat.apply([], posted.filter(p => p.msg === 'REQUEST_DISPATCH_BATCH').map(p => p.data.dispatchActions)).filter(a => a.type === 'SET_ASSET_BLOCK_INFO')
        assert.strictEqual(acts.length, 1)
        assert.ok(Math.abs(acts[0].payload.receivedBlockNo - info.bestHeight) <= 2, `height ${acts[0].payload.receivedBlockNo} ~ ${info.bestHeight}`)
        assert.strictEqual(self.bb_getBlockUnsupported.ZEC, true, 'getBlock unsupported detected live')
        return `height ${acts[0].payload.receivedBlockNo}, estimated time ${acts[0].payload.blockTimeIsEstimate}`
    })
}

;(async () => {
    let rc = 0
    try {
        await offline()
        if (LIVE) await live()
    } catch (e) { results.push(['✖', 'setup', 0, e.message]); rc = 1 }
    console.log('\nLEAN utxo-mapping results' + (LIVE ? '' : ' (offline only)'))
    for (const [s, n, ms, note] of results) console.log(`  ${s} ${n} (${ms}ms)${note ? ' - ' + note : ''}`)
    if (results.some(r => r[0] === '✖')) rc = 1
    const pass = results.filter(r => r[0] === '✔').length
    console.log(`  ${pass}/${results.length} passed`)
    for (const k of Object.keys(self.bb_Sockets)) try { self.bb_Sockets[k] && self.bb_Sockets[k].close && self.bb_Sockets[k].close() } catch (e) {}
    process.exit(rc) // the 'exit' handler deletes TMP (wallet logs)
})()
