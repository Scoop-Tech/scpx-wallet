'use strict';

import * as utilsWallet from './utils'

//const chalk = require('chalk')
var colors = require('colors')

export function info(s, p) {
    if (p)
        console.log(`<< ${s.toString().cyan.bold}`, p)
    else
        console.log(`<< ${s.toString().cyan.bold}`)

    utilsWallet.log('(cli-log) << ' + s.toString(), p)
}

export function error(s, p) {
    if (p)
        console.log(`<< ## ${s} ## `.bgRed.white.bold, p)
    else
        console.log(`<< ## ${s} ## `.bgRed.white.bold)

    utilsWallet.error('(cli-log) << ' + s.toString(), p)
}

export function success(s, p) {
    console.log(`---`)
    info(s, p)
}

export function debugLogTail(p) {
    var { n } = p
    if (!n || !Number.isInteger(Number(n))) n = 100
    info(`n: ${n} (param)`)

    const readLastLines = require('read-last-lines')
    return readLastLines.read('./debug.log', n)
    .then((lines) => { 
        console.log(lines)
        return new Promise((resolve) => {
            resolve({ ok: true })
        })
    })
}