// Node 14 helper for eth-sweep.mjs key-outside-the-wallet mode: derives a key the wallet no longer derives (the 2018-12 pre-HD
// single key) and signs ONE legacy EIP-155 tx with the wallet's own libraries (ethereumjs-tx 1.3.7), then runs the wallet's ETH
// send guard on the result. Reads ONE JSON request on stdin, writes ONE JSON reply on stdout. NEVER outputs the key or MPK.
//   key: { prehdMpk } -> privHex = sha256_shex(pbkdf2(apk, mpk)) (same code path as tools/mpk-scan)
//        { hex }      -> a raw 64-hex key (Sepolia rehearsals only)
//   { key, op: 'address' } -> { address }
//   { key, op: 'sign', chainId, nonce, to, valueWei, data, gasLimit, gasPriceWei, guard: { symbol, receiver, value, contractAddress,
//     decimals, fromBalanceWei } } -> { hex, guard }
'use strict'
const fs = require('fs'), os = require('os'), path = require('path')
const REPO = path.resolve(__dirname, '../..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eth-sign-')); process.chdir(tmp)
const cleanup = () => { try { process.chdir(os.tmpdir()); fs.rmdirSync(tmp, { recursive: true }) } catch (e) {} }
const quiet = fn => { const l = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {}; try { return fn() } finally { console.log = l; console.warn = w; console.error = e } }
const reply = o => { process.stdout.write(JSON.stringify(o)); cleanup() }
const hex = v => '0x' + BigInt(v).toString(16)

let input = ''
process.stdin.on('data', d => input += d)
process.stdin.on('end', async () => {
    try {
        const req = JSON.parse(input); input = ''
        const EthTx = require(`${REPO}/node_modules/ethereumjs-tx`)
        const ethUtil = require(`${REPO}/node_modules/ethereumjs-util`)
        let priv
        if (req.key && req.key.prehdMpk) {
            const utilsWallet = quiet(() => require(`${REPO}/utils`))
            const { Keygen } = require(`${REPO}/node_modules/eosjs-keygen`)
            const keys = await Keygen.generateMasterKeys(req.key.prehdMpk)
            const h_mpk = utilsWallet.pbkdf2(keys.publicKeys.active, req.key.prehdMpk)
            priv = Buffer.from(utilsWallet.sha256_shex(h_mpk), 'hex')
        } else if (req.key && req.key.hex) {
            if (Number(req.chainId) === 1) throw new Error('a raw key is only accepted for Sepolia rehearsals')
            priv = Buffer.from(String(req.key.hex).replace(/^0x/, ''), 'hex')
        } else throw new Error('no key source')
        req.key = null
        if (priv.length !== 32) throw new Error('bad key length')
        const address = '0x' + ethUtil.privateToAddress(priv).toString('hex')
        if (req.op === 'address') return reply({ address })
        if (req.op !== 'sign') throw new Error('bad op')
        if (String(req.from).toLowerCase() !== address) throw new Error(`key derives ${address}, not ${req.from}`)
        const chainId = Number(req.chainId)
        if (chainId !== 1 && chainId !== 11155111) throw new Error('bad chain id')
        const tx = new EthTx({ nonce: hex(req.nonce), to: req.to, value: hex(req.valueWei), data: req.data || '0x',
                               gasLimit: hex(req.gasLimit), gasPrice: hex(req.gasPriceWei), chainId })
        tx.sign(priv)
        priv.fill(0)
        const signed = '0x' + tx.serialize().toString('hex')
        // the wallet's own ETH/ERC20 send guard on the final signed tx (same checks as the wallet's send path)
        const G = require(`${REPO}/actions/wallet-eth-sendguard`)
        const g = req.guard
        const guard = G.verifySignedEthTx({ asset: { symbol: g.symbol }, hex: signed, fromAddr: address, fromBalanceWei: g.fromBalanceWei,
            receiver: g.receiver, value: g.value, contractAddress: g.contractAddress, decimals: g.decimals,
            expectedChainId: chainId, allowSendMaxPadding: false, paddingWei: 0 })
        reply({ hex: signed, guard })
    } catch (e) { reply({ err: e.message || String(e) }) }
})
