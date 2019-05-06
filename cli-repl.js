// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.

const repl = require('repl')
const colors = require('colors')

const appStore = require('./store').store
const utilsWallet = require('./utils')
const log = require('./cli-log')
const svrWorkers = require('./svr-workers')
const svrWallet = require('./svr-wallet/sw-wallet')
const svrWalletCreate = require('./svr-wallet/sw-create')

const helpBanner = ' HELP '.bgCyan.white.bold + ' '

const walletNewHelp = `${helpBanner}` +
    `.wn (wallet-new) - creates and persists in-memory a new wallet with new random seed values\n`.cyan.bold

const walletInitHelp = `${helpBanner}` +
    `.wi (wallet-init) - recreates a wallet from supplied seed values\n`.cyan.bold +
    `\targ: --mpk      <master private key>  <required>  entropy for keygen and redux store (L1) encryption\n`

const walletConnectHelp = `${helpBanner}` +
    `.wc (wallet-connect) - connects to 3PBPs and populates tx and balance data for the loaded wallet\n`.cyan.bold

const walletDumpHelp = `${helpBanner}` +
    `.wd (wallet-dump) - decrypts and dumps sub-asset private key, addresses, tx and utxo values from the loaded wallet\n`.cyan.bold +
    `\targ: --mpk      <master private key>  <required>  \n` +
    `\targ: --s        [string]              [optional]  restrict output to supplied asset symbol if supplied, e.g. "ETH" or "BTC"\n` +
    `\targ: --txs      [bool]                [optional]  dump address transactions (default: false)\n` +
    `\targ: --privkeys [bool]                [optional]  dump private keys (default: false)\n`

const walletAddAddrHelp = `${helpBanner}` +
    `.waa (wallet-add-address) - adds a receive address to the loaded wallet for the specified asset\n`.cyan.bold +
    `\targ: --mpk      <master private key>  <required>  \n` +
    `\targ: --s        [string]              <required>  the asset for which to add an address, e.g. "ETH" or "BTC"\n`

const walletSaveHelp = `${helpBanner}` +
    `.ws (wallet-save) - saves the loaded wallet in encrypted form to file\n`.cyan.bold +
    `\targ: --n        [string]              <required>  a name for the saved wallet; the wallet can subsequently be loaded by this name\n` +
    `\targ: --f        [bool]                [optional]  overwrite (without warning) any existing file with the same name (default: false)\n`

const walletLoadHelp = `${helpBanner}` +
    `.wl (wallet-load) - loads a previously saved wallet from file\n`.cyan.bold +
    `\targ: --mpk      <master private key>  <required>  \n` +
    `\targ: --n        [string]              <required>  the name of the wallet to load\n`

const walletServerLoadHelp = `${helpBanner}` +
    `.wsl (wallet-server-load) - loads a previously saved wallet from the Scoop Data Storage Contract\n`.cyan.bold +
    `\targ: --mpk      <master private key>  <required>  \n` +
    `\targ: --e        [string]              <required>  the pseudo-email of the wallet in the Scoop Data Storage Contract, e.g. "x+7dgy0soek3gvn@scoop.tech"\n`

const walletServerSaveHelp = `${helpBanner}` +
    `.wss (wallet-server-save) - saves a previously loaded server wallet back to the Scoop Data Storage Contract\n`.cyan.bold +
    `\targ: --mpk      <master private key>  <required>  \n`

const walletBalanceHelp = `${helpBanner}` +
    `.wb (wallet-balance) - shows aub-asset balances in the loaded wallet\n`.cyan.bold +
    `\targ: --s        [string]              <required>  restrict output to supplied asset symbol if supplied, e.g. "ETH" or "BTC"\n`

const assetGetFeesHelp = `${helpBanner}` +
    `.agf (asset-get-fees) - fetches recommended network fee rates from oracles\n`.cyan.bold +
    `\targ: --s        [string]              <required>  the asset to use for the fee estimate, e.g. "ETH" or "BTC"\n`

const txGetFeeHelp = `${helpBanner}` +
    `.txgf (tx-get-fee) - gets the network fee for sending the specified asset value to a single recipient\n`.cyan.bold +
    `\targ: --mpk      <master private key>  <required>  \n` +
    `\targ: --s        [string]              <required>  the asset to use for the fee estimate, e.g. "ETH" or "BTC"\n` +
    `\targ: --v        [number]              <required>  the send value to use for the fee estimate, e.g. 0.01\n`


// dbg/utils

//const clearCacheHelp = `${helpBanner}` +
//    `.cc (clear-tx-db-cache) - clears the TX cache file\n`.cyan.bold

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
                        fn(utilsWallet.getAppWorker(), walletContext.store, argv, walletFnName)
                            .then(res => postCmd(prompt, res, help))
                        //.finally(() => console.groupEnd())
                    }
                }
            })
        }

        defineWalletCmd(prompt, 'wn', walletNewHelp, svrWalletCreate.walletNew)
        defineWalletCmd(prompt, 'wi', walletInitHelp, svrWalletCreate.walletInit)

        defineWalletCmd(prompt, 'wl', walletLoadHelp, svrWallet.fn, 'LOAD')
        defineWalletCmd(prompt, 'ws', walletSaveHelp, svrWallet.fn, 'SAVE')
        defineWalletCmd(prompt, 'wsl', walletServerLoadHelp, svrWallet.fn, 'SERVER-LOAD')
        defineWalletCmd(prompt, 'wss', walletServerSaveHelp, svrWallet.fn, 'SERVER-SAVE')


        defineWalletCmd(prompt, 'wc', walletConnectHelp, svrWallet.fn, 'CONNECT')

        defineWalletCmd(prompt, 'wd', walletDumpHelp, svrWallet.fn, 'DUMP')
        defineWalletCmd(prompt, 'wb', walletBalanceHelp, svrWallet.fn, 'BALANCE')

        defineWalletCmd(prompt, 'waa', walletAddAddrHelp, svrWallet.fn, 'ADD-ADDR')
        // TODO: add/remove imported accounts

        defineWalletCmd(prompt, 'agf', assetGetFeesHelp, svrWallet.fn, 'ASSET-GET-FEES')
        
        defineWalletCmd(prompt, 'txgf', txGetFeeHelp, svrWallet.fn, 'TX-GET-FEE')


        defineWalletCmd(prompt, 'lt', logTailHelp, log.logTail)


        // clear, tx db cache 
        // defineWalletCmd(prompt, 'cc', clearCacheHelp, async () => {
        //     const txDbClear = new Promise((resolve) => {
        //         const listener = (event) => {
        //             if (event.msg === 'SERVER_NUKE_TX_DB_DONE') { 
        //                 utilsWallet.getAppWorker().removeEventListener('message', listener)
        //                 // ## re-init of txdb after clear causes cli commands to be written to it
        //                 // setTimeout(() => {
        //                 //     svrWorkers.txdb_init()
        //                 //     resolve()
        //                 // }, 1000)
        //             }
        //         }
        //         utilsWallet.getAppWorker().addEventListener('message', listener)
        //         utilsWallet.getAppWorker().postMessage({ msg: 'SERVER_NUKE_TX_DB', data: {} })
        //     })
        //     await txDbClear
        //     return { ok: true }
        // })

        // cls, clear console screen
        defineWalletCmd(prompt, 'cls', clsHelp, async () => {
            require('clear')()
            return { ok: true }
        })

        // exit, clear console screen
        defineWalletCmd(prompt, 'exit', exitHelp, async () => {
            process.exit(0)
        })

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

        if (global.loadedWalletKeys && global.loadedWalletKeys.mpk) {
            log.warn('DEV MODE - wallet MPK is being cached in-memory (CLI_SAVE_LOADED_WALLET_KEY == true)')
        }

        prompt.displayPrompt()
    }, 100) // https://github.com/nodejs/node/issues/11568
}
