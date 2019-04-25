'use strict';

const repl = require('repl')

import * as appStore from './store'
import * as utilsWallet from './utils'

import * as log from './cli-log'
import * as svrWallet from './svr-wallet'

export function repl_init(walletContext) {

    // init repl
    const colors = { RED: "31", GREEN: "32", YELLOW: "33", BLUE: "34", MAGENTA: "35" }
    const colorize = (color, s) => `\x1b[${color}m${s}\x1b[0m`
    const say = message => () => console.log(message)
    const nodeVersion = colorize(colors.GREEN, `${process.title} ${process.version}`)
    const prompt = repl.start({
        terminal: true,
        historySize: 100,
        removeHistoryDuplicates: true,
        useGlobal: true,
        useColors: true,
        prompt: `${nodeVersion} SW-CLI > `,
    })
    prompt.context.w = walletContext

    // custom commands
    delete prompt.commands.save
    delete prompt.commands.break
    delete prompt.commands.clear
    delete prompt.commands.load
    delete prompt.commands.editor

    const helpBanner = ''//NOTE: scpx-w commands and arguments are case-sensitive'

    // wallet-new, new random MPK
    const walletNewHelp = `${helpBanner}\n` +
        `\tcmd: .wn (wallet-new) - creates and persists in-memory a new scoop wallet, from new random seed values\n`
    prompt.defineCommand("wn", {
        help: walletNewHelp,
        action: function (args) {
            this.clearBufferedCommand()
            var argv = require('minimist')(args.split(' '))
            svrWallet.newWallet(walletContext.store, argv).then(res => {
                setTimeout(() => {
                    if (res.err) {
                        log.error(res.err)
                        //log.info(walletNewHelp)
                    }
                    else {
                        log.success(`(wallet-new OK) - you can load this wallet (.wl) at any time with:\n${JSON.stringify(res.ok, null, 2)}`)
                    }
                    this.displayPrompt()
                }, 100) // https://github.com/nodejs/node/issues/11568
            })
        }
    })

    // wallet-load, by supplied MPK
    const walletLoadHelp = `${helpBanner}\n` +
        `\tcmd: .wl (wallet-load) - recreates and persists in-memory a scoop wallet, from supplied seed values\n` +
        `\targ: --mpk=<master private key>\t\t[required]\tentropy for sub-asset keys generation, and redux store (L1) encryption\n` +
        `\targ: --apk=<active public key>\t\t[required]\tsalt value for redux store (L1) encryption\n`
    prompt.defineCommand("wl", {
        help: walletLoadHelp,
        action: function (args) {
            this.clearBufferedCommand()
            var argv = require('minimist')(args.split(' '))
            svrWallet.loadWallet(walletContext.store, argv).then(res => {
                setTimeout(() => {
                    if (res.err) {
                        log.error(res.err)
                        log.info(walletLoadHelp)
                    }
                    else {
                        log.success(`(wallet-load OK) - you can reload this wallet (.wl) at any time with:\n${JSON.stringify(res.ok, null, 2)}`)
                    }
                    this.displayPrompt()
                }, 100)
            })
        }
    })

    // wallet-dump, decrypt & dump values from redux store
    const walletDumpHelp = `${helpBanner}\n` +
        `\tcmd: .wd (wallet-dump) - decrypts and dumps sub-asset key and addresses values from the loaded scoop wallet\n` +
        `\targ: --mpk=<master private key>\t\t[required]\tentropy for redux store (L1) decryption\n` +
        `\targ: --apk=<active public key>\t\t[required]\tsalt value for redux store (L1) decryption\n`
    prompt.defineCommand("wd", {
        help: walletDumpHelp,
        action: function (args) {
            this.clearBufferedCommand()
            var argv = require('minimist')(args.split(' '))
            svrWallet.dumpWallet(walletContext.store, argv).then(res => {
                setTimeout(() => {
                    if (res.err) {
                        log.error(res.err)
                        log.info(walletLoadHelp)
                    }
                    else {
                        log.success(`(wallet-dump OK) - values:\n${JSON.stringify(res.ok, null, 2)}`)
                    }
                    this.displayPrompt()
                }, 100)
            })
        }
    })

    // dbg: dump store state
    prompt.defineCommand("dss", {
        help: "dbg - dump redux store state",
        action: function (args) {
            this.clearBufferedCommand()
            console.dir(appStore.store.getState())
            this.displayPrompt()
        }
    })

    // dbg: test web3
    // prompt.defineCommand("dt1", {
    //     help: "dbg - test web3",
    //     action: function (args) {
    //         this.clearBufferedCommand()
    //         const globalScope = utilsWallet.getMainThreadGlobalScope()
    //         globalScope.cpuWorkers[0].postMessage({ msg: 'TEST_WEB3', data: {} })
    //         globalScope.cpuWorkers[0].once('message', (data) => {
    //             log.info('ok', data)
    //         })
    //         this.displayPrompt()
    //     }
    // })

    // // dbg: test tx db from worker
    // prompt.defineCommand("dt2", {
    //     help: "dbg - test tx db",
    //     action: function (args) {
    //         this.clearBufferedCommand()
    //         const globalScope = utilsWallet.getMainThreadGlobalScope()
    //         globalScope.cpuWorkers[0].postMessage({ msg: 'TEST_TXDB', data: {} })
    //         globalScope.cpuWorkers[0].once('message', (data) => {
    //             log.info('ok', data)
    //         })
    //         this.displayPrompt()
    //     }
    // })

    const sayBye = say(`Goodbye!`)
    prompt.on("exit", sayBye)
}