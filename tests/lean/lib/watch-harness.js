// In-process WATCH harness (Node 14, READ-ONLY): drives the wallet's OWN per-address fetch -> parse -> reduce ->
// balance code for arbitrary PUBLIC mainnet addresses. No MPK, no keys, no store, no worker threads, no tx push.
//
// What runs is the production code path of worker.js refreshAssetsFull, minus worker messaging:
//   workerExternal.getAddressFull_External (Blockbook websocket for UTXO assets; publicnode web3 + Blockbook for ETH/ERC20)
//   -> the same WCORE_SET_ADDRESS_FULL / WCORE_SET_ENRICHED_TXS merge as worker.js mergeDispatchActions
//   -> reducers/wallet -> walletExternal.get_combinedBalance / getAll_txs (what wallet-dump and the UI read)
// A watched asset is built exactly as actions/wallet.js does for "known" non-standard addresses
// (walletShared.newWalletAddressFromPrivKey({ knownAddr })), so no key material ever exists.
//
// Not covered here (covered by mainnet-readonly.test.mjs, MPK-driven): worker_threads messaging, the redux store,
// mempool_get_BB_txs, sw-functions dump formatting, fee quotes / UTXO selection (need keys).
//
// Usage:
//   const H = require('./lib/watch-harness')
//   await H.start(['BTC_SEG2', 'ETH'])                  // temp cwd, wallet globals, open the wallet's own BB sockets
//   const asset = H.watchAsset('btc(s2)', ['bc1q...'])
//   const r = await H.fetchAsset({ owner: 'watch', assets: [asset] }, asset)  // -> { asset, errors, acts, calls, ms }
//   H.balance(r.asset), H.txs(r.asset)
//   await H.stop()                                       // close sockets, chdir back, delete the temp dir (wallet logs)
'use strict'
const path = require('path')
const fs = require('fs')
const os = require('os')

const REPO = path.resolve(__dirname, '../../..')
const state = { dir: undefined, cwd: undefined, started: false, syms: [] }
let W // wallet modules (required only after chdir: winston writes its log files to the cwd)
const calls = {} // outbound wallet Blockbook websocket calls: { SYM: { method: n } }

function requireWallet() {
    // worker modules expect a worker global scope: run them in-process with self = global
    global.self = global
    Object.assign(global, {
        bb_Sockets: {}, bb_Sockets_messageID: {}, bb_Sockets_pendingMessages: {}, bb_Sockets_subscriptions: {},
        bb_Sockets_subId_NewBlock: {}, bb_Sockets_keepAliveIntervalID: {}, web3_Sockets: {}, geth_Sockets: {},
        blocks_time: {}, blocks_tps: {}, blocks_height: {}, workerId: 'lean-watch',
    })
    global.window = global
    global.postMessage = () => {}
    global.txdb_dirty = require(path.join(REPO, 'node_modules/dirty'))() // in-memory tx cache: no scp_tx.db file
    return {
        configWallet: require(path.join(REPO, 'config/wallet')),
        configExternal: require(path.join(REPO, 'config/wallet-external')),
        workerBlockbook: require(path.join(REPO, 'app-worker/worker-blockbook')),
        workerExternal: require(path.join(REPO, 'app-worker/worker-external')),
        walletShared: require(path.join(REPO, 'actions/wallet-shared')),
        walletExternal: require(path.join(REPO, 'actions/wallet-external')),
        walletReducer: require(path.join(REPO, 'reducers/wallet')),
        utilsWallet: require(path.join(REPO, 'utils')),
    }
}

function waitOpen(syms, timeoutMs) {
    const isOpen = s => self.bb_Sockets[s] && self.bb_Sockets[s].readyState === 1
    return new Promise((resolve, reject) => {
        const t0 = Date.now()
        const iv = setInterval(() => {
            if (syms.every(isOpen)) { clearInterval(iv); resolve() }
            else if (Date.now() - t0 > timeoutMs) { clearInterval(iv); reject(new Error(`wallet Blockbook sockets not open after ${timeoutMs}ms: ${syms.filter(s => !isOpen(s))}`)) }
        }, 100)
    })
}

// count every request the wallet sends on its own Blockbook sockets (wraps ws.send once per socket)
function countCalls(syms) {
    for (const s of syms) {
        const ws = self.bb_Sockets[s]
        if (!ws || ws.__leanCounted) continue
        const send = ws.send.bind(ws)
        calls[s] = calls[s] || {}
        ws.send = m => { try { const k = JSON.parse(m).method; calls[s][k] = (calls[s][k] || 0) + 1 } catch (e) {} return send(m) }
        ws.__leanCounted = true
    }
}

// syms: wallet symbols whose Blockbook sockets to open (config/websockets.js blockbook_ws_config keys)
async function start(syms, { openTimeoutMs = 90000 } = {}) {
    if (state.started) throw new Error('watch harness already started')
    state.cwd = process.cwd()
    state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scpx-lean-watch-'))
    process.chdir(state.dir)
    state.started = true
    state.syms = syms
    W = requireWallet()
    W.workerBlockbook.isosocket_Setup_Blockbook(() => {}, () => {}, true /* loaderWorker: no UI callbacks / block subs */, syms)
    await waitOpen(syms, openTimeoutMs)
    countCalls(syms)
    return W
}

async function stop() {
    if (!state.started) return
    state.started = false
    try {
        for (const s of Object.keys(self.bb_Sockets || {})) {
            if (self.bb_Sockets_keepAliveIntervalID && self.bb_Sockets_keepAliveIntervalID[s]) clearInterval(self.bb_Sockets_keepAliveIntervalID[s])
            const ws = self.bb_Sockets[s]
            if (ws) { ws.onclose = null; ws.onerror = null; try { ws.close() } catch (e) {} }
        }
    } finally {
        process.chdir(state.cwd)
        // the wallet's winston logs live only in the temp dir: delete them (no keys exist here, but keep the hygiene rule)
        try { fs.rmdirSync(state.dir, { recursive: true }) } catch (e) {}
    }
}

// a displayable asset exactly as actions/wallet.js displayableWalletAssets() builds it, holding known (watch) addresses
function watchAsset(metaKey, addrs) {
    const meta = W.configWallet.walletsMeta[metaKey]
    if (!meta) throw new Error(`unknown walletsMeta key ${metaKey}`)
    const addresses = addrs.map((a, i) => W.walletShared.newWalletAddressFromPrivKey({
        assetName: metaKey, accountName: 'watch', key: { path: `~w/${i}` }, knownAddr: a, symbol: meta.symbol }))
    return Object.assign({ addresses, local_txs: [] }, meta)
}

// same merge as app-worker/worker.js mergeDispatchActions (an inner function there, not exported)
function merge(asset, acts) {
    const full = acts.filter(p => p.type === 'WCORE_SET_ADDRESS_FULL'), enr = acts.filter(p => p.type === 'WCORE_SET_ENRICHED_TXS')
    const out = acts.filter(p => p.type !== 'WCORE_SET_ADDRESS_FULL' && p.type !== 'WCORE_SET_ENRICHED_TXS')
    if (full.length) out.push({ type: 'WCORE_SET_ADDRESSES_FULL_MULTI', payload: { newAddresses: full.map(p => p.payload.newAddr), symbol: asset.symbol, updateAt: new Date() } })
    if (enr.length) out.push({ type: 'WCORE_SET_ENRICHED_TXS_MULTI', payload: { addrTxs: enr.map(p => ({ addr: p.payload.addr, txs: p.payload.txs, res: p.payload.res })), symbol: asset.symbol, updateAt: new Date() } })
    return out
}

const snapshot = () => JSON.parse(JSON.stringify(calls))
const diffCalls = (a, b) => {
    const out = {}
    for (const s of Object.keys(b)) for (const m of Object.keys(b[s])) {
        const n = b[s][m] - ((a[s] && a[s][m]) || 0)
        if (n) { out[s] = out[s] || {}; out[s][m] = n }
    }
    return out
}

// one full refresh of every address of `asset` (as worker.js refreshAssetsFull), reduced into wallet state.
// Resolves { asset (reduced), errors [], acts [types], calls (BB ws calls made during this fetch), ms }
function fetchAsset(wallet, asset, { timeoutMs = 10 * 60000 } = {}) {
    const t0 = Date.now(), before = snapshot()
    const work = Promise.all(asset.addresses.map((a, addrNdx) => new Promise(res =>
        W.workerExternal.getAddressFull_External({ wallet, asset, addrNdx }, r => res(r)))))
    .then(results => {
        const errors = results.filter(r => r.error).map(r => r.error)
        const acts = merge(asset, [].concat.apply([], results.map(r => r.dispatchActions || [])))
        let st = { assets: wallet.assets, owner: wallet.owner }
        for (const a of acts) st = W.walletReducer(st, a)
        const reduced = st.assets.find(p => p.symbol === asset.symbol)
        // keep the wallet object current (ETH and its ERC20s share it, as in the real worker)
        wallet.assets = st.assets
        return { asset: reduced, errors, acts: acts.map(a => a.type), calls: diffCalls(before, snapshot()), ms: Date.now() - t0 }
    })
    let timer
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`fetchAsset ${asset.symbol} timed out after ${timeoutMs}ms`)), timeoutMs) })
    return Promise.race([work, timeout]).then(r => { clearTimeout(timer); return r }, e => { clearTimeout(timer); throw e })
}

// { conf, unconf } as base-unit strings, from the wallet's own get_combinedBalance (all addresses)
function balance(asset) {
    const b = W.walletExternal.get_combinedBalance(asset)
    return { conf: b.conf.toFixed(), unconf: b.unconf.toFixed(), display: W.utilsWallet.toDisplayUnit(b.conf, asset),
        fetchErrors: asset.addresses.map(a => a.fetchError).filter(Boolean) }
}
const txs = asset => W.walletExternal.getAll_txs(asset)
const socketOpen = sym => !!(self.bb_Sockets[sym] && self.bb_Sockets[sym].readyState === 1)

module.exports = { REPO, start, stop, watchAsset, fetchAsset, balance, txs, socketOpen, calls, get wallet() { return W } }
