'use strict';

const repl = require('repl')

import * as appStore from './store'
import * as utilsWallet from './utils'

import * as log from './cli-log'
import * as svrWallet from './svr-wallet'
import * as svrWorkers from './svr-workers'

export function repl_init(walletContext) {

    const readline = require('readline');
    readline.emitKeypressEvents(process.stdin);
    //process.stdin.setRawMode(true);
    process.stdin.on('keypress', (str, key) => {
        // ... scan for some magic keypress -- to TOGGLE overlay/ontop blessed, which has logging piped to it ...
        
        // if (key.ctrl && key.name === 'c') {
        //     process.exit();
        // } else {
        //     console.log(`You pressed the "${str}" key`);
        //     console.log();
        //     console.log(key);
        //     console.log();
        // }
    });

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
                        log.success(`(wallet-new OK) - you can load this wallet (.wl) with:\n${JSON.stringify(res.ok, null, 2)}`)
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
                        log.success(`(wallet-load OK) - you can reload this wallet (.wl) with:\n${JSON.stringify(res.ok, null, 2)}`)
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
                        log.success(`(wallet-dump OK)\n${JSON.stringify(res.ok, null, 2)}`)
                    }
                    this.displayPrompt()
                }, 100)
            })
        }
    })

    // todo - tail no follow + tail debug or info logs

    // tail-log, show last n lines of verbose (debug) log
    const tailLogHelp = `${helpBanner}\n` +
    `\tcmd: .tl (tail-log) - tails (but doesn't follow) the last n lines of the debug log \n` +
    `\targ: --n=<num_lines>\t\t[optional - default 100]\tnumber of lines to tail\n` +
    prompt.defineCommand("tl", {
        help: tailLogHelp,
        action: function (args) {
            this.clearBufferedCommand()
            var argv = require('minimist')(args.split(' '))
            log.tailDebugLog(argv).then(res => {
                setTimeout(() => {
                    if (res.err) {
                        log.error(res.err)
                        log.info(walletLoadHelp)
                    }
                    else {
                        log.success(`(tail-log OK)\n${JSON.stringify(res.ok, null, 2)}`)
                    }
                    this.displayPrompt()
                }, 100)
            })
        }
    })

    // dbg: test tx db from worker
    prompt.defineCommand("dt3", {
        help: "dbg - initSockets_LoadAssets",
        action: function (args) {
            this.clearBufferedCommand()
            svrWorkers.initSockets_LoadAssets().then(res => {
                setTimeout(() => {
                    if (res.err) {
                        log.error(res.err)
                        log.info(walletLoadHelp)
                    }
                    else {
                        log.success(`(initSockets_LoadAssets OK)\n${JSON.stringify(res.ok, null, 2)}`)
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