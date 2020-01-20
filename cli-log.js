// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2020 Dominic Morris.

const utilsWallet = require('./utils')

//const chalk = require('chalk')
const colors = require('colors')

module.exports = {

    param: (name, value, source) => {
        console.log(`<< ${name.toString().padEnd(15, '.').cyan.bold} ${(source||'').padEnd(15, '.')}: ${value}`)
    },

    cmd: (s, p) => {
        if (p) console.log(`\n<< ${s.toString().bgCyan.white.bold}`, p)
        else   console.log(`\n<< ${s.toString().bgCyan.white.bold}`)
    },

    info: (s, p) => {
        if (p) console.log(`<< ${s.toString().cyan.bold}`, p)
        else   console.log(`<< ${s.toString().cyan.bold}`)
        //utilsWallet.log('(cli-log) << ' + s.toString(), p)
    },
    
    warn: (s, p) => {
        if (p) console.log(`<< ${'WARNING'.yellow.bold.underline + ' '  + s.toString().yellow.bold}`, p)
        else   console.log(`<< ${'WARNING'.yellow.bold.underline + ' '  + s.toString().yellow.bold}`)
    },
    
    error: (s, p) => {
        if (p) console.log(`<< ${' FAIL '.bgRed.white.bold + ' '  + s.toString().red.bold.underline}`, p)
        else   console.log(`<< ${' FAIL '.bgRed.white.bold + ' '  + s.toString().red.bold.underline}`)
    },
    
    success: (s, p) => {
        if (p) console.log(`<< ${' OK '.bgGreen.white.bold + ' '  + s.toString().cyan.bold}`, p)
        else   console.log(`<< ${' OK '.bgGreen.white.bold + ' '  + s.toString().cyan.bold}`)
    },
    
    logTail: (appWorker, store, p) => {
        var { lines, debug } = p
        if (!lines || !Number.isInteger(Number(lines))) lines = 100
        lines *= 2 // some double \n somewhere somehow
        const logDebug = utilsWallet.isParamTrue(debug)
    
        const readLastLines = require('read-last-lines')
        const readOp = logDebug
            ? readLastLines.read('./debug.log', lines)
            : readLastLines.read('./info.log', lines)
        
        return readOp.then((lines) => { 
            console.log(lines)
            return new Promise((resolve) => {
                resolve({ ok: true })
            })
        })
    }
}
