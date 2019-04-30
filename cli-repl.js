'use strict';

const repl = require('repl')
const colors = require('colors')

const appStore = require('./store')
const utilsWallet = require('./utils')
const log = require('./cli-log')

const swWallet = require('./svr-wallet/sw-wallet')
const swCreate = require('./svr-wallet/sw-create')


const helpBanner = ''//NOTE: scpx-w commands and arguments are case-sensitive'

const walletNewHelp = `${helpBanner}\n` +
`cmd: .wn (wallet-new) - creates and persists in-memory a new wallet with new random seed values\n`.cyan.bold

const walletInitHelp = `${helpBanner}\n` +
`cmd: .wi (wallet-init) - recreates a wallet from supplied seed values\n`.cyan.bold +
`arg: --mpk <master private key> [required] entropy for keygen and redux store (L1) encryption\n` +
`arg: --apk <active public key>  [required] entropy for keygen, and salt for redux store (L1) encryption\n`

const walletConnectHelp = `${helpBanner}\n` +
`cmd: .wc (wallet-connect) - connects to 3PBPs and populates tx and balance data for the loaded wallet\n`.cyan.bold

const walletDumpHelp = `${helpBanner}\n` +
`cmd: .wd (wallet-dump) - decrypts and dumps sub-asset key and addresses values from the loaded scoop wallet\n`.cyan.bold +
`arg: --mpk      <master private key> [required] (not required if config/wallet.js/CLI_SAVE_LOADED_WALLET_KEYS is set)\n` +
`arg: --apk      <active public key>  [required] (not required if config/wallet.js/CLI_SAVE_LOADED_WALLET_KEYS is set)\n` +
`arg: --s        [symbol]             [optional] restrict output to supplied asset symbol if supplied\n` +
`arg: --txs      [boolean]            [optional] dump address transactions (default: false)\n` +
`arg: --privkeys [boolean]            [optional] dump private keys (default: false)\n`

const walletAddAddrHelp = `${helpBanner}\n` +
`cmd: .wd (wallet-add-address) - adds a receive address for the specified asset\n`.cyan.bold +
`arg: --mpk      <master private key> [required] (not required if config/wallet.js/CLI_SAVE_LOADED_WALLET_KEYS is set)\n` +
`arg: --apk      <active public key>  [required] (not required if config/wallet.js/CLI_SAVE_LOADED_WALLET_KEYS is set)\n` +
`arg: --s        <symbol>             [required] the asset for which to to add an address\n`


const logTailHelp = `${helpBanner}\n` +
`cmd: .lt (log-tail) - tails (doesn't follow) the last n lines of the debug log \n`.cyan.bold +
`arg: --n     [num_lines] [optional] number of lines to tail (default: 100)\n` +
`arg: --debug [boolean]   [optional] tail verbose (debug) log (default: false)\n`

const clsHelp = `${helpBanner}\n` +
`cmd: .cls (clear-scren) - clears the console screen \n`.cyan.bold


module.exports = {
    repl_init: (walletContext, enableFileHistory) => {

        if (utilsWallet.isParamTrue(enableFileHistory)) {
            log.warn('NOTE: Command history is being saved to file at ./node_history. This will include sensitive data.\n')
        }

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

        // init file history
        if (utilsWallet.isParamTrue(enableFileHistory)) {
            prompt.clearBufferedCommand()
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

        const defineWalletCmd = (prompt, name, help, fn, walletFnName) => {
            prompt.defineCommand(name, { help,
                action: function (args) {
                    prompt.clearBufferedCommand()
                    var argv = require('minimist')(args.split(' '))
                    if (argv.help) postCmd(prompt, null, help)
                    else fn(walletContext.store, argv, walletFnName).then(res => postCmd(prompt, res, help))
                }
            })
        }

        // wallet-new, new random MPK
        defineWalletCmd(prompt, 'wn', walletNewHelp, swCreate.walletNew)
    
        // wallet-init, by supplied MPK
        defineWalletCmd(prompt, 'wl', walletInitHelp, swCreate.walletInit)
    
        // wallet-connect, block/tx updates for all asset-types & addr-monitors
        defineWalletCmd(prompt, 'wc', walletConnectHelp, swWallet.walletFunction, 'CONNECT')

        // wallet-dump, decrypt & dump values from redux store
        defineWalletCmd(prompt, 'wd', walletDumpHelp, swWallet.walletFunction, 'DUMP')
    
        // wallet-add-address, creates a new receive address
        defineWalletCmd(prompt, 'waa', walletAddAddrHelp, swWallet.walletFunction, 'ADD-ADDR')


        // log-tail, show last n lines of verbose (debug) log
        defineWalletCmd(prompt, 'lt', logTailHelp, log.logTail)
    
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
        if (!res || res.err) {
            if (res) log.error(res.err)
            if (help) log.info(help)
        }
        else {
            log.success(`OK: ${JSON.stringify(res.ok, null, 2)}`)
        }
        prompt.displayPrompt()
    }, 100) // https://github.com/nodejs/node/issues/11568
}
