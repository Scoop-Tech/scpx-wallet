#!/usr/bin/env node
'use strict';

import { store, persistor } from './store'

import * as walletActions from './actions'
import * as configWallet from './config/wallet'
import * as configWalletExternal from './config/wallet-external'

//
// scpx-wallet -- CLI entry point
//
const cli = require('commander')
const chalk = require('chalk')
const clear = require('clear')
const figlet = require('figlet')
const repl = require('repl')

//clear()
console.log(chalk.green(figlet.textSync('scpx-w 0.2', { horizontalLayout: 'full' })))

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

// top level object - for inspection on console
const w = { 
    store, 
    persistor,
    config: {
        wallet: configWallet,
        walletExternal: configWalletExternal,
    },
}

//
// step 1 - wallet-gen fn's here (static only - no 3pbp updates yet)
//
//  done: create new store object for server -- just has the wallet reducer under root --- no persistence needed at all (all in-mem)
//
//  TODO: move wallet **actions** to server - switch on store to use via param for dispatching: prep done, ready to move 
//      .... RETEST ALL FIRST, esp. ETH ....
//
//  todo: generateWallets moves to here: store is passed in (either server store or client store), actions are the same
//
// == in-memory wallet store (raw & displayable assets)
//
// step 2 - 3pbp updates on server wallet store ...
//

store.dispatch({ type: walletActions.WCORE_SET_ASSETS_RAW, payload: 'asd5____' })
console.dir(w.store.getState())


const r = repl.start({ 
    useGlobal: true,
    useColors: true,
    terminal: true,
    prompt: '> ',
}).context.w = w




