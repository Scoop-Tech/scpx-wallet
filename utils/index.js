const BigDecimal = require('js-big-decimal')
const BigNumber = require('bignumber.js')
const CryptoJS = require('crypto-js')

const colors = require('colors')
const chalk = require('chalk')

const configWallet = require('../config/wallet')
const configExternal = require('../config/wallet-external')

// setup storage -- localforage/indexeddb (browser) or node-persist (server)
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

// file logging (server)
var fileLogger = undefined
if (configWallet.WALLET_ENV === "SERVER") {
    const { createLogger, format, transports } = require('winston')
    const { combine, timestamp, align, label, prettyPrint, printf  } = format
    const { SPLAT } = require('triple-beam')
    const { isObject } = require('lodash')
    function formatObject(param) {
        if (isObject(param)) {
          return JSON.stringify(param)
        }
        return param;
      }
    const all = format((info) => {
        const splat = info[SPLAT] || []
        const message = formatObject(info.message)
        const rest = splat.map(formatObject).join(' ')
        info.message = `${message} ${rest}`
        return info
      });
    fileLogger = createLogger({
        level: 'info',
        format: combine(
            all(),
            label({ label: configWallet.WALLET_VER }),
            timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            align(),
            printf(info => `${info.timestamp} [${info.label}] ${info.level}:${formatObject(info.message)}`)
        ),
        defaultMeta: { service: 'scpx-w' },
        transports: [
            new transports.File({ filename: './error.log',  level: 'error' }),   // error only
            new transports.File({ filename: './warn.log' ,  level: 'warn' }),    // warn & error
            new transports.File({ filename: './info.log' ,  level: 'info' }),    // info, warn & error
            new transports.File({ filename: './debug.log' , level: 'verbose' }), // all
        ]
    })
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
    // logging for core wallet functions
    // server always logs to file, but by default does not log to the console (it interferes with the REPL)
    // browser logs to console
    //
    // (re. colors - chalk doesn't work in worker threads, colors does)
    // (also, re. powershell: https://github.com/nodejs/node/issues/14243)
    //
    logMajor: (bg, fg, s, p, opts) => { // level: info
        if (configWallet.WALLET_ENV === "SERVER") {
            fileLogger.log('info', s, p)
            if (opts && opts.logServerConsole) {
                if (bg === 'red') {
                    if (!p)  console.log('' + s.bgRed.white.bold)
                    else     console.log('' + s.bgRed.white.bold, p)
                }
                else if (bg === 'green') {
                    if (!p)  console.log('' + s.bgGreen.white.bold)
                    else     console.log('' + s.bgGreen.white.bold, p)
                }
                else if (bg === 'blue') {
                    if (!p)  console.log('' + s.bgBlue.white.bold)
                    else     console.log('' + s.bgBlue.white.bold, p)
                }            
                else if (bg === 'cyan') {
                    if (!p)  console.log('' + s.bgCyan.white.bold)
                    else     console.log('' + s.bgCyan.white.bold, p)
                }
                else if (bg === 'yellow') { // # powershell colorblind
                    if (!p)  console.log('' + s.bgYellow.black.bold)
                    else     console.log('' + s.bgYellow.black.bold, p)
                }
                else if (bg === 'magenta') { // # powershell colorblind
                    if (!p)  console.log('' + s.bgMagenta.white.bold)
                    else     console.log('' + s.bgMagenta.white.bold, p)
                }
                else if (bg === 'white') { 
                    if (!p)  console.log('' + s.bgWhite.black.bold)
                    else     console.log('' + s.bgWhite.black.bold, p)
                }
                else if (bg === 'gray') { 
                    if (!p)  console.log('' + s.bgWhite.gray.bold)
                    else     console.log('' + s.bgWhite.gray.bold, p)
                }
                else {
                    if (!p)  console.log('' + s.bgWhite.black.bold)
                    else     console.log('' + s.bgWhite.black.bold, p)
                }
            }
        }
        else {
            if (p) console.log(`%c${s}`, `background: ${bg}; color: ${fg}; font-weight: 600; font-size: 14px;`, p)
            else   console.log(`%c${s}`, `background: ${bg}; color: ${fg}; font-weight: 600; font-size: 14px;`)
        }
    },
    log: (s, p, opts) => { // level: info
        if (configWallet.WALLET_ENV === "SERVER") {
            fileLogger.log('info', s, p)
            if (opts && opts.logServerConsole) {
                if (p) console.log('[SW-LOG] ' + s.white.bold, p)
                else   console.log('[SW-LOG] ' + s.white.bold) 
            }
        }
        else {
            if (p) console.log(`[SW-LOG] ${s}`, p)
            else   console.log(`[SW-LOG] ${s}`)
        }
    },
    error: (s, p, opts) => { // level: error
        if (configWallet.WALLET_ENV === "SERVER") {
            fileLogger.log('error', s, p)
            if (opts && opts.logServerConsole) {
                if (p) console.log('[SW-ERR] ' + s.red.bold, p)
                else   console.log('[SW-ERR] ' + s.red.bold)
            }
        }
        else {
            if (p) console.error('[SW-ERR]' + s, p)
            else   console.error('[SW-ERR]' + s)
        }
    },
    warn: (s, p, opts) => { // level: warn 
        if (configWallet.WALLET_ENV === "SERVER") {
            fileLogger.log('warn', s, p)
            if (opts && opts.logServerConsole) {
                if (p) console.log('[SW-WRN] ' + s.yellow.bold, p)
                else   console.log('[SW-WRN] ' + s.yellow.bold)  
            }
        }
        else {
            if (p) console.warn('[SW-WRN]' + s, p)
            else   console.warn('[SW-WRN]' + s)
        }
    },
    debug: (s, p, opts) => { // level: debug -- TODO: change all chatty logging to debug level
        if (configWallet.WALLET_ENV === "SERVER") {
            fileLogger.log('verbose', s, p)
            if (opts && opts.logServerConsole) {
                if (p) console.log('[sw-dbg] ' + s.gray, p)
                else   console.log('[sw-dbg] ' + s.gray)
            }
        }
        else {
            if (p) console.debug(`%c[sw-dbg] ${s}`, 'color: gray; font-weight: 300; font-size: 12px;', p)
            else   console.debug(`%c[sw-dbg] ${s}`, 'color: gray; font-weight: 300; font-size: 12px;')
        }
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