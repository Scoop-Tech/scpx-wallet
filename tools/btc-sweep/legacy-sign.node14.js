// Node 14 helper for legacy-sweep.mjs: derives a legacy P2PKH key and signs a sweep with the wallet's own libraries
// (bitcoinjs-lib 5.2 TransactionBuilder). Reads ONE JSON request on stdin, writes ONE JSON reply on stdout.
// It NEVER outputs the private key or the MPK.
//   key sources: { prehdMpk }  -> the pre-HD (2018-12-29 .. 2019-01-06) single key: sha256_shex(pbkdf2(apk, mpk)), as the
//                                 wallet derived it then (same code path as tools/mpk-scan)
//                { wif }       -> a WIF (testnet rehearsals only)
//   request: { key, network: 'main'|'test', op: 'address' }                       -> { address }
//            { key, network, op: 'sign', from, to, inputs: [{ txid, vout, value }], sendSats } -> { hex }
'use strict'
const fs = require('fs'), os = require('os'), path = require('path')
const REPO = path.resolve(__dirname, '../..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-sign-')); process.chdir(tmp) // wallet libs log into cwd
const cleanup = () => { try { process.chdir(os.tmpdir()); fs.rmdirSync(tmp, { recursive: true }) } catch (e) {} }
const quiet = fn => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {}; try { return fn() } finally { console.log = l; console.warn = w; console.error = e } }
const reply = o => { process.stdout.write(JSON.stringify(o)); cleanup() }

let input = ''
process.stdin.on('data', d => input += d)
process.stdin.on('end', async () => {
    try {
        const req = JSON.parse(input); input = ''
        const bitcoinJs = require(`${REPO}/node_modules/bitcoinjs-lib`)
        const network = req.network === 'main' ? bitcoinJs.networks.bitcoin : req.network === 'test' ? bitcoinJs.networks.testnet : null
        if (!network) throw new Error('bad network')
        let keyPair
        if (req.key && req.key.prehdMpk) {
            const utilsWallet = quiet(() => require(`${REPO}/utils`))
            const { Keygen } = require(`${REPO}/node_modules/eosjs-keygen`)
            const keys = await Keygen.generateMasterKeys(req.key.prehdMpk)
            const h_mpk = utilsWallet.pbkdf2(keys.publicKeys.active, req.key.prehdMpk)
            keyPair = bitcoinJs.ECPair.fromPrivateKey(Buffer.from(utilsWallet.sha256_shex(h_mpk), 'hex'), { network }) // compressed, as the scan
        } else if (req.key && req.key.wif) {
            if (req.network !== 'test') throw new Error('a raw WIF is only accepted for testnet rehearsals')
            keyPair = bitcoinJs.ECPair.fromWIF(req.key.wif, network)
        } else throw new Error('no key source')
        req.key = null
        const address = bitcoinJs.payments.p2pkh({ pubkey: keyPair.publicKey, network }).address
        if (req.op === 'address') return reply({ address })
        if (req.op !== 'sign') throw new Error('bad op')
        if (req.from !== address) throw new Error(`key derives ${address}, not ${req.from}`)
        if (!Array.isArray(req.inputs) || !req.inputs.length) throw new Error('no inputs')
        const txb = new bitcoinJs.TransactionBuilder(network)
        txb.setVersion(2)
        txb.setLowR && txb.setLowR(true)
        const prevScript = bitcoinJs.address.toOutputScript(address, network)
        for (const i of req.inputs) txb.addInput(i.txid, i.vout, 0xfffffffe, prevScript)
        txb.addOutput(req.to, Number(req.sendSats))
        for (let n = 0; n < req.inputs.length; n++) txb.sign(n, keyPair)
        reply({ hex: txb.build().toHex() })
    } catch (e) { reply({ err: e.message || String(e) }) }
})
