// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.
const jayson = require('jayson')

const configWallet = require('./config/wallet')
const utilsWallet = require('./utils')

const log = require('./cli-log')

module.exports = {

    // setup RPC server
    rpc_init: async (port) => {
        const portNo = Number(port)
        utilsWallet.logMajor('green','white', `Starting RPC server on port ${portNo}...`, null, { logServerConsole: true })

        const server = jayson.server({
            exec: function(args, callback) {
                callback(null, JSON.stringify(args))
            }
        })

        server.http().listen(port)
    }
}