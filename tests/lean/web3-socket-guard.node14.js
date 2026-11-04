// Lean LOCAL test (Node 14) for utils/web3-socket-guard.js against a mock websocket RPC on 127.0.0.1 (no internet):
//   - without the guard, an id-less JSON-RPC error (publicnode's idle-timeout notice) throws "Cannot read property
//     'subscription' of undefined" out of web3 2.0-alpha's socket handler (the prod uncaughtException since 2026-11-03)
//   - with the guard: those messages are dropped and logged (rate-limited), with no exception; normal responses
//     (eth_blockNumber) and subscription notifications (newHeads) still arrive; install() is idempotent
// Run: ~/.nvm/versions/node/v14.16.0/bin/node tests/lean/web3-socket-guard.node14.js
'use strict'
const path = require('path'), assert = require('assert')
const REPO = path.resolve(__dirname, '../..')
const WebSocket = require(`${REPO}/node_modules/ws`)
const Web3 = require(`${REPO}/node_modules/web3`)
const guard = require(`${REPO}/utils/web3-socket-guard`)

const ORPHAN = '{"jsonrpc":"2.0","error":{"code":-32701,"message":"connection timeout exceeded"}}\n' // as publicnode sends it
let pass = 0, fail = 0; const out = []
function t(name, ok, detail = '') { if (ok) { pass++; out.push(`  ✔ ${name}`) } else { fail++; out.push(`  ✖ ${name} ${detail}`) } }
const sleep = ms => new Promise(r => setTimeout(r, ms))

function mockRpc() {
    const wss = new WebSocket.Server({ host: '127.0.0.1', port: 0 })
    wss.on('connection', ws => {
        ws.send(ORPHAN)
        ws.on('message', m => {
            const req = JSON.parse(m)
            if (req.method === 'eth_blockNumber') ws.send(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: '0x10' }))
            else if (req.method === 'eth_subscribe') {
                ws.send(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: '0xabc' }))
                setTimeout(() => {
                    ws.send(ORPHAN)
                    ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'eth_subscription', params: { subscription: '0xabc', result: { number: '0x11', hash: '0x' + '1'.repeat(64), parentHash: '0x' + '0'.repeat(64), miner: '0x' + '0'.repeat(40), extraData: '0x', gasLimit: '0x1', gasUsed: '0x0', timestamp: '0x5', difficulty: '0x0', nonce: '0x0000000000000000', sha3Uncles: '0x' + '0'.repeat(64), logsBloom: '0x' + '0'.repeat(512), transactionsRoot: '0x' + '0'.repeat(64), stateRoot: '0x' + '0'.repeat(64), receiptsRoot: '0x' + '0'.repeat(64) } } }))
                    ws.send('not json')
                }, 100)
            }
            else ws.send(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: null }))
        })
    })
    return new Promise(r => wss.on('listening', () => r(wss)))
}

;(async () => {
    t('isOrphan: id-less error', guard.isOrphan(JSON.parse(ORPHAN)))
    t('isOrphan: response with id', !guard.isOrphan({ id: 1, result: '0x1' }))
    t('isOrphan: id null is not orphan (web3 handles it)', !guard.isOrphan({ id: null, error: {} }))
    t('isOrphan: subscription notification', !guard.isOrphan({ method: 'eth_subscription', params: { subscription: '0x1' } }))
    t('isOrphan: batch array', !guard.isOrphan([{ id: 1 }]))

    const wss = await mockRpc()
    const url = `ws://127.0.0.1:${wss.address().port}`
    const uncaught = []
    process.on('uncaughtException', e => uncaught.push(e.message))

    // 1. without the guard: the bug reproduces
    const bare = new Web3(new Web3.providers.WebsocketProvider(url))
    await sleep(400)
    t('unguarded: reproduces the prod exception', uncaught.some(m => /subscription/.test(m)), JSON.stringify(uncaught))
    try { bare.currentProvider.disconnect() } catch (e) {}
    uncaught.length = 0

    // 2. with the guard
    const logs = []
    t('install() ok', guard.install(s => logs.push(s)) === true)
    t('install() idempotent', guard.install(s => logs.push(s)) === true)
    const w3 = new Web3(new Web3.providers.WebsocketProvider(url))
    let heads = 0
    await sleep(300)
    const bn = await w3.eth.getBlockNumber().catch(e => e.message)
    t('guarded: eth_blockNumber still works', bn === 16, String(bn))
    w3.eth.subscribe('newBlockHeaders').on('data', () => heads++).on('error', e => logs.push('suberr ' + e.message))
    await sleep(600)
    t('guarded: subscription notification delivered', heads === 1, `heads=${heads}`)
    t('guarded: no uncaughtException', uncaught.length === 0, JSON.stringify(uncaught))
    t('guarded: orphan logged once (rate-limited)', logs.filter(l => /no id\/params \(x1\): error -32701: connection timeout exceeded/.test(l)).length === 1, JSON.stringify(logs))
    t('guarded: non-JSON dropped and logged', logs.some(l => /non-JSON/.test(l)), JSON.stringify(logs))

    try { w3.currentProvider.disconnect() } catch (e) {}
    wss.close()
    console.log(out.join('\n'))
    console.log(`\n${pass} passed, ${fail} failed`)
    process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
