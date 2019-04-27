#!/usr/bin/env node
'use strict';

import * as walletActions from './actions'
import * as configWallet from './config/wallet'
import * as configWalletExternal from './config/wallet-external'
import * as appStore from './store'
import * as utilsWallet from './utils'

import * as cliRepl from './cli-repl'
import * as cliWorkers from './svr-workers'
import * as log from './cli-log'

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

// TODO -- add APK to cmdline, optional to auto-load
cli
    .version('0.1.0', '-v, -V, -ver, --version')
    .option('-m, --mpk <optional>', 'the Master Private Key to pass to wallet-load') 
    .option('-a, --apk <optional>', 'the Active Public Key to pass to wallet-load') 
    .parse(process.argv)
// if (!cli.mpk) {
//     console.error(chalk.red('MPK is mandatory'))
//     cli.help()
//     process.exit(1)
// }
// log.info('MPK: OK')

debugger

// setup workers
cliWorkers.workers_init().then(() => {

    // wallet context
    const walletContext = {
        store: appStore.store,
        persistor: appStore.persistor,
        config: {
            wallet: configWallet,
          external: configWalletExternal,
        },
    }

    console.log()
    log.info('JS replServer: type ".help" for available commands, ".wn" for a new wallet, and "w" for dbg context obj\n')

    // launch repl
    cliRepl.repl_init(walletContext)

    //
    // TODO -- separate chatty logs from one-time logs
    //         if server, chatty logs pipe to file (else console, as now)
    //         then new svr cmd to tail or cat the entire log file
    //
    // maybe a dbg cmd to turn this off (and log to screen; repl still works just about)
    //
})

