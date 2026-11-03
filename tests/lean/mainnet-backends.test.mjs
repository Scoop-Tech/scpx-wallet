// Lean MAINNET backend checks - strictly READ-ONLY (no keys, no MPK, nothing signed or broadcast).
// Every mainnet backend the wallet uses must be up, on Blockbook 0.6.x, at the chain tip (vs an independent
// oracle) and must return REAL non-zero data for a funded public address that matches an independent oracle
// read at the same moment (expected values are never hard-coded).
//
//   Blockbook websockets (config/websockets.js blockbook_ws_config):  btc1 (BTC p2pkh), btc2 (BTC_SEG p2sh),
//       btc3 (BTC_SEG2 p2wpkh), eth (ETH + ERC20 history), zec1 (ZEC)
//   publicnode (config/wallet-external.js httpProvider, websockets.js geth_ws_config): ETH balance / gas / ERC20 balanceOf
//   Oracles: mempool.space (BTC), publicnode eth_call (ETH/ERC20 vs Blockbook), Blockchair + Zelcore Blockbook (ZEC)
//
// Run: node --test tests/lean/mainnet-backends.test.mjs   (Node >= 20)
import { test as baseTest, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const O = require('./lib/oracles.js')
const P = require('./lib/pinned.js')
const bbAdapter = require(`${REPO}/app-worker/worker-blockbook-ws.js`) // the wallet's own Blockbook websocket adapter
const wsConfig = require(`${REPO}/config/websockets.js`)

const test = (name, fn) => baseTest(name, { timeout: 3 * 60000 }, fn)
const TIP_TOLERANCE = { BTC: 2, ETH: 10, ZEC: 3 } // blocks: Blockbook may index a block later than the oracle saw it

// one oracle-side Blockbook client per host, closed at the end
const clients = {}
const bb = host => (clients[host] = clients[host] || O.blockbook(host))
after(() => Object.values(clients).forEach(c => c.close()))

const hostOf = sym => new URL(wsConfig.blockbook_ws_config[sym].url).hostname

// compare a Blockbook reading with an independent tip; retry (new blocks) a few times before failing
async function assertAtTip(t, host, chain, oracleTip) {
    let last
    for (let i = 0; i < 4; i++) {
        const [info, tip] = await Promise.all([bb(host).info(), oracleTip()])
        last = { bb: info.bestHeight, oracle: tip }
        if (Math.abs(info.bestHeight - tip) <= TIP_TOLERANCE[chain]) { t.diagnostic(`${host} bestHeight ${info.bestHeight}, oracle ${tip}`); return info }
        await O.sleep(5000)
    }
    assert.fail(`${host} not at tip: ${JSON.stringify(last)} (tolerance ${TIP_TOLERANCE[chain]})`)
}

describe('MAINNET backends: up, Blockbook 0.6.x, at tip', () => {
    test('wallet config still points at the backends this test covers', () => {
        assert.equal(hostOf('BTC'), 'btc1.trezor.io')
        assert.equal(hostOf('BTC_SEG'), 'btc2.trezor.io')
        assert.equal(hostOf('BTC_SEG2'), 'btc3.trezor.io')
        assert.equal(hostOf('ETH'), 'eth.trezor.io')
        assert.equal(hostOf('ZEC'), 'zec1.trezor.io')
        assert.equal(wsConfig.geth_ws_config.ETH.url, O.PUBLICNODE_WS)
    })
    for (const [sym, chain, name] of [['BTC', 'BTC', 'Bitcoin'], ['BTC_SEG', 'BTC', 'Bitcoin'], ['BTC_SEG2', 'BTC', 'Bitcoin'], ['ETH', 'ETH', 'Ethereum'], ['ZEC', 'ZEC', 'Zcash']]) {
        test(`${sym} ${hostOf(sym)}: getInfo, Blockbook 0.6.x, mainnet, bestHeight at tip`, async t => {
            const host = hostOf(sym)
            const oracleTip = chain === 'BTC' ? O.mempool.tipHeight : chain === 'ETH' ? O.eth.blockNumber : O.blockchair.zecTipHeight
            const info = await assertAtTip(t, host, chain, oracleTip)
            assert.match(info.version, /^0\.6\./, `${host} version ${info.version}`)
            assert.equal(info.testnet, false, `${host} must be mainnet`)
            assert.ok(info.name.startsWith(name), `${host} name ${info.name}`)
            t.diagnostic(`${host}: ${info.name} v${info.version}, backend ${info.backend && (info.backend.subversion || info.backend.version)}`)
            // (the websocket getInfo has no inSync flag - REST /api has it but is Cloudflare-403 / 503-prone: the tip check is the sync check)
        })
    }
    test('publicnode https (wallet httpProvider): chainId 1, at tip vs eth.trezor.io', async t => {
        assert.equal(await O.eth.chainId(), 1)
        await assertAtTip(t, 'eth.trezor.io', 'ETH', O.eth.blockNumber)
    })
    test('publicnode wss (wallet geth_ws_config ETH): eth_blockNumber agrees with https', async t => {
        const [w, h] = await Promise.all([O.eth.wsRpc('eth_blockNumber'), O.eth.blockNumber()])
        assert.ok(Math.abs(Number(BigInt(w)) - h) <= 3, `ws ${Number(BigInt(w))} vs https ${h}`)
        t.diagnostic(`publicnode ws ${Number(BigInt(w))}, https ${h}`)
    })
    test('ZEC oracle Blockbook (Zelcore) is up and agrees with zec1 on the tip', async t => {
        const [a, b] = await Promise.all([bb('zec1.trezor.io').info(), bb(P.ZEC_ORACLE_BB).info()])
        assert.ok(Math.abs(a.bestHeight - b.bestHeight) <= TIP_TOLERANCE.ZEC, `zec1 ${a.bestHeight} vs zelcore ${b.bestHeight}`)
        t.diagnostic(`zec1 ${a.bestHeight}, ${P.ZEC_ORACLE_BB} ${b.bestHeight}`)
    })
})

describe('MAINNET positive controls: real non-zero balances == independent oracle', () => {
    for (const c of P.BTC) {
        test(`${c.sym} ${hostOf(c.sym)} ${c.kind} ${c.addr}: balance, txids, utxos == mempool.space, > 0`, async t => {
            const host = hostOf(c.sym)
            const oracle = async () => {
                const [a, txids, utxos] = await Promise.all([O.mempool.address(c.addr), O.mempool.txids(c.addr), O.mempool.utxos(c.addr)])
                return { a, txids, utxos }
            }
            const read = async () => {
                const [acct, utxos] = await Promise.all([bb(host).account(c.addr, { details: 'txids', pageSize: 1000 }), bb(host).utxos(c.addr)])
                return { acct, utxos }
            }
            const { oracle: o, value: w, tries } = await O.stableRead(oracle, read)
            assert.equal(w.acct.address, c.addr, 'Blockbook answered for the queried address')
            assert.ok(o.a.confirmed > 0n, `oracle balance > 0 (${o.a.confirmed})`)
            assert.equal(BigInt(w.acct.balance), o.a.confirmed, 'confirmed balance')
            assert.equal(BigInt(w.acct.unconfirmedBalance || 0), o.a.unconfirmed, 'unconfirmed balance')
            assert.equal(w.acct.txs, o.a.txCount, 'confirmed tx count')
            assert.deepEqual([...(w.acct.txids || [])].sort(), [...o.txids].sort(), 'txids')
            assert.deepEqual(w.utxos, o.utxos, 'utxos (txid:vout:value)')
            t.diagnostic(`${c.addr}: ${o.a.confirmed} sats, ${o.a.txCount} txs, ${o.utxos.length} utxos (stable window after ${tries} try)`)
        })
    }

    test(`ETH eth.trezor.io ${P.ETH_HOLDER}: ETH + USDT + USDC == publicnode, all > 0`, async t => {
        const oracle = async () => {
            const [ethBal, usdt, usdc, nonce] = await Promise.all([O.eth.balance(P.ETH_HOLDER), O.eth.erc20Balance(O.TOKENS.USDT, P.ETH_HOLDER),
                O.eth.erc20Balance(O.TOKENS.USDC, P.ETH_HOLDER), O.eth.rpc('eth_getTransactionCount', [P.ETH_HOLDER, 'latest'])])
            return { eth: ethBal, USDT: usdt, USDC: usdc, nonce: Number(BigInt(nonce)) }
        }
        const { oracle: o, value: w, tries } = await O.stableRead(oracle, () => bb('eth.trezor.io').tokenBalances(P.ETH_HOLDER, O.TOKENS))
        assert.equal(w.raw.address, P.ETH_HOLDER)
        for (const k of ['eth', 'USDT', 'USDC']) assert.ok(o[k] > 0n, `${k} oracle balance > 0`)
        assert.equal(w.balance, o.eth, 'ETH wei')
        assert.equal(w.tokens.USDT, o.USDT, 'USDT base units (tokenBalances, by contract)')
        assert.equal(w.tokens.USDC, o.USDC, 'USDC base units (tokenBalances, by contract)')
        assert.equal(Number(w.raw.nonce), o.nonce, 'nonce')
        t.diagnostic(`ETH ${o.eth} wei, USDT ${o.USDT}, USDC ${o.USDC} (6dp), nonce ${o.nonce}, ${w.raw.txs} txs (stable after ${tries})`)
    })

    test(`ETH eth.trezor.io: wallet adapter getAddressTxids(cap 100) == newest 100 txids, newest first`, async t => {
        const send = (method, params, cb) => bb('eth.trezor.io').call(method, params).then(cb, e => cb({ error: { message: e.message } }))
        const [viaAdapter, direct] = await Promise.all([bbAdapter.getAddressTxids(send, P.ETH_HOLDER, 100), bb('eth.trezor.io').txids(P.ETH_HOLDER, 100)])
        assert.equal(viaAdapter.length, Math.min(100, direct.length))
        assert.deepEqual(viaAdapter, direct.slice(0, 100))
        t.diagnostic(`${viaAdapter.length} txids`)
    })

    test(`ZEC zec1.trezor.io ${P.ZEC.addr}: balance, totals, tx count, newest txids == Blockchair and Zelcore, > 0`, async t => {
        // Blockchair is rate-limited (free tier): read it once, and use the Zelcore Blockbook for the stable window
        const zel = bb(P.ZEC_ORACLE_BB), zec1 = bb('zec1.trezor.io')
        const oracle = () => zel.account(P.ZEC.addr, { details: 'txids', pageSize: 100 })
        const { oracle: z, value: w, tries } = await O.stableRead(oracle, () => zec1.account(P.ZEC.addr, { details: 'txids', pageSize: 100 }))
        assert.equal(w.address, P.ZEC.addr)
        assert.ok(BigInt(w.balance) > 0n, 'balance > 0')
        for (const k of ['balance', 'unconfirmedBalance', 'totalReceived', 'totalSent', 'txs']) assert.equal(String(w[k]), String(z[k]), `zec1 vs zelcore ${k}`)
        assert.deepEqual(w.txids, z.txids, 'zec1 vs zelcore newest 100 txids')
        const bc = await O.blockchair.zecAddress(P.ZEC.addr, 100)
        assert.equal(BigInt(w.balance), bc.balance, 'zec1 vs blockchair balance')
        assert.equal(BigInt(w.totalReceived), bc.received, 'zec1 vs blockchair received')
        assert.equal(BigInt(w.totalSent), bc.spent, 'zec1 vs blockchair spent')
        assert.equal(w.txs, bc.txCount, 'zec1 vs blockchair tx count')
        assert.deepEqual(w.txids.slice(0, bc.txids.length), bc.txids, 'zec1 vs blockchair newest txids')
        t.diagnostic(`${P.ZEC.addr}: ${w.balance} zat, ${w.txs} txs, newest ${bc.txids.length} txids agree (stable after ${tries})`)
    })

    test('ZEC zec1.trezor.io: wallet adapter getAddressTxids (full history) == Zelcore walked in pages of 100', async t => {
        const send = (method, params, cb) => bb('zec1.trezor.io').call(method, params).then(cb, e => cb({ error: { message: e.message } }))
        const a = await bbAdapter.getAddressTxids(send, P.ZEC.addr, 1000)
        const pages = []
        for (let p = 1, total = 1; p <= total; p++) {
            const r = await bb(P.ZEC_ORACLE_BB).account(P.ZEC.addr, { details: 'txids', page: p, pageSize: 100 })
            total = r.totalPages || 1
            pages.push(...(r.txids || []))
        }
        assert.ok(a.length > 100, `history ${a.length} (needs > 1 oracle page)`)
        assert.deepEqual(a, pages)
        t.diagnostic(`adapter ${a.length} txids == zelcore ${Math.ceil(pages.length / 100)} pages`)
    })

    test('guard: a mainnet Blockbook silently converts a ZEC testnet address - account() must refuse it', async t => {
        const r = await bb('zec1.trezor.io').call('getAccountInfo', { descriptor: P.ZEC_TESTNET_ADDR, details: 'basic' })
        if (r.address === P.ZEC_TESTNET_ADDR) { t.skip(`guard not exercised: zec1 no longer converts (answered for ${r.address})`); return }
        await assert.rejects(bb('zec1.trezor.io').account(P.ZEC_TESTNET_ADDR), /answered for/)
        t.diagnostic(`zec1 answered ${P.ZEC_TESTNET_ADDR} as ${r.address}: guard rejects`)
    })
})
