// Lean wallet-level test: Sepolia ERC20s USDT_TEST / USDC_TEST (Aave v3 test tokens), black-box via the wallet's RPC.
// Oracles: Sepolia node eth_call balanceOf (publicnode) + Trezor Sepolia Blockbook websocket tokenBalances.
// Sends 0.01 of each token A -> B (B starts as a FRESH holder: proves the ERC20 gas fix - a transfer to a new holder needs ~142k gas
// on Sepolia, above the static 120000), then B -> A so nothing drifts (B ends empty again). Gas is paid in ETH_TEST.
// Also: no silent false zero (Sepolia RPC made unreachable -> the dump reports fetch errors, never "0"), and ZEC mainnet read-only.
// Testnet sends only (harness guard). Wallet A needs USDT_TEST/USDC_TEST: tests/lean/tools/sepolia-faucet-mint.node14.js --broadcast
// Run: node --test tests/lean/sepolia-erc20.test.mjs        (LEAN_NO_SEND=1: read-only parts only)
import { test as baseTest } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { Wallet, loadEnv, sleep, REPO } from '../e2e/lib/wallet.mjs'

const require = createRequire(`${REPO}/package.json`)
const WebSocket = require('ws')
const test = (name, fn) => baseTest(name, { timeout: 15 * 60000 }, fn)
const RPC = 'https://ethereum-sepolia-rpc.publicnode.com', BB_WS = 'wss://sepolia.trezor.io/websocket', ZEC_BB_WS = 'wss://zec1.trezor.io/websocket'
const TOKENS = { USDT_TEST: '0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0', USDC_TEST: '0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8' }
const DP = 6, SEND = '0.01', STATIC_GAS = 120000n
const NO_SEND = process.env.LEAN_NO_SEND === '1'
const env = loadEnv()
// A opts in to the INTERIM read-only ZEC asset (config INTERIM_ASSETS); B runs with the default = core set only
const A = new Wallet('A-erc20', env.E2E_MPK_A, 26150, { env: { WALLET_INTERIM_ASSETS: 'zcash' } }), B = new Wallet('B-erc20', env.E2E_MPK_B, 26151)
const CORE_ASSETS = ['btc(s)', 'btc(s2)', 'btc(t)', 'btc(ts2)', 'ethereum', 'eth(t)', 'usdt', 'usdc', 'usdt(t)', 'usdc(t)'] // walletsMeta keys
// fault injection: Sepolia RPC (http + ws) resolves to 127.0.0.1 -> connection refused (tests/e2e/lib/net-harness.cjs)
const A_DOWN = new Wallet('A-rpcdown', env.E2E_MPK_A, 26152, { preloadEnv: { E2E_DNS_MAP: 'ethereum-sepolia-rpc.publicnode.com=127.0.0.1' } })

const rpc = async (method, params) => {
    for (let i = 0; ; i++) {
        try {
            const j = await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()
            if (j.error) throw new Error(`${method}: ${j.error.message}`)
            return j.result
        } catch (e) { if (i >= 4) throw e; await sleep(1500) }
    }
}
const hexBlock = n => '0x' + BigInt(n).toString(16)
const erc20Bal = async (token, holder, block = 'latest') => BigInt(await rpc('eth_call', [{ to: token, data: '0x70a08231' + holder.slice(2).toLowerCase().padStart(64, '0') }, block]))
const ethBal = async (addr, block = 'latest') => BigInt(await rpc('eth_getBalance', [addr, block]))
// decimal string (incl. exponent form, e.g. BigNumber's '5.8e-12') -> integer base units
const units = (s, dp) => {
    const m = String(s).match(/^(-?)(\d*)(?:\.(\d*))?(?:e([-+]?\d+))?$/i)
    if (!m) throw new Error(`not a decimal: ${s}`)
    const digits = (m[2] || '0') + (m[3] || ''), shift = BigInt(dp) - BigInt((m[3] || '').length) + BigInt(m[4] || 0)
    const v = shift >= 0n ? BigInt(digits) * 10n ** shift : BigInt(digits) / 10n ** -shift
    return m[1] ? -v : v
}
const waitUntil = async (fn, ms, every = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn().catch(() => undefined); if (v) return v; await sleep(every) } }

// one-shot Blockbook websocket request (ws module with UA/Origin: Trezor refuses header-less clients)
function bbWs(url, method, params) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url, { headers: { 'User-Agent': 'Mozilla/5.0', Origin: url.replace('wss://', 'https://').replace('/websocket', '') } })
        const to = setTimeout(() => { ws.terminate(); reject(new Error(`${url} ${method}: timeout`)) }, 30000)
        ws.on('open', () => ws.send(JSON.stringify({ id: '1', method, params })))
        ws.on('message', m => { clearTimeout(to); ws.close(); const j = JSON.parse(m); j.data && j.data.error ? reject(new Error(j.data.error.message)) : resolve(j.data) })
        ws.on('error', e => { clearTimeout(to); reject(e) })
    })
}
const bbTokenBal = async (holder, token) => {
    const d = await bbWs(BB_WS, 'getAccountInfo', { descriptor: holder, details: 'tokenBalances' })
    const t = (d.tokens || []).find(x => (x.contract || '').toLowerCase() === token.toLowerCase())
    return BigInt(t ? t.balance : 0)
}
const walletBal = async (w, sym) => { const a = (await w.dump(sym)).addresses[0]; return units(a.du_balConf, DP) + units(a.du_balUnconf, DP) }
const findTx = async (w, sym, txid) => { const d = await w.dump(sym); return [...(d.all_txs || []), ...(d.local_txs || []), ...(d.unconfirmed_txs || [])].find(x => x.txid.toLowerCase() === txid.toLowerCase()) }

let addrA, addrB
const feeQuote = {}

// sends `sym` from wallet `from` to `toAddr`, asserts it on-chain (status 1, token deltas exact, gas paid in ETH) and in `rx`'s history
async function sendAndVerify(tt, sym, from, fromAddr, rx, toAddr, { expectFreshHolder }) {
    const token = TOKENS[sym], value = units(SEND, DP)
    const rxHeldBefore = await erc20Bal(token, toAddr)
    if (expectFreshHolder) tt.diagnostic(`${sym}: receiver ${rxHeldBefore === 0n ? 'is a FRESH holder (0 balance)' : `already holds ${rxHeldBefore}`}`)
    const r = await from.rpc('tx-push', { symbol: sym, value: SEND, to: toAddr, from: fromAddr })
    assert.ok(r.ok && r.ok.txid, r.err || JSON.stringify(r))
    const txid = r.ok.txid
    const tx = await waitUntil(() => rpc('eth_getTransactionByHash', [txid]), 90000)
    assert.ok(tx, 'node knows the tx')
    assert.equal(tx.to.toLowerCase(), token.toLowerCase(), 'tx calls the token contract')
    assert.equal(BigInt(tx.value), 0n, 'no ETH value moved')
    assert.equal(BigInt(tx.chainId || '0x0'), 11155111n, 'signed for Sepolia')
    assert.ok(tx.input.toLowerCase().startsWith('0xa9059cbb' + toAddr.slice(2).toLowerCase().padStart(64, '0')), 'transfer(to, value) calldata')
    const rc = await waitUntil(() => rpc('eth_getTransactionReceipt', [txid]), 240000)
    assert.ok(rc && rc.status === '0x1', `mined OK: ${JSON.stringify(rc && rc.status)}`)
    const gasUsed = BigInt(rc.gasUsed), gasLimit = BigInt(tx.gas), blk = BigInt(rc.blockNumber)
    tt.diagnostic(`${sym} ${txid}: block ${blk} gasUsed ${gasUsed} gasLimit ${gasLimit}`)
    if (expectFreshHolder && rxHeldBefore === 0n) {
        assert.ok(gasUsed > STATIC_GAS, `transfer to a fresh holder used ${gasUsed} gas: would have reverted with the old static ${STATIC_GAS}`)
    }
    assert.ok(gasLimit > gasUsed, 'gas limit had headroom')
    // token balances move by exactly `value` in that block (node state at blk-1 vs blk)
    assert.equal(await erc20Bal(token, fromAddr, hexBlock(blk)) - await erc20Bal(token, fromAddr, hexBlock(blk - 1n)), -value, 'sender token delta')
    assert.equal(await erc20Bal(token, toAddr, hexBlock(blk)) - await erc20Bal(token, toAddr, hexBlock(blk - 1n)), value, 'receiver token delta')
    // gas paid in ETH_TEST by the sender: exact when this is the sender's only tx in the block
    const fee = gasUsed * BigInt(rc.effectiveGasPrice || tx.gasPrice)
    const ethDelta = await ethBal(fromAddr, hexBlock(blk - 1n)) - await ethBal(fromAddr, hexBlock(blk))
    const block = await rpc('eth_getBlockByNumber', [hexBlock(blk), true])
    const own = block.transactions.filter(x => [x.from, x.to].map(a => (a || '').toLowerCase()).includes(fromAddr.toLowerCase()))
    if (own.length === 1) assert.equal(ethDelta, fee, 'sender ETH_TEST paid exactly the gas fee')
    else assert.ok(ethDelta >= fee, `sender ETH_TEST paid at least the gas fee (${own.length} own txs in block)`)
    // wallets: receiver history shows it as an incoming erc20 tx; both wallet balances == node
    const rxTx = await waitUntil(() => findTx(rx, sym, txid), 180000)
    assert.ok(rxTx, `${rx.name} sees the tx in ${sym} history`)
    assert.equal(rxTx.erc20, sym, 'mapped as an erc20 tx of the right token')
    assert.equal(rxTx.isIncoming, true)
    const sxTx = await waitUntil(() => findTx(from, sym, txid), 120000)
    assert.ok(sxTx && sxTx.erc20 === sym && sxTx.isIncoming === false, `${from.name} sees its outgoing ${sym} tx`)
    for (const [w, a] of [[from, fromAddr], [rx, toAddr]]) {
        const ok = await waitUntil(async () => (await walletBal(w, sym)) === await erc20Bal(token, a), 180000)
        assert.ok(ok, `${w.name} ${sym} wallet balance == node balanceOf`)
    }
    return txid
}

test('Sepolia ERC20 USDT_TEST / USDC_TEST on the wallet', async t => {
    try {
        await t.test('startup A: USDT_TEST + USDC_TEST loaded (same address as ETH_TEST), fetch-healthy', async () => {
            await A.start()
            addrA = (await A.dump('ETH_TEST')).addresses[0].addr
            for (const sym of Object.keys(TOKENS)) {
                const d = await A.dump(sym)
                assert.equal(d.addresses[0].addr.toLowerCase(), addrA.toLowerCase(), `${sym} uses the ETH_TEST address`)
                assert.equal(d.fetchError, undefined, `${sym} fetchError: ${d.fetchError}`)
                assert.equal(d.hasAddressErrors, false)
                assert.equal(d.allAddressesFetched, true)
            }
        })
        await t.test('balances: wallet == node eth_call balanceOf == Blockbook tokenBalances', async tt => {
            for (const [sym, token] of Object.entries(TOKENS)) {
                const w = await walletBal(A, sym), node = await erc20Bal(token, addrA), bb = await bbTokenBal(addrA, token)
                assert.equal(w, node, `${sym} wallet vs node`)
                assert.equal(bb, node, `${sym} Blockbook vs node`)
                tt.diagnostic(`${sym}: A holds ${node} base units`)
                if (!NO_SEND) assert.ok(node >= units(SEND, DP), `${sym}: wallet A needs >= ${SEND} (mint: tests/lean/tools/sepolia-faucet-mint.node14.js --broadcast)`)
            }
        })
        await t.test('fee quotes: gas priced in ETH_TEST, new-holder estimate above the static 120000', async tt => {
            for (const sym of Object.keys(TOKENS)) {
                const r = await A.rpc('tx-get-fee', { symbol: sym, value: SEND })
                assert.ok(!r.err, `${sym}: ${r.err}`)
                const f = r.ok.txFee, gasLimit = BigInt(f.eth_gasLimit), gasPrice = BigInt(f.eth_gasPrice)
                assert.ok(gasLimit >= STATIC_GAS && gasPrice > 0n, JSON.stringify(f))
                // A holds the token, so the quote is a real estimate of a transfer to a NEW holder (~142k * 1.25), not the static floor
                assert.ok(gasLimit > STATIC_GAS, `${sym}: quote ${gasLimit} is the static floor - the new-holder estimate didn't run`)
                assert.equal(units(f.fee, 18), gasLimit * gasPrice, 'fee = gasLimit x gasPrice (in ETH)')
                feeQuote[sym] = f
                tt.diagnostic(`${sym}: eth_gasLimit ${gasLimit} @ ${gasPrice} wei = ${f.fee} ETH_TEST`)
            }
        })
        await t.test('ZEC mainnet READ-ONLY (INTERIM, opted in): loaded, balance + history == Blockbook zec1, sends refused', async tt => {
            const d = await A.dump('ZEC')
            assert.equal(d.isReadOnly, true)
            assert.equal(d.fetchError, undefined, d.fetchError)
            const a = d.addresses[0]
            assert.match(a.addr, /^t1/)
            const o = await bbWs(ZEC_BB_WS, 'getAccountInfo', { descriptor: a.addr, details: 'txids' })
            assert.equal(o.address, a.addr)
            assert.equal(units(a.du_balConf, 8) + units(a.du_balUnconf, 8), BigInt(o.balance) + BigInt(o.unconfirmedBalance || 0))
            assert.deepEqual((d.all_txs || []).map(x => x.txid).sort(), (o.txids || []).slice().sort())
            const fee = await A.rpc('tx-get-fee', { symbol: 'ZEC', value: '0.001' })
            assert.match(String(fee.err), /read-only/, `tx-get-fee ZEC must be refused: ${JSON.stringify(fee)}`)
            await assert.rejects(A.rpc('tx-push', { symbol: 'ZEC', value: '0.001', to: a.addr }), /TEST SAFETY GUARD: refusing tx-push for read-only/)
            tt.diagnostic(`ZEC ${a.addr}: balance ${a.du_balConf}, ${(o.txids || []).length} txs`)
        })
        await t.test('default wallet (B, no opt-in) loads exactly the CORE set: BTC, ETH, USDT, USDC (+ testnets); no ZEC / TUSD', async () => {
            await B.start()
            const r = await B.rpc('wallet-dump', { keys: 'false', txs: 'false' })
            const names = (Array.isArray(r.ok) ? r.ok : [r.ok]).filter(x => x && x.assetName).map(x => x.assetName).sort()
            assert.deepEqual(names, [...CORE_ASSETS].sort(), `loaded: ${names.join(',')}`)
        })
        if (NO_SEND) return
        await t.test(`A -> B ${SEND} USDT_TEST and USDC_TEST (B fresh holder): status 1, balances move, gas in ETH_TEST, in B's history`, async tt => {
            if (B.proc === undefined) await B.start()
            addrB = (await B.dump('ETH_TEST')).addresses[0].addr
            for (const sym of Object.keys(TOKENS)) await sendAndVerify(tt, sym, A, addrA, B, addrB, { expectFreshHolder: true })
        })
        await t.test(`B -> A ${SEND} USDT_TEST and USDC_TEST back (no drift)`, async tt => {
            const ethB = await ethBal(addrB)
            tt.diagnostic(`B SepETH for gas: ${ethB} wei`)
            for (const sym of Object.keys(TOKENS)) await sendAndVerify(tt, sym, B, addrB, A, addrA, { expectFreshHolder: false })
        })
    } finally { await A.stop(); await B.stop() }
})

test('no silent false zero: Sepolia RPC unreachable -> ETH_TEST/USDT_TEST/USDC_TEST report fetch errors, never "0"', async t => {
    try {
        await A_DOWN.start({ readyTimeoutMs: 240000 })
        for (const sym of ['ETH_TEST', ...Object.keys(TOKENS)]) {
            await t.test(`${sym}: dump + balance flag the outage`, async tt => {
                const d = await A_DOWN.dump(sym)
                const a = d.addresses[0]
                assert.ok(d.fetchError && /refused|ECONNREFUSED|connect|fetch/i.test(d.fetchError), `${sym} dump.fetchError: ${JSON.stringify(d.fetchError)}`)
                assert.equal(d.hasAddressErrors, true)
                assert.ok(a.fetchError, `${sym} address fetchError`)
                assert.equal(a.du_balConf, null, `${sym} address balance must be unknown (null), not ${JSON.stringify(a.du_balConf)}`)
                assert.equal(d.du_balConf, null, `${sym} asset balance must be unknown (null), not ${JSON.stringify(d.du_balConf)}`)
                const b = await A_DOWN.rpc('wallet-balance', { symbol: sym })
                assert.ok(!b.err, b.err)
                const row = b.ok.balances.find(x => x.symbol === sym)
                assert.ok(row && row.fetchError && row.conf === null, `wallet-balance ${sym}: ${JSON.stringify(row)}`)
                assert.ok(b.ok.fetchErrors.some(x => x.symbol === sym), 'listed in fetchErrors')
                tt.diagnostic(`${sym}: ${d.fetchError.slice(0, 160)}`)
            })
        }
        await t.test('control: unaffected assets (BTC_TEST) stay healthy', async () => {
            // (PROTECT_OP addresses added by the post-load non-std scan read null until their first fetch lands: wait for it)
            const d = await waitUntil(async () => { const x = await A_DOWN.dump('BTC_TEST'); return x.du_balConf !== null ? x : undefined }, 120000)
            assert.ok(d, 'BTC_TEST balance known')
            assert.equal(d.hasAddressErrors, false, d.fetchError)
            assert.equal(d.allAddressesFetched, true)
        })
    } finally { await A_DOWN.stop() }
})
