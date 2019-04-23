const BigDecimal = require('js-big-decimal')
import BigNumber from 'bignumber.js'
import { AES, PBKDF2, SHA256, enc } from 'crypto-js'

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
export function sha256_shex(data) {
    return SHA256(data).toString()
}
export function batohex(byteArray) {
    return Array.prototype.map.call(byteArray, function (byte) {
        return ('0' + (byte & 0xFF).toString(16)).slice(-2)
    }).join('')
}
export function hextoba(hexString) {
    var result = []
    while (hexString.length >= 2) {
        result.push(parseInt(hexString.substring(0, 2), 16))
        hexString = hexString.substring(2, hexString.length)
    }
    return result
}

//
// notifications & error logging
//
export function logErr(err, OPT_BETA_TESTER) {
    if (configWallet.WALLET_ENV === "BROWSER") {
        if (err) {
            if (OPT_BETA_TESTER != 'false') {
                Sentry.captureException(err)
            }
        }
    }
    else {
        // todo
    }
}

//
// cpuWorkers
//
export var cpuWorkers = []
export var nextCpuWorker = 0
export var CPU_WORKERS = undefined

export function getNextCpuWorker() {
    const ret = this.cpuWorkers[this.nextCpuWorker]

    if (++this.nextCpuWorker > this.cpuWorkers.length - 1) {
        this.nextCpuWorker = 0
    }
    return ret
}

export function op_WalletAddrFromPrivKey(p, callbackProcessed) {
    return new Promise(resolve => {
        const cpuWorker = this.getNextCpuWorker()
        cpuWorker.addEventListener('message', listener)
        function listener(event) {
            if (event && event.data && event.data.data) {
                const msg = event.data.msg
                const status = event.data.status
                const ret = event.data.data.ret
                const reqId = event.data.data.reqId
                const totalReqCount = event.data.data.totalReqCount

                if (msg === 'WALLET_ADDR_FROM_PRIVKEY' && status === `RES_${p.reqId}` && ret) {
                    resolve(ret)
                    cpuWorker.removeEventListener('message', listener)

                    if (callbackProcessed) {
                        callbackProcessed(ret, totalReqCount)
                    }
                    return
                }
            }
            else { 
                debugger
                resolve(null)
            }
        }
        cpuWorker.postMessage({ msg: 'WALLET_ADDR_FROM_PRIVKEY', status: 'REQ', data: { params: p.params, reqId: p.reqId, totalReqCount: p.totalReqCount } })
    })
}

export function op_getAddressFromPrivateKey(p, callbackProcessed) {
    return new Promise(resolve => {
        const cpuWorker = this.getNextCpuWorker()
        cpuWorker.addEventListener('message', listener)
        function listener(event) {
            if (event && event.data && event.data.data) {
                const msg = event.data.msg
                const status = event.data.status
                const ret = event.data.data.ret
                const reqId = event.data.data.reqId
                const totalReqCount = event.data.data.totalReqCount
                const inputParams = event.data.data.inputParams

                if (msg === 'ADDR_FROM_PRIVKEY' && status === `RES_${p.reqId}` && ret) {
                    resolve(ret)
                    cpuWorker.removeEventListener('message', listener)

                    if (callbackProcessed) {
                        callbackProcessed(ret, inputParams, totalReqCount)
                    }
                    return
                }
            }
            else { 
                debugger
                resolve(null)
            }
        }
        cpuWorker.postMessage({ msg: 'ADDR_FROM_PRIVKEY', status: 'REQ', data: { params: p.params, reqId: p.reqId, totalReqCount: p.totalReqCount } })
    })
}

