#!/usr/bin/env node
'use strict';

import * as walletActions from './actions'
import * as configWallet from './config/wallet'
import * as configWalletExternal from './config/wallet-external'
import * as appStore from './store'
import * as utilsWallet from './utils'

import * as cliRepl from './cli-repl'
import * as cliWorkers from './svr-workers'
import * as svrWallet from './svr-wallet'
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

// setup workers
cliWorkers.workers_init(appStore.store).then(() => {

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
    log.info('Type ".help" for available commands, ".wn" for a new wallet, and "w" for dbg context obj. Ctrl+C to exit.\n')

    // launch repl
    const prompt = cliRepl.repl_init(walletContext)

    // load from cmdline, if specified
    if (cli.mpk && cli.apk) {
        if (cli.mpk.length >= 53 && cli.apk.length >= 53) {
            svrWallet.walletLoad(walletContext.store, { apk: cli.apk, mpk: cli.mpk }).then(res => cliRepl.postCmd(prompt, res))
        }
    }
})

