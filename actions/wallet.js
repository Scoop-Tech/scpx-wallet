// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2023 Dominic Morris.

const Buffer = require('buffer').Buffer
const _ = require('lodash')
const pLimit = require('p-limit')
const WAValidator = require('scp-address-validator').validate
const bitgoUtxoLib = require('bitgo-utxo-lib')
const bitcoinJsLib = require('bitcoinjs-lib')
const bip32 = require('bip32')
const ethereumJsUtil = require('ethereumjs-util')
const bchAddr = require('bchaddrjs')

const actionsWallet = require('.')
const walletUtxo = require('./wallet-utxo')
const walletAccount = require('./wallet-account')
const walletValidate = require('./wallet-validation')
const walletShared = require('./wallet-shared')

const configWallet = require('../config/wallet')
const configExternal = require('../config/wallet-external')

const walletP2shBtc = require('./wallet-btc-p2sh')

const apiDataContract = require('../api/data-contract')

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
        
        console.time('loadAllAssets')
        utilsWallet.logMajor('green','white', `loadAllAssets...`, null, { logServerConsole: true })

        const appWorker = utilsWallet.getAppWorker()
        return new Promise((resolve) => {

            // get initial sync (block) info, all assets
            wallet.assets.forEach(asset => {
                appWorker.postMessageWrapped({ msg: 'GET_SYNC_INFO', data: { symbol: asset.symbol } })
            })
            //utilsWallet.log('GET_SYNC_INFO done')

            // fetch eth[_test] first -- erc20 fetches will then use eth's cached tx data in the indexeddb
            const ethAssets = wallet.assets.filter(p => p.symbol === 'ETH' || p.symbol === 'ETH_TEST')
            ethAssets.forEach(ethAsset => {
                if (!configWallet.getSupportedMetaKeyBySymbol(ethAsset.symbol)) return
                appWorker.postMessageWrapped({ msg: 'REFRESH_ASSET_FULL', data: { asset: ethAsset, wallet } })
            })
            //utilsWallet.log('REFRESH_ASSET_FULL done')

            // then fetch all others, except erc20s
            var erc20Assets = wallet.assets.filter(p => 
                utilsWallet.isERC20(p)
                && configWallet.getSupportedMetaKeyBySymbol(p.symbol) !== undefined
            )
            var otherAssets = wallet.assets.filter(p => 
                p.symbol !== 'ETH' && p.symbol !== 'ETH_TEST'
                && !utilsWallet.isERC20(p)
                && configWallet.getSupportedMetaKeyBySymbol(p.symbol) !== undefined
            )
            appWorker.postMessageWrapped({ msg: 'REFRESH_MULTI_ASSET_FULL', data: { assets: otherAssets, wallet } })
            //utilsWallet.log('REFRESH_MULTI_ASSET_FULL done')

            // wait for eth[_test] fetch to finish 
            const eth_intId = setInterval(() => {
                storeState = store.getState()
                //utilsWallet.log('eth_intId setInterval..., storeState=', storeState)

                if (storeState && storeState.wallet && storeState.wallet.assets) {
                    var ethDone = false, ethTestDone = false
                    
                    // Guard ETH mainnet check with WALLET_INCLUDE_ETH_MAINNET flag
                    if (configWallet.WALLET_INCLUDE_ETH_MAINNET) {
                        const ethAsset = storeState.wallet.assets.find(p => p.symbol === 'ETH')
                        ethDone = ethAsset ? ethAsset.lastAssetUpdateAt !== undefined : true
                        if (!ethDone) {
                            utilsWallet.warn(`Wallet - pollAllAddressBalances: waiting for ETH to finish...`)
                        }
                        if (ethAsset) utilsWallet.log('poll: ethAsset.lastAssetUpdateAt', ethAsset.lastAssetUpdateAt)
                    } else {
                        ethDone = true // Skip if ETH mainnet not enabled
                    }

                    // Guard ETH testnet check with WALLET_INCLUDE_ETH_TEST flag
                    if (configWallet.WALLET_INCLUDE_ETH_TEST) {
                        const ethTestAsset = storeState.wallet.assets.find(p => p.symbol === 'ETH_TEST')
                        ethTestDone = ethTestAsset === undefined || ethTestAsset.lastAssetUpdateAt !== undefined
                        if (!ethTestDone) {
                            utilsWallet.warn(`Wallet - pollAllAddressBalances: waiting for ETH_TEST to finish...`)
                        }
                        if (ethTestAsset) utilsWallet.log('poll: ethTestAsset.lastAssetUpdateAt', ethTestAsset.lastAssetUpdateAt)
                    } else {
                        ethTestDone = true // Skip if ETH testnet not enabled
                    }

                    // now fetch erc20s - they will use cached eth[_test] tx's
                    if (ethDone && ethTestDone) {
                        erc20Assets = wallet.assets.filter(p => utilsWallet.isERC20(p))
                        appWorker.postMessageWrapped({ msg: 'REFRESH_MULTI_ASSET_FULL', data: { assets: erc20Assets, wallet } })
                        clearInterval(eth_intId)

                        // now wait for all erc20 - and all other types - to finish
                        const allRemaining_intId = setInterval(async () => {
                            storeState = store.getState()
                            if (storeState && storeState.wallet && storeState.wallet.assets) {

                                erc20Assets = storeState.wallet.assets.filter(p => utilsWallet.isERC20(p))
                                otherAssets = storeState.wallet.assets.filter(p => (p.symbol !== 'ETH' && p.symbol !== 'ETH_TEST') && !utilsWallet.isERC20(p))
                                if (!erc20Assets.some(p => p.lastAssetUpdateAt === undefined)
                                && !otherAssets.some(p => p.lastAssetUpdateAt === undefined)) {

                                    // done
                                    clearInterval(allRemaining_intId)
                                    utilsWallet.logMajor('green','white', `loadAllAssets - complete`, null, { logServerConsole: true })
                                    console.timeEnd('loadAllAssets')

                                    // all assets fully loaded - now scan for non-standard outputs (and add any associated dynamic addresses)
                                    utilsWallet.log(`Load complete - will scan for non-std outputs...`)
                                    appWorker.postMessageWrapped({ msg: 'SCAN_NON_STANDARD_ADDRESSES', data: { asset: otherAssets.find(p => p.OP_CLTV) }})

                                    resolve()
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

    generateNewStandardAddress: (p) => { return walletShared.generateNewStandardAddress(p) },
    deleteUnusedStandardAddress: (p) => { return walletShared.deleteUnusedStandardAddress(p) },

    importPrivKeys: (p) => { return walletShared.importPrivKeys(p) },
    removeImportedAccounts: (p) => { return walletShared.removeImportedAccounts(p) },

    //
    // generates a new scoop wallet, for all supported assets
    //
    // supplied e_storedAssetsRaw can originate from Data Storage Contract (DSC) (server and browser) or
    // from raw file store (server only);
    // 
    // if supplied, DSC data is decrypted, and any newly added asset types are merged with the DSC data to
    // preserve any previosuly imported accounts or added addresses
    //
    //  browser: merged data is re-encrypted and written back to the DSC
    //   server: merged data is persisted in-memory to redux store
    //
    generateWallets: async (p) => {
        const { store, userAccountName, e_storedAssetsRaw, eosActiveWallet, callbackProcessed, loadNonCoreAssets,
                apk, e_email, h_mpk, email } = p
        if (!store) { throw 'Invalid store' }
        if (!h_mpk) { throw 'Invalid h_mpk' }

        // decrypt existing raw assets, if supplied (either from server in client mode, or from file in server mode)
        var pt_storedRawAssets
        var currentAssets
        if (e_storedAssetsRaw !== undefined && e_storedAssetsRaw !== null && e_storedAssetsRaw !== '') {
            pt_storedRawAssets = utilsWallet.aesDecryption(apk, h_mpk, e_storedAssetsRaw)
            if (!pt_storedRawAssets || pt_storedRawAssets.length === 0) {
                return null // decrypt failed
            }
            currentAssets = JSON.parse(pt_storedRawAssets)
            
            utilsWallet.logMajor('green','white', 'GENERATING (GOT SERVER ASSETS)...')
        } else {
            utilsWallet.logMajor('green','white', 'GENERATING (NEW)...')
            currentAssets = {} // generate new
        }

        // determine what wallets to generate, if any
        var supportWalletTypes = await configWallet.getSupportedWalletTypes() // StMaster: dynamically adds StMaster erc20 types
        const currentTypes = Object.keys(currentAssets)
        var needToGenerate = configWallet.WALLET_REGEN_EVERYTIME
            ? supportWalletTypes
            : supportWalletTypes.filter(assetType => !currentTypes.includes(assetType))

        // TEMP/TEST/WIP - conditional load of test assets, by email type
        // if (email !== undefined) {
        //     // remove test assets, unless logged into appropriate account
        //     if (!email.includes("aircarbon.co")) { 
        //         console.warn('temp/dbg - skipping aircarbon(t) for non AC email account')
        //         needToGenerate = needToGenerate.filter(p => p !== 'aircarbon(t)')
        //     }
        //     if (!email.includes("singdax.co")) { 
        //         console.warn('temp/dbg - skipping singdax(t) for non SD email account')
        //         needToGenerate = needToGenerate.filter(p => p !== 'singdax(t)')
        //     }
        //     if (!email.includes("ayondo.com")) { 
        //         console.warn('temp/dbg - skipping ayondo(t) for non AY email account')
        //         needToGenerate = needToGenerate.filter(p => p !== 'ayondo(t)')
        //     }
        //     if (email !== 'testnets2@scoop.tech') { // remove eth_test unless a test asset is present (excluding testnets account)
        //         if (!needToGenerate.some(p => p === 'aircarbon(t)' || p === 'singdax(t)' || p === 'ayondo(t)')) {
        //             needToGenerate = needToGenerate.filter(p => p !== 'eth(t)')
        //         }
        //     }
        // }

        // remove non-core assets, if specified
        const ONLY_CORE = loadNonCoreAssets == true ? false : true
        if (ONLY_CORE) {
            needToGenerate = needToGenerate.filter(p => { 
                return configWallet.walletsMeta[p].core_asset == true
            })
        }

        // (re)generate wallets
        // (all, if set by option, else only those assets not present in the server data, i.e. if a new account, or if we've added newly supported types)
        if (needToGenerate.length > 0) {

            utilsWallet.logMajor('green','white', `GENERATING ${needToGenerate.length} ASSET TYPE(s)...`, null, { logServerConsole: true })
            
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
            }

            // de-dupe & sort by path
            //  (shouldn't be strictly necessary, but no harm - had seen duplicates persisted here; due to bugs around add/delete addr's, since fixed)
            Object.keys(currentAssets).forEach(function(assetName) {
                const asset = currentAssets[assetName]
                for (var i=0; i < asset.accounts.length ; i++) {
                    asset.accounts[i].privKeys = _.uniqBy(asset.accounts[i].privKeys, 'privKey')
                    asset.accounts[i].privKeys = _.sortBy(asset.accounts[i].privKeys, 'path')
                }
            })

            // generate the rest
            needToGenerate.forEach(genType => generateWalletAccount({ assets: currentAssets, genType, h_mpk, eosActiveWallet }))

            // create top-level addresses - w/ cpuWorkers
            // perf -- a flattened list of ops across all assets/accounts/keys
            // thottled-promise pattern, dispatch op to 1 of n cpuWorkers
            var opParams = []
            var reqId = 0
            Object.keys(currentAssets).forEach(function(assetName) {
                const asset = currentAssets[assetName]
                if (configWallet.WALLET_REGEN_EVERYTIME || asset.addresses == undefined) {
                    asset.addresses = [] // initialize asset addresses[]
                    for (var i=0; i < asset.accounts.length ; i++) {
                        const accountNdx = i
                        const accountOpParams = 
                            asset.accounts[i].privKeys.map(key => ({
                                    reqId: `${reqId++}`,
                                   params: {
                                        symbol: configWallet.walletsMeta[assetName].symbol,
                                     assetName: assetName, 
                                   accountName: asset.accounts[accountNdx].name,
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
            utilsWallet.logMajor('green', 'white', `FINISHED GENERATING ASSETS`, null, { logServerConsole: true })

            //
            // encrypt & postback raw asset data to server - potentially with newly added assets
            // 
            if (userAccountName && configWallet.WALLET_ENV === "BROWSER") { // persist raw encrypted to eos server - pruned raw assets (without addresss data)
                apiDataContract.updateAssetsJsonApi({ 
                          owner: userAccountName, 
         encryptedAssetsJSONRaw: walletShared.encryptPrunedAssets(currentAssets, apk, h_mpk), 
                        e_email: e_email,
               showNotification: false
                })
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
            const e_rawAssetsUpdated = utilsWallet.aesEncryption(apk, h_mpk, rawAssetsJsonUpdated)
            store.dispatch({ type: actionsWallet.WCORE_SET_ASSETS_RAW, payload: e_rawAssetsUpdated })
            rawAssetsJsonUpdated = null

        } else {
            utilsWallet.logMajor('green', 'white', `FINISHED LOAD & X-REF CHECK FOR ASSET TYPES...`)
            store.dispatch({ type: actionsWallet.WCORE_SET_ASSETS_RAW, payload: e_storedAssetsRaw }) // persist encrypted local - no changes
        }

        //
        // store local state: viewable asset data, e.g. last known balances: subset of currentAssets, persisted to browser storage, without privkeys
        //
        const displayableAssets = await displayableWalletAssets(currentAssets, userAccountName)
        store.dispatch((action) => {
            action({ type: actionsWallet.WCORE_SET_ASSETS, payload: { assets: displayableAssets, owner: userAccountName } })
        })

        utilsWallet.softNuke(currentAssets)
        return displayableAssets
    },

    //
    // get default/"generic" fees
    // should be deprecated/removed completely in favour of wallet-external.computeTxFee() [specific tx fee compute]
    //
    getAssetFeeData: (asset) => {
        //utilsWallet.log(`fees - getAssetFeeData`, asset)
        switch (asset.type) {

            case configWallet.WALLET_TYPE_UTXO:
                return walletUtxo.estimateFees_Utxo(asset.symbol)
                .then(res => {
                    utilsWallet.log(`fees - (UTXO) getAssetFeeData - ${asset.symbol}, res=`, res)
                    return res
                })
                .catch(err => {
                    utilsWallet.error(`### fees - getAssetFeeData ${asset.symbol} FAIL - err=`, err)
                })

            case configWallet.WALLET_TYPE_ACCOUNT:
                const estimateGasParams = {
                    from: asset.addresses[0].addr,
                      to: configExternal.walletExternal_config[asset.symbol].donate,
                   value: 1.0
                }

                return new Promise((resolve, reject) => {
                    const appWorker = utilsWallet.getAppWorker()
                    const listener = function(event) {
                        const input = utilsWallet.unpackWorkerResponse(event)
                        if (input) {
                            const msg = input.msg
                            if (msg === 'GET_ETH_TX_FEE_WEB3_DONE') {
                                const assetSymbol = input.data.assetSymbol
                                const fees = input.data.fees
                                if (assetSymbol === asset.symbol) {
                                    resolve(fees)
                                    appWorker.removeEventListener('message', listener)
                                    utilsWallet.log(`fees - (ACCOUNT) getAssetFeeData - ${asset.symbol}, fees=`, fees)
                                }
                            } 
                        }
                    }
                    appWorker.addEventListener('message', listener)
                    appWorker.postMessageWrapped({ msg: 'GET_ETH_TX_FEE_WEB3', data: { asset, params: estimateGasParams } })
                })

            default: utilsWallet.error(`fees - unsupported asset type ${asset.type}`)
        }
    },

    //
    // Get bitcoin-js / bitgo-utxo-lib network object for supplied
    //
    getUtxoNetwork: (symbol) => { return walletShared.getUtxoNetwork(symbol) },

    //
    // PrivKey -> Address (all types)
    //
    getAddressFromPrivateKey: (p) => { return walletShared.getAddressFromPrivateKey(p) },

    //
    // for safe mapping to displayable wallet assets - keyed by path on underlying encrypted privKey
    //
    newWalletAddressFromPrivKey: (p) => { return walletShared.newWalletAddressFromPrivKey(p) },

    //
    // address validation
    //
    validateAssetAddress: (p) => { return walletValidate.validateAssetAddress(p) }
}

//
// wallet generation
// https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki
//
function generateWalletAccount(p) {
    const { assets, genType, h_mpk, eosActiveWallet } = p
    
    var asset = assets[genType]
    if (asset !== undefined) {
        utilsWallet.log(`generateWalletAccount - genType=${genType} EXISTING asset.accounts[0].privKeys.length=${assets[genType].accounts[0].privKeys.length}`, null, { logServerConsole: true })
    }
    else {
        utilsWallet.log(`generateWalletAccount - genType=${genType} NEW DEFAULT ASSET`, null, { logServerConsole: true })
    }

    var defaultPrivKeys

    switch (genType) {
        case 'btc(t)':   defaultPrivKeys = walletShared.generateUtxoBip44Wifs({ entropySeed: h_mpk, symbol: 'BTC_TEST' }); break; 
        case 'btc(ts2)': defaultPrivKeys = walletShared.generateUtxoBip44Wifs({ entropySeed: h_mpk, symbol: 'BTC_TEST2' }); break; 

        case 'bitcoin':  defaultPrivKeys = walletShared.generateUtxoBip44Wifs({ entropySeed: h_mpk, symbol: 'BTC' }); break; 
        case 'btc(s)':   defaultPrivKeys = walletShared.generateUtxoBip44Wifs({ entropySeed: h_mpk, symbol: 'BTC_SEG' }); break; 
        case 'btc(s2)':  defaultPrivKeys = walletShared.generateUtxoBip44Wifs({ entropySeed: h_mpk, symbol: 'BTC_SEG2' }); break; 
        case 'litecoin': defaultPrivKeys = walletShared.generateUtxoBip44Wifs({ entropySeed: h_mpk, symbol: 'LTC' }); break; 
        case 'zcash':    defaultPrivKeys = walletShared.generateUtxoBip44Wifs({ entropySeed: h_mpk, symbol: 'ZEC' }); break; 
        case 'dash':     defaultPrivKeys = walletShared.generateUtxoBip44Wifs({ entropySeed: h_mpk, symbol: 'DASH' }); break; 
        case 'vertcoin': defaultPrivKeys = walletShared.generateUtxoBip44Wifs({ entropySeed: h_mpk, symbol: 'VTC' }); break;
        case 'qtum':     defaultPrivKeys = walletShared.generateUtxoBip44Wifs({ entropySeed: h_mpk, symbol: 'QTUM' }); break;
        case 'digibyte': defaultPrivKeys = walletShared.generateUtxoBip44Wifs({ entropySeed: h_mpk, symbol: 'DGB' }); break;
        case 'bchabc':   defaultPrivKeys = walletShared.generateUtxoBip44Wifs({ entropySeed: h_mpk, symbol: 'BCHABC' }); break;

        case 'raven':    defaultPrivKeys = walletShared.generateUtxoBip44Wifs({ entropySeed: h_mpk, symbol: 'RVN' }); break;

        case 'ethereum': defaultPrivKeys = walletShared.generateEthereumWallet({ entropySeed: h_mpk, addrNdx: 0, genCount: configWallet.WALLET_DEFAULT_ADDRESSES }); break

        case 'ltc(t)':   defaultPrivKeys = walletShared.generateUtxoBip44Wifs({ entropySeed: h_mpk, symbol: 'LTC_TEST' }); break; 
        case 'zcash(t)': defaultPrivKeys = walletShared.generateUtxoBip44Wifs({ entropySeed: h_mpk, symbol: 'ZEC_TEST' }); break; 

        case 'eos':
            //utilsWallet.log(`eos=`, eosActiveWallet)
            if (eosActiveWallet) {
                const meta = configWallet.getMetaBySymbol('EOS')
                defaultPrivKeys = [{ privKey: eosActiveWallet.wif, path: `m/44'/${meta.bip44_index}'/0'/0/0` }];
            }
            break

        default:
            // erc20's and eth_test
            const meta = configWallet.walletsMeta[genType];
            if (meta == undefined) {
                utilsWallet.error('## missing meta for ' + genType, configWallet.walletsMeta)
            }
            else {
                if (meta.addressType === configWallet.ADDRESS_TYPE_ETH) {
                    // Guard: ETH-based assets (eth_test, erc20s) require ethereum mainnet to be enabled
                    if (configWallet.WALLET_INCLUDE_ETH_MAINNET && assets['ethereum'] && assets['ethereum'].accounts) {
                        defaultPrivKeys = assets['ethereum'].accounts[0].privKeys.slice()
                    } else {
                        // ETH mainnet not enabled - skip this ETH-based asset
                        utilsWallet.log(`Skipping ${genType} - requires ETH mainnet (WALLET_INCLUDE_ETH_MAINNET=false)`)
                        return false // Signal to skip this asset
                    }
                }
            }
            break
    }

    if (defaultPrivKeys !== undefined) { // save only the wifs/privkeys
        const accountName = `${configWallet.walletsMeta[genType].displaySymbol}` //`${configWallet.walletsMeta[genType].displayName}`

        if (asset === undefined) {
            // no existing server data: first-time creation
            asset = { accounts: [] }    
            asset.accounts.push({ // new default asset account
                name: accountName,
            privKeys: []
            })
            asset.accounts[0].privKeys = defaultPrivKeys.slice() // new asset default address indexes
            assets[genType] = asset
        } else {
            // we are "merging" (actually, replacing/overwriting) existing server data in the default account's default address indexes;
            // this isn't strictly necessary, as the server already has recorded and sent us the default indexes, but in the interests
            // of being strictly deterministic:
            for (var ndx=0 ; ndx < defaultPrivKeys.length ; ndx++) {
                asset.accounts[0].privKeys[ndx] = defaultPrivKeys[ndx]
            }
            // note: we leave any other server-populated address indexes alone, so any user-activated (non-default) addresses persist across logins

            // we reset the account name received from the server, too:
            asset.accounts[0].name = accountName
        }
        return true
    }
    return false
}

// creates wallet.assets[] safe/displayable core wallet data
async function displayableWalletAssets(assets) {
    var displayableAssets = []
    if (assets) {
        for (const key in assets) {
            const supportedTypes = await configWallet.getSupportedWalletTypes()
            if (!supportedTypes.includes(key)) continue
            if (assets[key]) {
                var displayableAsset = Object.assign(
                    { addresses: assets[key].addresses,
                      local_txs: [], },
                    configWallet.walletsMeta[key])

                displayableAssets.push(displayableAsset)
            }
        }
    }
    return displayableAssets
}
