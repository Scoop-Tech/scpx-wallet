// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2021 Dominic Morris.

const Keygen = require('eosjs-keygen').Keygen
const bitcoinJsLib = require('bitcoinjs-lib')
const _ = require('lodash')

const configWallet = require('../config/wallet')
const walletExternal = require('../actions/wallet-external')

const opsWallet = require('../actions/wallet')

const utilsWallet = require('../utils')

const log = require('../sw-cli-log')

//
// transaction-related wallet functions
//

module.exports = {

    // creates and broadcasts the specified tx
    txPush: async (appWorker, store, p) => {
        var { mpk, apk, symbol, value, to, from, dsigCltvPubKey } = p
        const h_mpk = utilsWallet.pbkdf2(apk, mpk)
        log.cmd('txPush')
        log.param('mpk', process.env.NODE_ENV === 'test' ? '[secure]' : mpk)
        log.param('symbol', symbol)
        log.param('value', value)
        log.param('to', to)
        log.param('from', from)
        log.param('dsigCltvPubKey', dsigCltvPubKey) 

        // validate from addr
        const { err, wallet, asset, du_sendValue } = await utilsWallet.validateSymbolValue(store, symbol, value)
        if (err) return Promise.resolve({ err })
        if (utilsWallet.isParamEmpty(to)) return Promise.resolve({ err: `To address is required` })

        // account-type: map supplied from-addr to addr-index
        var sendFromAddrNdx = -1 // utxo: use all available address indexes
        if (asset.type === configWallet.WALLET_TYPE_ACCOUNT) { 
            // account: use specific address index
            if (utilsWallet.isParamEmpty(from)) return Promise.resolve({ err: `From address is required` })
            sendFromAddrNdx = asset.addresses.findIndex(p => p.addr.toLowerCase() === from.toLowerCase())
            if (sendFromAddrNdx == -1) return Promise.resolve({ err: `Invalid from address` })

            // account: disallow protect_op
            if (!utilsWallet.isParamEmpty(dsigCltvPubKey)) return Promise.resolve({ err: `Invalid op for account-type asset` })
        }
        else {
            // utxo: validate 
            if (!utilsWallet.isParamEmpty(from)) return Promise.resolve({ err: `From address is not supported for UTXO-types` })
            if ((!utilsWallet.isParamEmpty(dsigCltvPubKey))
                && symbol !== 'BTC_TEST') return Promise.resolve({ err: `Invalid op for UTXO-type asset` })
        }

        // validate to addr
        const toAddr = to
        const toAddrIsValid = opsWallet.validateAssetAddress({ testSymbol: asset.symbol, testAddressType: asset.addressType, validateAddr: toAddr })
        if (!toAddrIsValid) return Promise.resolve({ err: `Invalid ${asset.symbol} to address` })

        // validate beneficiary public 
        if (!utilsWallet.isParamEmpty(dsigCltvPubKey)) {
            const dsigCltvPubKeyValid = true // TODO...
            if (!dsigCltvPubKeyValid) return Promise.resolve({ err: `Invalid ${asset.symbol} DSIG CLTV-spender public key` })
        }

        // get fee
        const txGetFee = await module.exports.txGetFee(appWorker, store, p)
        if (txGetFee.err) return Promise.resolve({ err: txGetFee.err })
        if (!txGetFee.ok || !txGetFee.ok.txFee || txGetFee.ok.txFee.fee === undefined) return Promise.resolve({ err: `Error computing TX fee` })
        const du_fee = Number(txGetFee.ok.txFee.fee)

        // validate sufficient balance
        const bal = walletExternal.get_combinedBalance(asset, sendFromAddrNdx)
        const du_balConf = utilsWallet.toDisplayUnit(bal.conf, asset)
        log.info('du_sendValue', du_sendValue)
        log.info('du_balConf', du_balConf)
        log.info('du_fee', du_fee)
        if (du_sendValue + du_fee > du_balConf) return Promise.resolve({ err: `Insufficient confirmed balance` })

        // send
        const feeParams = { txFee: txGetFee.ok.txFee }
        const payTo = [{ receiver: toAddr, value: du_sendValue, dsigCltvSpenderPubKey: dsigCltvPubKey }]
        console.log('sw-tx/payTo', payTo)

        return new Promise((resolve) => {
            walletExternal.createAndPushTx( {
                            store: store,
                            payTo: payTo,
                           wallet: wallet,
                            asset: asset,
                        feeParams: feeParams,
                  sendFromAddrNdx,
                              apk: apk,
                            h_mpk: h_mpk,
            }, (res, err) => {
                if (err) { 
                    resolve({ err })
                }
                else {
                    setTimeout(() => {
                        appWorker.postMessageWrapped({ msg: 'REFRESH_ASSET_FULL', data: { asset, wallet } })
                    }, 3000)

                    setTimeout(() => {
                        resolve({ ok: { txid: res.tx.txid, txGetFee } })    
                    }, 1000)
                }
            })
        })
    },

    // gets network fee for the specified tx
    txGetFee: async (appWorker, store, p) => {
        var { mpk, apk, symbol, value } = p
        const h_mpk = utilsWallet.pbkdf2(apk, mpk)
        log.cmd('txGetFee')
        log.param('mpk', process.env.NODE_ENV === 'test' ? '[secure]' : mpk)
        log.param('symbol', symbol)
        log.param('value', value)

        // validate
        const { err, wallet, asset, du_sendValue } = await utilsWallet.validateSymbolValue(store, symbol, value)
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
                          apk: apk,
                        h_mpk,
            })

            return Promise.resolve({ ok: { txFee, feeData } })
        }
        catch(err) {
            return Promise.resolve({ err })
        }
    }
}
