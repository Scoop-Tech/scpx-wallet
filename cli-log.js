'use strict';

//const chalk = require('chalk')
var colors = require('colors')

export function info(s, p) {
    if (p)
        console.log(`<< ${s.toString().cyan.bold}`, p)
    else
        console.log(`<< ${s.toString().cyan.bold}`)
}
export function dir(o) {
    console.dir(o)
}

export function error(s, p) {
    if (p)
        console.log(`<< ## ${s} ## `.bgRed.white, p)
    else
        console.log(`<< ## ${s} ## `.bgRed.white)
}
export function success(s, p) {
    console.log(`---`)
    info(s, p)
    // if (p)
    //     console.log(`< ${s} `.bgGreen.white.bold, p)
    // else
    //     console.log(`< ${s} `.bgGreen.white.bold)
}