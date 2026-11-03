// Lean PROTECT_OP check (in-process, Node 14 - same runtime as the wallet): create a minimum P2SH{DSIG/CLTV} output
// and verify it INDEPENDENTLY from Blockbook (OP_RETURN decode + redeem-script reconstruction -> P2SH address match).
// Benefactor = testnets4 (A), beneficiary = e2e wallet B. Testnet only. ~1 min.
// Run: node --experimental-worker tests/lean/protect-op.node14.js
// (Claims are slow - they need confirmations / the CLTV lock - and are covered by the jest suite.)
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert')
const REPO = path.resolve(__dirname, '../..')
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'scpx-lean-pop-')))   // wallet logs/db land here, deleted at the end
const BigNumber = require(`${REPO}/node_modules/bignumber.js`)
const bitcoinJsLib = require(`${REPO}/node_modules/bitcoinjs-lib`)
const axios = require(`${REPO}/node_modules/axios`)
const appStore = require(`${REPO}/store`).store
const svrWorkers = require(`${REPO}/svr-workers`)
const svrWalletCreate = require(`${REPO}/svr-wallet/sw-create`)
const svrRouter = require(`${REPO}/svr-wallet/sw-router`)
const walletP2sh = require(`${REPO}/actions/wallet-btc-p2sh`)

const env = {}; for (const l of fs.readFileSync(process.env.E2E_ENV || path.join(os.homedir(), '.config/scpx-wallet/e2e.env'), 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const BB = 'https://x-btc-testnet.d0m1.com:10009/api/v2', NET = bitcoinJsLib.networks.testnet, LOCK_HOURS = 1
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
async function step(name, fn) { const t0 = Date.now(); try { await fn(); results.push(['✔', name, Date.now() - t0]) } catch (e) { results.push(['✖', name, Date.now() - t0, e.message]); throw e } }

async function init(mpk) { const r = await svrWalletCreate.walletInit(global.appWorker, appStore, { mpk }); if (!r.ok) throw new Error(r.err); return r }
async function pubKey(mpk) {
    const dump = await svrRouter.fn(global.appWorker, appStore, { mpk, symbol: 'BTC_TEST', keys: true }, 'DUMP')
    const a = dump.ok.find(p => p.assetName === 'btc(t)')
    const k = a.accounts[0].keys.find(k => k.addr && k.addr.addr === a.addresses[0].addr)
    const pub = bitcoinJsLib.ECPair.fromWIF(k.privKey, NET).publicKey.toString('hex'); k.privKey = undefined
    return { pub, addr: a.addresses[0].addr }
}

;(async () => {
    global.loadedWallet = {}; global.loadedServerWallet = {}
    await svrWorkers.init(appStore)
    let pubA, pubB, txid, tx
    try {
        await step('derive beneficiary (B) + benefactor (A) BTC_TEST public keys', async () => {
            await init(env.E2E_MPK_B); pubB = await pubKey(env.E2E_MPK_B)
            await init(env.E2E_MPK_A); pubA = await pubKey(env.E2E_MPK_A)
        })
        await step(`create minimum PROTECT_OP (${walletP2sh.P_OP_MIN_GROSS} sats, lock ${LOCK_HOURS}h) - broadcast via websocket`, async () => {
            const value = new BigNumber(walletP2sh.P_OP_MIN_GROSS).div(1e8).toString()
            const push = await svrRouter.fn(global.appWorker, appStore, { mpk: env.E2E_MPK_A, symbol: 'BTC_TEST', value, to: pubA.addr, dsigCltvPubKey: pubB.pub, dsigLockHours: LOCK_HOURS }, 'TX-PUSH')
            assert.ok(push.ok && push.ok.txid, push.err || JSON.stringify(push).slice(0, 200))
            txid = push.ok.txid
            for (let i = 0; i < 20 && !tx; i++) { try { tx = (await axios.get(`${BB}/tx/${txid}`, { headers: { 'User-Agent': 'Mozilla/5.0' } })).data } catch (e) { await sleep(3000) } }
            assert.ok(tx, 'Blockbook sees the PROTECT_OP tx')
        })
        await step('independent structure check: 5 outputs, OP_RETURN v1 stamp + both pubkeys + lock, redeem script -> vout[0] P2SH', async () => {
            assert.equal(tx.vout.length, 5)
            assert.ok(tx.vout[1].hex.startsWith('6a4c50'), 'OP_RETURN PUSHDATA1 80')
            const d = Buffer.from(tx.vout[1].hex.slice(6), 'hex')
            assert.equal(d.slice(0, 4).toString('hex'), '481fe761')
            assert.equal(d.slice(4, 37).toString('hex'), pubB.pub)
            assert.equal(d.slice(37, 70).toString('hex'), pubA.pub)
            assert.equal(d.readUInt16BE(78), LOCK_HOURS)
            const lockTime = d.readUInt32BE(70) * 256 + d.readUInt32BE(74), now = Math.floor(Date.now() / 1000)
            assert.ok(lockTime > now && lockTime < now + 3600 * LOCK_HOURS + 600, `lockTime ${lockTime}`)
            const redeem = bitcoinJsLib.script.fromASM(`OP_IF ${bitcoinJsLib.script.number.encode(lockTime).toString('hex')} OP_CHECKLOCKTIMEVERIFY OP_DROP ${pubB.pub} OP_CHECKSIG OP_ELSE ${pubA.pub} OP_CHECKSIG OP_ENDIF`)
            const p2sh = bitcoinJsLib.payments.p2sh({ redeem: { output: redeem, network: NET }, network: NET })
            assert.equal(tx.vout[0].addresses[0], p2sh.address)
            assert.equal(Number(tx.vout[2].value), walletP2sh.P_OP_DUST)
            assert.ok(Number(tx.vout[3].value) >= walletP2sh.P_OP_DUST && Number(tx.vout[4].value) >= walletP2sh.P_OP_DUST)
        })
    } catch (e) { /* recorded */ }
    finally {
        console.log('\nPROTECT_OP lean' + (txid ? ` (txid ${txid})` : ''))
        for (const r of results) console.log(`  ${r[0]} ${r[1]} (${r[2]}ms)${r[3] ? ' - ' + r[3] : ''}`)
        await svrWorkers.terminate()
        fs.rmSync(process.cwd(), { recursive: true, force: true })   // wallet logs contain key material
        process.exit(results.some(r => r[0] === '✖') ? 1 : 0)
    }
})()
