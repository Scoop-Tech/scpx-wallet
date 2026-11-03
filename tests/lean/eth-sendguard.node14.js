// Lean OFFLINE tests (Node 14) for the ETH / ERC20 send guard - actions/wallet-eth-sendguard.js - on txs signed here with
// throwaway keys by the same library the wallet uses (ethereumjs-tx, legacy EIP-155):
//   - accepted: exact ETH send, exact full-balance sweep, old send-max padding (only when allowed), ERC20 transfer (6 + 18 decimals)
//   - refused: wrong chain id (mainnet vs Sepolia vs none), signer != from, wrong recipient, wrong amount (1 wei), data on an ETH
//     transfer, value + fee > balance, gas price / total fee over the caps, padding when exact gas was requested, ERC20 to the
//     wrong contract / wrong recipient / wrong amount / with ETH value / a non-transfer call, amounts finer than the decimals
// Nothing touches the network. Run: node tests/lean/eth-sendguard.node14.js
'use strict'
const path = require('path'), assert = require('assert'), crypto = require('crypto')
const REPO = path.resolve(__dirname, '../..')
const EthTx = require(`${REPO}/node_modules/ethereumjs-tx`)
const ethUtil = require(`${REPO}/node_modules/ethereumjs-util`)
const BigNumber = require(`${REPO}/node_modules/bignumber.js`)
const G = require(`${REPO}/actions/wallet-eth-sendguard`)

let pass = 0, fail = 0; const out = []
function t(name, fn) { try { fn(); pass++; out.push(`  ✔ ${name}`) } catch (e) { fail++; out.push(`  ✖ ${name}\n      ${(e && e.message) || e}`) } }
function refuses(fn, re) {
    let threw; try { fn() } catch (e) { threw = String((e && e.message) || e) }
    assert.ok(threw !== undefined, `expected a refusal matching ${re}, but it was accepted`)
    assert.ok(re.test(threw), `refused with "${threw}" (expected ${re})`)
}
const key = () => { const k = crypto.randomBytes(32); return { k, addr: '0x' + ethUtil.privateToAddress(k).toString('hex') } }
const hex = n => '0x' + new BigNumber(n).toString(16)
function sign({ k, to, valueWei = '0', data = '', gasLimit = 21000, gasPriceWei = '1000000000', nonce = 0, chainId = 1 }) {
    const tx = new EthTx({ nonce: hex(nonce), to, value: hex(valueWei), data: data ? '0x' + data : '0x', gasLimit: hex(gasLimit), gasPrice: hex(gasPriceWei), chainId })
    tx.sign(k)
    return '0x' + tx.serialize().toString('hex')
}
const ETH = { symbol: 'ETH' }, ETH_TEST = { symbol: 'ETH_TEST' }, USDT = { symbol: 'USDT' }, TUSD = { symbol: 'TUSD' }
const USDT_C = '0xdac17f958d2ee523a2206206994597c13d831ec7', TUSD_C = '0x0000000000085d4780b73119b644ae5ecd22b376'
const transferData = (to, amount) => 'a9059cbb' + to.replace(/^0x/, '').toLowerCase().padStart(64, '0') + new BigNumber(amount).toString(16).padStart(64, '0')

const s = key(), r = key(), other = key()
const BAL = '1234567890000000000' // 1.23456789 ETH
const base = { asset: ETH, fromAddr: s.addr, fromBalanceWei: BAL, receiver: r.addr, expectedChainId: 1, allowSendMaxPadding: false, paddingWei: 50 }

t('ETH: exact send accepted; summary fields exact', () => {
    const g = G.verifySignedEthTx({ ...base, hex: sign({ k: s.k, to: r.addr, valueWei: '123456789012345678' }), value: '0.123456789012345678' })
    assert.equal(g.valueWei, '123456789012345678'); assert.equal(g.chainId, 1); assert.equal(g.from, s.addr); assert.equal(g.to, r.addr); assert.equal(g.maxFeeWei, '21000000000000')
})
t('ETH: exact full-balance sweep (value + 21000 x gasPrice == balance) accepted', () => {
    const fee = new BigNumber(21000).times('168000000'), v = new BigNumber(BAL).minus(fee)
    G.verifySignedEthTx({ ...base, hex: sign({ k: s.k, to: r.addr, valueWei: v.toFixed(), gasPriceWei: '168000000' }), value: v.div(1e18).toFixed() })
})
t('ETH: 18-decimal value survives exactly (no Number rounding)', () => {
    G.verifySignedEthTx({ ...base, fromBalanceWei: '2000000000000000000', hex: sign({ k: s.k, to: r.addr, valueWei: '1234567806471234567' }), value: '1.234567806471234567' })
    refuses(() => G.verifySignedEthTx({ ...base, fromBalanceWei: '2000000000000000000', hex: sign({ k: s.k, to: r.addr, valueWei: '1234567806471234600' }), value: '1.234567806471234567' }), /tx value .* != requested/)
})
t('ETH: send-max padding (-50 wei) accepted only when allowed', () => {
    const h = sign({ k: s.k, to: r.addr, valueWei: '999999999999999950' })
    G.verifySignedEthTx({ ...base, allowSendMaxPadding: true, hex: h, value: '1' })
    refuses(() => G.verifySignedEthTx({ ...base, hex: h, value: '1' }), /tx value .* != requested/)
})
t('ETH: refuses wrong recipient', () => refuses(() => G.verifySignedEthTx({ ...base, hex: sign({ k: s.k, to: other.addr, valueWei: '1000' }), value: '0.000000000000001' }), /not the receiver/))
t('ETH: refuses 1 wei more than requested', () => refuses(() => G.verifySignedEthTx({ ...base, hex: sign({ k: s.k, to: r.addr, valueWei: '1001' }), value: '0.000000000000001' }), /!= requested/))
t('ETH: refuses data on a plain transfer', () => refuses(() => G.verifySignedEthTx({ ...base, hex: sign({ k: s.k, to: r.addr, valueWei: '1000', data: 'deadbeef' }), value: '0.000000000000001' }), /unexpected data/))
t('ETH: refuses signer != from-address', () => refuses(() => G.verifySignedEthTx({ ...base, hex: sign({ k: other.k, to: r.addr, valueWei: '1000' }), value: '0.000000000000001' }), /signed by/))
t('ETH: refuses Sepolia-signed tx for mainnet, mainnet tx for Sepolia, and an unprotected (no chain id) tx', () => {
    refuses(() => G.verifySignedEthTx({ ...base, hex: sign({ k: s.k, to: r.addr, valueWei: '1000', chainId: 11155111 }), value: '0.000000000000001' }), /chain id 11155111 != expected 1/)
    refuses(() => G.verifySignedEthTx({ ...base, asset: ETH_TEST, expectedChainId: 11155111, hex: sign({ k: s.k, to: r.addr, valueWei: '1000', chainId: 1 }), value: '0.000000000000001' }), /chain id 1 != expected 11155111/)
    const pre155 = new EthTx({ nonce: '0x0', to: r.addr, value: '0x3e8', gasLimit: hex(21000), gasPrice: hex(1e9) }); pre155.sign(s.k)
    refuses(() => G.verifySignedEthTx({ ...base, hex: '0x' + pre155.serialize().toString('hex'), value: '0.000000000000001' }), /chain id 0 != expected 1/)
})
t('ETH: refuses value + max fee > balance', () => refuses(() => G.verifySignedEthTx({ ...base, hex: sign({ k: s.k, to: r.addr, valueWei: BAL }), value: new BigNumber(BAL).div(1e18).toFixed() }), /exceeds the sender's balance/))
t('ETH: refuses gas price over the 200 gwei cap and fee over the 0.01 ETH cap; env override raises them', () => {
    refuses(() => G.verifySignedEthTx({ ...base, hex: sign({ k: s.k, to: r.addr, valueWei: '1', gasPriceWei: '201000000000' }), value: '0.000000000000000001' }), /exceeds the 200 gwei cap/)
    refuses(() => G.verifySignedEthTx({ ...base, hex: sign({ k: s.k, to: r.addr, valueWei: '1', gasLimit: 500000, gasPriceWei: '30000000000' }), value: '0.000000000000000001' }), /exceeds the 0.01 ETH cap/)
    process.env.WALLET_MAX_FEE_ETH = '0.02'
    try { G.verifySignedEthTx({ ...base, hex: sign({ k: s.k, to: r.addr, valueWei: '1', gasLimit: 500000, gasPriceWei: '30000000000' }), value: '0.000000000000000001' }) }
    finally { delete process.env.WALLET_MAX_FEE_ETH }
})
t('ETH: refuses a tampered signature', () => {
    const h = sign({ k: s.k, to: r.addr, valueWei: '1000' })
    const tx = new EthTx(Buffer.from(h.slice(2), 'hex')); tx.value = Buffer.from('07d0', 'hex') // 2000 wei, signature now invalid
    let threw; try { G.verifySignedEthTx({ ...base, hex: '0x' + tx.serialize().toString('hex'), value: '0.000000000000002' }) } catch (e) { threw = String(e) }
    assert.ok(threw && /invalid signature|signed by/i.test(threw), `got ${threw}`)
})

const tb = { ...base, asset: USDT, contractAddress: USDT_C, decimals: 6, fromBalanceWei: undefined }
t('ERC20: exact transfer(receiver, amount) to the configured contract accepted (6 and 18 decimals)', () => {
    G.verifySignedEthTx({ ...tb, hex: sign({ k: s.k, to: USDT_C, data: transferData(r.addr, 2316300), gasLimit: 80000 }), value: '2.3163' })
    G.verifySignedEthTx({ ...tb, asset: TUSD, contractAddress: TUSD_C, decimals: 18, hex: sign({ k: s.k, to: TUSD_C, data: transferData(r.addr, '2316300000000000000'), gasLimit: 80000 }), value: '2.3163' })
})
t('ERC20: refuses wrong contract, wrong recipient, wrong amount, ETH value, non-transfer call', () => {
    refuses(() => G.verifySignedEthTx({ ...tb, hex: sign({ k: s.k, to: other.addr, data: transferData(r.addr, 2316300), gasLimit: 80000 }), value: '2.3163' }), /not the USDT contract/)
    refuses(() => G.verifySignedEthTx({ ...tb, hex: sign({ k: s.k, to: USDT_C, data: transferData(other.addr, 2316300), gasLimit: 80000 }), value: '2.3163' }), /not transfer/)
    refuses(() => G.verifySignedEthTx({ ...tb, hex: sign({ k: s.k, to: USDT_C, data: transferData(r.addr, 2316301), gasLimit: 80000 }), value: '2.3163' }), /not transfer/)
    refuses(() => G.verifySignedEthTx({ ...tb, hex: sign({ k: s.k, to: USDT_C, valueWei: '1', data: transferData(r.addr, 2316300), gasLimit: 80000 }), value: '2.3163' }), /carries ETH value/)
    refuses(() => G.verifySignedEthTx({ ...tb, hex: sign({ k: s.k, to: USDT_C, data: '095ea7b3' + transferData(r.addr, 2316300).slice(8), gasLimit: 80000 }), value: '2.3163' }), /not transfer/) // approve()
})
t('ERC20: refuses an amount finer than the token decimals', () => refuses(() => G.verifySignedEthTx({ ...tb, hex: sign({ k: s.k, to: USDT_C, data: transferData(r.addr, 1), gasLimit: 80000 }), value: '0.0000001' }), /not a whole number of base units/))

console.log(out.join('\n'))
console.log(`\neth-sendguard: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
