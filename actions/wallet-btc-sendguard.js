// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2025 Dominic Morris.

//
// BTC send guard: an independent, fail-closed check of a fully signed BTC transaction BEFORE it is broadcast.
//
// It re-decodes the final hex (not the builder's intermediate objects) and refuses the tx unless:
//   - the inputs are exactly the selected UTXOs (no more, no fewer, no duplicates), all owned by the wallet
//   - fee = inputs - outputs is positive, within MAX_FEE_SAT_VB (sat/vbyte) and MAX_FEE_SATS (absolute),
//     at least 1 sat/vbyte (else it would never relay), and no more than the intended fee plus the
//     "leftover <= fee goes to the miner" allowance of getUtxo_InputsOutputs
//   - exactly one output pays the receiver, with exactly the requested value
//   - every other output is change to the wallet's own standard address, whose address is re-derived here
//     from the private key the wallet holds (plain bitcoinjs payments, not the wallet's own derivation helpers)
//   - PROTECT_OP txs keep their fixed anatomy (lock, OP_RETURN, beneficiary dust, own change, dev fee to `donate`)
//
// Limits can be raised for a single run with env WALLET_MAX_FEE_SAT_VB / WALLET_MAX_FEE_SATS.
//
const bitcoinJsLib = require('bitcoinjs-lib')
const BigNumber = require('bignumber.js')

const BTC_SYMBOLS = ['BTC', 'BTC_SEG', 'BTC_SEG2', 'BTC_TEST', 'BTC_TEST2']
const DEFAULT_MAX_FEE_SAT_VB = 100       // ~30x a normal market rate (2026); refuse anything above
const DEFAULT_MAX_FEE_SATS = 100000      // 0.001 BTC absolute cap per tx
const MIN_FEE_SAT_VB = 1                 // below this nodes won't relay: fail early rather than get stuck
const P_OP_DUST = 546

function limits() {
    const vb = Number(process.env.WALLET_MAX_FEE_SAT_VB || DEFAULT_MAX_FEE_SAT_VB)
    const abs = Number(process.env.WALLET_MAX_FEE_SATS || DEFAULT_MAX_FEE_SATS)
    if (!(vb > 0) || !(abs > 0)) throw 'SEND GUARD: bad WALLET_MAX_FEE_SAT_VB / WALLET_MAX_FEE_SATS'
    return { maxFeeSatVb: vb, maxFeeSats: abs }
}

function networkFor(symbol) {
    return symbol.includes('TEST') ? bitcoinJsLib.networks.testnet : bitcoinJsLib.networks.bitcoin
}

// independent address derivation from a WIF, per asset script type
function addressFromWif(symbol, wif, network) {
    const kp = bitcoinJsLib.ECPair.fromWIF(wif, network)
    const pubkey = kp.publicKey
    if (symbol === 'BTC_SEG' || symbol === 'BTC_TEST') {
        return bitcoinJsLib.payments.p2sh({ redeem: bitcoinJsLib.payments.p2wpkh({ pubkey, network }), network }).address
    }
    if (symbol === 'BTC_SEG2' || symbol === 'BTC_TEST2') {
        return bitcoinJsLib.payments.p2wpkh({ pubkey, network }).address
    }
    if (symbol === 'BTC') {
        return bitcoinJsLib.payments.p2pkh({ pubkey, network }).address
    }
    throw `SEND GUARD: unsupported symbol ${symbol}`
}

function toSats(v) { // exact decimal -> integer sats; refuses anything that isn't a whole number of sats
    const bn = new BigNumber(String(v))
    if (!bn.isFinite() || !bn.isInteger() || bn.isNegative()) throw `SEND GUARD: bad sats value "${v}"`
    return bn
}

module.exports = {
    BTC_SYMBOLS,
    DEFAULT_MAX_FEE_SAT_VB,
    DEFAULT_MAX_FEE_SATS,
    limits,
    addressFromWif,

    //
    // p: { asset, hex, txSkeleton (inputs as selected; outputs as returned by getUtxo_InputsOutputs, before any PROTECT_OP expansion),
    //      payTo, changeAddress, intendedFeeSats, addrPrivKeys, isProtectOp, devFeeAddr }
    // returns a plain summary on success; throws a 'SEND GUARD: ...' string on any violation
    //
    verifySignedBtcTx: (p) => {
        const { asset, hex, txSkeleton, payTo, changeAddress, intendedFeeSats, addrPrivKeys, isProtectOp, devFeeAddr } = p
        const symbol = asset.symbol
        if (!BTC_SYMBOLS.includes(symbol)) throw `SEND GUARD: unsupported symbol ${symbol}`
        if (!hex) throw 'SEND GUARD: no tx hex'
        // legacy P2PKH inputs (asset BTC) do not commit to their values: a backend under-reporting a UTXO value would make
        // this check (and bitcoinjs's) compute a small fee while the real fee is huge. Refuse until input values are
        // verified against the parent txs (or explicitly overridden for one run).
        if (symbol === 'BTC' && process.env.WALLET_ALLOW_UNCOMMITTED_LEGACY_INPUTS !== '1') {
            throw 'SEND GUARD: legacy BTC (P2PKH) sends are disabled: their input values are not signature-committed; sweep these with a verified tool instead'
        }
        if (!payTo || payTo.length !== 1) throw 'SEND GUARD: exactly one receiver is supported'
        const { maxFeeSatVb, maxFeeSats } = limits()
        const network = networkFor(symbol)

        const tx = bitcoinJsLib.Transaction.fromHex(hex)
        if (tx.toHex() !== hex) throw 'SEND GUARD: hex does not round-trip'

        // own standard addresses, each re-derived from the private key the wallet holds
        const keyAddr = new Map() // addr -> true, only if the WIF re-derives to exactly this addr
        for (const k of addrPrivKeys) {
            if (!k || !k.privKey || !k.addr) continue
            let derived
            try { derived = addressFromWif(symbol, k.privKey, network) } catch (e) { derived = undefined }
            if (derived === k.addr) keyAddr.set(k.addr, true)
        }
        const ownStd = new Set(asset.addresses.filter(a => !a.isNonStdAddr).map(a => a.addr).filter(a => keyAddr.has(a)))

        // --- inputs: exactly the selected UTXOs
        const sel = txSkeleton.inputs.map(i => `${i.utxo.txid}:${i.utxo.vout}`)
        if (new Set(sel).size !== sel.length) throw 'SEND GUARD: duplicate input selected'
        const ins = tx.ins.map(i => `${Buffer.from(i.hash).reverse().toString('hex')}:${i.index}`)
        if (ins.length !== sel.length || ins.some(x => !sel.includes(x))) throw 'SEND GUARD: tx inputs differ from the selected UTXOs'
        let inSats = new BigNumber(0)
        for (const i of txSkeleton.inputs) {
            inSats = inSats.plus(toSats(i.utxo.satoshis))
            const owned = asset.addresses.some(a => a.addr === i.utxo.address)
            if (!owned) throw `SEND GUARD: input ${i.utxo.txid}:${i.utxo.vout} is not from a wallet address`
        }

        // --- outputs
        const outs = tx.outs.map((o, n) => {
            let address
            try { address = bitcoinJsLib.address.fromOutputScript(o.script, network) } catch (e) { address = undefined }
            const isOpReturn = o.script.length > 0 && o.script[0] === bitcoinJsLib.opcodes.OP_RETURN
            return { n, address, isOpReturn, sats: new BigNumber(o.value), script: o.script.toString('hex') }
        })
        const outSats = outs.reduce((s, o) => s.plus(o.sats), new BigNumber(0))

        // --- fee
        const fee = inSats.minus(outSats)
        const vsize = tx.virtualSize()
        const feeRate = fee.div(vsize)
        if (!fee.isGreaterThan(0)) throw `SEND GUARD: non-positive fee (${fee.toString()} sats)`
        if (fee.isGreaterThan(maxFeeSats)) throw `SEND GUARD: fee ${fee.toString()} sats exceeds the ${maxFeeSats} sats cap`
        if (feeRate.isGreaterThan(maxFeeSatVb)) throw `SEND GUARD: fee rate ${feeRate.toFixed(2)} sat/vB exceeds the ${maxFeeSatVb} sat/vB cap`
        if (feeRate.isLessThan(MIN_FEE_SAT_VB)) throw `SEND GUARD: fee rate ${feeRate.toFixed(2)} sat/vB is below ${MIN_FEE_SAT_VB} sat/vB (would not relay)`
        const intended = toSats(intendedFeeSats)
        // getUtxo_InputsOutputs: leftover <= intended fee is not returned as change (it goes to the miner) => fee <= 2x intended
        if (fee.isGreaterThan(intended.times(2).plus(1))) throw `SEND GUARD: fee ${fee.toString()} sats is more than twice the intended ${intended.toString()} sats`

        // --- receiver and change
        const receiver = payTo[0].receiver
        const receiverScript = bitcoinJsLib.address.toOutputScript(receiver, network).toString('hex')
        const wantSats = toSats(new BigNumber(String(payTo[0].value)).times(100000000).toFixed())
        let summaryOuts
        if (!isProtectOp) {
            var toReceiver = outs.filter(o => o.script === receiverScript)
            // self-send to the change address: payment + change both pay that one script; the payment is the exact-value one
            const selfSendToChange = receiver === changeAddress && ownStd.has(changeAddress)
            if (selfSendToChange && toReceiver.length === 2) {
                const exact = toReceiver.find(o => o.sats.isEqualTo(wantSats))
                if (!exact) throw `SEND GUARD: self-send: no output of exactly the requested ${wantSats.toString()} sats`
                toReceiver = [exact]
            }
            if (toReceiver.length !== 1) throw `SEND GUARD: expected exactly 1 output to the receiver, found ${toReceiver.length}`
            if (!toReceiver[0].sats.isEqualTo(wantSats)) throw `SEND GUARD: receiver output ${toReceiver[0].sats.toString()} sats != requested ${wantSats.toString()} sats`
            const others = outs.filter(o => o !== toReceiver[0])
            if (others.length > 1) throw `SEND GUARD: unexpected extra outputs (${others.length})`
            for (const o of others) {
                if (o.isOpReturn || !o.address) throw 'SEND GUARD: unexpected non-address output'
                if (o.address !== changeAddress) throw `SEND GUARD: extra output to ${o.address} is not the change address`
                if (!ownStd.has(o.address)) throw `SEND GUARD: change address ${o.address} is not a wallet address with a held, matching private key`
            }
            summaryOuts = outs.map(o => ({ n: o.n, address: o.address, sats: o.sats.toString(), role: o === toReceiver[0] ? 'receiver' : 'change (own)' }))
        }
        else {
            // PROTECT_OP: 0 = P2SH(DSIG/CLTV) lock, 1 = OP_RETURN (0 value), 2 = beneficiary ID (dust), 3 = own change, 4 = dev fee to `donate`
            if (outs.length !== 5) throw `SEND GUARD: PROTECT_OP must have 5 outputs, found ${outs.length}`
            if (!outs[1].isOpReturn || !outs[1].sats.isEqualTo(0)) throw 'SEND GUARD: PROTECT_OP vout 1 must be a 0-value OP_RETURN'
            if (!outs[2].sats.isEqualTo(P_OP_DUST)) throw 'SEND GUARD: PROTECT_OP vout 2 must be dust'
            if (!outs[3].address || !ownStd.has(outs[3].address)) throw `SEND GUARD: PROTECT_OP change ${outs[3].address} is not an own address with a held key`
            if (!devFeeAddr || outs[4].address !== devFeeAddr) throw `SEND GUARD: PROTECT_OP dev fee output is not to the configured dev fee address`
            const gross = wantSats
            const devFeeMax = BigNumber.max(gross.times(0.005).integerValue(BigNumber.ROUND_CEIL), P_OP_DUST)
            if (outs[4].sats.isGreaterThan(devFeeMax)) throw `SEND GUARD: PROTECT_OP dev fee ${outs[4].sats.toString()} > ${devFeeMax.toString()}`
            // locked + beneficiary dust + dev fee + change padding == requested gross (the change output also carries any real change)
            if (outs[0].sats.plus(outs[2].sats).plus(outs[4].sats).isGreaterThan(gross)) throw 'SEND GUARD: PROTECT_OP outputs exceed the requested value'
            summaryOuts = outs.map((o, n) => ({ n, address: o.address, sats: o.sats.toString(), role: ['locked P2SH(DSIG/CLTV)', 'OP_RETURN', 'beneficiary id (dust)', 'change (own)', 'dev fee'][n] }))
        }

        return {
            txid: tx.getId(),
            symbol,
            inputs: txSkeleton.inputs.map(i => ({ outpoint: `${i.utxo.txid}:${i.utxo.vout}`, address: i.utxo.address, sats: toSats(i.utxo.satoshis).toString() })),
            outputs: summaryOuts,
            inSats: inSats.toString(),
            outSats: outSats.toString(),
            feeSats: fee.toString(),
            vsize,
            feeSatPerVb: Number(feeRate.toFixed(2)),
            limits: { maxFeeSatVb, maxFeeSats },
        }
    },
}
