// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.

const axios = require('axios')
const axiosRetry = require('axios-retry')

const configWS = require('../config/websockets')
const configWallet = require('../config/wallet')
const configExternal = require('../config/wallet-external')

const utilsWallet = require('../utils')

module.exports = {
    // maintains a single websocket web3 provider for lighter/faster eth & erc20 balance updates
    web3_Setup_SingletonSocketProvider: () => {
        if (self.ws_web3 === undefined) {
            utilsWallet.debug(`appWorker >> ${self.workerId} WEB3(WS) - SocketProvider SETUP...`, null, { logServerConsole: true })
            
            try {   

                // geth: fails on geth v 1.8.2 w/ large web3 getTransactionDetail return packets (large ~= 16kb ?) -- gets EOF and hard-disconnects the WS from server
                const Web3 = require('web3')

                const web3 = new Web3(new Web3.providers.WebsocketProvider(configWS.geth_ws_config['ETH'].url))

                // parity: try-fix - https://github.com/ethereum/go-ethereum/issues/16846 ...
                //const web3 = new Web3(new Web3.providers.WebsocketProvider(configWS.parityPubSub_ws_config['ETH'].url))
                
                const provider = web3.currentProvider
                self.ws_web3 = web3

                // these error/end handlers are *not* firing on the geth WS disconnect issue above ("unexpected EOF" from geth in WS response frame)
                // if (provider) { 
                //     provider.on("connect", data => { utilsWallet.log(`appWorker >> ${self.workerId} WEB3(WS) - socket connect, data=`, data) })
                    
                //     // set disconnect/error handlers
                //     provider.on("error", socketErr => { 
                //         debugger
                //         utilsWallet.error(`appWorker >> ${self.workerId} WEB3(WS) - socket error callback, socketErr=`, socketErr.message)
                //         self.ws_web3 = undefined 
                //     })
                //     provider.on("end", socketErr => {
                //         debugger
                //         utilsWallet.error(`appWorker >> ${self.workerId} WEB3(WS) - socket end, socketErr=`, socketErr.message)
                //         self.ws_web3 = undefined
                //     })
                // }
            }
            catch(err) {
                utilsWallet.error(`appWorker >> ${self.workerId} WEB3(WS) - err=`, err)
            }
        }
    },

    // returns  { gasLimit, gasprice_Web3,                              // from web3
    //            gasprice_safeLow, gasprice_fast, gasprice_fastest     // from oracle(s)
    //          }
    estimateGasInEther: (asset, params) => { 
        utilsWallet.debug(`fees - estimateGasInEther ${asset.symbol}, params=`, params)
        if (!params || !params.from || !params.to || !params.value) throw('Invalid fee parameters')
        var ret = {}

        if (!utilsWallet.isERC20(asset)) {
            params.value = self.ws_web3.utils.toWei(params.value.toString(), 'ether') // params for standard eth transfer
        }

        return self.ws_web3.eth.estimateGas(params)  // tx gas limit estimate
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

            return self.ws_web3.eth.getGasPrice() // web3/eth node gas price - fallback value
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
    }

}
