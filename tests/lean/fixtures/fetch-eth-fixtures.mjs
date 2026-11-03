// Re-fetch the saved real-chain ETH / ERC20 tx fixtures used by tests/lean/eth-mapping.node14.js (READ-ONLY public lookups).
// Run (Node >= 20): node tests/lean/fixtures/fetch-eth-fixtures.mjs
// Per tx: Blockbook 0.6 websocket getTransaction (Trezor public eth / sepolia) - what the wallet maps (worker-account
// mapTx_blockbook) - and the publicnode JSON-RPC objects (tx, receipt, block) the legacy web3 path mapped (mapTx_web3),
// for the parity tests. Big spam txs are trimmed (see trimBb / trimHex): every token transfer touching `ownAddress`
// is kept, plus the first 2 others; the original counts are recorded under `trimmed`.
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const DIR = path.dirname(new URL(import.meta.url).pathname)
const require = createRequire(import.meta.url)
const WS = require(path.resolve(DIR, '../../../node_modules/ws'))

function bb(host) {
    const ws = new WS(`wss://${host}/websocket`, { headers: { 'User-Agent': 'Mozilla/5.0', Origin: `https://${host}` }, maxPayload: 512 * 1024 * 1024 })
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

// long call data (multisend / airdrop spam): keep the method id + the first 2 words (enough for transfer(to, value) decoding)
const MAX_HEX = 1034
const trimHex = h => (h && h.length > MAX_HEX ? h.slice(0, 138) : h)

function trimBb(tx, own) {
    const t = JSON.parse(JSON.stringify(tx)), trimmed = {}
    const o = own.toLowerCase(), mine = x => (x.from || '').toLowerCase() === o || (x.to || '').toLowerCase() === o
    if (t.tokenTransfers && t.tokenTransfers.length > 6) {
        trimmed.tokenTransfers = t.tokenTransfers.length
        t.tokenTransfers = t.tokenTransfers.filter((x, i) => mine(x) || i < 2)
    }
    const es = t.ethereumSpecific
    if (es && es.data && es.data.length > MAX_HEX) { trimmed.dataLength = es.data.length; es.data = trimHex(es.data) }
    if (es && es.parsedData && JSON.stringify(es.parsedData).length > 2000) { trimmed.parsedData = true; es.parsedData = { methodId: es.parsedData.methodId, name: es.parsedData.name } }
    if (es && es.internalTransfers && es.internalTransfers.length > 6) {
        trimmed.internalTransfers = es.internalTransfers.length
        es.internalTransfers = es.internalTransfers.filter((x, i) => mine(x) || i < 2)
    }
    return { tx: t, trimmed }
}

const HOLDER = '0xFfB3B82D6BAe4E1C341E7423069C695Eee1b4C78'   // tests/lean/lib/pinned.js ETH_HOLDER (public, mainnet)
const SEP_OWN = '0xff8ac13981c99f3d4178328d496ec9ed02357604'  // ETH_TEST donate address (config/wallet-external.js, Sepolia)
const NET = {
    mainnet: { bb: 'eth.trezor.io', rpc: 'https://ethereum-rpc.publicnode.com' },
    sepolia: { bb: 'sepolia.trezor.io', rpc: 'https://ethereum-sepolia-rpc.publicnode.com' },
}
const CASES = [
    { name: 'eth-bb-plain-transfer', net: 'mainnet', own: HOLDER, txid: '0x056187f902f8be8cf464f88e6c88f8161f2615832525c9a17a0d7ff834ef9bc4',
      note: 'plain ETH transfer (0.2 ETH, data 0x) 0x9Ab27D... -> holder: incoming for the holder, outgoing seen from the sender' },
    { name: 'eth-bb-failed', net: 'mainnet', own: HOLDER, txid: '0xb62913afa7f57d913d8130a8e1cca044d5f2d9002f3dca8f605ecac91a3f4384',
      note: 'reverted (status 0) Curve remove_liquidity_one_coin sent by the holder: no token transfers, fee still paid' },
    { name: 'eth-bb-contract-creation-own', net: 'mainnet', own: null, ownFromVin: true,
      txid: '0x206b710a257eab7af1d1e0749b2d297e4c0aa1934008fbd532db8c48f83d4857',
      note: 'contract creation (no to; ethereumSpecific.createdContract) - same tx as eth-contract-creation.json (web3 fixture); own = the creator' },
    { name: 'eth-bb-contract-creation-airdrop', net: 'mainnet', own: HOLDER, txid: '0x5c8825193d0315042b2f9f4a5728c57726d10e8a6661bda48dd6f2f759a4889d',
      note: 'contract creation by a third party whose constructor airdrops a spam token AND 0.0001 real TUSD (the erc20Contracts TUSD contract: a historical token) to the holder' },
    { name: 'eth-bb-usdt-transfer-out', net: 'mainnet', own: HOLDER, txid: '0xd1b135f2b0bc1987d5a087774d8972436fb3c252034e63733c10c2a526627680',
      note: 'direct USDT.transfer() by the holder (1600 USDT out)' },
    { name: 'eth-bb-usdt-transfer-in', net: 'mainnet', own: HOLDER, txid: '0xbabf89caddd5f1c49f6898a578eb3d6dbacbea41dcaf3cb9d1ece451caf9c9d8',
      note: 'direct USDT.transfer() to the holder (693.070627 USDT in)' },
    { name: 'eth-bb-usdc-router-in', net: 'mainnet', own: HOLDER, txid: '0x52501c50f03df0db9f9c10b54b07e50115f6cfb536cd5c3cd1edecd6d1244919',
      note: '1inch router swap sent by the holder: YFI out (not a wallet token), USDC in via the router (transferFrom-style, tx.to = router)' },
    { name: 'eth-bb-usdt-swap-eth', net: 'mainnet', own: HOLDER, txid: '0x37f0f43ac468bc269ee17740705709bab0dba7d2b3e8ae94bf0a7f4eb9d7e180',
      note: 'swap sent by the holder paying 0.0605 ETH (tx value) and receiving USDT from a pool' },
    { name: 'eth-bb-usdt-router-swap-in', net: 'mainnet', own: HOLDER, txid: '0xd82c4a1e6327ac043c1475f12c6d6edb730b3103f3b82841c850542c1b062a2d',
      note: '1inch swap sent by the holder: sUSD out, USDT in from the router' },
    { name: 'eth-bb-mint-airdrop', net: 'mainnet', own: HOLDER, txid: '0x6eddedd889e7c63a85b84675477ddfa17c4eba4f6cb25ce76efc051ce2fbe09f',
      note: 'airdrop that MINTS (from 0x0) a spam "TUSD"-named token to the holder (not the TUSD contract)' },
    { name: 'eth-bb-usdt-poisoning', net: 'mainnet', own: HOLDER, txid: '0x7ec608e9a2adf55df910c21e4f93aa1caf117c7ad2f82669ce0fd55df3e26ecb',
      note: 'address poisoning: a third party moves 0 real USDT from the holder to a look-alike address (zero-value transferFrom)' },
    { name: 'eth-bb-fake-usdt', net: 'mainnet', own: HOLDER, txid: '0x46c0814ef1ab8ae84f3121267bd258f6d81648df993f7aa704eb84e48d15f015',
      note: 'look-alike token with symbol "USDT" (not the USDT contract): fake transfer "from" the holder' },
    { name: 'eth-bb-spam-airdrop', net: 'mainnet', own: HOLDER, txid: '0x949e6d3100bb65db189178e65be4feac1997fee114118a91372c06bd3180a213',
      note: 'spam airdrop of an unknown token to 500 addresses incl. the holder' },
    { name: 'eth-bb-sepolia-faucet-mint', net: 'sepolia', own: SEP_OWN, txid: '0x2f8c5f3830a069ff6aa3906b6cb9c56548a03a93e90ade413a196b0134a1ff07',
      note: 'Sepolia Aave faucet mint(USDT_TEST, own, 1000) sent by own: USDT_TEST minted from 0x0 to own (tx.to = faucet, not the token)' },
    { name: 'eth-bb-sepolia-self-send', net: 'sepolia', own: SEP_OWN, txid: '0xe565c7ae33b6cad72cce9d98fe7c4f8c047cca0bee26492717da9336e130a163',
      note: 'Sepolia ETH send-to-self (from == to == own)' },
    { name: 'eth-bb-sepolia-usdc-transfer-out', net: 'sepolia', own: SEP_OWN, txid: '0xced068fd61637741',
      note: 'Sepolia USDC_TEST direct transfer() sent by own (txid given as a prefix: resolved from own\'s recent history)' },
]

const conns = {}
for (const c of CASES) {
    const n = NET[c.net]
    const s = conns[n.bb] = conns[n.bb] || bb(n.bb)
    let txid = c.txid
    if (txid.length < 66) { // prefix: resolve from the address's recent history
        const a = await s.call('getAccountInfo', { descriptor: c.own, details: 'txids', page: 1, pageSize: 200 })
        txid = a.txids.find(x => x.startsWith(txid)); if (!txid) throw new Error(`${c.name}: ${c.txid} not in recent history`)
    }
    const raw = await s.call('getTransaction', { txid })
    const own = c.ownFromVin ? raw.vin[0].addresses[0] : c.own
    const { tx: getTransaction, trimmed } = trimBb(raw, own)
    // publicnode intermittently answers null for an old receipt: retry
    const rpcRetry = async (method, params) => { for (let i = 0; ; i++) { const r = await rpc(n.rpc, method, params); if (r || i >= 4) return r; await new Promise(z => setTimeout(z, 2000)) } }
    const tx = await rpcRetry('eth_getTransactionByHash', [txid])
    const receipt = await rpcRetry('eth_getTransactionReceipt', [txid])
    if (!tx || !receipt) throw new Error(`${c.name}: ${n.rpc} has no tx/receipt for ${txid}`)
    const block = await rpc(n.rpc, 'eth_getBlockByNumber', [tx.blockNumber, false])
    tx.input = trimHex(tx.input)
    delete receipt.logs; delete receipt.logsBloom
    const out = { fetchedAt: new Date().toISOString(), source: `wss://${n.bb} getTransaction (Blockbook websocket); ${n.rpc} (JSON-RPC)`,
        net: c.net, symbol: c.net === 'sepolia' ? 'ETH_TEST' : 'ETH', txid, ownAddress: own,
        note: c.note, trimmed, getTransaction,
        web3: { tx, receipt, block: { number: block.number, hash: block.hash, timestamp: block.timestamp } } }
    fs.writeFileSync(path.join(DIR, `${c.name}.json`), JSON.stringify(out, null, 1) + '\n')
    console.log('saved', c.name, JSON.stringify(trimmed))
}
Object.values(conns).forEach(s => s.close())
