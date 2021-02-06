// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2021 Dominic Morris.

const Buffer = require('buffer').Buffer
const _ = require('lodash')
const bip32 = require('bip32')
const bitgoUtxoLib = require('bitgo-utxo-lib')
const bitcoinJsLib = require('bitcoinjs-lib')
const ethereumJsUtil = require('ethereumjs-util')
const bchAddr = require('bchaddrjs')

const apiDataContract = require('../api/data-contract')

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
        var { store, apk, h_mpk, assetName, dsigCltvP2sh_addr_txid, // required - browser & server
              userAccountName, e_email,                             // required - browser 
              eosActiveWallet } = p
        
        // validation
        if (!store) throw 'store is required'
        if (!apk) throw 'apk is required'
        if (!assetName) throw 'assetName is required'
        if (!h_mpk) throw 'h_mpk is required'        
        if (!dsigCltvP2sh_addr_txid || dsigCltvP2sh_addr_txid.length == 0) throw 'dsigCltvP2sh_addr_txid[] required' // { nonStdAddr, protect_op_txid }
        if (configWallet.WALLET_ENV === "BROWSER") {
            if (!userAccountName) throw 'userAccountName is required'
            if (!e_email) throw 'e_email is required'
        }

        const storeState = store.getState()
        if (!storeState || !storeState.wallet || !storeState.wallet.assets || !storeState.wallet.assetsRaw) throw 'Invalid store state'
        const wallet = storeState.wallet
        const e_rawAssets = storeState.wallet.assetsRaw
        const displayableAssets = wallet.assets
       
        utilsWallet.logMajor('green','white', `addNonStdAddress_DsigCltv... dsigCltvP2sh_addr_txid=`, dsigCltvP2sh_addr_txid, { logServerConsole: true })

        // decrypt raw assets
        var pt_rawAssets = utilsWallet.aesDecryption(apk, h_mpk, e_rawAssets)
        if (!pt_rawAssets) {
            console.warn(`addNonStdAddress_DsigCltv - failed decrypting e_rawAssets; probably using stale store/mpk combination from previous wallet load - aborting.`)
            return
        }
        var rawAssets = JSON.parse(pt_rawAssets)
        if (!rawAssets) throw 'null rawAssets'
        var genAsset = rawAssets[assetName.toLowerCase()]
        try {
            // get asset 
            if (genAsset === undefined || !genAsset.accounts || genAsset.accounts.length == 0) throw 'Invalid assetName'
            const meta = configWallet.walletsMeta[assetName.toLowerCase()]
            const genSymbol = meta.symbol
            var addedCount = 0

            dsigCltvP2sh_addr_txid.forEach(addr_txid => { 
                // validate
                if (!walletValidate.validateAssetAddress({ testSymbol: genSymbol, testAddressType: meta.addressType, validateAddr: addr_txid.nonStdAddr })) {
                    throw 'invalid nonStdAddr'
                }
            })

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
            var rawAssetsJsonUpdated = JSON.stringify(rawAssets, null, 4)
            const e_rawAssetsUpdated = utilsWallet.aesEncryption(apk, h_mpk, rawAssetsJsonUpdated)
            store.dispatch({ type: actionsWallet.WCORE_SET_ASSETS_RAW, payload: e_rawAssetsUpdated }) // update local persisted raw assets
            rawAssetsJsonUpdated = null

            // add to displayable asset addresses
            const newDisplayableAssets = _.cloneDeep(displayableAssets)
            dsigCltvP2sh_addr_txid.forEach(addr_txid => { 

                if (displayableAssets.find(p => p.symbol === genSymbol).addresses.some(p => p.addr === addr_txid.nonStdAddr) === false) {
                    var newDisplayableAsset = newDisplayableAssets.find(p => { return p.symbol === genSymbol })

                    // no true HD for these non-std (dynamic) addresses (their presence/addition depends on specific scanned TX's)
                    // but for deterministic sorting in the wallet, we allocate a pseudo-HD path ('p_' prefix, for "protected")
                    const chainNdx = 0 // bip44: 0=external chain, 1=internal chain (change addresses)
                    const accountNdx = 0 // only every one '_p' protection account
                    const i = newDisplayableAsset.addresses.filter(p => p.path.startsWith('~p')).length
                    const path = `~p/44'/${meta.bip44_index}'/${accountNdx}'/${chainNdx}/${i}`
         
                    const newDisplayableAddr = module.exports.newWalletAddressFromPrivKey( {
                            assetName: assetName.toLowerCase(),
                          accountName: nonStdAccount.name,
                         isNonStdAddr: nonStdAccount.nonStd,
                nonStd_protectOp_txid: addr_txid.protect_op_txid,
                                  key: { path },
                      eosActiveWallet: eosActiveWallet,
                            knownAddr: addr_txid.nonStdAddr,
                               symbol: newDisplayableAsset.symbol
                    })
                    newDisplayableAsset.addresses.push(newDisplayableAddr)
                    newDisplayableAsset.addresses = sortAddresses(newDisplayableAsset.addresses) //_.sortBy(newDisplayableAsset.addresses, ['path'])

                    addedCount++
                    utilsWallet.getAppWorker().postMessageWrapped({ msg: 'REFRESH_ASSET_BALANCE', data: { asset: newDisplayableAsset, wallet } })
                }
                else { 
                    utilsWallet.warn(`addNonStdAddress_DsigCltv - supplied address ${addr_txid.nonStdAddr} already added`, null, { logServerConsole: true })
                }
            })
            //console.log('newDisplayableAssets', newDisplayableAssets)
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
            
            // ret ok
            utilsWallet.logMajor('green','white', `addNonStdAddress_DsigCltv - complete`, addedCount, { logServerConsole: true })
            return { addedCount, accountName: nonStdAccount.name }
        }
        finally {
            utilsWallet.softNuke(rawAssets)
            utilsWallet.softNuke(genAsset)
            pt_rawAssets = null
        }
    },

    //
    // add new receive address (in the primary account)
    //
    generateNewStandardAddress: async (p) => {
        const { store, apk, h_mpk, assetName, // required - browser & server
                userAccountName, e_email,     // required - browser 
                eosActiveWallet } = p

        // validation
        if (!store) throw 'store is required'
        if (!apk) throw 'apk is required'
        if (!store) throw 'store is required'
        if (!assetName) throw 'assetName is required'
        if (!h_mpk) throw 'h_mpk is required'
        if (configWallet.WALLET_ENV === "BROWSER") {
            if (!userAccountName) throw 'userAccountName is required'
            if (!e_email) throw 'e_email is required'
        }

        const storeState = store.getState()
        if (!storeState || !storeState.wallet || !storeState.wallet.assets || !storeState.wallet.assetsRaw) throw 'Invalid store state'
        const wallet = storeState.wallet
        const e_rawAssets = storeState.wallet.assetsRaw
        const displayableAssets = wallet.assets

        utilsWallet.logMajor('green','white', `generateNewStandardAddress...`, null, { logServerConsole: true })

        // decrypt raw assets
        var pt_rawAssets = utilsWallet.aesDecryption(apk, h_mpk, e_rawAssets)
        var rawAssets = JSON.parse(pt_rawAssets)
        var genAsset = rawAssets[assetName.toLowerCase()]
        try {
            // get asset and account to generate into
            if (genAsset === undefined || !genAsset.accounts || genAsset.accounts.length == 0) throw 'Invalid assetName'
            const meta = configWallet.walletsMeta[assetName.toLowerCase()]
            const genSymbol = meta.symbol
            const genAccount = genAsset.accounts[0] // default (Scoop) account

            // generate new address
            var newPrivKey
            switch (meta.type) {
                case configWallet.WALLET_TYPE_UTXO:
                    newPrivKey = module.exports.generateUtxoBip44Wifs({
                        entropySeed: h_mpk, 
                             symbol: genSymbol,
                            addrNdx: genAccount.privKeys.length,
                           genCount: 1 })[0]
                    break
                
                case configWallet.WALLET_TYPE_ACCOUNT: 
                    if (genSymbol === 'EOS') { ; } //nop
                    else if (meta.addressType === configWallet.ADDRESS_TYPE_ETH) { // including erc20
                        newPrivKey = module.exports.generateEthereumWallet({
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
                const e_rawAssetsUpdated = utilsWallet.aesEncryption(apk, h_mpk, rawAssetsJsonUpdated)
                store.dispatch({ type: actionsWallet.WCORE_SET_ASSETS_RAW, payload: e_rawAssetsUpdated })
                rawAssetsJsonUpdated = null

                // post to server
                if (userAccountName && configWallet.WALLET_ENV === "BROWSER") {
                    await apiDataContract.updateAssetsJsonApi({ 
                             owner: userAccountName, 
            encryptedAssetsJSONRaw: module.exports.encryptPrunedAssets(rawAssets, apk, h_mpk), 
                           e_email: e_email,
                  showNotification: true })
                }

                // add new displayable asset address object
                const newDisplayableAssets = _.cloneDeep(displayableAssets)
                const newDisplayableAsset = newDisplayableAssets.find(p => { return p.symbol === genSymbol })

                const newDisplayableAddr = module.exports.newWalletAddressFromPrivKey( {
                          assetName: assetName.toLowerCase(),
                        accountName: genAccount.name,
                                key: newPrivKey,
                    eosActiveWallet: eosActiveWallet,
                          knownAddr: undefined,
                             symbol: newDisplayableAsset.symbol
                })

                newDisplayableAsset.addresses.push(newDisplayableAddr)
                newDisplayableAsset.addresses = sortAddresses(newDisplayableAsset.addresses) //_.sortBy(newDisplayableAsset.addresses, ['path'])
                
                store.dispatch({ type: actionsWallet.WCORE_SET_ASSETS, payload: { assets: newDisplayableAssets, owner: userAccountName } })

                if (configWallet.WALLET_ENV === "BROWSER") {
                    const globalScope = utilsWallet.getMainThreadGlobalScope()
                    const appWorker = globalScope.appWorker
                }

                // update addr monitors & refresh balance
                utilsWallet.getAppWorker().postMessageWrapped({ msg: 'DISCONNECT_ADDRESS_MONITORS', data: { wallet } })
                utilsWallet.getAppWorker().postMessageWrapped({ msg: 'CONNECT_ADDRESS_MONITORS', data: { wallet } })
                utilsWallet.getAppWorker().postMessageWrapped({ msg: 'REFRESH_ASSET_BALANCE', data: { asset: newDisplayableAsset, wallet } })
                
                // ret ok
                utilsWallet.logMajor('green','white', `generateNewStandardAddress - complete`, null, { logServerConsole: true })
                return { newAddr: newDisplayableAddr, newCount: genAccount.privKeys.length }

            }
            else { // ret fail
                return { err: 'Failed to generate private key', newAddr: undefined }
            }
        }
        finally {
            utilsWallet.softNuke(rawAssets)
            utilsWallet.softNuke(genAsset)
            pt_rawAssets = null
        }
    },
    deleteUnusedStandardAddresses: async (p) => {
        const { store, apk, h_mpk, assetName, // required - browser & server
                userAccountName, e_email,     // required - browser 
                eosActiveWallet } = p

        // validation
        if (!store) throw 'store is required'
        if (!apk) throw 'apk is required'
        if (!store) throw 'store is required'
        if (!assetName) throw 'assetName is required'
        if (!h_mpk) throw 'h_mpk is required'
        if (configWallet.WALLET_ENV === "BROWSER") {
            if (!userAccountName) throw 'userAccountName is required'
            if (!e_email) throw 'e_email is required'
        }

        const storeState = store.getState()
        if (!storeState || !storeState.wallet || !storeState.wallet.assets || !storeState.wallet.assetsRaw) throw 'Invalid store state'
        const wallet = storeState.wallet
        const e_rawAssets = storeState.wallet.assetsRaw
        const displayableAssets = wallet.assets

        utilsWallet.logMajor('green','white', `deleteUnusedStandardAddresses...`, null, { logServerConsole: true })
        
        // decrypt raw assets
        var pt_rawAssets = utilsWallet.aesDecryption(apk, h_mpk, e_rawAssets)
        var rawAssets = JSON.parse(pt_rawAssets)
        var genAsset = rawAssets[assetName.toLowerCase()]
        var genPrimaryAccount
        try {
            // get gen-asset
            if (genAsset === undefined || !genAsset.accounts || genAsset.accounts.length == 0) throw 'Invalid assetName'
            const meta = configWallet.walletsMeta[assetName.toLowerCase()]
            const genSymbol = meta.symbol

            // get store-asset; this has the TX & UTXO appended to it
            const storeAsset = displayableAssets.find(p => { return p.symbol === genSymbol })

            genPrimaryAccount = genAsset.accounts.find(p => !p.nonStd && !p.imported)
            const storePrimaryAddresses = storeAsset.addresses.filter(p => p.accountName == genPrimaryAccount.name)

            const storePruneAddresses = storePrimaryAddresses.filter(p => 
                p.lastAddrFetchAt !== undefined &&
                p.totalTxCount == 0 && p.txs.length == 0 && p.utxos.length == 0 &&
                p.balance == 0 && p.unconfirmedBalance == 0
            )
            utilsWallet.log(`deleteUnusedStandardAddresses - storePruneAddresses=`, storePruneAddresses)

            // raw assets: remove unused addresses, associated privKeys & update local persisted copy
            genPrimaryAccount.privKeys = genPrimaryAccount.privKeys.filter(p => storePruneAddresses.map(p2 => p2.path).includes(p.path) == false)
            genAsset.addresses = genAsset.addresses.filter(p => storePruneAddresses.map(p2 => p2.addr).includes(p.addr) == false)
            var rawAssetsJsonUpdated = JSON.stringify(rawAssets, null, 4)
            const e_rawAssetsUpdated = utilsWallet.aesEncryption(apk, h_mpk, rawAssetsJsonUpdated)
            store.dispatch({ type: actionsWallet.WCORE_SET_ASSETS_RAW, payload: e_rawAssetsUpdated })
            rawAssetsJsonUpdated = null

            // displayableAssets: remove specified unused addresses
            const newDisplayableAssets = _.cloneDeep(displayableAssets)
            const newDisplayableAsset = newDisplayableAssets.find(p => { return p.symbol === genSymbol })
            const countRemoved = newDisplayableAsset.addresses.filter(p => storePruneAddresses.map(p2 => p2.addr).includes(p.addr) == true).length
            newDisplayableAsset.addresses = newDisplayableAsset.addresses.filter(p => storePruneAddresses.map(p2 => p2.addr).includes(p.addr) == false)
            store.dispatch({ type: actionsWallet.WCORE_SET_ASSETS, payload: { assets: newDisplayableAssets, owner: userAccountName } })

            if (userAccountName && configWallet.WALLET_ENV === "BROWSER") {
                await apiDataContract.updateAssetsJsonApi({ // raw assets: post encrypted
                             owner: userAccountName, 
            encryptedAssetsJSONRaw: module.exports.encryptPrunedAssets(rawAssets, apk, h_mpk), 
                           e_email: e_email,
                  showNotification: true
                })
            }

            // update addr monitors & refresh balance
            utilsWallet.getAppWorker().postMessageWrapped({ msg: 'DISCONNECT_ADDRESS_MONITORS', data: { wallet } })
            utilsWallet.getAppWorker().postMessageWrapped({ msg: 'CONNECT_ADDRESS_MONITORS', data: { wallet } })
            utilsWallet.getAppWorker().postMessageWrapped({ msg: 'REFRESH_ASSET_BALANCE', data: { asset: newDisplayableAsset, wallet } })

            // ret ok
            utilsWallet.logMajor('green','white', `deleteUnusedStandardAddresses - complete, countRemoved=`, countRemoved, { logServerConsole: true })
            return { countRemoved }
        }
        finally {
            utilsWallet.softNuke(genPrimaryAccount)
            utilsWallet.softNuke(rawAssets)
            utilsWallet.softNuke(genAsset)
            pt_rawAssets = null
        }
    },

    //
    // imports (& persists) external privkeys into a new "import" account (non-std HD deriv path: "i/...")
    //  & remove imported accounts (all addresses in each import)
    //
    importPrivKeys: async (p) => { 
        var { store, apk, h_mpk, assetName, addrKeyPairs,  // required - browser & server
              userAccountName, e_email,                    // required - browser 
              eosActiveWallet } = p

      // validation
      if (!store) throw 'store is required'
      if (!apk) throw 'apk is required'
      if (!assetName) throw 'assetName is required'
      if (!h_mpk) throw 'h_mpk is required'        
      if (!addrKeyPairs || addrKeyPairs.length == 0) throw 'addrKeyPairs required'
      if (configWallet.WALLET_ENV === "BROWSER") {
          if (!userAccountName) throw 'userAccountName is required'
          if (!e_email) throw 'e_email is required'
      }

      const storeState = store.getState()
      if (!storeState || !storeState.wallet || !storeState.wallet.assets || !storeState.wallet.assetsRaw) throw 'Invalid store state'
      const wallet = storeState.wallet
      const e_rawAssets = storeState.wallet.assetsRaw
      const displayableAssets = wallet.assets

      utilsWallet.logMajor('green','white', `importPrivKeys...`, null, { logServerConsole: true })

      // decrypt raw assets
      var pt_rawAssets = utilsWallet.aesDecryption(apk, h_mpk, e_rawAssets)
      var rawAssets = JSON.parse(pt_rawAssets)
      var genAsset = rawAssets[assetName.toLowerCase()]
      try {
        // get asset 
        if (genAsset === undefined || !genAsset.accounts || genAsset.accounts.length == 0) throw 'Invalid assetName'
        const meta = configWallet.walletsMeta[assetName.toLowerCase()]
        const genSymbol = meta.symbol

        // remove already imported 
        var existingPrivKeys = []
        genAsset.accounts.forEach(account => {
            existingPrivKeys = existingPrivKeys.concat(account.privKeys)
        })
        addrKeyPairs = addrKeyPairs.filter(toImport => !existingPrivKeys.some(existing => existing.privKey === toImport.privKey))
        if (addrKeyPairs.length == 0) {
            utilsWallet.warn(`All supplied keys already imported`, null, { logServerConsole: true })
            return { importedAddrCount: 0  }
        }

        // make new HD account for import
        const existingImports = genAsset.importCount || 0 //genAsset.accounts.length - 1 // first account is default Scoop addresses
        const importAccount = { // new import account
            imported: true,
                name: `Import #${existingImports+1} ${meta.displayName}`,
            privKeys: []
        }
        genAsset.accounts.push(importAccount)
        const accountNdx = existingImports + 1 // imported accounts start at our HD index 1 (scoop default is 0)
        genAsset.importCount = accountNdx

        // map raw suplied priv keys to our internal format; note -- there is no "real" HD path for imported keys (they're not derived keys)
        // we use custom path prefix '~i' for imported to denote this
        const privKeys = []
        for (var i=0 ; i < addrKeyPairs.length ; i++) {
            const privKey = addrKeyPairs[i].privKey
            var chainNdx = 0 // bip44: 0=external chain, 1=internal chain (change addresses)
            privKeys.push({ privKey, path: `~i/44'/${meta.bip44_index}'/${accountNdx}'/${chainNdx}/${i}` })
        }

        // add new priv keys
        privKeys.forEach(privKey => {
            importAccount.privKeys.push(privKey)
        })

        // update local persisted raw assets
        var rawAssetsJsonUpdated = JSON.stringify(rawAssets, null, 4)
        const e_rawAssetsUpdated = utilsWallet.aesEncryption(apk, h_mpk, rawAssetsJsonUpdated)
        store.dispatch({ type: actionsWallet.WCORE_SET_ASSETS_RAW, payload: e_rawAssetsUpdated })
        rawAssetsJsonUpdated = null

        // add to displayable asset addresses - this fails inside .then() below; no idea why
        const newDisplayableAssets = _.cloneDeep(displayableAssets)
        const newDisplayableAsset = newDisplayableAssets.find(p => { return p.symbol === genSymbol })
        for (var i=0 ; i < addrKeyPairs.length ; i++) {
            const addr = addrKeyPairs[i].addr
            var newDisplayableAddr = module.exports.newWalletAddressFromPrivKey( {
                    assetName: assetName.toLowerCase(),
                  accountName: importAccount.name,
                          key: privKeys.find(p => p.privKey == addrKeyPairs[i].privKey),
              eosActiveWallet: eosActiveWallet,
                    knownAddr: addr,
                       symbol: newDisplayableAsset.symbol
            })
            if (newDisplayableAddr.addr === null) {
                return { err: "Invalid private key" }
            }
            newDisplayableAsset.addresses.push(newDisplayableAddr)
            newDisplayableAsset.addresses = sortAddresses(newDisplayableAsset.addresses) //_.sortBy(newDisplayableAsset.addresses, ['path'])
        }
        store.dispatch({ type: actionsWallet.WCORE_SET_ASSETS, payload: { assets: newDisplayableAssets, owner: userAccountName } })
        
        if (userAccountName && configWallet.WALLET_ENV === "BROWSER") {
            // raw assets: post encrypted
            await apiDataContract.updateAssetsJsonApi({  
                     owner: userAccountName, 
    encryptedAssetsJSONRaw: module.exports.encryptPrunedAssets(rawAssets, apk, h_mpk), 
                   e_email: e_email,
          showNotification: true
            })
        }

        // update addr monitors & refresh balance
        utilsWallet.getAppWorker().postMessageWrapped({ msg: 'DISCONNECT_ADDRESS_MONITORS', data: { wallet } })
        utilsWallet.getAppWorker().postMessageWrapped({ msg: 'CONNECT_ADDRESS_MONITORS', data: { wallet } })
        utilsWallet.getAppWorker().postMessageWrapped({ msg: 'REFRESH_ASSET_BALANCE', data: { asset: newDisplayableAsset, wallet } })
        
        // ret ok
        utilsWallet.logMajor('green','white', `importPrivKeys - complete`, addrKeyPairs.length, { logServerConsole: true })
        return { importedAddrCount: privKeys.length, accountName: importAccount.name }    
      }
      finally {
        utilsWallet.softNuke(rawAssets)
        utilsWallet.softNuke(genAsset)
        pt_rawAssets = null
      }
    },
    removeImportedAccounts: async (p) => {
        var { store, apk, h_mpk, assetName, removeAccounts,  // required - browser & server
              userAccountName, e_email,                      // required - browser 
              eosActiveWallet } = p

        // validation
        if (!store) throw 'store is required'
        if (!apk) throw 'apk is required'
        if (!assetName) throw 'assetName is required'
        if (!h_mpk) throw 'h_mpk is required'        
        if (!removeAccounts || removeAccounts.length == 0) throw 'removeAccounts required'
        if (configWallet.WALLET_ENV === "BROWSER") {
            if (!userAccountName) throw 'userAccountName is required'
            if (!e_email) throw 'e_email is required'
        }

        const storeState = store.getState()
        if (!storeState || !storeState.wallet || !storeState.wallet.assets || !storeState.wallet.assetsRaw) throw 'Invalid store state'
        const wallet = storeState.wallet
        const e_rawAssets = storeState.wallet.assetsRaw
        const displayableAssets = wallet.assets

        utilsWallet.logMajor('green','white', `removeImportedAccounts...`, removeAccounts, { logServerConsole: true })

        // decrypt raw assets
        var pt_rawAssets = utilsWallet.aesDecryption(apk, h_mpk, e_rawAssets)
        var rawAssets = JSON.parse(pt_rawAssets)
        var genAsset = rawAssets[assetName.toLowerCase()]
        try {
            // get asset 
            if (genAsset === undefined || !genAsset.accounts || genAsset.accounts.length == 0) throw 'Invalid assetName'
            const meta = configWallet.walletsMeta[assetName.toLowerCase()]
            const genSymbol = meta.symbol

            // remove internal scoop accounts - we only remove externally imported accounts
            const importedAccountNames = genAsset.accounts.filter(p => p.imported == true).map(p => p.name)
            removeAccounts = removeAccounts.filter(p => importedAccountNames.some(p2 => p2 === p))
            if (removeAccounts == 0) {
                utilsWallet.warn(`No import accounts to remove`, null, { logServerConsole: true })
                return { removedAddrCount: 0, removedAccountCount: 0  }
            }

            // raw assets: remove specified accounts & addresses
            const removedAccountCount = genAsset.accounts.filter(p => removeAccounts.some(p2 => p2 === p.name) === true).length
            genAsset.accounts = genAsset.accounts.filter(p => removeAccounts.some(p2 => p2 === p.name) === false)
            genAsset.addresses = genAsset.addresses.filter(p => removeAccounts.some(p2 => p2 === p.accountName) === false)

            // raw assets: update local persisted copy
            var rawAssetsJsonUpdated = JSON.stringify(rawAssets, null, 4)
            const e_rawAssetsUpdated = utilsWallet.aesEncryption(apk, h_mpk, rawAssetsJsonUpdated)
            store.dispatch({ type: actionsWallet.WCORE_SET_ASSETS_RAW, payload: e_rawAssetsUpdated })
            rawAssetsJsonUpdated = null

            // displayableAssets: remove specified accounts & addresses
            const newDisplayableAssets = _.cloneDeep(displayableAssets)
            const newDisplayableAsset = newDisplayableAssets.find(p => { return p.symbol === genSymbol })
            const removedAddrCount = newDisplayableAsset.addresses.filter(p => removeAccounts.some(p2 => p2 === p.accountName) === true).length
            newDisplayableAsset.addresses = newDisplayableAsset.addresses.filter(p => removeAccounts.some(p2 => p2 === p.accountName) === false)
            store.dispatch({ type: actionsWallet.WCORE_SET_ASSETS, payload: { assets: newDisplayableAssets, owner: userAccountName } })

            if (userAccountName && configWallet.WALLET_ENV === "BROWSER") {
                await apiDataContract.updateAssetsJsonApi({ // raw assets: post encrypted
                             owner: userAccountName, 
            encryptedAssetsJSONRaw: module.exports.encryptPrunedAssets(rawAssets, apk, h_mpk), 
                           e_email: e_email,
                  showNotification: true
                })                
            }

            // update addr monitors & refresh balance
            utilsWallet.getAppWorker().postMessageWrapped({ msg: 'DISCONNECT_ADDRESS_MONITORS', data: { wallet } })
            utilsWallet.getAppWorker().postMessageWrapped({ msg: 'CONNECT_ADDRESS_MONITORS', data: { wallet } })
            utilsWallet.getAppWorker().postMessageWrapped({ msg: 'REFRESH_ASSET_BALANCE', data: { asset: newDisplayableAsset, wallet } })

            // ret ok
            utilsWallet.logMajor('green','white', `removeImportedAccounts - complete`, removedAddrCount, { logServerConsole: true })
            return { removedAddrCount, removedAccountCount }
        }
        finally {
            utilsWallet.softNuke(rawAssets)
            utilsWallet.softNuke(genAsset)
            pt_rawAssets = null
        }
    },

    //
    // address generation
    //
    newWalletAddressFromPrivKey: (p) => {
        const { assetName, accountName, key, eosActiveWallet, knownAddr, symbol, isNonStdAddr, nonStd_protectOp_txid } = p
        const network = module.exports.getUtxoNetwork(symbol)
        
        //console.log(`newWalletAddressFromPrivKey, symbol=${symbol}, assetName=${assetName} configWallet.walletsMeta=`, configWallet.walletsMeta)
    
        var addr = !knownAddr ? module.exports.getAddressFromPrivateKey(
                        { assetMeta: configWallet.walletsMeta[assetName], privKey: key.privKey, eosActiveWallet }
                    )
                  : knownAddr // perf (bulk import) - don't recompute the key if it's already been done

        var pubKey
        if (symbol === 'BTC_TEST' && key.privKey) { 
            var pair = bitcoinJsLib.ECPair.fromWIF(key.privKey, network)
            pubKey = pair.publicKey.toString('hex')
            utilsWallet.softNuke(pair)
            pair = null
        }
        return {
            symbol,
            addr, 
            accountName, 
            isNonStdAddr, // DMS: identifies a non-std addr
            nonStd_protectOp_txid, // DMS: the "parent" or originating protect_op txid
            path: key.path, // see config/wallet -- we don't have completely unique HD paths (e.g. BTC/SW, and testnets), but seems not to matter too much (?)
            txs: [],
            utxos: [],
            lastAddrFetchAt: undefined,
            pubKey,
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

    //
    // private key derivation
    //
    generateUtxoBip44Wifs: (p) => { 
        const { entropySeed, symbol, addrNdx = 0, genCount = configWallet.WALLET_DEFAULT_ADDRESSES } = p

        var keyPairs = []
        const network = module.exports.getUtxoNetwork(symbol) // bitgo
        if (network === undefined) throw 'generateUtxoBip44Wifs - unsupported type'

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
            utilsWallet.debug(`generateUtxoBip44Wifs - ${symbol} @ BIP44 path ${path}`)
            keyPairs.push({ privKey: wif, path })
        }
        return keyPairs
    },
    generateEthereumWallet: (p) => {
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
                utilsWallet.debug(`generateEthereumWallet - ETH @ BIP44 path ${path}`)
                privKeys.push({ privKey: utilsWallet.batohex(child.privateKey), path })
            }
            return privKeys
        }
        catch (err) { 
            utilsWallet.error(`generateEthereumWallet - FAIL: ${err.message}`, err)
            return null
        }
    },

    //
    // helpers
    //
    encryptPrunedAssets: (currentAssets, apk, h_mpk) => {
        // prune
        var currentAssetsKeysOnly = {} 
        Object.keys(currentAssets).map(assetName => {
            var assetAccounts = _.cloneDeep(currentAssets[assetName].accounts)
            currentAssetsKeysOnly[assetName] = { accounts: assetAccounts }
        })

        // stringify
        var pt_assetsJsonPruned = JSON.stringify(currentAssetsKeysOnly, null, 1)

        // encrypt
        const e_assetsRawPruned = utilsWallet.aesEncryption(apk, h_mpk, pt_assetsJsonPruned)

        utilsWallet.softNuke(currentAssetsKeysOnly)
        utilsWallet.softNuke(pt_assetsJsonPruned)
        return e_assetsRawPruned
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

function sortAddresses(addresses) {
    const sorted = addresses.sort((a,b) => {
        // regular: m/44'/1'/0'/0/0
        // protected: ~p/44'/1'/0'/0/0
        // imported: ~i/44'/1'/1'/0/0
        const ss_a = a.path.split('/')
        const ss_b = b.path.split('/')
        if (ss_a[0] != ss_b[0]) return ss_a[0].localeCompare(ss_b[0]) * -1 // m/ , ~p/ , ~i/ 
        if (Number(ss_a[5]) < Number(ss_b[5])) return -1
        if (Number(ss_a[5]) > Number(ss_b[5])) return +1
        return 0
    })
    //console.log('sorted', sorted)
    return sorted
}