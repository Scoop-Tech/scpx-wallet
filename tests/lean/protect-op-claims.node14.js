// Lean PROTECT_OP claims (slow tier, in-process, Node 14): spend P2SH{DSIG/CLTV} outputs made by earlier runs
// of protect-op.node14.js, and verify each spend INDEPENDENTLY from the raw tx on Blockbook.
//   1. beneficiary (B) claims every output whose CLTV lock has passed median-time-past (IF branch, nLockTime >= lock)
//   2. benefactor (A) reclaims ONE output that is still locked (ELSE branch, no lock) - the rest are left to mature for B
// Benefactor = testnets4 (A), beneficiary = e2e wallet B. Testnet only. Steps with nothing to spend are reported as skipped.
// Regression for the MTP fix: claimable_List used to gate the beneficiary on WALL-CLOCK time, but CLTV finality is
//   lockTime < median-time-past. testnet4 MTP runs AHEAD of real time (seen +50 min..+2h) -> outputs hidden too long;
//   mainnet MTP lags ~1h -> outputs listed too early, claim rejected as non-final. The wallet now uses MTP.
// Run: node --experimental-worker tests/lean/protect-op-claims.node14.js
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert')
const REPO = path.resolve(__dirname, '../..')
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'scpx-lean-claims-')))   // wallet logs/db land here, deleted at the end
const BigNumber = require(`${REPO}/node_modules/bignumber.js`)
const bitcoinJsLib = require(`${REPO}/node_modules/bitcoinjs-lib`)
const axios = require(`${REPO}/node_modules/axios`)
const appStore = require(`${REPO}/store`).store
const svrWorkers = require(`${REPO}/svr-workers`)
const svrWalletCreate = require(`${REPO}/svr-wallet/sw-create`)
const svrRouter = require(`${REPO}/svr-wallet/sw-router`)

const env = {}; for (const l of fs.readFileSync(process.env.E2E_ENV || path.join(os.homedir(), '.config/scpx-wallet/e2e.env'), 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const BB = 'https://x-btc-testnet.d0m1.com:10009/api/v2', NET = bitcoinJsLib.networks.testnet, UA = { headers: { 'User-Agent': 'Mozilla/5.0' } }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const bb = async p => (await axios.get(`${BB}/${p}`, UA)).data
const results = []
async function step(name, fn) { const t0 = Date.now(); try { const note = await fn(); results.push([note && note.skip ? '-' : '✔', name, Date.now() - t0, note && note.msg]) } catch (e) { results.push(['✖', name, Date.now() - t0, e.message]); throw e } }

async function init(mpk) { const r = await svrWalletCreate.walletInit(global.appWorker, appStore, { mpk }); if (!r.ok) throw new Error(r.err); return r }
async function list(mpk) {   // the wallet's own view: CLAIMABLE-LIST, retried while the wallet finishes syncing
    for (let i = 0; i < 20; i++) { const r = await svrRouter.fn(global.appWorker, appStore, { mpk, symbol: 'BTC_TEST' }, 'CLAIMABLE-LIST'); if (r.ok) return r.ok.claimable; await sleep(3000) }
    throw new Error('CLAIMABLE-LIST never succeeded')
}
async function medianTimePast() {   // BIP113: CLTV is checked against the median of the last 11 block times
    const tip = (await bb('')).blockbook.bestHeight, times = []
    for (let h = tip; h > tip - 11; h--) times.push((await bb(`block/${h}`)).time)   // independent oracle (REST), not the wallet's code
    return times.sort((a, b) => a - b)[5]
}
async function spend(mpk, outputs) {   // same call CLAIMABLE-CLAIM makes, restricted to the chosen outputs
    const spendFullUtxos = outputs.map(p => `${p.protect_op_tx.txid}:${p.utxos[0].vout}`).join(',')
    const sum = outputs.reduce((s, p) => s.plus(p.utxos[0].satoshis), new BigNumber(0))
    const to = appStore.getState().wallet.assets.find(a => a.symbol === 'BTC_TEST').addresses[0].addr
    const r = await svrRouter.fn(global.appWorker, appStore, { mpk, symbol: 'BTC_TEST', value: sum.div(1e8).toString(), to, spendFullUtxos }, 'TX-PUSH')
    assert.ok(r.ok && r.ok.txid, r.err || JSON.stringify(r).slice(0, 300))
    for (let i = 0; i < 20; i++) { try { return await bb(`tx/${r.ok.txid}`) } catch (e) { await sleep(3000) } }
    throw new Error(`Blockbook never saw claim tx ${r.ok.txid}`)
}
// independent check of a claim tx: every chosen P2SH input is spent with the expected branch of the redeem script
function verifySpend(bbTx, outputs, branch /* 'IF' beneficiary | 'ELSE' benefactor */) {
    const tx = bitcoinJsLib.Transaction.fromHex(bbTx.hex)
    for (const o of outputs) {
        const i = tx.ins.findIndex(x => Buffer.from(x.hash).reverse().toString('hex') === o.protect_op_tx.txid && x.index === o.utxos[0].vout)
        assert.ok(i >= 0, `claim spends ${o.protect_op_tx.txid}:${o.utxos[0].vout}`)
        const chunks = bitcoinJsLib.script.decompile(tx.ins[i].script), redeem = chunks[chunks.length - 1], sel = chunks[chunks.length - 2]
        const asm = bitcoinJsLib.script.toASM(redeem)
        assert.ok(/^OP_IF \S+ OP_CHECKLOCKTIMEVERIFY OP_DROP [0-9a-f]{66} OP_CHECKSIG OP_ELSE [0-9a-f]{66} OP_CHECKSIG OP_ENDIF$/.test(asm), `redeem script shape: ${asm}`)
        const p2sh = bitcoinJsLib.payments.p2sh({ redeem: { output: redeem, network: NET }, network: NET }).address
        assert.equal(p2sh, o.addr, 'redeem script hashes to the spent P2SH address')
        const isIf = sel === bitcoinJsLib.opcodes.OP_TRUE || (Buffer.isBuffer(sel) && sel.length === 1 && sel[0] === 1)
        const isElse = sel === bitcoinJsLib.opcodes.OP_FALSE || (Buffer.isBuffer(sel) && sel.length === 0)
        assert.ok(branch === 'IF' ? isIf : isElse, `${branch} branch selector`)
        if (branch === 'IF') {
            const lock = bitcoinJsLib.script.number.decode(bitcoinJsLib.script.decompile(redeem)[1])
            assert.ok(tx.locktime >= lock, `nLockTime ${tx.locktime} >= CLTV ${lock}`)
            assert.ok(tx.ins[i].sequence < 0xffffffff, 'input sequence enables nLockTime')
        }
    }
    return tx
}

;(async () => {
    global.loadedWallet = {}; global.loadedServerWallet = {}
    await svrWorkers.init(appStore)
    let mtp
    try {
        await step('beneficiary (B) CLAIMABLE-CLAIM: wallet lists outputs final by median-time-past and claims them (IF branch)', async () => {
            mtp = await medianTimePast()
            await init(env.E2E_MPK_B)
            const r = await (async () => { for (let i = 0; i < 20; i++) { const x = await svrRouter.fn(global.appWorker, appStore, { mpk: env.E2E_MPK_B, symbol: 'BTC_TEST' }, 'CLAIMABLE-LIST'); if (x.ok) return x.ok; await sleep(3000) } })()
            assert.ok(r, 'CLAIMABLE-LIST')
            assert.ok(Math.abs(r.medianTimePast - mtp) <= 1200, `wallet MTP ${r.medianTimePast} ~ oracle MTP ${mtp}`)   // a new block may land in between
            const listed = r.claimable.filter(p => p.protect_op_tx.p_op_weAreBeneficiary && p.utxos[0].satoshis > 0)
            for (const p of listed) assert.ok(Number(p.protect_op_tx.p_op_lockTime) < r.medianTimePast, `listed output ${p.protect_op_tx.txid} is final by MTP`)
            if (!listed.length) return { skip: true, msg: `nothing final yet (MTP ${mtp} = ${new Date(mtp * 1000).toISOString()}) - run again later` }
            const claim = await svrRouter.fn(global.appWorker, appStore, { mpk: env.E2E_MPK_B, symbol: 'BTC_TEST' }, 'CLAIMABLE-CLAIM')
            assert.ok(claim.ok && claim.ok.txPush && claim.ok.txPush.ok && claim.ok.txPush.ok.txid, claim.err || JSON.stringify(claim.ok && claim.ok.txPush).slice(0, 300))
            let bbTx
            for (let i = 0; i < 20 && !bbTx; i++) { try { bbTx = await bb(`tx/${claim.ok.txPush.ok.txid}`) } catch (e) { await sleep(3000) } }
            assert.ok(bbTx, 'Blockbook sees the claim tx (accepted by the node = CLTV/nLockTime final)')
            const tx = verifySpend(bbTx, listed, 'IF')
            return { msg: `claimed ${listed.length} output(s) in ${tx.getId()}` }
        })
        await step('benefactor (A) reclaims one still-locked PROTECT_OP (ELSE branch)', async () => {
            await init(env.E2E_MPK_A)
            const locked = (await list(env.E2E_MPK_A))
                .filter(p => p.protect_op_tx.p_op_weAreBenefactor && p.utxos[0].satoshis > 0 && Number(p.protect_op_tx.p_op_lockTime) >= mtp)   // not yet final by MTP
                .sort((a, b) => Number(b.protect_op_tx.p_op_lockTime) - Number(a.protect_op_tx.p_op_lockTime))
            // each lean run creates one output: reclaim only when another stays locked, so the beneficiary always has one maturing
            if (locked.length < 2) return { skip: true, msg: `${locked.length} still-locked output(s) - kept for the beneficiary (need 2 to reclaim one)` }
            const one = [locked[0]]   // newest; older ones are left to mature for the beneficiary
            const tx = verifySpend(await spend(env.E2E_MPK_A, one), one, 'ELSE')
            return { msg: `reclaimed ${one[0].protect_op_tx.txid.slice(0, 12)}... in ${tx.getId()}` }
        })
    } catch (e) { /* recorded */ }
    finally {
        console.log('\nPROTECT_OP claims lean')
        for (const r of results) console.log(`  ${r[0]} ${r[1]} (${r[2]}ms)${r[3] ? ' - ' + r[3] : ''}`)
        await svrWorkers.terminate()
        fs.rmSync(process.cwd(), { recursive: true, force: true })   // wallet logs contain key material
        process.exit(results.some(r => r[0] === '✖') ? 1 : 0)
    }
})()
