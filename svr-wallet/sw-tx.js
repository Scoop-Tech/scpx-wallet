// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.

const Keygen = require('eosjs-keygen').Keygen
const _ = require('lodash')

const configWallet = require('../config/wallet')
const walletExternal = require('../actions/wallet-external')
const utilsWallet = require('../utils')

const opsWallet = require('../actions/wallet')

const log = require('../cli-log')

//
// transaction-related wallet functions
//

module.exports = {

    // creates and broadcasts the specified tx
    txPush: async (appWorker, store, p) => {
        var { mpk, apk, s, v, a } = p
        const h_mpk = utilsWallet.pbkdf2(apk, mpk)

        // validate
        const { err, wallet, asset, du_sendValue } = await validateSymbolValue(store, s, v)
        if (err) return Promise.resolve({ err })
        if (utilsWallet.isParamEmpty(a)) return Promise.resolve({ err: `Receiver address is required` })
        const receiverAddr = a

        const addrIsValid = opsWallet.validateAssetAddress({ 
                 testSymbol: asset.symbol,
            testAddressType: asset.addressType,
               validateAddr: receiverAddr
        })
        if (!addrIsValid) return Promise.resolve({ err: `Invalid ${asset.symbol} address` })

        // get fee
        const txGetFee = await module.exports.txGetFee(appWorker, store, p)
        if (txGetFee.err) return Promise.resolve({ err: txGetFee.err })

        // send
        const feeParams = { txFee: txGetFee.ok.txFee }
        const payTo = [{ receiver: receiverAddr, value: du_sendValue }]
        return new Promise((resolve) => {
            walletExternal.createAndPushTx( { 
                            store: store,
                            payTo: payTo,
                           wallet: wallet,
                            asset: asset,
                        feeParams: feeParams,
                  sendFromAddrNdx: -1, // utxo: use all available address indexes
                     activePubKey: apk,
                            h_mpk: h_mpk,
            }, (res, err) => {
                if (err) { 
                    resolve({ err })
                }
                else {
                    resolve({ ok: { txid: res.tx.txid, txGetFee } })
                }
            })
        })
    },

    // gets network fee for the specified tx
    txGetFee: async (appWorker, store, p) => {
        var { mpk, apk, s, v } = p
        const h_mpk = utilsWallet.pbkdf2(apk, mpk)

        // validate
        const { err, wallet, asset, du_sendValue } = await validateSymbolValue(store, s, v)
        if (err) return Promise.resolve({ err })

        // get tx fee
        const feeData = await opsWallet.getAssetFeeData(asset)
        try {
            const txFee = await walletExternal.computeTxFee({
                        asset: asset,
                      feeData,
                    sendValue: du_sendValue,
           encryptedAssetsRaw: wallet.assetsRaw, 
                   useFastest: false, useSlowest: false, //...
                 activePubKey: apk,
                        h_mpk,
            })

            return Promise.resolve({ ok: { txFee, feeData } })
        }
        catch(err) {
            return Promise.resolve({ err })
        }
    }
}

function validateSymbolValue(store, s, v) {
    const wallet = store.getState().wallet
    if (utilsWallet.isParamEmpty(s)) return Promise.resolve({ err: `Asset symbol is required` })
    const asset = wallet.assets.find(p => p.symbol.toLowerCase() === s.toLowerCase())
    if (!asset) return Promise.resolve({ err: `Invalid asset symbol "${s}"` })

    if (utilsWallet.isParamEmpty(v)) return Promise.resolve({ err: `Asset value is required` })
    if (isNaN(v)) return Promise.resolve({ err: `Invalid asset value` })
    const du_sendValue = Number(v)
    if (du_sendValue < 0) return Promise.resolve({ err: `Asset value cannot be negative` })

    return Promise.resolve({ asset, wallet, du_sendValue })
}