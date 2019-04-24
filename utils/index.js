const BigDecimal = require('js-big-decimal')

const BigNumber = require('bignumber.js')
//import BigNumber from 'bignumber.js'

const CryptoJS = require('crypto-js')
//import { AES, PBKDF2, SHA256, enc } from 'crypto-js'

//import * as configWallet from '../config/wallet'
const configWallet = require('../config/wallet')

//import * as configExternal from '../config/wallet-external'
const configExternal = require('../config/wallet-external')

module.exports = {

    //
    // not wildly useful, but potentially better than nothing for obfuscating/GC-fast sensisitve stuff
    //
    softNuke: (obj) => { 
        if (obj !== undefined && obj !== null) {
            if (typeof obj !== "string" && typeof obj !== "number") {
                Object.keys(obj).forEach(p => { delete obj[p] })
            }
        }
    },

    //
    // calculation/Display units conversion
    //
    toDisplayUnit: (value, asset) => {
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
    },
    toCalculationUnit: (value, asset) => {
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
    },

    //
    // erc20
    //
    isERC20: (assetOrSymbol) => {
        if (assetOrSymbol.addressType) {
            return assetOrSymbol.addressType === configWallet.ADDRESS_TYPE_ETH &&
                assetOrSymbol.symbol !== 'ETH' && assetOrSymbol.symbol !== 'ETH_TEST'
        }
        else {
            return Object.keys(configExternal.erc20Contracts).some(p => p == assetOrSymbol)
        }
    },

    //
    // Crypto & Encoding
    //
    aesEncryption: (salt, passphrase, plaintextData) => {
        const keys = getKeyAndIV(salt, passphrase)
        const ciphertext = CryptoJS.AES.encrypt(plaintextData, keys.key, { iv: keys.iv })
        return ciphertext.toString()
    },
    aesDecryption: (salt, passphrase, encryptedData) => {
        try {
            const keys = getKeyAndIV(salt, passphrase)
            const bytes = CryptoJS.AES.decrypt(encryptedData, keys.key, { iv: keys.iv })
            const plaintext = bytes.toString(CryptoJS.enc.Utf8)
            return plaintext
        }
        catch (err) {
            console.error('## utils.aesDecryption -- err=', err)
            return null
        }
    },

    // mpk hash
    pbkdf2: (salt, data) => {
        const iterations = 246
        return CryptoJS.PBKDF2(data, salt, { keySize: 256 / 32, iterations: iterations }).toString()
    },

    // sha256 hex str
    sha256_shex: (data) => {
        return CryptoJS.SHA256(data).toString()
    },

    // byte-array/hex
    batohex: (byteArray) => {
        return Array.prototype.map.call(byteArray, function (byte) {
            return ('0' + (byte & 0xFF).toString(16)).slice(-2)
        }).join('')
    },
    hextoba: (hexString) => {
        var result = []
        while (hexString.length >= 2) {
            result.push(parseInt(hexString.substring(0, 2), 16))
            hexString = hexString.substring(2, hexString.length)
        }
        return result
    },

    //
    // notifications & error logging
    //
    logErr: (err, OPT_BETA_TESTER) => {
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
    },

    //
    // global object
    //
    getGlobal: () => {
        return getGlobal()
    },

    //
    // cpuWorkers
    //
    getNextCpuWorker: () => {
        return getNextCpuWorker()
    },

    op_WalletAddrFromPrivKey: (p, callbackProcessed) => {
        const ret = new Promise(resolve => {
            const cpuWorker = getNextCpuWorker()

            if (configWallet.WALLET_ENV === "BROWSER") {
                cpuWorker.addEventListener('message', listener)
            }
            else {
                cpuWorker.once('message', listener) // .once - correct?
            }

            function listener(event) {
                if (event && event.data && event.data.data) {
                    const msg = event.data.msg
                    const status = event.data.status
                    const ret = event.data.data.ret
                    const reqId = event.data.data.reqId
                    const totalReqCount = event.data.data.totalReqCount

                    if (msg === 'WALLET_ADDR_FROM_PRIVKEY' && status === `RES_${p.reqId}` && ret) {
                        resolve(ret)
                        if (configWallet.WALLET_ENV === "BROWSER") {
                            cpuWorker.removeEventListener('message', listener)
                        }
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
        return ret
    },

    op_getAddressFromPrivateKey: (p, callbackProcessed) => {
        return new Promise(resolve => {
            const cpuWorker = getNextCpuWorker()

            if (configWallet.WALLET_ENV === "BROWSER") {
                cpuWorker.addEventListener('message', listener)
            }
            else {
                cpuWorker.once('message', listener) //  MaxListenersExceededWarning: ... .once -- correct?
            }

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
                        if (configWallet.WALLET_ENV === "BROWSER") {
                            cpuWorker.removeEventListener('message', listener)
                        }
                        if (callbackProcessed) {
                            callbackProcessed(ret, inputParams, totalReqCount)
                        }
                        return
                    }
                }
                else { 
                    resolve(null)
                }
            }
            cpuWorker.postMessage({ msg: 'ADDR_FROM_PRIVKEY', status: 'REQ', data: { params: p.params, reqId: p.reqId, totalReqCount: p.totalReqCount } })
        })
    },
}

const getKeyAndIV = (saltStr, passphrase) => {
    const iterations = 234
    const salt = CryptoJS.enc.Hex.parse(saltStr)
    const iv128Bits = CryptoJS.PBKDF2(passphrase, salt, { keySize: 128 / 32, iterations: iterations })
    const key256Bits = CryptoJS.PBKDF2(passphrase, salt, { keySize: 256 / 32, iterations: iterations })
    return { iv: iv128Bits, key: key256Bits }
}

function getGlobal() {
    if (configWallet.WALLET_ENV === "BROWSER") {
        return window
    }
    else {
        return global
    }
}

function getNextCpuWorker() {
    const globalScope = getGlobal()
    const ret = globalScope.cpuWorkers[globalScope.nextCpuWorker]

    if (++globalScope.nextCpuWorker > globalScope.cpuWorkers.length - 1) {
        globalScope.nextCpuWorker = 0
    }
    return ret
}