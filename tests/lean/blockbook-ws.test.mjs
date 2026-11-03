// Lean tests for app-worker/worker-blockbook-ws.js (the Blockbook websocket adapter that replaces socket.io).
//   L1: unit tests with a mock transport (milliseconds)
//   L2: live contract tests: our BTC testnet4 Blockbook 0.5.0 (differential vs legacy socket.io),
//       Trezor Sepolia Blockbook 0.6.0, and Trezor MAINNET Blockbooks (read-only): BTC, ETH, ZEC (zec1, vs Zelcore),
//       BTC legacy P2PKH output shape (btc1, Core 29, vs mempool.space)
//   (the wallet-side request limiter / UTXO filter / tx mapping are tested in utxo-mapping.node14.js)
// Run: node --test tests/lean/   (Node >= 20). Live tests need network; nothing is broadcast.
import { test as baseTest, describe } from 'node:test'
const test = (name, fn) => baseTest(name, { timeout: 60000 }, fn)   // nothing may hang
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const require = createRequire(import.meta.url)
const bbWs = require(`${REPO}/app-worker/worker-blockbook-ws.js`)
const WS = require(`${REPO}/node_modules/ws`)
const io = require(`${REPO}/node_modules/socket.io-client`)
const UA = { 'User-Agent': 'Mozilla/5.0' }

// ---------------- L1: mock transport ----------------
function mockSend(handlers) {
    const calls = []
    const send = (method, params, cb) => { calls.push({ method, params }); setImmediate(() => cb(handlers[method](params))) }
    return { send, calls }
}

describe('L1 adapter (mock transport)', () => {
    test('getAddressTxids: single page', async () => {
        const { send, calls } = mockSend({ getAccountInfo: () => ({ txids: ['a', 'b'], totalPages: 1 }) })
        assert.deepEqual(await bbWs.getAddressTxids(send, 'addr1', 100), ['a', 'b'])
        assert.deepEqual(calls[0], { method: 'getAccountInfo', params: { descriptor: 'addr1', details: 'txids', page: 1, pageSize: 100 } })
    })
    test('getAddressTxids: walks pages, preserves order, honours cap', async () => {
        const pages = { 1: ['a', 'b'], 2: ['c', 'd'], 3: ['e'] }
        const { send, calls } = mockSend({ getAccountInfo: p => ({ txids: pages[p.page], totalPages: 3 }) })
        assert.deepEqual(await bbWs.getAddressTxids(send, 'x', 3000), ['a', 'b', 'c', 'd', 'e'])
        assert.equal(calls.length, 3)
        const capped = mockSend({ getAccountInfo: p => ({ txids: pages[p.page], totalPages: 3 }) })
        assert.deepEqual(await bbWs.getAddressTxids(capped.send, 'x', 3), ['a', 'b', 'c'])
        assert.equal(capped.calls[0].params.pageSize, 3)
    })
    test('getAddressTxids: pageSize never exceeds Blockbook max (1000)', async () => {
        const { send, calls } = mockSend({ getAccountInfo: () => ({ txids: [], totalPages: 1 }) })
        await bbWs.getAddressTxids(send, 'x', 5000)
        assert.equal(calls[0].params.pageSize, 1000)
    })
    test('getAddressTxids: empty account -> []', async () => {
        const { send } = mockSend({ getAccountInfo: () => ({ txs: 0, totalPages: 0 }) })
        assert.deepEqual(await bbWs.getAddressTxids(send, 'x', 100), [])
    })
    test('errors: transport string error, API error object, no response -> rejected with message', async () => {
        for (const [resp, msg] of [[{ error: 'Blockbook socket not ready (readyState=0)' }, /socket not ready/], [{ error: { message: 'Invalid address' } }, /Invalid address/], [undefined, /No response/]]) {
            const { send } = mockSend({ getAccountInfo: () => resp, sendTransaction: () => resp })
            await assert.rejects(bbWs.getAddressTxids(send, 'x', 10), msg)
            await assert.rejects(bbWs.sendTransaction(send, 'beef'), msg)
        }
    })
    test('getMempoolTxids: takes the unconfirmedTxs head of each address, de-duplicates', async () => {
        const acct = { a1: { txids: ['m1', 'm2', 'c1'], unconfirmedTxs: 2 }, a2: { txids: ['m2', 'm3', 'c2'], unconfirmedTxs: 2 }, a3: { txids: ['c3'], unconfirmedTxs: 0 } }
        const { send } = mockSend({ getAccountInfo: p => acct[p.descriptor] })
        assert.deepEqual(await bbWs.getMempoolTxids(send, ['a1', 'a2', 'a3']), ['m1', 'm2', 'm3'])
    })
    test('sendTransaction: params shape and txid', async () => {
        const { send, calls } = mockSend({ sendTransaction: () => ({ result: 'txid123' }) })
        assert.equal(await bbWs.sendTransaction(send, 'deadbeef'), 'txid123')
        assert.deepEqual(calls[0], { method: 'sendTransaction', params: { hex: 'deadbeef' } })
    })
    test('subscribeAddresses: ignores ack/error frames, delivers txid + address', () => {
        let cb, got = []
        const id = bbWs.subscribeAddresses((m, p, c) => { assert.equal(m, 'subscribeAddresses'); assert.deepEqual(p, { addresses: ['a'] }); cb = c; return '7' }, ['a'], (t, a) => got.push([t, a]))
        assert.equal(id, '7')
        cb({ subscribed: true }); cb({ error: { message: 'x' } }); cb(undefined); cb({ address: 'a', tx: { txid: 'T1' } })
        assert.deepEqual(got, [['T1', 'a']])
    })
    test('getMedianTimePast: median of the last 11 block times (tip inclusive), unsorted input', async () => {
        const times = { 100: 1100, 99: 990, 98: 1300, 97: 970, 96: 960, 95: 1500, 94: 940, 93: 930, 92: 920, 91: 910, 90: 900, 89: 1 }
        const { send, calls } = mockSend({ getInfo: () => ({ bestHeight: 100 }), getBlock: p => ({ height: Number(p.id), time: times[p.id] }) })
        assert.deepEqual(await bbWs.getMedianTimePast(send), { mtp: 960, height: 100 })   // sorted: 900 910 920 930 940 [960] 970 990 1100 1300 1500
        const blocks = calls.filter(c => c.method === 'getBlock').map(c => Number(c.params.id)).sort((a, b) => a - b)
        assert.deepEqual(blocks, [90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100])
        assert.ok(calls.filter(c => c.method === 'getBlock').every(c => c.params.pageSize === 1), 'header-only fetch (pageSize 1)')
    })
    test('getMedianTimePast: missing block time / no tip -> rejected', async () => {
        await assert.rejects(bbWs.getMedianTimePast(mockSend({ getInfo: () => ({}) }).send), /bestHeight/)
        await assert.rejects(bbWs.getMedianTimePast(mockSend({ getInfo: () => ({ bestHeight: 50 }), getBlock: () => ({}) }).send), /block time/)
        await assert.rejects(bbWs.getMedianTimePast(mockSend({ getInfo: () => ({ error: { message: 'down' } }) }).send), /down/)
    })
})

// ---------------- L2: live contract tests ----------------
function liveSend(host) {      // callback-style transport over Blockbook's websocket API (like the wallet's isosockets)
    const ws = new WS(`wss://${host}/websocket`, { headers: { ...UA, Origin: `https://${host.split(':')[0]}` } })
    let id = 0; const pend = {}
    const ready = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })
    ws.on('message', m => { const j = JSON.parse(m); if (pend[j.id]) { pend[j.id](j.data); delete pend[j.id] } })
    return { send: (method, params, cb) => ready.then(() => { const i = String(id++); pend[i] = cb; ws.send(JSON.stringify({ id: i, method, params })) }), close: () => ws.close() }
}
function legacyTxids(host, addrs, mempoolOnly) {
    return new Promise((res, rej) => {
        const s = io(`https://${host}`, { transports: ['websocket'], reconnection: false, timeout: 10000,
            transportOptions: { websocket: { extraHeaders: { ...UA, Origin: `https://${host.split(':')[0]}` } } } })
        let done = false
        const finish = (fn, v) => { if (done) return; done = true; s.removeAllListeners(); s.close(); fn(v) }
        const fail = e => finish(rej, e instanceof Error ? e : new Error(String(e)))
        s.on('connect_error', fail); s.on('connect_timeout', fail); s.on('error', fail)
        s.on('connect', () => s.send({ method: 'getAddressTxids', params: [addrs, { start: 99999999, end: 0, queryMempoolOnly: !!mempoolOnly }] }, d => finish(res, d.result || [])))
    })
}
const rest = async (host, p) => (await fetch(`https://${host}/api/v2/${p}`, { headers: UA })).json()

// testnets4@d0m1.com public addresses (no secrets)
const A = { BTC_TEST: ['2N8YjBPwpXQCLbeJznJj9c9dhLqBSAm52LW', '2NAGfow5ithu8jeLGBt3U2LfemVyCEYQsTR'], BTC_TEST2: ['tb1q9s8qvvrvafadl7wxj2axp3l5tg7nensjr27e8r'],
            ETH_TEST: '0xff8ac13981c99f3d4178328d496ec9ed02357604' }
const SEPOLIA_FUNDING_TX = '0x6ae7b6e4cc7b'   // Google Cloud faucet drip 2026-11-02 (prefix)

describe('L2 live: BTC testnet4 (our Blockbook 0.5.0) - new adapter == legacy socket.io', () => {
    const BB = 'x-btc-testnet.d0m1.com:10009'
    test('history: getAddressTxids == legacy getAddressTxids for every testnets4 BTC address', async () => {
        const t = liveSend(BB)
        try {
            for (const a of [...A.BTC_TEST, ...A.BTC_TEST2]) {
                // legacy getAddressTxids(queryMempoolOnly:false) = confirmed only; websocket getAccountInfo = unconfirmed first, then confirmed
                const [nu, old, oldMem] = await Promise.all([bbWs.getAddressTxids(t.send, a, 1000), legacyTxids(BB, [a]), legacyTxids(BB, [a], true)])
                assert.ok(nu.length > 0, `${a} has history`)
                const k = nu.length - old.length
                assert.deepEqual([...nu.slice(0, k)].sort(), [...oldMem].sort(), `${a}: unconfirmed head == legacy mempool`)
                assert.deepEqual(nu.slice(k), old, `${a}: confirmed tail == legacy (same order)`)
            }
        } finally { t.close() }
    })
    test('mempool: getMempoolTxids == legacy getAddressTxids(queryMempoolOnly) (as sets)', async () => {
        const t = liveSend(BB), addrs = [...A.BTC_TEST, ...A.BTC_TEST2]
        try {
            const [nu, old] = await Promise.all([bbWs.getMempoolTxids(t.send, addrs), legacyTxids(BB, addrs, true)])
            assert.deepEqual([...nu].sort(), [...old].sort())
        } finally { t.close() }
    })
    test('getMedianTimePast == bitcoind-style median of the last 11 REST block times', async () => {
        const t = liveSend(BB)
        try {
            const r = await bbWs.getMedianTimePast(t.send)
            const times = []
            for (let h = r.height; h > r.height - 11; h--) times.push((await rest(BB, `block/${h}`)).time)
            assert.equal(r.mtp, times.sort((a, b) => a - b)[5])
        } finally { t.close() }
    })
    test('sendTransaction: invalid hex is rejected with a node error (nothing broadcast)', async () => {
        const t = liveSend(BB)
        try { await assert.rejects(bbWs.sendTransaction(t.send, '00'), e => /decode|TX|failed|invalid/i.test(e.message)) } finally { t.close() }
    })
})

describe('L2 live: ETH Sepolia (Trezor public Blockbook 0.6.0)', () => {
    const BB = 'sepolia.trezor.io'
    test('history: testnets4 ETH_TEST address includes the faucet funding tx and matches REST', async () => {
        const t = liveSend(BB)
        try {
            const nu = await bbWs.getAddressTxids(t.send, A.ETH_TEST, 1000)
            assert.ok(nu.some(x => x.startsWith(SEPOLIA_FUNDING_TX)), 'faucet funding tx present')
            const r = await rest(BB, `address/${A.ETH_TEST}?details=txids&pageSize=1000`)
            assert.deepEqual(nu, r.txids || [])
        } finally { t.close() }
    })
    test('mempool: getMempoolTxids returns an array (normally empty) without error', async () => {
        const t = liveSend(BB)
        try { assert.ok(Array.isArray(await bbWs.getMempoolTxids(t.send, [A.ETH_TEST]))) } finally { t.close() }
    })
    test('legacy socket.io is NOT served (why the port is needed)', async () => {
        // a server that serves Socket.IO upgrades /socket.io/?transport=websocket (101); Blockbook 0.6 answers plain HTTP
        const status = await new Promise(res => {
            const w = new WS(`wss://${BB}/socket.io/?EIO=3&transport=websocket`, { headers: { ...UA, Origin: `https://${BB}` }, handshakeTimeout: 10000 })
            w.on('open', () => { w.terminate(); res(101) })
            w.on('unexpected-response', (req, r) => { req.destroy(); res(r.statusCode) })
            w.on('error', () => res('error'))
        })
        assert.notEqual(status, 101, 'socket.io unexpectedly served')
    })
})

describe('L2 live: MAINNET read-only (Trezor public Blockbooks 0.6.0)', () => {
    // well-known, long-lived public addresses - read-only lookups, nothing sent
    test('BTC mainnet: getAddressTxids pages and matches REST (btc1.trezor.io)', async () => {
        const BB = 'btc1.trezor.io', addr = 'bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h' // public address with modest history
        const t = liveSend(BB)
        try {
            const nu = await bbWs.getAddressTxids(t.send, addr, 50)
            const r = await rest(BB, `address/${addr}?details=txids&pageSize=50`)
            assert.deepEqual(nu, (r.txids || []).slice(0, 50))
        } finally { t.close() }
    })
    test('ETH mainnet: getAddressTxids works and matches REST (eth.trezor.io)', async () => {
        const BB = 'eth.trezor.io', addr = '0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe' // Ethereum Foundation (public)
        const t = liveSend(BB)
        try {
            const nu = await bbWs.getAddressTxids(t.send, addr, 25)
            assert.equal(nu.length, 25)
            const r = await rest(BB, `address/${addr}?details=txids&pageSize=25`)
            assert.deepEqual(nu, (r.txids || []).slice(0, 25))
        } finally { t.close() }
    })
})

// promise form of liveSend (resolves the raw reply data, including { error } frames)
const call = (t, method, params = {}) => new Promise(res => t.send(method, params, res))
const utxoKey = u => `${u.txid}:${u.vout}:${u.value}`

describe('L2 live: ZEC MAINNET read-only (Trezor zec1 Blockbook 0.6 on Zebra; oracle: Zelcore Blockbook)', () => {
    // the wallet's ZEC asset uses wss://zec1.trezor.io; contract the wallet code (worker-blockbook.js) relies on
    const BB = 'zec1.trezor.io', ORACLE = 'blockbook.zec.zelcore.io'
    const ADDR = 't1cf9PNYWAaF5u54nuQV9ki3G6LwE3dB4bi'  // public donate address: 251 txs, non-zero balance (can move: compared vs oracle, not pinned)
    test('getInfo: ZEC mainnet, Blockbook 0.6.x, tip agrees with the oracle', async () => {
        const t = liveSend(BB), o = liveSend(ORACLE)
        try {
            const [a, b] = await Promise.all([call(t, 'getInfo'), call(o, 'getInfo')])
            assert.equal(a.shortcut, 'ZEC'); assert.equal(a.testnet, false); assert.match(a.version, /^0\.6\./)
            assert.ok(Math.abs(a.bestHeight - b.bestHeight) <= 3, `tips ${a.bestHeight} vs ${b.bestHeight}`)
        } finally { t.close(); o.close() }
    })
    test(`getAccountInfo ${ADDR}: non-zero, same balance/totals/txids as the oracle, address echoed`, async () => {
        const t = liveSend(BB), o = liveSend(ORACLE)
        try {
            const p = { descriptor: ADDR, details: 'txids', page: 1, pageSize: 50 }
            const [a, b] = await Promise.all([call(t, 'getAccountInfo', p), call(o, 'getAccountInfo', p)])
            assert.equal(a.address, ADDR, 'a mainnet Blockbook silently maps other address forms: check the echo')
            assert.ok(BigInt(a.balance) > 0n && a.txs > 0, `balance ${a.balance}, txs ${a.txs}`)
            for (const k of ['balance', 'totalReceived', 'totalSent', 'txs']) assert.equal(a[k], b[k], k)
            assert.deepEqual(a.txids, b.txids)
        } finally { t.close(); o.close() }
    })
    test('getAccountUtxo == oracle, sums to the balance; getTransactionSpecific gives the addresses[] (pubkeyhash) form', async () => {
        const t = liveSend(BB), o = liveSend(ORACLE)
        try {
            const [a, b, info] = await Promise.all([call(t, 'getAccountUtxo', { descriptor: ADDR }), call(o, 'getAccountUtxo', { descriptor: ADDR }), call(t, 'getAccountInfo', { descriptor: ADDR, details: 'basic' })])
            assert.ok(Array.isArray(a) && a.length > 0)
            assert.deepEqual(a.map(utxoKey).sort(), b.map(utxoKey).sort())
            if (info.unconfirmedBalance === '0') assert.equal(a.reduce((s, u) => s + BigInt(u.value), 0n), BigInt(info.balance))
            const spec = await call(t, 'getTransactionSpecific', { txid: a[0].txid })
            const vo = spec.vout.find(v => v.n === a[0].vout)
            assert.equal(vo.scriptPubKey.type, 'pubkeyhash'); assert.deepEqual(vo.scriptPubKey.addresses, [ADDR])
        } finally { t.close(); o.close() }
    })
    test('getBlock is "Not supported" (pinned: the wallet falls back to getInfo height + local time for ZEC block info)', async () => {
        const t = liveSend(BB)
        try {
            const info = await call(t, 'getInfo')
            const r = await call(t, 'getBlock', { id: String(info.bestHeight - 1), page: 1, pageSize: 1 })
            assert.deepEqual(r, { error: { message: 'Not supported' } }, 'if zec1 now serves getBlock, the wallet can use real ZEC block times again')
        } finally { t.close() }
    })
})

describe('L2 live: BTC legacy MAINNET read-only (Trezor btc1, Bitcoin Core 29; oracle: mempool.space)', () => {
    const BB = 'btc1.trezor.io', ADDR = '1EvanBTCS99Vfgknz9vt8XauYsMgiVPfb6'  // dormant public P2PKH address, 2 UTXOs (block 695785, 800000)
    const OPRET_TX = 'a9c882c1dd3cb0fdec71f3c479479ebf4003cd35b60d744f385cea81bda5ca49'
    test('getTransactionSpecific: P2PKH output is { type: pubkeyhash, address } (singular, no addresses[]); OP_RETURN is nulldata', async () => {
        const t = liveSend(BB)
        try {
            const spec = await call(t, 'getTransactionSpecific', { txid: OPRET_TX })
            const p2pkh = spec.vout.find(v => v.n === 2).scriptPubKey
            assert.equal(p2pkh.type, 'pubkeyhash'); assert.equal(p2pkh.address, ADDR); assert.equal(p2pkh.addresses, undefined)
            const opret = spec.vout.find(v => v.n === 0).scriptPubKey
            assert.equal(opret.type, 'nulldata'); assert.equal(opret.address, undefined)
        } finally { t.close() }
    })
    test(`getAccountUtxo ${ADDR} == mempool.space /utxo`, async () => {
        const t = liveSend(BB)
        try {
            const [a, m] = await Promise.all([call(t, 'getAccountUtxo', { descriptor: ADDR }), fetch(`https://mempool.space/api/address/${ADDR}/utxo`, { headers: UA }).then(r => r.json())])
            assert.ok(a.length > 0)
            assert.deepEqual(a.map(utxoKey).sort(), m.map(utxoKey).sort())
        } finally { t.close() }
    })
    test('getBlock (pageSize 1) serves block time + txCount on btc1 (the path ZEC lacks)', async () => {
        const t = liveSend(BB)
        try {
            const r = await call(t, 'getBlock', { id: '800000', page: 1, pageSize: 1 })
            assert.equal(r.height, 800000); assert.equal(r.time, 1690168629); assert.equal(r.txCount, 3721)
        } finally { t.close() }
    })
})
