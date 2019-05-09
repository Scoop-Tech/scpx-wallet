# Scoop Core Wallet 

[![NPM](https://nodei.co/npm/scpx-wallet.png)](https://nodei.co/npm/scpx-wallet/)

[![npm version](https://badge.fury.io/js/scpx-wallet.svg)](https://badge.fury.io/js/scpx-wallet)
[![Build Status](https://travis-ci.com/Scoop-Tech/scpx-wallet.svg?branch=master)](https://travis-ci.com/Scoop-Tech/scpx-wallet)
[![codecov](https://codecov.io/gh/Scoop-Tech/scpx-wallet/branch/master/graph/badge.svg)](https://codecov.io/gh/Scoop-Tech/scpx-wallet)
![GitHub top language](https://img.shields.io/github/languages/top/Scoop-Tech/scpx-wallet.svg)
![GitHub code size in bytes](https://img.shields.io/github/languages/code-size/Scoop-Tech/scpx-wallet.svg)
![GitHub repo size](https://img.shields.io/github/repo-size/Scoop-Tech/scpx-wallet.svg)

Release Candidate 3

Scoop is a decentralised, open-source multi-platform and multi-asset HD ([BIP44](https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki)) wallet framework. The architecture is intended to allow for rapid deployment of additional crypto assets into the framework, and the modular addition of additional blockchain features (see [Roadmap](./ROADMAP.md)).

The architectural components of Scoop are (collectively, "SCPX") as follows:

  * **SCPX-WALLET** - Core Wallet (this repo) - node.js and browser-compatible core wallet functions (layer 1 encryption)
  * **SCPX-APP** - [Wallet Web Client](https://x.scoop.tech) (layer 0 encryption)
  * **SCPX-SVR** - [Web Server](https://github.com/Scoop-Tech/scpx-svr) API (layer 2 encryption)
  * **SCPX-EOS** - [Data Storage Contract](https://github.com/Scoop-Tech/scpx-eos)
  
For maintenance of user accounts and settings, Scoop Web Client user accounts are persisted by a [Data Storage Contract (DSC)](https://github.com/Scoop-Tech/scpx-eos) on a public instance of the EOS blockchain (see: https://github.com/EOSIO/eos/issues/4173 - re. philosophical differences of opinion re. EOS mainnet). Core Wallets can be persisted to file, in-memory or through the DSC.

Scoop uses three levels of data encryption: one round of encryption in browser storage, another round in the commn Core Wallet, and a third round of encryption in the API layer. See [Scoop Security](https://github.com/Scoop-Tech/scpx-svr/blob/master/sec.md) for full details on the security and encryption model.

## Running the Core Wallet CLI

  * ```npm i --g scpx-wallet```
  * ```sw-cli```

Use ```.help``` for CLI command help. Key CLI commands:

```
.agf     HELP  (asset-get-fees) - fetches recommended network fee rates from oracles
        --s        [string]              <required>  the asset to get fee rates for, e.g. "ETH" or "BTC"

.lt      HELP  .lt (log-tail) - tails (doesn't follow) the last n lines of the debug log
        --n        [int]                 [optional]  number of lines to tail (default: 100)
        --debug    [bool]                [optional]  tails the verbose (debug) log instead of the info log (default: false)

.txgf    HELP  (tx-get-fee) - gets the network fee for the specified single-recipient transaction
        --mpk      <master private key>  <required>
        --s        [string]              <required>  the asset to use for the fee estimate, e.g. "ETH" or "BTC"
        --v        [number]              <required>  the send value to use for the fee estimate, e.g. 0.01

.txp     HELP  (tx-push) - broadcasts the specified single-recipient transaction
        --mpk      <master private key>  <required>
        --s        [string]              <required>  the asset to use for the transaction, e.g. "ZEC"
        --v        [number]              <required>  the amount to send, e.g. 0.01
        --a        [string]              <required>  the recipient address, e.g. "t1RGM2uztDM3iqGjBsK7UvuLFAYiSJWczLh"

.waa     HELP  (wallet-add-address) - adds a receive address to the loaded wallet for the specified asset
        --mpk         <master private key>  <required>
        --s           [string]              <required>  the asset for which to add an address, e.g. "ETH" or "BTC"

.wb      HELP  (wallet-balance) - shows aub-asset balances in the loaded wallet
        --s           [string]              <required>  restrict output to supplied asset symbol if supplied, e.g. "ETH" or "BTC"

.wc      HELP  (wallet-connect) - connects to 3PBPs and populates tx and balance data for the loaded wallet

.wd      HELP  (wallet-dump) - decrypts and dumps sub-asset private key, addresses, tx and utxo values from the loaded wallet
        --mpk         <master private key>  <required>
        --s           [string]              [optional]  restrict output to supplied asset symbol if supplied, e.g. "ETH" or "BTC"
        --txs         [bool]                [optional]  dump address transactions (default: false)
        --privkeys    [bool]                [optional]  dump private keys (default: false)

.wi      HELP  (wallet-init) - recreates a wallet from supplied seed values
        --mpk         <master private key>  <required>  entropy for keygen and redux store (L1) encryption

.wipk    HELP  (wallet-import-priv-keys) - adds one or more private keys to a new import account in the loaded wallet
        --mpk         <master private key>  <required>
        --s           [string]              <required>  the asset for which to add an address, e.g. "ETH" or "BTC"
        --privKeys    [string]              <required>  comma-separated list of WIF privkeys (UXO assets) or 64 hex char (ETH assets)"

.wl      HELP  (wallet-load) - loads a previously saved wallet from file
        --mpk         <master private key>  <required>
        --n           [string]              <required>  the name of the wallet to load

.wn      HELP  (wallet-new) - creates and persists in-memory a new wallet with new random seed values

.wrpk    HELP  (wallet-remove-priv-keys) - removes an import account and its associated private keys from the loaded wallet
        --mpk         <master private key>  <required>
        --s           [string]              <required>  the asset for which to add an address, e.g. "ETH" or "BTC"
        --accountName [string]              <required>  the import account name to remove e.g. "Import #1 BCash ABC"

.ws      HELP  (wallet-save) - saves the loaded wallet in encrypted form to file
        --mpk         <master private key>  <required>
        --n           [string]              <required>  a name for the saved wallet; the wallet can subsequently be loaded by this name
        --f           [bool]                [optional]  overwrite (without warning) any existing file with the same name (default: false)

.wsl     HELP  (wallet-server-load) - loads a previously saved wallet from the Scoop Data Storage Contract
        --mpk         <master private key>  <required>
        --e           [string]              <required>  the pseudo-email of the wallet in the Scoop Data Storage Contract, e.g. "x+7dgy0soek3gvn@scoop.tech"

.wss     HELP  (wallet-server-save) - saves a previously loaded server wallet back to the Scoop Data Storage Contract
        --mpk         <master private key>  <required>
```

## Features

  * **Multi Platform**: all external blockchain operations are 100% client-side JS, and are accessible on phones, desktops and servers. See [here](https://github.com/Scoop-Tech/scpx-wallet/issues/3) for planned enhancement.

  * **Multi Asset**: UTXO and account-type (including ERC20) assets are supported - currently: BTC legacy, BTC Segwit, Litecoin, Ethereum, ZCash, Dash, Vertcoin, Qtum, DigiByte, BTC and ETH testnets, and ERC20s: Binance Token, TrueUSD, Bancor, 0x, BAT, OmiseGo, Status Network Token, Gifto, Huobi Token, USD Tether and EUR Tether. See [here](https://github.com/Scoop-Tech/scpx-wallet/issues/10) for planned enhancement.

  * **Anonomyous**: with respect to personally-identifiable data, only a one-way irreversible hash of a user's registered email address is persisted. This is by default a fully anonymous randomally generated email address: supplying of a valid or personally-identifiable email is optional. See [here](https://github.com/Scoop-Tech/scpx-wallet/issues/11) for planned enhancement.
    
  * **Cryptographically Secure & Deterministic**: data encryption (both at rest in the client and in transit between the server and the data store) are applied. Only a hash of an account's master private key (MPK) can decrypt that account's sub-asset private keys. The MPK or its hash never leave the browser. Sub-asset private keys can be derived from a known MPK into a new account. See [here](https://github.com/Scoop-Tech/scpx-wallet/issues/2) for planned enhancement.

  * **Decentralised & Store Agnostic**: wallets can be held in-memory, in file, or in the Scoop [Data Storage Contract](https://github.com/Scoop-Tech/scpx-eos): DSC user data is held in an EOS data table running on a block producing public sidechain. See [here](https://github.com/Scoop-Tech/scpx-wallet/issues/1) for planned enhancement.

  * **Key Import**: sub-asset private keys can be imported in bulk from native wallets (e.g. [`dumpprivkey`](https://bitcoincore.org/en/doc/0.16.0/rpc/wallet/dumpprivkey/)) or other sources. Funds are not moved in the process and imported keys are subject to the same multi-layer encryption as native Scoop keys. See [here](https://github.com/Scoop-Tech/scpx-wallet/issues/6) for planned enhancement.

  * **Asset Conversion**: (Wallet Web Client) currently implemented with Changelly. See [here](https://github.com/Scoop-Tech/scpx-wallet/issues/8) for planned enhancement.

  * **Runtime Secure**: (Wallet Web Client) Content Security Policy (CSP) restricts script execution to verified sources (resistant to XSS) and (in High Security) mode the the hash is not persisted to browser storage (resistant to extension content script injection). See [here](https://github.com/Scoop-Tech/scpx-wallet/issues/5) for planned enhancement.

  * **Cloud Login**: (Wallet Web Client) optionally persist (and delete) double-encrypted MPK data to Firebase Realtime DB for cross-device login. See [here](https://github.com/Scoop-Tech/scpx-wallet/issues/9) for planned enhancement.

## Roadmap
  * [CryptoMail](https://github.com/Scoop-Tech/scpx-wallet/issues/19)

  * [Fiat In](https://github.com/Scoop-Tech/scpx-wallet/issues/15)

  * [Multi-Sig](https://github.com/Scoop-Tech/scpx-wallet/issues/12)

  * [Scoop Contracts](https://github.com/Scoop-Tech/scpx-wallet/issues/14)

  * Crypto Insurance - private key transfer/custody to cold-storage, release to Scoop Contracts-governed beneficiaries, third party contact adjudication.
  
  * Masternode Shares - two-way market for asset transfer to fund masternode shares, secured agasinst an operating entity's assets by Scoop Contracts, payouts governed by EOS CPP contracts.

  * PoW Mining Shares - two-way market hashpower market, asset transfer purchases backed by Scoop Contracts, payouts governed by EOS CPP contracts.
  
  * Fiat Out - make fiat purchases backed by crypto assets, with a pre-paid card either physical or NFC-virtual.

  * Derivative Products - asset transfers for diversification or deriviate products backed by Scoop Contracts, e.g. crypto options, crypto CFDs, algo trading.

## Development

Please see the [Development Guide](./DEVELOPMENT.md) for info on building locally.

## Issues

The integrated GitHub [issue tracker](https://github.com/Scoop-Tech/scpx-wallet/issues) is used for this project. When reporting security issues, responsible disclosure is encouraged: please contact us directly at security@scoop.tech.



