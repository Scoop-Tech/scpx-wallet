// SEPOLIA ONLY - mint Aave v3 test USDT / USDC (USDT_TEST / USDC_TEST) to the e2e test wallets via the permissionless Aave faucet.
// The wallet can't send arbitrary contract calls, so this signs mint(token, to, amount) directly with wallet A's ETH_TEST key,
// derived IN-PROCESS from E2E_MPK_A exactly like the wallet does (never printed or written anywhere). Gas is paid in SepETH by A.
//
// Run (Node 14):  node tests/lean/tools/sepolia-faucet-mint.node14.js [--to=A|B|A,B] [--amount=1000] [--tokens=USDT_TEST,USDC_TEST] [--broadcast]
// Without --broadcast it's a dry run: all checks + eth_estimateGas, nothing signed or sent.
// Safety: refuses unless eth_chainId == 11155111 (Sepolia), the faucet is not permissioned, the token is mintable, amount <= 10000.
const fs = require('fs'), os = require('os'), path = require('path')
const REPO = path.resolve(__dirname, '../../..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'scpx-faucet-'))
process.chdir(TMP)   // any wallet-module logging lands here; deleted at the end

const axios = require(`${REPO}/node_modules/axios`)
const ethUtil = require(`${REPO}/node_modules/ethereumjs-util`)
const EthTx = require(`${REPO}/node_modules/ethereumjs-tx`)
const Keygen = require(`${REPO}/node_modules/eosjs-keygen`).Keygen
const configExternal = require(`${REPO}/config/wallet-external`)
const utilsWallet = require(`${REPO}/utils`)
const walletShared = require(`${REPO}/actions/wallet-shared`)

const RPC = configExternal.ethTestHttpProvider
const FAUCET = configExternal.AAVE_SEPOLIA_FAUCET
const SEPOLIA_CHAIN_ID = 11155111
const MAX_MINT = 10000

const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d }
const BROADCAST = process.argv.includes('--broadcast')
const AMOUNT = Number(arg('amount', '1000'))
const TOKENS = arg('tokens', 'USDT_TEST,USDC_TEST').split(',')
const TO = arg('to', 'A').split(',')

const env = {}
for (const l of fs.readFileSync(process.env.E2E_ENV || path.join(os.homedir(), '.config/scpx-wallet/e2e.env'), 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }

let rpcId = 1
async function rpc(method, params) {
    const r = await axios.post(RPC, { jsonrpc: '2.0', id: rpcId++, method, params }, { headers: { 'content-type': 'application/json' }, timeout: 30000 })
    if (r.data.error) throw new Error(`${method}: ${r.data.error.message}`)
    return r.data.result
}
const sel = sig => ethUtil.keccak256(Buffer.from(sig)).slice(0, 4).toString('hex')
const pad = a => a.toLowerCase().replace('0x', '').padStart(64, '0')
const sleep = ms => new Promise(r => setTimeout(r, ms))

// same derivation as the wallet: apk = eosjs-keygen(mpk).publicKeys.active; h_mpk = pbkdf2(apk, mpk); ETH m/44'/60'/0'/0/0 from h_mpk
async function ethKey(mpk) {
    const keys = await Keygen.generateMasterKeys(mpk)
    const h_mpk = utilsWallet.pbkdf2(keys.publicKeys.active, mpk)
    const privKey = walletShared.generateEthereumWallet({ entropySeed: h_mpk, addrNdx: 0, genCount: 1 })[0].privKey
    const buf = Buffer.from(privKey.replace('0x', ''), 'hex')
    return { buf, addr: '0x' + ethUtil.privateToAddress(buf).toString('hex') }
}

;(async () => {
    let rc = 0
    try {
        if (!(AMOUNT > 0 && AMOUNT <= MAX_MINT)) throw new Error(`--amount must be in (0, ${MAX_MINT}]`)
        const chainId = parseInt(await rpc('eth_chainId', []), 16)
        if (chainId !== SEPOLIA_CHAIN_ID) throw new Error(`refusing: ${RPC} is chainId ${chainId}, not Sepolia ${SEPOLIA_CHAIN_ID}`)
        if (BigInt(await rpc('eth_call', [{ to: FAUCET, data: '0x' + sel('isPermissioned()') }, 'latest'])) !== 0n) throw new Error('refusing: Aave faucet isPermissioned() == true')

        const A = await ethKey(env.E2E_MPK_A)               // signer (pays SepETH gas)
        const recipients = {}
        for (const w of TO) {
            if (w === 'A') recipients.A = A.addr
            else if (w === 'B') { const B = await ethKey(env.E2E_MPK_B); recipients.B = B.addr; B.buf.fill(0) }
            else throw new Error(`--to: A or B only (got ${w})`)
        }
        const ethBal = BigInt(await rpc('eth_getBalance', [A.addr, 'latest']))
        console.log(`signer A ${A.addr}  SepETH ${Number(ethBal) / 1e18}  recipients ${JSON.stringify(recipients)}  ${BROADCAST ? 'BROADCAST' : 'DRY RUN'}`)

        let nonce = parseInt(await rpc('eth_getTransactionCount', [A.addr, 'pending']), 16)
        for (const sym of TOKENS) {
            const token = configExternal.erc20Contracts[sym]
            if (!token || !configExternal.walletExternal_config[sym] || configExternal.walletExternal_config[sym].httpProvider !== RPC) throw new Error(`unknown Sepolia token ${sym}`)
            if (BigInt(await rpc('eth_call', [{ to: FAUCET, data: '0x' + sel('isMintable(address)') + pad(token) }, 'latest'])) !== 1n) throw new Error(`refusing: ${sym} not mintable on the faucet`)
            const decimals = parseInt(await rpc('eth_call', [{ to: token, data: '0x' + sel('decimals()') }, 'latest']), 16)
            const amount = BigInt(Math.round(AMOUNT * 1e6)) * 10n ** BigInt(decimals) / 1000000n
            for (const [who, to] of Object.entries(recipients)) {
                const balOf = async () => BigInt(await rpc('eth_call', [{ to: token, data: '0x' + sel('balanceOf(address)') + pad(to) }, 'latest']))
                const before = await balOf()
                const data = '0x' + sel('mint(address,address,uint256)') + pad(token) + pad(to) + amount.toString(16).padStart(64, '0')
                const est = parseInt(await rpc('eth_estimateGas', [{ from: A.addr, to: FAUCET, data }]), 16)   // throws if the mint would revert
                const gasLimit = Math.ceil(est * 1.25)
                const gasPrice = Math.max(2 * parseInt(await rpc('eth_gasPrice', []), 16), 1)                 // 2x node price (never the 'slow' tier)
                console.log(`${sym} -> ${who} ${to}: mint ${AMOUNT} (${amount} base units, ${decimals} dp)  estimateGas ${est} -> limit ${gasLimit} @ ${gasPrice} wei  balance before ${before}`)
                if (!BROADCAST) continue
                if (BigInt(gasLimit) * BigInt(gasPrice) > ethBal) throw new Error('insufficient SepETH for gas')
                const tx = new EthTx({ nonce: '0x' + nonce.toString(16), gasPrice: '0x' + gasPrice.toString(16), gasLimit: '0x' + gasLimit.toString(16),
                                       to: FAUCET, value: '0x0', data, chainId: SEPOLIA_CHAIN_ID })
                tx.sign(A.buf)
                const txid = await rpc('eth_sendRawTransaction', ['0x' + tx.serialize().toString('hex')])
                nonce++
                console.log(`  broadcast ${txid} (https://sepolia.etherscan.io/tx/${txid})`)
                let rcpt
                for (let i = 0; i < 60 && !rcpt; i++) { await sleep(3000); rcpt = await rpc('eth_getTransactionReceipt', [txid]).catch(() => null) }
                if (!rcpt || rcpt.status !== '0x1') { rc = 1; console.log(`  ✖ not mined OK: ${JSON.stringify(rcpt && rcpt.status)}`); continue }
                let after = before
                for (let i = 0; i < 10 && after === before; i++) { after = await balOf(); if (after === before) await sleep(2000) }   // load-balanced RPC may lag
                console.log(`  ✔ mined block ${parseInt(rcpt.blockNumber, 16)} gasUsed ${parseInt(rcpt.gasUsed, 16)}  balance after ${after} (+${after - before})`)
            }
        }
        A.buf.fill(0)
    } catch (e) { rc = 1; console.error('✖', e.message) }
    finally {
        fs.rmSync(TMP, { recursive: true, force: true })
        process.exit(rc)
    }
})()
