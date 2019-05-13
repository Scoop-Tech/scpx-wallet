// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.
const jayson = require('jayson')

const configWallet = require('./config/wallet')
const utilsWallet = require('./utils')

const log = require('./cli-log')

var rpcServer

module.exports = {

    init: async (port, userName, password) => {
        if (!(port >= 1024 && port <= 65535)) {
            log.error(`Invalid RPC port ${port} - specify a port between 1024 and 65535`)
            return false
        }

        const portNo = Number(port)
        utilsWallet.logMajor('green','white', `... RPC init: port ${portNo} ...`, null, { logServerConsole: true })

        const methods = {
            exec: function(args, callback) {
                log.info(`RPC: exec...`, args)
                callback(null, JSON.stringify(args))
            }
        }

        rpcServer = jayson.server(methods, {
            collect: true, // all params in one argument
            params: Object // params are always an object
        })

        rpcServer.https().listen(port)
    },

    terminate: () => {
        log.info(`Stopping RPC server...`)
        rpcServer.https().close()
    },

    rpcTest: (appWorker, store, p) => {
        console.log('rpcTest', p)
        //...
        
        return Promise.resolve( { ok: true })
    }
}