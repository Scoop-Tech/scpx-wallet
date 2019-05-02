// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.

const _ = require('lodash')

const configWallet = require('../config/wallet')
const walletExternalActions = require('../actions/wallet-external')

const workerInsight = require('./worker-insight')
const workerAccount = require('./worker-account')
const workerBlockbook = require('./worker-blockbook')

const utilsWallet = require('../utils')

module.exports = {

    getAddressFull_External: (p, callback) => {
        return getAddressFull_External(p, callback)
    },

    getAddressBalance_External: (p, callback) => {
        return getAddressBalance_External(p, callback)
    },
}

function getAddressFull_External(p, callback) { // todo: accept already fetched balanceData, from getAddressBalance_External, so we don't query it twice
    const { wallet, asset, addrNdx, utxo_mempool_spentTxIds, bbSocket } = p
    utilsWallet.debug(`getAddressFull_External - ${asset.symbol} addrNdx=${addrNdx}...`)

    var allDispatchActions = []
    switch (asset.type) {

        case configWallet.WALLET_TYPE_UTXO:
            const fullUpdateFn = asset.use_BBv3 
                ? workerBlockbook.getAddressFull_Blockbook_v3
                : workerInsight.getAddressFull_Insight_v2

            fullUpdateFn(wallet, asset, asset.addresses[addrNdx].addr, utxo_mempool_spentTxIds, allDispatchActions)
            .then(res => {
                if (res) {
                    const dispatchAction = walletExternalActions.getAddressFull_ProcessResult(res, asset, addrNdx)
                    if (dispatchAction !== null) {
                        allDispatchActions = [...allDispatchActions, dispatchAction]
                    }
                    callback(allDispatchActions)
                }
                else {
                    callback([])
                }
            })
            break

        case configWallet.WALLET_TYPE_ACCOUNT:
            workerAccount.getAddressFull_Account_v2(wallet, asset, asset.addresses[addrNdx].addr, bbSocket, allDispatchActions, (res) => {
                if (res) {
                    const dispatchAction = walletExternalActions.getAddressFull_ProcessResult(res, asset, addrNdx)
                    if (dispatchAction !== null) {
                        allDispatchActions = [...allDispatchActions, dispatchAction]
                    }
                }
                callback(allDispatchActions)
            })
            break

        default:
            utilsWallet.error('Wallet type ' + asset.type + ' not supported!')
            callback([])
            break
    }
}

function getAddressBalance_External(p, callback) {
    const { wallet, asset, addrNdx, utxo_mempool_spentTxIds, bbSocket } = p
    utilsWallet.debug(`getAddressBalance - EXTERNAL - ${asset.symbol} addrNdx=${addrNdx}...`)

    switch (asset.type) {
        case configWallet.WALLET_TYPE_UTXO:
            const balanceUpdateFn = asset.use_BBv3 
                ? workerBlockbook.getAddressBalance_Blockbook_v3
                : workerInsight.getAddressBalance_Insight

            balanceUpdateFn(asset, asset.addresses[addrNdx].addr)
            .then(res => {
                if (res !== undefined && res !== null) {
                    const balanceData = { 
                        balance: res.balance, 
                        unconfirmedBalance: res.unconfirmedBalance,
                    }

                    if (configWallet.TEST_LARGE_BALANCE > 0) res.balance = configWallet.TEST_LARGE_BALANCE

                    utilsWallet.debug(`getAddressBalance - UTXO - ${asset.symbol} addrNdx=${addrNdx}`)

                    // refresh tx history for address, if balance changed
                    if (asset.addresses[addrNdx].balance !== res.balance
                    || asset.addresses[addrNdx].unconfirmedBalance !== res.unconfirmedBalance) {
                        //utilsWallet.log(`*** getAddressBalance - ${asset.symbol} - addrNdx=${addrNdx} - UTXO BALANCE UPDATE: refreshing TX HIST`)
                        
                        // todo: pass in balanceData; getAddressFull should use this data instead of querying balance (again)
                        getAddressFull_External({ wallet, asset, addrNdx, utxo_mempool_spentTxIds, bbSocket }, (dispatchActions) => {
                            callback(dispatchActions)
                        })
                    }
                    else {
                        callback([])
                    }

                } else { 
                    utilsWallet.error(`## getAddressBalance - WALLET_TYPE_UTXO -- undefined response!`)
                    callback([])
                }
            })
            .catch((err) => {
                utilsWallet.error(`## getAddressBalance FAIL ${asset.symbol}`, err)
                callback([])
            })
            break

        case configWallet.WALLET_TYPE_ACCOUNT:
            workerAccount.getAddressBalance_Account(asset.symbol, asset.addresses[addrNdx].addr)
            .then(res => {
                const balanceData = { 
                    balance: res.bal, 
                    unconfirmedBalance: "0"
                }

                if (configWallet.TEST_LARGE_BALANCE > 0) res = configWallet.TEST_LARGE_BALANCE
                utilsWallet.debug(`getAddressBalance - ACCOUNT - ${asset.symbol} addrNdx=${addrNdx}`)

                // refresh tx history for address, if balance changed 
                if (asset.addresses[addrNdx].balance !== balanceData.balance || 
                    asset.addresses[addrNdx].unconfirmedBalance !== balanceData.unconfirmedBalance) {
                    //utilsWallet.log(`*** getAddressBalance - ${asset.symbol} - addrNdx=${addrNdx} - ACCOUNT BALANCE UPDATE: refreshing TX HIST`)

                    // todo: pass in balanceData; getAddressFull should use this data instead of querying balance (again)
                    return getAddressFull_External({ wallet, asset, addrNdx, utxo_mempool_spentTxIds: undefined, bbSocket }, (dispatchActions) => {
                        callback(dispatchActions)
                    })
                }
                else {
                    callback([])
                }
            })
            .catch((err) => { 
                utilsWallet.error(`## getAddressBalance FAIL ${asset.symbol}`, err)
                callback([])
            })

            // if (asset.symbol === 'EOS') ; // todo
            // else if (asset.symbol === 'ETH' || asset.symbol === 'ETH_TEST') {
            //     // ETH v2 -- query eth & all erc20 balances
            //     debugger
            //     const updateAssets = wallet.assets.filter(p => utils.isERC20(p)).concat(asset)
            //     const addressUpdates = updateAssets.map(p => { return workerAccount.getAddressBalance_Account(p.symbol, p.addresses[addrNdx].addr) })
            //     Promise.all(addressUpdates)
            //     .then((updatedBalances) => {
            //         // any eth or erc20 balance changed?
            //         var anyBalancesChanged = false
            //         updatedBalances.forEach(balData => {
            //             const asset = wallet.assets.find(p2 => p2.symbol === balData.symbol)
            //             const balChanged = asset.balance !== balData.bal
            //             if (balChanged) {
            //                 anyBalancesChanged = true
            //                 utilsWallet.log(`getAddressBalance - WALLET_TYPE_ACCOUNT - >> BALANCE CHANGED << ${balData.symbol} @ addrNdx=${addrNdx}...`)
            //             }
            //         })
            //         // update eth tx's if so
            //         if (anyBalancesChanged) {
            //             getAddressFull_External({ wallet, asset, addrNdx, utxo_mempool_spentTxIds: undefined, bbSocket })
            //             //....
            //         }
            //     })
            //}
            break
            
        default:
            utilsWallet.error('Wallet type ' + asset.type + ' not supported!')
            callback([])
            break
    }
}
