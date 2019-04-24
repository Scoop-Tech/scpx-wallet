#!/usr/bin/env node
'use strict';

import * as walletActions from './actions'
import * as configWallet from './config/wallet'
import * as configWalletExternal from './config/wallet-external'
import * as appStore from './store'
import * as utilsWallet from './utils'

import * as cliRepl from './cli-repl'
import * as cliWorkers from './cli-workers' 

//
// scpx-wallet -- CLI entry point
//
const cli = require('commander')
const chalk = require('chalk')
const clear = require('clear')
const figlet = require('figlet')

//clear()
console.log(chalk.green(figlet.textSync(`scpx-w`, { horizontalLayout: 'full' })))
console.log(chalk.green(` ... ScoopWallet v-${configWallet.WALLET_VER} [${configWallet.WALLET_ENV}] ...`))

cli
.version('0.1.0', '-v, -V, -ver, --version')
.option('-m, --mpk <required>','the Master Private Key to initialize')
.parse(process.argv)
if (!cli.mpk) {
    console.error(chalk.red('MPK is mandatory'))
    cli.help()
    process.exit(1)
}
console.log(chalk.green('MPK: OK'))

// setup workers
cliWorkers.workers_init() // todo - want pause until all are setup ...

// wallet context
const walletContext = {
    cpuWorkers: utilsWallet.cpuWorkers,
         store: appStore.store, 
     persistor: appStore.persistor,
        config: {
            wallet: configWallet,
          external: configWalletExternal,
    },
}

console.log(chalk.blue('waiting'))

// launch repl
setTimeout(() => {
    cliRepl.repl_init(walletContext)
}, 2000)

// todo -- create fn .wallet-load, taking in PT key, email, etc. 




