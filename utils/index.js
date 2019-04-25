const BigDecimal = require('js-big-decimal')
const BigNumber = require('bignumber.js')
const CryptoJS = require('crypto-js')

const colors = require('colors')
const chalk = require('chalk')

const configWallet = require('../config/wallet')
const configExternal = require('../config/wallet-external')

// setup storage -- localforage (indexeddb) or node-persist
var txdb_localForage 
if (configWallet.WALLET_ENV === "BROWSER") {
        const localForage = require('localforage')
        txdb_localForage = localForage.createInstance({
        driver: localForage.INDEXEDDB,
          name: "scp_tx_idb",
    })
}
else {
    if (!global.txdb_nodePersist) {
        global.txdb_nodePersist = require('node-persist')
        global.txdb_nodePersist.init({
            dir: './scp_tx_np' // TODO: move txdb out of here; cpuWorker ref's and creats multiple nodePersist connections
        }).then(() => {})
    }
}


module.exports = {
    
    //
    // tx db storage/caching
    //
    txdb_getItem: (key) => {
        if (configWallet.WALLET_ENV === "BROWSER") {
            return txdb_localForage.getItem(key)
        }
        else {
            return global.txdb_nodePersist.getItem(key)
        }
    },
    txdb_setItem: (key, value) => {
        if (configWallet.WALLET_ENV === "BROWSER") {
            return txdb_localForage.setItem(key, value)
        }
        else {
            return global.txdb_nodePersist.setItem(key, value)
        }
    },
    txdb_localForage: () => { return txdb_localForage },

    //
    // better than nothing for obfuscating stuff
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
    // logging - chalk/color for server terminal, html for browser console
    //
    logReducer: (s, p) => {
        if (configWallet.WALLET_ENV === "SERVER")
            if (p) console.log(chalk.white.bold.bgKeyword('orange').black(s), p)
            else   console.log(chalk.white.bold.bgKeyword('orange').black(s))
        else
            if (p) console.log(`%c${s}`, 'background: orange; color: white; font-weight: 600; font-size: 14px;', p)
            else   console.log(`%c${s}`, 'background: orange; color: white; font-weight: 600; font-size: 14px;')
    },
    logWorker: (s, p) => {
        if (configWallet.WALLET_ENV === "SERVER")
            if (p) console.log(chalk.white.bold.bgKeyword('gray').black(s), p)
            else   console.log(chalk.white.bold.bgKeyword('gray').black(s))
        else
            if (p) console.log(`%c${s}`, 'background: gray; color: white; font-weight: 600; font-size: 14px;', p)
            else   console.log(`%c${s}`, 'background: gray; color: white; font-weight: 600; font-size: 14px;')
    },
    logWallet: (s, p) => {
        if (configWallet.WALLET_ENV === "SERVER")
            if (p) console.log(chalk.white.bold.bgKeyword('purple')(s), p)
            else   console.log(chalk.white.bold.bgKeyword('purple')(s))
        else
            if (p) console.log(`%c${s}`, 'background: purple; color: white; font-weight: 600; font-size: large;', p)
            else   console.log(`%c${s}`, 'background: purple; color: white; font-weight: 600; font-size: large;')
    },
    log: (s, p) => {
        if (configWallet.WALLET_ENV === "SERVER")
            if (p) console.log(chalk.gray.bold(s), p)
            else   console.log(chalk.gray.bold(s))
        else
            if (p) console.log(`%c${s}`, 'color: gray; font-weight: 300; font-size: 12px;', p)
            else   console.log(`%c${s}`, 'color: gray; font-weight: 300; font-size: 12px;')
    },
    error: (s, p) => {
        if (configWallet.WALLET_ENV === "SERVER")
            if (p) console.log(chalk.red.bold(s), p)
            else   console.log(chalk.red.bold(s))
        else
            if (p) console.error(s, p)
            else   console.error(s)
    },
    warn: (s, p) => {
        if (configWallet.WALLET_ENV === "SERVER")
            if (p) console.log(chalk.yellow.bold(s), p)
            else   console.log(chalk.yellow.bold(s))
        else
            if (p) console.warn(s, p)
            else   console.warn(s)
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
    getMainThreadGlobalScope: () => {
        return getMainThreadGlobalScope()
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
                cpuWorker.on('message', listener) // .once - correct? ##### NO -- getting and discarding another's callback
            }

            function listener(event) {
                var input
                if (configWallet.WALLET_ENV === "BROWSER") {
                    if (!event || !event.data) { resolve(null); return }
                    input = event.data
                }
                else {
                    if (!event) { resolve(null); return }
                    input = event
                }

                const msg = input.msg
                const status = input.status
                const ret = input.data.ret
                const reqId = input.data.reqId
                const totalReqCount = input.data.totalReqCount

                if (msg === 'WALLET_ADDR_FROM_PRIVKEY' && status === `RES_${p.reqId}` && ret) {
                    resolve(ret)
                    if (configWallet.WALLET_ENV === "BROWSER") {
                        cpuWorker.removeEventListener('message', listener)
                    }
                    else {
                        cpuWorker.removeListener('message', listener)
                    }
                    if (callbackProcessed) {
                        callbackProcessed(ret, totalReqCount)
                    }
                    return
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
                cpuWorker.on('message', listener)
            }

            function listener(event) {
                var input
                if (configWallet.WALLET_ENV === "BROWSER") {
                    if (!event || !event.data) { resolve(null); return }
                    input = event.data
                }
                else {
                    if (!event) { resolve(null); return }
                    input = event
                }

                const msg = input.msg
                const status = input.status
                const ret = input.data.ret
                const reqId = input.data.reqId
                const totalReqCount = input.data.totalReqCount
                const inputParams = input.data.inputParams

                if (msg === 'ADDR_FROM_PRIVKEY' && status === `RES_${p.reqId}` && ret) {
                    resolve(ret)
                    if (configWallet.WALLET_ENV === "BROWSER") {
                        cpuWorker.removeEventListener('message', listener)
                    }
                    else {
                        cpuWorker.removeListener('message', listener)
                    }
                    if (callbackProcessed) {
                        callbackProcessed(ret, inputParams, totalReqCount)
                    }
                    return
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

function getMainThreadGlobalScope() {
    if (configWallet.WALLET_ENV === "BROWSER") {
        return window
    }
    else {
        return global
    }
}

function getNextCpuWorker() {
    const globalScope = getMainThreadGlobalScope()
    const ret = globalScope.cpuWorkers[globalScope.nextCpuWorker]

    if (++globalScope.nextCpuWorker > globalScope.cpuWorkers.length - 1) {
        globalScope.nextCpuWorker = 0
    }
    return ret
}