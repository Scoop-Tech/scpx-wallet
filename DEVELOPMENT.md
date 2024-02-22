# Development Guide

## Architecture

  * https://github.com/trezor/blockbook - primary 3PBP interface: preferred, due to pure websocket interface.
  * https://github.com/bitpay/insight-api - secondary 3PBP interface: BTC_TEST uses this codepath, and is retained as fallback interface for additional assets.
  * https://github.com/EOSIO/eos - used as the backing store for web client accounts: optional dependency of the Core Wallet.


## Setup
 > All:
  * ```npm install -g node-gyp```
  * ```git clone https://github.com/Scoop-Tech/scpx-wallet.git```
  * ```cd scpx-wallet```
 
 > MacOS:
  * Python (use 2.x) fixup (for node-gyp) https://stackoverflow.com/questions/70098133/npm-error-cant-find-python-executable-in-macos-big-sur
  * ```npm install --force```
   
 > Windows:
  * ```npm install -g --production windows-build-tools@4.0.0``` - see also [here](https://github.com/felixrieseberg/windows-build-tools/issues/152)
  * ```npm config set msvs_version 2015```
 
 > All:
  * ```yarn install``` PREFERRED
  * ```npm install``` - Windows: see also [here](https://github.com/nodejs/node-gyp/issues/671) re. node-gyp rebuild failures

## Running Core Wallet CLI - through NPM
  * ```npm run dev``` - runs with dev flags (saves CLI history to file, caches MPK in memory, activates test assets)
  * ```npm start``` - runs with prod flags

## Running Core Wallet CLI - directly with Node, e.g:
 * ```node --experimental-worker ./sw-cli.js --help``` to view CLI options
 * ```export NODE_OPTIONS=development &&node --experimental-worker ./sw-cli.js --saveHistory=true --mpk=... --loadServer=...``` e.g. to load a server-wallet, e.g. one created from www.scoop.tech

## Running Tests
  * See: `.env.example` to run the entire integration test suite (you'll need to make a server test account, and fund it with test assets)
  * ```npm run test``` to run the the CI test suite; if no .env value(s) found, it will skip some tests
  * ```npm run test -- -t "BTC_TEST"``` - to run individual tests, filtered by ```it()``` description

The full test suite executes full integration tests that transact on testnets - these incur testnet network fees. The Travis integration suite uses a server account for this. If you can help keep it topped up, the testnet addresses are:

  * **BTC_TEST** ```2NFsNU7FJusZeNiCAHwHJvjw1UBLT1hw6iv``` (BTC Testnet3 P2SH)
    * https://tbtc.bitaps.com/   
    * http://bitcoinfaucet.uo1.net/send.php/

  * **ZEC_TEST** ```tmAU27N3iHMeejD6GPHYiSnH8vit1XT9uEX``` (ZEC Testnet)
    * https://faucet.testnet.z.cash/
    * https://zcashfaucet.info/
    
  * **ETH_TEST** ```0xda9abd90e6cd31e8e0c2d5f35d3d5a71c8661b0e``` (ETH Ropsten)
    * https://faucet.ropsten.be/ ```wget https://faucet.ropsten.be/donate/0xda9abd90e6cd31e8e0c2d5f35d3d5a71c8661b0e```
    * https://faucet.metamask.io/  

Core wallet functions are demonstrated as integration tests, many of which interact over HTTPS with 3rd Party Blockchain Providers (3PBPs) and/or the Scoop [Data Storage Contract](https://github.com/Scoop-Tech/scpx-eos). Pull requests are welcome, as are contributions for more fine-grained unit tests.

  * [Create a new receive address for all asset types](./tests/integration.test.js)
  * [Fetch suggested network fee rates for all asset types](./tests/integration.test.js)
  * [Create a new in-memory wallet](./tests/integration.test.js)
  * [Dump a wallet](./tests/integration.test.js)
  * [Reinitialize a known wallet in-memory](./tests/integration.test.js)
  * [Persist a wallet to and from file](./tests/integration.test.js)
  * [Persist a wallet to and from the Data Storage Contract](./tests/integration.test.js)
  * [Connect a wallet to 3PBPs](./tests/integration.test.js)
  * [Import and remove private keys](./tests/integration.test.js)
  * [Connect 3PBP (Insight REST API), create tx hex, compute tx fees and push a tx for UTXO-model BTC_TEST](./tests/integration.test.js)
  * [Connect 3PBP (Blockbook WS API), create tx hex, compute tx fees and push a tx for UTXO-model ZEC_TEST](./tests/integration.test.js)
  * [Connect 3PBP (Blockbook WS API + Geth RPC), create tx hex, compute tx fees and push a tx for account-model ETH_TEST](./tests/integration.test.js)
  
## Contributing

Please see the [Contribution Guide](./CONTRIBUTING.md) for more info.

## Debugging

Visual Studio Code is recommended. A template ./vscode/launch.json with some common launch actions: 

```
{
    "version": "0.2.0",
    "configurations": [
        // LOAD SERVER WALLET
        {
            "type": "node",
            "request": "launch",
            "env": {
                "NODE_OPTIONS": "--experimental-worker",
                "NODE_ENV": "development"
            },
            "stopOnEntry": false,
            "runtimeVersion": "14.21.3",
            "name": "wallet-dev",
            "program": "${workspaceFolder}/ext/wallet/sw-cli.js",
            "args": ["--rpc=true",
                     "--rpcPort=4000",
                     "--rpcRemoteHosts=::ffff:127.0.0.1",
                     "--rpcUsername=scp",
                     "--rpcPassword=123",
                     //"--mpk=...", 
                     //"--loadServer=...",
                     "--saveHistory=true"
                    ],
            "console": "externalTerminal",
            "runtimeExecutable": "node",
            "runtimeArgs": ["--nolazy"],
            "autoAttachChildProcesses": true
        },

        // NEW LOCAL EMPTY WALLET, OR LOAD FILE WALLET
        {
            "name": "local: new",
            "type": "node",
            "request": "launch",
            "env": {
                "NODE_OPTIONS": "--experimental-worker",
                "NODE_ENV": "development"
            },
            "stopOnEntry": false,
            "runtimeVersion": "14.21.3",
            "program": "${workspaceFolder}/ext/wallet/sw-cli.js",
            "args": [//"--mpk=...", 
                     //"--loadFile=...",
                     "--rpc=true",
                     "--rpcPort=4000",
                     "--rpcRemoteHosts=::ffff:127.0.0.1",
                     "--rpcUsername=scp",
                     "--rpcPassword=.....",
                     "--saveHistory=true"
                    ],
                    
            "console": "externalTerminal",
            "runtimeExecutable": "node",
            "runtimeArgs": ["--nolazy"],
            "autoAttachChildProcesses": true
        },

        // RUN TESTS
        {
            "name": "tests: integration",
            "type": "node",
            "request": "launch",    
            "env": {
                "NODE_OPTIONS": "--experimental-worker",
                "NODE_ENV": "test"
            },
            "stopOnEntry": false,
            "runtimeVersion": "14.21.3",
            "program": "${workspaceFolder}/ext/wallet/node_modules/.bin/jest",
            "args": ["--runInBand", "--verbose", "--forceExit", "--env=node", "--coverage", 
                   //"-t=DSIG"
                    ], 
            "autoAttachChildProcesses": true,
            "console": "externalTerminal",
            "internalConsoleOptions": "neverOpen",
            "windows": {
              "program": "${workspaceFolder}/node_modules/jest/bin/jest",
            }        
        }
    ]
}
```
