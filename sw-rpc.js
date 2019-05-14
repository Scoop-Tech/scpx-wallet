// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.
const url = require('url')
const jayson = require('jayson')

const configWallet = require('./config/wallet')
const utilsWallet = require('./utils')

const log = require('./cli-log')

var jaysonRpc
var serverRpc

module.exports = {

    init: async (rpcPort, rpcUsername, rpcPassword, rpcRemoteHosts) => {
        // validate
        if (!(rpcPort >= 1024 && rpcPort <= 65535)) {
            log.error(`Invalid rpcPort: ${rpcPort} - specify a port between 1024 and 65535`)
            return false
        }
        if (!rpcRemoteHosts || rpcRemoteHosts.length == 0) {
            log.error(`Invalid rpcRemoteHosts: ${rpcRemoteHosts}`)
            return false
        }
        const allowRemoteHosts = rpcRemoteHosts.split(',')

        // create server
        const portNo = Number(rpcPort)
        utilsWallet.logMajor('green', 'white', `... RPC init: port ${portNo} ...`, null, { logServerConsole: true })
        const methods = {
            // exec: function (args, callback) {
            //     log.info(`RPC: exec... args=`, args)
            //     callback(null, JSON.stringify(args))
            // }
            exec: authed((args, callback) => {
                log.info(`RPC: exec... args=`, args)

                //...
                
                // postback to client
                callback(null, JSON.stringify(args))
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
                        log.warn(`RPC: authentication absent - args=`, args)
                        return callback({ code: -403, message: 'Access denied' })
                    }
                    if (auth.username !== rpcUsername || auth.password !== rpcPassword) {
                        log.warn(`RPC: invalid credentials supplied - args=`, args)
                        return callback({ code: -403, message: 'Access denied' })
                    }

                    return fn.call(this, args.slice(1), callback) // callback, drop auth arg
                }
                catch (err) {
                    log.error(`RPC: internal error`, err)
                    return callback({ code: -32603, message: 'Internal error' })
                }
            }
        }
        jaysonRpc = jayson.server(methods, {
            // port: rpcPort,
            // host: '127.0.0.1',
            // path: '/rpc',
            // strict: true,
            // method: 'POST',
            // version: 1,
            //collect: true, // all params in one argument
            //params: Object // params are always an object
        })

        // read dev self-signed certs
        // to create a production cert, use: "openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes -sha256"
        const fs = require('fs')
        const key = fs.readFileSync('./certs/key.pem')
        const cert = fs.readFileSync('./certs/cert.pem')

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
    },

    terminate: () => {
        if (serverRpc) {
            log.info(`Stopping RPC server...`)
            serverRpc.close()
            serverRpc = undefined
        }
    },

    rpcTest: (appWorker, store, p) => {
        var { rpcPort, cmd, params } = p

        log.cmd('rpcTest')

        // validate; format is for a CLI command, and its params JSON encoded, e.g.
        // e.g. .rt --rpcPort 4000 --cmd ".tx-push" --params "{\"mpk\": \"...\", \"symbol\": \"...\", \"value\": \"...\"}"
        if (utilsWallet.isParamEmpty(rpcPort)) return Promise.resolve({ err: `RPC port is required` })
        if (utilsWallet.isParamEmpty(cmd)) return Promise.resolve({ err: `CLI command is required` })
        log.param('rpcPort', rpcPort)
        var parsedParams
        try {
            parsedParams = JSON.parse(params)
        }
        catch (err) {
            return Promise.resolve({ err: `CLI command parameters must be valid JSON` })
        }
        log.param('params', JSON.stringify(parsedParams))

        // exec
        const https = require('https')
        const agent = new https.Agent({
            host: 'localhost'
            , port: rpcPort
            , path: '/'
            , rejectUnauthorized: false // a less bad (but still bad) version of: process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;
        })
        const client = jayson.client.https({
            host: 'localhost',
            port: rpcPort,
            agent: agent
        })

        const auth = { username: 'scp', password: '123' }
        client.request('exec', [ auth, cmd, parsedParams], function (err, response) {
            if (err) throw err
            if (response.result) {
                log.info(`RPC response: ${response.result}`)
            }
            else if (response.error) {
                log.error(`RPC error: ${JSON.stringify(response.error)}`)
            }
        })

        return Promise.resolve({ ok: true })
    }
}