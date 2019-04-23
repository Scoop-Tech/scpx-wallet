import axios from 'axios'
import axiosRetry from 'axios-retry'
import Web3 from 'web3'
import Tx from 'ethereumjs-tx'
import BigNumber from 'bignumber.js'

import * as configWallet from '../config/wallet'
import * as configExternal from '../config/wallet-external'
import * as actionsWallet from '../actions'
import * as erc20ABI from '../config/erc20ABI'
import * as utilsWallet from '../utils'

import { get_combinedBalance } from './wallet-external'

export async function createTxHex_Account(symbol, params, privateKey) {
    console.log(`*** createTxHex_Account ${symbol} (${params})...`)

    switch (symbol) {
        case 'ETH':
        case 'ETH_TEST':
            return await createETHTransactionHex(symbol, params, privateKey)
        default:
            return await createERC20TransactionHex(symbol, params, privateKey)
    }
}

export function pushRawTransaction_Account(store, payTo, asset, txHex, callback) {
    //const store = require('../store').store
    const symbol = asset.symbol
    const ownAddresses = asset.addresses.map(p => { return p.addr })

    console.log(`*** pushRawTransaction_Account ${symbol} (${txHex})...`)
    const web3 = new Web3(new Web3.providers.HttpProvider(configExternal.walletExternal_config[symbol].httpProvider))
    web3.eth.sendSignedTransaction(txHex, (err, txHash) => {
        if (err) {
            console.error(`*** pushRawTransaction_Account ${symbol} (callback), err=`, err)
            callback(null, err)
        } else {
            web3.eth.getTransaction(txHash)
            .then((txData) => {
                console.log(`push local_tx ${symbol}`, txData)

                if (symbol === 'ETH' || symbol === 'ETH_TEST') {
                    const sendToSelf = ownAddresses.some(p => p === txData.to.toLowerCase())

                    callback({
                        tx: { // LOCAL_TX (ETH) OUT - caller will push to eth local_tx
                            txid: txHash,
                            isIncoming: false,
                            sendToSelf,
                            date: new Date(),
                            value: Number(web3.utils.fromWei(txData.value, 'ether')),
                            toOrFrom: txData.to.toLowerCase(),
                            account_to: txData.to.toLowerCase(),
                            account_from: txData.from.toLowerCase(),
                            block_no: -1,
                            fees: Number((new BigNumber(txData.gas).div(new BigNumber(1000000000))).times((new BigNumber(txData.gasPrice).div(new BigNumber(1000000000)))))
                        }
                    }, null)
                }
                else { // erc20
                    const sendToSelf = ownAddresses.some(p => p === payTo[0].receiver.toLowerCase())

                    const local_tx =  { // LOCAL_TX (ERC20) OUT - caller will push to erc20's local_tx
                        erc20: symbol,
                        erc20_contract: txData.to,
                        txid: txHash,
                        isIncoming: false,
                        sendToSelf,
                        date: new Date(),
                        value: Number(payTo[0].value),
                        toOrFrom: payTo[0].receiver.toLowerCase(),
                        account_to: payTo[0].receiver.toLowerCase(),
                        account_from: payTo.senderAddr.toLowerCase(),
                        block_no: -1,
                        fees: Number((new BigNumber(txData.gas).div(new BigNumber(1000000000))).times((new BigNumber(txData.gasPrice).div(new BigNumber(1000000000)))))
                    }
                    console.log('DBG1 - payTo[0].value=', payTo[0].value)
                    console.log('DBG1 - erc20 local_tx=', local_tx)
                    callback({
                        tx: local_tx
                    }, null)

                    // we push the erc20 eth send fee to eth's local_tx
                    store.dispatch({
                        type: actionsWallet.WCORE_PUSH_LOCAL_TX, payload: {
                            symbol: 'ETH', tx: { // LOCAL_TX the fee for erc20 send
                                erc20: symbol,
                                erc20_contract: txData.to,
                                txid: txHash,
                                isIncoming: false,
                                date: new Date(),
                                value: 0,
                                toOrFrom: txData.to.toLowerCase(), // payable to contract
                                account_to: txData.to.toLowerCase(),
                                account_from: payTo.senderAddr.toLowerCase(),
                                block_no: -1,
                                fees: Number((new BigNumber(txData.gas).div(new BigNumber(1000000000))).times((new BigNumber(txData.gasPrice).div(new BigNumber(1000000000)))))
                            }
                        }
                    })
                }
            })
        }
    })
    .then((receipt) => {
        // web3 beta41 -- after getting receipt, an (internal?) getTransaction calls fails, but doesn't seem to affect anything
        console.log(`*** pushRawTransaction_Account ${symbol} receipt= ${JSON.stringify(receipt)}`)
    })
    .catch((err) => {
        var errMsg = err.message || "Unknown error"
        const jsonNdxStart = errMsg.indexOf(':\n{')
        if (jsonNdxStart != -1) {
            errMsg = errMsg.substring(0, jsonNdxStart)
        }
        console.error(`## pushRawTransaction_Account ${symbol} (catch) err=`, err)
        callback(null, err)
    })
}

async function createETHTransactionHex(symbol, params, privateKey) {
    console.log(`*** createETHTransactionHex ${symbol}, params=`, params)

    const web3 = new Web3(new Web3.providers.HttpProvider(configExternal.walletExternal_config[symbol].httpProvider))

    if (params.gasLimit !== undefined) {

        var wei_sendValue = new BigNumber(web3.utils.toWei(params.value.toString(), 'ether'))

        var bal = get_combinedBalance(params.asset)
        var delta_avail = wei_sendValue.plus(new BigNumber(params.gasLimit).times(new BigNumber(params.gasPrice))).minus(bal.avail)

        console.log('eth txhex - params.value=', params.value.toString())

        if (delta_avail == 0) {
            console.log('eth thxhex - appying send-max wei padding...')
            // hack: geth is (sometimes) not accepting transactions that send the full account balance
            // (tested very carefully -- values are exactly correct, minus fees:, all the way up to the hex conversions below)
            wei_sendValue = wei_sendValue.minus(configWallet.ETH_SENDMAX_PADDING_WEI)
        }

        wei_sendValue = wei_sendValue.toString()

        console.log('eth txhex - params.gasLimit=', params.gasLimit)
        console.log('eth txhex - params.gasPrice=', params.gasPrice)

        // repackage params for web3
        params.value = web3.utils.toHex(wei_sendValue)
        params.gasLimit = web3.utils.toHex(params.gasLimit)
        params.gasPrice = web3.utils.toHex(params.gasPrice)
        params.asset = undefined

        //var nextNonce = await getNonce(web3, params.from) // way too heavy! ~3-4 MB 
        var nextNonce = await web3.eth.getTransactionCount(params.from, 'pending') // ~100 bytes ('pending' - fixed in geth 1.8.21 https://github.com/ethereum/go-ethereum/issues/2880)

        try {
            params.nonce = nextNonce
            const tx = new Tx(params)

            console.log(`*** createETHTransactionHex ${symbol}, nextNonce=${nextNonce}, tx=`, tx)

            tx.sign(Buffer.from(privateKey.replace('0x', ''), 'hex'))
            return { txhex: '0x' + tx.serialize().toString('hex'), cu_sendValue: wei_sendValue }
        }
        catch (err) {
            console.warn(`### createETHTransactionHex ${symbol} TX sign FAIL, error=`, err)
            throw 'TX sign failed'
        }

    } else {
        throw 'gasLimit/Price should be passed in'
    }
}

function createERC20TransactionHex(symbol, params, privateKey) {
    console.log(`*** createERC20TransactionHex ${symbol}, params=`, params)

    return new Promise((resolve, reject) => {
        if (params.gasLimit !== undefined) {

            const web3 = new Web3(new Web3.providers.HttpProvider(configExternal.walletExternal_config[symbol].httpProvider))

            console.log('erc20 - params.value=', params.value.toString())

            const assetMeta = configWallet.getMetaBySymbol(symbol)
            params.value = utilsWallet.toCalculationUnit(params.value.toString(), {
                    type: configWallet.WALLET_TYPE_ACCOUNT,
             addressType: configWallet.ADDRESS_TYPE_ETH,
                decimals: assetMeta.decimals
            }).toString() 

            debugger
            const cu_sendValue = params.value
            console.log('erc20 - wei=', params.value)

            params.value = web3.utils.toHex(params.value)

            console.log('erc20 - params.gasLimit=', params.gasLimit)
            console.log('erc20 - params.gasPrice=', params.gasPrice)

            const minContractABI = erc20ABI.abi
            const contractAddress = configExternal.walletExternal_config[symbol].contractAddress
            const contract = new web3.eth.Contract(minContractABI, contractAddress, { from: params.from })

            web3.eth.getTransactionCount(params.from, 'pending')
                .then((nextNonce) => {
                    const rawTX = {
                        from: params.from,
                        nonce: web3.utils.toHex(nextNonce),
                        gasLimit: web3.utils.toHex(params.gasLimit),
                        gasPrice: web3.utils.toHex(params.gasPrice),
                        to: contractAddress,
                        value: "0x0",
                        data: contract.methods.transfer(params.to, params.value).encodeABI()
                    }
                    const transaction = new Tx(rawTX)
                    transaction.sign(Buffer.from(privateKey.replace('0x', ''), 'hex'))

                    resolve({ txhex: '0x' + transaction.serialize().toString('hex'), cu_sendValue: cu_sendValue })
                })
        } else {
            reject('gasLimit/Price should be passed in')
        }
    })
}

// params: // { from, to, value } 
export function estimateGasInEther(asset, params) {
    console.log(`fees - estimateGasInEther ${asset.symbol}, params=`, params)
    const web3 = new Web3(new Web3.providers.HttpProvider(configExternal.walletExternal_config[asset.symbol].httpProvider))

    var ret = {}
    // = { gasLimit, gasprice_Web3,                              // from web3
    //     gasprice_safeLow, gasprice_fast, gasprice_fastest     // from oracle(s)
    //   }

    if (!utilsWallet.isERC20(asset)) {
        params.value = web3.utils.toWei(params.value.toString(), 'ether') // params for standard eth transfer
    }

    return web3.eth.estimateGas(params)  // tx gas limit estimate
    .then(gasLimit => {

        // use estimate if not erc20, otherwise use a reasonable static max gas value
        if (!utilsWallet.isERC20(asset)) {
            ret.gasLimit = gasLimit
        }
        else {
            if (!asset.erc20_transferGasLimit)
                console.warn(`no erc20_transferGasLimit set for ${asset.symbol}; using fallback`)
            ret.gasLimit = asset.erc20_transferGasLimit || configWallet.ETH_ERC20_TX_FALLBACK_WEI_GASLIMIT
        }

        return web3.eth.getGasPrice() // web3/eth node gas price - fallback value
    })
    .then(gasprice_Web3 => {
        ret.gasprice_Web3 = parseFloat(gasprice_Web3)
        axiosRetry(axios, configWallet.AXIOS_RETRY_3PBP)
        return axios.get(configExternal.ethFeeOracle_EtherChainOrg) // oracle - main
    })
    .then(res => {
        if (res && res.data && !isNaN(res.data.safeLow) && !isNaN(res.data.fast) && !isNaN(res.data.fastest)) {
            ret.gasprice_safeLow = Math.ceil(parseFloat((res.data.safeLow * 1000000000))) // gwei -> wei
            ret.gasprice_fast = Math.ceil(parseFloat((res.data.fast * 1000000000)))
            ret.gasprice_fastest = Math.ceil(parseFloat((res.data.fastest * 1000000000)))

        } else { // fallback to web3
            console.warn(`### fees - estimateGasInEther ${asset.symbol} UNEXPECTED DATA (oracle) - data=`, data)
            ret.gasprice_fast = ret.gasprice_Web3
            ret.gasprice_safeLow = Math.ceil(ret.gasprice_Web3 / 2)
            ret.gasprice_fastest = Math.ceil(ret.gasprice_Web3 * 2) 
        }
        return ret
    })
    // .catch((err) => {
    //     console.error(`### fees - estimateGasInEther ${asset.symbol} FAIL - err=`, err)
    // })
}