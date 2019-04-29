const axios = require('axios')
const axiosRetry = require('axios-retry')

// https://github.com/ethereum/web3.js/issues/2723
//const Web3 = require('web3')

const EthTx = require('ethereumjs-tx')
const BigNumber = require('bignumber.js')

const configWallet = require('../config/wallet')
const configExternal = require('../config/wallet-external')
const actionsWallet = require('../actions')
const erc20ABI = require('../config/erc20ABI')
const utilsWallet = require('../utils')

const walletExternal = require('./wallet-external') // ### ugly, maybe better these fn's in opsWallet

module.exports = {

    // test_web3: async () => {
    //     const Web3 = require('web3')
    //     const web3 = new Web3(new Web3.providers.HttpProvider(configExternal.walletExternal_config['ETH'].httpProvider))
    //     const height = await web3.eth.getBlockNumber()
    //     console.log('web3 >> height=', height)
    // },

    createTxHex_Account: async (symbol, params, privateKey) => {
        utilsWallet.debug(`*** createTxHex_Account ${symbol} (${params})...`)

        switch (symbol) {
            case 'ETH':
            case 'ETH_TEST':
                return await createETHTransactionHex(symbol, params, privateKey)
            default:
                return await createERC20TransactionHex(symbol, params, privateKey)
        }
    },

    pushRawTransaction_Account: (store, payTo, asset, txHex, callback) => {
        //const store = require('../store').store
        const symbol = asset.symbol
        const ownAddresses = asset.addresses.map(p => { return p.addr })

        utilsWallet.log(`*** pushRawTransaction_Account ${symbol}, txhex=`, txHex)
        const Web3 = require('web3')
        const web3 = new Web3(new Web3.providers.HttpProvider(configExternal.walletExternal_config[symbol].httpProvider))
        web3.eth.sendSignedTransaction(txHex, (err, txHash) => {
            if (err) {
                utilsWallet.error(`*** pushRawTransaction_Account ${symbol} (callback), err=`, err)
                callback(null, err)
            } else {
                web3.eth.getTransaction(txHash)
                .then((txData) => {
                    utilsWallet.debug(`push local_tx ${symbol}`, txData)

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
                        utilsWallet.log('DBG1 - payTo[0].value=', payTo[0].value)
                        utilsWallet.log('DBG1 - erc20 local_tx=', local_tx)
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
            utilsWallet.log(`*** pushRawTransaction_Account ${symbol} receipt= ${JSON.stringify(receipt)}`)
        })
        .catch((err) => {
            var errMsg = err.message || "Unknown error"
            const jsonNdxStart = errMsg.indexOf(':\n{')
            if (jsonNdxStart != -1) {
                errMsg = errMsg.substring(0, jsonNdxStart)
            }
            utilsWallet.error(`## pushRawTransaction_Account ${symbol} (catch) err=`, err)
            callback(null, err)
        })
    },

    // params: // { from, to, value } 
    estimateGasInEther: (asset, params) => {
        utilsWallet.debug(`fees - estimateGasInEther ${asset.symbol}, params=`, params)
        const Web3 = require('web3')
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
                    utilsWallet.warn(`no erc20_transferGasLimit set for ${asset.symbol}; using fallback`)
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
                utilsWallet.warn(`### fees - estimateGasInEther ${asset.symbol} UNEXPECTED DATA (oracle) - data=`, data)
                ret.gasprice_fast = ret.gasprice_Web3
                ret.gasprice_safeLow = Math.ceil(ret.gasprice_Web3 / 2)
                ret.gasprice_fastest = Math.ceil(ret.gasprice_Web3 * 2) 
            }
            return ret
        })
        // .catch((err) => {
        //     utilsWallet.error(`### fees - estimateGasInEther ${asset.symbol} FAIL - err=`, err)
        // })
    },
}

async function createETHTransactionHex(symbol, params, privateKey) {
    utilsWallet.log(`*** createETHTransactionHex ${symbol}, params=`, params)

    const Web3 = require('web3')
    const web3 = new Web3(new Web3.providers.HttpProvider(configExternal.walletExternal_config[symbol].httpProvider))

    if (params.gasLimit !== undefined) {

        var wei_sendValue = new BigNumber(web3.utils.toWei(params.value.toString(), 'ether'))

        var bal = walletExternal.get_combinedBalance(params.asset)
        var delta_avail = wei_sendValue.plus(new BigNumber(params.gasLimit).times(new BigNumber(params.gasPrice))).minus(bal.avail)

        utilsWallet.log('*** eth txhex - params.value=', params.value.toString())

        if (delta_avail == 0) {
            utilsWallet.log('eth thxhex - appying send-max wei padding...')
            // hack: geth is (sometimes) not accepting transactions that send the full account balance
            // (tested very carefully -- values are exactly correct, minus fees:, all the way up to the hex conversions below)
            wei_sendValue = wei_sendValue.minus(configWallet.ETH_SENDMAX_PADDING_WEI)
        }

        wei_sendValue = wei_sendValue.toString()

        utilsWallet.log('*** eth txhex - params.gasLimit=', params.gasLimit)
        utilsWallet.log('*** eth txhex - params.gasPrice=', params.gasPrice)

        // repackage params for web3
        params.value = web3.utils.toHex(wei_sendValue)
        params.gasLimit = web3.utils.toHex(params.gasLimit)
        params.gasPrice = web3.utils.toHex(params.gasPrice)
        params.asset = undefined

        //var nextNonce = await getNonce(web3, params.from) // way too heavy! ~3-4 MB 
        var nextNonce = await web3.eth.getTransactionCount(params.from, 'pending') // ~100 bytes ('pending' - fixed in geth 1.8.21 https://github.com/ethereum/go-ethereum/issues/2880)

        try {
            params.nonce = nextNonce
            const tx = new EthTx(params)

            utilsWallet.log(`*** createETHTransactionHex ${symbol}, nextNonce=${nextNonce}, tx=`, tx)

            tx.sign(Buffer.from(privateKey.replace('0x', ''), 'hex'))
            return { txhex: '0x' + tx.serialize().toString('hex'), cu_sendValue: wei_sendValue }
        }
        catch (err) {
            utilsWallet.warn(`### createETHTransactionHex ${symbol} TX sign FAIL, error=`, err)
            throw 'TX sign failed'
        }

    } else {
        throw 'gasLimit/Price should be passed in'
    }
}

function createERC20TransactionHex(symbol, params, privateKey) {
    utilsWallet.log(`*** createERC20TransactionHex ${symbol}, params=`, params)

    return new Promise((resolve, reject) => {
        if (params.gasLimit !== undefined) {

            const Web3 = require('web3')
            const web3 = new Web3(new Web3.providers.HttpProvider(configExternal.walletExternal_config[symbol].httpProvider))

            utilsWallet.log('erc20 - params.value=', params.value.toString())

            const assetMeta = configWallet.getMetaBySymbol(symbol)
            params.value = utilsWallet.toCalculationUnit(params.value.toString(), {
                    type: configWallet.WALLET_TYPE_ACCOUNT,
            addressType: configWallet.ADDRESS_TYPE_ETH,
                decimals: assetMeta.decimals
            }).toString() 

            const cu_sendValue = params.value
            utilsWallet.log('erc20 - wei=', params.value)

            params.value = web3.utils.toHex(params.value)

            utilsWallet.log('erc20 - params.gasLimit=', params.gasLimit)
            utilsWallet.log('erc20 - params.gasPrice=', params.gasPrice)

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
                    const transaction = new EthTx(rawTX)
                    transaction.sign(Buffer.from(privateKey.replace('0x', ''), 'hex'))

                    resolve({ txhex: '0x' + transaction.serialize().toString('hex'), cu_sendValue: cu_sendValue })
                })
        } else {
            reject('gasLimit/Price should be passed in')
        }
    })
}
 