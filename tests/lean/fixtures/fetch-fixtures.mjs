// Re-fetch the saved real-chain tx fixtures used by tests/lean/utxo-mapping.node14.js (READ-ONLY public lookups).
// Run (Node >= 20): node tests/lean/fixtures/fetch-fixtures.mjs
// Sources: Trezor public Blockbook 0.6.0 websockets (ZEC on Zebra, BTC on Core 29) and publicnode Ethereum JSON-RPC.
// Uses the `ws` module with a User-Agent (some Trezor hosts reject UA-less websocket upgrades, e.g. Node's native WebSocket).
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const DIR = path.dirname(new URL(import.meta.url).pathname)
const require = createRequire(import.meta.url)
const WS = require(path.resolve(DIR, '../../../node_modules/ws'))

function bb(host) {
    const ws = new WS(`wss://${host}/websocket`, { headers: { 'User-Agent': 'Mozilla/5.0', Origin: `https://${host}` } })
    let id = 0; const pend = {}
    const ready = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })
    ws.on('message', m => { const j = JSON.parse(m); if (pend[j.id]) { pend[j.id](j.data); delete pend[j.id] } })
    const call = (method, params) => ready.then(() => new Promise((res, rej) => {
        const i = String(id++); pend[i] = d => d && d.error ? rej(new Error(`${host} ${method}: ${JSON.stringify(d.error)}`)) : res(d)
        ws.send(JSON.stringify({ id: i, method, params }))
    }))
    return { call, close: () => ws.close() }
}
async function rpc(url, method, params) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
    const j = await r.json(); if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`); return j.result
}
function save(name, obj) {
    fs.writeFileSync(path.join(DIR, `${name}.json`), JSON.stringify(Object.assign({ fetchedAt: new Date().toISOString() }, obj), null, 1) + '\n')
    console.log('saved', name)
}

// Blockbook UTXO txs: getTransaction (-> mapTx_BlockbookToInsight + map_insightTxs); getTransactionSpecific + the address's
// getAccountUtxo entries for that tx (-> UTXO filter), when `utxoFor` is given.
const UTXO_CASES = [
    { name: 'zec-v4-t2t', host: 'zec1.trezor.io', symbol: 'ZEC', txid: 'd07504f4c3bdf93dcbee230835796ef9304f6b5325e2ffcfa1d14da623328229',
      own: 't1cf9PNYWAaF5u54nuQV9ki3G6LwE3dB4bi', utxoFor: true, note: 'v4 Sapling-era transparent t->t, both outputs back to the sender (send-to-self); its 2 outputs are the address\'s UTXOs (scriptPubKey.addresses[] form)' },
    { name: 'zec-v6-z2t', host: 'zec1.trezor.io', symbol: 'ZEC', txid: '0366d74ae945b7e898d111dfcbaead72c2b06c6c9eba08a8ec920bc3713d21da',
      ownFromVout: 0, note: 'v6 shielded (Sapling) -> transparent: vin [] (from a shielded address)' },
    { name: 'zec-v5-t2z', host: 'zec1.trezor.io', symbol: 'ZEC', txid: '3bbb62d5641bce427302ccde55b29e9b977ae39927f6847b31e7d139be973cd4',
      own: 't1MKn34KBa8Xh4g8qU8psibBXvURafphVn7', note: 'v5 transparent -> shielded (mining pool shielding its coinbase outputs): vout [] for transparent' },
    { name: 'zec-v6-coinbase', host: 'zec1.trezor.io', symbol: 'ZEC', txid: 'a488c7a4b7554266b377173cfedf6f6650aabca520c362c06cdcc9721aaf300e',
      own: 't1MKn34KBa8Xh4g8qU8psibBXvURafphVn7', note: 'v6 coinbase: vin[0] has no addresses (used to throw in mapTx_BlockbookToInsight)' },
    { name: 'btc-coinbase-800000', host: 'btc1.trezor.io', symbol: 'BTC', txid: 'b75ca3106ed100521aa50e3ec267a06431c6319538898b25e1b757a5736f5fb4',
      ownFromVout: 0, note: 'BTC block 800000 coinbase: vin[0] has no addresses; has an OP_RETURN (witness commitment) output' },
    { name: 'btc-p2pkh-opreturn', host: 'btc1.trezor.io', symbol: 'BTC', txid: 'a9c882c1dd3cb0fdec71f3c479479ebf4003cd35b60d744f385cea81bda5ca49',
      own: '1EvanBTCS99Vfgknz9vt8XauYsMgiVPfb6', utxoFor: true, note: 'P2PKH output to 1EvanBTC (vout 2) next to OP_RETURN outputs; Core 29 getTransactionSpecific gives scriptPubKey.address (singular), type pubkeyhash' },
    { name: 'btc-p2pkh', host: 'btc1.trezor.io', symbol: 'BTC', txid: 'e82a45e1c673a82ec32c9e798b2cdf503b94379af610c8415f270757452e4ac4',
      own: '1EvanBTCS99Vfgknz9vt8XauYsMgiVPfb6', utxoFor: true, note: 'P2PKH output to 1EvanBTC (vout 1)' },
]

const conns = {}
for (const c of UTXO_CASES) {
    const s = conns[c.host] = conns[c.host] || bb(c.host)
    const getTransaction = await s.call('getTransaction', { txid: c.txid })
    const own = c.own || getTransaction.vout[c.ownFromVout].addresses[0]
    const out = { source: `wss://${c.host} (Blockbook websocket)`, symbol: c.symbol, txid: c.txid, ownAddress: own, note: c.note, getTransaction }
    if (c.utxoFor) {
        out.getTransactionSpecific = await s.call('getTransactionSpecific', { txid: c.txid })
        out.getAccountUtxo = (await s.call('getAccountUtxo', { descriptor: own })).filter(u => u.txid === c.txid)
    }
    save(c.name, out)
}
Object.values(conns).forEach(s => s.close())

// ETH contract creation (to == null): raw JSON-RPC objects; the test formats them with web3's own output formatters
const PN = 'https://ethereum-rpc.publicnode.com'
const ETH_TXID = '0x206b710a257eab7af1d1e0749b2d297e4c0aa1934008fbd532db8c48f83d4857'
const tx = await rpc(PN, 'eth_getTransactionByHash', [ETH_TXID])
const receipt = await rpc(PN, 'eth_getTransactionReceipt', [ETH_TXID])
const block = await rpc(PN, 'eth_getBlockByNumber', [tx.blockNumber, false])
delete block.transactions; delete block.logsBloom; delete block.withdrawals
delete receipt.logs; delete receipt.logsBloom
tx.inputLength = tx.input.length; tx.input = tx.input.slice(0, 74)   // init code truncated (still valid hex) to keep the fixture small
save('eth-contract-creation', { source: `${PN} (eth_getTransactionByHash / eth_getTransactionReceipt / eth_getBlockByNumber)`, symbol: 'ETH', txid: ETH_TXID,
    note: 'contract creation (to == null; receipt.contractAddress set) - was in the history of 0xBE0eB53F46cd790Cd13851d5EFf43D12404d33E8 and was dropped by worker-account', tx, receipt, block })
