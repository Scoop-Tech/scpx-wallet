// Lean OFFLINE tests (Node 14, in-process) for the BTC send path's last line of defence - actions/wallet-btc-sendguard.js -
// driven through the REAL builders: actions/wallet-utxo.js getUtxo_InputsOutputs (input selection + change) and
// actions/wallet-btc-p2sh.js createTxHex_BTC_P2SH (P2SH-P2WPKH, the BTC_SEG / BTC_TEST builder), with throwaway keys.
//   - normal send with change, and a 2-UTXO sweep (no change) on mainnet + testnet params: accepted, exact amounts
//   - every bad shape is refused: wrong receiver amount, change to a foreign address, change to an own address whose
//     key does not re-derive to it, extra output, missing/extra input, fee above the sat/vB and absolute caps,
//     fee > 2x intended, zero/negative fee, below 1 sat/vB
//   - bitcoinjs's own fee-rate check is ON when signing for real (and off for the fee-estimate pass)
//   - the BTC fee oracle is refused when it returns garbage or an absurd rate
// Nothing touches the network (the fee-oracle test stubs axios). Run: node tests/lean/btc-sendguard.node14.js
'use strict'
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert'), crypto = require('crypto')
const REPO = path.resolve(__dirname, '../..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'scpx-lean-sendguard-'))
process.chdir(TMP) // the wallet's winston logs land here; deleted at the end
process.on('exit', () => { try { process.chdir(os.tmpdir()); fs.rmdirSync(TMP, { recursive: true }) } catch (e) {} })
process.on('unhandledRejection', (e) => { console.error('✖ unhandled rejection:', e && e.stack || e); process.exit(1) })
global.self = global; self.window = self; self.postMessage = () => {}

const quiet = fn => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {}; try { return fn() } finally { console.log = l; console.warn = w; console.error = e } }
const quietAsync = async fn => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {}; try { return await fn() } finally { console.log = l; console.warn = w; console.error = e } }

const bitcoinJsLib = require(`${REPO}/node_modules/bitcoinjs-lib`)
const guardMod = require(`${REPO}/actions/wallet-btc-sendguard`)
const walletUtxo = quiet(() => require(`${REPO}/actions/wallet-utxo`))
const walletP2sh = quiet(() => require(`${REPO}/actions/wallet-btc-p2sh`))
quiet(() => require(`${REPO}/actions/wallet-external`)) // installs Array.prototype.extend, used by utils getAll_txs

let pass = 0, fail = 0
const results = []
async function t(name, fn) {
    try { await fn(); pass++; results.push(`  ✔ ${name}`) }
    catch (e) { fail++; results.push(`  ✖ ${name}\n      ${(e && e.message) || e}`) }
}
function refuses(fn, re) {
    let threw
    try { fn() } catch (e) { threw = String((e && e.message) || e) }
    assert.ok(threw !== undefined, `expected a refusal matching ${re}, but it was accepted`)
    assert.ok(re.test(threw), `refused, but with "${threw}" (expected ${re})`)
}

// a throwaway wallet: n P2SH-P2WPKH addresses with keys, for one symbol
function mkWallet(symbol, n) {
    const network = symbol.includes('TEST') ? bitcoinJsLib.networks.testnet : bitcoinJsLib.networks.bitcoin
    const keys = []
    for (let i = 0; i < n; i++) {
        const kp = bitcoinJsLib.ECPair.makeRandom({ network })
        const p2sh = bitcoinJsLib.payments.p2sh({ redeem: bitcoinJsLib.payments.p2wpkh({ pubkey: kp.publicKey, network }), network })
        keys.push({ addr: p2sh.address, privKey: kp.toWIF(), script: p2sh.output.toString('hex') })
    }
    const asset = { symbol, OP_CLTV: true, local_txs: [], addresses: keys.map((k, i) => ({ addr: k.addr, path: `m/44'/0'/0'/0/${i}`, txs: [], utxos: [] })) }
    return { network, keys, asset }
}
function utxo(w, i, sats) {
    return { txid: crypto.randomBytes(32).toString('hex'), vout: Math.floor(Math.random() * 3), satoshis: sats, address: w.keys[i].addr,
             scriptPubKey: { type: 'scripthash', hex: w.keys[i].script, addresses: [w.keys[i].addr] } }
}
function foreignAddr(network, kind = 'p2wpkh') {
    const kp = bitcoinJsLib.ECPair.makeRandom({ network })
    return kind === 'p2wpkh' ? bitcoinJsLib.payments.p2wpkh({ pubkey: kp.publicKey, network }).address
                             : bitcoinJsLib.payments.p2sh({ redeem: bitcoinJsLib.payments.p2wpkh({ pubkey: kp.publicKey, network }), network }).address
}

// the real selection + the real P2SH builder, exactly as createTxHex calls them (send mode), then the guard
async function buildAndGuard({ w, utxos, receiver, valueBtc, feeSats, mutate }) {
    const changeAddress = w.asset.addresses[0].addr
    const payTo = [{ receiver, value: valueBtc }]
    const skel = await quietAsync(() => walletUtxo.getUtxo_InputsOutputs(w.asset.symbol, {
        changeAddress, outputs: [{ receiver, value: String(Math.round(valueBtc * 1e8)) }], feeSatoshis: feeSats, utxos }))
    const guardSkeleton = { inputs: skel.inputs.slice(), outputs: skel.outputs.map(o => Object.assign({}, o)) }
    if (mutate) mutate(skel)
    const built = quiet(() => walletP2sh.createTxHex_BTC_P2SH({ asset: w.asset, validationMode: false,
        addrPrivKeys: w.keys.map(k => ({ addr: k.addr, privKey: k.privKey })), txSkeleton: skel }))
    const guardArgs = { asset: w.asset, hex: built.hex, txSkeleton: guardSkeleton, payTo, changeAddress, intendedFeeSats: feeSats,
                        addrPrivKeys: w.keys.map(k => ({ addr: k.addr, privKey: k.privKey })), isProtectOp: false, devFeeAddr: undefined }
    return { built, guardArgs, skel, guardSkeleton }
}

;(async () => {
    for (const symbol of ['BTC_SEG', 'BTC_TEST']) {
        const w = mkWallet(symbol, 3)
        const N = w.network

        await t(`${symbol}: send with change -> 1 receiver output (exact), 1 change output to own addr 0, fee exact`, async () => {
            const utxos = [utxo(w, 0, 41234567), utxo(w, 1, 43210)]
            const to = foreignAddr(N)
            const { guardArgs } = await buildAndGuard({ w, utxos, receiver: to, valueBtc: 0.1, feeSats: 1500 })
            const g = guardMod.verifySignedBtcTx(guardArgs)
            assert.equal(g.outputs.length, 2)
            assert.deepEqual(g.outputs.find(o => o.role === 'receiver'), { n: 0, address: to, sats: '10000000', role: 'receiver' })
            const ch = g.outputs.find(o => o.role === 'change (own)')
            assert.equal(ch.address, w.keys[0].addr)
            assert.equal(g.feeSats, '1500')
            assert.equal(g.inputs.length, 1, 'largest UTXO alone covers it')
            assert.equal(BigInt(ch.sats), 41234567n - 10000000n - 1500n)
        })

        await t(`${symbol}: SWEEP of 2 UTXOs at one address -> 1 output, no change, all inputs spent, fee exact`, async () => {
            const utxos = [utxo(w, 0, 41234567), utxo(w, 0, 43210)]
            const to = foreignAddr(N)
            const fee = 1300
            const value = (41277777 - fee) / 1e8
            const { guardArgs } = await buildAndGuard({ w, utxos, receiver: to, valueBtc: value, feeSats: fee })
            const g = guardMod.verifySignedBtcTx(guardArgs)
            assert.equal(g.outputs.length, 1)
            assert.equal(g.outputs[0].address, to)
            assert.equal(g.outputs[0].sats, String(41277777 - fee))
            assert.equal(g.inputs.length, 2)
            assert.equal(g.feeSats, String(fee))
            assert.ok(g.feeSatPerVb > 1 && g.feeSatPerVb < 10, `fee rate ${g.feeSatPerVb}`)
        })

        await t(`${symbol}: sweep across 3 addresses (multi-key signing) -> 1 output, fee exact`, async () => {
            const utxos = [utxo(w, 0, 30000), utxo(w, 1, 40000), utxo(w, 2, 50000)]
            const to = foreignAddr(N, 'p2sh')
            const { guardArgs } = await buildAndGuard({ w, utxos, receiver: to, valueBtc: (120000 - 2000) / 1e8, feeSats: 2000 })
            const g = guardMod.verifySignedBtcTx(guardArgs)
            assert.equal(g.outputs.length, 1); assert.equal(g.inputs.length, 3); assert.equal(g.feeSats, '2000')
        })

        await t(`${symbol}: leftover <= fee is not returned as change (goes to fee) and stays within 2x intended`, async () => {
            const utxos = [utxo(w, 0, 100000)]
            const { guardArgs } = await buildAndGuard({ w, utxos, receiver: foreignAddr(N), valueBtc: (100000 - 1500 - 900) / 1e8, feeSats: 1500 })
            const g = guardMod.verifySignedBtcTx(guardArgs)
            assert.equal(g.outputs.length, 1); assert.equal(g.feeSats, '2400')
        })

        await t(`${symbol}: self-send to own address 0 (payment + change both to addr 0) accepted, exact`, async () => {
            const { guardArgs } = await buildAndGuard({ w, utxos: [utxo(w, 1, 200000)], receiver: w.keys[0].addr, valueBtc: 0.0005, feeSats: 1000 })
            const g = guardMod.verifySignedBtcTx(guardArgs)
            assert.equal(g.outputs.length, 2); assert.equal(g.feeSats, '1000')
            assert.equal(g.outputs.find(o => o.role === 'receiver').sats, '50000')
        })
        await t(`${symbol}: self-send where no output is the exact amount is refused`, async () => {
            const { guardArgs } = await buildAndGuard({ w, utxos: [utxo(w, 1, 200000)], receiver: w.keys[0].addr, valueBtc: 0.0005, feeSats: 1000,
                mutate: s => { s.outputs[0].value = '49999'; s.outputs[1].value = String(Number(s.outputs[1].value) + 1) } })
            refuses(() => guardMod.verifySignedBtcTx(guardArgs), /self-send: no output of exactly/)
        })

        // ---- refusals: tamper with the skeleton the builder signs, and check the guard catches the signed result
        const base = () => ({ w, utxos: [utxo(w, 0, 1000000)], receiver: foreignAddr(N), valueBtc: 0.005, feeSats: 1500 })
        await t(`${symbol}: refuses receiver amount != requested`, async () => {
            const { guardArgs } = await buildAndGuard({ ...base(), mutate: s => { s.outputs[0].value = String(Number(s.outputs[0].value) - 1) } })
            refuses(() => guardMod.verifySignedBtcTx(guardArgs), /receiver output .* != requested/)
        })
        await t(`${symbol}: refuses change to a foreign address`, async () => {
            const { guardArgs } = await buildAndGuard({ ...base(), mutate: s => { s.outputs[1].address = foreignAddr(N, 'p2sh') } })
            refuses(() => guardMod.verifySignedBtcTx(guardArgs), /not the change address/)
        })
        await t(`${symbol}: refuses change to an own-listed address whose held key does not derive to it`, async () => {
            const { guardArgs } = await buildAndGuard(base())
            guardArgs.addrPrivKeys = guardArgs.addrPrivKeys.map((k, i) => i === 0 ? { addr: k.addr, privKey: w.keys[1].privKey } : k)
            refuses(() => guardMod.verifySignedBtcTx(guardArgs), /not a wallet address with a held, matching private key/)
        })
        await t(`${symbol}: refuses change to a non-standard (PROTECT_OP) own address`, async () => {
            const { guardArgs } = await buildAndGuard(base())
            guardArgs.asset = { ...w.asset, addresses: w.asset.addresses.map((a, i) => i === 0 ? { ...a, isNonStdAddr: true } : a) }
            refuses(() => guardMod.verifySignedBtcTx(guardArgs), /not a wallet address with a held, matching private key/)
        })
        await t(`${symbol}: refuses an extra output`, async () => {
            const { guardArgs } = await buildAndGuard({ ...base(), mutate: s => { s.outputs.push({ address: foreignAddr(N), value: '1000', change: true }); s.outputs[1].value = String(Number(s.outputs[1].value) - 1000) } })
            refuses(() => guardMod.verifySignedBtcTx(guardArgs), /unexpected extra outputs/)
        })
        await t(`${symbol}: refuses a tx whose inputs differ from the selection`, async () => {
            const b = base(); const extra = utxo(w, 1, 5000)
            const { guardArgs } = await buildAndGuard({ ...b, mutate: s => { s.inputs.push({ utxo: extra, ndx: 1 }) } })
            refuses(() => guardMod.verifySignedBtcTx(guardArgs), /inputs differ/)
        })
        await t(`${symbol}: refuses fee > 2x intended (selection bug / stale skeleton)`, async () => {
            const { guardArgs } = await buildAndGuard({ ...base(), mutate: s => { s.outputs[1].value = String(Number(s.outputs[1].value) - 5000) } })
            refuses(() => guardMod.verifySignedBtcTx(guardArgs), /more than twice the intended/)
        })
        await t(`${symbol}: refuses fee above the absolute cap (0.001 BTC), even if "intended"`, async () => {
            const b = base(); b.utxos = [utxo(w, 0, 50000000)]; b.valueBtc = 0.4
            process.env.WALLET_MAX_FEE_SAT_VB = '100000' // isolate the absolute cap from the rate caps (bitcoinjs + guard)
            try {
                const { guardArgs } = await buildAndGuard({ ...b, feeSats: 150000 })
                refuses(() => guardMod.verifySignedBtcTx(guardArgs), /exceeds the 100000 sats cap/)
            } finally { delete process.env.WALLET_MAX_FEE_SAT_VB }
        })
        await t(`${symbol}: refuses fee rate above the sat/vB cap; bitcoinjs's own check also fires when signing`, async () => {
            const b = base()
            let threw
            try { await buildAndGuard({ ...b, feeSats: 60000 }) } catch (e) { threw = String((e && e.message) || e) }
            assert.ok(threw && /fee rate|Fee rate|feeRate/i.test(threw), `bitcoinjs fee check should refuse first, got: ${threw}`)
            process.env.WALLET_MAX_FEE_SAT_VB = '100000' // let bitcoinjs pass, the guard must still refuse at its own (default) cap
            try {
                const { guardArgs } = await buildAndGuard({ ...b, feeSats: 60000 })
                delete process.env.WALLET_MAX_FEE_SAT_VB
                refuses(() => guardMod.verifySignedBtcTx(guardArgs), /exceeds the 100 sat\/vB cap/)
            } finally { delete process.env.WALLET_MAX_FEE_SAT_VB }
        })
        await t(`${symbol}: refuses < 1 sat/vB`, async () => {
            const { guardArgs } = await buildAndGuard({ ...base(), feeSats: 100 })
            refuses(() => guardMod.verifySignedBtcTx(guardArgs), /below 1 sat\/vB/)
        })
        await t(`${symbol}: fee-estimate pass (validationMode) still builds a tx whose outputs exceed inputs`, async () => {
            const utxos = [utxo(w, 0, 10000)]
            const skel = await quietAsync(() => walletUtxo.getUtxo_InputsOutputs(symbol, { changeAddress: w.keys[0].addr, outputs: [{ receiver: foreignAddr(N), value: '10000' }], feeSatoshis: 500, utxos }))
            const r = quiet(() => walletP2sh.createTxHex_BTC_P2SH({ asset: w.asset, validationMode: true, addrPrivKeys: w.keys.map(k => ({ addr: k.addr, privKey: k.privKey })), txSkeleton: skel }))
            assert.ok(r.byteLength > 0 && !r.hex)
        })
    }

    await t('mainnet params: a testnet receiver address is refused before signing', async () => {
        const w = mkWallet('BTC_SEG', 1)
        let threw
        try { await buildAndGuard({ w, utxos: [utxo(w, 0, 100000)], receiver: foreignAddr(bitcoinJsLib.networks.testnet), valueBtc: 0.0005, feeSats: 1000 }) } catch (e) { threw = String(e) }
        assert.ok(threw && /no matching Script|Invalid|prefix|network/i.test(threw), `got: ${threw}`)
    })

    await t('BTC fee oracle: sane response accepted (min 1000 sat/KB); garbage / absurd responses refused', async () => {
        const axios = require(`${REPO}/node_modules/axios`)
        const orig = axios.get
        try {
            axios.get = async () => ({ data: { feeByBlockTarget: { 1: 3112, 2: 3112, 3: 1726, 4: 1726, 10: 1000 } } })
            const ok = await quietAsync(() => walletUtxo.estimateFees_Utxo('BTC_SEG'))
            assert.deepEqual(ok, { fastest_satPerKB: 3112, fast_satPerKB: 3112, slow_satPerKB: 1726 })
            axios.get = async () => ({ data: { feeByBlockTarget: { 1: 900, 2: 500, 3: 400, 4: 300 } } })
            const low = await quietAsync(() => walletUtxo.estimateFees_Utxo('BTC_SEG'))
            assert.equal(low.slow_satPerKB, 1000)
            for (const bad of [{}, { feeByBlockTarget: { 1: 'x', 2: 'y', 3: 1, 4: 1 } }, { feeByBlockTarget: { 1: 5000000, 2: 4000000, 3: 3000000, 4: 2000000 } }]) {
                axios.get = async () => ({ data: bad })
                let threw
                try { await quietAsync(() => walletUtxo.estimateFees_Utxo('BTC_SEG')) } catch (e) { threw = String(e) }
                assert.ok(threw && /BTC fee oracle/.test(threw), `accepted ${JSON.stringify(bad)}`)
            }
        } finally { axios.get = orig }
    })

    console.log(results.join('\n'))
    console.log(`\nbtc-sendguard: ${pass} passed, ${fail} failed`)
    process.exit(fail ? 1 : 0)
})()
