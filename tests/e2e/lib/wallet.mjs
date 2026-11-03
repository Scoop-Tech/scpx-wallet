// Black-box driver for scpx-wallet: runs sw-cli.js exactly like production (Node 14, RPC mode, --mpk)
// in its own temp working dir, and talks to it over the authenticated JSON-RPC interface.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import https from 'node:https'

export const TESTNET_SEND_SYMBOLS = ['BTC_TEST', 'BTC_TEST2', 'ETH_TEST', 'USDT_TEST', 'USDC_TEST'] // Sepolia ERC20s: gas in ETH_TEST
export const READ_ONLY_SYMBOLS = ['ZEC', 'ZEC_TEST']                                                 // never sent (obsolete ZEC tx builder)
export const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..')
const NODE14 = process.env.E2E_NODE14 || path.join(os.homedir(), '.nvm/versions/node/v14.21.3/bin/node')
const STRIP = /\x1b\[[0-9;]*m/g

export function loadEnv(file = process.env.E2E_ENV || path.join(os.homedir(), '.config/scpx-wallet/e2e.env')) {
    const out = {}
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
        if (m) out[m[1]] = m[2].trim()
    }
    return out
}

export class Wallet {
    static all = []
    // env: extra env for the wallet process (e.g. { WALLET_INTERIM_ASSETS: 'zcash' }); preloadEnv: fault-injection (net-harness)
    constructor(name, mpk, port, { preloadEnv = {}, env = {} } = {}) {
        Object.assign(this, { name, mpk, port, preloadEnv, extraEnv: env })
        Wallet.all.push(this)
        this.lines = []
        this.user = 'e2e'
        this.pass = crypto.randomBytes(12).toString('hex')
    }

    async start({ readyTimeoutMs = 180000 } = {}) {
        this.dir = fs.mkdtempSync(path.join(os.tmpdir(), `scpx-e2e-${this.name}-`))
        fs.symlinkSync(path.join(REPO, 'certs'), path.join(this.dir, 'certs'))
        const env = { ...process.env, ...this.extraEnv, ...this.preloadEnv }
        if (Object.keys(this.preloadEnv).length) env.NODE_OPTIONS = `--require ${path.join(REPO, 'tests/e2e/lib/net-harness.cjs')}`
        this.proc = spawn(NODE14, ['--no-deprecation', '--experimental-worker', path.join(REPO, 'sw-cli.js'),
            `--mpk=${this.mpk}`, '--rpc=true', `--rpcPort=${this.port}`, '--rpcRemoteHosts=::ffff:127.0.0.1',
            `--rpcUsername=${this.user}`, `--rpcPassword=${this.pass}`], { cwd: this.dir, env, stdio: ['pipe', 'pipe', 'pipe'] })
        const onData = buf => { for (const l of buf.toString().split('\n')) if (l.trim()) this.lines.push({ t: Date.now(), l: l.replace(STRIP, '') }) }
        this.proc.stdout.on('data', onData); this.proc.stderr.on('data', onData)
        this.startedAt = Date.now()
        await this.waitForLog(/loadAllAssets - complete/, readyTimeoutMs)
        // "loadAllAssets - complete" fires when the loads are dispatched; slow first updates (e.g. ETH/ERC20 history
        // enrichment) can still be running, and the wallet's own gate refuses balance/fee/push calls until EVERY asset has
        // had its first update ("Wallet is not connected to 3PBPs"). Wait for that gate, within the same time budget.
        if (!Object.keys(this.preloadEnv || {}).length) {   // not for fault-injection wallets (they may never connect, by design)
            for (;;) {
                const r = await this.rpc('wallet-balance', {}).catch(e => ({ err: e.message }))
                if (!(r && r.err && /not connected to 3PBPs/.test(r.err))) break
                if (Date.now() - this.startedAt > readyTimeoutMs) throw new Error(`${this.name}: wallet not connected to all backends within ${readyTimeoutMs}ms`)
                await new Promise(res => setTimeout(res, 2000))
            }
        }
        this.readyMs = Date.now() - this.startedAt
        return this
    }

    async stop() {
        if (this.proc && this.proc.exitCode === null) {
            this.proc.kill('SIGTERM')
            await new Promise(r => { this.proc.once('exit', r); setTimeout(r, 5000) })
            if (this.proc.exitCode === null) this.proc.kill('SIGKILL')
        }
        // keep log text in memory for assertions (mpk redacted), then delete: wallet logs contain the mpk (cli.mpk)
        if (this.dir && fs.existsSync(this.dir)) {
            this.savedLogs = (this.savedLogs || '') + fs.readdirSync(this.dir).filter(f => f.endsWith('.log'))
                .map(f => fs.readFileSync(path.join(this.dir, f), 'utf8')).join('\n').split(this.mpk).join('[mpk]')
            fs.rmSync(this.dir, { recursive: true, force: true })
        }
    }

    log(re) { return this.lines.filter(x => re.test(x.l)) }

    fileLogs() {
        let live = ''
        try { live = fs.readdirSync(this.dir).filter(f => f.endsWith('.log')).map(f => fs.readFileSync(path.join(this.dir, f), 'utf8')).join('\n').split(this.mpk).join('[mpk]') } catch {}
        return (this.savedLogs || '') + live
    }

    async waitForLog(re, timeoutMs, sinceT = 0) {
        const t0 = Date.now()
        while (Date.now() - t0 < timeoutMs) {
            const hit = this.lines.find(x => x.t >= sinceT && re.test(x.l))
            if (hit) return hit
            if (this.proc.exitCode !== null) throw new Error(`${this.name} wallet exited (code ${this.proc.exitCode})`)
            await sleep(250)
        }
        throw new Error(`${this.name}: timed out after ${timeoutMs}ms waiting for log ${re}`)
    }

    rpc(cmd, params = {}) {
        // HARD SAFETY GUARD: e2e may only ever move testnet coins (allow-list); read-only assets (ZEC, ZEC_TEST) are never pushed
        const sym = String(params.symbol).toUpperCase()
        if (cmd === 'tx-push' && (READ_ONLY_SYMBOLS.includes(sym) || !TESTNET_SEND_SYMBOLS.includes(sym)))
            return Promise.reject(new Error(`TEST SAFETY GUARD: refusing tx-push for ${READ_ONLY_SYMBOLS.includes(sym) ? 'read-only' : 'non-testnet'} symbol "${params.symbol}"`))
        const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'exec', params: [{ username: this.user, password: this.pass }, cmd, params] })
        return new Promise((resolve, reject) => {
            const req = https.request({ host: '127.0.0.1', port: this.port, method: 'POST', path: '/', rejectUnauthorized: false,
                headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: 120000 }, res => {
                let d = ''; res.on('data', c => d += c); res.on('end', () => {
                    try { const j = JSON.parse(d); resolve(j.error ? { err: j.error.message } : (j.result && j.result.ok !== undefined ? { ok: j.result.ok } : j.result)) }
                    catch (e) { reject(e) }
                })
            })
            req.on('error', reject); req.on('timeout', () => req.destroy(new Error('rpc timeout'))); req.end(body)
        })
    }

    // Read-only dump: addresses, balances and txs. keys:false - never private keys.
    async dump(symbol) {
        const r = await this.rpc('wallet-dump', { symbol, keys: 'false', txs: 'true' })
        if (r.err) throw new Error(`${this.name} wallet-dump ${symbol}: ${r.err}`)
        const list = Array.isArray(r.ok) ? r.ok : [r.ok]
        const a = list.find(x => x && x.addresses) || list[0]
        return a
    }

    // dump once every address has a fetched balance: the wallet reports a never-fetched balance as null (not "0"), e.g. the
    // PROTECT_OP addresses that the post-load non-std scan adds are null until their first fetch lands
    async dumpFetched(symbol, timeoutMs = 120000) {
        const t0 = Date.now()
        for (;;) {
            const d = await this.dump(symbol)
            if (d.addresses.every(a => a.du_balConf !== null && a.du_balUnconf !== null)) return d
            if (Date.now() - t0 > timeoutMs) throw new Error(`${this.name} ${symbol}: balances still not fetched after ${timeoutMs} ms (${d.fetchError || 'no fetchError'})`)
            await sleep(2000)
        }
    }
}

export const sleep = ms => new Promise(r => setTimeout(r, ms))
