// Lean live test (testnet4, minimum amounts): what a BTC send ACTUALLY put on chain, checked independently of the wallet.
// BTC_TEST uses the same P2SH-P2WPKH builder (actions/wallet-btc-p2sh.js) as mainnet BTC_SEG.
//   - tx-push parameter safety: unknown / mistyped parameters (e.g. "dryrun") and bad dryRun values are refused, nothing sent
//   - dry run: returns a signed tx + send-guard summary and broadcasts nothing (mempool.space never sees the txid)
//   - send with change A -> B: the broadcast tx (raw hex from mempool.space, decoded by tools/btc-sweep/rawtx.mjs, prevout
//     values from mempool.space) pays B exactly the requested sats, its only other output is change to A's own address 0,
//     fee = inputs - outputs == the wallet's guard fee, 1..100 sat/vB
//   - a second coin to B (gives the sweep rehearsal tools/btc-sweep a 2-coin wallet to sweep)
// Run: node --test tests/lean/btc-send-verify.test.mjs
import { test as baseTest } from 'node:test'
import assert from 'node:assert/strict'
import { Wallet, loadEnv, sleep } from '../e2e/lib/wallet.mjs'
import { parseTx, scriptToAddress, addressToScript } from '../../tools/btc-sweep/rawtx.mjs'

const test = (name, fn) => baseTest(name, { timeout: 20 * 60000 }, fn)
const MS = 'https://mempool.space/testnet4/api'
const env = loadEnv()
const A = new Wallet('A-sendv', env.E2E_MPK_A, 25951), B = new Wallet('B-sendv', env.E2E_MPK_B, 25952)
const SYM = 'BTC_TEST'
const SEND1 = '0.00012345', SEND2 = '0.00023456'

const getJson = async url => { for (let i = 0; i < 5; i++) { const r = await fetch(url).catch(() => null); if (r && r.ok) return r.json(); await sleep(2000 * (i + 1)) } throw new Error(`GET ${url}`) }
const getText = async url => { for (let i = 0; i < 5; i++) { const r = await fetch(url).catch(() => null); if (r && r.ok) return r.text(); await sleep(2000 * (i + 1)) } throw new Error(`GET ${url}`) }
const waitUntil = async (fn, ms, every = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn().catch(() => undefined); if (v) return v; await sleep(every) } }
const toSats = s => { const [i, f = ''] = String(s).split('.'); return BigInt(i || '0') * 100000000n + BigInt((f + '00000000').slice(0, 8)) }

// independent check of a broadcast tx: decode the raw hex ourselves, take prevout values from mempool.space
async function verifyOnChain({ txid, receiver, sendSats, ownChangeAddr, guard }) {
    const hex = await waitUntil(() => getText(`${MS}/tx/${txid}/hex`), 120000)
    assert.ok(hex, 'mempool.space has the raw tx')
    const tx = parseTx(hex)
    assert.equal(tx.txid, txid)
    let inSats = 0n
    for (const i of tx.ins) { const prev = await getJson(`${MS}/tx/${i.txid}`); inSats += BigInt(prev.vout[i.vout].value) }
    const recvScript = addressToScript(receiver, 'test').script.toString('hex')
    const toRecv = tx.outs.filter(o => o.script === recvScript)
    assert.equal(toRecv.length, 1, 'exactly one output to the receiver')
    assert.equal(toRecv[0].sats, sendSats, 'receiver gets exactly the requested sats')
    const others = tx.outs.filter(o => o !== toRecv[0])
    assert.ok(others.length <= 1, 'at most one other output')
    for (const o of others) assert.equal(scriptToAddress(o.script, 'test'), ownChangeAddr, 'the only other output is change to the sender\'s own address 0')
    const outSats = tx.outs.reduce((s, o) => s + o.sats, 0n)
    const fee = inSats - outSats
    const rate = Number(fee) / tx.vsize
    assert.ok(fee > 0n && rate >= 1 && rate <= 100, `fee ${fee} sats, ${rate.toFixed(2)} sat/vB`)
    assert.equal(String(fee), guard.feeSats, 'on-chain fee == the wallet send guard\'s fee')
    assert.equal(tx.txid, guard.txid)
    return { fee, rate, outs: tx.outs.length, ins: tx.ins.length }
}

test('BTC_TEST sends: what goes on chain is exactly what was asked', async t => {
    try {
        await Promise.all([A.start(), B.start()])
        const a0 = (await A.dumpFetched(SYM)).addresses.filter(a => !a.protect_op_txid)[0].addr   // dump marks PROTECT_OP addrs with protect_op_txid
        const bAddrs = (await B.dumpFetched(SYM)).addresses.filter(a => !a.protect_op_txid).map(a => a.addr) // standard (key) addresses only
        assert.ok(bAddrs.length >= 1, 'B has a standard BTC_TEST address')
        const b1 = bAddrs[0], b2 = bAddrs[bAddrs.length > 1 ? 1 : 0] // 2 coins (1 or 2 addresses): the sweep rehearsal shape

        await t.test('tx-push refuses unknown / mistyped parameters and bad dryRun values (nothing sent)', async () => {
            for (const extra of [{ dryrun: 'true' }, { 'dry-run': true }, { dryRUN: true }, { broadcast: false }]) {
                const r = await A.rpc('tx-push', { symbol: SYM, value: SEND1, to: b1, ...extra })
                assert.ok(r.err && /Unknown parameter/.test(r.err), `${JSON.stringify(extra)} -> ${JSON.stringify(r).slice(0, 160)}`)
            }
            for (const v of ['yes', '1', 1, 'TRUE ']) {
                const r = await A.rpc('tx-push', { symbol: SYM, value: SEND1, to: b1, dryRun: v })
                assert.ok(r.err && /Invalid dryRun/.test(r.err), `dryRun=${JSON.stringify(v)} -> ${JSON.stringify(r).slice(0, 160)}`)
            }
        })

        await t.test('dry run: signed tx + guard summary, NOT broadcast', async () => {
            const r = await A.rpc('tx-push', { symbol: SYM, value: SEND1, to: b1, dryRun: true })
            assert.ok(r.ok && r.ok.dryRun === true && r.ok.broadcast === false && r.ok.hex && r.ok.guard, r.err || JSON.stringify(r).slice(0, 200))
            const tx = parseTx(r.ok.hex)
            assert.equal(tx.txid, r.ok.guard.txid)
            assert.equal(r.ok.guard.outputs.find(o => o.role === 'receiver').sats, String(toSats(SEND1)))
            await sleep(8000)
            const seen = await fetch(`${MS}/tx/${tx.txid}`)
            assert.equal(seen.status, 404, 'the dry-run tx must not exist on the network')
        })

        let first
        await t.test(`send with change A -> B ${SEND1}: receiver exact, change to A's own address 0, fee == guard`, async () => {
            const r = await A.rpc('tx-push', { symbol: SYM, value: SEND1, to: b1 })
            assert.ok(r.ok && r.ok.txid && r.ok.guard, r.err || JSON.stringify(r).slice(0, 200))
            first = await verifyOnChain({ txid: r.ok.txid, receiver: b1, sendSats: toSats(SEND1), ownChangeAddr: a0, guard: r.ok.guard })
            assert.equal(first.outs, 2, 'receiver + change')
            t.diagnostic(`txid ${r.ok.txid}: fee ${first.fee} sats @ ${first.rate.toFixed(2)} sat/vB, ${first.ins} input(s)`)
        })

        await t.test(`second coin A -> B ${SEND2} (same checks)`, async () => {
            await sleep(3000)
            const r = await A.rpc('tx-push', { symbol: SYM, value: SEND2, to: b2 })
            assert.ok(r.ok && r.ok.txid && r.ok.guard, r.err || JSON.stringify(r).slice(0, 200))
            const v = await verifyOnChain({ txid: r.ok.txid, receiver: b2, sendSats: toSats(SEND2), ownChangeAddr: a0, guard: r.ok.guard })
            t.diagnostic(`txid ${r.ok.txid}: fee ${v.fee} sats @ ${v.rate.toFixed(2)} sat/vB, ${v.ins} input(s)`)
        })
    }
    finally { await Promise.all([A.stop(), B.stop()]) }
})
