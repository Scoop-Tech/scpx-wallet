'use strict';

const chalk = require('chalk')

export function info(s) {
    console.log(chalk.cyan.bold(s))
}
export function dir(o) {
    console.dir(o)
}

export function error(s) {
    console.log(chalk.white.bgRed.bold(` ## ${s} ## `))
}
export function success(s) {
    console.log(chalk.white.bgGreen.bold(` ${s} `))
}