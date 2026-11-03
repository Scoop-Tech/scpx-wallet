// scpx-wallet end-to-end regression suite - BTC testnet4 (BTC_TEST p2sh-p2wsh, BTC_TEST2 p2wpkh).
// Black-box: real wallet process (prod flags) + real testnet + independent Blockbook oracle.
// Uses MINIMUM funds: 600-sat sends (dust floor 546), 1500 sats A->B; fees are the only real spend.
// Run: tests/e2e/run.sh <label>
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { Wallet, loadEnv, sleep, REPO } from './lib/wallet.mjs'
import { bbAddress, bbTx, bbWs, bbLegacy } from './lib/oracle.mjs'
import { startProxy } from './lib/proxy.mjs'

const BB = 'x-btc-testnet.d0m1.com:10009', BB_HOST = 'x-btc-testnet.d0m1.com', BB_IP = '62.84.190.200'
const SEND = '0.00000600', A_TO_B = '0.00001500', B_RETURN = '0.00000600'
const env = loadEnv()
const report = { label: process.env.E2E_LABEL || 'unlabelled', commit: process.env.E2E_COMMIT, startedAt: new Date().toISOString(), results: {}, metrics: {}, txids: [] }
const rec = (k, v) => { report.results[k] = v }
const sats = s => { s = String(s); const neg = s.startsWith('-'); if (neg) s = s.slice(1); const [i, f = ''] = s.split('.'); const v = BigInt(i || '0') * 100000000n + BigInt((f + '00000000').slice(0, 8)); return neg ? -v : v }
const walletTotal = d => d.addresses.reduce((t, a) => t + sats(a.du_balConf) + sats(a.du_balUnconf), 0n)
const waitUntil = async (fn, ms, every = 2000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn().catch(() => undefined); if (v) return { v, ms: Date.now() - t0 }; await sleep(every) } return null }

const A = new Wallet('A', env.E2E_MPK_A, 25911)
const B = new Wallet('B', env.E2E_MPK_B, 25912)

async function push(w, symbol, value, to) {
    const r = await w.rpc('tx-push', { symbol, value, to })
    if (r.err || !r.ok || !r.ok.txid) throw new Error(`${w.name} tx-push ${symbol}: ${r.err || JSON.stringify(r).slice(0, 200)}`)
    report.txids.push({ from: w.name, symbol, value, txid: r.ok.txid })
    return r.ok.txid
}

test('scpx-wallet BTC e2e', { timeout: 90 * 60 * 1000 }, async t => {
    try {
        // ---------- 1. startup ----------
        await t.test('1 startup: initial load completes and RPC is connected', async () => {
            await A.start()
            report.metrics.startupMs = A.readyMs
            const r = await A.rpc('wallet-balance', { symbol: 'BTC_TEST' })
            rec('1_startup', r.err ? `FAIL ${r.err}` : 'PASS')
            assert.ok(!r.err, r.err)
        })

        // ---------- 2/3. balances + history vs oracle ----------
        for (const sym of ['BTC_TEST', 'BTC_TEST2']) {
            await t.test(`2 balances match oracle: ${sym}`, async () => {
                const d = await A.dumpFetched(sym)
                for (const a of d.addresses) {
                    const o = await bbAddress(BB, a.addr)
                    assert.equal(sats(a.du_balConf) + sats(a.du_balUnconf), o.balance + o.unconfirmed, `${sym} ${a.addr} wallet vs oracle total`)
                }
                rec(`2_balances_${sym}`, 'PASS')
            })
            await t.test(`3 history matches oracle: ${sym}`, async () => {
                const d = await A.dump(sym)
                const wallet = new Set((d.all_txs || []).map(x => x.txid))
                const oracle = new Set()
                for (const a of d.addresses) (await bbAddress(BB, a.addr)).txids.slice(0, 100).forEach(x => oracle.add(x))
                const missing = [...oracle].filter(x => !wallet.has(x)), extra = [...wallet].filter(x => !oracle.has(x))
                rec(`3_history_${sym}`, missing.length || extra.length ? `FAIL missing=${missing.length} extra=${extra.length}` : `PASS (${wallet.size} txs)`)
                assert.deepEqual({ missing, extra }, { missing: [], extra: [] })
            })
        }

        // ---------- 4. fees ----------
        for (const sym of ['BTC_TEST', 'BTC_TEST2']) {
            await t.test(`4 fee quote sane: ${sym}`, async () => {
                const r = await A.rpc('tx-get-fee', { symbol: sym, value: SEND })
                assert.ok(!r.err, r.err)
                const f = r.ok.txFee
                assert.ok(Number(f.fee) > 0 && Number(f.fee) < 0.0001, `fee ${f.fee}`)
                assert.ok(f.inputsCount > 0 && f.utxo_vsize > 0 && f.utxo_satPerKB > 0)
                rec(`4_fee_${sym}`, `PASS (${f.fee} BTC, ${f.utxo_vsize} vB)`)
            })
        }

        // ---------- 5. differential: legacy socket.io vs websocket (oracle level, read-only) ----------
        await t.test('5 differential: legacy getAddressTxids == websocket getAccountInfo (all A addresses)', async () => {
            const legacy = bbLegacy(BB), ws = bbWs(BB)
            try {
                for (const sym of ['BTC_TEST', 'BTC_TEST2']) for (const a of (await A.dump(sym)).addresses) {
                    const l = await legacy.txids([a.addr]), w = (await ws.send('getAccountInfo', { descriptor: a.addr, details: 'txids', pageSize: 1000 })).txids || []
                    assert.deepEqual(w, l, `${a.addr}: websocket vs legacy`)
                }
                rec('5_differential_history', 'PASS')
            } finally { legacy.close(); ws.close() }
        })

        // ---------- 6. self-sends (both script types) + subscription differential ----------
        for (const sym of ['BTC_TEST2', 'BTC_TEST']) {
            await t.test(`6 self-send ${SEND} ${sym}: broadcast, seen by oracle + both subscription interfaces, tracked by wallet`, async () => {
                const d0 = await A.dump(sym), to = d0.addresses[0].addr, total0 = walletTotal(d0)
                const legacy = bbLegacy(BB), ws = bbWs(BB), seen = { legacy: new Set(), ws: new Set() }
                const addrs = d0.addresses.map(a => a.addr)
                await legacy.subAddresses(addrs, txid => seen.legacy.add(txid))
                await ws.sub('subscribeAddresses', { addresses: addrs }, d => d && d.tx && seen.ws.add(d.tx.txid))
                await sleep(1500)
                try {
                    const t0 = Date.now(), txid = await push(A, sym, SEND, to)
                    report.metrics[`pushMs_${sym}`] = Date.now() - t0
                    const o = await waitUntil(() => bbTx(BB, txid), 30000)
                    assert.ok(o, 'oracle sees tx within 30s')
                    const sub = await waitUntil(async () => seen.legacy.has(txid) && seen.ws.has(txid), 30000, 500)
                    assert.ok(sub, `both subscription interfaces notify (legacy=${seen.legacy.has(txid)} ws=${seen.ws.has(txid)})`)
                    const tracked = await waitUntil(async () => { const d = await A.dump(sym); return [...(d.local_txs || []), ...(d.unconfirmed_txs || []), ...(d.all_txs || [])].some(x => x.txid === txid) }, 60000)
                    assert.ok(tracked, 'wallet tracks its own pending tx within 60s')
                    const settled = await waitUntil(async () => walletTotal(await A.dump(sym)) === total0 - BigInt(o.v.fees), 120000, 3000)
                    report.metrics[`selfSendBalanceSettleMs_${sym}`] = settled ? settled.ms : null
                    rec(`6_selfsend_${sym}`, `PASS (oracle ${o.ms}ms, subs ${sub.ms}ms, wallet ${tracked.ms}ms, balance-settled ${settled ? settled.ms + 'ms' : 'NOT within 120s'})`)
                } finally { legacy.close(); ws.close() }
            })
        }

        // ---------- 7. receive path: A -> B (B sees it), B -> A from B's CONFIRMED funds (earlier runs) ----------
        // testnet4 confirmation times are erratic (blocks every ~20 min, miners often skip ~1.5 sat/vB txs), and the wallet
        // (correctly) only spends confirmed received funds - so B pays A back from funds that confirmed in earlier runs.
        await t.test(`7a A->B ${A_TO_B} (BTC_TEST2): B sees the incoming tx`, async () => {
            await B.start()
            const bAddr = (await B.dump('BTC_TEST2')).addresses[0].addr
            const txAB = await push(A, 'BTC_TEST2', A_TO_B, bAddr)
            const bSees = await waitUntil(async () => { const d = await B.dump('BTC_TEST2'); return (d.all_txs || []).concat(d.unconfirmed_txs || []).some(x => x.txid === txAB) }, 10 * 60000, 3000)
            report.metrics.bSeesIncomingMs = bSees ? bSees.ms : null
            assert.ok(bSees, 'B sees incoming A->B tx within 10 min')
            rec('7a_B_sees_incoming', `PASS (${bSees.ms}ms)`)
        })
        await t.test(`7b B->A ${B_RETURN} from B's confirmed funds (BTC_TEST2): A sees the incoming tx`, async t2 => {
            const conf = (await B.dump('BTC_TEST2')).addresses.reduce((s, a) => s + sats(a.du_balConf), 0n)
            const fee = await B.rpc('tx-get-fee', { symbol: 'BTC_TEST2', value: B_RETURN })
            if (fee.err || conf < sats(B_RETURN) + sats(fee.ok.txFee.fee)) {
                rec('7b_B_to_A', `SKIP (B confirmed balance ${conf} sats - funds from earlier runs not confirmed yet)`)
                return t2.skip(`B has ${conf} confirmed sats; needs earlier-run funds to confirm first`)
            }
            const aAddr = (await A.dump('BTC_TEST2')).addresses[0].addr
            const txBA = await push(B, 'BTC_TEST2', B_RETURN, aAddr)
            const aSees = await waitUntil(async () => { const d = await A.dump('BTC_TEST2'); return (d.all_txs || []).concat(d.unconfirmed_txs || []).some(x => x.txid === txBA) }, 10 * 60000, 3000)
            report.metrics.aSeesIncomingMs = aSees ? aSees.ms : null
            assert.ok(aSees, 'A sees incoming B->A tx within 10 min')
            rec('7b_B_to_A', `PASS (A saw in ${aSees.ms}ms)`)
        })

        // ---------- 9. resilience ----------
        await t.test('9a startup race: BTC_TEST Blockbook held CONNECTING 40s at startup -> wallet self-heals', async () => {
            await A.stop()
            const R = new Wallet('A-race', env.E2E_MPK_A, 25913, { preloadEnv: { E2E_DNS_DELAY_HOST: BB_HOST, E2E_DNS_DELAY_MS: '40000' } })
            try {
                await R.start({ readyTimeoutMs: 240000 })
                const r = await R.rpc('wallet-balance', { symbol: 'BTC_TEST' })
                assert.ok(!r.err && r.ok.balances.length > 0, `balance after race: ${r.err || JSON.stringify(r.ok)}`)
                rec('9a_startup_race', `PASS (ready in ${R.readyMs}ms)`)
            } finally { await R.stop() }
        })

        await t.test('9b network outage 180s mid-session (all Blockbook connections dropped + refused) -> sends work again after recovery', async () => {
            let proxy = await startProxy(10009, BB_IP, 10009)
            const P = new Wallet('A-proxy', env.E2E_MPK_A, 25914, { preloadEnv: { E2E_DNS_MAP: `${BB_HOST}=127.0.0.1` } })
            try {
                await P.start()
                assert.ok(proxy.stats().accepted > 0, 'wallet traffic goes through the proxy')
                proxy.dropAll(); await proxy.close()                    // outage: drop + refuse
                await sleep(180000)
                proxy = await startProxy(10009, BB_IP, 10009)          // recovery
                await sleep(75000)                                       // > VOLATILE_SOCKETS_REINIT_SECS (60)
                const to = (await P.dump('BTC_TEST2')).addresses[0].addr
                const r = await P.rpc('tx-push', { symbol: 'BTC_TEST2', value: SEND, to })
                if (r.ok && r.ok.txid) report.txids.push({ from: 'A', symbol: 'BTC_TEST2', value: SEND, txid: r.ok.txid })
                rec('9b_outage_then_send', r.ok && r.ok.txid ? 'PASS' : `FAIL ${r.err || JSON.stringify(r).slice(0, 160)}`)
                assert.ok(r.ok && r.ok.txid, `send after outage: ${r.err}`)
            } finally { await P.stop(); await proxy.close() }
        })
    } finally {
        // ---------- 10. hygiene (both wallets' file logs) ----------
        await A.stop(); await B.stop()
        const logs = Wallet.all.map(w => w.fileLogs()).join('\n')
        const cats = {
            unknownMessage: /UNKNOWN MESSAGE/,
            unhandledRejection: /Unhandled|unhandledRejection/i,
            rateLimited: /rate.?limit|too many requests|(HTTP|status|code)[ =:]*429\b/i,
            socketIoBlockbookConnects: /BLOCKBOOK WS .* - IO - connected/,
        }
        report.hygiene = {}
        const logLines = logs.split('\n')
        for (const [k, re] of Object.entries(cats)) {
            const hits = logLines.filter(l => re.test(l))
            report.hygiene[k] = { count: hits.length, samples: [...new Set(hits.map(l => l.replace(/\b[0-9a-f]{64}\b/g, '<txid>').replace(/^\S+ \S+ /, '').slice(0, 220)))].slice(0, 3) }
        }
        report.finishedAt = new Date().toISOString()
        const dir = path.join(REPO, 'tests/e2e/reports'); fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(path.join(dir, `${report.startedAt.replace(/[:.]/g, '-')}-${report.label}.json`), JSON.stringify(report, null, 2))
        console.log('\nE2E REPORT', JSON.stringify(report, null, 2))
    }
})
