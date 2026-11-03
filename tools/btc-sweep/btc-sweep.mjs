#!/usr/bin/env node
// BTC sweep: move EVERY confirmed coin of a P2SH-P2WPKH wallet asset (BTC_SEG on mainnet, BTC_TEST on testnet4) to ONE address,
// with a fee that is independently checked, no change output, and a broadcast of exactly the transaction that was checked.
//
//   node tools/btc-sweep/btc-sweep.mjs --symbol BTC_SEG --to <address> --mpk-ref <8-hex ref from the MPK scan>
//   node tools/btc-sweep/btc-sweep.mjs --symbol BTC_TEST --to <tb1/2.. address> --mpk-ref <ref> --yes   (testnet rehearsal)
//
// Options: --max-fee-sats N (default 5000)  --max-sat-vb N (default 50)  --check-only (stop before the confirm/broadcast step)
// MPK: env SW_MPK, or --mpk-ref looked up (sha256(mpk)[0:8]) in the CSVs listed in env MPK_CSVS
//      (required with --mpk-ref). The MPK is never printed.
//
// Flow (every check fails closed; nothing is broadcast unless all pass AND you confirm):
//   1. destination parsed by an independent decoder (rawtx.mjs): network + checksum; taproot refused (wallet can't pay it)
//   2. the wallet (Node 14 sw-cli, RPC mode, temp dir, deleted afterwards) is loaded from the MPK and connected
//   3. coins: the wallet's addresses -> UTXOs from mempool.space (an independent backend); must match the wallet's balances,
//      all confirmed, nothing pending in the mempool on those addresses
//   4. the wallet builds + signs a DRY RUN (tx-push dryRun=true, spendFullUtxos = exactly those coins) - its send guard runs
//   5. the signed hex is decoded independently: inputs == exactly those coins, ONE output == the destination, amount ==
//      total - fee, fee within limits, txid matches; then mempool.space testmempoolaccept (a real node) must accept it
//   6. you confirm by typing the end of the destination address; the exact checked hex is broadcast to mempool.space
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import https from 'node:https'
import readline from 'node:readline/promises'
import { parseTx, scriptToAddress, addressToScript } from './rawtx.mjs'

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const NODE14 = process.env.E2E_NODE14 || path.join(os.homedir(), '.nvm/versions/node/v14.21.3/bin/node')
const SUPPORTED = { BTC_SEG: 'main', BTC_TEST: 'test' }
const API = { main: 'https://mempool.space/api', test: 'https://mempool.space/testnet4/api' }
const EXPLORER = { main: 'https://mempool.space/tx/', test: 'https://mempool.space/testnet4/tx/' }

let W = null // the running wallet (declared first: die() may run during arg parsing)

// ---------- args
const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
const flag = k => argv.includes(`--${k}`)
const known = new Set(['--symbol', '--to', '--mpk-ref', '--max-fee-sats', '--max-sat-vb', '--yes', '--check-only', '--derive', '--confirm-to'])
for (const a of argv) if (a.startsWith('--') && !known.has(a)) die(`unknown option ${a}`)
const SYMBOL = arg('symbol', 'BTC_SEG')
const TO = arg('to')
const MAX_FEE_SATS = BigInt(arg('max-fee-sats', '5000'))
const MAX_SAT_VB = Number(arg('max-sat-vb', '50'))
const DERIVE = Number(arg('derive', '10')) // derive (in memory) the first N standard addresses, so coins beyond index 0 are seen
if (!Number.isInteger(DERIVE) || DERIVE < 1 || DERIVE > 50) die('--derive must be 1..50')
const NET = SUPPORTED[SYMBOL]
if (!NET) die(`--symbol must be one of ${Object.keys(SUPPORTED).join(', ')} (P2SH-P2WPKH assets)`)
if (!TO) die('--to <address> is required')
if (flag('yes') && NET === 'main') die('--yes is only allowed on testnet: mainnet always asks you to confirm')

function die(msg) { console.error(`\n✖ ${msg}\n`); cleanup(); process.exit(1) }
const ok = msg => console.log(`  ✔ ${msg}`)
const step = msg => console.log(`\n▶ ${msg}`)
const sats = n => `${n.toString()} sats (${(Number(n) / 1e8).toFixed(8)} BTC)`
const btcToSats = v => { // exact decimal BTC string -> BigInt sats (no floats)
    const m = String(v).trim().match(/^(-?)(\d+)(?:\.(\d{0,8}))?$/); if (!m) die(`bad BTC amount "${v}"`)
    const x = BigInt(m[2]) * 100000000n + BigInt((m[3] || '').padEnd(8, '0')); return m[1] ? -x : x }
const btcStr = n => { const s = n.toString().padStart(9, '0'); return `${s.slice(0, -8)}.${s.slice(-8)}` } // exact, 8 dp

// ---------- http (independent backend)
function http(method, url, body, type = 'application/json') {
    return new Promise((resolve, reject) => {
        const req = https.request(url, { method, timeout: 30000, headers: body ? { 'content-type': type, 'content-length': Buffer.byteLength(body) } : {} }, res => {
            let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d }))
        })
        req.on('error', reject); req.on('timeout', () => req.destroy(new Error(`timeout ${url}`))); req.end(body)
    })
}
async function getJson(url, tries = 4) {
    for (let i = 0; ; i++) {
        const r = await http('GET', url).catch(e => ({ status: 0, body: String(e) }))
        if (r.status === 200) return JSON.parse(r.body)
        if (i >= tries) throw new Error(`GET ${url} -> ${r.status} ${r.body.slice(0, 120)}`)
        await sleep(1500 * (i + 1))
    }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ---------- MPK (never printed)
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
function findMpk() {
    if (process.env.SW_MPK) return process.env.SW_MPK
    const ref = arg('mpk-ref'); if (!ref) die('set env SW_MPK or pass --mpk-ref <ref>')
    const files = (process.env.MPK_CSVS || die('set env MPK_CSVS=<comma-separated CSV files holding the MPKs> to use --mpk-ref')).split(',')
    const hits = new Set()
    for (const f of files) {
        if (!fs.existsSync(f)) continue
        for (const r of csvRows(fs.readFileSync(f, 'utf8'))) for (const cell of r) {
            const m = cell.trim()
            if (/^PW5[1-9A-HJ-NP-Za-km-z]{40,}$/.test(m) && crypto.createHash('sha256').update(m).digest('hex').slice(0, 8) === ref) hits.add(m)
        }
    }
    if (hits.size !== 1) die(`MPK ref ${ref}: ${hits.size} matches in ${files.join(', ')}`)
    return [...hits][0]
}

// ---------- wallet (Node 14 sw-cli in RPC mode, private temp dir)
function cleanup() {
    if (!W) return
    try { if (W.proc && W.proc.exitCode === null) W.proc.kill('SIGKILL') } catch (e) {}
    try { fs.rmSync(W.dir, { recursive: true, force: true }) } catch (e) {} // wallet logs: never kept
    W = null
}
process.on('SIGINT', () => { cleanup(); process.exit(130) })
process.on('exit', cleanup)

async function startWallet(mpk) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'btc-sweep-'))
    fs.chmodSync(dir, 0o700)
    fs.symlinkSync(path.join(REPO, 'certs'), path.join(dir, 'certs'))
    const port = 27000 + Math.floor(Math.random() * 1000)
    const user = 'sweep', pass = crypto.randomBytes(16).toString('hex')
    const proc = spawn(NODE14, ['--no-deprecation', '--experimental-worker', path.join(REPO, 'sw-cli.js'), '--rpc=true', `--rpcPort=${port}`,
        '--rpcRemoteHosts=::ffff:127.0.0.1', `--rpcUsername=${user}`, `--rpcPassword=${pass}`],
        { cwd: dir, env: { ...process.env, SW_MPK: mpk }, stdio: ['pipe', 'pipe', 'pipe'] })
    W = { dir, proc, port, user, pass, out: '' }
    const onData = b => { W.out = (W.out + b.toString()).slice(-200000) } // kept in memory only, never printed
    proc.stdout.on('data', onData); proc.stderr.on('data', onData)
    const t0 = Date.now()
    while (!/loadAllAssets - complete/.test(W.out)) {
        if (proc.exitCode !== null) die('wallet exited during load')
        if (Date.now() - t0 > 240000) die('wallet load timed out')
        await sleep(500)
    }
    for (;;) {
        const r = await rpc('wallet-balance', {}).catch(e => ({ err: e.message }))
        if (!(r && r.err && /not connected to 3PBPs/.test(r.err))) break
        if (Date.now() - t0 > 300000) die('wallet did not connect to its backends')
        await sleep(2000)
    }
    return Math.round((Date.now() - t0) / 1000)
}
function rpc(cmd, params) {
    if (cmd === 'tx-push' && params.dryRun !== true) return Promise.reject(new Error('sweep tool never lets the wallet broadcast'))
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'exec', params: [{ username: W.user, password: W.pass }, cmd, params] })
    return new Promise((resolve, reject) => {
        const req = https.request({ host: '127.0.0.1', port: W.port, method: 'POST', path: '/', rejectUnauthorized: false, timeout: 180000,
            headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, res => {
            let d = ''; res.on('data', c => d += c); res.on('end', () => {
                try { const j = JSON.parse(d); resolve(j.error ? { err: j.error.message } : (j.result && j.result.ok !== undefined ? { ok: j.result.ok } : j.result)) } catch (e) { reject(e) }
            })
        })
        req.on('error', reject); req.on('timeout', () => req.destroy(new Error('rpc timeout'))); req.end(body)
    })
}

// ---------- main
;(async () => {
    console.log(`BTC sweep - ${SYMBOL} (${NET === 'main' ? 'MAINNET' : 'testnet4'})`)

    step('1. destination (independent decoder)')
    let dest
    try { dest = addressToScript(TO, NET) } catch (e) { die(`destination ${TO}: ${e.message}`) }
    if (dest.type === 'p2tr' || dest.type.startsWith('witness_v')) die(`destination is ${dest.type}: this wallet cannot pay taproot/future segwit addresses - use a bc1q / 3... / 1... address`)
    const destScript = dest.script.toString('hex')
    if (scriptToAddress(destScript, NET).toLowerCase() !== TO.toLowerCase()) die('destination does not round-trip through the decoder')
    ok(`${TO} is a valid ${NET === 'main' ? 'mainnet' : 'testnet'} ${dest.type} address`)

    step('2. load the wallet from the MPK (not printed; temp dir deleted on exit)')
    const mpk = findMpk()
    const secs = await startWallet(mpk)
    ok(`wallet loaded + connected in ${secs}s`)
    for (let n = 0; n < 60; n++) { // derive standard addresses 0..DERIVE-1 (in memory only; the wallet loads index 0 by default)
        const d = await rpc('wallet-dump', { symbol: SYMBOL, keys: 'false', txs: 'false' })
        const a = d.ok && (Array.isArray(d.ok) ? d.ok : [d.ok]).find(x => x && x.addresses)
        if (!a) die(`wallet-dump: ${d.err || 'no addresses'}`)
        if (a.addresses.filter(x => !x.protect_op_txid).length >= DERIVE) break
        const r = await rpc('wallet-add-address', { symbol: SYMBOL })
        if (r.err) die(`wallet-add-address: ${r.err}`)
    }
    ok(`checking the first ${DERIVE} standard ${SYMBOL} addresses`)
    // every address must have a fetched balance (never-fetched = null, e.g. PROTECT_OP addresses added after load)
    let asset
    for (const t0 = Date.now(); ;) {
        const dump = await rpc('wallet-dump', { symbol: SYMBOL, keys: 'false', txs: 'false' })
        if (dump.err) die(`wallet-dump: ${dump.err}`)
        asset = (Array.isArray(dump.ok) ? dump.ok : [dump.ok]).find(x => x && x.addresses)
        if (!asset) die('wallet-dump returned no addresses')
        if (asset.addresses.every(a => a.du_balConf !== null && a.du_balUnconf !== null)) break
        if (Date.now() - t0 > 180000) die('wallet balances not fetched for every address')
        await sleep(2000)
    }
    if (asset.fetchError || asset.addresses.some(a => a.fetchError)) die(`wallet backend error: ${asset.fetchError || asset.addresses.find(a => a.fetchError).fetchError}`)
    const ownAddrs = asset.addresses.map(a => a.addr)
    if (ownAddrs.includes(TO)) die('destination is one of this wallet\'s own addresses - that is not a sweep')

    step('3. coins: wallet vs mempool.space (independent backend)')
    const utxos = []
    let walletConf = 0n
    for (const a of asset.addresses) {
        const conf = btcToSats(a.du_balConf), unconf = btcToSats(a.du_balUnconf)
        const info = await getJson(`${API[NET]}/address/${a.addr}`)
        const list = await getJson(`${API[NET]}/address/${a.addr}/utxo`)
        const ext = list.filter(u => u.status && u.status.confirmed).reduce((s, u) => s + BigInt(u.value), 0n)
        if (list.some(u => !u.status || !u.status.confirmed) || info.mempool_stats.tx_count > 0 || unconf !== 0n)
            die(`${a.addr}: has unconfirmed activity - wait for it to confirm, then re-run`)
        if (a.protect_op_txid) { if (ext > 0n) console.log(`  (skipping PROTECT_OP address ${a.addr} holding ${sats(ext)}: not swept - claim it separately)`); continue }
        if (ext !== conf) die(`${a.addr}: wallet says ${sats(conf)}, mempool.space says ${sats(ext)} - backends disagree, not sweeping`)
        walletConf += conf
        for (const u of list) utxos.push({ txid: u.txid, vout: u.vout, value: BigInt(u.value), addr: a.addr })
        if (ext > 0n) ok(`${a.addr}: ${sats(ext)} in ${list.length} coin(s), confirmed, matches the wallet`)
        await sleep(250)
    }
    const total = utxos.reduce((s, u) => s + u.value, 0n)
    if (total === 0n) die('nothing to sweep')
    if (total !== walletConf) die('totals disagree')
    ok(`total to sweep: ${sats(total)} in ${utxos.length} coin(s)`)

    step('4. wallet builds + signs a DRY RUN (nothing is broadcast)')
    const spendFullUtxos = utxos.map(u => `${u.txid}:${u.vout}`).join(',')
    const dry = await rpc('tx-push', { symbol: SYMBOL, value: btcStr(total), to: TO, spendFullUtxos, dryRun: true })
    if (dry.err) die(`dry run refused: ${dry.err}`)
    if (!dry.ok || dry.ok.dryRun !== true || dry.ok.broadcast !== false || !dry.ok.hex || !dry.ok.guard) die('dry run returned an unexpected shape - not continuing')
    const hex = dry.ok.hex, guard = dry.ok.guard
    ok(`signed tx ${guard.txid}, wallet send guard passed (fee ${guard.feeSats} sats, ${guard.feeSatPerVb} sat/vB)`)

    step('5. independent check of the signed transaction')
    const tx = parseTx(hex)
    const want = new Set(utxos.map(u => `${u.txid}:${u.vout}`))
    const got = tx.ins.map(i => `${i.txid}:${i.vout}`)
    if (got.length !== want.size || new Set(got).size !== got.length || got.some(x => !want.has(x))) die('inputs are not exactly the coins listed above')
    ok(`inputs: exactly the ${got.length} coin(s) above`)
    for (const i of tx.ins) {
        if (!(i.witness.length === 2 && i.scriptSig.length === 46 && i.scriptSig.startsWith('160014'))) die(`input ${i.txid}:${i.vout} is not a plain P2SH-P2WPKH spend`)
        if (i.sequence < 0xfffffffe) die('unexpected input sequence')
    }
    if (tx.outs.length !== 1) die(`expected exactly 1 output, found ${tx.outs.length}`)
    const out = tx.outs[0]
    if (out.script !== destScript) die(`the only output pays ${scriptToAddress(out.script, NET)}, not ${TO}`)
    const fee = total - out.sats
    ok(`one output: ${sats(out.sats)} -> ${scriptToAddress(out.script, NET)} (no change output)`)
    if (fee <= 0n) die('non-positive fee')
    const rate = Number(fee) / tx.vsize
    if (fee > MAX_FEE_SATS) die(`fee ${fee} sats > --max-fee-sats ${MAX_FEE_SATS}`)
    if (rate > MAX_SAT_VB) die(`fee rate ${rate.toFixed(2)} sat/vB > --max-sat-vb ${MAX_SAT_VB}`)
    if (rate < 1) die(`fee rate ${rate.toFixed(2)} sat/vB is below the 1 sat/vB relay minimum`)
    if (String(fee) !== guard.feeSats || tx.txid !== guard.txid) die('the wallet guard summary and the independent decode disagree')
    if (tx.locktime !== 0) die(`unexpected locktime ${tx.locktime}`)
    const market = await getJson(`${API[NET]}/v1/fees/recommended`).catch(() => null)
    ok(`fee: ${fee} sats = ${rate.toFixed(2)} sat/vB over ${tx.vsize} vB${market ? ` (mempool.space now: fastest ${market.fastestFee}, 1h ${market.hourFee} sat/vB)` : ''}`)
    const tma = await http('POST', `${API[NET]}/txs/test`, JSON.stringify([hex]))
    let acc; try { acc = JSON.parse(tma.body)[0] } catch (e) { die(`testmempoolaccept: ${tma.status} ${tma.body.slice(0, 200)}`) }
    if (!acc || acc.allowed !== true) die(`a Bitcoin node REJECTS this tx: ${JSON.stringify(acc)}`)
    if (acc.txid !== tx.txid) die('testmempoolaccept txid mismatch')
    if (acc.fees && acc.fees.base !== undefined && BigInt(Math.round(acc.fees.base * 1e8)) !== fee) die(`node computes fee ${acc.fees.base} BTC, we computed ${fee} sats`)
    ok(`a Bitcoin node (mempool.space testmempoolaccept) accepts it${acc.fees ? `, node-computed fee ${Math.round(acc.fees.base * 1e8)} sats` : ''}`)

    const outDir = path.join(os.homedir(), '.config/scpx-wallet/sweeps'); fs.mkdirSync(outDir, { recursive: true, mode: 0o700 })
    const rec = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${SYMBOL}-${tx.txid.slice(0, 8)}.json`)
    fs.writeFileSync(rec, JSON.stringify({ symbol: SYMBOL, to: TO, inputs: utxos.map(u => ({ ...u, value: u.value.toString() })), total: total.toString(),
        sent: out.sats.toString(), fee: fee.toString(), vsize: tx.vsize, txid: tx.txid, hex, guard }, null, 2), { mode: 0o600 })

    console.log(`\n================  SUMMARY  ================`)
    console.log(`  from      ${[...new Set(utxos.map(u => u.addr))].join(', ')}`)
    console.log(`  to        ${TO}`)
    console.log(`  amount    ${btcStr(out.sats)} BTC`)
    console.log(`  fee       ${fee} sats (${rate.toFixed(2)} sat/vB)`)
    console.log(`  txid      ${tx.txid}`)
    console.log(`  record    ${rec}`)
    console.log(`===========================================`)
    if (flag('check-only')) { console.log('\n--check-only: stopping here. Nothing was broadcast.'); cleanup(); process.exit(0) }

    step('6. confirm + broadcast this exact transaction')
    cleanup() // wallet no longer needed
    const confirmTo = arg('confirm-to')
    if (confirmTo !== undefined && confirmTo !== TO) die(`--confirm-to ${confirmTo} does not match --to ${TO} - nothing was broadcast`)
    if (confirmTo === TO) ok(`confirmed on the command line: --confirm-to == --to (${TO})`)
    else if (!flag('yes')) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
        const tail = TO.slice(-6)
        const a = (await rl.question(`  Check the destination on the device/wallet that owns it.\n  Type the LAST 6 characters of the destination address to broadcast (anything else aborts): `)).trim()
        rl.close()
        if (a !== tail) die('not confirmed - nothing was broadcast')
    }
    const b = await http('POST', `${API[NET]}/tx`, hex, 'text/plain')
    if (b.status !== 200 || b.body.trim() !== tx.txid) {
        console.error(`\n  broadcast response: ${b.status} ${b.body.slice(0, 300)}`)
        die(`broadcast not confirmed. Check ${EXPLORER[NET]}${tx.txid} before doing anything else (re-sending this same hex is safe; building a new tx is not needed).`)
    }
    ok(`broadcast: ${EXPLORER[NET]}${tx.txid}`)
    for (let i = 0; i < 20; i++) {
        const s = await getJson(`${API[NET]}/tx/${tx.txid}`, 0).catch(() => null)
        if (s) { ok(`seen by mempool.space (${s.status && s.status.confirmed ? 'confirmed' : 'in mempool'})`); break }
        await sleep(3000)
    }
    console.log('\nDone.')
    process.exit(0)
})().catch(e => die(e && e.stack || String(e)))
