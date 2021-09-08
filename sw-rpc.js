// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2021 Dominic Morris.
const url = require('url')
const jayson = require('jayson')

const configWallet = require('./config/wallet')
const utilsWallet = require('./utils')
const appStore = require('./store').store

const svrWallet = require('./svr-wallet/sw-router')

const log = require('./sw-cli-log')

var jaysonRpc
var serverRpc // defined if RPC is running

module.exports = {

    isRunning: () => { return serverRpc !== undefined },

    init: async (rpcPort, rpcUsername, rpcPassword, rpcRemoteHosts) => {
        // validate
        if (!(rpcPort >= 1024 && rpcPort <= 65535)) {
            log.error(`Invalid rpcPort: ${rpcPort} - specify a port between 1024 and 65535`)
            return false
        }
        if (!rpcRemoteHosts || rpcRemoteHosts.length == 0) {
            log.error(`Invalid rpcRemoteHosts: ${rpcRemoteHosts} - host restriction for RPC is mandatory`)
            return false
        }
        if (!rpcUsername || rpcUsername.length == 0) {
            log.error(`Missing rpcUsername - username and password for RPC is mandatory`)
            return false
        }
        if (!rpcPassword || rpcPassword.length == 0) {
            log.error(`Missing rpcPassword - username and password for RPC is mandatory`)
            return false
        }

        // create server
        const allowRemoteHosts = rpcRemoteHosts.split(',')
        const portNo = Number(rpcPort)
        utilsWallet.logMajor('green', 'white', `... RPC init: port ${portNo} ...`, null, { logServerConsole: true })
        const methods = {
            exec: authed(async (args, callback) => {
                log.info(`RPC: exec... args=`, args)
                const cmd = args[0]
                const cmdParams = args[1]
                const appWorker = utilsWallet.getAppWorker() 
                try {
                    // add mpk if in dev mode
                    if (global.loadedWallet.keys && global.loadedWallet.keys.mpk && !cmdParams.mpk) { 
                        log.info(`CLI_SAVE_KEY: adding cached MPK...`)
                        cmdParams.mpk = global.loadedWallet.keys.mpk
                    }

                    // switch wallet fn.
                    var fn
                    switch (cmd) {
                        case 'wallet-dump':        fn = svrWallet.fn(appWorker, appStore, cmdParams, 'DUMP'); break
                        case 'wallet-balance':     fn = svrWallet.fn(appWorker, appStore, cmdParams, 'BALANCE'); break
                        case 'tx-get-fee':         fn = svrWallet.fn(appWorker, appStore, cmdParams, 'TX-GET-FEE'); break
                        case 'tx-push':            fn = svrWallet.fn(appWorker, appStore, cmdParams, 'TX-PUSH'); break
                    }
                    if (fn === undefined) {
                        return callback({ code: -32600, message: 'Invalid request' })
                    }
                    else {
                        // postback to client
                        const res = await fn
                        if (res) {
                            if (res.err) {
                                callback({ code: -1, message: res.err })
                            }
                            else {
                                callback(null, res) // ok
                            }
                        }
                        else {
                            log.error(`RPC: unexpected data on cmd ${cmd}`)
                            return callback({ code: -32603, message: 'Internal error' })
                        }
                    }
                }
                catch (err) {
                    log.error(`RPC: internal error on authorized request`, err)
                    return callback({ code: -32603, message: 'Internal error' })
                }
            })
        }
        function authed(fn) {
            return function (args, callback) {
                try {
                    if (!args || args.length != 3) { // expected args: auth, cmd, params 
                        log.warn(`RPC: invalid request - args=`, args)
                        return callback({ code: -32600, message: 'Invalid request' })
                    }

                    // validate auth
                    var auth = args[0]
                    if (!auth || !auth.username || !auth.password) { 
                        log.error(`RPC: authentication absent - args=`, args)
                        return callback({ code: -403, message: 'Access denied' })
                    }
                    if (auth.username != rpcUsername || auth.password != rpcPassword) {
                        log.error(`RPC: invalid credentials supplied - args=`, args)
                        return callback({ code: -403, message: 'Access denied' })
                    }

                    return fn.call(this, args.slice(1), callback) // callback, drop auth arg
                }
                catch (err) {
                    log.error(`RPC: internal error on auth check`, err)
                    return callback({ code: -32603, message: 'Internal error' })
                }
            }
        }
        jaysonRpc = jayson.server(methods)

        // read dev self-signed certs
        // to create a production cert, use: "openssl req -x509 -newkey rsa:4096 -keyout dev-key.pem -out dev-cert.pem -days 365 -nodes -sha256"
        const fs = require('fs')
        const key = fs.readFileSync('./certs/dev-key.pem')
        const cert = fs.readFileSync('./certs/dev-cert.pem')

        // create json-rpc https server 
        serverRpc = jaysonRpc.https({ key, cert })

        // apply remote address filtering
        serverRpc.on('connection', function (sock) {
            log.info(`RPC: connection from [${sock.remoteAddress}]...`)
            if (!allowRemoteHosts.some(p => p === sock.remoteAddress)) {
                log.warn(`RPC: dropping connection from disallowed remote address [${sock.remoteAddress}]`)
                sock.end()
            }
        })

        // start rpc server
        serverRpc.listen(rpcPort)
        return true
    },

    terminate: () => {
        if (serverRpc) {
            log.info(`Terminating RPC server...`)
            serverRpc.close()
            serverRpc = undefined
        }
    },

    rpcTest: (appWorker, store, p) => {
        var { rpcPort, rpcHost, rpcUsername, rpcPassword, cmd, params } = p

        log.cmd('rpcTest')

        // validate: format is for a CLI command, and its params JSON encoded, e.g.
        // e.g. ./rt --rpcPort 4000 --cmd ".tx-push" --params "{\"mpk\": \"...\", \"symbol\": \"...\", \"value\": \"...\"}"
        // e.g. ./rt --rpcPort ... --rpcHost ... --rpcUsername ... --rpcPassword ... --cmd tx-push --params '{\"symbol\": \"BTC_TEST\", \"value\": \"0.00042\", \"to\": \"2MwyFPaa7y5BLECBLhF63WZVBtwSPo1EcMJ\" }'

        if (utilsWallet.isParamEmpty(rpcPort)) return Promise.resolve({ err: `RPC port is required` })

        if (utilsWallet.isParamEmpty(rpcHost)) return Promise.resolve({ err: `RPC host is required` })
        if (utilsWallet.isParamEmpty(rpcUsername)) return Promise.resolve({ err: `RPC username is required` })
        if (utilsWallet.isParamEmpty(rpcPassword)) return Promise.resolve({ err: `RPC password is required` })
        if (utilsWallet.isParamEmpty(cmd)) return Promise.resolve({ err: `CLI command is required` })
        log.param('rpcPort', rpcPort)
        log.param('rpcHost', rpcHost)
        log.param('rpcUsername', rpcUsername)
        log.param('rpcPassword', rpcPassword)
        log.param('cmd', cmd)
        log.param('params', params)
        var parsedParams
        try {
            parsedParams = JSON.parse(params)
        }
        catch (err) {
            return Promise.resolve({ err: `CLI command parameters must be valid JSON` })
        }

        // exec
        const https = require('https')
        const agent = new https.Agent({
              host: rpcHost,
              port: rpcPort,
              path: '/',
              rejectUnauthorized: false // a less bad (but still bad) version of: process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;
        })
        const client = jayson.client.https({
            host: rpcHost,
            port: rpcPort,
            agent: agent
        })

        const auth = { username: rpcUsername, password: rpcPassword }
        return new Promise((resolve) => {
            client.request('exec', [ auth, cmd, parsedParams], function (err, response) {
                if (err) {
                    resolve({ err: err.message || err.toString() })
                }
                else if (response.result) {
                    log.info(`RPC response:`, JSON.stringify(response.result, null, 2))
                    resolve({ ok: true, response })
                }
                else if (response.error) {
                    log.error(`RPC error: ${JSON.stringify(response.error)}`)
                    resolve({ ok: false, response })
                }
            })
        })

        //return Promise.resolve({ ok: true })
    }
}