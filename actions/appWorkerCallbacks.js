// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2021 Dominic Morris.

const batchActions = require('redux-batched-actions').batchActions

const walletExternal = require('./wallet-external')

const configExternal = require('../config/wallet-external')
const configWallet = require('../config/wallet')

const walletP2shBtc = require('../actions/wallet-btc-p2sh')
const walletShared = require('../actions/wallet-shared')

const utilsWallet = require('../utils')

//
// callback handler: for app-worker postMessage ==> main-thread
//
module.exports = {
    appWorkerHandler: (store, event) => {
        
        var postback, msg, status
        if (configWallet.WALLET_ENV === "BROWSER") {
            postback = event.data.data
            msg = event.data.msg
            status = event.data.status
        }
        else {
            postback = event.data
            msg = event.msg
            status = event.status
        }

        const appWorker = utilsWallet.getAppWorker() 

        if (msg === 'REQUEST_STATE' && postback) {
            const stateItem = postback.stateItem
            switch (stateItem) {
                case 'ASSET': // request: displayable asset, by asset symbol
                    const stateKey = postback.stateKey
                    const context = postback.context
                    const storeState = store.getState()
                    if (storeState && storeState.wallet && storeState.wallet.assets) {
                        const asset = storeState.wallet.assets.find((p) => { return p.symbol === stateKey })
                        if (asset) { // response
                            appWorker.postMessageWrapped({ msg: 'STATE_RESPONSE', status: 'RES', data: { 
                                stateItem, stateKey, value: { asset, wallet: storeState.wallet, ux: storeState.ux }, context
                            } }) 
                        }
                    }
                    break
            }
        }
        else if (msg === 'REQUEST_DISPATCH') {
            const dispatchType = postback.dispatchType
            const dispatchPayload = postback.dispatchPayload
            store.dispatch({ type: dispatchType, payload: dispatchPayload })
        }

        // add non-standard address(es) (if balance > 0)
        else if (msg === 'ADD_NON_STANDARD_ADDRESSES') {
  
            const nonStdAddrs_Txs = postback.nonStdAddrs_Txs
            utilsWallet.log(`appWorkerCallbacks >> ADD_NON_STANDARD_ADDRESSES... addrs=`, nonStdAddrs_Txs.map(p => p.nonStdAddr))
            //utilsWallet.logMajor('magenta','blue', `ADD_NON_STANDARD_ADDRESSES nonStdAddrs_Txs=`, nonStdAddrs_Txs, { logServerConsole: true })
            const asset = postback.asset

            // handle addr-balance postback
            async function handleAddrBalancePostback(addrBalEvent) {
                const addrBalRes = utilsWallet.unpackWorkerResponse(addrBalEvent)
                if (addrBalRes) {
                    if (addrBalRes.msg === 'ADDRESS_BALANCE_RESULT' && addrBalRes.data !== undefined) {

                        // ## causing .length intermitant load errors on CLI...?
                        // const positiveBalanceAddresses = addrBalRes.data.filter(p => p.bal.balance > 0 || p.bal.unconfirmedBalance > 0)
                        // await walletShared.addNonStdAddress_DsigCltv({
                        //     dsigCltvP2sh_addr_txid: nonStdAddrs_Txs.filter(p => positiveBalanceAddresses.some(p2 => p2.addr == p.nonStdAddr)),
                        //                      store,
                        //            userAccountName: utilsWallet.getStorageContext().owner,
                        //            eosActiveWallet: undefined,
                        //                  assetName: asset.name,
                        //                        apk: utilsWallet.getStorageContext().apk,
                        //                    e_email: utilsWallet.getStorageContext().e_email,
                        //                      h_mpk: utilsWallet.getHashedMpk(), //document.hjs_mpk || utils.getBrowserStorage().PATCH_H_MPK //#READ
                        // })

                        addrBalRes.data.forEach(async result => { // PERF ## n ops
                            if (nonStdAddrs_Txs.map(p => p.nonStdAddr).some(p => p == result.addr)) {
                                if (result.bal.balance > 0 || result.bal.unconfirmedBalance > 0) {
                                    const ret = await walletShared.addNonStdAddress_DsigCltv({
                                    dsigCltvP2sh_addr_txid: nonStdAddrs_Txs.filter(p => p.nonStdAddr == result.addr),
                                                     store,
                                           userAccountName: utilsWallet.getStorageContext().owner,
                                           eosActiveWallet: undefined,
                                                 assetName: asset.name,
                                                       apk: utilsWallet.getStorageContext().apk,
                                                   e_email: utilsWallet.getStorageContext().e_email,
                                                     h_mpk: utilsWallet.getHashedMpk(), //document.hjs_mpk || utils.getBrowserStorage().PATCH_H_MPK //#READ
                                    })
                                }
                            }
                        })
                    }
                }
            }

            // query n addr balances
            utilsWallet.getAppWorker().removeEventListener('message', handleAddrBalancePostback)
            utilsWallet.getAppWorker().addEventListener('message', handleAddrBalancePostback)
            utilsWallet.getAppWorker().postMessageWrapped({ msg: 'GET_ANY_ADDRESS_BALANCE', data: { asset, addrs: nonStdAddrs_Txs.map(p => p.nonStdAddr) } })
        }
    
        // asset store updates
        else if (msg === 'REQUEST_REFRESH_ASSET_FULL') {
            const storeState = store.getState()
            if (postback.symbol) {
                // DMS - todo... OR, can refresh_asset_full *after* we've added the new non-std addr?
                // const dispatchAction = walletExternal.getAddressFull_ProcessResult(postback.res, postback.asset, postback.addrNdx)
                // if (dispatchAction !== null) {
                //     store.dispatch(dispatchAction)
                // }
            }
        }
        else if (msg === 'REQUEST_DISPATCH_BATCH') {
            const dispatchActions = postback.dispatchActions
            if (dispatchActions) {

                // main client-side callback point for new tx's
                var storeState = store.getState()
                if (storeState && storeState.wallet && storeState.wallet.assets) {
                    const enrichTxOps = dispatchActions.filter(p => { return p.type === 'WCORE_SET_ENRICHED_TXS_MULTI' })

                    var txConfirmed = false
                    enrichTxOps.forEach(enrichTxOp => {
                        const asset = storeState.wallet.assets.find(p => p.symbol === enrichTxOp.payload.symbol)
                        //console.log(`REQUEST_DISPATCH_BATCH: WCORE_SET_ENRICHED_TXS_MULTI / asset=`, asset)

                        if (asset && enrichTxOp.payload.addrTxs) {
                            const local_txs = walletExternal.getAll_local_txs(asset)
                            const all_txs = walletExternal.getAll_txs(asset)
                            const assetTxs = [...all_txs, ...local_txs]

                            //console.log('REQUEST_DISPATCH_BATCH: enrichTxOps=', enrichTxOps)

                            // alert on any enrich_tx actions for newly mined tx's
                            enrichTxOp.payload.addrTxs.forEach(addrTx => {
                                addrTx.txs.forEach(enrichTx => {
                                    //console.log(`REQUEST_DISPATCH_BATCH: WCORE_SET_ENRICHED_TXS_MULTI / enrichTx=`, enrichTx)
                                    
                                    if (assetTxs.some(p => p.txid === enrichTx.txid && p.block_no == -1 && enrichTx.block_no != -1)) {
                                        //
                                        // TX CONFIRMATION
                                        //
                                        var skipNotify = false
                                        txConfirmed = true

                                        // eth - handle erc20's
                                        if (asset.symbol === 'ETH' || asset.symbol === 'ETH_TEST') {
                                            if (enrichTx.erc20 !== undefined) {
                                                // erc20 tx
                                                skipNotify = true
                                                ;  // nop - just notify for the corresponding eth tx
                                            }
                                            else {
                                                // eth tx
                                                // is the tx to a known erc20 (e.g. a transfer() or a payable() CFT issuance)
                                                // for CFT tokens: trigger full asset refresh on the erc20 asset
                                                // (could also do this here for non-CFT erc20's, but the erc20 local_tx path covers this already)
                                                const isTxToErc20 = utilsWallet.isERC20(enrichTx.account_to)
                                                console.log('REQUEST_DISPATCH_BATCH: ETH isTxToErc20=', isTxToErc20)
                                                if (isTxToErc20) {
                                                    const erc20s = Object.keys(configExternal.erc20Contracts).map(p => { return { erc20_addr: configExternal.erc20Contracts[p], symbol: p } })
                                                    const erc20Symbol = erc20s.find(p => p.erc20_addr.toLowerCase() === enrichTx.account_to.toLowerCase()).symbol
                                                    console.log('REQUEST_DISPATCH_BATCH: ETH - TX to known ERC20; will REFRESH_ASSET_BALANCE for erc20Symbol=', erc20Symbol)
                                                    const erc20Asset = storeState.wallet.assets.find(p => p.symbol === erc20Symbol)
                                                    utilsWallet.getAppWorker().postMessage({ msg: 'REFRESH_ASSET_BALANCE', data: { asset: erc20Asset, wallet: storeState.wallet } })
                                                }
                                            }
                                        }

                                        // notify user 
                                        if (!skipNotify) {
                                            utilsWallet.getAppWorker().postMessageWrapped({ msg: 'NOTIFY_USER', data: {
                                                type: 'success',
                                            headline: `${asset.displaySymbol}: Confirmed TX`,
                                                info: `${asset.displayName} mined`, 
                                                txid: enrichTx.txid
                                            }})
                                        }
                                    }
                                })
                            })
                        }
                    })

                    // update store, batched
                    //utilsWallet.logMajor('magenta','blue', `REQUEST_DISPATCH_BATCH dispatchActions=`, dispatchActions, { logServerConsole: true })
                    store.dispatch(batchActions(dispatchActions))

                    // btc p2sh - on tx confirmation, scan for non-standard outputs (and add any associated dynamic addresses)
                    if (txConfirmed) {
                        enrichTxOps.forEach(enrichTxOp => {
                            storeState = store.getState()
                            const asset = storeState.wallet.assets.find(p => p.symbol === enrichTxOp.payload.symbol)
                            if (asset.symbol === 'BTC_TEST') {
                                utilsWallet.log(`REQUEST_DISPATCH_BATCH - will scan for non-std outputs...`)
                                appWorker.postMessageWrapped({ msg: 'SCAN_NON_STANDARD_ADDRESSES', data: { asset }})
                            }
                        })
                    }
                }
            }
        }
    }
}