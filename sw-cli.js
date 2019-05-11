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
.option('-m, --mpk <string>', 'Master Private Key: passed to wallet-load (.wl) if --load is also specified, or to wallet-init (.wi) otherwise') 
.option('-f, --loadFile <string>', 'load the specified file wallet: passed to wallet-load (.wl)') 
.option('-f, --loadServer <string>', 'load the specified Data Storage Contract wallet: passed to wallet-server-load (.wsl)') 
.option('-h, --saveHistory <bool>', 'persist CLI history to file (default: false)')
.option('-r, --rpc <port>', 'enable RPC server on specified port')
.option('-c, --rpctest <bool>', 'run rpctest')
.option('--about', 'about this software')
.parse(process.argv)
if (cli.about) {
    // about
    fs.readFile('./LICENSE.md', 'utf8', (err1, license) => {
        if (err1) throw(`Failed to read license file: ${err1}`)
        utilsWallet.logMajor('green','white', ` This software is licensed (${npmPackage.license}) to you under the following terms. `, null, { logServerConsole: true })
        console.group()
        console.log(license.gray)
        console.groupEnd()

        fs.readFile('./COMPONENTS', 'UCS-2', (err2, components) => {
            if (err2) throw(`Failed to read license file: ${err2}`)
            utilsWallet.logMajor('green','white', ` The following components and licenses are used by this software. See ./node_modules for their terms. `, null, { logServerConsole: true })
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
    if (cli.rpctest)          log.info(`cli.rpctest:`, cli.rpctest)
    
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
            svrWorkers.workers_terminate()
            process.exit(1)
        })
        process.on('uncaughtException', (err, origin) => {
            utilsWallet.error(`## uncaughtException (CLI) ${err.toString()}`, origin, { logServerConsole: true})
            svrWorkers.workers_terminate()
            process.exit(1)
        })
    }
    process.on('exit', () => svrWorkers.workers_terminate())
    process.on('SIGINT', () => svrWorkers.workers_terminate())

    // setup workers
    svrWorkers.workers_init(appStore).then(async () => {

        // wallet context
        const walletContext = {
                store: appStore,
            persistor: appPersistor,
               config: { wallet: configWallet, external: configWalletExternal, },
        }

        // process cmdline 
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

        if (cli.rpc) {
            if (cli.rpc >= 1024 && cli.rpc <= 65535) {
                rpc.rpc_init(cli.rpc)
            }
            else {
                log.err(`Invalid RPC port ${cli.rpc} - specify a port between 1024 and 65535`)
            }
        }

        if (cli.rpctest) {
            const jayson = require('jayson')
            console.log('rpcTestClient: init...')
            const client = jayson.client.http({ port: 4000 })
            client.request('exec', ['dom', {a: 42, b: 'asd'} ], function(err, response) {
                if(err) throw err
                console.log(`rpcTestClient: exec response - ${response.result}`)
            })
        }

        // launch repl
        console.log()
        log.info('Type ".help" for available commands, ".wn" for a new wallet, and "w" for dbg context obj. Ctrl+C to exit.\n')
        const prompt = cliRepl.repl_init(walletContext, cli.saveHistory)
    })
}