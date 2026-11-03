// Lean wallet-level test: ETH_TEST on Sepolia (Trezor public Blockbook + publicnode RPC), black-box via the wallet's RPC.
// Minimum amounts (gwei scale). Testnet only (harness guard). Run: node --test tests/lean/eth-testnet.test.mjs
import { test as baseTest } from 'node:test'
import assert from 'node:assert/strict'
import { Wallet, loadEnv, sleep } from '../e2e/lib/wallet.mjs'

const test = (name, fn) => baseTest(name, { timeout: 10 * 60000 }, fn)
const RPC = 'https://ethereum-sepolia-rpc.publicnode.com', BB = 'https://sepolia.trezor.io/api/v2'
const FUNDING_TX = '0x6ae7b6e4cc7b'
const SELF_SEND = '0.000000001'      // 1 gwei
const A_TO_B = '0.000001'            // 1e12 wei: covers B's gas for the return send at current Sepolia prices
const B_TO_A = '0.000000001'
const env = loadEnv()
const A = new Wallet('A-eth', env.E2E_MPK_A, 25921), B = new Wallet('B-eth', env.E2E_MPK_B, 25922)

const rpc = async (method, params) => { const r = await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json(); return r.result }
const bbTxids = async a => ((await (await fetch(`${BB}/address/${a}?details=txids&pageSize=1000`, { headers: { 'User-Agent': 'Mozilla/5.0' } })).json()).txids || [])
const wei = s => { const [i, f = ''] = String(s).split('.'); return BigInt(i || '0') * 10n ** 18n + BigInt((f + '0'.repeat(18)).slice(0, 18)) }
const waitUntil = async (fn, ms, every = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn().catch(() => undefined); if (v) return v; await sleep(every) } }
const hasTx = async (w, txid) => { const d = await w.dump('ETH_TEST'); return [...(d.all_txs || []), ...(d.local_txs || []), ...(d.unconfirmed_txs || [])].some(x => x.txid.toLowerCase() === txid.toLowerCase()) }
let addrA, addrB

test('ETH_TEST (Sepolia) end-to-end on the ported wallet', async t => {
    try {
        await t.test('startup + connected (ETH_TEST balance readable over RPC)', async () => {
            await A.start()
            addrA = (await A.dump('ETH_TEST')).addresses[0].addr
            const r = await A.rpc('wallet-balance', { symbol: 'ETH_TEST' })
            assert.ok(!r.err, r.err)
        })
        await t.test('balance == Sepolia node eth_getBalance', async () => {
            const d = await A.dump('ETH_TEST')
            const node = BigInt(await rpc('eth_getBalance', [addrA, 'latest']))
            assert.equal(wei(d.addresses[0].du_balConf) + wei(d.addresses[0].du_balUnconf), node)
        })
        await t.test('history (via Blockbook websocket) includes faucet funding tx and == Trezor REST', async () => {
            const d = await A.dump('ETH_TEST'), w = new Set((d.all_txs || []).map(x => x.txid.toLowerCase()))
            assert.ok([...w].some(x => x.startsWith(FUNDING_TX)), 'funding tx in wallet history')
            const o = (await bbTxids(addrA)).map(x => x.toLowerCase())
            assert.deepEqual([...w].sort(), [...o].sort())
        })
        await t.test('fee quote sane (gas limit / price from the node)', async () => {
            const r = await A.rpc('tx-get-fee', { symbol: 'ETH_TEST', value: SELF_SEND })
            assert.ok(!r.err, r.err)
            // post-Glamsterdam a transfer is no longer a fixed 21000 gas (e.g. 12k to self, ~207k to a new account): just sanity-bound it
            assert.ok(Number(r.ok.txFee.eth_gasLimit) >= 5000 && Number(r.ok.txFee.eth_gasLimit) <= 1000000 && Number(r.ok.txFee.eth_gasPrice) > 0 && Number(r.ok.txFee.fee) > 0, JSON.stringify(r.ok.txFee))
        })
        await t.test(`self-send ${SELF_SEND} ETH: mined, status 1, chainId 11155111, nonce advanced, in wallet history`, async () => {
            const nonce0 = BigInt(await rpc('eth_getTransactionCount', [addrA, 'latest']))
            const r = await A.rpc('tx-push', { symbol: 'ETH_TEST', value: SELF_SEND, to: addrA, from: addrA })
            assert.ok(r.ok && r.ok.txid, r.err || JSON.stringify(r))
            const txid = r.ok.txid
            const tx = await waitUntil(() => rpc('eth_getTransactionByHash', [txid]), 60000)
            assert.ok(tx, 'node knows the tx')
            assert.equal(BigInt(tx.chainId || '0x0'), 11155111n, 'signed for Sepolia')
            assert.equal(BigInt(tx.nonce), nonce0)
            assert.equal(BigInt(tx.value), wei(SELF_SEND))
            const rc = await waitUntil(() => rpc('eth_getTransactionReceipt', [txid]), 180000)
            assert.ok(rc && rc.status === '0x1', `mined OK: ${JSON.stringify(rc && rc.status)}`)
            assert.ok(await waitUntil(() => hasTx(A, txid), 120000), 'wallet history shows the self-send')
        })
        await t.test(`receive: A->B ${A_TO_B} then B->A ${B_TO_A}; each wallet sees the incoming tx`, async () => {
            await B.start()
            addrB = (await B.dump('ETH_TEST')).addresses[0].addr
            const ab = await A.rpc('tx-push', { symbol: 'ETH_TEST', value: A_TO_B, to: addrB, from: addrA })
            assert.ok(ab.ok && ab.ok.txid, ab.err)
            const rc1 = await waitUntil(() => rpc('eth_getTransactionReceipt', [ab.ok.txid]), 180000)
            assert.ok(rc1 && rc1.status === '0x1', 'A->B mined')
            assert.ok(await waitUntil(() => hasTx(B, ab.ok.txid), 120000), 'B sees incoming A->B')
            await B.waitForLog(new RegExp(`addresstxid data - ETH_TEST .*${ab.ok.txid}`, 'i'), 120000)   // B's incoming-tx alert
            const ready = await waitUntil(async () => { const d = await B.dump('ETH_TEST'); return wei(d.addresses[0].du_balConf) > 0n }, 120000)
            assert.ok(ready, 'B balance updated')
            const ba = await B.rpc('tx-push', { symbol: 'ETH_TEST', value: B_TO_A, to: addrA, from: addrB })
            assert.ok(ba.ok && ba.ok.txid, ba.err)
            const rc2 = await waitUntil(() => rpc('eth_getTransactionReceipt', [ba.ok.txid]), 180000)
            assert.ok(rc2 && rc2.status === '0x1', 'B->A mined')
            assert.ok(await waitUntil(() => hasTx(A, ba.ok.txid), 120000), 'A sees incoming B->A')
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
