'use strict';

const utilsWallet = require('./utils')

//const chalk = require('chalk')
const colors = require('colors')

module.exports = {

    info: (s, p) => {
        if (p) console.log(`<< ${s.toString().cyan.bold}`, p)
        else   console.log(`<< ${s.toString().cyan.bold}`)
        //utilsWallet.log('(cli-log) << ' + s.toString(), p)
    },
    
    warn: (s, p) => {
        if (p) console.log(`<< ${s.toString().red.bold}`, p)
        else   console.log(`<< ${s.toString().red.bold}`)
        //utilsWallet.log('(cli-warn) << ' + s.toString(), p)
    },
    
    error: (s, p) => {
        if (p) console.log(`<< ## ${s} ## `.bgRed.white.bold, p)
        else   console.log(`<< ## ${s} ## `.bgRed.white.bold)
        //utilsWallet.error('(cli-err) << ' + s.toString(), p)
    },
    
    success: (s, p) => {
        console.log(`---`)
        module.exports.info(s, p)
    },
    
    logTail: (store, p) => {
        var { n, debug } = p
        if (!n || !Number.isInteger(Number(n))) n = 100
        module.exports.info(`    n: ${n} (param)`)
        const logDebug = utilsWallet.isParamTrue(debug)
        module.exports.info(`debug: ${logDebug} (param)`)
    
        const readLastLines = require('read-last-lines')
        const readOp = logDebug
            ? readLastLines.read('./debug.log', n)
            : readLastLines.read('./info.log', n)
        
        return readOp.then((lines) => { 
            console.log(lines)
            return new Promise((resolve) => {
                resolve({ ok: true })
            })
        })
    }
}
