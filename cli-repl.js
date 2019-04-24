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

    const helpBanner = 'NOTE: scpx-w commands and arguments are case-sensitive'

    // dump store state
    prompt.defineCommand("ss", {
        help: "dump redux store state",
        action: function (args) {
            this.clearBufferedCommand()
            console.dir(appStore.store.getState())
            this.displayPrompt()
        }
    })

    // wallet - new
    const walletNewHelp = `${helpBanner}\n` +
        `\tcmd: .wn (wallet new)\n`
    prompt.defineCommand("wn", {
        help: walletNewHelp,
        action: function (args) {
            this.clearBufferedCommand()
            var argv = require('minimist')(args.split(' '))
            svrWallet.newWallet(walletContext.store, argv).then(res => {
                if (res.err) {
                    log.error(res.err)
                    //log.info(walletNewHelp)
                }
                else {
                    log.success(res.ok)
                }
                this.displayPrompt()
            })
        }
    })

    // wallet - load by MPK
    const walletLoadHelp = `${helpBanner}\n` +
        `\tcmd: .wl (wallet load)\n` +
        `\targ: [required] --mpk=<master private key>\n`
    prompt.defineCommand("wl", {
        help: walletLoadHelp,
        action: function (args) {
            this.clearBufferedCommand()
            var argv = require('minimist')(args.split(' '))
            const data = svrWallet.loadWallet(walletContext.store, argv)
            if (data.err) {
                log.error(data.err)
                //log.info(walletLoadHelp)
            }
            else {
                log.success(data.ok)
            }
            this.displayPrompt()
        }
    })

    // test cpuworker ping
    prompt.defineCommand("tc1", {
        help: "cpuWorker test1 - ping",
        action: function (args) {
            this.clearBufferedCommand()
            const globalScope = utilsWallet.getGlobal()
            globalScope.cpuWorkers[0].postMessage({ msg: 'DIAG_PING', data: {} })
            globalScope.cpuWorkers[0].on('message', (data) => {
                log.info(data)
            })
            this.displayPrompt()
        }
    })

    const sayBye = say(`Goodbye!`)
    prompt.on("exit", sayBye)
}