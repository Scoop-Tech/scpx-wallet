const BigDecimal = require('js-big-decimal')
import BigNumber from 'bignumber.js'
import { AES, PBKDF2, enc } from 'crypto-js'

import * as configWallet from '../config/wallet'

//
// not wildly useful, but potentially better than nothing for obfuscating/GC-fast sensisitve stuff
//
export function softNuke(obj) { 
    if (obj !== undefined && obj !== null) {
        if (typeof obj !== "string" && typeof obj !== "number") {
            Object.keys(obj).forEach(p => { delete obj[p] })
        }
    }
}

//
// calculation/Display units conversion
//
export function toDisplayUnit(value, asset) {
    if (value === null || value === undefined || isNaN(value)) return NaN
    switch (asset.type) {
        case configWallet.WALLET_TYPE_UTXO:
            return value.dividedBy(100000000).toString()

        case configWallet.WALLET_TYPE_ACCOUNT:
            if (asset.addressType === configWallet.ADDRESS_TYPE_ETH) {
                const ret = value.absoluteValue().div(new BigNumber(10).pow(asset.decimals))

                // eth, erc20
                if (value.isNegative()) {
                    return "-" + ret.toString()
                }
                else {
                    return ret.toString()
                }
            }
            else { // eos -- todo
                return value.toString()
            }

        default:
            console.warn(`toDisplayUnit - unsupported asset type ${asset.type}`)
            return NaN
    }
}
export function toCalculationUnit(value, asset) {
    if (value === null || value === undefined || isNaN(value)) return NaN
    switch (asset.type) {
        case configWallet.WALLET_TYPE_UTXO:
            return new BigNumber(value).multipliedBy(100000000)

        case configWallet.WALLET_TYPE_ACCOUNT:
            if (asset.addressType === configWallet.ADDRESS_TYPE_ETH) {

                // # we absolutely need all 18 digits of eth precision, but native .toFixed(18) produces trailing random rounding error digits
                // leads to validation fails when trying to send-all eth
                const rounded = new BigDecimal(value).round(asset.decimals, BigDecimal.RoundingModes.DOWN).getValue()
                return new BigNumber(rounded).times(new BigNumber(10).pow(asset.decimals))
            }
            else { // eos -- todo
                return new BigNumber(value)
            }

        default:
            console.warn(`toCalculationUnit - unsupported asset type ${asset.type}`)
            return NaN
    }
}

//
// erc20
//
export function isERC20(assetOrSymbol) {
    if (assetOrSymbol.addressType) {
        return assetOrSymbol.addressType === configWallet.ADDRESS_TYPE_ETH &&
               assetOrSymbol.symbol !== 'ETH' && assetOrSymbol.symbol !== 'ETH_TEST'
    }
    else {
        return Object.keys(erc20Contracts).some(p => p == assetOrSymbol)
    }
}

//
// Crypto & Encoding
//
export function aesEncryption(salt, passphrase, plaintextData) {
    const keys = getKeyAndIV(salt, passphrase)
    const ciphertext = AES.encrypt(plaintextData, keys.key, { iv: keys.iv })
    return ciphertext.toString()
}
export function aesDecryption(salt, passphrase, encryptedData) {
    try {
        const keys = getKeyAndIV(salt, passphrase)
        const bytes = AES.decrypt(encryptedData, keys.key, { iv: keys.iv })
        const plaintext = bytes.toString(enc.Utf8)
        return plaintext
    }
    catch (err) {
        console.error('## utils.aesDecryption -- err=', err)
        return null
    }
}
const getKeyAndIV = (saltStr, passphrase) => {
    const iterations = 234
    const salt = enc.Hex.parse(saltStr)
    const iv128Bits = PBKDF2(passphrase, salt, { keySize: 128 / 32, iterations: iterations })
    const key256Bits = PBKDF2(passphrase, salt, { keySize: 256 / 32, iterations: iterations })
    return { iv: iv128Bits, key: key256Bits }
}