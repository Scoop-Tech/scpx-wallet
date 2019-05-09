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

The architectural components of Scoop are (collectively, **"SCPX"**) as follows:

  * **SCPX-EOS** - [Data Storage Contract](https://github.com/Scoop-Tech/scpx-eos)
  * **SCPX-SVR** - API [Web Server](https://github.com/Scoop-Tech/scpx-svr) (layer 2 encryption)
  * **SCPX-WALLET** - Core Wallet (this repo) - node.js and browser-compatible core wallet functions (layer 1 encryption)
  * **SCPX-APP** - [Wallet Web Client](https://x.scoop.tech) (layer 0 encryption)
 
For maintenance of user accounts and settings, Scoop user accounts are persisted by a [Data Storage Contract](https://github.com/Scoop-Tech/scpx-eos) on a public instance of the EOS blockchain (see: https://github.com/EOSIO/eos/issues/4173 - re. philosophical differences of opinion re. EOS mainnet).

Scoop uses three levels of data encryption: one round of encryption in browser storage, another round in the commn Core Wallet layer, and a third round of encryption in the API layer. See [Scoop Security](https://github.com/Scoop-Tech/scpx-svr/blob/master/sec.md) for full details on SCPX's security and encryption model.

## CLI Overview ...

TODO: video, list of commands, etc.

This repo contains the open-source Core Wallet with integrated JS REPL command line interface. The Core Wallet is decoupled from the Data Storage Contract and instead uses local ```wallet_xxx.dat``` encrypted files for persistence.

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



