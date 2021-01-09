// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2021 Dominic Morris.

const Buffer = require('buffer').Buffer
const _ = require('lodash')
const bitgoUtxoLib = require('bitgo-utxo-lib')
const bitcoinJsLib = require('bitcoinjs-lib')
const ethereumJsUtil = require('ethereumjs-util')
const bchAddr = require('bchaddrjs')

const actionsWallet = require('.')
const walletValidate = require('./wallet-validation')

const configWallet = require('../config/wallet')

const utilsWallet = require('../utils')

module.exports = { 
    //
    // adds (does not persist) a single dynamic (non-standard derivation) address into the singleton "non-standard" account (no HD deriv. path)
    // specifically, adds a P2SH(P2WPSH(DSIG/CLTV))-derived address
    //
    addNonStdAddress_DsigCltv: async (p) => {
        var { store, apk, h_mpk, assetName, dsigCltvP2shAddr, // required - browser & server
              userAccountName, e_email,                       // required - browser 
              eosActiveWallet } = p

        // validation
        if (!store) throw 'store is required'
        if (!apk) throw 'apk is required'
        if (!assetName) throw 'assetName is required'
        if (!h_mpk) throw 'h_mpk is required'        
        if (!dsigCltvP2shAddr) throw 'dsigCltvP2shAddr required'
        if (configWallet.WALLET_ENV === "BROWSER") {
            if (!userAccountName) throw 'userAccountName is required'
            if (!e_email) throw 'e_email is required'
        }

        const storeState = store.getState()
        if (!storeState || !storeState.wallet || !storeState.wallet.assets || !storeState.wallet.assetsRaw) throw 'Invalid store state'
        const wallet = storeState.wallet
        const e_rawAssets = storeState.wallet.assetsRaw
        const displayableAssets = wallet.assets

        utilsWallet.logMajor('green','white', `addNonStdAddress_DsigCltv...`, null, { logServerConsole: true })

        // decrypt raw assets
        var pt_rawAssets = utilsWallet.aesDecryption(apk, h_mpk, e_rawAssets)
        var rawAssets = JSON.parse(pt_rawAssets)
        var genAsset = rawAssets[assetName.toLowerCase()]
        try {
            // get asset 
            if (genAsset === undefined || !genAsset.accounts || genAsset.accounts.length == 0) throw 'Invalid assetName'
            const meta = configWallet.walletsMeta[assetName.toLowerCase()]
            const genSymbol = meta.symbol

            if (!walletValidate.validateAssetAddress({ testSymbol: genSymbol, testAddressType: meta.addressType, validateAddr: dsigCltvP2shAddr })) throw 'invalid dsigCltvP2shAddr'

            // check not already added
            if (displayableAssets.find(p => p.symbol === genSymbol).addresses.some(p => p.addr === dsigCltvP2shAddr)) {
                utilsWallet.warn(`Supplied address already added`, null, { logServerConsole: true })
                return { addedCount: 0 }
            }
            //console.log('displayableAsset', displayableAssets.find(p => p.symbol === genSymbol))

            // make HD account for non-standard addresses, if not already existing
            var nonStdAccount = genAsset.accounts.find(p => p.nonStd)
            if (!nonStdAccount) {
                nonStdAccount = { // new non-std account
                    nonStd: true,
                      name: `Protected ${meta.displayName}`,
                  privKeys: [] // we sign dsigCltv addresses with keys of the csvSpender ("beneficiary"), or of the nonCsvSpender ("benefactor")
                }
                genAsset.accounts.push(nonStdAccount)
            }

        //     // map raw suplied priv keys to our internal format; note -- there is no "real" HD path for imported keys (they're not derived keys)
        //     // we use custom path prefix 'i' for imported to denote this
        //     const privKeys = []
        //     for (var i=0 ; i < addrKeyPairs.length ; i++) {
        //         const privKey = addrKeyPairs[i].privKey
        //         var chainNdx = 0 // bip44: 0=external chain, 1=internal chain (change addresses)
        //         privKeys.push({ privKey, path: `i/44'/${meta.bip44_index}'/${accountNdx}'/${chainNdx}/${i}` })
        //     }
        //     // add new priv keys
        //     privKeys.forEach(privKey => {
        //         importAccount.privKeys.push(privKey)
        //     })

            // update local persisted raw assets
            var rawAssetsJsonUpdated = JSON.stringify(rawAssets, null, 4)
            const e_rawAssetsUpdated = utilsWallet.aesEncryption(apk, h_mpk, rawAssetsJsonUpdated)
            store.dispatch({ type: actionsWallet.WCORE_SET_ASSETS_RAW, payload: e_rawAssetsUpdated })
            rawAssetsJsonUpdated = null

            // add to displayable asset addresses - this fails inside .then() below; no idea why
            const newDisplayableAssets = _.cloneDeep(displayableAssets)
            const newDisplayableAsset = newDisplayableAssets.find(p => { return p.symbol === genSymbol })
            const newDisplayableAddr = module.exports.newWalletAddressFromPrivKey( {
                    assetName: assetName.toLowerCase(),
                  accountName: nonStdAccount.name,
                accountNonStd: nonStdAccount.nonStd,
                          key: { path: `N/A` }, // no HD for these non-std (dynamic) addresses (their presence/addition depends on specific scanned TX's)
              eosActiveWallet: eosActiveWallet,
                    knownAddr: dsigCltvP2shAddr,
                       symbol: newDisplayableAsset.symbol
            })
            newDisplayableAsset.addresses.push(newDisplayableAddr)
            store.dispatch({ type: actionsWallet.WCORE_SET_ASSETS, payload: { assets: newDisplayableAssets, owner: userAccountName } })
            
        //     if (userAccountName && configWallet.WALLET_ENV === "BROWSER") {
        //         // raw assets: post encrypted
        //         await apiDataContract.updateAssetsJsonApi({  
        //                     owner: userAccountName, 
        //    encryptedAssetsJSONRaw: module.exports.encryptPrunedAssets(rawAssets, apk, h_mpk), 
        //                   e_email: e_email,
        //          showNotification: true
        //         })
        //     }

            // update addr monitors & refresh balance
            utilsWallet.getAppWorker().postMessageWrapped({ msg: 'DISCONNECT_ADDRESS_MONITORS', data: { wallet } })
            utilsWallet.getAppWorker().postMessageWrapped({ msg: 'CONNECT_ADDRESS_MONITORS', data: { wallet } })
            utilsWallet.getAppWorker().postMessageWrapped({ msg: 'REFRESH_ASSET_BALANCE', data: { asset: newDisplayableAsset, wallet } })
            
            // ret ok
            utilsWallet.logMajor('green','white', `addNonStdAddress_DsigCltv - complete`, dsigCltvP2shAddr, { logServerConsole: true })
            return { addedCount: 1, accountName: nonStdAccount.name }
        }
        finally {
            utilsWallet.softNuke(rawAssets)
            utilsWallet.softNuke(genAsset)
            pt_rawAssets = null
        }
    },
    
    newWalletAddressFromPrivKey: (p) => {
        const { assetName, accountName, key, eosActiveWallet, knownAddr, symbol, accountNonStd } = p
        
        //console.log(`newWalletAddressFromPrivKey, symbol=${symbol}, assetName=${assetName} configWallet.walletsMeta=`, configWallet.walletsMeta)
    
        var addr = !knownAddr ? module.exports.getAddressFromPrivateKey(
                        { assetMeta: configWallet.walletsMeta[assetName], privKey: key.privKey, eosActiveWallet }
                    )
                  : knownAddr // perf (bulk import) - don't recompute the key if it's already been done
    
        return {
            symbol,
            addr, 
            accountName, 
            accountNonStd, // DMS: identifies a non-std addr
            path: key.path, // see config/wallet -- we don't have completely unique HD paths (e.g. BTC/SW, and testnets), but seems not to matter too much (?)
            txs: [],
            utxos: [],
            lastAddrFetchAt: undefined,
        }
    },

    getAddressFromPrivateKey: (p) => {
        const { assetMeta, privKey, eosActiveWallet } = p

        if (assetMeta.type === configWallet.WALLET_TYPE_UTXO) {
            return module.exports.getUtxoTypeAddressFromWif(privKey, assetMeta.symbol)
        }

        else if (assetMeta.type === configWallet.WALLET_TYPE_ACCOUNT) {
            return module.exports.getAccountTypeAddress(privKey, assetMeta.symbol, eosActiveWallet)
        }

        else utilsWallet.warn('### Wallet type ' + assetMeta.type + ' not supported!')
    },

    getUtxoTypeAddressFromWif: (wif, symbol) => {
        try {
            const network = module.exports.getUtxoNetwork(symbol) // bitgo networks: supports ZEC UInt16 pubKeyHash || scriptHash

            const keyPair = bitgoUtxoLib.ECPair.fromWIF(wif, network) // bitgo ECPair, below: .getPublicKeyBuffer() instead of .publicKey in bitcoin-js

            if (symbol === "BTC" || symbol === "LTC" /*|| symbol === "BTC_TEST"*/ || symbol === "LTC_TEST") {
                // bitcoinjs-lib

                // legacy addr
                const { address } = bitcoinJsLib.payments.p2pkh({ pubkey: keyPair.getPublicKeyBuffer(), network }) // bitcoin-js payments (works with bitgo networks)
                return address
            }
            else if (symbol === "BTC_SEG" || symbol === "BTC_TEST") { // P2SH-WRAPPED SEGWIT -- P2SH(P2WPKH) addr -- w/ bitcoinjsLib (3 addr)
                // bitcoinjs-lib

                // native segwit - BlockCypher throws errors on address_balance -- generated bc1 addr isn't viewable on any block explorers!
                //const { address } = bitcoinJsLib.payments.p2wpkh({ pubkey: keyPair.publicKey, network })
                //return address

                // p2sh-wrapped segwit -- need to generate tx json entirely, blockcypher doesn't support
                // const { address } = bitcoinJsLib.payments.p2sh({ redeem: payments.p2wpkh({ pubkey: keyPair.publicKey, network }) })
                // return address

                const { address } = bitcoinJsLib.payments.p2sh({ 
                    redeem: bitcoinJsLib.payments.p2wpkh({ pubkey: keyPair.getPublicKeyBuffer(), 
                                                        network }), 
                    network
                })
                return address
            }
            else if (symbol === "BTC_SEG2") { // unwrapped P2WPKH -- w/ bitgoUtxoLib -- NATIVE/UNWRAPPED SEGWIT (b addr) - Bech32
                var pubKey = keyPair.getPublicKeyBuffer()
                var scriptPubKey = bitgoUtxoLib.script.witnessPubKeyHash.output.encode(bitgoUtxoLib.crypto.hash160(pubKey))
                var address = bitgoUtxoLib.address.fromOutputScript(scriptPubKey)
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
            utilsWallet.error(`getUtxoTypeAddressFromWif - FAIL: ${err.message}`, err)
            return null
        }
    },

    getAccountTypeAddress: (privKey, symbol, eosActiveWallet) => {
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
            utilsWallet.error(`getAccountTypeAddress - FAIL: ${err.message}`, err)
            return null
        }
    },

    getUtxoNetwork: (symbol) => {
        // https://github.com/BitGo/bitgo-utxo-lib/blob/master/src/networks.js
        // https://www.npmjs.com/package/@upincome/coininfo
        // https://github.com/libbitcoin/libbitcoin-system/wiki/Altcoin-Version-Mappings
        // https://github.com/libbitcoin/libbitcoin-system/issues/319
    
        // https://github.com/bitcoinjs/bitcoinjs-lib/issues/1067
    
        const coininfo = require('coininfo')
        switch (symbol) { 
            case "BTC":      return bitgoUtxoLib.networks.bitcoin
            case "BTC_SEG":  return bitgoUtxoLib.networks.bitcoin
            case "BTC_SEG2": return bitgoUtxoLib.networks.bitcoin
            case "BTC_TEST": return bitgoUtxoLib.networks.testnet
    
            case "LTC":      return bitgoUtxoLib.networks.litecoin
            case "LTC_TEST": return coininfo('LTC-TEST').toBitcoinJS()
    
            case "ZEC":      return bitgoUtxoLib.networks.zcash
            case "ZEC_TEST": return bitgoUtxoLib.networks.zcashTest
    
            case "DASH":     return bitgoUtxoLib.networks.dash
            case "BCHABC":   return bitgoUtxoLib.networks.bitcoincash
            case "VTC":      return coininfo('VTC').toBitcoinJS()
            case "QTUM":     return coininfo('QTUM').toBitcoinJS()
            case "DGB":
                var ret = coininfo('DGB')
                ret.versions.bip32 = { public: 0x0488B21E, private: 0x0488ADE4 }
                var ret_js = ret.toBitcoinJS()
                return ret_js
    
            case "RVN":      return coininfo('RVN').toBitcoinJS()
    
            default:
                return undefined
        }
    }
}
