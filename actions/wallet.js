const Buffer = require('buffer').Buffer
const _ = require('lodash')
const pLimit = require('p-limit')

const bitgoUtxoLib = require('bitgo-utxo-lib')

const bitcoinJsLib = require('bitcoinjs-lib')
const bip32 = require('bip32')
const ethereumJsUtil = require('ethereumjs-util')
const bchAddr = require('bchaddrjs')

const configWallet = require('../config/wallet')
const configExternal = require('../config/wallet-external')

const actionsWallet = require('../actions')
const actionsWalletUtxo = require('./wallet-utxo')
const actionsWalletAccount = require('./wallet-account')

const apiWallet = require('../api/wallet')

const utilsWallet = require('../utils')

module.exports = { 

    //
    // issues appWorker requests to populate asset data (balances & tx's) for the loaded wallet
    //
    loadAllAssets: (p) => {

        const { bbSymbols_SocketReady, store } = p // todo - could make use of BB field to exclude BBv3 assets with known sockets down 
        if (!store) throw 'No store supplied'
        var storeState = store.getState()
        if (!storeState) throw 'Invalid store state'
        const wallet = storeState.wallet
        if (!wallet || !wallet.assets) throw 'No wallet supplied'
        
        utilsWallet.logMajor('green','white', `loadAllAssets...`, null, { logServerConsole: true })

        const globalScope = utilsWallet.getMainThreadGlobalScope()
        const appWorker = globalScope.appWorker

        return new Promise((resolve) => {

            // fetch eth first -- all erc20 fetches will then use eth's cached tx data in the indexeddb
            const ethAssets = wallet.assets.filter(p => p.symbol === 'ETH' || p.symbol === 'ETH_TEST')
            ethAssets.forEach(ethAsset => {
                appWorker.postMessage({ msg: 'REFRESH_ASSET_FULL', data: { asset: ethAsset, wallet } })
            })

            // then fetch all others, except erc20s
            const otherAssets = wallet.assets.filter(p => (p.symbol !== 'ETH' && p.symbol !== 'ETH_TEST') && !utilsWallet.isERC20(p))
            otherAssets.forEach(otherAsset => {
                appWorker.postMessage({ msg: 'REFRESH_ASSET_FULL', data: { asset: otherAsset, wallet } })
            })

            // get initial sync (block) info, all assets
            wallet.assets.forEach(asset => {
                appWorker.postMessage({ msg: 'GET_SYNC_INFO', data: { symbol: asset.symbol } })
            })

            // wait for eth fetch to finish, then fetch erc20's
            const eth_intId = setInterval(() => {
                storeState = store.getState()
                if (storeState && storeState.wallet && storeState.wallet.assets) {
                    const ethAsset = storeState.wallet.assets.find(p => p.symbol === 'ETH')
                    if (ethAsset.lastAssetUpdateAt === undefined) {
                        utilsWallet.warn(`Wallet - pollAllAddressBalances: waiting for ETH to finish...`)
                    }
                    else {
                        const erc20Assets = wallet.assets.filter(p => utilsWallet.isERC20(p))
                        erc20Assets.forEach(erc20Asset => {
                            appWorker.postMessage({ msg: 'REFRESH_ASSET_FULL', data: { asset: erc20Asset, wallet } })
                        })
                        clearInterval(eth_intId)

                        // now wait for all erc20 fetches to finish, then resolve for caller
                        const erc20s_intId = setInterval(() => {
                            storeState = store.getState()
                            if (storeState && storeState.wallet && storeState.wallet.assets) {
                                const erc20Assets = storeState.wallet.assets.filter(p => utilsWallet.isERC20(p))
                                if (!erc20Assets.some(p => p.lastAssetUpdateAt === undefined)) {
                                    // done
                                    clearInterval(erc20s_intId)
                                    resolve()
                                    utilsWallet.logMajor('green','white', `loadAllAssets - complete`, null, { logServerConsole: true })
                                }
                                else {
                                    utilsWallet.warn(`Wallet - pollAllAddressBalances: waiting for ERC20s to finish...`)
                                }
                            }
                        }, 1000)
                    }
                }
            }, 1000)
        })
    },

    //
    // imports external privkeys into a new import account
    //
    importPrivKeys: async (p) => { 
        if (configWallet.WALLET_ENV === "SERVER") throw("Not yet supported on server")

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
        const newDisplayableAssets = _.cloneDeep(displayableAssets)
        const newDisplayableAsset = newDisplayableAssets.find(p => { return p.symbol === genSymbol })
        for (var i=0 ; i < addrKeyPairs.length ; i++) {
            const addr = addrKeyPairs[i].addr
            var newDisplayableAddr = newWalletAddressFromPrivKey( {
                  assetName: assetName.toLowerCase(),
                accountName: importAccount.name,
                        key: privKeys.find(p => p.privKey == addrKeyPairs[i].privKey),
            eosActiveWallet: eosActiveWallet,
                  knownAddr: addr,
                     symbol: newDisplayableAsset.symbol
            })
            if (newDisplayableAddr.addr === null) {
                utilsWallet.softNuke(rawAssets); utilsWallet.softNuke(genAsset); pt_rawAssets = null
                return { err: "Invalid Private Key" }
            }
            newDisplayableAsset.addresses.push(newDisplayableAddr)
        }
        store.dispatch({ type: actionsWallet.WCORE_SET_ASSETS, payload: { assets: newDisplayableAssets, owner: userAccountName } })

        // raw assets: post encrypted
        return apiWallet.updateAssetsJsonApi(userAccountName, module.exports.pruneRawAssets(rawAssets, activePubKey, h_mpk), e_email)
        .then((res) => {
            rawAssetsJsonUpdated = null

            if (configWallet.WALLET_ENV === "BROWSER") {

                // update addr monitors
                window.appWorker.postMessage({ msg: 'DISCONNECT_ADDRESS_MONITORS', data: { wallet } })
                window.appWorker.postMessage({ msg: 'CONNECT_ADDRESS_MONITORS', data: { wallet } })

                // refresh asset balance
                window.appWorker.postMessage({ msg: 'REFRESH_ASSET_BALANCE', data: { asset: newDisplayableAsset, wallet } })
            }
            
            // ret ok
            utilsWallet.softNuke(rawAssets); utilsWallet.softNuke(genAsset); pt_rawAssets = null
            return { importedAddrCount: privKeys.length, accountName: importAccount.name }
        })
        .catch(err => {
            utilsWallet.error(`## Wallet - importPrivKeys -- FAIL posting, err=`, err)
            utilsWallet.softNuke(rawAssets); utilsWallet.softNuke(genAsset); pt_rawAssets = null
            return { err: err.toString() }
        })
    },

    //
    // removes imported account(s)
    //
    removeImportedAccounts: async (p) => {
        if (configWallet.WALLET_ENV === "SERVER") throw("Not yet supported on server")

        const { store, userAccountName, e_rawAssets, eosActiveWallet, assetName, wallet, removeAccounts, 
                activePubKey, e_email, h_mpk } = p
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
        const newDisplayableAssets = _.cloneDeep(displayableAssets)
        const newDisplayableAsset = newDisplayableAssets.find(p => { return p.symbol === genSymbol })
        const removedAddrCount = newDisplayableAsset.addresses.filter(p => removeAccounts.some(p2 => p2 === p.accountName) === true).length
        newDisplayableAsset.addresses = newDisplayableAsset.addresses.filter(p => removeAccounts.some(p2 => p2 === p.accountName) === false)
        store.dispatch({ type: actionsWallet.WCORE_SET_ASSETS, payload: { assets: newDisplayableAssets, owner: userAccountName } })

        // raw assets: post encrypted
        return apiWallet.updateAssetsJsonApi(userAccountName, module.exports.pruneRawAssets(rawAssets, activePubKey, h_mpk), e_email)
        .then(() => {

            rawAssetsJsonUpdated = null

            if (configWallet.WALLET_ENV === "BROWSER") {

                // update addr monitors
                window.appWorker.postMessage({ msg: 'DISCONNECT_ADDRESS_MONITORS', data: { wallet } })
                window.appWorker.postMessage({ msg: 'CONNECT_ADDRESS_MONITORS', data: { wallet } })

                // refresh asset balance
                window.appWorker.postMessage({ msg: 'REFRESH_ASSET_BALANCE', data: { asset: newDisplayableAsset, wallet } })
            }

            // ret ok
            utilsWallet.softNuke(rawAssets); utilsWallet.softNuke(genAsset); pt_rawAssets = null
            return { removedAddrCount, removedAccountCount }
        })
        .catch(err => {
            utilsWallet.error(`## Wallet - removeImportedAccounts -- FAIL posting, err=`, err)
            utilsWallet.softNuke(rawAssets); utilsWallet.softNuke(genAsset); pt_rawAssets = null
            return { err: err.toString() }
        })
    },

    //
    // generates new address (in the primary scoop account)
    //
    generateNewAddress: async (p) => {
        const { store, activePubKey, h_mpk, assetName, // required - browser & server
                userAccountName, e_email,              // required - browser 
                eosActiveWallet } = p

        // validation
        if (!store) throw("store is required")
        if (!activePubKey) throw("activePubKey is required")
        if (!store) throw("store is required")
        if (!h_mpk) throw("h_mpk is required")

        const storeState = store.getState()
        if (!storeState || !storeState.wallet || !storeState.wallet.assets || !storeState.wallet.assetsRaw) throw("Invalid store state")
        const wallet = storeState.wallet
        const e_rawAssets = storeState.wallet.assetsRaw
        
        //if (!userAccountName) { throw("generateNewAddress - not logged in") }
        const displayableAssets = wallet.assets

        utilsWallet.logMajor('green','white', `generateNewAddress...`, null, { logServerConsole: true })

        // decrypt raw assets
        var pt_rawAssets = utilsWallet.aesDecryption(activePubKey, h_mpk, e_rawAssets)
        var rawAssets = JSON.parse(pt_rawAssets)

        // get asset and account to generate into
        const genAsset = rawAssets[assetName.toLowerCase()]
        if (genAsset === undefined || !genAsset.accounts || genAsset.accounts.length == 0) throw("Invalid assetName")
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
            if (userAccountName && configWallet.WALLET_ENV === "BROWSER") {
                await apiWallet.updateAssetsJsonApi(userAccountName, module.exports.pruneRawAssets(rawAssets, activePubKey, h_mpk), e_email)
            }
        
            rawAssetsJsonUpdated = null

            // add new displayable asset address object
            const newDisplayableAssets = _.cloneDeep(displayableAssets)
            const newDisplayableAsset = newDisplayableAssets.find(p => { return p.symbol === genSymbol })

            const newDisplayableAddr = newWalletAddressFromPrivKey( {
                      assetName: assetName.toLowerCase(),
                    accountName: genAccount.name,
                            key: newPrivKey,
                eosActiveWallet: eosActiveWallet,
                      knownAddr: undefined,
                         symbol: newDisplayableAsset.symbol
            })

            newDisplayableAsset.addresses.push(newDisplayableAddr)
            store.dispatch({ type: actionsWallet.WCORE_SET_ASSETS, payload: { assets: newDisplayableAssets, owner: userAccountName } })

            if (configWallet.WALLET_ENV === "BROWSER") {
                const globalScope = utilsWallet.getMainThreadGlobalScope()
                const appWorker = globalScope.appWorker    

                // update addr monitors
                appWorker.postMessage({ msg: 'DISCONNECT_ADDRESS_MONITORS', data: { wallet } })
                appWorker.postMessage({ msg: 'CONNECT_ADDRESS_MONITORS', data: { wallet } })
        
                // refresh asset balance
                appWorker.postMessage({ msg: 'REFRESH_ASSET_BALANCE', data: { asset: newDisplayableAsset, wallet } })
            }
            else {
                ; // nop
                // server is better placed to than here handle addr-monitor connection better 
            }
            
            // ret ok
            utilsWallet.softNuke(rawAssets); pt_rawAssets = null
            utilsWallet.logMajor('green','white', `generateNewAddress - complete`, null, { logServerConsole: true })
            return { newAddr: newDisplayableAddr, newCount: genAccount.privKeys.length }

        } else {
            // ret fail
            utilsWallet.softNuke(rawAssets); pt_rawAssets = null
            return { err: 'PrivKey-gen failed', newAddr: undefined }
        }
    },

    //
    // generates a new scoop wallet, for all supported assets
    // browser: decrypts saved eos server data and merges & saves back to eos any previosuly imported accounts
    //  server: persists only to redux store
    //
    generateWallets: async (p) => {
        const { store, userAccountName, e_storedAssetsRaw, eosActiveWallet, callbackProcessed, 
                activePubKey, e_email, h_mpk } = p
        if (!store) { throw("Invalid store") }
        if (!h_mpk) { throw("Invalid h_mpk") }

        // decrypt existing raw assets, if supplied (either from server in client mode, or from file in server mode)
        var pt_storedRawAssets
        var currentAssets
        if (e_storedAssetsRaw !== undefined && e_storedAssetsRaw !== null && e_storedAssetsRaw !== '') {
            pt_storedRawAssets = utilsWallet.aesDecryption(activePubKey, h_mpk, e_storedAssetsRaw)
            if (!pt_storedRawAssets || pt_storedRawAssets.length === 0) {
                return null // decrypt failed
            }
            currentAssets = JSON.parse(pt_storedRawAssets)
        } else {
            currentAssets = {} // generate new
        }

        // determine what wallets to generate, if any
        const currentTypes = Object.keys(currentAssets)
        var supportWalletTypes = configWallet.getSupportedWalletTypes()
        var needToGenerate = configWallet.WALLET_REGEN_EVERYTIME
            ? supportWalletTypes
            : supportWalletTypes.filter(assetType => !currentTypes.includes(assetType))

        // (re)generate wallets
        // (all, if set by option, else only those assets not present in the server data, i.e. if a new account, or if we've added newly supported types)
        if (needToGenerate.length > 0) {

            utilsWallet.logMajor('green','white', `GENERATING ${needToGenerate.length} NEW ASSET TYPE(s)...`, null, { logServerConsole: true })

            // inverse/remove: remove server assets no longer in client-side asset list
            const currentAssetNames = Object.keys(currentAssets)
            const currentAssetsToRemove = currentAssetNames.filter(p => needToGenerate.some(p2 => p === p2) === false)
            if (currentAssetsToRemove.length > 0) {
                utilsWallet.warn(`REMOVING ${currentAssetsToRemove.length} ASSETS TYPE(s) (NOT PRESENT IN CLIENT LIST)... ***`, currentAssetsToRemove)
                currentAssetsToRemove.forEach(removeAssetName => {
                    delete currentAssets[removeAssetName]
                })
            }

            // generate ETH first (ERC20 and ETH(T) will use its privkey)
            if (needToGenerate.includes('ethereum')) {
                var ret = generateWalletAccount({ assets: currentAssets, genType: 'ethereum', h_mpk })
                needToGenerate = needToGenerate.filter(p => p !== 'ethereum')
                //utilsWallet.log(`generateWallets - did ETH ret=${ret}, new needToGenerate=${JSON.stringify(needToGenerate)}`)
            }

            // generate the rest
            needToGenerate.forEach(genType => generateWalletAccount({ assets: currentAssets, genType, h_mpk, eosActiveWallet }))

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

            const globalScope = utilsWallet.getMainThreadGlobalScope()
            const limit = pLimit(globalScope.CPU_WORKERS)
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
            utilsWallet.logMajor('green', 'white', `FINISHED GENERATING NEW ASSET TYPE(s)...`, null, { logServerConsole: true })

            //
            // encrypt & postback raw asset data to server - potentially with newly added assets
            // 

            // persist raw encrypted to eos server - pruned raw assets (without addresss data)
            if (userAccountName && configWallet.WALLET_ENV === "BROWSER") {
                apiWallet.updateAssetsJsonApi(userAccountName, module.exports.pruneRawAssets(currentAssets, activePubKey, h_mpk), e_email)
                .catch(error => {
                    utilsWallet.log("ERROR #1.UA-APP CANNOT PROCESS UPDATE (" + error + ")")
                    let msg = "Unknown Error"
                    try {
                        msg = error.response.data.msg || error.message || "Unknown Error"
                    } catch (_) {
                        msg = error.message || "Unknown Error"
                    }
                })
            }

            // persist assets encrypted local - unpruned raw assets (private keys, with derived address data)
            var rawAssetsJsonUpdated = JSON.stringify(currentAssets, null, 4) 
            const e_rawAssetsUpdated = utilsWallet.aesEncryption(activePubKey, h_mpk, rawAssetsJsonUpdated)
            store.dispatch({ type: actionsWallet.WCORE_SET_ASSETS_RAW, payload: e_rawAssetsUpdated })
            rawAssetsJsonUpdated = null

        } else {
            utilsWallet.logMajor('green', 'white', `FINISHED LOAD & X-REF CHECK FOR ASSET TYPES...`)
            store.dispatch({ type: actionsWallet.WCORE_SET_ASSETS_RAW, payload: e_storedAssetsRaw }) // persist encrypted local - no changes
        }

        // ***
        // store local state: viewable asset data, e.g. last known balances: subset of currentAssets, persisted to browser storage, without privkeys
        // ***
        const displayableAssets = displayableWalletAssets(currentAssets, userAccountName)
        store.dispatch((action) => {
            action({ type: actionsWallet.WCORE_SET_ASSETS, payload: { assets: displayableAssets, owner: userAccountName } })
        })

        utilsWallet.softNuke(currentAssets)
        return displayableAssets
    },
    
    pruneRawAssets: (currentAssets, activePubKey, h_mpk) => {
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
    },

    //
    // get fees
    //
    getAssetFeeData: (asset) => {
        //utilsWallet.log("fees - getAssetFeeData")
        switch (asset.type) {

            case configWallet.WALLET_TYPE_UTXO:
                return actionsWalletUtxo.estimateFees_Utxo(asset.symbol)
                .then(res => {
                    utilsWallet.log(`fees - (UTXO) getAssetFeeData - ${asset.symbol}, res=`, res)
                    return res
                })
                .catch(err => {
                    utilsWallet.error(`### fees - getAssetFeeData ${asset.symbol} FAIL - err=`, err)
                })
                break

            case configWallet.WALLET_TYPE_ACCOUNT:
                const estimateGasParams = {
                    from: asset.addresses[0].addr,
                      to: configExternal.walletExternal_config[asset.symbol].donate,
                   value: 1.0
                }
                return actionsWalletAccount.estimateGasInEther(asset, estimateGasParams)
                .then(res => {
                    utilsWallet.log(`fees - (ACCOUNT) getAssetFeeData - ${asset.symbol}, res=`, res)
                    return res
                })
                .catch(err => {
                    utilsWallet.error(`### fees - getAssetFeeData ${asset.symbol} FAIL - err=`, err)
                })
                break

            default: utilsWallet.error(`fees - unsupported asset type ${asset.type}`)
        }
    },

    //
    // Get bitcoin-js / bitgo-utxo-lib network object for supplied
    //
    getUtxoNetwork: (symbol) => {
        return getUtxoNetwork(symbol)
    },

    //
    // PrivKey -> Address (all types)
    //
    getAddressFromPrivateKey: (p) => {
        return getAddressFromPrivateKey(p)
    },

    //
    // for safe mapping to displayable wallet assets - keyed by path on underlying encrypted privKey
    //
    newWalletAddressFromPrivKey: (p) => {
        return newWalletAddressFromPrivKey(p)
    },
}

//
// wallet generation
// https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki
//
function generateWalletAccount(p) {
    const { assets, genType, h_mpk, eosActiveWallet } = p
    utilsWallet.log(`generateWalletAccount - genType=`, genType, { logServerConsole: true })
    var defaultPrivKeys
    switch (genType) {
        case 'btc(t)':   defaultPrivKeys = generateUtxoBip44Wifs({ entropySeed: h_mpk, symbol: 'BTC_TEST' }); break; 

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
            //utilsWallet.log(`eos=`, eosActiveWallet)
            if (eosActiveWallet) {
                const meta = configWallet.getMetaBySymbol('EOS')
                defaultPrivKeys = [{ privKey: eosActiveWallet.wif, path: `m/44'/${meta.bip44_index}'/0'/0/0` }]; break
            }

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
        return true
    }
    return false
}

// creates wallet.assets[] safe/displayable core wallet data
function displayableWalletAssets(assets) {
    var displayableAssets = []
    if (assets) {
        for (const key in assets) {
            if (!configWallet.getSupportedWalletTypes().includes(key)) continue
            if (assets[key]) {
                var displayableAsset = Object.assign(
                    { addresses: assets[key].addresses, local_txs: [], },
                    configWallet.walletsMeta[key])

                displayableAssets.push(displayableAsset)
            }
        }
    }
    return displayableAssets
}

//
// general
//
function newWalletAddressFromPrivKey(p) {
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

function getAddressFromPrivateKey(p) {
    const { assetMeta, privKey, eosActiveWallet } = p

    if (assetMeta.type === configWallet.WALLET_TYPE_UTXO) {
        return getUtxoTypeAddressFromWif(privKey, assetMeta.symbol)
    }

    else if (assetMeta.type === configWallet.WALLET_TYPE_ACCOUNT) {
        return getAccountTypeAddress(privKey, assetMeta.symbol, eosActiveWallet)
    }

    else utilsWallet.warn('### Wallet type ' + assetMeta.type + ' not supported!')
}

function getUtxoNetwork(symbol) {

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
// account types
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
        utilsWallet.error(`generateEthereumWallet - FAIL: ${err.message}`, err)
        return null
    }
}

function getAccountTypeAddress(privKey, symbol, eosActiveWallet) {
    //utilsWallet.log(`getAccountTypeAddress privKey=${privKey} symbol=${symbol}...`)
    try {
        if (symbol === "EOS") {
            if (eosActiveWallet !== undefined && eosActiveWallet !== null) {
                return eosActiveWallet.address
            }
            else {
                utilsWallet.warn(`## getAccountTypeAddress - eosActiveWallet undefined!`)
                return undefined
            }
        }
        else {
            return "0x" + ethereumJsUtil.privateToAddress(Buffer.from(utilsWallet.hextoba(privKey), 'hex')).toString('hex')
        }
    }
    catch (err) {
        debugger
        utilsWallet.error(`getAccountTypeAddress - FAIL: ${err.message}`, err)
        return null
    }
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
        //utilsWallet.log(`generateUtxoBip44Wifs - ${symbol} @ BIP44 ndx ${i} - child,keyPair,network=`, child, keyPair, network)
        keyPairs.push({ privKey: wif, path })
    }
    return keyPairs
}

function getUtxoTypeAddressFromWif(wif, symbol) {
    try {
        const network = getUtxoNetwork(symbol) // bitgo networks: supports ZEC UInt16 pubKeyHash || scriptHash

        const keyPair = bitgoUtxoLib.ECPair.fromWIF(wif, network) // bitgo ECPair, below: .getPublicKeyBuffer() instead of .publicKey in bitcoin-js

        if (symbol === "BTC" || symbol === "LTC" || symbol === "BTC_TEST") {
            // bitcoinjs-lib

            // native segwit - BlockCypher throws errors on address_balance -- generated bc1 addr isn't viewable on any block explorers!
            // const { address } = bitcoinJsLib.payments.p2wpkh({ pubkey: keyPair.publicKey, network })
            // return address

            // ** preferred **
            // p2sh-wrapped segwit -- need to generate tx json entirely, blockcypher doesn't support
            // const { address } = bitcoinJsLib.payments.p2sh({ redeem: payments.p2wpkh({ pubkey: keyPair.publicKey, network }) })
            // return address

            // legacy addr
            const { address } = bitcoinJsLib.payments.p2pkh({ pubkey: keyPair.getPublicKeyBuffer(), network }) // bitcoin-js payments (works with bitgo networks)
            return address
        }
        else if (symbol === "BTC_SEG") {
            // bitcoinjs-lib
            
            // p2sh(p2wpkh) addr
            const { address } = bitcoinJsLib.payments.p2sh({ redeem: bitcoinJsLib.payments.p2wpkh({ pubkey: keyPair.getPublicKeyBuffer(), network }), network })
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
        utilsWallet.error(`getUtxoTypeAddressFromWif (${wif}) - FAIL: ${err.message}`, err)
        return null
    }
}