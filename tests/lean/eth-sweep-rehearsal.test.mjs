// Lean live test (Sepolia, minimum amounts): rehearses the mainnet ETH sweeps with the exact tool that will be used
// (tools/eth-sweep/eth-sweep.mjs), on the same shape as the real funds: an HD address at index 1 (not loaded by default)
// holding ETH + an ERC20.
//   - tx-push gas-parameter safety: mistyped names refused; ETH needs both gasPrice + gasLimit; ERC20 takes gasPrice only;
//     non-integers refused; nothing is sent
//   - A funds B's index-1 address with ETH_TEST + USDC_TEST (normal send path: its ETH send guard must pass)
//   - the tool sweeps the USDC_TEST first, then the ETH: each one dry-run by the wallet, decoded + simulated independently,
//     broadcast as the exact checked tx; afterwards B/1 holds exactly 0 ETH and 0 USDC_TEST, and A received exactly
//     the swept amounts
// Run: node --test tests/lean/eth-sweep-rehearsal.test.mjs
import { test as baseTest } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { Wallet, loadEnv, sleep, REPO } from '../e2e/lib/wallet.mjs'

const test = (name, fn) => baseTest(name, { timeout: 25 * 60000 }, fn)
const RPC = 'https://ethereum-sepolia-rpc.publicnode.com'
const USDC_TEST = '0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8'
const env = loadEnv()
const A = new Wallet('A-ethsw', env.E2E_MPK_A, 25981), B = new Wallet('B-ethsw', env.E2E_MPK_B, 25982)
const FUND_ETH = '0.003', FUND_USDC = '7.654321'

const rpc = async (method, params) => { for (let i = 0; i < 5; i++) { try { const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }); const j = await r.json(); if (!j.error) return j.result } catch (e) {} await sleep(2000) } throw new Error(method) }
const ethBal = async a => BigInt(await rpc('eth_getBalance', [a, 'latest']))
const usdcBal = async a => BigInt(await rpc('eth_call', [{ to: USDC_TEST, data: '0x70a08231' + a.slice(2).toLowerCase().padStart(64, '0') }, 'latest']))
const mined = async h => { for (let i = 0; i < 60; i++) { const r = await rpc('eth_getTransactionReceipt', [h]).catch(() => null); if (r) return r; await sleep(3000) } }
function sweep(args) {
    const r = spawnSync(process.execPath, [path.join(REPO, 'tools/eth-sweep/eth-sweep.mjs'), '--symbol', 'ETH_TEST', ...args, '--yes'],
        { env: { ...process.env, SW_MPK: env.E2E_MPK_B }, encoding: 'utf8', timeout: 10 * 60000 })
    return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

test('ETH sweep rehearsal (Sepolia): index-1 address, token then ETH, exactly 0 left', async t => {
    let a0, b1
    try {
        await Promise.all([A.start(), B.start()])
        a0 = (await A.dumpFetched('ETH_TEST')).addresses[0].addr
        await t.test('tx-push gas parameters: bad combinations refused, nothing sent', async () => {
            const cases = [
                [{ symbol: 'ETH_TEST', value: '0.0001', to: a0, from: a0, gasprice: '1' }, /Unknown parameter/],
                [{ symbol: 'ETH_TEST', value: '0.0001', to: a0, from: a0, gasPrice: '1000' }, /both be given/],
                [{ symbol: 'ETH_TEST', value: '0.0001', to: a0, from: a0, gasPrice: '1.5', gasLimit: '21000' }, /positive integer/],
                [{ symbol: 'USDC_TEST', value: '1', to: a0, from: a0, gasPrice: '1000', gasLimit: '60000' }, /only gasPrice can be given/],
                [{ symbol: 'BTC_TEST', value: '0.0001', to: 'x', gasPrice: '1000' }, /only supported for ETH and ERC20/],
            ]
            for (const [p, re] of cases) { const r = await A.rpc('tx-push', { ...p, dryRun: true }); assert.ok(r.err && re.test(r.err), `${JSON.stringify(p)} -> ${JSON.stringify(r).slice(0, 160)}`) }
        })
        await t.test('fund B/1 (ETH + USDC_TEST) via the normal send path: guard passes, amounts exact', async () => {
            if ((await B.dumpFetched('ETH_TEST')).addresses.length < 2) assert.ok(!(await B.rpc('wallet-add-address', { symbol: 'ETH_TEST' })).err)
            b1 = (await B.dumpFetched('ETH_TEST')).addresses[1].addr
            const e = await A.rpc('tx-push', { symbol: 'ETH_TEST', value: FUND_ETH, to: b1, from: a0 })
            assert.ok(e.ok && e.ok.guard && e.ok.guard.to === b1.toLowerCase() && e.ok.guard.valueWei === '3000000000000000', JSON.stringify(e).slice(0, 300))
            assert.equal((await mined(e.ok.txid)).status, '0x1')
            const u = await A.rpc('tx-push', { symbol: 'USDC_TEST', value: FUND_USDC, to: b1, from: a0 })
            assert.ok(u.ok && u.ok.guard && u.ok.guard.sentUnits === '7654321' && u.ok.guard.to === USDC_TEST.toLowerCase(), JSON.stringify(u).slice(0, 300))
            assert.equal((await mined(u.ok.txid)).status, '0x1')
        })
    } finally { await Promise.all([A.stop(), B.stop()]) }

    let tokenSwept = false
    await t.test('sweep USDC_TEST B/1 -> A with the tool: B/1 token balance 0, A +exact', async () => {
        let amt = 0n
        for (let i = 0; i < 30 && amt === 0n; i++) { amt = await usdcBal(b1); if (amt === 0n) await sleep(3000) } // load-balanced RPC can lag a block
        assert.ok(amt > 0n, 'B/1 holds USDC_TEST to sweep')
        const before = await usdcBal(a0)
        const r = sweep(['--token', 'USDC_TEST', '--from', b1, '--to', a0])
        assert.equal(r.code, 0, r.out.slice(-1500))
        assert.match(r.out, /simulated on both providers: succeeds/)
        assert.match(r.out, /status success/)
        assert.equal(await usdcBal(b1), 0n)
        assert.equal(await usdcBal(a0), before + amt)
        tokenSwept = true
    })
    await t.test('sweep ETH B/1 -> A with the tool: B/1 holds exactly 0 wei', async t2 => {
        if (!tokenSwept) { t2.skip('token sweep did not complete: keep the ETH for its gas'); return }
        const r = sweep(['--from', b1, '--to', a0])
        assert.equal(r.code, 0, r.out.slice(-1500))
        assert.match(r.out, /value \+ fee = the whole balance \(sender left with 0\)/)
        assert.match(r.out, /status success/)
        assert.equal(await ethBal(b1), 0n)
    })
})
