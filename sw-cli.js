#!/usr/bin/env node 
// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2025 Dominic Morris.

const Keygen = require('eosjs-keygen').Keygen

const walletActions = require('./actions')
const configWallet = require('./config/wallet')
const configWalletExternal = require('./config/wallet-external')
const { store: appStore, persistor: appPersistor  } = require('./store')
const utilsWallet = require('./utils')

const cliRepl = require('./sw-cli-repl')
const rpc = require('./sw-rpc')

const svrWorkers = require('./svr-workers')
const svrCreate = require('./svr-wallet/sw-create')
const svrWallet = require('./svr-wallet/sw-router')
const svrFilePersist = require('./svr-wallet/sw-file-persist')
const svrServerPersist = require('./svr-wallet/sw-server-persist')

const log = require('./sw-cli-log')
const npmPackage = require('./package.json')

//
// scpx-wallet -- CLI entry point
//
const cli = require('commander')
const chalk = require('chalk')
const clear = require('clear')
const figlet = require('figlet')
const fs = require("fs")

cli
    .option('--mpk <string>', 'Master Private Key: passed to wallet-load (./wl) if --load is also specified, or to wallet-init (./wi) otherwise') 
    .option('--loadFile <string>', 'load the specified file wallet: passed to wallet-load (./wl)') 
    .option('--loadServer <string>', 'load the specified Data Storage Contract wallet: passed to wallet-server-load (./wsl)') 
    .option('--saveHistory <bool>', 'persist CLI history to file (default: false)')
    .option('--rpc <bool>', 'enable RPC server (HTTPS)')
    .option('--rpcPort <int>', 'RPC port')
    .option('--rpcUsername <string>', 'RPC username')
    .option('--rpcPassword <string>', 'RPC password')
    .option('--rpcRemoteHosts <string>', 'RPC allowable remote hosts (comma separated, no wildcards)')
    .option('--about', 'about this software')
    .option('--v', 'display software version')
    .parse(process.argv)
    if (cli.about) {
        console.log('about...')
        utilsWallet.logMajor('green','white', `About...`, null, { logServerConsole: true })
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
    else if (cli.v) {
        console.log(configWallet.WALLET_VER)
        process.exit(0)
        return
    }

//
// main
//
clear()
console.log(chalk.green.bold(figlet.textSync(`scpx-w`, { horizontalLayout: 'fitted', kerning: 'default' })) + "v" + configWallet.WALLET_VER)
console.log()
utilsWallet.logMajor('green','white', `... scpx-wallet - ${configWallet.WALLET_VER} (${configWallet.WALLET_ENV})  - init ...`, null, { logServerConsole: true })
console.log(configWallet.WALLET_COPYRIGHT.gray)
console.log()
console.log(`${process.title} ${process.version}`)
log.info('NODE_ENV:'.padEnd(30), process.env.NODE_ENV || '-')
log.info('configWallet.IS_TEST:'.padEnd(30), configWallet.IS_TEST || '-')
log.info('configWallet.IS_DEV:'.padEnd(30), configWallet.IS_DEV || '-')
log.info('configWallet.CLI_SAVE_KEY:'.padEnd(30), configWallet.CLI_SAVE_KEY || '-')
if (cli.mpk)              log.info(`cli.mpk:`.padEnd(30), cli.mpk)
if (cli.loadFile)         log.info(`cli.loadFile:`.padEnd(30), cli.loadFile)
if (cli.loadServer)       log.info(`cli.loadServer:`.padEnd(30), cli.loadServer)
if (cli.saveHistory)      log.info(`cli.saveHistory:`.padEnd(30), cli.saveHistory)
if (cli.rpc)              log.info(`cli.rpc:`.padEnd(30), cli.rpc)
if (cli.rpcPort)          log.info(`cli.rpcPort:`.padEnd(30), cli.rpcPort)
if (cli.rpcUsername)      log.info(`cli.rpcUsername:`.padEnd(30), cli.rpcUsername)
if (cli.rpcPassword)      log.info(`cli.rpcPassword:`.padEnd(30), cli.rpcPassword)
if (cli.rpcRemoteHosts)   log.info(`cli.rpcRemoteHosts:`.padEnd(30), cli.rpcRemoteHosts)
console.log()

// loaded wallet (server and file) apk and mpk are cached here (if CLI_SAVE_KEY is set)
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

    // process RPC cmdline  
    if (cli.rpc) {
        if ((await rpc.init(cli.rpcPort, cli.rpcUsername, cli.rpcPassword, cli.rpcRemoteHosts)) == true) {
            configWallet.set_RPC_MODE(true)
        }
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

    // process CLI load cmdline
    if (cli.mpk) { 
        const validationErrors = await svrWallet.validateMpk(cli.mpk)
        if (validationErrors && validationErrors.err) {
            cliRepl.postCmd(prompt, { err: `Validation failed: ${validationErrors.err}` })
        }
    }
    if (cli.loadServer) {
        if (!cli.mpk) log.error('--mpk is required for --loadServer')
        else {
            if (cli.loadFile) log.warn('Ignoring duplicate load directive: --loadFile')
            log.info(`Loading server wallet ${cli.loadServer}...`)
            svrServerPersist.walletServerLoad(utilsWallet.getAppWorker(), walletContext.store,
                { mpk: cli.mpk, email: cli.loadServer })
            .then(res => cliRepl.postCmd(prompt, res))
        }
    }
    else if (cli.loadFile) {
        if (!cli.mpk) log.error('--mpk is required for --loadFile')
        else {
            log.info(`Loading file wallet ${cli.loadFile}...`)
            svrFilePersist.walletFileLoad(utilsWallet.getAppWorker(), walletContext.store,
                { mpk: cli.mpk, name: cli.loadFile })
            .then(res => cliRepl.postCmd(prompt, res))
        }
    }
    else {
        if (cli.mpk) {
            if (utilsWallet.isParamEmpty(cli.mpk)) log.error('--mpk is required for --loadFile')
            log.info('Initializing wallet...')
            svrCreate.walletInit(utilsWallet.getAppWorker(), walletContext.store,
                { mpk: cli.mpk })
            .then(res => cliRepl.postCmd(prompt, res))
        }
    }

    // launch REPL
    console.log()
    log.info('Type ".help" for available commands, "./wn" for a new wallet, and "w" for dbg context obj. Ctrl+C to exit.\n')
    const prompt = cliRepl.init(walletContext, cli.saveHistory)
})