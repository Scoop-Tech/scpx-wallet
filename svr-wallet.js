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
    const emailEntropyBase36 = new BigNumber(BigNumber.random(80).times(1e80).toFixed()).toString(36)

    return Keygen.generateMasterKeys()
    .then(keys => {
        const res = loadWallet(store, { 
            mpk: keys.masterPrivateKey,
            apk: keys.publicKeys.active,
          email: `s+${emailEntropyBase36}@scoop.tech`
        })
        return res
    })
}

export function loadWallet(store, p) {
    const { mpk, apk, email } = p
    if (!mpk)   return { err: 'invalid MPK' }
    if (!apk)   return { err: 'invalid APK' }
    if (!email) return { err: 'invalid email' }
    
    log.info(`** INPUTS **`)
    log.info(`      mpk: ${mpk}`)
    log.info(`      apk: ${apk}`)
    log.info(`    email: ${email}`)

    const h_mpk = utilsWallet.pbkdf2(apk, mpk)
    const e_email = utilsWallet.aesEncryption(apk, h_mpk, email)
    const md5_email = MD5(email).toString()

    log.info(`** DERIVED **`)
    log.info(`    h_mpk: ${h_mpk}`)
    log.info(`  e_email: ${e_email}`)
    log.info(`md5_email: ${md5_email}`)

    // TODO -- want equivalent to create-account, **just no save on generateWallets**

    return generateWallets({
                store: store,
      userAccountName: undefined, // no EOS persistence for server wallets
         activePubKey: apk,
              e_email: e_email,
                h_mpk: h_mpk,
       e_serverAssets: undefined, // new account
      eosActiveWallet: undefined, // TODO -- NUKE THIS ! or include it properly ...
    })
    .then(res => {
        return { ok: mpk }
    })
    .catch(err => {
        return { err: err.message || err.toString() }
    })

}
