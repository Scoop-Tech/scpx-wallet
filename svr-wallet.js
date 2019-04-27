'use strict';

import { Keygen } from 'eosjs-keygen'
import BigNumber from 'bignumber.js'
import { MD5 } from 'crypto-js'

const { Worker, isMainThread, parentPort } = require('worker_threads')

import * as configWallet from './config/wallet'
import * as utilsWallet from './utils'

import { generateWallets } from './actions/wallet'

import * as log from './cli-log'

export function newWallet(store) {
    //const emailEntropyBase36 = new BigNumber(BigNumber.random(80).times(1e80).toFixed()).toString(36)

    return Keygen.generateMasterKeys()
    .then(keys => {
        const res = loadWallet(store, { 
            mpk: keys.masterPrivateKey,
            apk: keys.publicKeys.active,
          //email: `s+${emailEntropyBase36}@scoop.tech`
        })
        return res
    })
}

export function loadWallet(store, p) {
    const { mpk, apk } = p
    const invalidMpkApk = validateMpkApk(mpk, apk)
    if (invalidMpkApk) return invalidMpkApk
    
    const h_mpk = utilsWallet.pbkdf2(apk, mpk)
    //const e_email = utilsWallet.aesEncryption(apk, h_mpk, email)
    //const md5_email = MD5(email).toString()

    log.info(`h_mpk: ${h_mpk} (hased MPK)`)
    log.info(`  apk: ${apk} (active public key)`)

    return generateWallets({
                store: store,
         activePubKey: apk,
                h_mpk: h_mpk,
      userAccountName: undefined, // no EOS persistence for server wallets - not required
              e_email: undefined, // no EOS persistence for server wallets - not required
       e_serverAssets: undefined, // new account
      eosActiveWallet: undefined, // TODO -- REMOVE THIS (or handle it properly -- maybe by key import only to start with?)
    callbackProcessed: (ret, totalReqCount) => {}
    })
    .then(res => {
        return { ok: p }
    })
    .catch(err => {
        return { err: err.message || err.toString() }
    })
}

export async function dumpWallet(store, p) {
    const { mpk, apk } = p
    const invalidMpkApk = validateMpkApk(mpk, apk)
    if (invalidMpkApk) return invalidMpkApk

    const storeState = store.getState()
    if (!storeState) return new Promise((resolve) => resolve({ err: 'invalid store state' }))
    const wallet = storeState.wallet
    if (!wallet || !wallet.assets_raw || !wallet.assets) return new Promise((resolve) => resolve({ err: 'no loaded wallet' }))

    const h_mpk = utilsWallet.pbkdf2(apk, mpk)

    // decrypt raw assets (private keys) from the store
    var pt_assetsJson
    try {
        pt_assetsJson = utilsWallet.aesDecryption(apk, h_mpk, wallet.assets_raw)
    }
    catch(err) {
        return new Promise((resolve) => resolve({ err: `decrypt failed (${err.message} - MPK and APK are probably incorrect` }))
    }
    var pt_assetsObj = JSON.parse(pt_assetsJson)

    // match privkeys to addresses by HD path in the displayable assets (unencrypted) store 
    var allPathKeyAddrs = []
    Object.keys(pt_assetsObj).forEach(assetName => {
        pt_assetsObj[assetName].accounts.forEach(account => {
            account.privKeys.forEach(privKey => {
                var pathKeyAddr = {
                    assetName,
                    path: privKey.path,
                    privKey: privKey.privKey,
                }
                const meta = configWallet.walletsMeta[assetName] 

                // get corresponding addr, lookup by HD path
                const walletAsset = wallet.assets.find(p => p.symbol === meta.symbol)
                const walletAddr = walletAsset.addresses.find(p => p.path === privKey.path)

                pathKeyAddr.addr = walletAddr.addr
                pathKeyAddr.accountName = walletAddr.accountName
                pathKeyAddr.symbol = meta.symbol
                allPathKeyAddrs.push(pathKeyAddr)
            })
        })
    })

    utilsWallet.softNuke(pt_assetsJson)
    utilsWallet.softNuke(pt_assetsObj)

    return new Promise((resolve) => {
        resolve({ ok: allPathKeyAddrs })
    })
}

function validateMpkApk(mpk, apk) {
    if (!mpk) return new Promise((resolve) => resolve({ err: 'invalid MPK' }))
    if (!apk) return new Promise((resolve) => resolve({ err: 'invalid APK' }))
    if (mpk.length < 53) return new Promise((resolve) => resolve({ err: 'MPK too short (53 chars min)' }))
    if (apk.length < 53) return new Promise((resolve) => resolve({ err: 'APK too short (53 chars min)' }))
    return undefined
}
