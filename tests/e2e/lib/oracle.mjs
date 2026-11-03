// Independent oracles: talk to Blockbook directly (REST + websocket + legacy socket.io), never via the wallet.
import { createRequire } from 'node:module'
import { REPO } from './wallet.mjs'
const require = createRequire(import.meta.url)
const WS = require(`${REPO}/node_modules/ws`)
const io = require(`${REPO}/node_modules/socket.io-client`)

const UA = { 'User-Agent': 'Mozilla/5.0' }

export async function bbAddress(bbHost, addr) {
    const r = await fetch(`https://${bbHost}/api/v2/address/${addr}?details=txids&pageSize=1000`, { headers: UA })
    if (!r.ok) throw new Error(`oracle ${bbHost} ${addr}: http ${r.status}`)
    const j = await r.json()
    return { balance: BigInt(j.balance), unconfirmed: BigInt(j.unconfirmedBalance || 0), txids: j.txids || [], unconfirmedTxs: j.unconfirmedTxs || 0 }
}

export async function bbTx(bbHost, txid) {
    const r = await fetch(`https://${bbHost}/api/v2/tx/${txid}`, { headers: UA })
    return r.ok ? r.json() : null
}

// Websocket API client (the interface the port moves to)
export function bbWs(bbHost) {
    const ws = new WS(`wss://${bbHost}/websocket`, { headers: { ...UA, Origin: `https://${bbHost.split(':')[0]}` } })
    let id = 0; const pend = {}, subs = {}
    const ready = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })
    ws.on('message', m => { const j = JSON.parse(m); if (pend[j.id]) { pend[j.id](j.data); delete pend[j.id] } else if (subs[j.id]) subs[j.id](j.data) })
    const send = (method, params) => ready.then(() => new Promise(r => { const i = String(id++); pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })) }))
    const sub = (method, params, cb) => ready.then(() => { const i = String(id++); subs[i] = cb; ws.send(JSON.stringify({ id: i, method, params })) })
    return { send, sub, close: () => ws.close() }
}

// Legacy socket.io client (the interface the port moves away from) - only our Blockbook 0.5.0 still serves it
export function bbLegacy(bbHost) {
    const s = io(`https://${bbHost}`, { transports: ['websocket'], transportOptions: { websocket: { extraHeaders: { ...UA, Origin: `https://${bbHost.split(':')[0]}` } } } })
    const ready = new Promise((res, rej) => { s.on('connect', res); s.on('connect_error', rej) })
    return {
        txids: (addrs, mempoolOnly = false) => ready.then(() => new Promise(r => s.send({ method: 'getAddressTxids', params: [addrs, { start: 99999999, end: 0, queryMempoolOnly: mempoolOnly }] }, d => r(d.result || [])))),
        subAddresses: (addrs, cb) => ready.then(() => { s.emit('subscribe', 'bitcoind/addresstxid', addrs); s.on('bitcoind/addresstxid', d => d && d.txid && cb(d.txid)) }),
        close: () => s.close(),
    }
}
