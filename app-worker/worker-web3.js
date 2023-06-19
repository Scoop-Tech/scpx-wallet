// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2023 Dominic Morris.

const axios = require('axios')
//const axiosRetry = require('axios-retry')
const BigNumber = require('bignumber.js')
const EthTx = require('ethereumjs-tx')

const configWS = require('../config/websockets')
const configWallet = require('../config/wallet')
const configExternal = require('../config/wallet-external')
const erc20ABI = require('../config/erc20ABI')

const walletExternal = require('../actions/wallet-external')

const utilsWallet = require('../utils')

module.exports = {
    web3_Disconnect_SocketProvider: (walletSymbols) => {
        var disconnectCount = 0
        for (var x in configWS.geth_ws_config) {
            if (self.web3_Sockets[x] !== undefined) {

                if (self.web3_Sockets[x].currentProvider && self.web3_Sockets[x].currentProvider.connection) {
                    self.web3_Sockets[x].currentProvider.connection.close()

                    self.web3_Sockets[x] = undefined
                    disconnectCount++
                }
            }
        }
        return disconnectCount
    },

    // maintains a single websocket web3 provider for lighter/faster eth & erc20 balance updates
    web3_Setup_SocketProvider: (walletSymbols) => {

        var setupCount = 0
        utilsWallet.debug(`appWorker >> ${self.workerId} web3_Setup_SocketProvider...`)

        for (var assetSymbol in configWS.geth_ws_config) {

            // exclude if not in the loaded wallet
            if (walletSymbols && walletSymbols.length > 0) {
                if (!walletSymbols.includes(assetSymbol)) { 
                    //utilsWallet.warn(`appWorker >> ${self.workerId} WEB3(WS) - web3_Setup_SocketProvider (skipping ${assetSymbol} - not in wallet)`, null, { logServerConsole: true })
                    continue
                }
            }
            
            if (assetSymbol === 'ETH_TEST') { if (!configWallet.WALLET_INCLUDE_ETH_TEST) continue }
            else if (!configWallet.getSupportedMetaKeyBySymbol(assetSymbol)) continue  

            setupCount += (function (x) {

                if (self.web3_Sockets[x] === undefined) {
                    utilsWallet.log(`appWorker >> ${self.workerId} WEB3(WS) - web3_Setup_SocketProvider ${x} SETUP...`, null, { logServerConsole: true })
                    
                    try {   
                        // geth: fails on geth v 1.8.2 w/ large web3 getTransactionDetail return packets (large ~= 16kb ?) -- gets EOF and hard-disconnects the WS from server
                        const Web3 = require('web3')
        
                        const web3 = new Web3(new Web3.providers.WebsocketProvider(configWS.geth_ws_config[x].url))
        
                        // parity: try-fix - https://github.com/ethereum/go-ethereum/issues/16846 ...
                        //const web3 = new Web3(new Web3.providers.WebsocketProvider(configWS.parityPubSub_ws_config[x].url))
                        
                        const provider = web3.currentProvider
                        self.web3_Sockets[x] = web3
                        utilsWallet.log(`appWorker >> ${self.workerId} WEB3(WS) - web3_Setup_SocketProvider ${x} SETUP OK - self.web3_Sockets[${x}]=`, self.web3_Sockets[x], { logServerConsole: true })
        
                        // these error/end handlers are *not* firing on the geth WS disconnect issue above ("unexpected EOF" from geth in WS response frame)
                        // if (provider) { 
                        //     provider.on("connect", data => { utilsWallet.log(`appWorker >> ${self.workerId} WEB3(WS) - socket connect, data=`, data) })
                        //     // set disconnect/error handlers
                        //     provider.on("error", socketErr => { 
                        //         debugger
                        //         utilsWallet.error(`appWorker >> ${self.workerId} WEB3(WS) - socket error callback, socketErr=`, socketErr.message)
                        //     })
                        //     provider.on("end", socketErr => {
                        //         debugger
                        //         utilsWallet.error(`appWorker >> ${self.workerId} WEB3(WS) - socket end, socketErr=`, socketErr.message)
                        //     })
                        // }
                    }
                    catch(err) {
                        utilsWallet.error(`appWorker >> ${self.workerId} WEB3(WS) - web3_Setup_SocketProvider - err=`, err)
                    }
                }

            })(assetSymbol)
        }
        return setupCount
    },

    estimateGasTx: (asset, params) => {
        
        const wsSymbol = asset.symbol === 'ETH_TEST' || asset.isErc20_Ropsten ? 'ETH_TEST'
                       : asset.symbol === 'ETH' || utilsWallet.isERC20(asset) ? 'ETH'
                       : asset.symbol

        return self.web3_Sockets[wsSymbol].eth.estimateGas(params)
    },

    // returns  { gasLimit, gasprice_Web3,                              // from web3
    //            gasprice_safeLow, gasprice_fast, gasprice_fastest     // from oracle(s)
    //          }
    getGasPrices: (asset, params) => { 
        utilsWallet.log(`fees - getGasPrices ${asset.symbol}, params=`, params)
        if (!params || !params.from || !params.to || !params.value) throw('Invalid fee parameters')
        var ret = {}

        const wsSymbol = asset.symbol === 'ETH_TEST' || asset.isErc20_Ropsten ? 'ETH_TEST'
                       : asset.symbol === 'ETH' || utilsWallet.isERC20(asset) ? 'ETH'
                       : asset.symbol

        // TODO: test this erc20's & eth...
        // note - params not used - anymore; we never need to actually call estimateGas()...
        // if (!utilsWallet.isERC20(asset)) {
        //     params.value = self.web3_Sockets[wsSymbol].utils.toWei(params.value.toString(), 'ether') // params for standard eth transfer
        // }

        // update: use static/known gasLimits for the erc20/eth send tx
        return (
            !utilsWallet.isERC20(asset)
                ? Promise.resolve(21000)  // vanilla eth payable() - known gas
                : Promise.resolve(100000) // erc20 - dummy: overridden below... //self.web3_Sockets[wsSymbol].eth.estimateGas(params) // ##
        )
        .then(gasLimit => {
            // use estimate if not erc20, otherwise use a reasonable static max gas value
            if (!utilsWallet.isERC20(asset)) {
                ret.gasLimit = gasLimit
            }
            else {
                if (!asset.erc20_transferGasLimit) {
                    utilsWallet.warn(`no erc20_transferGasLimit set for ${asset.symbol}; using fallback`)
                }
                ret.gasLimit = asset.erc20_transferGasLimit || configWallet.ETH_ERC20_TX_FALLBACK_WEI_GASLIMIT
            }
            console.log('getGasPrices 2 - self.web3_Sockets', self.web3_Sockets)
            console.log('wsSymbol', wsSymbol)
            return self.web3_Sockets[wsSymbol].eth.getGasPrice() // web3/eth node gas price - fallback value - ## race condition here? observerd: self.web3_Sockets={}
        })
        .then(gasprice_Web3 => {
            console.log('getGasPrices, gasprice_Web3=', gasprice_Web3)
            ret.gasprice_Web3 = parseFloat(gasprice_Web3)

            // removing: old API has gone, and now need to find one that has CORS headers on its responses...
            // e.g. https://ethgasstation.info/api/ethgasAPI.json - fails due to not CORS headers...
            //return axios.get(configExternal.ethFeeOracle_EtherGasStation) // oracle - main ##### BROKEN

            // so now we *rely* on our single node's web3.eth.getGasPrice() value:
            ret.gasprice_fast = ret.gasprice_Web3
            ret.gasprice_safeLow = Math.ceil(ret.gasprice_Web3 / 2)
            ret.gasprice_fastest = Math.ceil(ret.gasprice_Web3 * 2) 
            utilsWallet.log(`fees - getGasPrices ${asset.symbol}, ret=`, ret)
            return ret
        })
        // .then(res_Oracle => {
        //     if (res && res.data && !isNaN(res.data.safeLow) && !isNaN(res.data.fast) && !isNaN(res.data.fastest)) {
        //         // EIP 1559 - legacy tx; just add currentBaseFee for now
        //         utilsWallet.log(`res_Oracle - ${asset.symbol} - getGasPrices res.data`, res_Oracle.data)
        //         if (asset.symbol === 'ETH_TEST') {
        //             ret.gasprice_safeLow = Math.ceil(parseFloat(((0.05) * 1000000000 * 1))) // ropsten - to test eth cancel tx; use crazy low gas
        //             ret.gasprice_fast = Math.ceil(parseFloat(((1.5) * 1000000000 * 1))) 
        //             ret.gasprice_fastest = Math.ceil(parseFloat(((2.0) * 1000000000 * 1))) 
        //         }
        //         else {
        //             ret.gasprice_safeLow = Math.ceil(parseFloat(((res_Oracle.safeLow) * 1000000000 * 1))) // gwei -> wei
        //             ret.gasprice_fast = Math.ceil(parseFloat((((res_Oracle.safeLow + res_Oracle.fastest) / 2) * 1000000000 * 1)))
        //             ret.gasprice_fastest = Math.ceil(parseFloat(((res_Oracle.fastest) * 1000000000 * 1)))
        //         }
        //         utilsWallet.log(`res_Oracle - ${asset.symbol} - ret`, ret)
        //     } else { // fallback to web3
        //         utilsWallet.warn(`### fees - getGasPrices ${asset.symbol} UNEXPECTED DATA (oracle) - data=`, data)
        //         ret.gasprice_fast = ret.gasprice_Web3
        //         ret.gasprice_safeLow = Math.ceil(ret.gasprice_Web3 / 2)
        //         ret.gasprice_fastest = Math.ceil(ret.gasprice_Web3 * 2) 
        //     }
        //     utilsWallet.log(`fees - getGasPrices ${asset.symbol}, ret=`, ret)
        //     return ret
        // })
    },

    createTxHex_Eth: async (asset, params, privateKey) => {
        if (!params) {
            throw 'Invalid or missing parameters'
        }
        if (!params.gasLimit) {
            throw 'Invalid or missing parameters'
        }
        if (!params.gasPrice) {
            throw 'Invalid or missing parameters'
        }
        if (params.value === undefined) {
            throw 'Invalid or missing parameters'
        }
        if (!params.from) {
            throw 'Invalid or missing parameters'
        }
        if (!params.to) {
            throw 'Invalid or missing parameters'
        }

        utilsWallet.log(`*** createTxHex_Eth ${asset.symbol}, params=`, params)

        const wsSymbol = asset.symbol === 'ETH_TEST' || asset.isErc20_Ropsten ? 'ETH_TEST' 
                       : asset.symbol === 'ETH' || utilsWallet.isERC20(asset.symbol) ? 'ETH'
                       : asset.symbol

        const web3 = self.web3_Sockets[wsSymbol]
        var wei_sendValue = new BigNumber(web3.utils.toWei(params.value.toString(), 'ether'))
        var bal = walletExternal.get_combinedBalance(asset)
        var delta_avail = wei_sendValue.plus(new BigNumber(params.gasLimit).times(new BigNumber(params.gasPrice))).minus(bal.avail)
        if (delta_avail == 0) {
            utilsWallet.log('eth thxhex - appying send-max wei padding...')
            // hack: geth is (sometimes) not accepting transactions that send the full account balance
            // (tested very carefully -- values are exactly correct, minus fees:, all the way up to the hex conversions below)
            wei_sendValue = wei_sendValue.minus(configWallet.ETH_SENDMAX_PADDING_WEI)
        }
        wei_sendValue = wei_sendValue.toFixed() //wei_sendValue.toString() // ####

        utilsWallet.log('createTxHex_Eth - params.value=', params.value.toString())
        utilsWallet.log('createTxHex_Eth - params.gasLimit=', params.gasLimit)
        utilsWallet.log('createTxHex_Eth - params.gasPrice=', params.gasPrice)

        // repackage params for web3
        params.value = web3.utils.toHex(wei_sendValue)
        params.gasLimit = web3.utils.toHex(params.gasLimit)
        params.gasPrice = web3.utils.toHex(params.gasPrice)
        params.chainId = asset.symbol === 'ETH_TEST' || asset.isErc20_Ropsten ? 3        // ropsten
                       : asset.symbol === 'ETH' || utilsWallet.isERC20(asset.symbol) ? 1 // mainnet
                       : undefined
        if (!params.chainId) {
            throw 'Bad EIP 155 chainId'
        }
        utilsWallet.log('createTxHex_Eth - params.chainId=', params.chainId)

        var nextNonce = await web3.eth.getTransactionCount(params.from, 'pending') // ~100 bytes ('pending' - fixed in geth 1.8.21 https://github.com/ethereum/go-ethereum/issues/2880)
        try {
            params.nonce = nextNonce
            const tx = new EthTx(params)
            if (!privateKey)
                return { txParams: params }

            tx.sign(Buffer.from(privateKey.replace('0x', ''), 'hex'))

            utilsWallet.log(`createTxHex_Eth - ${asset.symbol}, nextNonce=${nextNonce}, tx=`, tx)

            return { txhex: '0x' + tx.serialize().toString('hex'),
              cu_sendValue: wei_sendValue }
        }
        catch (err) {
            utilsWallet.error(`### createTxHex_Eth ${asset.symbol} TX sign FAIL, error=`, err)
            return null
            //throw 'TX sign failed'
        }
    },

    createTxHex_erc20: (asset, params, privateKey) => {
        if (!params || !params.gasLimit || !params.gasPrice || params.value === undefined || !params.from || !params.to) {
            debugger
            throw 'Invalid or missing parameters'
        }

        utilsWallet.log(`*** createTxHex_erc20 ${asset.symbol}, params=`, params)
    
        const wsSymbol = asset.symbol === 'ETH_TEST' || asset.isErc20_Ropsten ? 'ETH_TEST' 
                       : asset.symbol === 'ETH' || utilsWallet.isERC20(asset.symbol) ? 'ETH'
                       : asset.symbol

        const web3 = self.web3_Sockets[wsSymbol]

        utilsWallet.log('createTxHex_erc20 - params.value=', params.value);
        utilsWallet.log('createTxHex_erc20 - params.value.toString()=', params.value.toString())

        const assetMeta = configWallet.getMetaBySymbol(asset.symbol)
        params.value = utilsWallet.toCalculationUnit(params.value.toString(), {
                type: configWallet.WALLET_TYPE_ACCOUNT,
         addressType: configWallet.ADDRESS_TYPE_ETH,
            decimals: assetMeta.decimals
        }).toFixed() //.toString() 

        const cu_sendValue = params.value
        utilsWallet.log('createTxHex_erc20 - wei=', params.value)

        params.value = web3.utils.toHex(params.value)
        utilsWallet.log('createTxHex_erc20 - params.value(toHex)=', params.value)

        utilsWallet.log('createTxHex_erc20 - params.gasLimit=', params.gasLimit)
        utilsWallet.log('createTxHex_erc20 - params.gasPrice=', params.gasPrice)

        params.chainId = asset.symbol === 'ETH_TEST' || asset.isErc20_Ropsten ? 3        // ropsten
                       : asset.symbol === 'ETH' || utilsWallet.isERC20(asset.symbol) ? 1 // mainnet
                       : undefined
        if (!params.chainId) {
            throw 'Bad EIP 155 chainId'
        }
        utilsWallet.log('createTxHex_erc20 - params.chainId=', params.chainId)

        const minContractABI = erc20ABI.abi
        const contractAddress = configExternal.walletExternal_config[asset.symbol].contractAddress
        const contract = new web3.eth.Contract(minContractABI, contractAddress, { from: params.from })
        
        return web3.eth.getTransactionCount(params.from, 'pending')
        .then((nextNonce) => {
            const txParams = {
                    from: params.from,
                   nonce: web3.utils.toHex(nextNonce),
                gasLimit: web3.utils.toHex(params.gasLimit),
                gasPrice: web3.utils.toHex(params.gasPrice),
                      to: contractAddress,
                   value: "0x0",
                    data: contract.methods.transfer(params.to, params.value).encodeABI(),
                 chainId: params.chainId,
            }
            if (!privateKey)
                return { txParams: txParams }

            const transaction = new EthTx(txParams)
            transaction.sign(Buffer.from(privateKey.replace('0x', ''), 'hex'))

            return { txhex: '0x' + transaction.serialize().toString('hex'), 
              cu_sendValue: cu_sendValue }
        })
    },

    pushRawTransaction_Account: (payTo, asset, txHex) => {
        const symbol = asset.symbol
        const ownAddresses = asset.addresses.map(p => { return p.addr })

        utilsWallet.log(`*** pushRawTransaction_Account ${symbol}, txHex=`, txHex)

        const wsSymbol = asset.symbol === 'ETH_TEST' || asset.isErc20_Ropsten ? 'ETH_TEST'
                       : asset.symbol === 'ETH' || utilsWallet.isERC20(asset.symbol) ? 'ETH'
                       : asset.symbol        

        const web3 = self.web3_Sockets[wsSymbol]
        // const Web3 = require('web3')
        // const web3 = new Web3(new Web3.providers.HttpProvider(configExternal.walletExternal_config[symbol].httpProvider))

        return new Promise((resolve) => {

            web3.eth.sendSignedTransaction(txHex, (err, txHash) => {
                if (err) {
                    utilsWallet.error(`*** pushRawTransaction_Account ${symbol} (callback), err=`, err, { logServerConsole: true })
                    //callback(null, err)
                    resolve({ res: null, err })
                }
                else {
                    web3.eth.getTransaction(txHash)
                    .then((txData) => {
                        //utilsWallet.debug(`push local_tx ${symbol}`, txData)

                        if (symbol === 'ETH' || symbol === 'ETH_TEST') {
                            const sendToSelf = ownAddresses.some(p => p === txData.to.toLowerCase())

                            //callback({
                            resolve({
                                res: {
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
                                              fees: Number((new BigNumber(txData.gas).div(new BigNumber(1000000000))).times((new BigNumber(txData.gasPrice).div(new BigNumber(1000000000))))),
                                             nonce: txData.nonce,
                                    }
                                },
                                err: null
                            })
                        }
                        else { // erc20
                            const sendToSelf = ownAddresses.some(p => p === payTo[0].receiver.toLowerCase())

                            const local_tx = { // LOCAL_TX (ERC20) OUT - caller will push to erc20's local_tx
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
                                          fees: Number((new BigNumber(txData.gas).div(new BigNumber(1000000000))).times((new BigNumber(txData.gasPrice).div(new BigNumber(1000000000))))),
                                         nonce: txData.nonce,
                            }
                            //utilsWallet.log('DBG1 - payTo[0].value=', payTo[0].value)
                            //utilsWallet.log('DBG1 - erc20 local_tx=', local_tx)
                            
                            // we push the erc20 eth send fee to eth's local_tx
                            
                            //store.dispatch({
                            //    type: actionsWallet.WCORE_PUSH_LOCAL_TX, payload: { symbol: 'ETH',
                            const erc20_ethFeeTx = { // LOCAL_TX eth tx for the erc20 send fee
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
                                          fees: Number((new BigNumber(txData.gas).div(new BigNumber(1000000000))).times((new BigNumber(txData.gasPrice).div(new BigNumber(1000000000))))),
                                         nonce: txData.nonce,
                            }
                            //})                        
                            
                            //callback({
                            resolve({ 
                                res: { tx: local_tx, erc20_ethFeeTx },
                                err: null,
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

                //callback(null, err)
                resolve({ res: null, err })
            })
        })
    },
}
