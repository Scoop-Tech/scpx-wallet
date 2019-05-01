#!/usr/bin/env node --experimental-worker
// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.

// todo -- minimum viable set for launch ...
//         .ws  (wallet save) -- to file, binary enc'd dump (instead of api/eos)
//         .wl  (wallet load) -- from file (==> curent .wl becomes wallet-init)
//         .wtx (wallet tx)

// then -- optional, .wl from eos (w/ imported & added addr's)

const walletActions = require('./actions')
const configWallet = require('./config/wallet')
const configWalletExternal = require('./config/wallet-external')
const appStore = require('./store')
const utilsWallet = require('./utils')

const cliRepl = require('./cli-repl')
const cliWorkers = require('./svr-workers')
const swCreate = require('./svr-wallet/sw-create')
const swWallet = require('./svr-wallet/sw-wallet')
const swPersist = require('./svr-wallet/sw-persist')
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
.option('-a, --apk <string>', 'Active Public Key: passed to wallet-load (.wl) if --load is also specified, or to wallet-init (.wi) otherwise') 
.option('-f, --loadFile <string>', 'wallet filename: passed to wallet.load (.wl)') 
.option('-h, --saveHistory <bool>', 'persist CLI history to file (default: false)') 
.option('--about', 'about this software') 
.parse(process.argv)
if (cli.about) {
    // about
    fs.readFile('./LICENSE.md', 'utf8', (err1, license) => {
        if (err1) throw(`Failed to read license file: ${err1}`)
        utilsWallet.logMajor('green','white', ` This software is licensed (${npmPackage.license}) to you under the following terms. \n`, null, { logServerConsole: true })
        console.group()
        console.log(license.gray)
        console.groupEnd()

        fs.readFile('./COMPONENTS', 'UCS-2', (err2, components) => {
            if (err2) throw(`Failed to read license file: ${err2}`)
            utilsWallet.logMajor('green','white', ` The following components and licenses are used by this software. See ./node_modules for their terms. \n`, null, { logServerConsole: true })
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
    if (cli.mpk)         log.info(`cli.mpk: ${cli.mpk}`)
    if (cli.apk)         log.info(`cli.apk: ${cli.apk}`)
    if (cli.loadFile)    log.info(`cli.loadFile: ${cli.loadFile}`)
    if (cli.saveHistory) log.info(`cli.saveHistory: ${cli.saveHistory}`)
    console.log()

    // error handlers
    process.on('unhandledRejection', (reason, promise) => {
        utilsWallet.error(`## unhandledRejection ${reason}`, promise, { logServerConsole: true})
    })
    process.on('uncaughtException', (err, origin) => {
        utilsWallet.error(`## uncaughtException ${err.toString()}`, origin, { logServerConsole: true})
    })

    // setup workers
    cliWorkers.workers_init(appStore.store).then(async () => {

        // loaded wallet apk and mpk are cached here (CLI_SAVE_LOADED_WALLET_KEYS)
        global.loadedWalletKeys = {} 

        // wallet context
        const walletContext = {
                store: appStore.store,
            persistor: appStore.persistor,
               config: { wallet: configWallet, external: configWalletExternal, },
        }

        // launch repl
        console.log()
        log.info('Type ".help" for available commands, ".wn" for a new wallet, and "w" for dbg context obj. Ctrl+C to exit.\n')
        const prompt = cliRepl.repl_init(walletContext, cli.saveHistory)

        // init or load from cmdline, if specified
        if (cli.mpk && cli.apk) {
            const validationErrors = await swWallet.validateMpkApk(cli.mpk, cli.apk)
            if (validationErrors && validationErrors.err) {
                cliRepl.postCmd(prompt, { err: `Validation failed: ${validationErrors.err}` })
            }
            else {
                if (cli.loadFile) {
                    log.info(`Loading supplied ${cli.loadFile}...`)
                    const globalScope = utilsWallet.getMainThreadGlobalScope()
                    swPersist.walletLoad(globalScope.appWorker, walletContext.store,
                        { apk: cli.apk, mpk: cli.mpk, n: cli.loadFile })
                    .then(res => cliRepl.postCmd(prompt, res))
                }
                else {
                    log.info('Initializing supplied wallet...')
                    swCreate.walletInit(walletContext.store,
                        { apk: cli.apk, mpk: cli.mpk })
                    .then(res => cliRepl.postCmd(prompt, res))
                }
            }
        }
    })
}