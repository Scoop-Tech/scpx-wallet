// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2021 Dominic Morris.

const Keygen = require('eosjs-keygen').Keygen
const bitcoinJsLib = require('bitcoinjs-lib')
const BigNumber = require('bignumber.js')
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
        var { mpk, apk, symbol, value, to, from, dsigCltvPubKey, spendFullUtxo } = p
        const h_mpk = utilsWallet.pbkdf2(apk, mpk)
        log.cmd('txPush')
        log.param('mpk', process.env.NODE_ENV === 'test' ? '[secure]' : mpk)
        log.param('symbol', symbol)
        log.param('value', value)
        log.param('to', to)
        log.param('from', from)
        log.param('dsigCltvPubKey', dsigCltvPubKey)
        log.param('spendFullUtxo', spendFullUtxo)

        // validate from addr
        var { err, wallet, asset, du_sendValue } = await utilsWallet.validateSymbolValue(store, symbol, value)
        //log.info('du_sendValue', du_sendValue)
        if (err) return Promise.resolve({ err })
        if (utilsWallet.isParamEmpty(to)) return Promise.resolve({ err: `To address is required` })

        // if spending single UTXO, ensure that supplied value is exactly the value of the UTXO
        var spendTxid, spendVout, spendUtxo, cu_utxoValue
        if (!utilsWallet.isParamEmpty(spendFullUtxo) && asset.symbol !== 'BTC_TEST') return Promise.resolve({ err: `Invalid p_op (spendFullUtxo) for ${asset.symbol}` })
        if (asset.type === configWallet.WALLET_TYPE_UTXO && !utilsWallet.isParamEmpty(spendFullUtxo)) {
            // validate spendFullUtxo utxo and vout format
            const ss = spendFullUtxo.split(':')
            if (ss.length != 2) return Promise.resolve({ err: `Invalid spendFullUtxo format (txid:vout)` })
            spendTxid = ss[0]
            spendVout = Number(ss[1])
            if (Number.isInteger(spendVout) == false) return Promise.resolve({ err: `Invalid vout` })
            const tx = walletExternal.getAll_txs(asset).find(p => p.txid == spendTxid)
            if (!tx) return Promise.resolve({ err: `Invalid txid` })
            if (spendVout > tx.utxo_vout.length) return Promise.resolve({ err: `Bad vout` })
            
            // validate send value is explicitly set to UTXO's full value
            spendUtxo = tx.utxo_vout[spendVout]
            const cu_sendValue = new BigNumber(utilsWallet.toCalculationUnit(value, asset))
            cu_utxoValue = new BigNumber(utilsWallet.toCalculationUnit(spendUtxo.value, asset))
            if (!cu_sendValue.isEqualTo(cu_utxoValue)) return Promise.resolve({ err: `Invalid spendFullUtxo value: expected full UTXO value ${spendUtxo.value}, got ${value}` })
        }

        // get fee
        const txGetFee = await module.exports.txGetFee(appWorker, store, { mpk, apk, symbol, value,  spendFullUtxo: { txid: spendTxid, vout: spendVout }, })
        if (txGetFee.err) return Promise.resolve({ err: txGetFee.err })
        if (!txGetFee.ok || !txGetFee.ok.txFee || txGetFee.ok.txFee.fee === undefined) return Promise.resolve({ err: `Error computing TX fee` })
        const du_fee = Number(txGetFee.ok.txFee.fee)
        log.info('du_fee', du_fee)

        // account-type: map supplied from-addr to addr-index
        var sendFromAddrNdx = -1 // utxo: use all available address indexes
        if (asset.type === configWallet.WALLET_TYPE_ACCOUNT) { 
            // account: use specific address index
            if (!utilsWallet.isParamEmpty(spendFullUtxo)) return Promise.resolve({ err: `Invalid spendFullUtxo for account-type asset` })
            if (utilsWallet.isParamEmpty(from)) return Promise.resolve({ err: `From address is required` })
            sendFromAddrNdx = asset.addresses.findIndex(p => p.addr.toLowerCase() === from.toLowerCase())
            if (sendFromAddrNdx == -1) return Promise.resolve({ err: `Invalid from address` })

            // account: disallow protect_op
            if (!utilsWallet.isParamEmpty(dsigCltvPubKey)) return Promise.resolve({ err: `Invalid op for account-type asset` })
        }
        else {
            // utxo: validate 
            if (!utilsWallet.isParamEmpty(spendFullUtxo)) {
                const cu_fee = new BigNumber(utilsWallet.toCalculationUnit(du_fee, asset))

                // override send value - we will spend the entire UTXO in full, less the fee
                du_sendValue = utilsWallet.toDisplayUnit(cu_utxoValue.minus(cu_fee), asset)
                log.info('du_sendValue(overriden)', du_sendValue)

                // if (cu_sendValue.plus(cu_fee).isEqualTo(cu_utxoValue) == false) {
                //     const fullSpendAmt = cu_utxoValue.minus(cu_fee)
                //     log.info('fullSpendAmt', fullSpendAmt)
                //     return Promise.resolve({ err: `Invalid TX value for full UTXO spend (UTXO value ${spendUtxo.value}); specify the full UTXO value minus the fee (= ${utilsWallet.toDisplayUnit(fullSpendAmt, asset)})` }) 
                // }
            }

            if (!utilsWallet.isParamEmpty(from)) return Promise.resolve({ err: `From address is not supported for UTXO-types` })
            if ((!utilsWallet.isParamEmpty(dsigCltvPubKey))
                && symbol.toUpperCase() !== 'BTC_TEST') return Promise.resolve({ err: `Invalid p_op for UTXO-type asset` })
        }

        // validate to addr
        const toAddr = to
        const toAddrIsValid = opsWallet.validateAssetAddress({ testSymbol: asset.symbol, testAddressType: asset.addressType, validateAddr: toAddr })
        if (!toAddrIsValid) return Promise.resolve({ err: `Invalid ${asset.symbol} to address` })

        // validate beneficiary public key
        if (!utilsWallet.isParamEmpty(dsigCltvPubKey)) {
            const dsigCltvPubKeyValid = true // TODO...
            if (!dsigCltvPubKeyValid) return Promise.resolve({ err: `Invalid ${asset.symbol} DSIG CLTV-spender public key` })
        }

        // validate sufficient balance
        const du_balConf = new BigNumber(utilsWallet.toDisplayUnit(
            spendUtxo ? utilsWallet.toCalculationUnit(spendUtxo.value, asset)
                      : walletExternal.get_combinedBalance(asset, sendFromAddrNdx).conf,
            asset))
        log.info('du_sendValue', du_sendValue)
        log.info('du_balConf', du_balConf)
        if (du_sendValue + du_fee > du_balConf) return Promise.resolve({ err: `Insufficient confirmed balance (${du_balConf.minus(du_fee).toString()} available after fee)` })

        // send
        const feeParams = { txFee: txGetFee.ok.txFee }
        const payTo = [{ receiver: toAddr, value: du_sendValue, dsigCltvSpenderPubKey: dsigCltvPubKey }]
        console.log('sw-tx/payTo', payTo)
        log.info('sw-tx/spendTxid', spendTxid)
        log.info('sw-tx/spendVout', spendVout)

        return new Promise((resolve) => {
            walletExternal.createAndPushTx( {
                            store: store,
                            payTo: payTo,
                           wallet: wallet,
                            asset: asset,
                        feeParams: feeParams,
                  sendFromAddrNdx,
                  spendFullUtxo: { txid: spendTxid, vout: spendVout },
                              apk: apk,
                            h_mpk: h_mpk,
            }, (res, err) => {
                if (err) { 
                    resolve({ err })
                }
                else {
                    setTimeout(() => {
                        // to refresh UTXOs
                        appWorker.postMessageWrapped({ msg: 'REFRESH_ASSET_FULL', data: { asset, wallet } }) 
                        
                         // DMS - to pickup any new non-std addr from local_tx's
                        const storeState = store.getState()
                        const refreshedAsset = storeState.wallet.assets.find((p) => p.symbol === asset.symbol )
                        if (storeState && storeState.wallet && storeState.wallet.assets) {
                            appWorker.postMessageWrapped({ msg: 'SCAN_NON_STANDARD_ADDRESSES', data: { asset: refreshedAsset }})
                        }
                        
                        resolve({ ok: { txid: res.tx.txid, txGetFee, psbt: res.psbt } })    

                    }, 1500) //TX_REFRESH_PAUSE_MSECS
                }
            })
        })
    },

    // gets network fee for the specified tx
    txGetFee: async (appWorker, store, p) => {
        var { mpk, apk, symbol, value, spendFullUtxo } = p
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
                spendFullUtxo,
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
