'use strict';

const repl = require('repl')

const appStore = require('./store')
const utilsWallet = require('./utils')

const log = require('./cli-log')
const svrWallet = require('./svr-wallet')

const colors = require('colors')


const helpBanner = ''//NOTE: scpx-w commands and arguments are case-sensitive'

const walletNewHelp = `${helpBanner}\n` +
`cmd: .wn (wallet-new) - creates and persists in-memory a new scoop wallet, from new random seed values\n`.cyan.bold

const walletLoadHelp = `${helpBanner}\n` +
`cmd: .wl (wallet-load) - recreates and persists in-memory a scoop wallet, from supplied seed values\n`.cyan.bold +
`arg: --mpk <master private key>\t\t[required]\t\tentropy for keygen and redux store (L1) encryption\n` +
`arg: --apk <active public key>\t\t[required]\t\tentropy for keygen, and salt for redux store (L1) encryption\n`

const walletDumpHelp = `${helpBanner}\n` +
`cmd: .wd (wallet-dump) - decrypts and dumps sub-asset key and addresses values from the loaded scoop wallet\n`.cyan.bold +
`arg: --mpk <master private key>\t\t[required]\t\tentropy for redux store (L1) decryption passphrase\n` +
`arg: --apk <active public key>\t\t[required]\t\tsalt for redux store (L1) decryption\n` +
`arg: --s <symbol>\t\t[optional]\t\trestrict output to supplied asset symbol if supplied\n`

const walletConnectHelp = `${helpBanner}\n` +
`cmd: .wc (wallet-connect) - connects to 3PBPs and populates tx and balance data for the loaded wallet\n`.cyan.bold

const tailLogHelp = `${helpBanner}\n` +
`cmd: .lt (log-tail) - tails (doesn't follow) the last n lines of the debug log \n`.cyan.bold +
`arg: --n [num_lines]\t\t\t[optional: def. 100]\tnumber of lines to tail\n`

const clsHelp = `${helpBanner}\n` +
`cmd: .cls (clear-scren) - clears the console screen \n`.cyan.bold


module.exports = {
    repl_init: (walletContext, enableFileHistory) => {

        // init repl
        const colors = { RED: "31", GREEN: "32", YELLOW: "33", BLUE: "34", MAGENTA: "35", CYAN: "36" }
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
        debugger
        if (enableFileHistory === "true") {
            prompt.clearBufferedCommand()
            log.warn('\nCommand history is being saved to file at ./node_history. This may include sensitive data.\n')
            require('repl.history')(prompt, './.node_history')
            prompt.displayPrompt()
        }
        prompt.context.w = walletContext
    
        // custom commands
        delete prompt.commands.save
        delete prompt.commands.break
        delete prompt.commands.clear
        delete prompt.commands.load
        delete prompt.commands.editor
    
        // wallet-new, new random MPK
        prompt.defineCommand("wn", {
            help: walletNewHelp,
            action: function (args) {
                this.clearBufferedCommand()
                var argv = require('minimist')(args.split(' '))
                svrWallet.walletNew(walletContext.store, argv).then(res => postCmd(this, res, walletNewHelp))
            }
        })
    
        // wallet-load, by supplied MPK
        prompt.defineCommand("wl", {
            help: walletLoadHelp,
            action: function (args) {
                this.clearBufferedCommand()
                var argv = require('minimist')(args.split(' '))
                svrWallet.walletLoad(walletContext.store, argv).then(res => postCmd(this, res, walletLoadHelp))
            }
        })
    
        // wallet-dump, decrypt & dump values from redux store
        prompt.defineCommand("wd", {
            help: walletDumpHelp,
            action: function (args) {
                this.clearBufferedCommand()
                var argv = require('minimist')(args.split(' '))
                svrWallet.walletDump(walletContext.store, argv).then(res => postCmd(this, res, walletDumpHelp))
            }
        })
    
        // wallet-connect, block/tx updates for all asset-types & addr-monitors
        prompt.defineCommand("wc", {
            help: walletConnectHelp,
            action: function (args) {
                this.clearBufferedCommand()
                svrWallet.walletConnect(walletContext.store).then(res => postCmd(this, res, walletConnectHelp))
            }
        })
    
        // log-tail, show last n lines of verbose (debug) log
        prompt.defineCommand("lt", {
            help: tailLogHelp,
            action: function (args) {
                this.clearBufferedCommand()
                var argv = require('minimist')(args.split(' '))
                log.debugLogTail(argv).then(res => postCmd(this, res, tailLogHelp))
            }
        })
    
         // cls, clear console screen
         prompt.defineCommand("cls", {
             help: clsHelp,
             action: function (args) {
                 this.clearBufferedCommand()
                 require('clear')()
                 this.displayPrompt()
             }
         })
    
        // dbg, dump store state
        prompt.defineCommand("drs", {
            help: "dbg - dump redux store",
            action: function (args) {
                this.clearBufferedCommand()
                console.dir(appStore.store.getState())
                setTimeout(() => {
                    this.displayPrompt()
                }, 100)
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
    
        return prompt
    },
    
    postCmd: (prompt, res, help) => {
        postCmd(prompt, res, help)
    }
}
    
function postCmd(prompt, res, help) {
    setTimeout(() => {
        if (res.err) {
            log.error(res.err)
            if (help) {
                log.info(help)
            }
        }
        else {
            log.success(`OK: ${JSON.stringify(res.ok, null, 2)}`)
        }
        prompt.displayPrompt()
    }, 100) // https://github.com/nodejs/node/issues/11568
}
