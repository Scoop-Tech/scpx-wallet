// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.

const repl = require('repl')
const colors = require('colors')

const appStore = require('./store')
const utilsWallet = require('./utils')
const log = require('./cli-log')

const svrWallet = require('./svr-wallet/sw-wallet')
const svrWalletCreate = require('./svr-wallet/sw-create')

const helpBanner = ' HELP '.bgCyan.white.bold + ' '

const walletNewHelp = `${helpBanner}` +
    `.wn (wallet-new) - creates and persists in-memory a new wallet with new random seed values\n`.cyan.bold

const walletInitHelp = `${helpBanner}` +
    `.wi (wallet-init) - recreates a wallet from supplied seed values\n`.cyan.bold +
    `\targ: --mpk      <master private key>  <required>  entropy for keygen and redux store (L1) encryption\n` +
    `\targ: --apk      <active public key>   <required>  entropy for keygen, and salt for redux store (L1) encryption\n`

const walletConnectHelp = `${helpBanner}` +
    `.wc (wallet-connect) - connects to 3PBPs and populates tx and balance data for the loaded wallet\n`.cyan.bold

const walletDumpHelp = `${helpBanner}` +
    `.wd (wallet-dump) - decrypts and dumps sub-asset private key, addresses, tx and utxo values from the loaded wallet\n`.cyan.bold +
    `\targ: --mpk      <master private key>  <required>  \n` +
    `\targ: --apk      <active public key>   <required>  \n` +
    `\targ: --s        [string]              [optional]  restrict output to supplied asset symbol if supplied, e.g. "ETH" or "BTC"\n` +
    `\targ: --txs      [bool]                [optional]  dump address transactions (default: false)\n` +
    `\targ: --privkeys [bool]                [optional]  dump private keys (default: false)\n`

const walletAddAddrHelp = `${helpBanner}` +
    `.waa (wallet-add-address) - adds a receive address to the loaded wallet for the specified asset\n`.cyan.bold +
    `\targ: --mpk      <master private key>  <required>  \n` +
    `\targ: --apk      <active public key>   <required>  \n` +
    `\targ: --s        [string]              <required>  the asset for which to to add an address, e.g. "ETH" or "BTC"\n`

const walletSaveHelp = `${helpBanner}` +
    `.ws (wallet-save) - saves the loaded wallet in encrypted form to file\n`.cyan.bold +
    `\targ: --n        [string]              <required>  a name for the saved wallet; the wallet can subsequently be loaded by this name\n` +
    `\targ: --f        [bool]                [optional]  overwrite (without warning) any existing file with the same name (default: false)\n`

const walletLoadHelp = `${helpBanner}` +
    `.wl (wallet-load) - loads a previously saved wallet from file\n`.cyan.bold +
    `\targ: --mpk      <master private key>  <required>  \n` +
    `\targ: --apk      <active public key>   <required>  \n` +
    `\targ: --n        [string]              <required>  the name of the wallet to load\n`

const walletBalanceHelp = `${helpBanner}` +
    `.wb (wallet-balance) - shows aub-asset balances in the loaded wallet\n`.cyan.bold +
    `\targ: --s        [string]              <required>  restrict output to supplied asset symbol if supplied, e.g. "ETH" or "BTC"\n`

    


const logTailHelp = `${helpBanner}` +
    `.lt (log-tail) - tails (doesn't follow) the last n lines of the debug log \n`.cyan.bold +
    `\targ: --n        [int]                 [optional]  number of lines to tail (default: 100)\n` +
    `\targ: --debug    [bool]                [optional]  tails the verbose (debug) log instead of the info log (default: false)\n`

const clsHelp = `${helpBanner}` +
    `.cls (clear-scren) - clears the console screen \n`.cyan.bold

const exitHelp = `${helpBanner}` +
    `.exit - terminates the wallet\n`.cyan.bold


module.exports = {
    repl_init: (walletContext, enableFileHistory) => {

        if (utilsWallet.isParamTrue(enableFileHistory)) {
            log.warn('command history is being saved to file at ./node_history. This will include sensitive data.\n')
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
        delete prompt.commands.history
        delete prompt.commands.exit
        prompt.commands.help.help += '\n'

        const defineWalletCmd = (prompt, name, help, fn, walletFnName) => {
            prompt.defineCommand(name, {
                help,
                action: function (args) {
                    prompt.clearBufferedCommand()
                    var argv = require('minimist')(args.split(' '))
                    if (argv.help) postCmd(prompt, null, help)
                    else {
                        //console.group()
                        fn(walletContext.store, argv, walletFnName).then(res => postCmd(prompt, res, help))
                        //.finally(() => console.groupEnd())
                    }
                }
            })
        }

        // wallet-new, new random MPK
        defineWalletCmd(prompt, 'wn', walletNewHelp, svrWalletCreate.walletNew)

        // wallet-init, by supplied MPK
        defineWalletCmd(prompt, 'wi', walletInitHelp, svrWalletCreate.walletInit)

        // wallet-connect, block/tx updates for all asset-types & addr-monitors
        defineWalletCmd(prompt, 'wc', walletConnectHelp, svrWallet.walletFunction, 'CONNECT')

        // wallet-dump, decrypt & dump values from redux store
        defineWalletCmd(prompt, 'wd', walletDumpHelp, svrWallet.walletFunction, 'DUMP')

        // wallet-add-address, creates a new receive address
        defineWalletCmd(prompt, 'waa', walletAddAddrHelp, svrWallet.walletFunction, 'ADD-ADDR')

        // wallet-save, saves a wallet to file
        defineWalletCmd(prompt, 'ws', walletSaveHelp, svrWallet.walletFunction, 'SAVE')

        // wallet-load, saves a wallet to file
        defineWalletCmd(prompt, 'wl', walletLoadHelp, svrWallet.walletFunction, 'LOAD')

        // wallet-balances, shows wallet asset balances
        defineWalletCmd(prompt, 'wb', walletBalanceHelp, svrWallet.walletFunction, 'BALANCE')
        

        // log-tail, show last n lines of verbose (debug) log
        defineWalletCmd(prompt, 'lt', logTailHelp, log.logTail)



        // cls, clear console screen
        defineWalletCmd(prompt, 'cls', clsHelp, async () => {
            require('clear')()
            return { ok: true }
        })

        // exit, clear console screen
        defineWalletCmd(prompt, 'exit', exitHelp, async () => {
            process.exit(0)
            //return { ok: true }
        })

        // dbg, dump store state
        // prompt.defineCommand("drs", {
        //     help: "dbg - dump redux store",
        //     action: function (args) {
        //         this.clearBufferedCommand()
        //         console.dir(appStore.store.getState())
        //         setTimeout(() => {
        //             this.displayPrompt()
        //         }, 100)
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
            if (help) {
                console.log()
                log.info(help)
            }
        }
        else {
            log.success(`${JSON.stringify(res.ok, null, 2)}`)
        }

        if (global.loadedWalletKeys && global.loadedWalletKeys.mpk && global.loadedWalletKeys.apk) {
            log.warn('the wallet MPK & APK are being cached in-memory (CLI_SAVE_LOADED_WALLET_KEYS == true)')
        }

        prompt.displayPrompt()
    }, 100) // https://github.com/nodejs/node/issues/11568
}
