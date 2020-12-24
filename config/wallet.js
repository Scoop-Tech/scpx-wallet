// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2020 Dominic Morris.

const npmPackage = require('../package.json')
const isNode = require('detect-node')
const axios = require('axios')

const IS_DEV = (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test")

//const utilsWallet = require('../utils')
const configWalletExternal = require('./wallet-external')

// static - license, copyright, env
const WALLET_VER = 'RC-' + require('../package.json').version
const WALLET_COPYRIGHT = `Distributed under the ${npmPackage.license} license: see /LICENSE for terms. Copyright 2019-2020 Dominic Morris.`
const WALLET_ENV = isNode ? "SERVER" : "BROWSER"

// static - asset types
const WALLET_TYPE_UTXO = 'WALLET_TYPE_UTXO'
const WALLET_TYPE_ACCOUNT = 'WALLET_TYPE_ACCOUNT'

// static - address types
const ADDRESS_TYPE_BTC = 'BTC'
const ADDRESS_TYPE_BECH32 = 'BECH32'
const ADDRESS_TYPE_LTC = 'LTC'
const ADDRESS_TYPE_ETH = 'ETH'
const ADDRESS_TYPE_EOS = 'EOS'
const ADDRESS_TYPE_ZEC_T = 'ZEC'
const ADDRESS_TYPE_DASH = 'DASH'
const ADDRESS_TYPE_VTC = 'VTC'
const ADDRESS_TYPE_QTUM = 'QTUM'
const ADDRESS_TYPE_DGB = 'DGB'
const ADDRESS_TYPE_BCHABC = 'BCH'
const ADDRESS_TYPE_RVN = 'RVN'

// static - price sources
const PRICE_SOURCE_CRYPTOCOMPARE = 'CC'   // primary
const PRICE_SOURCE_BITFINEX = 'BF'        // ## no CORS headers, not usable - todo: move to WS (no CORS) interface, make bitfinex WS primary
const PRICE_SOURCE_SYNTHETIC_FIAT = 'SYF' // hack for using a base fiat price (eurt)

// config - dbg/test
const WALLET_INCLUDE_BTC_TEST = false //(process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test")
const WALLET_INCLUDE_ZEC_TEST = false //(process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test")
const WALLET_INCLUDE_LTC_TEST = false

const WALLET_INCLUDE_TUSD_TEST = false
const WALLET_INCLUDE_AIRCARBON_TEST = true
const WALLET_INCLUDE_SINGDAX_TEST = true
const WALLET_INCLUDE_AYONDO_TEST = true
const WALLET_INCLUDE_ETH_TEST = true // always include eth_test - so it can be available in prod for testnets2@scoop.tech
                                // WALLET_INCLUDE_AIRCARBON_TEST || 
                                // WALLET_INCLUDE_SINGDAX_TEST || 
                                // WALLET_INCLUDE_AYONDO_TEST || 
                                // (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test")

const WALLET_DISABLE_BLOCK_UPDATES = false

// wallet config - internal
const WALLET_BIP44_COINTYPE_UNREGISTERED = 100000           // we start at this value for unregistered BIP44 coin-types (https://github.com/satoshilabs/slips/blob/master/slip-0044.md)

// wallet api
//const API_DOMAIN =`http://localhost:3030/`
const API_DOMAIN = `https://scp-svr.azurewebsites.net/`
const API_URL = `${API_DOMAIN}api/`
//
// RE. ADDING NEW TYPES -- add here (below, main asset list), and in:
//
//   add also: config/wallet-external.js
//   add also: config/websockets.js (prices, insight and BB)
//   add also: reducers/prices.js + actions/index
//   add also: commons.scss (:root)
//   add also: getSupportedWalletTypes() (below)
//
// for new utxo-types:
//
//   add to generateWalletAccount()
//   add to getUtxoNetwork()
//   add to estimateFees_Utxo()
//   add to createTxHex() / measure base tx size / test etc.
//   add to WalletDetailKeyImport.textChange()
//   ( add to addressMonitors_Sub_Unsub() )
//   ( add to getUtxoTypeAddressFromWif() )
//   ( add to getAddressBalance_External() and getAddressFull_External() )
//   ( add to blockbook_pushTx() )
//   ( add to pushRawTransaction_Utxo() )
//   ( add to GET_ANY_ADDRESS_BALANCE in worker.js )
//   add to LIGHTS!
//    ...
// 
// ***** !! object keys and .name properties must match !! *****
// ** use "(t)" for testnets **
// ** use cryptocompare symbol in displaySymbol field, (or in priceSource_CC_symbol) **
//

// default static assets
// augmented with dynamic (network fetched) ERC20's
var supportedWalletTypes = [ // use walletsMeta keys for this list
    'bitcoin', 'litecoin', 'ethereum', 'eos', 'btc(s)', 'btc(s2)', 'zcash',
    'dash', 'vertcoin', 'qtum', 'digibyte', 'bchabc',
    'raven',

    //'bnb', // erc20 old
    'trueusd', 'bancor', '0x', 'bat',
    'omg', 'snt', //'gto', 'ht', // retiring - not liked
    //'btm', // on mainnet, erc20 deprecated
    //'ven', // on mainnet, erc20 deprecated
    'usdt', 'eurt',
    'mkr', 'rep', 'hot', 'zil', 'link',
    'nexo',

    'band', 'dos', 'ring', 'swap'

    // todo 
    //'tgbp' (new)
] 

var walletsMeta = {
    // utxo's
    'btc(s2)': {
        name: 'btc(s2)',
        use_BBv3: true,
        web: 'https://bitcoin.org/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_UTXO,
        addressType: ADDRESS_TYPE_BECH32,
        symbol: 'BTC_SEG2',
        displayName: 'Bitcoin',
        desc: 'Bech32', //'SegWit (P2WPKH) Bech32',
        displaySymbol: 'BTC',
        imageUrl: 'img/asset-icon/btc_seg2.png',
        primaryColor: '#f2a235',
        sortOrder: 0,
        bip44_index: 0, // ##
        tx_perInput_vsize: 69,
        tx_perInput_byteLength: 151,
        tradingViewSymbol: "BITFINEX:BTCUSD",
    },
    'btc(s)': {
        name: 'btc(s)',
        use_BBv3: true,
        web: 'https://bitcoin.org/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_UTXO,
        addressType: ADDRESS_TYPE_BTC,
        symbol: 'BTC_SEG',
        displayName: 'Bitcoin',
        desc: 'P2SH', //'SegWit (P2SH)',
        displaySymbol: 'BTC',
        imageUrl: 'img/asset-icon/btc_seg2.png',
        primaryColor: '#f2a235',
        sortOrder: 1,
        bip44_index: 0, // ##
        tx_perInput_vsize: 92, 
        tx_perInput_byteLength: 174,
        tradingViewSymbol: "BITFINEX:BTCUSD",
    },
    'bitcoin': {
        name: 'bitcoin',
        use_BBv3: true,
        web: 'https://bitcoin.org/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_UTXO,
        addressType: ADDRESS_TYPE_BTC,
        symbol: 'BTC',
        displayName: 'Bitcoin',
        desc: undefined,
        displaySymbol: 'BTC',
        imageUrl: 'img/asset-icon/btc.png',
        primaryColor: '#f2a235',
        sortOrder: 2,
        bip44_index: 0, // ##
        tx_perInput_vsize: 148, //147,
        tx_perInput_byteLength: 148, //147,
        tradingViewSymbol: "BITFINEX:BTCUSD",
    },
    'btc(t)': { // insight api - legacy
        name: 'btc(t)',
        use_Insightv2: true,
        type: WALLET_TYPE_UTXO,
        addressType: ADDRESS_TYPE_BTC,
        symbol: 'BTC_TEST',
        displayName: 'BTC#',
        desc: 'Testnet3',
        displaySymbol: 'BTC#',
        imageUrl: 'img/asset-icon/btc_test2.png',
        primaryColor: '#f2a235',
        sortOrder: 888,
        bip44_index: 1, // ##
        tx_perInput_vsize: 148,
        tx_perInput_byteLength: 148,
        tradingViewSymbol: "BITFINEX:BTCUSD",
    },

    'litecoin': {
        name: 'litecoin',
        use_BBv3: true,
        web: 'https://litecoin.org/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_UTXO,
        addressType: ADDRESS_TYPE_LTC,
        symbol: 'LTC',
        displayName: 'Litecoin',
        desc: undefined,
        displaySymbol: 'LTC',
        imageUrl: 'img/asset-icon/ltc.png',
        primaryColor: '#535353',
        sortOrder: 9,
        bip44_index: 2, // ##
        tx_perInput_vsize: 148,
        tx_perInput_byteLength: 148,
        tradingViewSymbol: "BINANCE:LTCBTC",
    },
    'ltc(t)': {
        name: 'ltc(t)',
        use_BBv3: true,
        type: WALLET_TYPE_UTXO,
        addressType: ADDRESS_TYPE_LTC,
        symbol: 'LTC_TEST',
        displayName: 'LTC#',
        desc: 'Testnet4',
        displaySymbol: 'LTC#',
        imageUrl: 'img/asset-icon/ltc_test.png',
        primaryColor: '#f2a235',
        sortOrder: 777,
        bip44_index: 2, // ##
        tx_perInput_vsize: 148,
        tx_perInput_byteLength: 148,
        tradingViewSymbol: "BINANCE:LTCBTC",
    },

    'zcash': {
        name: 'zcash',
        use_BBv3: true,
        web: 'https://z.cash/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_UTXO,
        addressType: ADDRESS_TYPE_ZEC_T,
        symbol: 'ZEC',
        displayName: 'ZCash',
        desc: undefined,
        displaySymbol: 'ZEC',
        imageUrl: 'img/asset-icon/zec.png',
        primaryColor: '#F4B728',
        sortOrder: 10,
        bip44_index: 133, // ##
        tx_perInput_vsize: 147,
        tx_perInput_byteLength: 147,
        tradingViewSymbol: "BINANCE:ZECBTC",
    },
    'zcash(t)': {
        name: 'zcash(t)',
        use_BBv3: true,
        web: 'https://z.cash/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_UTXO,
        addressType: ADDRESS_TYPE_ZEC_T,
        symbol: 'ZEC_TEST',
        displayName: 'ZEC#',
        desc: 'Testnet',
        displaySymbol: 'ZEC#',
        imageUrl: 'img/asset-icon/zec_test.png',
        primaryColor: '#F4B728',
        sortOrder: 666, 
        bip44_index: 133, // ##
        tx_perInput_vsize: 147,
        tx_perInput_byteLength: 147,
        tradingViewSymbol: "BINANCE:ZECBTC",
    },

    'bchabc': {
        name: 'bchabc',
        use_BBv3: true,
        web: 'https://www.bitcoinabc.org/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        priceSource_CC_symbol: 'BCH',
        type: WALLET_TYPE_UTXO,
        addressType: ADDRESS_TYPE_BCHABC,
        symbol: 'BCHABC',
        displayName: 'Bitcoin Cash',
        desc: 'ABC',
        displaySymbol: 'BCHABC',
        imageUrl: 'img/asset-icon/bchabc.png',
        primaryColor: '#380E09',
        sortOrder: 11,
        bip44_index: 145,
        tx_perInput_vsize: 148,
        tx_perInput_byteLength: 148,
        tradingViewSymbol: "BINANCE:BCHABCBTC",
    },
    'dash': {
        name: 'dash',
        use_BBv3: true,
        web: 'https://dash.org/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_UTXO,
        addressType: ADDRESS_TYPE_DASH,
        symbol: 'DASH',
        displayName: 'Dash',
        desc: undefined,
        displaySymbol: 'DASH',
        imageUrl: 'img/asset-icon/dash.png',
        primaryColor: '#E38C00',
        sortOrder: 20,
        bip44_index: 5,
        tx_perInput_vsize: 147,
        tx_perInput_byteLength: 147,
        tradingViewSymbol: "BINANCE:DASHBTC",
    },
    'vertcoin': {
        name: 'vertcoin',
        use_BBv3: true,
        web: 'https://vertcoin.org/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_UTXO,
        addressType: ADDRESS_TYPE_VTC,
        symbol: 'VTC',
        displayName: 'Vertcoin',
        displaySymbol: 'VTC',
        desc: undefined,
        imageUrl: 'img/asset-icon/vtc.png',
        primaryColor: '#2C5C20',
        sortOrder: 21,
        bip44_index: 28,
        tx_perInput_vsize: 147,
        tx_perInput_byteLength: 147,
        tradingViewSymbol: "BITTREX:VTCBTC",
    },
    'qtum': {
        name: 'qtum',
        use_BBv3: true,
        web: 'https://qtum.org/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_UTXO,
        addressType: ADDRESS_TYPE_QTUM,
        symbol: 'QTUM',
        displayName: 'Qtum',
        desc: undefined,
        displaySymbol: 'QTUM',
        imageUrl: 'img/asset-icon/qtum.png',
        primaryColor: '#D09A44',
        sortOrder: 19,
        bip44_index: 2301,
        tx_perInput_vsize: 147,
        tx_perInput_byteLength: 147,
        tradingViewSymbol: "BINANCE:QTUMBTC",
    },
    'digibyte': {
        name: 'digibyte',
        use_BBv3: true,
        web: 'https://digibyte.io/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_UTXO,
        addressType: ADDRESS_TYPE_DGB,
        symbol: 'DGB',
        displayName: 'DigiByte',
        desc: undefined,
        displaySymbol: 'DGB',
        imageUrl: 'img/asset-icon/dgb.png',
        primaryColor: '#4F2109',
        sortOrder: 22,
        bip44_index: 20, 
        tx_perInput_vsize: 148,
        tx_perInput_byteLength: 148,
        tradingViewSymbol: "BITTREX:DGBBTC",
    },

    'raven': {
        name: 'raven',
        use_BBv3: true,
        web: 'https://ravencoin.org/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_UTXO,
        addressType: ADDRESS_TYPE_RVN,
        symbol: 'RVN',
        displayName: 'Ravencoin',
        desc: undefined,
        displaySymbol: 'RVN',
        imageUrl: 'img/asset-icon/rvn.png',
        primaryColor: '#E7B35B',
        sortOrder: 23,
        bip44_index: 175, // https://github.com/satoshilabs/slips/blob/master/slip-0044.md
        tx_perInput_vsize: 92, // ?
        tx_perInput_byteLength: 174, // ?
        tradingViewSymbol: "BINANCE:RVNBTC",
    },

    // wip
    'eos': {
        name: 'eos',
        desc: 'Work in progress...',
        web: 'https://eos.io/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_EOS,
        symbol: 'EOS',
        displayName: 'EOS',
        displaySymbol: 'EOS',
        imageUrl: 'img/asset-icon/eos.png',
        primaryColor: '#030033',
        sortOrder: 25,
        bip44_index: 194,
        tradingViewSymbol: "BINANCE:EOSBTC",
    },

    'ethereum': {
        name: 'ethereum',
        web: 'https://ethereum.org/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_ETH,
        symbol: 'ETH',
        displayName: 'Ethereum',
        displaySymbol: 'ETH',
        imageUrl: 'img/asset-icon/eth.png',
        primaryColor: '#6e7bc4',
        sortOrder: 3,
        bip44_index: 60, // ##
        decimals: 18,
        tradingViewSymbol: "BINANCE:ETHBTC",
    },
    'eth(t)': {
        name: 'eth(t)',
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_ETH,
        symbol: 'ETH_TEST',
        displayName: 'ETH#',
        desc: 'Ropsten Testnet',
        displaySymbol: 'ETH#',
        imageUrl: 'img/asset-icon/eth_test.png',
        primaryColor: '#6e7bc4',
        sortOrder: 999,
        bip44_index: 60, // ##
        decimals: 18,
        tradingViewSymbol: "BINANCE:ETHBTC",
    },    

    // ERC20
    'trueusd': {
        name: 'trueusd',
        web: 'https://trusttoken.com/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_ETH,
        symbol: 'TUSD',
        displayName: 'TrueUSD',
        desc: 'ERC20',
        displaySymbol: 'TUSD',
        imageUrl: 'img/asset-icon/tusd.png',
        primaryColor: '#6eaffa',
        sortOrder: 4,
        //bip44_index: WALLET_BIP44_COINTYPE_UNREGISTERED + 0,
        erc20_transferGasLimit: 120000,
        decimals: 18,
        tradingViewSymbol: "BITTREX:TUSDBTC",
    },
    // 'trueusd(t)': {
    //     name: 'trueusd(t)',
    //     web: 'https://trusttoken.com/',
    //     type: WALLET_TYPE_ACCOUNT,
    //     addressType: ADDRESS_TYPE_ETH,
    //     symbol: 'TUSD_TEST',
    //     displayName: 'TrueUSD#',
    //     desc: 'Ropsten Testnet',
    //     displaySymbol: 'TUSD#',
    //     imageUrl: 'img/asset-icon/tusd_test.png',
    //     primaryColor: '#6eaffa',
    //     sortOrder: 555,
    //     //bip44_index: WALLET_BIP44_COINTYPE_UNREGISTERED + 0,
    //     erc20_transferGasLimit: 120000,
    //     decimals: 18,
    //     tradingViewSymbol: "BITTREX:TUSDBTC",
    // },
    'aircarbon(t)': { // (todo - remove, or move to dynamic)
        isErc20_Ropsten: true,
        isCashflowToken: true,
        name: 'aircarbon(t)',
        web: 'https://aircarbon.co/',
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_ETH,
        symbol: 'CCC_TEST',
        displayName: 'AirCarbon#',
        desc: 'ERC20 Ropsten Testnet',
        displaySymbol: 'CCC#',
        imageUrl: 'img/asset-icon/aircarbon_test2.png',
        primaryColor: '#6eaffa',
        sortOrder: 444,
        //bip44_index: WALLET_BIP44_COINTYPE_UNREGISTERED + 0,
        erc20_transferGasLimit: 5000000,
        erc20_gasEstimateMultiplier: 1.2, // if defined, we will use override erc20_transferGasLimit with estimateGas() and apply this multiplier
        erc20_gasMin: 300000, // if defined (and if multipler defined), we will apply this min. to estimateGas() (it's very innacurate for some reason when sending minimum qty == 1)
        decimals: 0,
        tradingViewSymbol: "BITTREX:TUSDBTC", // ### TODO...
    },
    // 'singdax(t)': { // removed: in preference for dynamic (API-driven) StMaster types
    //     isErc20_Ropsten: true,
    //     isCashflowToken: true,
    //     name: 'singdax(t)',
    //     web: 'https://singdax.co/',
    //     type: WALLET_TYPE_ACCOUNT,
    //     addressType: ADDRESS_TYPE_ETH,
    //     symbol: 'SD1A_TEST',
    //     displayName: 'SingDax 1A#',
    //     desc: 'ERC20 Ropsten Testnet',
    //     displaySymbol: 'SD1A#',
    //     imageUrl: 'img/asset-icon/SD3.png',
    //     primaryColor: '#6eaffa',
    //     sortOrder: 444,
    //     //bip44_index: WALLET_BIP44_COINTYPE_UNREGISTERED + 0,
    //     erc20_transferGasLimit: 5000000,
    //     erc20_gasEstimateMultiplier: 1.2,
    //     erc20_gasMin: 300000,
    //     decimals: 0,
    //     tradingViewSymbol: "BITTREX:TUSDBTC", // ### TODO...
    // },
    'ayondo(t)': { // (todo - remove, or move to dynamic)
        isErc20_Ropsten: true,
        isCashflowToken: true,
        name: 'ayondo(t)',
        web: 'https://ayondo.com/',
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_ETH,
        symbol: 'AY1A_TEST',
        displayName: 'ayondo 1A#',
        desc: 'ERC20 Ropsten Testnet',
        displaySymbol: 'AY1A#',
        imageUrl: 'img/asset-icon/AY1.png',
        primaryColor: '#6eaffa',
        sortOrder: 444,
        //bip44_index: WALLET_BIP44_COINTYPE_UNREGISTERED + 0,
        erc20_transferGasLimit: 5000000,
        erc20_gasEstimateMultiplier: 1.2,
        erc20_gasMin: 300000,
        decimals: 0,
        tradingViewSymbol: "BITTREX:TUSDBTC", // ### TODO...
    },
    'bancor': {
        name: 'bancor',
        web: 'https://bancor.network/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_ETH,
        symbol: 'BNT',
        desc: 'ERC20',
        displayName: 'Bancor',
        displaySymbol: 'BNT',
        imageUrl: 'img/asset-icon/bnt.png',
        primaryColor: '#010c2a',
        sortOrder: 32,
        //bip44_index: WALLET_BIP44_COINTYPE_UNREGISTERED + 1,
        erc20_transferGasLimit: 120000,
        decimals: 18,
        tradingViewSymbol: "BINANCE:BNTBTC",
    },
    '0x': {
        name: '0x',
        web: 'https://0x.org/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_ETH,
        symbol: 'ZRX',
        displayName: '0x',
        desc: 'ERC20',
        displaySymbol: 'ZRX',
        imageUrl: 'img/asset-icon/zrx.png',
        primaryColor: '#535353',
        sortOrder: 33,
        //bip44_index: WALLET_BIP44_COINTYPE_UNREGISTERED + 2,
        erc20_transferGasLimit: 120000,
        decimals: 18,
        tradingViewSymbol: "BINANCE:ZRXBTC",
    },
    'bat': {
        name: 'bat',
        web: 'https://basicattentiontoken.org/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_ETH,
        symbol: 'BAT',
        displayName: 'BAT',
        desc: 'ERC20',
        displaySymbol: 'BAT',
        imageUrl: 'img/asset-icon/bat.png',
        primaryColor: '#EC622B',
        sortOrder: 34,
        //bip44_index: WALLET_BIP44_COINTYPE_UNREGISTERED + 3,
        erc20_transferGasLimit: 120000,
        decimals: 18,
        tradingViewSymbol: "BINANCE:BATBTC",
    },
    // 'bnb': { // old erc20
    //     name: 'bnb',
    //     desc: '(ERC20)',
    //     web: 'https://binance.com/',
    //     priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
    //     type: WALLET_TYPE_ACCOUNT,
    //     addressType: ADDRESS_TYPE_ETH,
    //     symbol: 'BNB',
    //     displayName: 'Binance Coin',
    //     desc: 'ERC20',
    //     displaySymbol: 'BNB',
    //     imageUrl: 'img/asset-icon/bnb.png',
    //     primaryColor: '#eeba33',
    //     sortOrder: 35,
    //     //bip44_index: 714, //mainnet?
    //     erc20_transferGasLimit: 120000,
    //     decimals: 18,
    //     tradingViewSymbol: "BINANCE:BNBBTC",
    // },

    'omg': {
        name: 'omg',
        web: 'https://omisego.network/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_ETH,
        symbol: 'OMG',
        displayName: 'OmiseGo',
        desc: 'ERC20',
        displaySymbol: 'OMG',
        imageUrl: 'img/asset-icon/omg.png',
        primaryColor: '#2A52E8',
        sortOrder: 36,
        //bip44_index: WALLET_BIP44_COINTYPE_UNREGISTERED + 4,
        erc20_transferGasLimit: 65000,
        decimals: 18,
        tradingViewSymbol: "BINANCE:OMGBTC",
    },
    // 'gto': { // retiring - not liked
    //     name: 'gto',
    //     web: 'https://gifto.io/',
    //     priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
    //     type: WALLET_TYPE_ACCOUNT,
    //     addressType: ADDRESS_TYPE_ETH,
    //     symbol: 'GTO',
    //     displayName: 'Gifto',
    //     desc: 'ERC20',
    //     displaySymbol: 'GTO',
    //     imageUrl: 'img/asset-icon/gto.png',
    //     primaryColor: '#5F6DE6',
    //     sortOrder: 37,
    //     //bip44_index: WALLET_BIP44_COINTYPE_UNREGISTERED + 5,
    //     erc20_transferGasLimit: 120000,
    //     decimals: 5,
    //     tradingViewSymbol: "BINANCE:GTOBTC",
    // },
    'snt': {
        name: 'snt',
        web: 'https://status.im/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_ETH,
        symbol: 'SNT',
        displayName: 'Status',
        desc: 'ERC20',
        displaySymbol: 'SNT',
        imageUrl: 'img/asset-icon/snt.png',
        primaryColor: '#5F6DE6',
        sortOrder: 38,
        //bip44_index: WALLET_BIP44_COINTYPE_UNREGISTERED + 6,
        erc20_transferGasLimit: 120000,
        decimals: 18,
        tradingViewSymbol: "BINANCE:SNTBTC",
    },
    // 'ht': { // retiring - not liked
    //     name: 'ht',
    //     web: 'https://huobipro.com/',
    //     priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
    //     type: WALLET_TYPE_ACCOUNT,
    //     addressType: ADDRESS_TYPE_ETH,
    //     symbol: 'HT',
    //     displayName: 'Huobi Token',
    //     desc: 'ERC20',
    //     displaySymbol: 'HT',
    //     imageUrl: 'img/asset-icon/ht.png',
    //     primaryColor: '#C7C3C3',
    //     sortOrder: 40,
    //     //bip44_index: WALLET_BIP44_COINTYPE_UNREGISTERED + 7,
    //     erc20_transferGasLimit: 120000,
    //     decimals: 18,
    //     tradingViewSymbol: "HUOBI:HTBTC",
    // },

    // 'ven': { // old erc20 - now on its mainnet ("vet")
    //     desc: undefined,
    //     type: WALLET_TYPE_ACCOUNT,
    //     addressType: ADDRESS_TYPE_ETH,
    //     name: 'ven',
    //     symbol: 'VEN',
    //     displayName: 'VeChain',
    //     displaySymbol: 'VEN',
    //     imageUrl: 'img/asset-icon/ven.png',
    //     primaryColor: '#5CB9FE',
    //     sortOrder: 41,
    //     bip44_index: 818,
    //     erc20_transferGasLimit: 120000,
    //     decimals: 18,
    // },
    // 'btm': { // now on mainnet
    //     desc: undefined,
    //     type: WALLET_TYPE_ACCOUNT,
    //     addressType: ADDRESS_TYPE_ETH,
    //     name: 'btm',
    //     symbol: 'BTM',
    //     displayName: 'Bytom',
    //     displaySymbol: 'BTM',
    //     imageUrl: 'img/asset-icon/btm.png',
    //     primaryColor: '#504C4C',
    //     sortOrder: 39,
    //     bip44_index: 153,
    //     erc20_transferGasLimit: 120000,
    //     decimals: 8,
    // },

    'usdt': {
        name: 'usdt',
        web: 'https://tether.to/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_ETH,
        symbol: 'USDT',
        displayName: 'USD Tether',
        desc: 'ERC20',
        displaySymbol: 'USDT',
        imageUrl: 'img/asset-icon/usdt.png',
        primaryColor: '#6BAC95',
        sortOrder: 5,
        //bip44_index: WALLET_BIP44_COINTYPE_UNREGISTERED + 8,
        erc20_transferGasLimit: 120000,
        decimals: 6,
        tradingViewSymbol: "POLONIEX:USDTBTC",
    },
    'eurt': {
        name: 'eurt',
        web: 'https://tether.to/',
        priceSource: PRICE_SOURCE_SYNTHETIC_FIAT,
        syntheticFiatCcy: 'EUR',
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_ETH,
        symbol: 'EURT',
        displayName: 'EUR Tether',
        desc: 'ERC20',
        displaySymbol: 'EURT',
        imageUrl: 'img/asset-icon/eurt.png',
        primaryColor: '#6BAC95',
        sortOrder: 6,
        //bip44_index: WALLET_BIP44_COINTYPE_UNREGISTERED + 9,
        erc20_transferGasLimit: 120000,
        decimals: 6,
        tradingViewSymbol: "BITSTAMP:BTCEUR",
    },

    'link': {
        name: 'link',
        web: 'https://chain.link/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_ETH,
        symbol: 'LINK',
        displayName: 'Chainlink',
        desc: 'ERC20',
        displaySymbol: 'LINK',
        imageUrl: 'img/asset-icon/link.png',
        primaryColor: '#3657D2',
        sortOrder: 50,
        //bip44_index: WALLET_BIP44_COINTYPE_UNREGISTERED + 10,
        erc20_transferGasLimit: 120000,
        decimals: 18,
        tradingViewSymbol: "BINANCE:LINKBTC",

    },
    'zil': {
        name: 'zil',
        web: 'https://zilliqa.com/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_ETH,
        symbol: 'ZIL',
        displayName: 'Zilliqa',
        displaySymbol: 'ZIL',
        desc: 'ERC20',
        imageUrl: 'img/asset-icon/zil.png',
        primaryColor: '#6ABEBD',
        sortOrder: 51,
        //bip44_index: 313, // mainnet?
        erc20_transferGasLimit: 120000,
        decimals: 12,
        tradingViewSymbol: "BINANCE:ZILBTC",
    },
    'hot': {
        name: 'hot',
        web: 'https://holo.host/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_ETH,
        symbol: 'HOT',
        displayName: 'HoloToken',
        desc: 'ERC20',
        displaySymbol: 'HOT',
        imageUrl: 'img/asset-icon/hot.png',
        primaryColor: '#38818B',
        sortOrder: 52,
        //bip44_index: WALLET_BIP44_COINTYPE_UNREGISTERED + 11,
        erc20_transferGasLimit: 120000,
        decimals: 18,
        tradingViewSymbol: "BINANCE:HOTBTC",
    },
    'rep': {
        name: 'rep',
        web: 'https://augur.net/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_ETH,
        symbol: 'REP',
        displayName: 'Augur',
        desc: 'ERC20',
        displaySymbol: 'REP',
        imageUrl: 'img/asset-icon/rep.png',
        primaryColor: '#582950',
        sortOrder: 53,
        //bip44_index: WALLET_BIP44_COINTYPE_UNREGISTERED + 12,
        erc20_transferGasLimit: 120000,
        decimals: 18,
        tradingViewSymbol: "BINANCE:REPBTC",
    },
    'mkr': {
        name: 'mkr',
        web: 'https://makerdao.com/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_ETH,
        symbol: 'MKR',
        displayName: 'Maker',
        desc: 'ERC20',
        displaySymbol: 'MKR',
        imageUrl: 'img/asset-icon/mkr.png',
        primaryColor: '#4FA99B',
        sortOrder: 54,
        //bip44_index: WALLET_BIP44_COINTYPE_UNREGISTERED + 13,  
        erc20_transferGasLimit: 120000,
        decimals: 18,
        tradingViewSymbol: "BITFINEX:MKRBTC",
    },
    'nexo': {
        name: 'nexo',
        web: 'https://nexo.io/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_ETH,
        symbol: 'NEXO',
        displayName: 'Nexo',
        desc: 'ERC20',
        displaySymbol: 'NEXO',
        imageUrl: 'img/asset-icon/nexo.png',
        primaryColor: '#2E4291',
        sortOrder: 55,
        //bip44_index: WALLET_BIP44_COINTYPE_UNREGISTERED + 14,  
        erc20_transferGasLimit: 120000,
        decimals: 18,
        tradingViewSymbol: "HITBTC:NEXOBTC",
    },

    'band': {
        name: 'band',
        web: 'https://bandprotocol.com/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_ETH,
        symbol: 'BAND',
        displayName: 'Band Protocol',
        desc: 'ERC20',
        displaySymbol: 'BAND',
        imageUrl: 'img/asset-icon/band.png',
        primaryColor: '#5269FF',
        sortOrder: 60,
        bip44_index: 494,
        erc20_transferGasLimit: 120000,
        decimals: 18,
        tradingViewSymbol: "BINANCE:BANDBTC",
    },
    'dos': {
        name: 'dos',
        web: 'https://dos.network/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_ETH,
        symbol: 'DOS',
        displayName: 'DOS Network',
        desc: 'ERC20',
        displaySymbol: 'DOS',
        imageUrl: 'img/asset-icon/dos.png',
        primaryColor: '#7A7875',
        sortOrder: 61,
        //bip44_index: WALLET_BIP44_COINTYPE_UNREGISTERED + 15,  
        erc20_transferGasLimit: 120000,
        decimals: 18,
        tradingViewSymbol: "BITFINEX:BTCUSD",
    },
    'ring': {
        name: 'ring',
        web: 'https://darwinia.network/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_ETH,
        symbol: 'RING',
        displayName: 'Darwinia',
        desc: 'ERC20',
        displaySymbol: 'RING',
        imageUrl: 'img/asset-icon/ring.png',
        primaryColor: '#949497',
        sortOrder: 62,
        //bip44_index: WALLET_BIP44_COINTYPE_UNREGISTERED + 16,  
        erc20_transferGasLimit: 120000,
        decimals: 18,
        tradingViewSymbol: "POLONIEX:RINGUSDT",
    },
    'swap': {
        name: 'swap',
        web: 'https://trustswap.org/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_ETH,
        symbol: 'SWAP',
        displayName: 'TrustSwap',
        desc: 'ERC20',
        displaySymbol: 'SWAP',
        imageUrl: 'img/asset-icon/swap.png',
        primaryColor: '#0A1477',
        sortOrder: 63,
        //bip44_index: WALLET_BIP44_COINTYPE_UNREGISTERED + 17,  
        erc20_transferGasLimit: 120000,
        decimals: 18,
        tradingViewSymbol: "POLONIEX:SWAPBTC",
    },
}

//
// StMaster - stm_ApiPayload
// populated once by getSupportedWalletTypes(); then subsequently passed down into cpu-workers
// by wallet/utils/op_WalletAddrFromPrivKey() & op_getAddressFromPrivateKey() so that workers can 
// also update/augment their static configs...
//
var stm_ApiPayload = undefined
function addDynamicSecTokens() {
    // semi-dynamic assets (dynamic at build time)
    if (WALLET_INCLUDE_ETH_TEST && !supportedWalletTypes.includes('eth(t)')) {
        supportedWalletTypes.push('eth(t)')
    }
    // if (WALLET_INCLUDE_TUSD_TEST && !supportedWalletTypes.includes('trueusd(t)')) {
    //     supportedWalletTypes.push('trueusd(t)')
    // }
    if (WALLET_INCLUDE_BTC_TEST && !supportedWalletTypes.includes('btc(t)')) {
        supportedWalletTypes.push('btc(t)')
    }
    if (WALLET_INCLUDE_LTC_TEST && !supportedWalletTypes.includes('ltc(t)')) {
        supportedWalletTypes.push('ltc(t)')
    }
    if (WALLET_INCLUDE_ZEC_TEST && !supportedWalletTypes.includes('zcash(t)')) {
        supportedWalletTypes.push('zcash(t)')
    }

    // (todo - remove, or move to dynamic)
    if (WALLET_INCLUDE_AIRCARBON_TEST && !supportedWalletTypes.includes('aircarbon(t)')) {
        supportedWalletTypes.push('aircarbon(t)')
    }
    // (todo - remove, or move to dynamic)
    if (WALLET_INCLUDE_AYONDO_TEST && !supportedWalletTypes.includes('ayondo(t)')) {
        supportedWalletTypes.push('ayondo(t)')
    }
    // removed: in preference for dynamic (API-driven) StMaster types
    // if (WALLET_INCLUDE_SINGDAX_TEST && !supportedWalletTypes.includes('singdax(t)')) {
    //     supportedWalletTypes.push('singdax(t)')
    // }
    // SD - replaced with true dynamic assets:
    if (stm_ApiPayload === undefined) {
        console.warn('StMaster - addDynamicSecTokens - stm_ApiPayload not set:')
    }
    else {
        for (let i=0; i < stm_ApiPayload.base_types.length ; i++) {
            const stm = stm_ApiPayload.base_types[i]

            // config/wallet.js (here): ...walletsMeta, ...supportedWalletTypes
            const newWalletsMeta = {
                isErc20_Ropsten: true,
                isCashflowToken: true,
                name: `${stm.base_symbol.toLowerCase()}(t)`,
                web: `https://uat.sdax.co/token/${stm.base_symbol}/${stm.base_addr}`, // SD UAT env assumed
                type: WALLET_TYPE_ACCOUNT,
                addressType: ADDRESS_TYPE_ETH,
                symbol: `${stm.base_symbol}_TEST`, // Ropsten assumed
                displayName: stm.base_type_name,
                desc: `SDAX ${stm.base_symbol}`,
                displaySymbol: stm.base_symbol,
                imageUrl: 'img/asset-icon/SD3.png', 
                primaryColor: '#6eaffa',
                sortOrder: 444,
                //bip44_index: WALLET_BIP44_COINTYPE_UNREGISTERED + 0,
                erc20_transferGasLimit: 5000000,
                erc20_gasEstimateMultiplier: 1.2,
                erc20_gasMin: 300000,
                decimals: 0,
                tradingViewSymbol: "BITFINEX:BTCUSD",
                
                cft_stm: stm,                 // StMaster - CFT-B base contract/type
                cft_c: stm_ApiPayload.cftc,   // StMaster - CFT-C controller contract
            }
            if (walletsMeta[newWalletsMeta.name] === undefined) {
                walletsMeta[newWalletsMeta.name] = newWalletsMeta
                console.log(`StMaster - added ${newWalletsMeta.symbol}/${newWalletsMeta.name} to walletsMeta ok`)
            }
            if (!supportedWalletTypes.includes(newWalletsMeta.name)) {
                supportedWalletTypes.push(newWalletsMeta.name)
                console.log(`StMaster - added ${newWalletsMeta.symbol}/${newWalletsMeta.name} to supportedWalletTypes ok`)
            }

            // config/wallet-external.js: ...erc20Contracts
            if (configWalletExternal.erc20Contracts[newWalletsMeta.symbol] === undefined) {
                configWalletExternal.erc20Contracts_append(newWalletsMeta.symbol, newWalletsMeta.cft_stm.base_addr)
                console.log(`StMaster - added ${newWalletsMeta.symbol}/${newWalletsMeta.name} to erc20Contracts ok`)
            }

            // config/wallet-external.js: ...module.exports.walletExternal_config
            if (configWalletExternal.walletExternal_config[newWalletsMeta.symbol] === undefined) {
                configWalletExternal.walletExternal_config_append(newWalletsMeta.symbol, {
                    donate: '0xda9abd90e6cd31e8e0c2d5f35d3d5a71c8661b0e', // testnets2@scoop.tech
                    contractAddress: newWalletsMeta.cft_stm.base_addr,
                    explorerPath: (address) => configWalletExternal.erc20_ropstenAddrExplorer(configWalletExternal.erc20Contracts[newWalletsMeta.symbol], address),
                    txExplorerPath: (txid) => configWalletExternal.eth_ropstenTxExplorer(txid),
                    httpProvider: configWalletExternal.ethTestHttpProvider,
                })
                console.log(`StMaster - added ${newWalletsMeta.symbol}/${newWalletsMeta.name} to walletExternal_config ok`)
            }
            
            // WIP...
            //      price.js (?)
            //      WalletDetailSend.js (?)
            //      common.cscc (?)
        }
        //console.log(`StMaster - done appends - configWalletExternal.erc20Contracts=`, configWalletExternal.erc20Contracts)
        //console.log(`StMaster - done appends - configWalletExternal.walletExternal_config=`, configWalletExternal.walletExternal_config)
        //console.log(`StMaster - done appends - stm_ApiPayload=`, stm_ApiPayload)
    }
}

module.exports = {

      WALLET_VER
    , IS_DEV
    , WALLET_COPYRIGHT
    , WALLET_ENV

    // CLI
    , CLI_LOG_CORE: false
    , CLI_SAVE_KEY: process.env.NODE_ENV === "development"               // if false, you will need to pass MPK via CLI to wallet functions

    // wallet config - core
    , WALLET_INCLUDE_ETH_TEST
    , WALLET_INCLUDE_BTC_TEST
    , WALLET_INCLUDE_LTC_TEST
    , WALLET_INCLUDE_ZEC_TEST
    , WALLET_DISABLE_BLOCK_UPDATES 
    , WALLET_REGEN_EVERYTIME: true                                       // LEAVE THIS ON! - we no longer save addr's on the server (regenerate wallet raw assets (& persist to server) on every login (for testing multi-addr, but also a good start for offline/no-server mode))
    , WALLET_DEFAULT_ADDRESSES: 1                                        // no. of address slots to (re)gen by default
    , WALLET_MAX_UNUSED_ADDRESSES: 2                                     // max. no. of unused (zero-tx) addresses - don't allow add beyond this
    , WALLET_MAX_ADDRESSES: 10                                           // hard cap max. no. addresses per asset, used or otherwise

    // large values (e.g. 10000): load-perf is acceptable, limiting factor is browser-render performance (not react render() fn!)
    // of very large txlists (WalletDetailTxHistory) -- e.g. scoop admin wallet
    , WALLET_MAX_TX_HISTORY: 100                                         // local storage is limited: we cap the # of tx's that we read from 3PBPs (this is limit per addr)

    // wallet config - utxo
    , UTXO_DUST_SAT: 1                                                   // maybe not needed - for tolerence in accepting atomic utxo bal/tx updates

    // wallet config - eth
    , ETH_SENDMAX_PADDING_WEI: 50                                        // help ETH transactions by reducing this amount of Wei (intermittent Geth issues with full sends)
    , ETH_COALESCE_DUST_TO_ZERO: true                                    // hide dust values: modifies balances at API and at calculation layers
    , ETH_DUST_WEI: 200                                                  // if less than this, we coalesce the Wei balance to zero
    , ETH_USEWEB3_ACCOUNT_BALANCES: true                                 // use web3 and eth.getBalance to get ethereum balances; otherwise use 3PBP (etherscan or blockscout)
    , ETH_ERC20_USEWEB3_TOKEN_BALANCES: true                             // use web3 and make contract call to get erc20 token balances; otherwise use 3PBP (etherscan or blockscout)
    , ETH_ERC20_TX_FALLBACK_WEI_GASLIMIT: 120000                         // static gasLimit for ERC20 token transfers, if not specified on the asset's config

    // privkey regexs
    , REGEX_WIF_UTXO_MAINNETS: /[5KLTX][1-9A-HJ-NP-Za-km-z]{50,52}/g     // utxo - ltc, btc, zec, dash, vtc, qtum, dgb, bchabc
    , REGEX_WIF_UTXO_TESTNETS: /[c][1-9A-HJ-NP-Za-km-z]{50,52}/g         
    , REGEX_ETH: /[0-9A-Fa-f]{64}/g                                      // eth -- 64 hex chars, any

    // functional sockets - geth & blockbook
    , VOLATILE_SOCKETS_REINIT_SECS: 20                                   // volatile sockets - reinit timer (seconds)

    // wallet test params
    //,TEST_PAD_TXS:100                                                  // pad TX list -- testing LS/SS limits
    //,TEST_LARGE_BALANCE:123.12345678                                   // mock balances

    // static - asset types
    , WALLET_TYPE_UTXO
    , WALLET_TYPE_ACCOUNT

    // static - address types
    , ADDRESS_TYPE_BTC
    , ADDRESS_TYPE_LTC
    , ADDRESS_TYPE_ETH
    , ADDRESS_TYPE_EOS
    , ADDRESS_TYPE_ZEC_T
    , ADDRESS_TYPE_DASH
    , ADDRESS_TYPE_VTC
    , ADDRESS_TYPE_QTUM
    , ADDRESS_TYPE_DGB
    , ADDRESS_TYPE_BCHABC

    // static - price sources
    , PRICE_SOURCE_CRYPTOCOMPARE
    , PRICE_SOURCE_BITFINEX
    , PRICE_SOURCE_SYNTHETIC_FIAT

    //
    // StMaster - dynamic supported assets
    // UPDATE Oct 2020: insert dynamic ERC20s (network fetch) prior to wallet generation
    //
    , getSupportedWalletTypes: async () => { 
        if (stm_ApiPayload === undefined 
            && IS_DEV // WIP: disable in prod for now...
        ) {
            // StMaster - dynamic ERC20s: read from API (also would work for token lists)
            // call API and cache return value
            console.log('StMaster - await fetching stm_data...')
            var response
            try {
                response = await axios.create({ baseURL: API_URL }).get(`stm`) // fetch StMaster erc20's - hardcoded in API to Ropsten for now
            }
            catch(ex) {
                console.warn(`StMaster - failed getting stm data - skipping`, ex)
            }
            if (response !== undefined) {
                if (response.data !== undefined) {
                    const stm_data = response.data.data
                    if (stm_data !== undefined && stm_data.base_types !== undefined) { // * dynamic add to...
                        console.log('StMaster - got stm_data ok', stm_data)
                        // note:
                        // dynamic API return is cached (both in var and in state), so that the main thread value can be passed down and re-used
                        // by worker thread(s), and also so that browser f5 persistence 
                        stm_ApiPayload = stm_data // save in var
                        if (WALLET_ENV === "BROWSER") { 
                            if (window !== undefined && window.sessionStorage !== undefined) {
                                window.sessionStorage.stm_ApiPayload = JSON.stringify(stm_ApiPayload) // save in state (for f5 rehydration)
                            }
                        }
                        console.log(`StMaster - getSupportedWalletTypes - WALLET_ENV=${WALLET_ENV}, set stm_ApiPayload=`, stm_ApiPayload)
                        addDynamicSecTokens()

                    } else console.error(`StMaster - bad stm response (1)`)
                } else console.error(`StMaster - bad stm response (2)`)
            } 
            console.log('StMaster - returning - newly populated', supportedWalletTypes)
            return new Promise((resolve) => resolve(supportedWalletTypes))
        }
        else {
            //console.log('StMaster - using cached/supplied stm_ApiPayload', stm_ApiPayload)
            addDynamicSecTokens()

            //console.log('StMaster - returning - already populated', supportedWalletTypes)
            return new Promise((resolve) => resolve(supportedWalletTypes))
        }
    }
    , get_stm_ApiPayload: () => stm_ApiPayload
    , set_stm_ApiPayload: (val) => { 
        if (WALLET_ENV === "BROWSER") { 
            if (window !== undefined && window.sessionStorage !== undefined) {
                window.sessionStorage.stm_ApiPayload = JSON.stringify(val) // set in state (for f5 rehydration)
            }
        }
        stm_ApiPayload = val // set in var
    }
    , addDynamicSecTokens: () => addDynamicSecTokens()

    , getMetaBySymbol: (symbol) => {

        // StMaster - re-add any dynamically added types, if we've lost JS local var state (e.g. on page refresh)
        if (stm_ApiPayload === undefined) { 
            if (WALLET_ENV === "BROWSER") { //** rehydrate stm_ApiPayload from state, then re-init the dynamic tokens
                if (window !== undefined && window.sessionStorage !== undefined && window.sessionStorage.stm_ApiPayload !== undefined) {
                    console.warn(`StMaster - getMetaBySymbol, stm_ApiPayload is undefined... reloading from sessionStorage.stm_ApiPayload; supportedWalletTypes=${supportedWalletTypes}`)
                    stm_ApiPayload = JSON.parse(window.sessionStorage.stm_ApiPayload)
                    addDynamicSecTokens()
                }
            }
        }

        // lookup & return meta for symbol
        var ret
        Object.keys(walletsMeta).map(p => {
            if (walletsMeta[p].symbol === symbol) // *A*
                ret = walletsMeta[p]
        })
        return ret
    }

    , walletsMeta

    // exchange
    , XS_CHANGELLY_VARRATE_MARKDOWN: 0.9 // changelly variable-rate api is wildly optimistic in its estimate: mark it down 10%

    // network (API)
    , API_DOMAIN
    , API_URL
    // "axios-retry": "^3.1.2",
    // axios-retry is *very* flaky indeed: https://github.com/softonic/axios-retry/issues/59
    // this config does *not* do 4 retries...
    // , AXIOS_RETRY_API: { 
    //     retries: 4,
    //     retryDelay: () => { return 200 }, // ms
    //     //retryCondition: (res) => { return true } // if this is included, it retries without limit
    // }
    // , AXIOS_RETRY_3PBP: {
    //     retries: 8,
    //     retryDelay: require('axios-retry').exponentialDelay,
    //     retryCondition: (res) => { return true }
    // }    

}
