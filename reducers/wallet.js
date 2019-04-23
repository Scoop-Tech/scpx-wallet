'use strict';

import { createReducer } from './utils'

import {
    WCORE_SET_ASSETS, WCORE_SET_ASSETS_RAW, WCLIENT_SET_SELECTED_ASSET, 
        WCORE_SET_ADDRESS_FULL, WCORE_SET_ADDRESSES_FULL_MULTI, 
        WCORE_SET_ENRICHED_TXS, WCORE_SET_ENRICHED_TXS_MULTI,
    WCORE_PUSH_LOCAL_TX,
    WCLIENT_SET_ASSETS_ERROR, 
    WCORE_SET_UTXO_FEES, WCORE_SET_ETH_GAS_PRICES
} from '../actions'

const _ = require('lodash')

const initialState = {}

function SetAddressFull_ReconcileLocalTxs(state, action) {
    const { symbol, newAddr, newAddresses, updateAt } = action.payload

    if ((!newAddr && !newAddresses) || !state.assets) { return {...state} }

    // accepts either a single address, or an [] of addresses to update    
    var updateAddresses = []
    if (newAddr) {
        updateAddresses.push(newAddr)
    }
    else {
        updateAddresses = newAddresses
    }

    var assets = _.cloneDeep(state.assets)
    //const selectedAsset = _.cloneDeep(state.selectedAsset)
    for (var key in assets) {
        var asset = assets[key]
        if (asset.symbol === symbol) {

            updateAddresses.forEach(function(updateAddr) {

                for (var addrNdx = 0; addrNdx < asset.addresses.length; addrNdx++) {
                    if (asset.addresses[addrNdx].addr === updateAddr.addr) {

                        // UTXO v2 / ETH v2
                        // merge tx lists - no update of existing tx's: only adding new
                        updateAddr.txs = [
                            // new tx's only
                            ...updateAddr.txs.filter(p => !asset.addresses[addrNdx].txs.some(p2 => p2.txid === p.txid)),
                            
                            // merge with existing
                            ...asset.addresses[addrNdx].txs]
                        
                        // merge update address data: balance and external tx list
                        Object.assign(asset.addresses[addrNdx], updateAddr)

                        // remove entries from local_txs[] if they're present in txs[]
                        var txs = asset.addresses[addrNdx].txs
                        var local_txs = asset.local_txs
                        if (txs) {
                            const external_txIds = txs.map(p => p.txid)
                            const remove_local_txIds = local_txs
                                .filter(p => external_txIds.some(p2 => p2 == p.txid))
                                .map(p => p.txid)

                            if (remove_local_txIds.length > 0) {
                                //debugger

                                //console.log('DBG1 - POPPING LOCAL_TX...')

                                console.log(`LOCAL_TX - POPPING ${symbol} - removeTxs=`, remove_local_txIds)
                                
                                asset.local_txs =
                                    local_txs
                                    .filter(p => !remove_local_txIds.some(p2 => p2 === p.txid))

                                console.log(`LOCAL_TX - POP DONE ${symbol} - local_txs=`, asset.local_txs)
                            }
                        }
                        break
                    }
                }
            })

            // updated timestamp
            asset.lastAssetUpdateAt = updateAt

            // apply same to selectedAsset
            //if (state.selectedAsset && state.selectedAsset.symbol === symbol) {
            //    Object.assign(selectedAsset, asset)
            //}

        }
    }
    return { ...state, assets }//, selectedAsset }
}

const handlers = {
    [WCORE_SET_ASSETS]: (state, action) => {
        return { assets: action.payload.assets, owner: action.payload.owner }
    },
    [WCORE_SET_ASSETS_RAW]: (state, action) => {
        console.log('WCORE_SET_ASSETS_RAW..', action.payload)
        return { assets_raw: action.payload }
    },
 
    [WCORE_SET_ENRICHED_TXS_MULTI]: (state, action) => {
        const { symbol,  updateAt, addrTxs } = action.payload
        if (!addrTxs || !state.assets) { return {...state} }

        const assetNdx = state.assets.findIndex((p) => p.symbol == symbol)

        var assets = _.cloneDeep(state.assets)
        //const selectedAsset = _.cloneDeep(state.selectedAsset)

        console.log(`%cWCORE_SET_ENRICHED_TXS_MULTI ${symbol} x${addrTxs.length}`, 'background: orange; color: white; font-weight: 600; font-size: 14px;')

        const mergedNewAddresses = []
        addrTxs.forEach((addrTx) => {
            const addr = addrTx.addr
            const txs = addrTx.txs
            const res = addrTx.res

            const addrNdx = state.assets[assetNdx].addresses.findIndex(p => p.addr == addr)
            if (addrNdx == -1) { return {...state} }

            txs.forEach((tx) => {
                
                if (!assets[assetNdx].addresses[addrNdx] // observed - race condition across logins??
                    || assets[assetNdx].addresses[addrNdx].addr !== addr) { 
                    return {...state}
                }
                
                const txNdx = assets[assetNdx].addresses[addrNdx].txs.findIndex(p => p.txid == tx.txid)
                if (txNdx !== -1) {
                    assets[assetNdx].addresses[addrNdx].txs[txNdx] = tx
                }
                else {
                    assets[assetNdx].addresses[addrNdx].txs.push(tx)
                }

                // if (selectedAsset !== undefined) {
                //     if (selectedAsset.symbol === assets[assetNdx].symbol) {
                //         if (txNdx !== -1) {
                //             selectedAsset.addresses[addrNdx].txs[txNdx] = tx
                //         }
                //         else {
                //             selectedAsset.addresses[addrNdx].txs.push(tx)
                //         }
                //     }
                // }
            })

            // keep track of merge-updated addr for final update
            const mergedNewAddr = Object.assign({}, assets[assetNdx].addresses[addrNdx], res)
            mergedNewAddresses.push(mergedNewAddr)
        })

        // run full asset update to reconcile local_txs (we may have added new external tx's above - we want the local_txs removed atomically)
        const updatedState = { ...state, assets }//, selectedAsset }

        const ret = SetAddressFull_ReconcileLocalTxs(updatedState, { payload: {
            symbol: symbol,
      newAddresses: mergedNewAddresses,
          updateAt
       } } )

        return ret
    },
    [WCORE_SET_ENRICHED_TXS]: (state, action) => {
        throw('unexpected state/call tree - these should all be transmogrified into WCORE_SET_ENRICHED_TXS_MULTI')
    },

    [WCORE_SET_ADDRESSES_FULL_MULTI]: (state, action) => {
        if (!state.assets) { return {...state} }
        console.log(`%cWCORE_SET_ADDRESSES_FULL_MULTI ${action.payload.symbol} x${action.payload.newAddresses.length}`, 'background: DarkSalmon; color: white; font-weight: 600; font-size: 14px;')
        return SetAddressFull_ReconcileLocalTxs(state, action)
    },
    [WCORE_SET_ADDRESS_FULL]: (state, action) => {
        throw('unexpected state/call tree - these should all be transmogrified into WCORE_SET_ADDRESSES_FULL_MULTI')
        // if (!state.assets) { return {...state} }
        // const assetNdx = state.assets.findIndex((p) => p.symbol == action.payload.symbol)
        // const addrNdx = state.assets[assetNdx].addresses.findIndex(p => p.addr == action.payload.newAddr.addr)
        // console.log(`%cWCORE_SET_ADDRESS_FULL ${action.payload.symbol}/${addrNdx}`, 'background: orange; color: white; font-weight: 600; font-size: 12px;')
        // return SetAddressFull_ReconcileLocalTxs(state, action)
    },

    // todo - perf - decouple from core wallet; move to ux reducer

    // fees - v2
    [WCORE_SET_UTXO_FEES]: (state, action) => {
        const utxoFees = action.payload.feeData
        const symbol = action.payload.symbol
        
        const assets = _.cloneDeep(state.assets)
        assets.find(p => p.symbol === symbol).utxoFees = utxoFees
        return { ...state, assets }
        
        // if (state.selectedAsset !== undefined) {
        //     const selectedAsset = state.selectedAsset
        //     selectedAsset.utxoFees = action.payload
        //     return { ...state, selectedAsset }
        // }
    },
    [WCORE_SET_ETH_GAS_PRICES]: (state, action) => {
        const gasPrices = action.payload.feeData
        const symbol = action.payload.symbol

        const assets = _.cloneDeep(state.assets)
        assets.find(p => p.symbol === symbol).gasPrices = gasPrices
        return { ...state, assets }

        // if (state.selectedAsset !== undefined) {
        //     const selectedAsset = state.selectedAsset
        //     selectedAsset.gasPrices = action.payload
        //     return { ...state, selectedAsset }
        // }
    },

    [WCORE_PUSH_LOCAL_TX]: (state, action) => {
        // can't figure out how to update *just* the local_txs[] 
        // this triggers full object change of selectedAsset; it works, but i don't like it. and i have been awake for 36 hours.

        console.log(`LOCAL_TX - PUSH - ${action.payload.symbol}, tx=`, action.payload.tx)
        var assets = _.cloneDeep(state.assets)
        var asset = assets.find(p => p.symbol === action.payload.symbol)

        // don't push the local tx if it's already in the the external tx list (race conditions)
        if (asset.addresses.some(p => p.txs.some(p2 => p2.txid === action.payload.tx.txid))) {
            console.log(`LOCAL_TX - PUSH  - ${action.payload.symbol} - DROPPED: txid ${action.payload.tx.txid} is already fetched in addresses' external tx list(s)`)
            return { ...state } 
        }

        // update asset
        if (asset.local_txs.some(p => { return p.txid === action.payload.tx.txid }) === false) {
            asset.local_txs.push(_.cloneDeep(action.payload.tx))
        } else console.log(`LOCAL_TX - PUSH - ${action.payload.symbol} (asset) ignoring; txid already present in local_tx! tx=`, action.payload.tx)
        //if (state.selectedAsset === undefined || state.selectedAsset.symbol !== action.payload.symbol) {
            console.log(`LOCAL_TX - PUSH DONE - ${action.payload.symbol} asset.local_txs=`, asset.local_txs)
            return { ...state, assets }
        //}

        // update selectedAsset
        // var selectedAsset = _.cloneDeep(state.selectedAsset)
        // if (selectedAsset.local_txs.some(p => { return p.txid === action.payload.tx.txid }) === false) {
        //     selectedAsset.local_txs.push(_.cloneDeep(action.payload.tx))
        // } else console.log(`LOCAL_TX - PUSH - ${action.payload.symbol} (selectedAsset) - ignoring; txid already present in local_tx! tx=`, action.payload.tx)

        // console.log(`LOCAL_TX - PUSH DONE - ${action.payload.symbol} (asset & selectedAsset) asset+selectedAsset.local_txs=`, asset.local_txs, selectedAsset.local_txs)
        // return { ...state, assets, selectedAsset }
    },

    // client specific
    [WCLIENT_SET_ASSETS_ERROR]: (state, action) => {
        console.log(action.payload)
        return { ...state, update_error: action.payload }
    },

    [WCLIENT_SET_SELECTED_ASSET]: (state, action) => {
        return { ...state, selectedAsset: action.payload }
    },
}

export default createReducer(initialState, handlers)
