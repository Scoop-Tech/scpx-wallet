// Independent MAINNET oracles for the lean tests - strictly READ-ONLY (nothing here can sign or broadcast).
// CommonJS + node core only (https, ws from the repo), so the Node 14 in-process watch harness and the
// Node 22 node:test files (via createRequire) share one implementation.
//
//   httpJson(url, opts)      throttled per host + retried (Trezor/mempool.space 503/429 on bursts, Blockchair 402/430/429)
//   mempool.*                mempool.space REST (BTC; not a Blockbook, CORS *)
//   eth.*                    publicnode JSON-RPC (ETH balance, ERC20 balanceOf via eth_call)
//   blockchair.*             Blockchair REST (ZEC)
//   blockbook(host)          a separate Blockbook websocket client (ws module + User-Agent: eth.trezor.io 403s
//                            without one), with an in-flight cap (Trezor drops the socket at ~64 heavy requests)
//   stableRead(oracle, read) compare only when the oracle reads the same before and after (a block may land between)
'use strict'
const https = require('https')
const WS = require('ws')

const UA = 'Mozilla/5.0'
const PUBLICNODE = 'https://ethereum-rpc.publicnode.com'
const PUBLICNODE_WS = 'wss://ethereum-rpc.publicnode.com'
const MEMPOOL = 'https://mempool.space/api'
const BLOCKCHAIR = 'https://api.blockchair.com'
const TOKENS = { // mainnet ERC20 contracts the wallet supports (6 decimals)
    USDT: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    USDC: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ---------------- HTTP: per-host throttle + retry ----------------
const MIN_GAP_MS = { 'mempool.space': 350, 'api.blockchair.com': 2500 } // default 50ms
const RETRY_STATUS = [402, 408, 425, 429, 430, 500, 502, 503, 504]       // Blockchair uses 402/430 for rate limits
const nextSlot = {}
async function throttle(host) {
    const gap = MIN_GAP_MS[host] || 50, now = Date.now(), at = Math.max(now, nextSlot[host] || 0)
    nextSlot[host] = at + gap
    if (at > now) await sleep(at - now)
}

function httpOnce(url, { method = 'GET', body, headers = {}, timeoutMs = 30000 } = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(url)
        const data = body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
        const req = https.request({ hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method,
            headers: Object.assign({ 'User-Agent': UA, Accept: 'application/json' },
                data !== undefined ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}, headers),
            timeout: timeoutMs }, res => {
            let s = ''
            res.setEncoding('utf8')
            res.on('data', c => { s += c })
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: s }))
        })
        req.on('timeout', () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)))
        req.on('error', reject)
        if (data !== undefined) req.write(data)
        req.end()
    })
}

async function httpJson(url, opts = {}) {
    const host = new URL(url).hostname, tries = opts.tries || 6
    for (let i = 0; ; i++) {
        await throttle(host)
        let r, err
        try { r = await httpOnce(url, opts) } catch (e) { err = e }
        if (r && r.status >= 200 && r.status < 300) {
            try { return JSON.parse(r.text) } catch (e) { return r.text } // mempool.space tip/height is plain text
        }
        const retryable = err || RETRY_STATUS.includes(r.status)
        if (!retryable || i >= tries - 1) throw new Error(`${opts.method || 'GET'} ${url}: ${err ? err.message : `HTTP ${r.status} ${r.text.slice(0, 120)}`}`)
        const ra = r && Number(r.headers['retry-after'])
        await sleep(ra > 0 ? Math.min(ra, 30) * 1000 : 1000 * Math.pow(2, i))
    }
}

// ---------------- BTC: mempool.space ----------------
const mempool = {
    tipHeight: async () => Number(await httpJson(`${MEMPOOL}/blocks/tip/height`)),
    // { confirmed, unconfirmed (BigInt sats), txCount (confirmed), mempoolTxCount }
    address: async a => {
        const r = await httpJson(`${MEMPOOL}/address/${a}`)
        if (r.address !== a) throw new Error(`mempool.space answered for ${r.address}, asked ${a}`)
        const c = r.chain_stats, m = r.mempool_stats
        return { confirmed: BigInt(c.funded_txo_sum) - BigInt(c.spent_txo_sum), unconfirmed: BigInt(m.funded_txo_sum) - BigInt(m.spent_txo_sum),
            txCount: c.tx_count, mempoolTxCount: m.tx_count }
    },
    // ['txid:vout:value', ...] sorted
    utxos: async a => (await httpJson(`${MEMPOOL}/address/${a}/utxo`)).map(u => `${u.txid}:${u.vout}:${u.value}`).sort(),
    // newest first: mempool txs, then confirmed (25/page via /txs/chain/:last_seen)
    txids: async (a, max = 1000) => {
        const first = await httpJson(`${MEMPOOL}/address/${a}/txs`)
        const out = first.map(t => t.txid)
        let conf = first.filter(t => t.status && t.status.confirmed)
        while (conf.length === 25 && out.length < max) {
            const page = await httpJson(`${MEMPOOL}/address/${a}/txs/chain/${conf[conf.length - 1].txid}`)
            page.forEach(t => out.push(t.txid))
            conf = page
        }
        return out.slice(0, max)
    },
}

// ---------------- ETH: publicnode JSON-RPC ----------------
let rpcId = 0
async function ethRpc(method, params = [], url = PUBLICNODE) {
    const j = await httpJson(url, { method: 'POST', body: { jsonrpc: '2.0', id: ++rpcId, method, params } })
    if (j.error) throw new Error(`${url} ${method}: ${JSON.stringify(j.error)}`)
    return j.result
}
const eth = {
    rpc: ethRpc,
    blockNumber: async () => Number(BigInt(await ethRpc('eth_blockNumber'))),
    chainId: async () => Number(BigInt(await ethRpc('eth_chainId'))),
    balance: async a => BigInt(await ethRpc('eth_getBalance', [a, 'latest'])),
    erc20Balance: async (token, holder) => BigInt(await ethRpc('eth_call', [{ to: token, data: '0x70a08231' + holder.slice(2).toLowerCase().padStart(64, '0') }, 'latest'])),
    // the wallet's web3 websocket provider (geth_ws_config ETH) - one-shot JSON-RPC over ws
    wsRpc: (method, params = [], url = PUBLICNODE_WS, timeoutMs = 30000) => new Promise((resolve, reject) => {
        const ws = new WS(url, { headers: { 'User-Agent': UA } })
        const t = setTimeout(() => { ws.terminate(); reject(new Error(`${url} ${method}: timeout`)) }, timeoutMs)
        ws.on('open', () => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })))
        ws.on('message', m => { clearTimeout(t); ws.close(); const j = JSON.parse(m); j.error ? reject(new Error(JSON.stringify(j.error))) : resolve(j.result) })
        ws.on('error', e => { clearTimeout(t); reject(e) })
    }),
}

// ---------------- ZEC: Blockchair ----------------
const blockchair = {
    zecTipHeight: async () => Number((await httpJson(`${BLOCKCHAIR}/zcash/stats`)).data.best_block_height),
    // { balance (BigInt zats), received, spent, txCount, txids (newest first, up to limit), state (Blockchair tip) }
    zecAddress: async (a, limit = 100) => {
        const j = await httpJson(`${BLOCKCHAIR}/zcash/dashboards/address/${a}?limit=${limit},0`)
        const d = j.data && j.data[a]
        if (!d) throw new Error(`blockchair: no data for ${a} (keys ${Object.keys(j.data || {})})`)
        return { balance: BigInt(d.address.balance), received: BigInt(d.address.received), spent: BigInt(d.address.spent),
            txCount: d.address.transaction_count, txids: d.transactions.map(t => (typeof t === 'string' ? t : t.hash)), state: j.context && j.context.state }
    },
}

// ---------------- Blockbook websocket client (oracle side; NOT the wallet's) ----------------
// Every reply is checked for an API error; account queries also assert data.address === the queried address
// (Blockbook silently converts e.g. a ZEC testnet t-address to its mainnet twin and answers for that).
// Trezor closes idle websockets (e.g. while a slow wallet fetch runs): a call on a closed client opens a new connection.
function blockbook(host, { maxInFlight = 4, timeoutMs = 30000, openTimeoutMs = 60000 } = {}) {
    const url = `wss://${host}/websocket`
    let id = 0, inFlight = 0, conn, stopped = false
    const pend = {}, queue = []

    function connect() {
        const ws = new WS(url, { headers: { 'User-Agent': UA, Origin: `https://${host}` } })
        const c = { ws, open: false }
        c.ready = new Promise((resolve, reject) => {
            const t = setTimeout(() => { reject(new Error(`${host}: websocket open timeout ${openTimeoutMs}ms`)); try { ws.terminate() } catch (e) {} }, openTimeoutMs)
            ws.on('open', () => { clearTimeout(t); c.open = true; resolve(); pump() })
            ws.on('error', e => { clearTimeout(t); reject(new Error(`${host}: ${e.message}`)) })
        })
        ws.on('message', m => {
            let j; try { j = JSON.parse(m) } catch (e) { return }
            const p = pend[j.id]; if (!p) return
            delete pend[j.id]; clearTimeout(p.t); inFlight--
            const e = j.data && j.data.error
            if (e) p.reject(new Error(`${host} ${p.method}: ${typeof e === 'string' ? e : e.message}`))
            else p.resolve(j.data)
            pump()
        })
        ws.on('close', code => {
            c.open = false
            if (conn === c) conn = undefined
            // requests in flight on this connection are lost: fail them; queued ones go out on the next connection
            for (const k of Object.keys(pend)) if (pend[k].c === c) { clearTimeout(pend[k].t); inFlight--; pend[k].reject(new Error(`${host}: socket closed (${code})`)); delete pend[k] }
            if (queue.length && !stopped) ensure()
        })
        return c
    }
    function ensure() {
        if (!conn) {
            const c = conn = connect()
            c.ready.catch(e => { if (conn === c) conn = undefined; while (queue.length) queue.shift().reject(e) })
        }
    }
    function pump() {
        const c = conn
        if (!c || !c.open) return
        while (inFlight < maxInFlight && queue.length) {
            const q = queue.shift(), i = String(id++)
            inFlight++
            q.c = c
            q.t = setTimeout(() => { if (pend[i]) { delete pend[i]; inFlight--; pump(); q.reject(new Error(`${host} ${q.method}: timeout ${timeoutMs}ms`)) } }, timeoutMs)
            pend[i] = q
            c.ws.send(JSON.stringify({ id: i, method: q.method, params: q.params }))
        }
    }
    const call = (method, params = {}) => new Promise((resolve, reject) => {
        if (stopped) return reject(new Error(`${host}: client closed`))
        queue.push({ method, params, resolve, reject })
        ensure()
        pump()
    })
    const account = async (descriptor, params = {}) => {
        const r = await call('getAccountInfo', Object.assign({ descriptor, details: 'basic' }, params))
        // ETH hex addresses are case-insensitive (Blockbook answers EIP-55 checksummed); everything else must match exactly
        const same = /^0x[0-9a-f]{40}$/i.test(descriptor) ? String(r.address).toLowerCase() === descriptor.toLowerCase() : r.address === descriptor
        if (!same) throw new Error(`${host}: Blockbook answered for ${r.address}, asked ${descriptor}`)
        return r
    }
    return {
        host, call, account,
        info: () => call('getInfo'),
        txids: async (descriptor, pageSize = 1000) => (await account(descriptor, { details: 'txids', pageSize })).txids || [],
        utxos: async descriptor => (await call('getAccountUtxo', { descriptor })).map(u => `${u.txid}:${u.vout}:${u.value}`).sort(),
        // { USDT: BigInt, ... } for the contracts given (other tokens - spam with the same symbol - are ignored)
        tokenBalances: async (descriptor, contracts) => {
            const r = await account(descriptor, { details: 'tokenBalances' }), out = {}
            for (const [sym, c] of Object.entries(contracts)) {
                const t = (r.tokens || []).find(x => (x.contract || '').toLowerCase() === c.toLowerCase())
                out[sym] = t ? BigInt(t.balance) : 0n
            }
            return { balance: BigInt(r.balance), tokens: out, raw: r }
        },
        close: () => { stopped = true; if (conn) { try { conn.ws.close() } catch (e) {} } },
        drop: () => { if (conn) conn.ws.terminate() }, // simulate a server-side close (self-check of the reconnect path)
    }
}

// ---------------- moving targets ----------------
// Read the oracle, run `read` (e.g. the wallet fetch), read the oracle again; only when both oracle reads agree is
// the pair comparable. Retries a few times, then gives up with an error (never a silent pass).
const keyOf = v => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? x.toString() : x))
async function stableRead(oracle, read, { tries = 3, pauseMs = 5000 } = {}) {
    for (let i = 1; i <= tries; i++) {
        const before = await oracle(), value = await read(), after = await oracle()
        if (keyOf(before) === keyOf(after)) return { oracle: after, value, tries: i }
        if (i < tries) await sleep(pauseMs)
    }
    throw new Error(`oracle kept moving across ${tries} attempts - no stable window to compare in`)
}

// display units -> BigInt base units ('1.5', 8 -> 150000000n)
function units(s, dp) {
    const str = String(s), neg = str.startsWith('-'), [i, f = ''] = str.replace('-', '').split('.')
    const v = BigInt(i || '0') * (10n ** BigInt(dp)) + BigInt((f + '0'.repeat(dp)).slice(0, dp) || '0')
    return neg ? -v : v
}

module.exports = { UA, PUBLICNODE, PUBLICNODE_WS, MEMPOOL, TOKENS, sleep, httpJson, mempool, eth, blockchair, blockbook, stableRead, units, keyOf }
