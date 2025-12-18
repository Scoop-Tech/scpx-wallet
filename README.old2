#
# PAIN & SUFFERING
# as-of Feb '24
#

# Env
//
// #### WARNING: node v16.13.0 (and other 16's?) result in loadAllAssets never resolving (something prevents state changes on lastAssetUpdateAt?)
//               (node v18 seems ok for future upgrading...)
//
`nvm use 14.16.0` 
`npm i --g yarn`
`rm ./node_modules/ -rf && yarn install`

# For core logging set:
`export NODE_ENV=development`

---

# Scoop Core Wallet 

[![NPM](https://nodei.co/npm/scpx-wallet.png)](https://nodei.co/npm/scpx-wallet/)

[![npm version](https://badge.fury.io/js/scpx-wallet.svg)](https://badge.fury.io/js/scpx-wallet)
[![Build Status](https://travis-ci.com/Scoop-Tech/scpx-wallet.svg?branch=master)](https://travis-ci.com/Scoop-Tech/scpx-wallet)
[![codecov](https://codecov.io/gh/Scoop-Tech/scpx-wallet/branch/master/graph/badge.svg)](https://codecov.io/gh/Scoop-Tech/scpx-wallet)
![GitHub top language](https://img.shields.io/github/languages/top/Scoop-Tech/scpx-wallet.svg)

## About

Scoop is a decentralised, open-source multi-platform and multi-asset HD ([BIP44](https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki)) wallet framework. It is intended to allow for rapid deployment of additional crypto assets into the framework, and the modular addition of additional blockchain features (see [Roadmap](#Roadmap) below). 

Current priority and WIP item is [BitProtect](https://github.com/Scoop-Tech/scpx-wallet/issues/55).

The architectural components of Scoop are as follows:

  * **SCPX-WALLET** - Core Wallet (this repo) - node.js and browser-compatible core wallet functions (layer 1 encryption)
  * **SCPX-APP** - [Web Wallet](https://scoop.tech)
  * **SCPX-SVR** - [API Server](https://github.com/Scoop-Tech/scpx-svr) API
  * **SCPX-EOS** - [Data Storage Contract](https://github.com/Scoop-Tech/scpx-eos)
  
For maintenance of user accounts and settings, Scoop Web Client user accounts are persisted by a [Data Storage Contract (DSC)](https://github.com/Scoop-Tech/scpx-eos) on a public instance of the EOS blockchain (see: https://github.com/EOSIO/eos/issues/4173 - re. philosophical differences of opinion re. EOS mainnet). Core Wallets can be persisted to file, in-memory or through the DSC.

Scoop uses three levels of data encryption: one round of encryption in browser storage, another round in the commn Core Wallet, and a third round of encryption in the API layer. See [Scoop Security](https://github.com/Scoop-Tech/scpx-svr/blob/master/SECINFO.md) for details on the security and encryption model.

## Core Wallet - CLI Demo
[![Core Wallet - CLI demo](http://img.youtube.com/vi/KvB2Bzebs-M/0.jpg)](http://www.youtube.com/watch?v=KvB2Bzebs-M "Core Wallet - CLI demo") 

## Web Wallet - QR & Face ID demo
[![Web Wallet - QR & Face ID demo](https://i.ytimg.com/vi/HLX9oyYlafI/hqdefault.jpg)](https://www.youtube.com/watch?v=HLX9oyYlafI "Web Wallet - QR & Face ID demo")

## Running the Core Wallet CLI: from NPM
  * ```npm i --g scpx-wallet```
  * ```sw-cli --help```

## Running the Core Wallet CLI: from source
  * ```npm i```
  * ```npm start``` (or ```npm run dev``` for dev flags)
  * ```npm run rpc```for example RPC usage

Type ```.help``` in the CLI for a full list of commands.

## Features

  * **Multi Platform**: all blockchain operations are 100% local JS, and are accessible on phones, desktops and servers.

  * **Multi Asset**: UTXO and account-type (including ERC20) assets are supported - currently: BTC legacy, BTC Segwit, Litecoin, Ethereum, ZCash, Dash, Vertcoin, Qtum, DigiByte, BTC and ETH testnets, and ERC20s: Binance Token, TrueUSD, Bancor, 0x, BAT, OmiseGo, Status Network Token, Gifto, Huobi Token, USD Tether and EUR Tether. See [here](https://github.com/Scoop-Tech/scpx-wallet/issues/10) for planned enhancement.

  * **Anonomyous**: only a one-way irreversible hash of a user's (optionally) personally-identifiable data (registered email address) is persisted. This is by default a fully anonymous randomally generated email address: supplying of a valid or personally-identifiable email is optional. See [here](https://github.com/Scoop-Tech/scpx-wallet/issues/11) for planned enhancement.
    
  * **Cryptographically Secure & Deterministic**: data encryption (both at rest in the client and in transit between the server and the data store) are applied. Only a hash of an account's master private key (MPK) can decrypt that account's sub-asset private keys. The MPK or its hash never leave the browser or server. Sub-asset private keys can be derived from a known MPK into a new account. See [here](https://github.com/Scoop-Tech/scpx-wallet/issues/2) for planned enhancement.

  * **Decentralised & Store Agnostic**: wallets can be held in-memory, encrypted in file, or double-encrypted in the Scoop [Data Storage Contract](https://github.com/Scoop-Tech/scpx-eos): DSC user data is held in an EOS data table running on a block producing public sidechain. See [here](https://github.com/Scoop-Tech/scpx-wallet/issues/1) for planned enhancement.

  * **Key Import**: sub-asset private keys can be imported in bulk from native wallets (e.g. [`dumpprivkey`](https://bitcoincore.org/en/doc/0.16.0/rpc/wallet/dumpprivkey/)) or other sources. Funds are not moved in the process and imported keys are subject to the same multi-layer encryption as native Scoop keys. See [here](https://github.com/Scoop-Tech/scpx-wallet/issues/6) for planned enhancement.

  * **Asset Conversion**: (Web Wallet) currently implemented with Changelly. See [here](https://github.com/Scoop-Tech/scpx-wallet/issues/8) for planned enhancement.

  * **Runtime Secure**: (Web Wallet) Content Security Policy (CSP) restricts script execution to verified sources (resistant to XSS) and (in High Security) mode the the hash is not persisted to browser storage (resistant to extension content script injection). See [here](https://github.com/Scoop-Tech/scpx-wallet/issues/5) for planned enhancement.

  * **Cloud Login**: (Web Wallet) optionally persist (and delete) double-encrypted MPK data to Firebase Realtime DB for cross-device login. See [here](https://github.com/Scoop-Tech/scpx-wallet/issues/9) for planned enhancement.

## Roadmap

  * [BitProtect](https://github.com/Scoop-Tech/scpx-wallet/issues/55)

  * [CryptoMail](https://github.com/Scoop-Tech/scpx-wallet/issues/19)

  * [Fiat In](https://github.com/Scoop-Tech/scpx-wallet/issues/15)

  * [Multi-Sig](https://github.com/Scoop-Tech/scpx-wallet/issues/12)

  * [Scoop Contracts](https://github.com/Scoop-Tech/scpx-wallet/issues/14)

  * Crypto Insurance - private key transfer/custody to cold-storage, release to Scoop Contracts-governed beneficiaries, third party contact adjudication.
  
  * Masternode Shares - two-way market for asset transfer to fund masternode shares, secured agasinst an operating entity's assets by Scoop Contracts, payouts governed by EOS CPP contracts.

  * PoW Mining Shares - two-way market hashpower market, asset transfer purchases backed by Scoop Contracts, payouts governed by EOS CPP contracts.
  
  * Fiat Out - make fiat purchases backed by crypto assets, with a pre-paid card either physical or NFC-virtual.

  * Derivative Products - asset transfers for diversification or deriviate products backed by Scoop Contracts, e.g. crypto options, crypto CFDs, algo trading.

Major roadmap items are tracked [here](https://github.com/Scoop-Tech/scpx-wallet/labels/major%20feature).

## Help Wanted

Scoop Wallet is self-funded and community driven. If you can [help](https://github.com/Scoop-Tech/scpx-wallet/labels/help%20wanted) in any of these areas, please reach out to us.

## Development

Please see the [Development Guide](./DEVELOPMENT.md) for info on building locally.

## Issues

The integrated GitHub [issue tracker](https://github.com/Scoop-Tech/scpx-wallet/issues) is used for this project. When reporting security issues, responsible disclosure is encouraged: please contact us directly at dom+scpx@d0m1.com.



