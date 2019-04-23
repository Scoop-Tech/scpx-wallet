import { Buffer } from 'buffer'
const _ = require('lodash')
const pLimit = require('p-limit')

const bitgoUtxoLib = require('bitgo-utxo-lib')
import { payments } from 'bitcoinjs-lib'
import * as bip32 from 'bip32'
import { privateToAddress } from 'ethereumjs-util'
const bchAddr = require('bchaddrjs')

import * as configWallet from '../config/wallet'
import * as configExternal from '../config/wallet-external'
import * as actionsWallet from '../actions'
import * as utilsWallet from '../utils'

import * as actionsWalletUtxo from './wallet-utxo'
import * as actionsWalletAccount from './wallet-account'

//import { updateAssetsJsonApi } from '../api/wallet'
import * as apiWallet from '../api/wallet'

//
// import external privkeys into a new import account
//
export async function importPrivKeys(p) { 
    const { store, userAccountName, e_rawAssets, eosActiveWallet, assetName, wallet, addrKeyPairs,
            activePubKey, e_email, h_mpk } = p
    if (!store) { throw("importPrivKeys - invalid store") }
    if (!h_mpk) { throw("importPrivKeys - invalid h_mpk") }
    if (!addrKeyPairs) { throw("importPrivKeys - no addr/key pairs supplied") }
    if (!userAccountName) { throw("importPrivKeys - not logged in") }
    if (!e_rawAssets || e_rawAssets == '') { throw("importPrivKeys - no wallet data") }
    const displayableAssets = wallet.assets

    // decrypt raw assets
    var pt_rawAssets = utilsWallet.aesDecryption(activePubKey, h_mpk, e_rawAssets)
    var rawAssets = JSON.parse(pt_rawAssets)

    // get asset 
    const genAsset = rawAssets[assetName.toLowerCase()]
    if (genAsset === undefined || !genAsset.accounts || genAsset.accounts.length == 0) { throw("importPrivKeys - invalid asset") }
    const meta = configWallet.walletsMeta[assetName.toLowerCase()]
    const genSymbol = meta.symbol

    // make new HD account for import
    const existingImports = genAsset.importCount || 0 //genAsset.accounts.length - 1 // first account is default Scoop addresses
    const importAccount = { // new import account
        name: `Import #${existingImports+1} ${meta.displayName}`,
        privKeys: []
    }
    genAsset.accounts.push(importAccount)
    const accountNdx = existingImports + 1 // imported accounts start at our HD index 1 (scoop default is 0)
    genAsset.importCount = accountNdx

    // map raw suplied priv keys to our internal format; note -- there is no "real" HD path for imported keys (they're not derived keys)
    // we use custom path prefix 'i' for imported to denote this
    const privKeys = []
    for (var i=0 ; i < addrKeyPairs.length ; i++) {
        const privKey = addrKeyPairs[i].privKey
        var chainNdx = 0 // bip44: 0=external chain, 1=internal chain (change addresses)
        privKeys.push({ privKey, path: `i/44'/${meta.bip44_index}'/${accountNdx}'/${chainNdx}/${i}` })
    }

    // add new priv keys
    privKeys.forEach(privKey => {
        importAccount.privKeys.push(privKey)
    })

    // update local persisted raw assets
    var rawAssetsJsonUpdated = JSON.stringify(rawAssets, null, 4)
    const e_rawAssetsUpdated = utilsWallet.aesEncryption(activePubKey, h_mpk, rawAssetsJsonUpdated)
    store.dispatch({ type: actionsWallet.WCORE_SET_ASSETS_RAW, payload: e_rawAssetsUpdated })

    // add to displayable asset addresses - this fails inside .then() below; no idea why
    const displayableAsset = displayableAssets.find(p => { return p.symbol === genSymbol })
    for (var i=0 ; i < addrKeyPairs.length ; i++) {
        const addr = addrKeyPairs[i].addr
        var newDisplayableAsset = newWalletAddressFromPrivKey( {
              assetName: assetName.toLowerCase(),
            accountName: importAccount.name,
                    key: privKeys.find(p => p.privKey == addrKeyPairs[i].privKey),
        eosActiveWallet: eosActiveWallet,
              knownAddr: addr,
                 symbol: displayableAsset.symbol
        })
        if (newDisplayableAsset.addr === null) {
            utilsWallet.softNuke(rawAssets); utilsWallet.softNuke(genAsset); pt_rawAssets = null
            return { err: "Invalid Private Key" }
        }
        displayableAsset.addresses.push(newDisplayableAsset)
    }
    store.dispatch({ type: actionsWallet.WCORE_SET_ASSETS, payload: { assets: displayableAssets, owner: userAccountName } })

    // update selected asset
    // if (wallet.selectedAsset.symbol === displayableAsset.symbol) {
    //     store.dispatch({ type: actionsWallet.WCLIENT_SET_SELECTED_ASSET, payload: displayableAsset })
    // }

    // raw assets: post encrypted
    return apiWallet.updateAssetsJsonApi(userAccountName, pruneRawAssets(rawAssets, activePubKey, h_mpk), e_email)
    .then((res) => {
        
        rawAssetsJsonUpdated = null

        // update addr monitors
        document.appWorker.postMessage({ msg: 'DISCONNECT_ADDRESS_MONITORS', data: { wallet } })
        document.appWorker.postMessage({ msg: 'CONNECT_ADDRESS_MONITORS', data: { wallet } })

        // refresh asset balance
        document.appWorker.postMessage({ msg: 'REFRESH_ASSET_BALANCE', data: { asset: displayableAsset, wallet, polling: false } })
        
        // ret ok
        utilsWallet.softNuke(rawAssets); utilsWallet.softNuke(genAsset); pt_rawAssets = null
        return { importedAddrCount: privKeys.length, accountName: importAccount.name }
    })
    .catch(err => {
        console.error(`## Wallet - importPrivKeys -- FAIL posting, err=`, err)
        utilsWallet.softNuke(rawAssets); utilsWallet.softNuke(genAsset); pt_rawAssets = null
        return { err: err.toString() }
    })
}

//
// remove imported account(s)
//
export async function removeImportedAccounts(p) {
    const { store, userAccountName, e_rawAssets, eosActiveWallet, assetName, wallet, removeAccounts, 
            activePubKey, e_email, h_mpk } = p
    debugger
    if (!store) { throw("removeImportedAccounts - invalid store") }
    if (!h_mpk) { throw("removeImportedAccounts - invalid h_mpk") }
    if (!removeAccounts) { throw("removeImportedAccounts - no remove accounts supplied") }
    if (!userAccountName) { throw("removeImportedAccounts - not logged in") }
    if (!e_rawAssets || e_rawAssets == '') { throw("removeImportedAccounts - no wallet data") }
    const displayableAssets = wallet.assets

    // decrypt raw assets
    var pt_rawAssets = utilsWallet.aesDecryption(activePubKey, h_mpk, e_rawAssets)
    var rawAssets = JSON.parse(pt_rawAssets)

    // get asset 
    const genAsset = rawAssets[assetName.toLowerCase()]
    if (genAsset === undefined || !genAsset.accounts || genAsset.accounts.length == 0) { throw("removeImportedAccounts - no asset") }
    const meta = configWallet.walletsMeta[assetName.toLowerCase()]
    const genSymbol = meta.symbol

    // raw assets: remove specified accounts & addresses
    const removedAccountCount = genAsset.accounts.filter(p => removeAccounts.some(p2 => p2 === p.name) === true).length
    genAsset.accounts = genAsset.accounts.filter(p => removeAccounts.some(p2 => p2 === p.name) === false)
    genAsset.addresses = genAsset.addresses.filter(p => removeAccounts.some(p2 => p2 === p.accountName) === false)

    // raw assets: update local persisted copy
    var rawAssetsJsonUpdated = JSON.stringify(rawAssets, null, 4)
    const e_rawAssetsUpdated = utilsWallet.aesEncryption(activePubKey, h_mpk, rawAssetsJsonUpdated)
    store.dispatch({ type: actionsWallet.WCORE_SET_ASSETS_RAW, payload: e_rawAssetsUpdated })

    // displayableAssets: remove specified accounts & addresses
    const displayableAsset = displayableAssets.find(p => { return p.symbol === genSymbol })
    const removedAddrCount = displayableAsset.addresses.filter(p => removeAccounts.some(p2 => p2 === p.accountName) === true).length
    displayableAsset.addresses = displayableAsset.addresses.filter(p => removeAccounts.some(p2 => p2 === p.accountName) === false)
    store.dispatch({ type: actionsWallet.WCORE_SET_ASSETS, payload: { assets: displayableAssets, owner: userAccountName } })

    // update selected asset
    // if (wallet.selectedAsset.symbol === displayableAsset.symbol) {
    //     store.dispatch({ type: actionsWallet.WCLIENT_SET_SELECTED_ASSET, payload: displayableAsset })
    // }

    // raw assets: post encrypted
    return apiWallet.updateAssetsJsonApi(userAccountName, pruneRawAssets(rawAssets, activePubKey, h_mpk), e_email)
    .then(() => {

        rawAssetsJsonUpdated = null

        // update addr monitors
        document.appWorker.postMessage({ msg: 'DISCONNECT_ADDRESS_MONITORS', data: { wallet } })
        document.appWorker.postMessage({ msg: 'CONNECT_ADDRESS_MONITORS', data: { wallet } })

        // refresh asset balance
        document.appWorker.postMessage({ msg: 'REFRESH_ASSET_BALANCE', data: { asset: displayableAsset, wallet, polling: false } })
        
        // ret ok
        utilsWallet.softNuke(rawAssets); utilsWallet.softNuke(genAsset); pt_rawAssets = null
        return { removedAddrCount, removedAccountCount }
    })
    .catch(err => {
        console.error(`## Wallet - removeImportedAccounts -- FAIL posting, err=`, err)
        utilsWallet.softNuke(rawAssets); utilsWallet.softNuke(genAsset); pt_rawAssets = null
        return { err: err.toString() }
    })
}

//
// generate new scoop main account address
//
export async function generateNewAddress(p) {
    const { store, userAccountName, e_rawAssets, eosActiveWallet, assetName, wallet, 
            activePubKey, e_email, h_mpk } = p
    if (!store) { throw("generateWallets - invalid store") }
    if (!h_mpk) { throw("generateWallets - invalid h_mpk") }
    if (!userAccountName) { throw("generateNewAddress - not logged in") }
    if (!e_rawAssets === undefined || e_rawAssets == '') { throw("generateNewAddress - no wallet data") }
    const displayableAssets = wallet.assets

    // decrypt raw assets
    var pt_rawAssets = utilsWallet.aesDecryption(activePubKey, h_mpk, e_rawAssets)
    var rawAssets = JSON.parse(pt_rawAssets)

    // get asset and account to generate into
    debugger
    const genAsset = rawAssets[assetName.toLowerCase()]
    if (genAsset === undefined || !genAsset.accounts || genAsset.accounts.length == 0) { throw("generateNewAddress - no asset") }
    const meta = configWallet.walletsMeta[assetName.toLowerCase()]
    const genSymbol = meta.symbol
    const genAccount = genAsset.accounts[0] // default (Scoop) account

    // generate new address
    var newPrivKey
    switch (meta.type) {
        case configWallet.WALLET_TYPE_UTXO:
            newPrivKey = generateUtxoBip44Wifs({
                entropySeed: h_mpk, 
                     symbol: genSymbol === 'BTC_SEG' || genSymbol === 'BTC_TEST' ? 'BTC' : genSymbol,
                    addrNdx: genAccount.privKeys.length,
                   genCount: 1 })[0]
            break
        
        case configWallet.WALLET_TYPE_ACCOUNT: 
            if (genSymbol === 'EOS') ; //todo
            else if (meta.addressType === configWallet.ADDRESS_TYPE_ETH) { // including erc20
                newPrivKey = generateEthereumWallet({
                    entropySeed: h_mpk,
                        addrNdx: genAccount.privKeys.length, 
                       genCount: 1 })[0]
            }
            break
    }

    if (newPrivKey) {
        // add new priv key (assets raw)
        genAccount.privKeys.push(newPrivKey)
        
        var rawAssetsJsonUpdated = JSON.stringify(rawAssets, null, 4)
        const e_rawAssetsUpdated = utilsWallet.aesEncryption(activePubKey, h_mpk, rawAssetsJsonUpdated)
        store.dispatch({ type: actionsWallet.WCORE_SET_ASSETS_RAW, payload: e_rawAssetsUpdated })

        // post to server
        return apiWallet.updateAssetsJsonApi(userAccountName, pruneRawAssets(rawAssets, activePubKey, h_mpk), e_email)
        .then(() => {
    
            rawAssetsJsonUpdated = null

            // add new displayable asset address object
            const displayableAsset = displayableAssets.find(p => { return p.symbol === genSymbol })
            const newDisplayableAddr = newWalletAddressFromPrivKey( {
                    assetName: assetName.toLowerCase(),
                  accountName: genAccount.name,
                          key: newPrivKey,
              eosActiveWallet: eosActiveWallet,
                    knownAddr: undefined,
                       symbol: displayableAsset.symbol
            })

            displayableAsset.addresses.push(newDisplayableAddr)
            store.dispatch({ type: actionsWallet.WCORE_SET_ASSETS, payload: { assets: displayableAssets, owner: userAccountName } })

            // update selected asset
            // if (wallet.selectedAsset.symbol === displayableAsset.symbol) {
            //     store.dispatch({ type: actionsWallet.WCLIENT_SET_SELECTED_ASSET, payload: displayableAsset })
            // }
    
            // update addr monitors
            document.appWorker.postMessage({ msg: 'DISCONNECT_ADDRESS_MONITORS', data: { wallet } })
            document.appWorker.postMessage({ msg: 'CONNECT_ADDRESS_MONITORS', data: { wallet } })
    
            // refresh asset balance
            document.appWorker.postMessage({ msg: 'REFRESH_ASSET_BALANCE', data: { asset: displayableAsset, wallet, polling: false } })
            
            // ret ok
            utilsWallet.softNuke(rawAssets); pt_rawAssets = null
            return { newAddr: newDisplayableAddr, newCount: genAccount.privKeys.length }
        })
        .catch(err => {
            console.error(`## Wallet - generateNewAddress -- FAIL posting, err=`, err)
            utilsWallet.softNuke(rawAssets); pt_rawAssets = null
            return { err: err.toString(), newAddr: undefined }
        })
       
    } else {
        // ret fail
        utilsWallet.softNuke(rawAssets); pt_rawAssets = null
        return { err: 'PrivKey-gen failed', newAddr: undefined }
    }
}

//
// generate scoop main wallet - called on signup and on login
// decrypts saved server data and merges any saved imported-accounts
//
export async function generateWallets(p) {
    const { store, userAccountName, e_serverAssets, eosActiveWallet, callbackProcessed, 
            activePubKey, e_email, h_mpk } = p
    if (!store) { throw("generateWallets - invalid store") }
    if (!h_mpk) { throw("generateWallets - invalid h_mpk") }
    if (!userAccountName) { throw("generateWallets - not logged in") }

    // decrypt server assets
    var pt_serverAssets
    var currentAssets
    if (e_serverAssets !== undefined && e_serverAssets !== null && e_serverAssets !== '') {
        pt_serverAssets = utilsWallet.aesDecryption(activePubKey, h_mpk, e_serverAssets)
        console.log('generateWallets - pt_serverAssets=', pt_serverAssets)
        currentAssets = JSON.parse(pt_serverAssets) // take from server
    } else {
        currentAssets = {} // generate new
    }

    // determine what wallets to generate, if any
    const currentTypes = Object.keys(currentAssets)
    var supportWalletTypes = configWallet.getSupportedWalletTypes()
    var needToGenerate = configWallet.WALLET_REGEN_EVERYTIME
        ? supportWalletTypes
        : supportWalletTypes.filter(assetType => !currentTypes.includes(assetType))
    console.log(`generateWallets - currentAssets,currentTypes,needToGenerate,supportWalletTypes=`, currentAssets, currentTypes, needToGenerate, supportWalletTypes)

    // (re)generate wallets
    // (all, if set by option, else only those assets not present in the server data, i.e. if a new account, or if we've added newly supported types)
    if (needToGenerate.length > 0) {

        console.log(`%c *** GENERATING ${needToGenerate.length} NEW ASSET TYPE(s)... ***`, 'background: purple; color: white; font-weight: 600; font-size: large;')

        // inverse/remove: remove server assets no longer in client-side asset list
        const currentAssetNames = Object.keys(currentAssets)
        const currentAssetsToRemove = currentAssetNames.filter(p => needToGenerate.some(p2 => p === p2) === false)
        if (currentAssetsToRemove.length > 0) {
            console.log(`%c *** REMOVING ${currentAssetsToRemove.length} ASSETS TYPE(s) (NOT PRESENT IN CLIENT LIST)... ***`, 'background: red; color: white; font-weight: 600; font-size: large;', currentAssetsToRemove)
            currentAssetsToRemove.forEach(removeAssetName => {
                delete currentAssets[removeAssetName]
            })
        }

        // generate ETH first (ERC20 and ETH(T) will use its privkey)
        if (needToGenerate.includes('ethereum')) {
            var ret = generateWalletAccount({ assets: currentAssets, genType: 'ethereum', h_mpk })
            needToGenerate = needToGenerate.filter(p => p !== 'ethereum')
            console.log(`generateWallets - did ETH ret=${ret}, new needToGenerate=${JSON.stringify(needToGenerate)}`)
        }

        // generate the rest
        needToGenerate.forEach(genType => generateWalletAccount({ assets: currentAssets, genType, h_mpk, eosActiveWallet }))

        // create top-level addresses (flattened across asset's sub-accounts)
        /*console.time('addrFromKeys')
        Object.keys(currentAssets).map(assetName => {
            var o = currentAssets[assetName]

            if (configWallet.WALLET_REGEN_EVERYTIME || o.addresses == undefined) {
                o.addresses = []
                for (var i=0; i < o.accounts.length ; i++) {
                    o.accounts[i].privKeys
                    .map(key => newWalletAddressFromPrivKey({
                            assetName: assetName, 
                        accountName: o.accounts[i].name,
                                key: key, 
                    eosActiveWallet: eosActiveWallet, 
                            knownAddr: undefined
                                symbol: o.symbol,
                    }))
                    .forEach(addr => {
                        o.addresses.push(addr)
                    })
                }
            }
            console.log(`v2 - multi-addr - assetName=${assetName} o=`, o)
        })
        console.timeEnd('addrFromKeys')*/

        // create top-level addresses - w/ cpuWorkers
        // perf -- a flattened list of ops across all assets/accounts/keys
        // thottled-promise pattern, dispatch op to oen of n cpuWorkers
        var opParams = []
        var reqId = 0
        Object.keys(currentAssets).forEach(function(assetName) {
            var o = currentAssets[assetName]
            if (configWallet.WALLET_REGEN_EVERYTIME || o.addresses == undefined) {
                o.addresses = [] // initialize asset addresses[]
                for (var i=0; i < o.accounts.length ; i++) {
                    const accountNdx = i
                    const accountOpParams = 
                        o.accounts[i].privKeys.map(key => ({
                                reqId: `${reqId++}`,
                            params: {
                                        symbol: configWallet.walletsMeta[assetName].symbol,
                                    assetName: assetName, 
                                accountName: o.accounts[accountNdx].name,
                                        key: key, 
                            eosActiveWallet: eosActiveWallet, 
                                    knownAddr: undefined,
                            }
                        } ))
                    opParams = opParams.concat(accountOpParams)
                }
            }
        })
        const limit = pLimit(utilsWallet.CPU_WORKERS)
        opParams.forEach(p => p.totalReqCount = opParams.length)
        const results = await Promise.all(opParams.map(p => limit(() => utilsWallet.op_WalletAddrFromPrivKey(p, callbackProcessed))))

        const assetNames = Object.keys(currentAssets)
        results.forEach(function(addr) { // populate asset addresses[] with results
            for (var i=0 ; i < assetNames.length ; i++) {
                const assetName = assetNames[i], assetMeta = configWallet.walletsMeta[assetName]
                if (assetMeta.symbol === addr.symbol) {
                    currentAssets[assetName].addresses.push(addr)
                    break
                }
            }
        })

        // log, all done 
        console.log(`%c *** FINISHED GENERATING NEW ASSET TYPE(s)... ***`, 'background: green; color: white; font-weight: 600; font-size: large;', currentAssets)  // ###########

        //
        // encrypt & postback raw asset data to server - potentially with newly added assets
        // 

        // persist raw encrypted server - pruned raw assets (without addresss data)
        apiWallet.updateAssetsJsonApi(userAccountName, pruneRawAssets(currentAssets, activePubKey, h_mpk), e_email)
        .catch(error => {
            console.log("ERROR #1.UA-APP CANNOT PROCESS UPDATE (" + error + ")")
            let msg = "Unknown Error"
            try {
                msg = error.response.data.msg || error.message || "Unknown Error"
            } catch (_) {
                msg = error.message || "Unknown Error"
            }
            store.dispatch({ type: actionsWallet.WCLIENT_SET_ASSETS_ERROR, payload: { statusCode: error.response.status, message: msg } })
        })

        // persist assets encrypted local - unpruned raw assets (private keys, with derived address data)
        var rawAssetsJsonUpdated = JSON.stringify(currentAssets, null, 4) // full
        const e_rawAssetsUpdated = utilsWallet.aesEncryption(activePubKey, h_mpk, rawAssetsJsonUpdated)
        console.log("wallets - generateWallets - rawAssetsJsonUpdated=" + rawAssetsJsonUpdated) // ###########
        store.dispatch({ type: actionsWallet.WCORE_SET_ASSETS_RAW, payload: e_rawAssetsUpdated })
        rawAssetsJsonUpdated = null

    } else {

        console.log(`%c *** FINISHED LOAD & X-REF CHECK FOR ASSET TYPES... ***`, 'background: orange; color: white; font-weight: 600; font-size: large;', currentAssets)
        store.dispatch({ type: actionsWallet.WCORE_SET_ASSETS_RAW, payload: e_serverAssets }) // persist encrypted local - no changes
    }

    // ***
    // store local state: viewable asset data, e.g. last known balances: subset of currentAssets, persisted to browser storage, without privkeys
    // ***
    store.dispatch(displayableWalletAssets(currentAssets, userAccountName))
    utilsWallet.softNuke(currentAssets)
}

function pruneRawAssets(currentAssets, activePubKey, h_mpk) {
    // prune
    var currentAssetsKeysOnly = {} 
    Object.keys(currentAssets).map(assetName => {
         var assetAccounts = _.cloneDeep(currentAssets[assetName].accounts)
         currentAssetsKeysOnly[assetName] = { accounts: assetAccounts }
    })

    // stringify
    var pt_assetsJsonPruned = JSON.stringify(currentAssetsKeysOnly, null, 1)

    // encrypt
    const e_assetsRawPruned = utilsWallet.aesEncryption(activePubKey, h_mpk, pt_assetsJsonPruned)

    utilsWallet.softNuke(currentAssetsKeysOnly)
    pt_assetsJsonPruned = null
    return e_assetsRawPruned
}

//
// creates wallet.assets[] safe/displayable core wallet data
//
export function displayableWalletAssets(assets, owner) {
    return (dispatch) => {
        var displayableAssets = []
        if (assets) {
            for (const key in assets) {

                if (!configWallet.getSupportedWalletTypes().includes(key)) continue

                if (assets[key]) {
                    var displayableAsset =
                        Object.assign(
                            {
                                // multi-addr: v2
                                addresses: assets[key].addresses,
                                local_txs: [],
                            },
                            configWallet.walletsMeta[key] 
                        )

                    displayableAssets.push(displayableAsset)
                }
            }
        }
        dispatch({ type: actionsWallet.WCORE_SET_ASSETS, payload: { assets: displayableAssets, owner } })
    }
}

//
// get fees
//
export function getEstimateFee(asset) {
    return (dispatch) => {
        //console.log("fees - getEstimateFee")
        switch (asset.type) {

            case configWallet.WALLET_TYPE_UTXO:
                actionsWalletUtxo.estimateFees_Utxo(asset.symbol)
                .then(res => {
                    console.log(`fees - (UTXO) getEstimateFee - ${asset.symbol}, res=`, res)

                    // v2 - variable satsPerByte 
                     // sat/byte -- total fee will depend on tx (v)size
                    dispatch({ type: actionsWallet.WCORE_SET_UTXO_FEES, payload: { feeData: res, symbol: asset.symbol } })
                })
                .catch(err => {
                    console.error(`### fees - getEstimateFee ${asset.symbol} FAIL - err=`, err)
                    //...
                })
                break

            case configWallet.WALLET_TYPE_ACCOUNT:
                const estiamteGasParams = {
                    from: asset.addresses[0].addr,
                      to: configExternal.walletExternal_config[asset.symbol].donate,
                   value: 1.0
                }
                actionsWalletAccount.estimateGasInEther(asset, estiamteGasParams)
                .then(res => {
                    console.log(`fees - (ACCOUNT) getEstimateFee - ${asset.symbol}, res=`, res)

                    // v2 - variable gasPrices
                    // full payload: user can select, and fee is calculated at send time
                    dispatch({ type: actionsWallet.WCORE_SET_ETH_GAS_PRICES, payload: { feeData: res, symbol: asset.symbol } }) 
                })
                .catch(err => {
                    console.error(`### fees - getEstimateFee ${asset.symbol} FAIL - err=`, err)
                    //...
                })
                break

            default: console.error(`fees - unsupported asset type ${asset.type}`)
        }
    }
}

//
// Get bitcoin-js / bitgo-utxo-lib network object for supplied
//
export function getUtxoNetwork(symbol) {

    // https://github.com/BitGo/bitgo-utxo-lib/blob/master/src/networks.js
    // https://www.npmjs.com/package/@upincome/coininfo
    // https://github.com/libbitcoin/libbitcoin-system/wiki/Altcoin-Version-Mappings
    // https://github.com/libbitcoin/libbitcoin-system/issues/319

    const coininfo = require('coininfo')
    switch (symbol) { 
        case "BTC":      return bitgoUtxoLib.networks.bitcoin
        case "BTC_SEG":  return bitgoUtxoLib.networks.bitcoin
        case "BTC_TEST": return bitgoUtxoLib.networks.testnet
        case "LTC":      return bitgoUtxoLib.networks.litecoin
        case "ZEC":      return bitgoUtxoLib.networks.zcash
        case "DASH":     return bitgoUtxoLib.networks.dash
        case "BCHABC":   return bitgoUtxoLib.networks.bitcoincash
        case "VTC":      return coininfo('VTC').toBitcoinJS()
        case "QTUM":     return coininfo('QTUM').toBitcoinJS()
        case "DGB":
            var ret = coininfo('DGB')
            ret.versions.bip32 = { public: 0x0488B21E, private: 0x0488ADE4 }
            var ret_js = ret.toBitcoinJS()
            return ret_js

        default:
            return undefined
    }
}

//
// PrivKey -> Address (all types)
//
export function getAddressFromPrivateKey(p) {
    const { assetMeta, privKey, eosActiveWallet } = p

    if (assetMeta.type === configWallet.WALLET_TYPE_UTXO) {
        return getUtxoTypeAddressFromWif(privKey, assetMeta.symbol)
    }

    else if (assetMeta.type === configWallet.WALLET_TYPE_ACCOUNT) {
        return getAccountTypeAddress(privKey, assetMeta.symbol, eosActiveWallet)
    }

    else console.warn('### Wallet type ' + assetMeta.type + ' not supported!')
}

// for safe mapping to displayable wallet assets - keyed by path on underlying encrypted privKey
export function newWalletAddressFromPrivKey(p) {
    const { assetName, accountName, key, eosActiveWallet, knownAddr, symbol } = p
    
    var addr = !knownAddr ? getAddressFromPrivateKey(
                    { assetMeta: configWallet.walletsMeta[assetName], privKey: key.privKey, eosActiveWallet }
                )
              : knownAddr // perf (bulk import) - don't recompute the key if it's already been done

    return {
        symbol,
        addr, 
        accountName, 
        path: key.path, // see config/wallet -- we don't have completely unique HD paths (e.g. BTC/SW, and testnets), but seems not to matter too much (?)
        txs: [],
        utxos: [],
        lastAddrFetchAt: undefined,
    }
}

// https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki
function generateWalletAccount(p) {
    const { assets, genType, h_mpk, eosActiveWallet } = p
    console.log(`wallets - generateWallets - generateWalletAccount - genType=${genType}, h_mpk=`, h_mpk)
    var defaultPrivKeys
    switch (genType) {
        case 'btc(t)': defaultPrivKeys = generateUtxoBip44Wifs({ entropySeed, symbol: 'BTC_TEST' }); break; 

        case 'bitcoin':  defaultPrivKeys = generateUtxoBip44Wifs({ entropySeed: h_mpk, symbol: 'BTC' }); break; 
        case 'btc(s)':   defaultPrivKeys = generateUtxoBip44Wifs({ entropySeed: h_mpk, symbol: 'BTC_SEG' }); break; 
        case 'litecoin': defaultPrivKeys = generateUtxoBip44Wifs({ entropySeed: h_mpk, symbol: 'LTC' }); break; 
        case 'zcash':    defaultPrivKeys = generateUtxoBip44Wifs({ entropySeed: h_mpk, symbol: 'ZEC' }); break; 
        case 'dash':     defaultPrivKeys = generateUtxoBip44Wifs({ entropySeed: h_mpk, symbol: 'DASH' }); break; 
        case 'vertcoin': defaultPrivKeys = generateUtxoBip44Wifs({ entropySeed: h_mpk, symbol: 'VTC' }); break;
        case 'qtum':     defaultPrivKeys = generateUtxoBip44Wifs({ entropySeed: h_mpk, symbol: 'QTUM' }); break;
        case 'digibyte': defaultPrivKeys = generateUtxoBip44Wifs({ entropySeed: h_mpk, symbol: 'DGB' }); break;
        case 'bchabc':   defaultPrivKeys = generateUtxoBip44Wifs({ entropySeed: h_mpk, symbol: 'BCHABC' }); break;

        case 'ethereum': defaultPrivKeys = generateEthereumWallet({ entropySeed: h_mpk, addrNdx: 0, genCount: configWallet.WALLET_DEFAULT_ADDRESSES }); break

        case 'eos':
            console.log(`eos=`, eosActiveWallet)
            var meta = configWallet.getMetaBySymbol('EOS')
            defaultPrivKeys = [{ privKey: eosActiveWallet.wif, path: `m/44'/${meta.bip44_index}'/0'/0/0` }]; break

        default:
            if (configWallet.walletsMeta[genType].addressType === configWallet.ADDRESS_TYPE_ETH) {
                defaultPrivKeys = assets['ethereum'].accounts !== undefined
                    ? assets['ethereum'].accounts[0].privKeys.slice()
                    : [{ privKey: assets['ethereum'].wif }]
            }
            break
    }

    if (defaultPrivKeys !== undefined) { // save only the wifs/privkeys

        var asset = assets[genType]
        if (asset === undefined) {
             // no existing server data: first-time creation
            asset = { accounts: [] }    
            asset.accounts.push({ // new default asset account
                name: `Scoop ${configWallet.walletsMeta[genType].displayName}`,
                privKeys: []
            })
            asset.accounts[0].privKeys = defaultPrivKeys.slice() // new asset default address indexes
            assets[genType] = asset
        } else {
            // we are "merging" (actually, replacing) existing server data in the default account's default address indexes;
            // this isn't strictly necessary, as the server already has recorded and sent us the default indexes, but in the interests
            // of being strictly deterministic:
            for (var ndx=0 ; ndx < defaultPrivKeys.length ; ndx++) {
                asset.accounts[0].privKeys[ndx] = defaultPrivKeys[ndx]
            }
            // note: we leave any other server-populated address indexes alone, so any user-activated (non-default) addresses persist across logins
        }

        console.log(`wallets - generateWallets - genType=${genType} pushed defaultPrivKeys=`, defaultPrivKeys)
        return true
    }
    return false
}

//
// utxo types
//
function generateUtxoBip44Wifs(p) { 
    const { entropySeed, symbol, addrNdx = 0, genCount = configWallet.WALLET_DEFAULT_ADDRESSES } = p

    var keyPairs = []
    const network = getUtxoNetwork(symbol) // bitgo
    if (network === undefined) throw ('generateUtxoBip44Wifs - unsupported type')

    var meta = configWallet.getMetaBySymbol(symbol)

    const entropySha256 = utilsWallet.sha256_shex(entropySeed)
    var root = bitgoUtxoLib.HDNode.fromSeedHex(entropySha256, network) // bitgo HDNode 

    var accountNdx = 0 // scoop default account
    var chainNdx = 0   // bip44: 0=external chain, 1=internal chain (change addresses)
    for (var i = addrNdx; i < addrNdx + genCount; i++) {
        const path = `m/44'/${meta.bip44_index}'/${accountNdx}'/${chainNdx}/${i}`
        const child = root.derivePath(path)

        //var keyPair = ECPair.fromPrivateKey(child.privateKey, { network }) // bitcoin-js (no ZEC support, see https://github.com/bitcoinjs/bitcoinjs-lib/issues/865)
        var keyPair = child.keyPair // bitgo

        var wif = keyPair.toWIF()
        console.log(`generateUtxoBip44Wifs - ${symbol} BIP44 - child,keyPair,network=`, child, keyPair, network)
        keyPairs.push({ privKey: wif, path })
    }
    return keyPairs
}
export function getUtxoTypeAddressFromWif(wif, symbol) {
    //console.log(`getUtxoTypeAddressFromWif wif=${wif} symbol=${symbol}...`)
    try {
        const network = getUtxoNetwork(symbol) // bitgo networks: supports ZEC UInt16 pubKeyHash || scriptHash

        const keyPair = bitgoUtxoLib.ECPair.fromWIF(wif, network) // bitgo ECPair, below: .getPublicKeyBuffer() instead of .publicKey in bitcoin-js

        if (symbol === "BTC" || symbol === "LTC" || symbol === "BTC_TEST") {
            // bitcoinjs-lib

            // native segwit - BlockCypher throws errors on address_balance -- generated bc1 addr isn't viewable on any block explorers!
            // const { address } = payments.p2wpkh({ pubkey: keyPair.publicKey, network })
            // return address

            // ** preferred **
            // p2sh-wrapped segwit -- need to generate tx json entirely, blockcypher doesn't support
            // const { address } = payments.p2sh({ redeem: payments.p2wpkh({ pubkey: keyPair.publicKey, network }) })
            // return address

            // legacy addr
            const { address } = payments.p2pkh({ pubkey: keyPair.getPublicKeyBuffer(), network }) // bitcoin-js payments (works with bitgo networks)
            return address
        }
        else if (symbol === "BTC_SEG") {
            // bitcoinjs-lib
            
            // p2sh(p2wpkh) addr
            const { address } = payments.p2sh({ redeem: payments.p2wpkh({ pubkey: keyPair.getPublicKeyBuffer(), network }), network })
            return address
        }
        else { 
            // bitgo-utxo-lib (note - can't use bitcoin-js payment.p2pkh with ZEC UInt16 pubKeyHash || scriptHash)

            var addr = keyPair.getAddress()
            if (symbol === 'BCHABC') {
                if (addr.startsWith('1')) {
                    addr = bchAddr.toCashAddress(addr)
                }
            }
            return addr
        }
    }
    catch (err) { 
        console.error(`getUtxoTypeAddressFromWif (${wif}) - FAIL: ${err.message}`, err)
        return null
    }
}

//
// account typpes
//
function generateEthereumWallet(p) {
    const { entropySeed, addrNdx = 0, genCount = configWallet.WALLET_DEFAULT_ADDRESSES } = p

    try {
        var privKeys = []
        const root = bip32.fromSeed(Buffer.from(utilsWallet.hextoba(utilsWallet.sha256_shex(entropySeed))))
        var meta = configWallet.getMetaBySymbol('ETH')
        var accountNdx = 0 // scoop default account
        var chainNdx = 0   // bip44: 0=external chain, 1=internal chain (change addresses)
        for (var i = addrNdx; i < addrNdx + genCount; i++) {
            const path = `m/44'/${meta.bip44_index}'/${accountNdx}'/${chainNdx}/${i}`
            const child = root.derivePath(path)
            privKeys.push({ privKey: utilsWallet.batohex(child.privateKey), path })
        }
        return privKeys
    }
    catch (err) { 
        debugger
        console.log(`generateEthereumWallet - FAIL: ${err.message}`, err)
        return null
    }
}

function getAccountTypeAddress(privKey, symbol, eosActiveWallet) {
    //console.log(`getAccountTypeAddress privKey=${privKey} symbol=${symbol}...`)
    try {
        if (symbol === "EOS") {
            if (eosActiveWallet !== undefined && eosActiveWallet !== null) {
                //console.log(`getAccountTypeAddress - eosActiveWallet=`, eosActiveWallet)
                return eosActiveWallet.address
            } else {
                console.warn(`## getAccountTypeAddress - eosActiveWallet undefined!`)
                return undefined
            }
        }
        else {
            return "0x" + privateToAddress(Buffer.from(utilsWallet.hextoba(privKey), 'hex')).toString('hex')
        }
    }
    catch (err) {
        debugger
        console.log(`getAccountTypeAddress - FAIL: ${err.message}`, err)
        return null
    }
}