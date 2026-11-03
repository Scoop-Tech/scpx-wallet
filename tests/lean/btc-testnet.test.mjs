// Lean wallet-level test: BTC testnet4 (BTC_TEST p2sh-p2wsh, BTC_TEST2 p2wpkh), black-box via the wallet's RPC,
// checked against our Blockbook's REST API. Minimum amounts. Testnet only (harness guard).
//   LEAN_NO_SEND=1  -> read-only (startup, balances, history, fees)
// Run: node --test tests/lean/btc-testnet.test.mjs
import { test as baseTest } from 'node:test'
import assert from 'node:assert/strict'
import { Wallet, loadEnv, sleep } from '../e2e/lib/wallet.mjs'

const test = (name, fn) => baseTest(name, { timeout: 15 * 60000 }, fn)
const BB = 'https://x-btc-testnet.d0m1.com:10009/api/v2'
const SEND = '0.00000600', A_TO_B = '0.00001500'
const NO_SEND = process.env.LEAN_NO_SEND === '1'
const env = loadEnv()
const A = new Wallet('A-btc', env.E2E_MPK_A, 25941), B = new Wallet('B-btc', env.E2E_MPK_B, 25942)

const get = async p => (await fetch(`${BB}/${p}`, { headers: { 'User-Agent': 'Mozilla/5.0' } })).json()
const sats = s => { s = String(s); const neg = s.startsWith('-'); if (neg) s = s.slice(1); const [i, f = ''] = s.split('.'); const v = BigInt(i || '0') * 100000000n + BigInt((f + '00000000').slice(0, 8)); return neg ? -v : v }
const waitUntil = async (fn, ms, every = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn().catch(() => undefined); if (v) return v; await sleep(every) } }
const hasTx = async (w, sym, txid) => { const d = await w.dump(sym); return [...(d.all_txs || []), ...(d.local_txs || []), ...(d.unconfirmed_txs || [])].some(x => x.txid === txid) }

test('BTC testnet4 end-to-end on the ported wallet', async t => {
    try {
        await t.test('startup + connected', async () => {
            await A.start()
            const r = await A.rpc('wallet-balance', { symbol: 'BTC_TEST' })
            assert.ok(!r.err, r.err)
        })
        for (const sym of ['BTC_TEST', 'BTC_TEST2']) {
            await t.test(`${sym}: balances == Blockbook (every address)`, async () => {
                for (const a of (await A.dumpFetched(sym)).addresses) {
                    const o = await get(`address/${a.addr}?details=basic`)
                    assert.equal(sats(a.du_balConf) + sats(a.du_balUnconf), BigInt(o.balance) + BigInt(o.unconfirmedBalance || 0), a.addr)
                }
            })
            await t.test(`${sym}: history == Blockbook`, async () => {
                const d = await A.dump(sym), w = new Set((d.all_txs || []).map(x => x.txid)), o = new Set()
                for (const a of d.addresses) ((await get(`address/${a.addr}?details=txids&pageSize=100`)).txids || []).forEach(x => o.add(x))
                assert.deepEqual([...w].sort(), [...o].sort())
            })
            await t.test(`${sym}: fee quote sane`, async () => {
                const r = await A.rpc('tx-get-fee', { symbol: sym, value: SEND })
                assert.ok(!r.err, r.err)
                assert.ok(Number(r.ok.txFee.fee) > 0 && Number(r.ok.txFee.fee) < 0.0001 && r.ok.txFee.utxo_vsize > 0, JSON.stringify(r.ok.txFee))
            })
        }
        if (NO_SEND) return
        for (const sym of ['BTC_TEST2', 'BTC_TEST']) {
            await t.test(`${sym}: self-send ${SEND} via websocket sendTransaction -> on chain + in wallet`, async () => {
                const to = (await A.dump(sym)).addresses[0].addr
                const r = await A.rpc('tx-push', { symbol: sym, value: SEND, to })
                assert.ok(r.ok && r.ok.txid, r.err || JSON.stringify(r).slice(0, 200))
                assert.ok(await waitUntil(async () => (await get(`tx/${r.ok.txid}`)).txid, 30000), 'Blockbook sees tx')
                assert.ok(await waitUntil(() => hasTx(A, sym, r.ok.txid), 60000), 'wallet tracks tx')
                await A.waitForLog(new RegExp(`addresstxid data - ${sym} .*${r.ok.txid}`), 60000)   // address-monitor alert (websocket subscribeAddresses)
            })
        }
        await t.test(`receive: A->B ${A_TO_B} (BTC_TEST2), B sees incoming`, async () => {
            await B.start()
            const bAddr = (await B.dump('BTC_TEST2')).addresses[0].addr
            const r = await A.rpc('tx-push', { symbol: 'BTC_TEST2', value: A_TO_B, to: bAddr })
            assert.ok(r.ok && r.ok.txid, r.err)
            assert.ok(await waitUntil(() => hasTx(B, 'BTC_TEST2', r.ok.txid), 5 * 60000), 'B sees incoming')
            await B.waitForLog(new RegExp(`addresstxid data - BTC_TEST2 .*${r.ok.txid}`), 60000)   // B's incoming-tx alert
        })
        await t.test('hygiene: no socket.io connections to Blockbook, no UNKNOWN MESSAGE', async () => {
            const lines = (A.fileLogs() + '\n' + B.fileLogs()).split('\n')
            const pick = re => [...new Set(lines.filter(l => re.test(l)).map(l => l.replace(/^\S+ \S+ /, '').replace(/[0-9a-f]{64}/gi, '<h>').slice(0, 200)))]
            const io = pick(/BLOCKBOOK WS .* - IO - connected/), unk = pick(/UNKNOWN MESSAGE/)
            assert.equal(io.length, 0, `socket.io connections to Blockbook:\n${io.slice(0, 3).join('\n')}`)
            assert.equal(unk.length, 0, `UNKNOWN MESSAGE (distinct):\n${unk.slice(0, 5).join('\n')}`)
        })
    } finally { await A.stop(); await B.stop() }
})
