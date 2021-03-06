// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2021 Dominic Morris.

const actionsWallet = require('.')
const utilsWallet = require('../utils')

module.exports = {

    // test_web3: async () => {
    //     const Web3 = require('web3')
    //     const web3 = new Web3(new Web3.providers.HttpProvider(configExternal.walletExternal_config['ETH'].httpProvider))
    //     const height = await web3.eth.getBlockNumber()
    //     console.log('web3 >> height=', height)
    // },
    
    createTxHex_Account: async ({ asset, params, privateKey }) => {
        //utilsWallet.debug(`*** createTxHex_Account ${asset.symbol}...`, params)
        switch (asset.symbol) {
            case 'ETH':
            case 'ETH_TEST':
                return await createTxHex_Eth(asset, params, privateKey)
            default:
                return await createTxHex_erc20(asset, params, privateKey)
        }
    },

    estimateTxGas_Account: async ({ asset, params }) => {
        //utilsWallet.debug(`*** estimateTxGas_Account ${asset.symbol}...`, params)
        const op = new Promise((resolve, reject) => {
            const appWorker = utilsWallet.getAppWorker()
            const listener = function(event) {
                const input = utilsWallet.unpackWorkerResponse(event)
                if (input) {
                    if (input.msg === 'GET_ETH_ESTIMATE_TX_GAS_DONE') {
                        const assetSymbol = input.data.assetSymbol
                        if (assetSymbol === asset.symbol) {
                            utilsWallet.log(`GET_ETH_ESTIMATE_TX_GAS_DONE, input.data=`, input.data)
                            resolve(input.data.fees)
                            appWorker.removeEventListener('message', listener)
                        }
                    }
                }
            }
            appWorker.addEventListener('message', listener)
            appWorker.postMessageWrapped({ msg: 'GET_ETH_ESTIMATE_TX_GAS', data: { asset, params } })
        })
        return await op
    },

    pushRawTransaction_Account: (store, asset, payTo, txHex, callback) => {
        const appWorker = utilsWallet.getAppWorker()
        const listener = function(event) {
            const input = utilsWallet.unpackWorkerResponse(event)
            if (input) {
                if (input.msg === 'PUSH_TX_WEB3_DONE') {
                    if (input.data.assetSymbol === asset.symbol) {
                        appWorker.removeEventListener('message', listener)

                        // notify caller
                        const res = input.data.res
                        const err = input.data.err
                            if (res && res.tx) {
                            callback({ tx: res.tx }, null)
                        }
                        else {
                            callback(null, err)
                        }

                        // push local eth fee tx for an erc20 push
                        if (res && res.erc20_ethFeeTx) {
                            store.dispatch({ type: actionsWallet.WCORE_PUSH_LOCAL_TX,
                                          payload: {
                                              symbol: asset.symbol === 'ETH_TEST' || asset.isErc20_Ropsten
                                                        ? 'ETH_TEST' : 'ETH',
                                                  tx: res.erc20_ethFeeTx }
                            })
                        }
                    }
                }
            }
        }
        appWorker.addEventListener('message', listener)
        appWorker.postMessageWrapped({ msg: 'PUSH_TX_WEB3', data: { payTo, asset, txHex } })
    },
}

function createTxHex_Eth(asset, params, privateKey) {
    return new Promise((resolve, reject) => {
        const appWorker = utilsWallet.getAppWorker()
        const listener = function(event) {
            const input = utilsWallet.unpackWorkerResponse(event)
            if (input) {
                if (input.msg === 'GET_ETH_TX_HEX_WEB3_DONE') {
                    const assetSymbol = input.data.assetSymbol
                    const txHex = input.data.txHex
                    if (assetSymbol === asset.symbol) {
                        utilsWallet.log(`GET_ETH_TX_HEX_WEB3_DONE, input.data=`, input.data)
                        resolve(txHex)
                        appWorker.removeEventListener('message', listener)
                    }
                }
            }
        }
        appWorker.addEventListener('message', listener)
        appWorker.postMessageWrapped({ msg: 'GET_ETH_TX_HEX_WEB3', data: { asset, params, privateKey } })
    })
}

function createTxHex_erc20(asset, params, privateKey) {
    return new Promise((resolve, reject) => {
        const appWorker = utilsWallet.getAppWorker()
        const listener = function(event) {
            const input = utilsWallet.unpackWorkerResponse(event)
            if (input) {
                if (input.msg === 'GET_ERC20_TX_HEX_WEB3_DONE') {
                    const assetSymbol = input.data.assetSymbol
                    const txHex = input.data.txHex
                    if (assetSymbol === asset.symbol) {
                        utilsWallet.log(`GET_ERC20_TX_HEX_WEB3_DONE, input.data=`, input.data)
                        resolve(txHex)
                        appWorker.removeEventListener('message', listener)
                    }
                } 
            }
        }
        appWorker.addEventListener('message', listener)
        appWorker.postMessageWrapped({ msg: 'GET_ERC20_TX_HEX_WEB3', data: { asset, params, privateKey } })
    })   
}
 