// Lean regression: many wallet loads in ONE process must all complete (jest hung on the 12th: walletConnect took a stray
// BLOCKBOOK_ISOSOCKETS_DONE from leaked reconnect timers and never resolved). Read-only, no sends. ~3-5 min.
// Run: node --experimental-worker tests/lean/wallet-reload.node14.js [loads=15]
const fs = require('fs'), os = require('os'), path = require('path')
const REPO = path.resolve(__dirname, '../..')
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'scpx-lean-reload-')))
const appStore = require(`${REPO}/store`).store
const svrWorkers = require(`${REPO}/svr-workers`)
const svrWalletCreate = require(`${REPO}/svr-wallet/sw-create`)
const env = {}; for (const l of fs.readFileSync(process.env.E2E_ENV || path.join(os.homedir(), '.config/scpx-wallet/e2e.env'), 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const N = Number(process.argv[2] || 15)
;(async () => {
    global.loadedWallet = {}; global.loadedServerWallet = {}
    await svrWorkers.init(appStore)
    let fails = 0
    for (let i = 1; i <= N; i++) {
        const mpk = i % 3 === 0 ? undefined : (i % 2 ? env.E2E_MPK_A : env.E2E_MPK_B)    // mix of A, B and brand-new wallets
        const t0 = Date.now()
        const r = await Promise.race([
            mpk ? svrWalletCreate.walletInit(global.appWorker, appStore, { mpk }) : svrWalletCreate.walletNew(global.appWorker, appStore),
            new Promise(res => setTimeout(() => res({ timeout: true }), 60000))])
        const ok = r && r.ok && r.ok.walletConnect && r.ok.walletConnect.ok
        if (!ok) fails++
        console.log(`  ${ok ? '✔' : '✖'} load ${i}/${N} (${mpk ? (mpk === env.E2E_MPK_A ? 'A' : 'B') : 'new'}) ${Date.now() - t0}ms${r && r.timeout ? ' - TIMEOUT (hang)' : ''}`)
    }
    console.log(`wallet-reload: ${N - fails}/${N} loads completed`)
    await svrWorkers.terminate()
    fs.rmSync(process.cwd(), { recursive: true, force: true })
    process.exit(fails ? 1 : 0)
})()
