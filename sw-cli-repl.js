// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2021 Dominic Morris.

const repl = require('repl')
const colors = require('colors')
//const parseSentence = require('minimist-string')
const stringParseArgs = require('./ext/minimist-string-opt')

const appStore = require('./store').store
const utilsWallet = require('./utils')
const svrWorkers = require('./svr-workers')
const svrRouter = require('./svr-wallet/sw-router')
const svrWalletCreate = require('./svr-wallet/sw-create')

const log = require('./sw-cli-log')
const info = require('./sw-cli-info')
const rpc = require('./sw-rpc')

const helpBanner = '\n' + ' HELP '.bgCyan.white.bold + ' '

const walletNewHelp = `${helpBanner}` +
    `(wallet-new) - creates and persists in-memory a new wallet with new random seed values\n`.cyan.bold

const walletInitHelp = `${helpBanner}` +
    `(wallet-init) - recreates a wallet from supplied seed values\n`.cyan.bold +
    `\t--mpk          <master private key>  <required>  entropy for keygen and redux store (L1) encryption\n`

const walletConnectHelp = `${helpBanner}` +
    `(wallet-connect) - connects to 3PBPs and populates tx and balance data for the loaded wallet\n`.cyan.bold

const walletDumpHelp = `${helpBanner}` +
    `(wallet-dump) - decrypts and dumps sub-asset private key, addresses, tx and utxo values from the loaded wallet\n`.cyan.bold +
    `\t--mpk          <master private key>  <required>  \n` +
    `\t--symbol (--s) [string]              [optional]  restrict output to supplied asset symbol if supplied, e.g. "ETH" or "BTC"\n` +
    `\t--addr         [string]              [optional]  restrict output to supplied address\n` +
    `\t--txs          [bool]                [optional]  dump all address transactions (default: false)\n` +
    `\t--txid         [string]              [optional]  seach & dump specific TXID\n` +
    `\t--keys         [bool]                [optional]  dump private keys (default: false)\n`

const walletAddAddrHelp = `${helpBanner}` +
    `(wallet-add-address) - adds a receive address to the loaded wallet for the specified asset\n`.cyan.bold +
    `\t--mpk          <master private key>  <required>  \n` +
    `\t--symbol (--s) [string]              <required>  the asset for which to add an address, e.g. "ETH" or "BTC"\n` +
    `\t--save         [boolean]             [optional]  save the wallet after adding the address (default: false)\n`

const walletImportPrivKeysHelp = `${helpBanner}` +
    `(wallet-import-priv-keys) - adds one or more private keys to a new import account in the loaded wallet\n`.cyan.bold +
    `\t--mpk          <master private key>  <required>  \n` +
    `\t--symbol (--s) [string]              <required>  the asset for which to add an address, e.g. "ETH" or "BTC"\n` +
    `\t--privKeys     [string]              <required>  comma-separated list of WIF privkeys (UTXO assets) or 64 hex char (ETH assets)"\n`

const walletRemovePrivKeysHelp = `${helpBanner}` +
    `(wallet-remove-priv-keys) - removes an import account and its associated private keys from the loaded wallet\n`.cyan.bold +
    `\t--mpk          <master private key>  <required>  \n` +
    `\t--symbol (--s) [string]              <required>  the asset for which to add an address, e.g. "ETH" or "BTC"\n` +
    `\t--accountName  [string]              <required>  the import account name to remove e.g. "Import #1 Bitcoin"\n`

const walletSaveHelp = `${helpBanner}` +
    `(wallet-save) - saves the loaded wallet in encrypted form to file\n`.cyan.bold +
    `\t--mpk          <master private key>  <required>  \n` +
    `\t--name (--n)   [string]              <required>  a name for the saved wallet; the wallet can subsequently be loaded by this name\n` +
    `\t--force        [bool]                [optional]  overwrite (without warning) any existing file with the same name (default: false)\n`

const walletLoadHelp = `${helpBanner}` +
    `(wallet-load) - loads a previously saved wallet from file\n`.cyan.bold +
    `\t--mpk          <master private key>  <required>  \n` +
    `\t--name (--n)   [string]              <required>  the name of the wallet to load\n`

const walletServerLoadHelp = `${helpBanner}` +
    `(wallet-server-load) - loads a previously saved wallet from the Scoop Data Storage Contract\n`.cyan.bold +
    `\t--mpk          <master private key>  <required>  \n` +
    `\t--email (--e)  [string]              <required>  the pseudo-email of the wallet in the Scoop Data Storage Contract, e.g. "x+7dgy0soek3gvn@scoop.tech"\n`

const walletServerSaveHelp = `${helpBanner}` +
    `(wallet-server-save) - saves a previously loaded server wallet back to the Scoop Data Storage Contract\n`.cyan.bold +
    `\t--mpk          <master private key>  <required>  \n`

const walletBalanceHelp = `${helpBanner}` +
    `(wallet-balance) - shows aub-asset balances in the loaded wallet\n`.cyan.bold +
    `\t--symbol (--s) [string]              <required>  restrict output to supplied asset symbol if supplied, e.g. "ETH" or "BTC"\n`

const assetGetFeesHelp = `${helpBanner}` +
    `(asset-get-fees) - fetches recommended network fee rates from oracles\n`.cyan.bold +
    `\t--symbol (--s) [string]              <required>  the asset to get fee rates for, e.g. "ETH" or "BTC"\n`

const assetConvertHelp = `${helpBanner}` +
    `(asset-convert) - exchange service: converts from one asset to another\n`.cyan.bold +
    `\t--mpk          <master private key>  <required>  \n` +
    `\t--symbol (--s) [string]              <required>  the asset to convert, e.g. "ZEC"\n` +
    `\t--value (--v)  [number]              <required>  the amount to convert, e.g. 0.01\n` +
    `\t--from (--f)   [string]              <optional>  the address to send from; mandatory for account-type assets, e.g. ETH and ERC20s\n` +
    `\t--to (--t)     [string]              <required>  the asset to convert to, e.g. "ETH" or "BTC"\n` + 
    `\t--status       [bool]                [optional]  display conversion status(es) (default: false)\n`

const txGetFeeHelp = `${helpBanner}` +
    `(tx-get-fee) - gets the network fee for the specified single-recipient transaction\n`.cyan.bold +
    `\t--mpk          <master private key>  <required>  \n` +
    `\t--symbol (--s) [string]              <required>  the asset to use for the fee estimate, e.g. "ETH" or "BTC"\n` +
    `\t--value (--v)  [number]              <required>  the send value to use for the fee estimate, e.g. 0.01\n`

const txPushHelp = `${helpBanner}` +
    `(tx-push) - broadcasts the specified single-recipient transaction\n`.cyan.bold +
    `\t--mpk            <master private key>  <required>  \n` +
    `\t--symbol (--s)   [string]              <required>  the asset to use for the transaction, e.g. "ZEC"\n` +
    `\t--value (--v)    [number]              <required>  the amount to send, e.g. 0.01\n` +
    `\t--from (--f)     [string]              <optional>  the address to send from (account-type assets)\n` +
    `\t--to (--t)       [string]              <required>  the address to send to, e.g. "t1RGM2uztDM3iqGjBsK7UvuLFAYiSJWczLh"\n` +
    `\t--dsigCltvPubKey [string]  <optional>  creates a non-standard output PROTECT_OP (P2SH(DSIG/CLTV)) which can be spent after a timelock by the address of this pubkey (BTC_TEST)\n` +
    `\t--spendFullUtxos [string]  <optional>  spend (in full) one or more specifc UTXO(s) - format "txid:vout,..."\n`

const claimableListHelp = `${helpBanner}` +
    `.cll (claimable-list) - lists any spendable PROTECT_OP UTXOs\n`.cyan.bold +
    `\t--symbol (--s) [string]              <required>  the asset for which to list claimables (BTC_TEST)\n`

const claimableClaimHelp = `${helpBanner}` +
    `.clc (claimable-claim) - claims (sends to self, standard UTXO) claimable PROTECT_OP UTXOs\n`.cyan.bold +
    `\t--mpk            <master private key>  <required>  \n` +
    `\t--symbol (--s)   [string]              <required>  the asset to use for the transaction (BTC_TEST)\n` +
    `\t--spendFullUtxos [string]              [optional]  claims (in full) one or more PROTECT_OP UTXO(s) - format "txid:vout,..." (or claims all available UTXOs if not supplied)\n`

const claimableResetHelp = `${helpBanner}` +
    `.clr (claimable-reset) - rolls over PROTECT_OP UTXOs resetting their timelocks\n`.cyan.bold +
    `\t--mpk            <master private key>  <required>  \n` +
    `\t--symbol (--s)   [string]              <required>  the asset to use for the transaction (BTC_TEST)\n` +
    `\t--resetFullUtxos [string]              [optional]  resets (in full) one or more PROTECT_OP UTXO(s) - format "txid:vout,..." (or resets all available UTXOs if not supplied)\n`

const clsHelp = `${helpBanner}` +
    `.cls (clear-screen) - clears the console screen \n`.cyan.bold

const exitHelp = `${helpBanner}` +
    `.exit - terminates the wallet\n`.cyan.bold

// dbg/utils
const rpcTestHelp = `${helpBanner}` +
    `.rt (rpc-test) - DBG: calls sw-cli RPC server \n`.cyan.bold +
    `\t--rpcPort      [number]              [required]  RPC port \n` +
    `\t--rpcHost      [string]              [required]  RPC host \n` +
    `\t--rpcUsername  [string]              [required]  RPC username \n` +
    `\t--rpcPassword  [string]              [required]  RPC password \n` +
    `\t--cmd          [string]              [required]  CLI command, e.g. ".tx-push" \n` +
    `\t--params       [string]              [required]  CLI parameters in JSON format, e.g. " { \\\"mpk\\\": \\\"...\\\", \\\"symbol\\\": \\\"...\\\", \\\"value\\\": \\\"...\\\", ... } \n`

const logTailHelp = `${helpBanner}` +
    `.lt (log-tail) - DBG: tails the last n lines of the debug log \n`.cyan.bold +
    `\t--lines (--l)  [int]                 [optional]  number of lines to tail (default: 100)\n` +
    `\t--debug        [bool]                [optional]  tails the verbose (debug) log instead of the info log (default: false) \n`

const infoHelp = `${helpBanner}` +
    `.i (info) - DBG: displays summary wallet info \n`.cyan.bold

//const clearCacheHelp = `${helpBanner}` +
//    `.cc (clear-tx-db-cache) - clears the TX cache file\n`.cyan.bold

module.exports = {
    init: (walletContext, enableFileHistory) => {

        if (utilsWallet.isParamTrue(enableFileHistory)) {
            log.warn('command history is being saved to file at ./node_history. This will include sensitive data.\n')
        }

        // init repl
        const colors = { RED: "31", GREEN: "32", YELLOW: "33", BLUE: "34", MAGENTA: "35", CYAN: "36" }
        const colorize = (color, s) => `\x1b[${color}m${s}\x1b[0m`
        const nodeVersion = colorize(colors.GREEN, `${process.title} ${process.version}`)
        const prompt = repl.start({
            terminal: true,
            historySize: 100,
            removeHistoryDuplicates: true,
            useGlobal: true,
            useColors: true,
            prompt: `${nodeVersion} SW-CLI > `,
            breakEvalOnSigint: true,
            // eval: (text, context, filename, callback) => {
            //     prompt.setPrompt(`new [${new Date().getTime()}] >`)
            // }
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

        const defineWalletCmd = (prompt, names, help, fn, walletFnName) => {
            names.forEach(name => {
                prompt.defineCommand(name, {
                    help,
                    action: function (args) {
                        prompt.clearBufferedCommand()
                        //var argv = require('minimist')(args.split(' '))
                        const argv = stringParseArgs(args, { 
                            string: ['t', 'f'],
                             alias: {
                                s: 'symbol',    // e.g. "-s" == --symbol (== --s)
                                n: 'name',
                                l: 'lines',
                                e: 'email',
                                v: 'value',
                                t: 'to',
                                f: 'from',
                            }
                        })
                        if (argv.help) postCmd(prompt, null, help)
                        else {
                            //console.group()
                            fn(utilsWallet.getAppWorker(), walletContext.store, argv, walletFnName)
                            .then(res => {
                                if (res) postCmd(prompt, res, help)
                                else process.exit(1)
                            })
                            //.finally(() => console.groupEnd())
                        }
                    }
                })
            })
        }

        defineWalletCmd(prompt, ['/wn', 'wallet-new'], walletNewHelp, svrWalletCreate.walletNew)
        defineWalletCmd(prompt, ['/wi', 'wallet-init'], walletInitHelp, svrWalletCreate.walletInit)

        defineWalletCmd(prompt, ['/wl', 'wallet-load'], walletLoadHelp, svrRouter.fn, 'LOAD')
        defineWalletCmd(prompt, ['/ws', 'wallet-save'], walletSaveHelp, svrRouter.fn, 'SAVE')
        defineWalletCmd(prompt, ['/wsl', 'wallet-server-load'], walletServerLoadHelp, svrRouter.fn, 'SERVER-LOAD')
        defineWalletCmd(prompt, ['/wss', 'wallet-server-save'], walletServerSaveHelp, svrRouter.fn, 'SERVER-SAVE')

        defineWalletCmd(prompt, ['/wc', 'wallet-connect'], walletConnectHelp, svrRouter.fn, 'CONNECT')

        defineWalletCmd(prompt, ['/wd', 'wallet-dump'], walletDumpHelp, svrRouter.fn, 'DUMP')
        defineWalletCmd(prompt, ['/wb', 'wallet-balance'], walletBalanceHelp, svrRouter.fn, 'BALANCE')

        defineWalletCmd(prompt, ['/waa', 'wallet-add-address'], walletAddAddrHelp, svrRouter.fn, 'ADD-ADDR')
        defineWalletCmd(prompt, ['/wipk', 'wallet-import-priv-keys'], walletImportPrivKeysHelp, svrRouter.fn, 'ADD-PRIV-KEYS')
        defineWalletCmd(prompt, ['/wrpk', 'wallet-remove-priv-keys'], walletRemovePrivKeysHelp, svrRouter.fn, 'REMOVE-PRIV-KEYS')

        defineWalletCmd(prompt, ['/agf', 'asset-get-fees'], assetGetFeesHelp, svrRouter.fn, 'ASSET-GET-FEES')
        defineWalletCmd(prompt, ['/ac', 'asset-convert'], assetConvertHelp, svrRouter.fn, 'ASSET-CONVERT')
        
        defineWalletCmd(prompt, ['/txgf', 'tx-get-fee'], txGetFeeHelp, svrRouter.fn, 'TX-GET-FEE')
        defineWalletCmd(prompt, ['/txp', 'tx-push'], txPushHelp, svrRouter.fn, 'TX-PUSH')

        defineWalletCmd(prompt, ['/cll', 'list-claimable'], claimableListHelp, svrRouter.fn, 'CLAIMABLE-LIST')
        defineWalletCmd(prompt, ['/clc', 'claim-claimable'], claimableClaimHelp, svrRouter.fn, 'CLAIMABLE-CLAIM')
        defineWalletCmd(prompt, ['/clr', 'claim-reset'], claimableResetHelp, svrRouter.fn, 'CLAIMABLE-RESET')

        defineWalletCmd(prompt, ['/rt', 'rpc-test'], rpcTestHelp, rpc.rpcTest)
        defineWalletCmd(prompt, ['/lt', 'log-tail'], logTailHelp, log.logTail)

        defineWalletCmd(prompt, ['/i', 'info'], infoHelp, info.show)

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
        defineWalletCmd(prompt, ['cls'], clsHelp, async () => {
            require('clear')()
            return { ok: true }
        })

        // exit, clear console screen
        defineWalletCmd(prompt, ['exit'], exitHelp, async () => {
            process.exit(0)
            return null
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
        else log.success(`${JSON.stringify(res.ok, null, 2)}`)
        if (global.loadedWallet && global.loadedWallet.keys && global.loadedWallet.keys.mpk) {
            log.warn(`DEV MODE - wallet MPK is being cached in-memory: ${global.loadedWallet.keys.mpk}`)
        }
        //prompt.setPrompt('new>')
        prompt.displayPrompt()
    }, 1000) // https://github.com/nodejs/node/issues/11568 -- also, allow time for related reducer actions and their logs
}
