#!/usr/bin/env node
'use strict';

import * as walletActions from './actions'
import * as configWallet from './config/wallet'
import * as configWalletExternal from './config/wallet-external'
import * as appStore from './store'
import * as utilsWallet from './utils'

import * as cliRepl from './cli-repl'
import * as cliWorkers from './cli-workers' 
import * as log from './cli-log'

//
// scpx-wallet -- CLI entry point
//
const cli = require('commander')
const chalk = require('chalk')
const clear = require('clear')
const figlet = require('figlet')

// if (process.stdout._handle) { 
//     process.stdout._handle.setBlocking(true)
//     log.info('set stdout sync')
// }
//require("console-sync") // patch console for sync

//clear()
console.log(chalk.green.bold(figlet.textSync(`scpx-w`, { horizontalLayout: 'full' })))
log.info(chalk.white.bgGreen.bold(` ... ScoopWallet v-${configWallet.WALLET_VER} [${configWallet.WALLET_ENV}] ... `))

cli
.version('0.1.0', '-v, -V, -ver, --version')
.option('-m, --mpk <required>','the Master Private Key to initialize') // TODO -- add APK to cmdline, optional to auto-load
.parse(process.argv)
// if (!cli.mpk) {
//     console.error(chalk.red('MPK is mandatory'))
//     cli.help()
//     process.exit(1)
// }
// log.info('MPK: OK')

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

    log.info('JS replServer: type .help for available commands\n')

    // launch repl
    cliRepl.repl_init(walletContext)

})





