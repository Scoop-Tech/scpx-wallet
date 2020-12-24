// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2020 Dominic Morris.

const BigDecimal = require('js-big-decimal')
const BigNumber = require('bignumber.js')
const CryptoJS = require('crypto-js')
const base32Encode = require('base32-encode')
const stringify = require('json-stringify-safe')

const colors = require('colors')
const chalk = require('chalk')

const moment = require('moment')

const configWallet = require('../config/wallet')
const configExternal = require('../config/wallet-external')

// setup storage -- localforage/indexeddb (browser) or node-persist (server)
var txdb_localForage 
if (configWallet.WALLET_ENV === "BROWSER") {
    var isFrame = false
    if (typeof window !== 'undefined') {
        isFrame = window.location.pathname.startsWith("/frames")
    }
    if (!isFrame) {
        try {
            const localForage = require('localforage')
            txdb_localForage = localForage.createInstance({
                  driver: localForage.INDEXEDDB,
                    name: "scp_tx_idb",
            })
        }
        catch(err) {
            console.warn(`failed creating localForage IndexedDB instance (${window.location.pathname}): `, err)
        }
    }
}
else {
    //... node-persist setup by singleton appworker
}

// file logging (server)
var fileLogger = undefined
if (configWallet.WALLET_ENV === "SERVER") {
    const { createLogger, format, transports } = require('winston')
    const { combine, timestamp, align, label, prettyPrint, printf } = format
    const { SPLAT } = require('triple-beam')
    const { isObject } = require('lodash')
    function formatObject(param) {
        if (isObject(param)) {
            return JSON.stringify(param)
        }
        return param
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

var lastConsoleTitle = ''

module.exports = {
    
    //
    // tx db storage/caching
    //
    txdb_getItem: (key) => {
        if (configWallet.WALLET_ENV === "BROWSER") {
            return txdb_localForage.getItem(key)
        }
        else {
            return new Promise((resolve) => { resolve(global.txdb_dirty.get(key)) })
            //return global.txdb_nodePersist.getItem(key)
        }
    },
    txdb_setItem: (key, value) => {
        if (configWallet.WALLET_ENV === "BROWSER") {
            return txdb_localForage.setItem(key, value)
        }
        else {
            return new Promise((resolve) => { resolve(global.txdb_dirty.set(key, value)) })
            //return global.txdb_nodePersist.setItem(key, value)
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
                module.exports.warn(`toDisplayUnit - unsupported asset type ${asset.type}`)
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
                module.exports.warn(`toCalculationUnit - unsupported asset type ${asset.type}`)
                return NaN
        }
    },

    //
    // erc20
    //
    isERC20: (assetOrSymbolOrAddress) => {
        if (assetOrSymbolOrAddress.addressType) {
            return assetOrSymbolOrAddress.addressType === configWallet.ADDRESS_TYPE_ETH &&
                   assetOrSymbolOrAddress.symbol !== 'ETH' && assetOrSymbolOrAddress.symbol !== 'ETH_TEST'
        }
        if (Object.keys(configExternal.erc20Contracts).some(p => p == assetOrSymbolOrAddress)) {
            return true
        }
        if (Object.values(configExternal.erc20Contracts).map(p => p.toLowerCase()).some(p => p == assetOrSymbolOrAddress.toLowerCase())) {
            return true
        }
        return false
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
            module.exports.error('## utils.aesDecryption -- err=', err.toString())
            return null
        }
    },

    // mpk hash
    pbkdf2: (salt, data) => {
        const iterations = 246
        return CryptoJS.PBKDF2(data, salt, { keySize: 256 / 32, iterations }).toString()
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
    // TOTP: https://rootprojects.org/authenticator/
    //
    genTotpSecret: () => {
        const bytes = new Uint8Array(20)
        if (configWallet.WALLET_ENV === "BROWSER") {
            if (window && window.crypto) {
                window.crypto.getRandomValues(bytes)
                return base32Encode(bytes, 'RFC4648').replace(/=/g, '')
            } else throw 'No browser crypto'
        }
        else {
            // TODO: ... https://stackoverflow.com/questions/25725596/use-window-crypto-in-nodejs-code
            throw 'Not supported on server'
        }
    },
    getTotpUri: (secret, accountName, issuer, algo, digits, period) => {
        return 'otpauth://totp/' // full OTPAUTH URI spec as explained at https://github.com/google/google-authenticator/wiki/Key-Uri-Format
            + encodeURI(issuer || '') + ':' + encodeURI(accountName || '')
            + '?secret=' + secret.replace(/[\s\.\_\-]+/g, '').toUpperCase()
            + '&issuer=' + encodeURIComponent(issuer || '')
            + '&algorithm=' + (algo || 'SHA1')
            + '&digits=' + (digits || 6)
            + '&period=' + (period || 30)
    },

    //
    // notifications & logging for core wallet functions
    // server always logs to file, but by default does not log to the console (it interferes with the REPL)
    // browser logs to console
    //
    // (re. colors - chalk doesn't work in worker threads, colors does)
    // (also, re. powershell: https://github.com/nodejs/node/issues/14243)
    //
    // setLogToConsole: (v) => { 
    //     getMainThreadGlobalScope().configWallet.CLI_LOG_CORE = v // ## workers have different global scope to main thread
    // },
    logMajor: (bg, fg, s, p, opts) => { // level: info
        if (!s) return
        const ts = moment(new Date()).format('HH:mm:ss.SSS')
        if (configWallet.WALLET_ENV === "SERVER") {
            fileLogger.log('info', s, p)
            if (configWallet.CLI_LOG_CORE || (opts && opts.logServerConsole)) {
                if (bg === 'red') {
                    if (!p)  console.log(`${ts} ` + s.toString().bgRed.white.bold)
                    else     console.log(`${ts} ` + s.toString().bgRed.white.bold, stringify(p))
                }
                else if (bg === 'green') {
                    if (!p)  console.log(`${ts} ` + s.toString().bgGreen.white.bold)
                    else     console.log(`${ts} ` + s.toString().bgGreen.white.bold,stringify(p))
                }
                else if (bg === 'blue') {
                    if (!p)  console.log(`${ts} ` + s.toString().bgBlue.white.bold)
                    else     console.log(`${ts} ` + s.toString().bgBlue.white.bold, stringify(p))
                }            
                else if (bg === 'cyan') {
                    if (!p)  console.log(`${ts} ` + s.toString().bgCyan.white.bold)
                    else     console.log(`${ts} ` + s.toString().bgCyan.white.bold ,stringify(p))
                }
                else if (bg === 'yellow') { // # powershell colorblind
                    if (!p)  console.log(`${ts} ` + s.toString().bgYellow.black.bold)
                    else     console.log(`${ts} ` + s.toString().bgYellow.black.bold, stringify(p))
                }
                else if (bg === 'magenta') { // # powershell colorblind
                    if (!p)  console.log(`${ts} ` + s.toString().bgMagenta.white.bold)
                    else     console.log(`${ts} ` + s.toString().bgMagenta.white.bold, stringify(p))
                }
                else if (bg === 'white') { 
                    if (!p)  console.log(`${ts} ` + s.toString().bgWhite.black.bold)
                    else     console.log(`${ts} ` + s.toString().bgWhite.black.bold, stringify(p))
                }
                else if (bg === 'gray') { 
                    if (!p)  console.log(`${ts} ` + s.toString().bgWhite.gray.bold)
                    else     console.log(`${ts} ` + s.toString().bgWhite.gray.bold, stringify(p))
                }
                else {
                    if (!p)  console.log(`${ts} ` + s.toString().bgWhite.black.bold)
                    else     console.log(`${ts} ` + s.toString().bgWhite.black.bold, stringify(p))
                }
            }
        }
        else {
            if (p) console.log(ts + ` %c${s}`, `background: ${bg}; color: ${fg}; font-weight: 600; font-size: 14px;`, p)
            else   console.log(ts + ` %c${s}`, `background: ${bg}; color: ${fg}; font-weight: 600; font-size: 14px;`)
        }
    },
    log: (s, p, opts) => { // level: info
        if (!s) return
        const ts = moment(new Date()).format('HH:mm:ss.SSS')
        if (configWallet.WALLET_ENV === "SERVER") {
            fileLogger.log('info', s, p)
            if (configWallet.CLI_LOG_CORE || (opts && opts.logServerConsole)) {
                if (p) console.log(ts + ' [SW-LOG] ' + s.toString().white.bold, stringify(p))
                else   console.log(ts + ' [SW-LOG] ' + s.toString().white.bold) 
            }
        }
        else {
            if (p) console.log(ts + ` [SW-LOG] ${s}`, p)
            else   console.log(ts + ` [SW-LOG] ${s}`)
        }
    },
    error: (s, p, opts) => { // level: error
        if (!s) return
        const ts = moment(new Date()).format('HH:mm:ss.SSS')
        if (configWallet.WALLET_ENV === "SERVER") {
            fileLogger.log('error', s, p)
            if (configWallet.CLI_LOG_CORE || (opts && opts.logServerConsole)) {
                if (p) console.log(ts + ' [SW-ERR] ' + s.toString().red.bold, stringify(p))
                else   console.log(ts + ' [SW-ERR] ' + s.toString().red.bold)
            }
        }
        else {
            if (p) console.error(ts + ' [SW-ERR]' + s, p)
            else   console.error(ts + ' [SW-ERR]' + s)
        }
    },
    warn: (s, p, opts) => { // level: warn 
        if (!s) return
        const ts = moment(new Date()).format('HH:mm:ss.SSS')
        if (configWallet.WALLET_ENV === "SERVER") {
            fileLogger.log('warn', s, p)
            if (configWallet.CLI_LOG_CORE || (opts && opts.logServerConsole)) {
                if (p) console.log(ts + ' [SW-WRN] ' + s.toString().yellow.bold, stringify(p))
                else   console.log(ts + ' [SW-WRN] ' + s.toString().yellow.bold)  
            }
        }
        else {
            if (p) console.warn(ts + ' [SW-WRN]' + s, p)
            else   console.warn(ts + ' [SW-WRN]' + s)
        }
    },
    debug: (s, p, opts) => { // level: verbose 
        if (!s) return
        const ts = moment(new Date()).format('HH:mm:ss.SSS')
        if (configWallet.WALLET_ENV === "SERVER") {
            fileLogger.log('verbose', s, p)
            if (configWallet.CLI_LOG_CORE || (opts && opts.logServerConsole)) {
                if (p) console.debug(ts + ' [sw-dbg] ' + s.toString().gray, stringify(p))
                else   console.debug(ts + ' [sw-dbg] ' + s.toString().gray)
            }
        }
        else {
            if (p) console.debug(`[sw-dbg] ${s}`, p)
            else   console.debug(`[sw-dbg] ${s}`)
        }
    },
    setTitle: (s) => {
        if (!s) {
            require('console-title')(`sw-cli - ${lastConsoleTitle}${loadedWallet.dirty ? ' ** UNSAVED **' : ''}`)
        }
        else {
            require('console-title')(`sw-cli - ${s}${global.loadedWallet.dirty ? ' ** UNSAVED **' : ''}`)
            lastConsoleTitle = s
        }
    },

    //
    // cli helpers
    //
    isParamTrue: (s) => {
        if (s) {
            if (s.toString().toLowerCase() === 'true' || s === 1) {
                return true
            }
        }
        return false
    },
    isParamEmpty: (s) => isParamEmpty(s),
    validateSymbolValue: (store, symbol, value) => {
        const wallet = store.getState().wallet
        if (isParamEmpty(symbol)) return Promise.resolve({ err: `Asset symbol is required` })
        const asset = wallet.assets.find(p => p.symbol.toLowerCase() === symbol.toLowerCase())
        if (!asset) return Promise.resolve({ err: `Invalid asset symbol "${symbol}"` })
        if (isParamEmpty(value)) return Promise.resolve({ err: `Asset value is required` })
        if (isNaN(value)) return Promise.resolve({ err: `Invalid asset value` })
        const du_sendValue = Number(value)
        if (du_sendValue < 0) return Promise.resolve({ err: `Asset value cannot be negative` })
        return Promise.resolve({ asset, wallet, du_sendValue })
    },

    //
    // notifications & error logging
    //
    logErr: (err, OPT_BETA_TESTER) => {
        if (configWallet.WALLET_ENV === "BROWSER") {
            if (err) {
                if (OPT_BETA_TESTER != 'false') {
                    if (Sentry) {
                        Sentry.captureException(err)
                    }
                }
            }
        }
        else {
            // todo
        }
    },

    //
    // global objects - cross server & browser
    //
    getStorageContext: () => getStorageContext(),

    getMainThreadGlobalScope: () => getMainThreadGlobalScope(),

    getAppWorker: () => getMainThreadGlobalScope().appWorker,

    getHashedMpk: () => {
        if (configWallet.WALLET_ENV === "BROWSER") {
            return document.hjs_mpk || getStorageContext().PATCH_H_MPK
        }
        else {
            return getStorageContext().PATCH_H_MPK
        }
    },

    //
    // workers
    //
    getNextCpuWorker: () => getNextCpuWorker(),

    unpackWorkerResponse: (event) => unpackWorkerResponse(event),

    op_WalletAddrFromPrivKey: (p, callbackProcessed) => {
        const ret = new Promise(resolve => {
            const cpuWorker = getNextCpuWorker()

            cpuWorker.addEventListener('message', listener)

            function listener(event) {
                var input = unpackWorkerResponse(event)
                if (!input) { resolve(null); return }

                const msg = input.msg
                const status = input.status
                const ret = input.data.ret
                const reqId = input.data.reqId
                const totalReqCount = input.data.totalReqCount

                if (msg === 'WALLET_ADDR_FROM_PRIVKEY' && status === `RES_${p.reqId}` && ret) {
                    resolve(ret)
                    cpuWorker.removeEventListener('message', listener)
                    if (callbackProcessed) {
                        callbackProcessed(ret, totalReqCount)
                    }
                    return
                }
            }
 
            //console.log('StMaster - op_WalletAddrFromPrivKey, configWallet.stm_ApiPayload=', configWallet.get_stm_ApiPayload())
            cpuWorker.postMessageWrapped({ msg: 'WALLET_ADDR_FROM_PRIVKEY', status: 'REQ', data: { 
                params: p.params, reqId: p.reqId, totalReqCount: p.totalReqCount,
                stm_ApiPayload: configWallet.get_stm_ApiPayload(), // StMaster - pass down config/wallet.js::stm_ApiPayload
            }})
        })
        return ret
    },

    op_getAddressFromPrivateKey: (p, callbackProcessed) => {
        return new Promise(resolve => {
            const cpuWorker = getNextCpuWorker()

            cpuWorker.addEventListener('message', listener)

            function listener(event) {
                var input = unpackWorkerResponse(event)
                if (!input) { resolve(null); return }

                const msg = input.msg
                const status = input.status
                const ret = input.data.ret
                const reqId = input.data.reqId
                const totalReqCount = input.data.totalReqCount
                const inputParams = input.data.inputParams

                if (msg === 'ADDR_FROM_PRIVKEY' && status === `RES_${p.reqId}`) {
                    resolve(ret)
                    cpuWorker.removeEventListener('message', listener)
                    if (callbackProcessed) {
                        callbackProcessed(ret, inputParams, totalReqCount)
                    }
                    return
                }
            }
            
            console.log('StMaster - op_getAddressFromPrivateKey, configWallet.stm_ApiPayload=', configWallet.get_stm_ApiPayload())
            cpuWorker.postMessageWrapped({ msg: 'ADDR_FROM_PRIVKEY', status: 'REQ', data: { 
                params: p.params, reqId: p.reqId, totalReqCount: p.totalReqCount,
                stm_ApiPayload: configWallet.get_stm_ApiPayload(), // StMaster - pass down config/wallet.js::stm_ApiPayload
             }})
        })
    },

    //EMOJI_HAPPY_KITTY: '😸',
    EMOJI_TICK: '✔️',
    EMOJI_CROSS: '❌️'
}

const isParamEmpty = (s) => {
    return (!s || s.length === 0 || s === true)
}

const getKeyAndIV = (saltStr, passphrase) => {
    const iterations = 234
    const salt = CryptoJS.enc.Hex.parse(saltStr)
    const iv128Bits = CryptoJS.PBKDF2(passphrase, salt, { keySize: 128 / 32, iterations: iterations })
    const key256Bits = CryptoJS.PBKDF2(passphrase, salt, { keySize: 256 / 32, iterations: iterations })
    return { iv: iv128Bits, key: key256Bits }
}

function getStorageContext() {
    if (configWallet.WALLET_ENV === "BROWSER") {
        return window.sessionStorage // UPDATE: JUL 2020 -- iOS/Safari now supports sessionStorage in homescreen mode... (I think!)
        // if (window.isRunningHomescreen())
        //     return window.localStorage
        // else
        //     return window.sessionStorage
    }
    else {
        return global.storageContext
    }
}

function getMainThreadGlobalScope() {
    if (configWallet.WALLET_ENV === "BROWSER") {
        return window
    }
    else {
        return global
    }
}

function unpackWorkerResponse(event) {
    if (configWallet.WALLET_ENV === "BROWSER") {
        if (!event || !event.data) return null
        return event.data
    }
    else {
        if (!event) return null
        return event
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