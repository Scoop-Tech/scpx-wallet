#!/usr/bin/env node --experimental-worker
// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.

const Keygen = require('eosjs-keygen').Keygen

const walletActions = require('./actions')
const configWallet = require('./config/wallet')
const configWalletExternal = require('./config/wallet-external')
const { store: appStore, persistor: appPersistor  } = require('./store')
const utilsWallet = require('./utils')

const cliRepl = require('./cli-repl')
const rpc = require('./sw-rpc')

const svrWorkers = require('./svr-workers')
const svrCreate = require('./svr-wallet/sw-create')
const svrWallet = require('./svr-wallet/sw-wallet')
const svrFilePersist = require('./svr-wallet/sw-file-persist')
const svrServerPersist = require('./svr-wallet/sw-server-persist')

const log = require('./cli-log')
const npmPackage = require('./package.json')

//
// scpx-wallet -- CLI entry point
//
const cli = require('commander')
const chalk = require('chalk')
const clear = require('clear')
const figlet = require('figlet')
const fs = require("fs")

clear()
console.log(chalk.green.bold(figlet.textSync(`scpx-w`, { horizontalLayout: 'fitted', kerning: 'default' })) + "v" + configWallet.WALLET_VER)
console.log()

cli
.version('0.3.0', '-v, -V, -ver, --version')
.option('--mpk <string>', 'Master Private Key: passed to wallet-load (.wl) if --load is also specified, or to wallet-init (.wi) otherwise') 
.option('--loadFile <string>', 'load the specified file wallet: passed to wallet-load (.wl)') 
.option('--loadServer <string>', 'load the specified Data Storage Contract wallet: passed to wallet-server-load (.wsl)') 
.option('--saveHistory <bool>', 'persist CLI history to file (default: false)')
.option('--rpc <bool>', 'enable RPC server (HTTPS)')
.option('--rpcPort <int>', 'RPC port')
.option('--rpcUsername <string>', 'RPC Bearer Auth username')
.option('--rpcPassword <string>', 'RPC Bearer Auth password')
.option('--rpcRemoteHosts <string>', 'RPC allowable remote hosts (comma separated, no wildcards)')
.option('--about', 'about this software')
.parse(process.argv)
if (cli.about) {
    // about
    fs.readFile('./LICENSE.md', 'utf8', (err1, license) => {
        if (err1) throw(`Failed to read license file: ${err1}`)
        utilsWallet.logMajor('green','white', ` This software is licensed under ${npmPackage.license} to you on the following terms. `, null, { logServerConsole: true })
        console.group()
        console.log(license.gray)
        console.groupEnd()

        fs.readFile('./COMPONENTS', 'UCS-2', (err2, components) => {
            if (err2) throw(`Failed to read license file: ${err2}`)
            utilsWallet.logMajor('green','white', ` The following components used by this software under the following licenses. See ./node_modules for their license terms. `, null, { logServerConsole: true })
            console.group()
            console.log(components.gray)
            console.groupEnd()
            process.exit(0)
        })
    })
}
else {
    // main
    utilsWallet.logMajor('green','white', `... scpx-wallet - ${configWallet.WALLET_VER} (${configWallet.WALLET_ENV})  - init ...`, null, { logServerConsole: true })
    console.log(configWallet.WALLET_COPYRIGHT.gray)
    console.log()
    if (process.env.NODE_ENV) log.info('NODE_ENV:', process.env.NODE_ENV)
    if (cli.mpk)              log.info(`cli.mpk:`, cli.mpk)
    if (cli.loadFile)         log.info(`cli.loadFile:`, cli.loadFile)
    if (cli.loadServer)       log.info(`cli.loadServer:`, cli.loadServer)
    if (cli.saveHistory)      log.info(`cli.saveHistory:`, cli.saveHistory)
    if (cli.rpc)              log.info(`cli.rpc:`, cli.rpc)
    if (cli.rpcPort)          log.info(`cli.rpcPort:`, cli.rpcPort)
    if (cli.rpcUsername)      log.info(`cli.rpcUsername:`, cli.rpcUsername)
    if (cli.rpcPassword)      log.info(`cli.rpcPassword:`, cli.rpcPassword)
    if (cli.rpcRemoteHosts)   log.info(`cli.rpcRemoteHosts:`, cli.rpcRemoteHosts)
    
    console.log()

    // loaded wallet (server and file) apk and mpk are cached here (if CLI_SAVE_LOADED_WALLET_KEY is set)
    global.loadedWallet = {}

    // loaded server wallet owner & email are cached here (always)
    global.loadedServerWallet = {}

    utilsWallet.setTitle('')

    // handlers - unhandlded exceptions, and process exit
    if (!configWallet.IS_DEV) {
        process.on('unhandledRejection', (reason, promise) => {
            utilsWallet.error(`## unhandledRejection (CLI) ${reason}`, promise, { logServerConsole: true})
            cleanup()
            process.exit(1)
        })
        process.on('uncaughtException', (err, origin) => {
            utilsWallet.error(`## uncaughtException (CLI) ${err.toString()}`, origin, { logServerConsole: true})
            cleanup()
            process.exit(1)
        })
    }
    process.on('exit', () => cleanup())
    process.on('SIGINT', () => cleanup())
    function cleanup() {
        svrWorkers.terminate()
        rpc.terminate()
    }

    // setup workers
    svrWorkers.init(appStore).then(async () => {

        // wallet context
        const walletContext = {
                store: appStore,
            persistor: appPersistor,
               config: { wallet: configWallet, external: configWalletExternal, },
        }

        // process CLI load cmdline
        if (cli.mpk) { 
            const validationErrors = await svrWallet.validateMpk(cli.mpk)
            if (validationErrors && validationErrors.err) {
                cliRepl.postCmd(prompt, { err: `Validation failed: ${validationErrors.err}` })
            }
            else {
                if (cli.loadServer) {
                    if (cli.loadFile) log.warn('Ignoring duplicate load directive: --loadFile')
                    log.info(`Loading server wallet ${cli.loadServer}...`)
                    svrServerPersist.walletServerLoad(utilsWallet.getAppWorker(), walletContext.store,
                        { mpk: cli.mpk, e: cli.loadServer })
                    .then(res => cliRepl.postCmd(prompt, res))
                }
                else if (cli.loadFile) {
                    log.info(`Loading file wallet ${cli.loadFile}...`)
                    svrFilePersist.walletFileLoad(utilsWallet.getAppWorker(), walletContext.store,
                        { mpk: cli.mpk, n: cli.loadFile })
                    .then(res => cliRepl.postCmd(prompt, res))
                }
                else {
                    log.info('Initializing wallet...')
                    svrCreate.walletInit(utilsWallet.getAppWorker(), walletContext.store,
                        { mpk: cli.mpk })
                    .then(res => cliRepl.postCmd(prompt, res))
                }
            }
        }

        // process RPC cmdline  
        if (cli.rpc) {
            rpc.init(cli.rpcPort, cli.rpcUsername, cli.rpcPassword, cli.rpcRemoteHosts)
        }
        // if (cli.rpctest) {
        //     const jayson = require('jayson')
        //     console.log('rpcTestClient: init...')
        //     const client = jayson.client.http({ port: 4000 })
        //     client.request('exec', ['dom', {a: 42, b: 'asd'} ], function(err, response) {
        //         if(err) throw err
        //         console.log(`rpcTestClient: exec response - ${response.result}`)
        //     })
        // }

        // launch repl
        console.log()
        log.info('Type ".help" for available commands, ".wn" for a new wallet, and "w" for dbg context obj. Ctrl+C to exit.\n')
        const prompt = cliRepl.init(walletContext, cli.saveHistory)
    })
}