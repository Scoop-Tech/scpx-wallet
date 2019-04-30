#!/usr/bin/env node --experimental-worker
'use strict';

// todo -- minimum viable set for launch ...
//         .waa (wallet add addr) -- server, no limits
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
const log = require('./cli-log')

//
// scpx-wallet -- CLI entry point
//
const cli = require('commander')
const chalk = require('chalk')
const clear = require('clear')
const figlet = require('figlet')

clear()
console.log(chalk.green.bold(figlet.textSync(`scpx-w`, { horizontalLayout: 'fitted', kerning: 'default' })) + "v" + configWallet.WALLET_VER)
console.log()
utilsWallet.logMajor('green','white', `... scpx-w - ${configWallet.WALLET_VER} (${configWallet.WALLET_ENV})  - init ...`, null, { logServerConsole: true })
console.log()

cli
.version('0.3.0', '-v, -V, -ver, --version')
.option('-m, --mpk <optional: string>', 'the Master Private Key to pass to wallet-load') 
.option('-a, --apk <optional: string>', 'the Active Public Key to pass to wallet-load') 
.option('-h, --fileHistory <optional: bool, default "false">', 'persist CLI history to file (includes sensitive data)') 
.parse(process.argv)

if (cli.mpk)         log.info(`cli.mpk: ${cli.mpk}`)
if (cli.apk)         log.info(`cli.apk: ${cli.apk}`)
if (cli.fileHistory) log.info(`cli.fileHistory: ${cli.fileHistory}`)
console.log()

// error handlers
process.on('unhandledRejection', (reason, promise) => {
    debugger
    utilsWallet.error(`## unhandledRejection ${reason}`, promise, { logServerConsole: true})
})
process.on('uncaughtException', (err, origin) => {
    debugger
    utilsWallet.error(`## uncaughtException ${reason}`, promise, { logServerConsole: true})
})


// setup workers
cliWorkers.workers_init(appStore.store).then(() => {

    // loaded wallet apk and mpk are cached here (CLI_SAVE_LOADED_WALLET_KEYS)
    global.loadedWalletKeys = {} 

    // wallet context
    const walletContext = {
            store: appStore.store,
        persistor: appStore.persistor,
           config: { wallet: configWallet,
                   external: configWalletExternal,
        },
    }

    console.log()
    log.info('Type ".help" for available commands, ".wn" for a new wallet, and "w" for dbg context obj. Ctrl+C to exit.\n')

    // launch repl
    const prompt = cliRepl.repl_init(walletContext, cli.fileHistory)

    // load from cmdline, if specified
    if (cli.mpk && cli.apk) {
        if (cli.mpk.length >= 53 && cli.apk.length >= 53) {
            log.info('Loading supplied wallet...')
            swCreate.walletInit(walletContext.store, { apk: cli.apk, mpk: cli.mpk }).then(res => cliRepl.postCmd(prompt, res))
        }
    }
})

