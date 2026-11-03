// Lean MAINNET check - strictly READ-ONLY (nothing is signed or broadcast; the harness refuses mainnet sends anyway).
// Real wallet process (sw-cli, MPK-driven wallet A) on mainnet backends: Trezor public Blockbooks (btc2/btc3/eth) + publicnode.
// The end-to-end startup / connection / fee / safety-guard check for BTC_SEG (p2sh-p2wpkh), BTC_SEG2 (p2wpkh), ETH, USDT, USDC.
// Wallet A is unfunded on mainnet, so balances here are 0 == 0: REAL non-zero mainnet data is proven by
// mainnet-backends.test.mjs (backends vs oracles) and mainnet-watch.node14.js (the wallet's own code on funded addresses).
// Oracles: mempool.space (BTC balance + txids), publicnode (ETH balance, ERC20 balanceOf), a separate Blockbook
// websocket (ETH txids, tokenBalances). Not the Trezor REST API: it 503s on bursts.
// Run: node --test tests/lean/mainnet-readonly.test.mjs
import { test as baseTest } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { Wallet, loadEnv } from '../e2e/lib/wallet.mjs'

const require = createRequire(import.meta.url)
const O = require('./lib/oracles.js')
const test = (name, fn) => baseTest(name, { timeout: 5 * 60000 }, fn)
const MAX_TX_HISTORY = 100 // config/wallet.js WALLET_MAX_TX_HISTORY: the wallet lists the newest 100 txs per address
const env = loadEnv()
const A = new Wallet('A-main', env.E2E_MPK_A, 26121)
const ethBB = O.blockbook('eth.trezor.io')

test('MAINNET read-only on the ported wallet', async t => {
    try {
        await t.test('startup + connected', async () => {
            await A.start()
            const r = await A.rpc('wallet-balance', {})
            assert.ok(!r.err, r.err)
        })
        for (const sym of ['BTC_SEG', 'BTC_SEG2']) {
            await t.test(`${sym}: balance + history == mempool.space`, async tt => {
                const d = await A.dump(sym)
                assert.ok(d.addresses.length > 0)
                const w = new Set((d.all_txs || []).map(x => x.txid)), o = new Set()
                for (const a of d.addresses) {
                    const [bal, txids] = [await O.mempool.address(a.addr), await O.mempool.txids(a.addr, MAX_TX_HISTORY)]
                    assert.equal(O.units(a.du_balConf, 8), bal.confirmed, `${a.addr} confirmed`)
                    assert.equal(O.units(a.du_balUnconf, 8), bal.unconfirmed, `${a.addr} unconfirmed`)
                    txids.forEach(x => o.add(x))
                }
                assert.deepEqual([...w].sort(), [...o].sort())
                tt.diagnostic(`${sym}: ${d.addresses.length} addresses, ${w.size} txs, balance ${d.addresses.reduce((s, a) => s + O.units(a.du_balConf, 8), 0n)} sats`)
            })
            await t.test(`${sym}: fee quote sane (mainnet sat/vB)`, async tt => {
                const r = await A.rpc('tx-get-fee', { symbol: sym, value: '0.00001' })
                // an unfunded wallet may legitimately refuse to quote (no UTXOs) - accept either a sane quote or that refusal
                if (r.err) { assert.match(r.err, /insufficient|utxo|balance/i, r.err); tt.diagnostic(`${sym}: quote refused (${r.err})`) }
                else assert.ok(Number(r.ok.txFee.fee) > 0 && Number(r.ok.txFee.utxo_satPerKB) > 0, JSON.stringify(r.ok.txFee))
            })
        }
        await t.test('ETH: balance == publicnode; history == newest Blockbook txids (websocket)', async tt => {
            const d = await A.dump('ETH'), addr = d.addresses[0].addr
            assert.equal(O.units(d.addresses[0].du_balConf, 18) + O.units(d.addresses[0].du_balUnconf, 18), await O.eth.balance(addr))
            const o = (await ethBB.txids(addr, MAX_TX_HISTORY)).map(x => x.toLowerCase())
            assert.deepEqual((d.all_txs || []).map(x => x.txid.toLowerCase()).sort(), o.sort())
            tt.diagnostic(`ETH: ${o.length} txs, balance ${d.addresses[0].du_balConf} ETH`)
        })
        for (const sym of ['USDT', 'USDC']) {
            await t.test(`${sym} (ERC20): balance == publicnode balanceOf == Blockbook tokenBalances`, async tt => {
                const d = await A.dump(sym), addr = d.addresses[0].addr
                const [onChain, bb] = [await O.eth.erc20Balance(O.TOKENS[sym], addr), await ethBB.tokenBalances(addr, { [sym]: O.TOKENS[sym] })]
                assert.equal(O.units(d.addresses[0].du_balConf, 6) + O.units(d.addresses[0].du_balUnconf, 6), onChain)
                assert.equal(bb.tokens[sym], onChain, 'Blockbook tokenBalances')
                tt.diagnostic(`${sym}: ${(d.all_txs || []).length} txs, balance ${onChain} base units`)
            })
        }
        await t.test('ETH + USDC: fee quotes sane (gas from the mainnet node)', async () => {
            for (const sym of ['ETH', 'USDC']) {
                const r = await A.rpc('tx-get-fee', { symbol: sym, value: '0.000001' })
                assert.ok(!r.err, `${sym}: ${r.err}`)
                assert.ok(Number(r.ok.txFee.eth_gasLimit) > 0 && Number(r.ok.txFee.eth_gasPrice) > 0, `${sym}: ${JSON.stringify(r.ok.txFee)}`)
            }
        })
        await t.test('safety: harness refuses any mainnet send', async () => {
            for (const symbol of ['BTC_SEG', 'BTC_SEG2', 'ETH', 'USDC', 'USDT']) await assert.rejects(A.rpc('tx-push', { symbol, value: '0.00001', to: 'x' }), /TEST SAFETY GUARD/)
        })
        await t.test('hygiene: no socket.io connections to Blockbook', async () => {
            assert.equal((A.fileLogs().match(/BLOCKBOOK WS .* - IO - connected/g) || []).length, 0)
        })
    } finally { ethBB.close(); await A.stop() }
})
