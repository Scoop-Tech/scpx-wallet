// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2025 Dominic Morris.

//
// ETH / ERC20 send guard: an independent, fail-closed check of a fully signed account-type tx BEFORE it can be broadcast.
//
// It decodes the final signed hex (not the builder's params) and refuses the tx unless:
//   - the signature is valid, the recovered sender is the intended from-address, and the EIP-155 chain id is the asset's chain
//     (1 = mainnet, 11155111 = Sepolia) - so it can't be replayed on, or meant for, another chain
//   - ETH: `to` is exactly the receiver, data is empty, value is exactly the requested wei (or, only for the old send-max path,
//     the requested wei minus ETH_SENDMAX_PADDING_WEI), and value + gasLimit * gasPrice <= the sender's balance
//   - ERC20: `to` is exactly the token's configured contract, value is 0, and data is exactly transfer(receiver, amount) with
//     amount = requested * 10^decimals
//   - gasPrice <= MAX_GAS_PRICE_GWEI and gasLimit * gasPrice <= MAX_FEE_ETH (override for one run with env
//     WALLET_MAX_GAS_PRICE_GWEI / WALLET_MAX_FEE_ETH)
//
const EthTx = require('ethereumjs-tx')
const BigNumber = require('bignumber.js')

const DEFAULT_MAX_GAS_PRICE_GWEI = 200   // mainnet runs at ~0.03-30 gwei (2026); refuse anything above
const DEFAULT_MAX_FEE_ETH = '0.01'       // absolute cap per tx (a Sepolia new-account transfer is ~207k gas)
const ETH_SYMBOLS = ['ETH', 'ETH_TEST']

function limits() {
    const gwei = new BigNumber(process.env.WALLET_MAX_GAS_PRICE_GWEI || DEFAULT_MAX_GAS_PRICE_GWEI)
    const feeEth = new BigNumber(process.env.WALLET_MAX_FEE_ETH || DEFAULT_MAX_FEE_ETH)
    if (!gwei.isFinite() || gwei.lte(0) || !feeEth.isFinite() || feeEth.lte(0)) throw 'SEND GUARD: bad WALLET_MAX_GAS_PRICE_GWEI / WALLET_MAX_FEE_ETH'
    return { maxGasPriceWei: gwei.times(1e9).integerValue(BigNumber.ROUND_FLOOR), maxFeeWei: feeEth.times(1e18).integerValue(BigNumber.ROUND_FLOOR) }
}

const hexOf = buf => (buf && buf.length ? buf.toString('hex') : '')
const bnOf = buf => new BigNumber(hexOf(buf) ? '0x' + hexOf(buf) : '0')
const addrOf = buf => (buf && buf.length ? '0x' + buf.toString('hex') : '')

function exactUnits(value, decimals) { // decimal string -> integer base units; refuses anything finer than the token's decimals
    const bn = new BigNumber(String(value)).times(new BigNumber(10).pow(decimals))
    if (!bn.isFinite() || !bn.isInteger() || bn.isNegative()) throw `SEND GUARD: amount "${value}" is not a whole number of base units (${decimals} decimals)`
    return bn
}

module.exports = {
    ETH_SYMBOLS,
    limits,

    // p: { asset, hex, fromAddr, fromBalanceWei, receiver, value (display units, exact string), contractAddress (erc20),
    //      decimals, expectedChainId, allowSendMaxPadding, paddingWei }
    verifySignedEthTx: (p) => {
        const { asset, hex, fromAddr, fromBalanceWei, receiver, value, contractAddress, decimals, expectedChainId, allowSendMaxPadding, paddingWei } = p
        if (!hex) throw 'SEND GUARD: no tx hex'
        if (!expectedChainId) throw 'SEND GUARD: no expected chain id'
        const { maxGasPriceWei, maxFeeWei } = limits()
        const isErc20 = !ETH_SYMBOLS.includes(asset.symbol)

        const tx = new EthTx(Buffer.from(hex.replace(/^0x/, ''), 'hex'))
        if (!tx.verifySignature()) throw 'SEND GUARD: invalid signature'
        const chainId = tx.getChainId()
        if (chainId !== expectedChainId) throw `SEND GUARD: chain id ${chainId} != expected ${expectedChainId}`
        const from = '0x' + tx.getSenderAddress().toString('hex')
        if (from !== String(fromAddr).toLowerCase()) throw `SEND GUARD: signed by ${from}, not the from-address ${fromAddr}`

        const to = addrOf(tx.to), val = bnOf(tx.value), gasPrice = bnOf(tx.gasPrice), gasLimit = bnOf(tx.gasLimit), nonce = bnOf(tx.nonce)
        const data = hexOf(tx.data)
        const fee = gasLimit.times(gasPrice)
        if (gasPrice.lte(0) || gasLimit.lte(0)) throw 'SEND GUARD: zero gas price / gas limit'
        if (gasPrice.gt(maxGasPriceWei)) throw `SEND GUARD: gas price ${gasPrice.div(1e9).toFixed()} gwei exceeds the ${maxGasPriceWei.div(1e9).toFixed()} gwei cap`
        if (fee.gt(maxFeeWei)) throw `SEND GUARD: max fee ${fee.div(1e18).toFixed()} ETH exceeds the ${maxFeeWei.div(1e18).toFixed()} ETH cap`

        let sentUnits
        if (!isErc20) {
            if (to !== String(receiver).toLowerCase()) throw `SEND GUARD: tx pays ${to}, not the receiver ${receiver}`
            if (data !== '') throw 'SEND GUARD: unexpected data on an ETH transfer'
            const want = exactUnits(value, 18)
            const padded = want.minus(paddingWei || 0)
            if (!(val.isEqualTo(want) || (allowSendMaxPadding && val.isEqualTo(padded))))
                throw `SEND GUARD: tx value ${val.toFixed()} wei != requested ${want.toFixed()} wei`
            if (fromBalanceWei !== undefined && val.plus(fee).gt(new BigNumber(String(fromBalanceWei))))
                throw `SEND GUARD: value + max fee (${val.plus(fee).toFixed()} wei) exceeds the sender's balance ${fromBalanceWei} wei`
            sentUnits = val
        }
        else {
            if (!contractAddress) throw 'SEND GUARD: no token contract configured'
            if (to !== String(contractAddress).toLowerCase()) throw `SEND GUARD: tx goes to ${to}, not the ${asset.symbol} contract ${contractAddress}`
            if (!val.isZero()) throw 'SEND GUARD: token transfer carries ETH value'
            const amount = exactUnits(value, decimals)
            const r = String(receiver).toLowerCase().replace(/^0x/, '')
            if (!/^[0-9a-f]{40}$/.test(r)) throw 'SEND GUARD: bad receiver'
            const want = 'a9059cbb' + r.padStart(64, '0') + amount.toString(16).padStart(64, '0')
            if (data !== want) throw `SEND GUARD: token call data is not transfer(${receiver}, ${amount.toFixed()})`
            sentUnits = amount
        }

        return {
            txid: '0x' + tx.hash(true).toString('hex'),
            symbol: asset.symbol, chainId, from, to, nonce: nonce.toNumber(),
            receiver, sentUnits: sentUnits.toFixed(), valueWei: val.toFixed(),
            gasLimit: gasLimit.toFixed(), gasPriceWei: gasPrice.toFixed(), maxFeeWei: fee.toFixed(),
            limits: { maxGasPriceGwei: maxGasPriceWei.div(1e9).toFixed(), maxFeeEth: maxFeeWei.div(1e18).toFixed() },
        }
    },
}
