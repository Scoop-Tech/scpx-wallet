#!/usr/bin/env node
// ETH / ERC20 sweep: move the WHOLE balance of ONE wallet address (ETH, or one ERC20 token) to ONE address, with every number
// checked independently, then broadcast exactly the transaction that was checked.
//
//   node tools/eth-sweep/eth-sweep.mjs --symbol ETH --from <funded addr> --to <dest> --mpk-ref <ref> [--check-only]
//   node tools/eth-sweep/eth-sweep.mjs --symbol ETH --token USDT --from <addr> --to <dest> --mpk-ref <ref>     (token sweep)
//   node tools/eth-sweep/eth-sweep.mjs --symbol ETH_TEST --from <addr> --to <dest> --yes                       (Sepolia rehearsal)
//
// Options: --gas-price-gwei G (default max(2 x baseFee + tip, node gasPrice)), --max-fee-eth F (default 0.0005 mainnet,
//          0.01 Sepolia), --check-only (stop before confirm/broadcast), --yes (Sepolia only: skip the typed confirmation)
// MPK: env SW_MPK, or --mpk-ref (sha256(mpk)[0:8]) looked up in the CSV files listed in env MPK_CSVS. Never printed.
//
// ETH sweep = a legacy (type 0, EIP-155) tx with gasLimit = the exact eth_estimateGas and value = balance - gasLimit * gasPrice,
// so the sender ends at exactly 0 (a plain transfer to an EOA uses exactly its estimate).
// Every check fails closed. Independent of the wallet: two public RPC providers, ethers v6 for decode/recover/ABI.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import https from 'node:https'
import readline from 'node:readline/promises'
import { ethers } from 'ethers'

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const NODE14 = process.env.E2E_NODE14 || path.join(os.homedir(), '.nvm/versions/node/v14.21.3/bin/node')
const NETS = {
    ETH: { chainId: 1n, name: 'MAINNET', rpcs: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org'], explorer: 'https://etherscan.io/tx/',
           tipWei: 50000000n, maxFeeEth: '0.0005',
           tokens: { USDT: ['0xdAC17F958D2ee523a2206206994597C13D831ec7', 6], USDC: ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6], TUSD: ['0x0000000000085d4780B73119b644AE5ecd22b376', 18] },
           interim: { TUSD: 'trueusd' } }, // non-core tokens: the wallet loads them only for this sweep (config INTERIM_ASSETS)
    ETH_TEST: { chainId: 11155111n, name: 'Sepolia', rpcs: ['https://ethereum-sepolia-rpc.publicnode.com', 'https://sepolia.gateway.tenderly.co'], explorer: 'https://sepolia.etherscan.io/tx/',
           tipWei: 100000000n, maxFeeEth: '0.01',
           tokens: { USDT_TEST: ['0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0', 6], USDC_TEST: ['0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8', 6] } },
}
const ERC20 = new ethers.Interface(['function transfer(address to, uint256 amount) returns (bool)', 'function balanceOf(address) view returns (uint256)'])

let W = null // the running wallet (declared first: die() may run during arg parsing)

// ---------- args
const argv = process.argv.slice(2)
const known = new Set(['--symbol', '--token', '--from', '--to', '--mpk-ref', '--prehd-mpk-ref', '--amount', '--gas-price-gwei', '--max-fee-eth', '--check-only', '--yes', '--leave-tokens', '--confirm-to', '--allow-contract-to'])
const valued = new Set(['--symbol', '--token', '--from', '--to', '--mpk-ref', '--prehd-mpk-ref', '--amount', '--gas-price-gwei', '--max-fee-eth', '--confirm-to'])
for (let i = 0; i < argv.length; i++) { if (!known.has(argv[i])) die(`unknown option ${argv[i]}`); if (valued.has(argv[i])) i++ }
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
const flag = k => argv.includes(`--${k}`)
const SYMBOL = arg('symbol', 'ETH')
const NET = NETS[SYMBOL]
if (!NET) die(`--symbol must be ETH or ETH_TEST`)
const TOKEN = arg('token')
if (TOKEN && !NET.tokens[TOKEN]) die(`--token must be one of ${Object.keys(NET.tokens).join(', ')} on ${NET.name}`)
if (flag('yes') && SYMBOL === 'ETH') die('--yes is only allowed on Sepolia: mainnet always asks you to confirm')
const MAX_FEE_WEI = ethers.parseEther(arg('max-fee-eth', NET.maxFeeEth))
const SEND_SYMBOL = TOKEN || SYMBOL
const AMOUNT = arg('amount') // ETH only: send exactly this (e.g. a gas top-up) instead of sweeping the whole balance
if (AMOUNT !== undefined && TOKEN) die('--amount is for ETH sends only (token sends always sweep the whole token balance)')
// key-outside-the-wallet mode: a key the wallet no longer derives (the 2018-12 pre-HD key), signed by tools/eth-sweep/eth-sign.node14.cjs
const KEY_MODE = !!(arg('prehd-mpk-ref') || process.env.SWEEP_ETH_KEY)
if (process.env.SWEEP_ETH_KEY && SYMBOL === 'ETH') die('SWEEP_ETH_KEY is for Sepolia rehearsals only')
if (KEY_MODE && arg('mpk-ref')) die('use either --mpk-ref (wallet keys) or --prehd-mpk-ref (the pre-HD key), not both')

function die(msg) { console.error(`\n✖ ${msg}\n`); cleanup(); process.exit(1) }
const ok = msg => console.log(`  ✔ ${msg}`)
const step = msg => console.log(`\n▶ ${msg}`)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const eth = wei => `${ethers.formatEther(wei)} ETH`
const units = (v, dec) => ethers.formatUnits(v, dec)

// ---------- JSON-RPC (two independent providers; every read must agree)
let rpcId = 1
async function rpcCall(url, method, params, tries = 4) {
    for (let i = 0; ; i++) {
        try {
            const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }), signal: AbortSignal.timeout(20000) })
            const j = await r.json()
            if (j.error) {
                const e = new Error(`${method} @ ${new URL(url).host}: ${j.error.message || JSON.stringify(j.error)}`)
                e.rpc = j.error; e.retry = /too many|rate limit|429|limit exceeded|timeout|temporar/i.test(e.message); throw e
            }
            return j.result
        } catch (e) { if ((e.rpc && !e.retry) || i >= tries) throw e; await sleep(1500 * (i + 1)) }
    }
}
async function both(method, params, label) {
    const res = await Promise.all(NET.rpcs.map(u => rpcCall(u, method, params)))
    const norm = res.map(x => (typeof x === 'string' ? x.toLowerCase() : JSON.stringify(x)))
    if (norm.some(x => x !== norm[0])) die(`${label || method}: the two RPC providers disagree (${res.join(' vs ')}) - not continuing`)
    return res[0]
}

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
function findMpk(refArg = 'mpk-ref') {
    if (refArg === 'mpk-ref' && process.env.SW_MPK) return process.env.SW_MPK
    const ref = arg(refArg); if (!ref) die(`set env SW_MPK or pass --${refArg} <ref>`)
    const files = (process.env.MPK_CSVS || die('set env MPK_CSVS=<comma-separated CSV files holding the MPKs> to use --mpk-ref')).split(',')
    const hits = new Set()
    for (const f of files) {
        if (!fs.existsSync(f)) continue
        for (const r of csvRows(fs.readFileSync(f, 'utf8'))) for (const cell of r) {
            const m = cell.trim()
            if (/^PW5[1-9A-HJ-NP-Za-km-z]{40,}$/.test(m) && crypto.createHash('sha256').update(m).digest('hex').slice(0, 8) === ref) hits.add(m)
        }
    }
    if (hits.size !== 1) die(`MPK ref ${ref}: ${hits.size} matches`)
    return [...hits][0]
}

// ---------- key-outside-the-wallet signer (Node 14 helper; the key never leaves it)
function signer(req) {
    const r = spawnSync(NODE14, ['--no-deprecation', path.join(REPO, 'tools/eth-sweep/eth-sign.node14.cjs')], { input: JSON.stringify(req), encoding: 'utf8', timeout: 120000 })
    let j; try { j = JSON.parse(r.stdout) } catch (e) { die(`signer failed (exit ${r.status})`) }
    if (j.err) die(`signer: ${j.err}`)
    return j
}
const keySource = () => (process.env.SWEEP_ETH_KEY ? { hex: process.env.SWEEP_ETH_KEY } : { prehdMpk: findMpk('prehd-mpk-ref') })

// ---------- wallet (Node 14 sw-cli in RPC mode, private temp dir, deleted on exit)
function cleanup() {
    if (!W) return
    try { if (W.proc && W.proc.exitCode === null) W.proc.kill('SIGKILL') } catch (e) {}
    try { fs.rmSync(W.dir, { recursive: true, force: true }) } catch (e) {}
    W = null
}
process.on('SIGINT', () => { cleanup(); process.exit(130) })
process.on('exit', cleanup)
async function startWallet(mpk) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eth-sweep-')); fs.chmodSync(dir, 0o700)
    fs.symlinkSync(path.join(REPO, 'certs'), path.join(dir, 'certs'))
    const port = 28000 + Math.floor(Math.random() * 1000), user = 'sweep', pass = crypto.randomBytes(16).toString('hex')
    const proc = spawn(NODE14, ['--no-deprecation', '--experimental-worker', path.join(REPO, 'sw-cli.js'), '--rpc=true', `--rpcPort=${port}`,
        '--rpcRemoteHosts=::ffff:127.0.0.1', `--rpcUsername=${user}`, `--rpcPassword=${pass}`],
        { cwd: dir, env: { ...process.env, SW_MPK: mpk, ...(NET.interim && NET.interim[TOKEN] ? { WALLET_INTERIM_ASSETS: NET.interim[TOKEN] } : {}) }, stdio: ['pipe', 'pipe', 'pipe'] })
    W = { dir, proc, port, user, pass, out: '' }
    const onData = b => { W.out = (W.out + b.toString()).slice(-200000) } // memory only, never printed
    proc.stdout.on('data', onData); proc.stderr.on('data', onData)
    const t0 = Date.now()
    while (!/loadAllAssets - complete/.test(W.out)) { if (proc.exitCode !== null) die('wallet exited during load'); if (Date.now() - t0 > 240000) die('wallet load timed out'); await sleep(500) }
    for (;;) {
        const r = await wrpc('wallet-balance', {}).catch(e => ({ err: e.message }))
        if (!(r && r.err && /not connected to 3PBPs/.test(r.err))) break
        if (Date.now() - t0 > 300000) die('wallet did not connect to its backends')
        await sleep(2000)
    }
    return Math.round((Date.now() - t0) / 1000)
}
function wrpc(cmd, params) {
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
async function dumpAsset(symbol) {
    for (const t0 = Date.now(); ;) {
        const d = await wrpc('wallet-dump', { symbol, keys: 'false', txs: 'false' })
        if (d.err) die(`wallet-dump ${symbol}: ${d.err}`)
        const a = (Array.isArray(d.ok) ? d.ok : [d.ok]).find(x => x && x.addresses)
        if (!a) die(`wallet-dump ${symbol}: no addresses`)
        if (a.addresses.every(x => x.du_balConf !== null && x.du_balUnconf !== null)) return a
        if (Date.now() - t0 > 180000) die(`${symbol}: wallet balances not fetched`)
        await sleep(2000)
    }
}

// ---------- main
;(async () => {
    console.log(`ETH sweep - ${SEND_SYMBOL} on ${NET.name}`)

    step('1. network + addresses (two independent RPC providers)')
    for (const u of NET.rpcs) { const c = BigInt(await rpcCall(u, 'eth_chainId', [])); if (c !== NET.chainId) die(`${u} is on chain ${c}, expected ${NET.chainId}`) }
    ok(`both providers are on chain ${NET.chainId} (${NET.rpcs.map(u => new URL(u).host).join(', ')})`)
    let TO, FROM
    try { TO = ethers.getAddress(arg('to') || '') } catch (e) { die(`--to: not a valid address (bad checksum or format): ${arg('to')}`) }
    // an all-lowercase (or all-uppercase) address carries no checksum, so a typo in it can't be detected: on mainnet insist on
    // the mixed-case checksummed form (copy it from the receiving wallet), which ethers.getAddress has just verified
    if (SYMBOL === 'ETH' && arg('to') !== TO) die(`--to must be given in its checksummed (mixed-case) form, exactly as the receiving wallet shows it: ${TO} (verify it there)`)
    try { FROM = ethers.getAddress(arg('from') || '') } catch (e) { die(`--from: not a valid address: ${arg('from')}`) }
    if (TO === ethers.ZeroAddress || BigInt(TO) < 0x10000n) die('destination is the zero / a precompile address')
    if (TO === FROM) die('destination == source')
    const TO_IS_CONTRACT = (await both('eth_getCode', [TO, 'latest'], 'destination code')) !== '0x'
    if (TO_IS_CONTRACT && !flag('allow-contract-to')) die(`destination ${TO} is a contract, not a plain account - refusing (exchange deposit contracts: pass --allow-contract-to; the exact send is simulated first)`)
    if (TO_IS_CONTRACT && TOKEN) die('token transfers to a contract destination are not supported')
    ok(TO_IS_CONTRACT ? `destination ${TO} is a CONTRACT (allowed by --allow-contract-to; gas estimated with the real value, +10% headroom, simulated before broadcast)` : `destination ${TO} is a valid, plain (non-contract) account`)

    let asset, idx, KEY
    if (KEY_MODE) {
        step('2. key outside the wallet (derived in the Node 14 signer; never printed)')
        KEY = keySource()
        const derived = ethers.getAddress(signer({ key: KEY, chainId: Number(NET.chainId), op: 'address' }).address)
        if (derived !== FROM) die(`the key derives ${derived}, not ${FROM} - wrong key/ref`)
        ok(`the key controls ${FROM}`)
    } else {
    step('2. load the wallet from the MPK (not printed; temp dir deleted on exit)')
    const secs = await startWallet(findMpk())
    ok(`wallet loaded + connected in ${secs}s`)
    // derive more HD addresses (in memory only) until the funded one appears - per asset (ERC20 assets keep their own list)
    async function ensureAddr(symbol) {
        let a = await dumpAsset(symbol), i = a.addresses.findIndex(x => x.addr.toLowerCase() === FROM.toLowerCase())
        for (let n = 0; i < 0 && n < 10; n++) {
            const r = await wrpc('wallet-add-address', { symbol })
            if (r.err) die(`wallet-add-address ${symbol}: ${r.err}`)
            a = await dumpAsset(symbol); i = a.addresses.findIndex(x => x.addr.toLowerCase() === FROM.toLowerCase())
        }
        if (i < 0) die(`${FROM} is not one of this wallet's first ${a.addresses.length} ${symbol} addresses - wrong MPK?`)
        return { a, i }
    }
    ;({ a: asset, i: idx } = await ensureAddr(SYMBOL))
    if (TOKEN) await ensureAddr(TOKEN)
    ok(`${FROM} is this wallet's ${SYMBOL} address ${asset.addresses[idx].path}`)
    if (!AMOUNT && asset.addresses.some(a => a.addr.toLowerCase() === TO.toLowerCase())) die('destination is one of this wallet\'s own addresses - that is not a sweep')
    globalThis.__ensureAddr = ensureAddr
    }

    step('3. balances + pending state: wallet vs both providers')
    const nonceLatest = BigInt(await both('eth_getTransactionCount', [FROM, 'latest'], 'nonce'))
    const noncePending = BigInt(await both('eth_getTransactionCount', [FROM, 'pending'], 'pending nonce'))
    if (noncePending !== nonceLatest) die(`${FROM} has pending transactions (nonce ${nonceLatest} vs pending ${noncePending}) - wait, then re-run`)
    const ethBal = BigInt(await both('eth_getBalance', [FROM, 'latest'], 'ETH balance'))
    ok(`nonce ${nonceLatest}, nothing pending; ETH balance ${eth(ethBal)}`)
    let tokenBal, tokenAddr, tokenDec
    if (TOKEN) {
        ;[tokenAddr, tokenDec] = NET.tokens[TOKEN]
        tokenBal = BigInt(await both('eth_call', [{ to: tokenAddr, data: ERC20.encodeFunctionData('balanceOf', [FROM]) }, 'latest'], `${TOKEN} balance`))
        if (!KEY_MODE) {
            const { a: tAsset, i: ti } = await globalThis.__ensureAddr(TOKEN)
            const ta = tAsset.addresses[ti]
            if (!ta) die(`wallet has no ${TOKEN} entry for ${FROM}`)
            if (ethers.parseUnits(ta.du_balConf, tokenDec) !== tokenBal) die(`${TOKEN}: wallet says ${ta.du_balConf}, chain says ${units(tokenBal, tokenDec)} - not sweeping`)
        }
        if (tokenBal === 0n) die(`no ${TOKEN} to sweep`)
        ok(`${TOKEN} balance ${units(tokenBal, tokenDec)} (contract ${tokenAddr})${KEY_MODE ? ', both providers agree' : ', matches the wallet'}`)
    } else {
        if (!KEY_MODE) {
            if (ethers.parseEther(asset.addresses[idx].du_balConf) !== ethBal) die(`wallet says ${asset.addresses[idx].du_balConf} ETH, chain says ${ethers.formatEther(ethBal)} - not sweeping`)
            ok('matches the wallet')
        }
        // sweeping the ETH first would strand any tokens (no gas left to move them): sweep tokens first, or say so explicitly
        if (!AMOUNT) for (const [sym, [addr, dec]] of Object.entries(NET.tokens)) {
            const b = BigInt(await both('eth_call', [{ to: addr, data: ERC20.encodeFunctionData('balanceOf', [FROM]) }, 'latest'], `${sym} balance`))
            if (b > 0n && !flag('leave-tokens')) die(`${FROM} also holds ${units(b, dec)} ${sym}: sweep it first (--token ${sym}), or pass --leave-tokens to strand it`)
            if (b > 0n) console.log(`  (leaving ${units(b, dec)} ${sym} behind: --leave-tokens)`)
        }
    }

    step('4. gas: exact estimate + price from the latest blocks (both providers)')
    const blocks = await Promise.all(NET.rpcs.map(u => rpcCall(u, 'eth_getBlockByNumber', ['latest', false])))
    const baseFee = blocks.map(b => BigInt(b.baseFeePerGas)).reduce((a, b) => (a > b ? a : b))
    const nodePrice = (await Promise.all(NET.rpcs.map(u => rpcCall(u, 'eth_gasPrice', [])))).map(BigInt).reduce((a, b) => (a > b ? a : b))
    let gasPrice = arg('gas-price-gwei') ? ethers.parseUnits(arg('gas-price-gwei'), 'gwei') : (2n * baseFee + NET.tipWei > nodePrice ? 2n * baseFee + NET.tipWei : nodePrice)
    if (gasPrice < baseFee) die(`gas price ${units(gasPrice, 9)} gwei is below the current base fee ${units(baseFee, 9)} gwei - it would never be mined`)
    let gasLimit, value, data = '0x', txTo
    if (!TOKEN) {
        if (!TO_IS_CONTRACT) gasLimit = BigInt(await both('eth_estimateGas', [{ from: FROM, to: TO, value: '0x1' }], 'gas estimate'))
        else { // a contract may run code on receipt: estimate with a realistic value, take the max of both providers, +10%
            const probe = AMOUNT !== undefined ? ethers.parseEther(AMOUNT) : ethBal / 2n
            const ests = (await Promise.all(NET.rpcs.map(u => rpcCall(u, 'eth_estimateGas', [{ from: FROM, to: TO, value: ethers.toQuantity(probe) }])))).map(BigInt)
            gasLimit = (ests.reduce((a, b) => (a > b ? a : b)) * 110n + 99n) / 100n
        }
        txTo = TO
        if (AMOUNT !== undefined) {
            value = ethers.parseEther(AMOUNT)
            if (value <= 0n) die('--amount must be positive')
            if (value + gasLimit * gasPrice > ethBal) die(`balance ${eth(ethBal)} does not cover ${eth(value)} + fee ${eth(gasLimit * gasPrice)}`)
        } else {
            value = ethBal - gasLimit * gasPrice
            if (value <= 0n) die(`balance ${eth(ethBal)} does not cover the fee ${eth(gasLimit * gasPrice)}`)
        }
    } else {
        data = ERC20.encodeFunctionData('transfer', [TO, tokenBal])
        const est = (await Promise.all(NET.rpcs.map(u => rpcCall(u, 'eth_estimateGas', [{ from: FROM, to: tokenAddr, data }])))).map(BigInt).reduce((a, b) => (a > b ? a : b))
        gasLimit = est; value = 0n; txTo = tokenAddr
        if (KEY_MODE) gasLimit = (est * 125n + 99n) / 100n // own headroom (+25%); unused gas is refunded
        ok(`token transfer estimate ${est} gas (${KEY_MODE ? 'signing with +25%' : 'the wallet adds headroom'}; unused gas is refunded)`)
        if (gasLimit * gasPrice > ethBal) die(`not enough ETH for gas: ${eth(ethBal)} < ${eth(gasLimit * gasPrice)} - top it up first (--amount from another address)`)
    }
    if (gasLimit * gasPrice > MAX_FEE_WEI) die(`fee ${eth(gasLimit * gasPrice)} > --max-fee-eth ${ethers.formatEther(MAX_FEE_WEI)}`)
    ok(`base fee ${units(baseFee, 9)} gwei -> gas price ${units(gasPrice, 9)} gwei; gas limit ${gasLimit}; fee ${eth(gasLimit * gasPrice)}`)

    const sendValue = TOKEN ? units(tokenBal, tokenDec) : ethers.formatEther(value)
    let dry
    if (KEY_MODE) {
        step('5. sign in the Node 14 helper (wallet libraries + the wallet\'s ETH send guard; nothing is broadcast)')
        const s = signer({ key: KEY, op: 'sign', chainId: Number(NET.chainId), from: FROM, nonce: nonceLatest.toString(), to: txTo, valueWei: value.toString(), data,
            gasLimit: gasLimit.toString(), gasPriceWei: gasPrice.toString(),
            guard: { symbol: TOKEN ? 'ERC20' : SYMBOL, receiver: TO, value: sendValue, contractAddress: TOKEN ? tokenAddr : undefined, decimals: tokenDec, fromBalanceWei: TOKEN ? undefined : ethBal.toString() } })
        dry = { ok: { hex: s.hex, guard: s.guard } }
    } else {
    step('5. wallet builds + signs a DRY RUN (nothing is broadcast)')
    const params = { symbol: SEND_SYMBOL, value: sendValue, to: TO, from: FROM, dryRun: true }
    Object.assign(params, TOKEN ? { gasPrice: gasPrice.toString() } : { gasPrice: gasPrice.toString(), gasLimit: gasLimit.toString() })
    dry = await wrpc('tx-push', params)
    if (dry.err) die(`dry run refused: ${dry.err}`)
    if (!dry.ok || dry.ok.dryRun !== true || dry.ok.broadcast !== false || !dry.ok.hex || !dry.ok.guard) die('dry run returned an unexpected shape')
    }
    const raw = dry.ok.hex.startsWith('0x') ? dry.ok.hex : '0x' + dry.ok.hex
    ok(`signed tx ${dry.ok.guard.txid}, wallet send guard passed`)

    step('6. independent check of the signed transaction (ethers v6 decode + signer recovery)')
    const tx = ethers.Transaction.from(raw)
    const fail = m => die(`signed tx: ${m}`)
    if (tx.type !== 0) fail(`type ${tx.type}, expected a legacy (type 0) tx`)
    if (tx.chainId !== NET.chainId) fail(`chain id ${tx.chainId} != ${NET.chainId}`)
    if (tx.from !== FROM) fail(`signer ${tx.from} != ${FROM}`)
    if (BigInt(tx.nonce) !== nonceLatest) fail(`nonce ${tx.nonce} != ${nonceLatest}`)
    if (tx.to !== ethers.getAddress(txTo)) fail(`to ${tx.to} != ${txTo}`)
    if (tx.hash !== dry.ok.guard.txid) fail('hash differs from the wallet guard summary')
    if (tx.gasPrice > ethers.parseUnits('200', 'gwei') || tx.gasLimit * tx.gasPrice > MAX_FEE_WEI) fail(`max fee ${eth(tx.gasLimit * tx.gasPrice)} over the cap`)
    if (tx.gasPrice !== gasPrice) fail(`gas price ${tx.gasPrice} != requested ${gasPrice}`)
    if (tx.gasPrice < baseFee) fail('gas price below the base fee')
    if (!TOKEN) {
        if (tx.data !== '0x') fail('data on a plain ETH transfer')
        if (tx.gasLimit !== gasLimit || tx.gasPrice !== gasPrice) fail(`gas ${tx.gasLimit} @ ${tx.gasPrice} != requested ${gasLimit} @ ${gasPrice}`)
        if (tx.value !== value) fail(`value ${tx.value} != ${value}`)
        if (AMOUNT !== undefined) {
            if (tx.value !== ethers.parseEther(AMOUNT) || tx.value + tx.gasLimit * tx.gasPrice > ethBal) fail('value is not exactly --amount, or exceeds the balance')
            ok(`pays exactly ${eth(tx.value)} -> ${tx.to} (sender keeps ${eth(ethBal - tx.value - tx.gasLimit * tx.gasPrice)})`)
        } else {
            if (tx.value + tx.gasLimit * tx.gasPrice !== ethBal) fail('value + fee != the whole balance')
            ok(`pays ${eth(tx.value)} -> ${tx.to}; value + max fee = the whole balance (${TO_IS_CONTRACT ? 'unused gas headroom is refunded to the sender as dust' : 'sender left with 0'})`)
        }
    } else {
        if (tx.value !== 0n) fail('token transfer carries ETH')
        const d = ERC20.parseTransaction({ data: tx.data })
        if (!d || d.name !== 'transfer' || d.args[0] !== TO || d.args[1] !== tokenBal) fail(`call is not transfer(${TO}, ${tokenBal})`)
        if (tx.gasLimit < gasLimit) fail(`gas limit ${tx.gasLimit} below the estimate ${gasLimit} - it would fail on chain`)
        if (tx.gasLimit * tx.gasPrice > ethBal) fail('not enough ETH for the gas')
        ok(`calls ${TOKEN}.transfer(${TO}, ${units(tokenBal, tokenDec)}) on ${tx.to}; max fee ${eth(tx.gasLimit * tx.gasPrice)} (ETH balance ${eth(ethBal)})`)
    }
    ok(`chain ${tx.chainId}, nonce ${tx.nonce}, signed by ${tx.from}, gas ${tx.gasLimit} @ ${units(tx.gasPrice, 9)} gwei`)
    // simulate the exact call on both providers (also checks the sender can pay value + gasLimit * gasPrice)
    const sim = { from: FROM, to: tx.to, value: ethers.toQuantity(tx.value), data: tx.data, gas: ethers.toQuantity(tx.gasLimit), gasPrice: ethers.toQuantity(tx.gasPrice) }
    for (const u of NET.rpcs) {
        let r; try { r = await rpcCall(u, 'eth_call', [sim, 'latest']) } catch (e) { die(`simulation failed on ${new URL(u).host}: ${e.message}`) }
        if (TOKEN && BigInt(r || '0x0') !== 1n) die(`simulated transfer did not return true on ${new URL(u).host}`)
    }
    ok('simulated on both providers: succeeds')

    const outDir = path.join(os.homedir(), '.config/scpx-wallet/sweeps'); fs.mkdirSync(outDir, { recursive: true, mode: 0o700 })
    const rec = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${SEND_SYMBOL}-${tx.hash.slice(2, 10)}.json`)
    fs.writeFileSync(rec, JSON.stringify({ symbol: SEND_SYMBOL, from: FROM, to: TO, raw, hash: tx.hash, nonce: tx.nonce, gasLimit: String(tx.gasLimit),
        gasPrice: String(tx.gasPrice), value: String(tx.value), tokenAmount: tokenBal !== undefined ? String(tokenBal) : undefined, guard: dry.ok.guard }, null, 2), { mode: 0o600 })

    console.log(`\n================  SUMMARY  ================`)
    console.log(`  network   ${NET.name} (chain ${NET.chainId})`)
    console.log(`  from      ${FROM}`)
    console.log(`  to        ${TO}`)
    console.log(`  amount    ${TOKEN ? `${units(tokenBal, tokenDec)} ${TOKEN}` : eth(tx.value)}`)
    console.log(`  fee       ${TOKEN ? 'max ' : ''}${eth(tx.gasLimit * tx.gasPrice)} (${tx.gasLimit} gas @ ${units(tx.gasPrice, 9)} gwei)`)
    console.log(`  tx hash   ${tx.hash}`)
    console.log(`  record    ${rec}`)
    console.log(`===========================================`)
    if (flag('check-only')) { console.log('\n--check-only: stopping here. Nothing was broadcast.'); cleanup(); process.exit(0) }

    step('7. confirm + broadcast this exact transaction')
    cleanup()
    const confirmTo = arg('confirm-to')
    if (confirmTo !== undefined && confirmTo !== TO) die(`--confirm-to ${confirmTo} does not match --to ${TO} (checksummed) - nothing was broadcast`)
    if (confirmTo === TO) ok(`confirmed on the command line: --confirm-to == --to (${TO})`)
    else if (!flag('yes')) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
        const a = (await rl.question(`  Check the destination in the wallet that owns it.\n  Type the LAST 6 characters of the destination address to broadcast (anything else aborts): `)).trim()
        rl.close()
        if (a.toLowerCase() !== TO.slice(-6).toLowerCase()) die('not confirmed - nothing was broadcast')
    }
    let accepted = 0
    for (const u of NET.rpcs) {
        try { const h = await rpcCall(u, 'eth_sendRawTransaction', [raw], 0); if (h.toLowerCase() !== tx.hash.toLowerCase()) die(`${new URL(u).host} returned hash ${h} != ${tx.hash}`); accepted++ }
        catch (e) { if (/already known|known transaction|nonce too low/i.test(e.message)) accepted++; else console.log(`  (${new URL(u).host}: ${e.message})`) }
    }
    if (!accepted) die(`no provider accepted the tx. Check ${NET.explorer}${tx.hash} before doing anything else (re-sending this same tx is safe).`)
    ok(`broadcast: ${NET.explorer}${tx.hash}`)
    for (let i = 0; i < 60; i++) {
        const rcpt = await rpcCall(NET.rpcs[0], 'eth_getTransactionReceipt', [tx.hash]).catch(() => null)
        if (rcpt) {
            if (rcpt.status !== '0x1') die(`tx was MINED BUT FAILED (status ${rcpt.status}) - see ${NET.explorer}${tx.hash}`)
            const left = BigInt(await rpcCall(NET.rpcs[0], 'eth_getBalance', [FROM, 'latest']))
            ok(`mined in block ${BigInt(rcpt.blockNumber)}, status success, gas used ${BigInt(rcpt.gasUsed)}; ${FROM} now holds ${eth(left)}`)
            break
        }
        await sleep(5000)
    }
    console.log('\nDone.')
    process.exit(0)
})().catch(e => die(e && e.stack || String(e)))
