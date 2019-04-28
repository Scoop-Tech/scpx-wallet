'use strict';

const utilsWallet = require('./utils')

//const chalk = require('chalk')
const colors = require('colors')

module.exports = {

    info: (s, p) => {
        if (p) console.log(`<< ${s.toString().cyan.bold}`, p)
        else   console.log(`<< ${s.toString().cyan.bold}`)
        utilsWallet.log('(cli-log) << ' + s.toString(), p)
    },
    
    warn: (s, p) => {
        if (p) console.log(`!! ${s.toString().red.bold}`, p)
        else   console.log(`!! ${s.toString().red.bold}`)
        utilsWallet.log('(cli-warn) << ' + s.toString(), p)
    },
    
    error: (s, p) => {
        if (p) console.log(`<< ## ${s} ## `.bgRed.white.bold, p)
        else   console.log(`<< ## ${s} ## `.bgRed.white.bold)
        utilsWallet.error('(cli-err) << ' + s.toString(), p)
    },
    
    success: (s, p) => {
        console.log(`---`)
        info(s, p)
    },
    
    debugLogTail: (p) => {
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
}
