// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2020 Dominic Morris.

const batchActions = require('redux-batched-actions').batchActions

const walletExternal = require('./wallet-external')

const configExternal = require('../config/wallet-external')
const configWallet = require('../config/wallet')

const utilsWallet = require('../utils')

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
                            appWorker.postMessage({ msg: 'STATE_RESPONSE', status: 'RES', data: { 
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
    
        // asset store updates
        else if (msg === 'ASSET_UPDATE_FULL_INSIGHT') {
            const dispatchAction = walletExternal.getAddressFull_ProcessResult(postback.res, postback.asset, postback.addrNdx)
            if (dispatchAction !== null) {
                store.dispatch(dispatchAction)
            }
        }
        else if (msg === 'ASSET_UPDATE_FULL_ACCOUNT') { 
            const dispatchAction = walletExternal.getAddressFull_ProcessResult(postback.res, postback.asset, postback.addrNdx)
            if (dispatchAction !== null) {
                store.dispatch(dispatchAction)
            }
        }
        else if (msg === 'REQUEST_DISPATCH_BATCH') {
            const dispatchActions = postback.dispatchActions
            if (dispatchActions) {

                // main client-side callback point for new tx's
                const storeState = store.getState()
                if (storeState && storeState.wallet && storeState.wallet.assets) {
                    const enrichTxOps = dispatchActions.filter(p => { return p.type === 'WCORE_SET_ENRICHED_TXS_MULTI' })

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

                                        if (asset.symbol === 'ETH' || asset.symbol === 'ETH_TEST') {
                                            if (enrichTx.erc20 !== undefined) {
                                                // erc20 tx
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
    
                                                // notify user 
                                                utilsWallet.getAppWorker().postMessage({ msg: 'NOTIFY_USER', data: {
                                                    type: 'success',
                                                headline: `${asset.displaySymbol}: Confirmed TX`,
                                                    info: `${asset.displayName} mined`, //${/*utilsWallet.EMOJI_HAPPY_KITTY*/utilsWallet.EMOJI_TICK}`,
                                                    txid: enrichTx.txid
                                                }})
                                            }
                                        }
                                    }
                                })
                            })
                        }
                    })
                }

                // update store, batched
                store.dispatch(batchActions(dispatchActions))
            }
        }
    }
}