#!/usr/bin/env node
'use strict';

//
// scpx-wallet -- CLI entry point
//
const cli = require('commander')
const chalk = require('chalk')
const clear = require('clear')
const figlet = require('figlet')

const files = require('./lib/files')

clear()
console.log(chalk.green(figlet.textSync('scpx-w 0.1', { horizontalLayout: 'full' })))

cli
.version('0.1.0', '-v, -V, -ver, --version')
.option('-m, --mpk <required>','the Master Private Key to initialize')
.parse(process.argv)
if (cli.args.length === 0) { 
    cli.help()
    process.exit(1)
}

if (cli.mpk) {
    console.log(chalk.green('MPK: OK'))
}
else {
    console.error(chalk.red('MPK is mandatory'))
    process.exit(1)
}