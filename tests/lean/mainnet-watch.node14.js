// Lean MAINNET watch test (Node 14, READ-ONLY): the wallet's OWN fetch/parse/reduce/balance code on pinned PUBLIC
// mainnet addresses (no MPK, no keys, nothing signed or broadcast), compared with independent oracles read in the
// same stable window: mempool.space (BTC), publicnode eth_getBalance / eth_call balanceOf (ETH, ERC20) and a
// separate Blockbook websocket (ETH txids, tokenBalances). Every balance must also be > 0 (real data, not a 0 == 0).
//
// Run: node --experimental-worker tests/lean/mainnet-watch.node14.js        (nvm use 14.21.3)
//   LEAN_WATCH_ONLY=BTC|ETH      run one group
//   LEAN_WATCH_STRESS=1          also run the heavy P2SH address (expected to fail until the BB request limiter lands;
//                                it deliberately bursts ~100 requests at a public Trezor Blockbook)
//   LEAN_WATCH_VERBOSE=1         keep the wallet's own console logging
//
// Result per case: PASS | FAIL | TODO (known wallet bug, expected to fail; never fails the run) | XPASS (a TODO that now
// passes: the fix landed - promote it to a normal case). Exit code 1 on any FAIL.
'use strict'
const assert = require('assert')
const util = require('util')
const H = require('./lib/watch-harness')
const O = require('./lib/oracles')
const P = require('./lib/pinned')

const ONLY = process.env.LEAN_WATCH_ONLY
const VERBOSE = !!process.env.LEAN_WATCH_VERBOSE
const out = (...a) => process.stdout.write(util.format(...a) + '\n')

// the wallet logs a lot to the console; keep it unless asked, show the tail on a failure
const walletLog = []
if (!VERBOSE) for (const k of ['log', 'info', 'warn', 'error', 'debug']) console[k] = (...a) => { walletLog.push(util.format(...a)); if (walletLog.length > 400) walletLog.shift() }

const results = []
async function check(name, fn, { todo } = {}) {
    const t0 = Date.now()
    try {
        const note = await fn()
        const status = todo ? 'XPASS' : 'PASS'
        results.push({ name, status })
        out(`${status === 'PASS' ? '✔' : '✚'} ${status} ${name} (${Date.now() - t0}ms)${note ? ` - ${note}` : ''}${todo ? ` [todo was: ${todo}]` : ''}`)
    } catch (e) {
        const status = todo ? 'TODO' : 'FAIL'
        results.push({ name, status, err: e.message })
        out(`${todo ? '…' : '✖'} ${status} ${name} (${Date.now() - t0}ms)${todo ? ` [${todo}]` : ''}\n    ${String(e.message).split('\n').slice(0, 6).join('\n    ')}`)
    }
}
// whole-run watchdog (the in-process ETH first load has taken 6s..4min on the same day): fail, clean up, exit
const WATCHDOG_MS = Number(process.env.LEAN_WATCH_TIMEOUT_MS) || 20 * 60000
setTimeout(() => {
    out(`✖ FAIL watchdog: run exceeded ${WATCHDOG_MS}ms (results so far: ${results.map(r => r.status).join(' ') || 'none'})`)
    H.stop().then(() => process.exit(1), () => process.exit(1))
}, WATCHDOG_MS).unref()
const skip = (name, why) => { results.push({ name, status: 'FAIL', err: why }); out(`✖ FAIL ${name} - not run: ${why}`) }

const sortedEq = (a, b, msg) => assert.deepStrictEqual([...a].sort(), [...b].sort(), msg)

// ---------------- BTC (UTXO): one address per Trezor BTC Blockbook, each its wallet script type ----------------
async function btcCase(c, { stress = false } = {}) {
    const label = `watch ${c.sym} ${c.kind} ${c.addr}`
    const oracle = async () => {
        const a = await O.mempool.address(c.addr)
        return { a, utxos: await O.mempool.utxos(c.addr), txids: await O.mempool.txids(c.addr) }
    }
    let r, o
    try {
        const s = await O.stableRead(oracle, () => { const asset = H.watchAsset(c.metaKey, [c.addr]); return H.fetchAsset({ owner: 'watch', assets: [asset] }, asset) })
        r = s.value; o = s.oracle
    } catch (e) { return skip(`${label}: fetch`, e.message) }
    const bal = H.balance(r.asset), ad = r.asset.addresses[0]
    const txs = H.txs(r.asset)
    const U = o.utxos.length, T = o.txids.length, MAX = H.wallet.configWallet.WALLET_MAX_TX_HISTORY
    const todoUtxo = c.kind === 'p2pkh' ? 'legacy P2PKH UTXOs dropped by the getAddressFull_Blockbook_v3 UTXO filter (core-fixes branch)'
        : stress ? 'no per-socket Blockbook request limiter: busy addresses lose UTXOs/txs to timeouts and the socket drops' : undefined
    const todoHist = stress ? todoUtxo : undefined

    await check(`${label}: balance == mempool.space and > 0`, async () => {
        assert.deepStrictEqual(r.errors, [], 'fetch errors')
        assert.deepStrictEqual(bal.fetchErrors, [], 'address fetchError')
        assert.ok(o.a.confirmed > 0n, `oracle balance ${o.a.confirmed}`)
        assert.strictEqual(bal.conf, o.a.confirmed.toString(), 'confirmed sats')
        assert.strictEqual(bal.unconf, o.a.unconfirmed.toString(), 'unconfirmed sats')
        return `${bal.conf} sats (${bal.display} BTC) in ${r.ms}ms`
    })
    await check(`${label}: utxos == mempool.space /utxo (txid:vout:value; nulldata ignored)`, async () => {
        const w = (ad.utxos || []).filter(u => !(u.scriptPubKey && u.scriptPubKey.type === 'nulldata')).map(u => `${u.txid}:${u.vout}:${u.satoshis}`).sort()
        assert.deepStrictEqual(w, o.utxos, `wallet utxos ${JSON.stringify((ad.utxos || []).map(u => `${u.vout}/${u.scriptPubKey && u.scriptPubKey.type}/${u.satoshis}`))}`)
        return `${w.length} utxos`
    }, { todo: todoUtxo })
    await check(`${label}: no OP_RETURN / 0-sat pseudo-UTXOs`, async () => {
        const bad = (ad.utxos || []).filter(u => (u.scriptPubKey && u.scriptPubKey.type === 'nulldata') || !(Number(u.satoshis) > 0))
        assert.deepStrictEqual(bad.map(u => `${u.txid}:${u.vout}/${u.scriptPubKey && u.scriptPubKey.type}/${u.satoshis}`), [])
    }, { todo: c.kind === 'p2pkh' ? 'OP_RETURN outputs added as 0-sat UTXOs by the getAddressFull_Blockbook_v3 nulldata branch (core-fixes branch)' : undefined })
    await check(`${label}: history txids == mempool.space (newest ${MAX}), every tx enriched`, async () => {
        assert.ok(T > 0, 'pinned address has history')
        assert.deepStrictEqual(txs.filter(t => t.isMinimal).map(t => t.txid), [], 'minimal (unenriched) txs')
        if (T <= MAX) {
            sortedEq(txs.map(t => t.txid), o.txids, 'txids')
            assert.strictEqual(txs.length, o.a.txCount + o.a.mempoolTxCount, 'tx count')
        } else { // capped: the newest MAX (same-block order may differ between indexers, so: count + membership)
            assert.strictEqual(txs.length, MAX, 'capped tx count')
            assert.deepStrictEqual(txs.map(t => t.txid).filter(x => !o.txids.includes(x)), [], 'wallet txs unknown to the oracle')
        }
        return `${txs.length} txs`
    }, { todo: todoHist })
    if (!stress) await check(`${label}: call budget - wallet BB ws calls for one first fetch <= 2 + U + T`, async () => {
        const n = Object.values(r.calls[c.sym] || {}).reduce((s, x) => s + x, 0)
        assert.ok(n > 0, 'no Blockbook calls counted')
        assert.ok(n <= 2 + U + T, `${n} calls > 2 + ${U} + ${T}: ${JSON.stringify(r.calls)}`)
        return `${n} calls ${JSON.stringify(r.calls[c.sym])} (U=${U}, T=${T})`
    })
    if (stress) await check(`${label}: wallet socket still open afterwards`, async () => assert.ok(H.socketOpen(c.sym), `${c.sym} socket not open`), { todo: todoHist })
}

// ---------------- ETH + ERC20 (account): one quiet holder of ETH, USDT and USDC ----------------
async function ethCases() {
    const A = P.ETH_HOLDER, MAX = H.wallet.configWallet.WALLET_MAX_TX_HISTORY
    const bb = O.blockbook('eth.trezor.io')
    try {
        const eth = H.watchAsset('ethereum', [A]), usdt = H.watchAsset('usdt', [A]), usdc = H.watchAsset('usdc', [A])
        const wallet = { owner: 'watch', assets: [eth, usdt, usdc] }

        // oracle: the newest MAX txs straight from Blockbook (with details: contract creations, tx.to, method id, token transfers)
        const ethOracle = async () => {
            const acct = await bb.account(A, { details: 'txs', pageSize: MAX })
            return { bal: await O.eth.balance(A), txs: (acct.transactions || []).map(t => {
                const to = t.vout && t.vout[0] && t.vout[0].addresses && t.vout[0].addresses[0]
                const es = t.ethereumSpecific || {}
                const method = (es.data && es.data.slice(0, 10)) || (es.parsedData && es.parsedData.methodId) || ''
                return { txid: t.txid.toLowerCase(), created: !to, to: (to || '').toLowerCase(), method: method.toLowerCase(),
                    confirmed: t.blockHeight > 0,
                    tokens: (t.tokenTransfers || []).map(x => ({ c: (x.contract || x.token || '').toLowerCase(), from: (x.from || '').toLowerCase(), to: (x.to || '').toLowerCase(),
                        type: x.type || x.standard, value: x.value })) }
            }) }
        }
        let r, o
        try {
            const s = await O.stableRead(ethOracle, () => H.fetchAsset(wallet, eth))
            r = s.value; o = s.oracle
        } catch (e) { return skip(`watch ETH ${A}: fetch`, e.message) }
        const bal = H.balance(r.asset), txs = H.txs(r.asset)
        const wTxids = txs.map(t => t.txid.toLowerCase())
        const created = o.txs.filter(t => t.created).map(t => t.txid)
        const T = o.txs.length

        await check(`watch ETH ${A}: balance == publicnode eth_getBalance and > 0`, async () => {
            assert.deepStrictEqual(r.errors, [], 'fetch errors')
            assert.deepStrictEqual(bal.fetchErrors, [], 'address fetchError')
            assert.ok(o.bal > 0n, 'oracle balance > 0')
            assert.strictEqual(bal.conf, o.bal.toString(), 'wei')
            return `${bal.conf} wei (${bal.display} ETH), fetch ${Math.round(r.ms / 1000)}s`
        })
        await check(`watch ETH ${A}: history == newest ${MAX} Blockbook txids incl. contract creations, every tx enriched, no duplicates`, async () => {
            assert.deepStrictEqual(txs.filter(t => t.isMinimal).map(t => t.txid), [], 'minimal (unenriched) txs')
            // independent confirmation that the "created" ones really are contract creations (to == null on the node)
            for (const h of created) assert.strictEqual((await O.eth.rpc('eth_getTransactionByHash', [h])).to, null, `${h} to == null`)
            assert.strictEqual(new Set(wTxids).size, wTxids.length, 'duplicate txs')
            sortedEq(wTxids, o.txs.map(t => t.txid), `wallet ${wTxids.length} vs Blockbook ${T}; missing ${o.txs.map(t => t.txid).filter(x => !wTxids.includes(x))}`)
            const wCreated = txs.filter(t => t.isContractCreation).map(t => t.txid.toLowerCase())
            sortedEq(wCreated, created, 'isContractCreation flags')
            return `${wTxids.length} txs (${created.length} contract creations in the window)`
        })
        await check(`watch ETH ${A}: first fetch well within the harness window (< 60s), Blockbook calls <= 2 + T (one getTransaction per tx)`, async () => {
            assert.ok(r.ms < 60000, `ETH first fetch took ${r.ms}ms`)
            const c = r.calls.ETH || {}, n = Object.values(c).reduce((s, x) => s + x, 0)
            assert.ok((c.getTransaction || 0) <= T, `getTransaction ${c.getTransaction} > ${T}`)
            assert.ok(n <= 2 + T, `${n} calls > 2 + ${T}: ${JSON.stringify(c)}`)
            return `${r.ms}ms, ${n} calls ${JSON.stringify(c)} (T=${T})`
        })

        // ERC20 history: every tx among the newest MAX address txids whose Blockbook tokenTransfers move a non-zero amount of
        // that token's contract (configExternal.erc20Contracts) to or from us - direct transfer() calls, router deliveries
        // (transferFrom), mints. Zero-value transfers (address poisoning) are excluded by design. Value and direction must be
        // the net token flow for us. The ERC20 fetch must reuse the ETH fetch's Blockbook data (no getTransaction per tx again).
        const BigNumber = require(`${H.REPO}/node_modules/bignumber.js`)
        for (const sym of ['USDT', 'USDC']) {
            const asset = sym === 'USDT' ? usdt : usdc, token = O.TOKENS[sym]
            assert.strictEqual(H.wallet.configExternal.erc20Contracts[sym].toLowerCase(), token, `${sym}: wallet erc20Contracts == oracle contract`)
            const oracle = async () => ({ node: await O.eth.erc20Balance(token, A), bb: (await bb.tokenBalances(A, { [sym]: token })).tokens[sym] })
            let rt, ot
            try {
                const s = await O.stableRead(oracle, () => H.fetchAsset(wallet, asset))
                rt = s.value; ot = s.oracle
            } catch (e) { skip(`watch ${sym} ${A}: fetch`, e.message); continue }
            const b = H.balance(rt.asset), t = H.txs(rt.asset)
            await check(`watch ${sym} ${A}: balance == eth_call balanceOf == Blockbook tokenBalances, > 0`, async () => {
                assert.deepStrictEqual(rt.errors, [], 'fetch errors')
                assert.deepStrictEqual(b.fetchErrors, [], 'address fetchError')
                assert.ok(ot.node > 0n, 'oracle balance > 0')
                assert.strictEqual(ot.bb, ot.node, 'Blockbook tokenBalances vs node balanceOf')
                assert.strictEqual(b.conf, ot.node.toString(), 'wallet vs node (base units)')
                return `${b.conf} base units (${b.display} ${sym}), fetch ${rt.ms}ms`
            })
            const me = A.toLowerCase()
            const netOf = x => x.tokens.filter(tt => tt.c === token && (tt.type === undefined || tt.type === 'ERC20') && tt.value !== undefined)
                .reduce((s, tt) => s + (tt.to === me ? BigInt(tt.value) : 0n) - (tt.from === me ? BigInt(tt.value) : 0n), 0n)
            const moved = x => x.tokens.some(tt => tt.c === token && (tt.from === me || tt.to === me) && tt.value !== undefined && BigInt(tt.value) > 0n)
            const expect = o.txs.filter(moved)
            const poisoned = o.txs.filter(x => !moved(x) && x.tokens.some(tt => tt.c === token && (tt.from === me || tt.to === me))).length
            const direct = expect.filter(x => x.to === token && x.method === '0xa9059cbb').length
            await check(`watch ${sym} ${A}: history == Blockbook ${sym} tokenTransfers to/from us among the newest ${MAX} txids (net value + direction), enriched`, async () => {
                assert.deepStrictEqual(t.filter(x => x.erc20 !== sym).map(x => `${x.txid}:${x.erc20}`), [], `non-${sym} txs`)
                assert.deepStrictEqual(t.filter(x => x.isMinimal).map(x => x.txid), [], 'minimal (unenriched) txs')
                assert.ok(expect.length > 0, `pinned holder needs >= 1 ${sym} transfer in its newest ${MAX} txs`)
                sortedEq(t.map(x => x.txid.toLowerCase()), expect.map(x => x.txid), 'txids')
                const dec = rt.asset.decimals
                for (const x of expect) {
                    const w = t.find(y => y.txid.toLowerCase() === x.txid), net = netOf(x)
                    const wNet = BigInt(new BigNumber(w.value).times(new BigNumber(10).pow(dec)).toFixed()) * (w.isIncoming ? 1n : -1n)
                    if (!w.sendToSelf) assert.strictEqual(wNet, net, `${x.txid}: wallet ${w.isIncoming ? '+' : '-'}${w.value} vs Blockbook net ${net}`)
                }
                return `${t.length} ${sym} txs (${direct} direct transfer(), ${t.length - direct} via routers/mints/other contracts; ${poisoned} zero-value poisoning txs excluded)`
            })
            await check(`watch ${sym} ${A}: reuses the ETH fetch's Blockbook data (no getTransaction for already-fetched confirmed txs)`, async () => {
                const c = rt.calls.ETH || {}
                const fresh = o.txs.filter(x => !x.confirmed).length // unconfirmed txs are re-queried on every refresh (by design)
                assert.ok((c.getTransaction || 0) <= fresh, `getTransaction ${c.getTransaction} > unconfirmed ${fresh}: ${JSON.stringify(c)}`)
                return JSON.stringify(c)
            })
        }
    } finally { bb.close() }
}

;(async () => {
    let code = 0
    const t0 = Date.now()
    try {
        const syms = ONLY === 'ETH' ? ['ETH'] : ONLY === 'BTC' ? ['BTC', 'BTC_SEG', 'BTC_SEG2'] : ['BTC', 'BTC_SEG', 'BTC_SEG2', 'ETH']
        out(`MAINNET watch (READ-ONLY): opening the wallet's Blockbook sockets ${syms.join(', ')} ...`)
        await H.start(syms)
        out(`  sockets open after ${Date.now() - t0}ms; WALLET_MAX_TX_HISTORY=${H.wallet.configWallet.WALLET_MAX_TX_HISTORY}`)
        if (ONLY !== 'ETH') for (const c of P.BTC) await btcCase(c)
        if (ONLY !== 'BTC') await ethCases()
        if (process.env.LEAN_WATCH_STRESS && ONLY !== 'ETH') await btcCase({ sym: 'BTC_SEG', metaKey: 'btc(s)', kind: 'p2sh-stress', addr: P.BTC_STRESS_P2SH }, { stress: true })
    } catch (e) {
        results.push({ name: 'harness', status: 'FAIL', err: e.message }); out(`✖ FAIL harness: ${e.stack || e.message}`)
    } finally {
        await H.stop()
    }
    const n = s => results.filter(r => r.status === s).length
    out(`\nMAINNET watch summary: ${n('PASS')} pass, ${n('FAIL')} fail, ${n('TODO')} todo (known bugs), ${n('XPASS')} xpass - ${Math.round((Date.now() - t0) / 1000)}s`)
    out(`wallet Blockbook ws calls: ${JSON.stringify(H.calls)}`)
    if (n('FAIL')) {
        code = 1
        if (!VERBOSE) out(`--- last wallet log lines ---\n${walletLog.slice(-40).join('\n').slice(-6000)}`)
    }
    process.exit(code)
})()
