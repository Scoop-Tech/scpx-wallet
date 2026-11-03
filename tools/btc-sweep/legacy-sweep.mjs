#!/usr/bin/env node
// Legacy P2PKH key sweep (e.g. the pre-HD single keys the wallet no longer derives): move EVERY confirmed coin of ONE legacy
// address to ONE address, no change, with every coin value verified against its parent transaction, the fee checked
// independently, a real node's testmempoolaccept, and a broadcast of exactly the checked transaction.
//
//   node tools/btc-sweep/legacy-sweep.mjs --network main --from 1... --to <addr> --prehd-mpk-ref <ref> [--check-only]
//   SWEEP_WIF=<testnet wif> node tools/btc-sweep/legacy-sweep.mjs --network test --from m... --to <tb1...> --yes   (rehearsal)
//
// Options: --max-fee-sats N (default 3000)  --max-sat-vb N (default 50)  --sat-vb N (fee rate; default max(2, mempool.space
//          fastest))  --check-only  --yes (testnet only)
// Why parent-tx checks: legacy (non-segwit) signatures do NOT commit to the input amounts, so a backend that under-reports a
// coin would make the fee look small while the network takes the real difference. Here each coin's value is taken from its
// parent tx, whose hash must equal the coin's txid.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import readline from 'node:readline/promises'
import { parseTx, scriptToAddress, addressToScript } from './rawtx.mjs'

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const NODE14 = process.env.E2E_NODE14 || path.join(os.homedir(), '.nvm/versions/node/v14.21.3/bin/node')
const API = { main: 'https://mempool.space/api', test: 'https://mempool.space/testnet4/api' }
const EXPLORER = { main: 'https://mempool.space/tx/', test: 'https://mempool.space/testnet4/tx/' }

const argv = process.argv.slice(2)
const known = new Set(['--network', '--from', '--to', '--prehd-mpk-ref', '--max-fee-sats', '--max-sat-vb', '--sat-vb', '--check-only', '--yes', '--confirm-to', '--allow-unconfirmed'])
const valued = new Set(['--network', '--from', '--to', '--prehd-mpk-ref', '--max-fee-sats', '--max-sat-vb', '--sat-vb', '--confirm-to'])
for (let i = 0; i < argv.length; i++) { if (!known.has(argv[i])) die(`unknown option ${argv[i]}`); if (valued.has(argv[i])) i++ }
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
const flag = k => argv.includes(`--${k}`)
const NET = arg('network')
if (!API[NET]) die('--network must be main or test')
if (flag('yes') && NET === 'main') die('--yes is only allowed on testnet')
if (flag('allow-unconfirmed') && NET === 'main') die('--allow-unconfirmed is only allowed on testnet (rehearsals)')
const ALLOW_UNCONF = flag('allow-unconfirmed')
const FROM = arg('from'), TO = arg('to')
if (!FROM || !TO) die('--from and --to are required')
const MAX_FEE = BigInt(arg('max-fee-sats', '3000')), MAX_VB = Number(arg('max-sat-vb', '50'))

function die(m) { console.error(`\n✖ ${m}\n`); process.exit(1) }
const ok = m => console.log(`  ✔ ${m}`)
const step = m => console.log(`\n▶ ${m}`)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const sats = n => `${n} sats (${(Number(n) / 1e8).toFixed(8)} BTC)`
const dsha = b => crypto.createHash('sha256').update(crypto.createHash('sha256').update(b).digest()).digest()

async function get(url, json = true) {
    for (let i = 0; i < 5; i++) { const r = await fetch(url, { signal: AbortSignal.timeout(20000) }).catch(() => null); if (r && r.ok) return json ? r.json() : r.text(); await sleep(1500 * (i + 1)) }
    die(`GET ${url} failed`)
}
function csvRows(text) {
    const rows = []; let row = [], f = '', q = false
    for (let i = 0; i < text.length; i++) {
        const c = text[i]
        if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++ } else if (c === '"') q = false; else f += c }
        else if (c === '"') q = true
        else if (c === ',') { row.push(f); f = '' }
        else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = '' }
        else f += c
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row) }
    return rows
}
function keySource() {
    if (process.env.SWEEP_WIF) { if (NET !== 'test') die('SWEEP_WIF is for testnet rehearsals only'); return { wif: process.env.SWEEP_WIF } }
    const ref = arg('prehd-mpk-ref'); if (!ref) die('--prehd-mpk-ref <ref> is required')
    const files = (process.env.MPK_CSVS || die('set env MPK_CSVS=<comma-separated CSV files holding the MPKs> to use --mpk-ref')).split(',')
    const hits = new Set()
    for (const f of files) { if (!fs.existsSync(f)) continue; for (const r of csvRows(fs.readFileSync(f, 'utf8'))) for (const c of r) { const m = c.trim(); if (/^PW5[1-9A-HJ-NP-Za-km-z]{40,}$/.test(m) && crypto.createHash('sha256').update(m).digest('hex').slice(0, 8) === ref) hits.add(m) } }
    if (hits.size !== 1) die(`MPK ref ${ref}: ${hits.size} matches`)
    return { prehdMpk: [...hits][0] }
}
function signer(req) { // Node 14 helper: key never leaves it
    const r = spawnSync(NODE14, ['--no-deprecation', path.join(REPO, 'tools/btc-sweep/legacy-sign.node14.js')], { input: JSON.stringify(req), encoding: 'utf8', timeout: 120000 })
    let j; try { j = JSON.parse(r.stdout) } catch (e) { die(`signer failed (exit ${r.status})`) }
    if (j.err) die(`signer: ${j.err}`)
    return j
}

;(async () => {
    console.log(`Legacy key sweep - ${NET === 'main' ? 'MAINNET' : 'testnet4'}`)
    step('1. addresses (independent decoder)')
    let dest; try { dest = addressToScript(TO, NET) } catch (e) { die(`--to ${TO}: ${e.message}`) }
    if (dest.type === 'p2tr' || dest.type.startsWith('witness_v')) die('taproot / future segwit destinations are not supported - use bc1q / 3... / 1...')
    let src; try { src = addressToScript(FROM, NET) } catch (e) { die(`--from ${FROM}: ${e.message}`) }
    if (src.type !== 'p2pkh') die('--from must be a legacy P2PKH (1... / m... / n...) address')
    if (FROM === TO) die('destination == source')
    ok(`${TO} is a valid ${dest.type} address`)
    const key = keySource()
    const derived = signer({ key, network: NET, op: 'address' }).address
    if (derived !== FROM) die(`the key derives ${derived}, not ${FROM} - wrong key/ref`)
    ok(`the key (not printed) controls ${FROM}`)

    step('2. coins: each value verified against its parent transaction')
    const info = await get(`${API[NET]}/address/${FROM}`)
    if (info.mempool_stats.tx_count > 0 && !ALLOW_UNCONF) die(`${FROM} has unconfirmed activity - wait, then re-run`)
    const list = await get(`${API[NET]}/address/${FROM}/utxo`)
    if (!list.length) die('nothing to sweep')
    if (list.some(u => !u.status.confirmed) && !ALLOW_UNCONF) die('unconfirmed coins - wait, then re-run')
    const srcScript = src.script.toString('hex')
    const inputs = []
    for (const u of list) {
        const raw = await get(`${API[NET]}/tx/${u.txid}/hex`, false)
        const p = parseTx(raw.trim())
        if (p.txid !== u.txid) die(`parent tx of ${u.txid} hashes to ${p.txid}`)
        const o = p.outs[u.vout]
        if (!o || o.script !== srcScript) die(`${u.txid}:${u.vout} is not paid to ${FROM}`)
        if (o.sats !== BigInt(u.value)) die(`${u.txid}:${u.vout}: backend says ${u.value}, parent tx says ${o.sats}`)
        inputs.push({ txid: u.txid, vout: u.vout, value: o.sats })
        ok(`${u.txid.slice(0, 16)}…:${u.vout} = ${sats(o.sats)} (from its parent tx)`)
        await sleep(250)
    }
    const total = inputs.reduce((s, i) => s + i.value, 0n)
    ok(`total ${sats(total)} in ${inputs.length} coin(s)`)

    step('3. fee + sign (wallet libraries, key stays in the signer)')
    const market = await get(`${API[NET]}/v1/fees/recommended`)
    const rate = BigInt(Math.ceil(Number(arg('sat-vb', String(Math.max(2, market.fastestFee))))))
    const estVsize = BigInt(10 + 149 * inputs.length + 43) // upper bound: 1-byte varints, 73-byte sigs, compressed keys, <=43-byte output
    const fee = rate * estVsize
    if (fee > MAX_FEE) die(`fee ${fee} sats > --max-fee-sats ${MAX_FEE}`)
    if (total - fee < 546n) die(`after the ${fee}-sat fee only ${total - fee} sats would remain - below dust, not worth sending`)
    const hex = signer({ key, network: NET, op: 'sign', from: FROM, to: TO, inputs: inputs.map(i => ({ txid: i.txid, vout: i.vout, value: i.value.toString() })), sendSats: (total - fee).toString() }).hex
    ok('signed')

    step('4. independent check of the signed transaction')
    const tx = parseTx(hex)
    const want = new Set(inputs.map(i => `${i.txid}:${i.vout}`))
    if (tx.ins.length !== want.size || tx.ins.some(i => !want.has(`${i.txid}:${i.vout}`))) die('inputs are not exactly the coins above')
    if (tx.outs.length !== 1 || tx.outs[0].script !== dest.script.toString('hex')) die('the tx does not have exactly one output, to the destination')
    const realFee = total - tx.outs[0].sats, realRate = Number(realFee) / tx.vsize
    if (realFee !== fee) die('fee mismatch')
    if (realFee > MAX_FEE || realRate > MAX_VB || realRate < 1) die(`fee ${realFee} sats / ${realRate.toFixed(2)} sat/vB out of bounds`)
    ok(`inputs: exactly the ${tx.ins.length} coin(s); one output: ${sats(tx.outs[0].sats)} -> ${scriptToAddress(tx.outs[0].script, NET)} (no change)`)
    ok(`fee ${realFee} sats = ${realRate.toFixed(2)} sat/vB over ${tx.vsize} vB (mempool.space now: fastest ${market.fastestFee}, 1h ${market.hourFee} sat/vB)`)
    const t = await fetch(`${API[NET]}/txs/test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify([hex]) })
    let acc; try { acc = (await t.json())[0] } catch (e) { die(`testmempoolaccept: HTTP ${t.status}`) }
    if (!acc || acc.allowed !== true) die(`a Bitcoin node REJECTS this tx: ${JSON.stringify(acc)}`)
    if (acc.txid !== tx.txid) die('testmempoolaccept txid mismatch')
    if (acc.fees && BigInt(Math.round(acc.fees.base * 1e8)) !== realFee) die(`node computes fee ${acc.fees.base} BTC, we computed ${realFee} sats`)
    ok(`a Bitcoin node (mempool.space testmempoolaccept) accepts it - signatures valid, node-computed fee ${Math.round(acc.fees.base * 1e8)} sats`)

    const outDir = path.join(os.homedir(), '.config/scpx-wallet/sweeps'); fs.mkdirSync(outDir, { recursive: true, mode: 0o700 })
    const rec = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-LEGACY-${NET}-${tx.txid.slice(0, 8)}.json`)
    fs.writeFileSync(rec, JSON.stringify({ network: NET, from: FROM, to: TO, inputs: inputs.map(i => ({ ...i, value: i.value.toString() })), total: total.toString(), sent: tx.outs[0].sats.toString(), fee: realFee.toString(), vsize: tx.vsize, txid: tx.txid, hex }, null, 2), { mode: 0o600 })
    console.log(`\n================  SUMMARY  ================\n  from      ${FROM}\n  to        ${TO}\n  amount    ${(Number(tx.outs[0].sats) / 1e8).toFixed(8)} BTC\n  fee       ${realFee} sats (${realRate.toFixed(2)} sat/vB)\n  txid      ${tx.txid}\n  record    ${rec}\n===========================================`)
    if (flag('check-only')) { console.log('\n--check-only: stopping here. Nothing was broadcast.'); process.exit(0) }

    step('5. confirm + broadcast this exact transaction')
    const confirmTo = arg('confirm-to')
    if (confirmTo !== undefined && confirmTo !== TO) die(`--confirm-to ${confirmTo} does not match --to ${TO} - nothing was broadcast`)
    if (confirmTo === TO) ok(`confirmed on the command line: --confirm-to == --to (${TO})`)
    else if (!flag('yes')) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
        const a = (await rl.question('  Type the LAST 6 characters of the destination address to broadcast (anything else aborts): ')).trim(); rl.close()
        if (a !== TO.slice(-6)) die('not confirmed - nothing was broadcast')
    }
    const b = await fetch(`${API[NET]}/tx`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: hex })
    const body = (await b.text()).trim()
    if (b.status !== 200 || body !== tx.txid) die(`broadcast not confirmed (${b.status} ${body.slice(0, 200)}). Check ${EXPLORER[NET]}${tx.txid} first (re-sending this same hex is safe).`)
    ok(`broadcast: ${EXPLORER[NET]}${tx.txid}`)
    console.log('\nDone.')
})().catch(e => die(e && e.stack || String(e)))
