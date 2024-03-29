// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2023 Dominic Morris.

const _ = require('lodash')

const { createReducer } = require('./utils')
const {
    WCORE_SET_ASSETS, WCORE_SET_ASSETS_RAW, 
        WCORE_SET_ADDRESS_FULL, WCORE_SET_ADDRESSES_FULL_MULTI, 
        WCORE_SET_ENRICHED_TXS, WCORE_SET_ENRICHED_TXS_MULTI,
    WCORE_PUSH_LOCAL_TX,
} = require('../actions')

const utilsWallet = require('../utils')

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
                                utilsWallet.logMajor('red','white', `LOCAL_TX - POPPING ${symbol} - removeTxs=`, remove_local_txIds, { logServerConsole: true })
                                asset.local_txs =
                                    local_txs
                                    .filter(p => !remove_local_txIds.some(p2 => p2 === p.txid))
                                    utilsWallet.logMajor('red','white', `LOCAL_TX - POP DONE ${symbol} - local_txs=`, asset.local_txs, { logServerConsole: true })
                            }
                        }
                        break
                    }
                }
            })

            // updated timestamp
            if (updateAt !== undefined) {
                asset.lastAssetUpdateAt = updateAt
            }
        }
    }
    return { ...state, assets }
}

const handlers = {
    [WCORE_SET_ASSETS]: (state, action) => {
        utilsWallet.logMajor('red','white', `WCORE_SET_ASSETS, len=`, action.payload.assets.length, { logServerConsole: true })
        return { assets: action.payload.assets, owner: action.payload.owner }
    },

    [WCORE_SET_ASSETS_RAW]: (state, action) => {
        utilsWallet.logMajor('red','white', `WCORE_SET_ASSETS_RAW, len=`, action.payload.length, { logServerConsole: true })
        return { assetsRaw: action.payload }
    },
 
    [WCORE_SET_ENRICHED_TXS_MULTI]: (state, action) => {
        const { symbol, updateAt, addrTxs } = action.payload
        if (!addrTxs || !state.assets) { return {...state} }

        const assetNdx = state.assets.findIndex((p) => p.symbol == symbol)
        var assets = _.cloneDeep(state.assets)

        const allTxs = _.flatten(addrTxs.map(p => p.txs))
        utilsWallet.logMajor('red','white', `WCORE_SET_ENRICHED_TXS_MULTI ${symbol} #addrTxs=${addrTxs.length} #allTxs=${allTxs.length}`, null, { logServerConsole: true })

        const mergedNewAddresses = []
        addrTxs.forEach((addrTx) => {
            const addr = addrTx.addr
            const txs = addrTx.txs
            const res = addrTx.res

            const addrNdx = state.assets[assetNdx].addresses.findIndex(p => p.addr == addr)
            if (addrNdx == -1) return {...state}

            txs.forEach((tx) => {
                if (!assets[assetNdx].addresses[addrNdx] // observed - race condition across logins??
                    || assets[assetNdx].addresses[addrNdx].addr !== addr) { 
                    return {...state}
                }
                
                // txs - insert or update
                const txNdx = assets[assetNdx].addresses[addrNdx].txs.findIndex(p => p.txid == tx.txid)
                if (txNdx !== -1) {
                    //console.log(`WCORE_SET_ENRICHED_TXS_MULTI UPDATE/MERGING txid=${tx.txid}, tx=`, tx)
                    assets[assetNdx].addresses[addrNdx].txs[txNdx] = //tx
                        Object.assign(assets[assetNdx].addresses[addrNdx].txs[txNdx], tx) // merge
                }
                else {
                    //console.log(`WCORE_SET_ENRICHED_TXS_MULTI INSERTING txid=${tx.txid}, tx=`, tx)
                    assets[assetNdx].addresses[addrNdx].txs.push(tx)
                }
            })

            // keep track of merge-updated addr for final update
            const mergedNewAddr = Object.assign({}, assets[assetNdx].addresses[addrNdx], res)
            mergedNewAddresses.push(mergedNewAddr)
        })

        // run full asset update to reconcile local_txs (we may have added new external tx's above - we want the local_txs removed atomically)
        const updatedState = { ...state, assets }

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
        utilsWallet.logMajor('red','white', `WCORE_SET_ADDRESSES_FULL_MULTI ${action.payload.symbol} #`, action.payload.newAddresses.length, { logServerConsole: true })
        return SetAddressFull_ReconcileLocalTxs(state, action)
    },
    [WCORE_SET_ADDRESS_FULL]: (state, action) => {
        throw('unexpected state/call tree - these should all be transmogrified into WCORE_SET_ADDRESSES_FULL_MULTI')
    },

    [WCORE_PUSH_LOCAL_TX]: (state, action) => {
        var assets = _.cloneDeep(state.assets)
        var asset = assets.find(p => p.symbol === action.payload.symbol)

        // don't push the local tx if it's already in the the external tx list (race conditions)
        if (asset.addresses.some(p => p.txs.some(p2 => p2.txid === action.payload.tx.txid))) {
            return { ...state }
        }

        // don't push the local tx if it's already in the local_tx list (reasons not quite clear; possibly duplicate BB bitcoind/address data?)
        if (asset.local_txs.some(p => { return p.txid === action.payload.tx.txid })) {
            return { ...state }
        }

        // update asset
        asset.local_txs.push(_.cloneDeep(action.payload.tx))
        utilsWallet.logMajor('red','white', `LOCAL_TX - PUSH DONE - ${action.payload.symbol} txid=${action.payload.tx.txid}, asset.local_txs=`, asset.local_txs, { logServerConsole: true })

        return { ...state, assets }
    },
}

module.exports = createReducer(initialState, handlers)
