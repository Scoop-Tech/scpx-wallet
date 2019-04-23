var isNode = require('detect-node')

// static - asset types
const WALLET_TYPE_UTXO = 'WALLET_TYPE_UTXO'
const WALLET_TYPE_ACCOUNT = 'WALLET_TYPE_ACCOUNT'

// static - address types
const ADDRESS_TYPE_BTC = 'BTC'
const ADDRESS_TYPE_LTC = 'LTC'
const ADDRESS_TYPE_ETH = 'ETH'
const ADDRESS_TYPE_EOS = 'EOS'
const ADDRESS_TYPE_ZEC_T = 'ZEC'
const ADDRESS_TYPE_DASH = 'DASH'
const ADDRESS_TYPE_VTC = 'VTC'
const ADDRESS_TYPE_QTUM = 'QTUM'
const ADDRESS_TYPE_DGB = 'DGB'
const ADDRESS_TYPE_BCHABC = 'BCH'

// static - price sources
const PRICE_SOURCE_CRYPTOCOMPARE = 'CC'   // primary
const PRICE_SOURCE_BITFINEX = 'BF'        // ## no CORS headers, not usable - todo: move to WS (no CORS) interface, make bitfinex WS primary
const PRICE_SOURCE_SYNTHETIC_FIAT = 'SYF' // hack for using a base fiat price (eurt)

// config - dbg
const WALLET_INCLUDE_ETHTEST = false
const WALLET_INCLUDE_BTCTEST = false

// wallet config - internal
const WALLET_BIP44_COINTYPE_UNREGISTERED = 100000           // we start at this value for unregistered BIP44 coin-types (https://github.com/satoshilabs/slips/blob/master/slip-0044.md)

// wallet api
const API_DOMAIN = `https://scpx-svr.scoop.tech/`
const API_URL = `${API_DOMAIN}api/`

//
// RE. ADDING NEW TYPES -- add here, and:
//
//   add also: config/wallet-external
//   add also: config/websockets (prices)
//   add also: reducers/prices + actions/index
//   add also: commons.scss (:root)
//   add also: getSupportedWalletTypes() (above)
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
const walletsMeta = {
    // utxo's
    'btc(s)': {
        name: 'btc(s)',
        use_BBv3: true,
        web: 'https://bitcoin.org/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_UTXO,
        addressType: ADDRESS_TYPE_BTC,
        symbol: 'BTC_SEG',
        displayName: 'Bitcoin',
        desc: 'SegWit P2SH',
        displaySymbol: 'BTC',
        imageUrl: 'img/asset-icon/btc_seg2.png',
        primaryColor: '#f2a235',
        sortOrder: 0,
        bip44_index: 0, // ##
        tx_perInput_vsize: 140,
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
        desc: 'Legacy',
        displaySymbol: 'BTC',
        imageUrl: 'img/asset-icon/btc.png',
        primaryColor: '#f2a235',
        sortOrder: 1,
        bip44_index: 0, // ##
        tx_perInput_vsize: 147,
    },
    'litecoin': {
        name: 'litecoin',
        use_BBv3: true,
        desc: undefined,
        web: 'https://litecoin.org/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_UTXO,
        addressType: ADDRESS_TYPE_LTC,
        symbol: 'LTC',
        displayName: 'Litecoin',
        displaySymbol: 'LTC',
        imageUrl: 'img/asset-icon/ltc.png',
        primaryColor: '#535353',
        sortOrder: 9,
        bip44_index: 2,
        tx_perInput_vsize: 147,
    },
    'zcash': {
        name: 'zcash',
        use_BBv3: true,
        desc: undefined,
        web: 'https://z.cash/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_UTXO,
        addressType: ADDRESS_TYPE_ZEC_T,
        symbol: 'ZEC',
        displayName: 'ZCash',
        displaySymbol: 'ZEC',
        imageUrl: 'img/asset-icon/zec.png',
        primaryColor: '#F4B728',
        sortOrder: 10,
        bip44_index: 133,
        tx_perInput_vsize: 147,
    },
    'bchabc': {
        name: 'bchabc',
        use_BBv3: true,
        desc: undefined,
        web: 'https://www.bitcoinabc.org/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        priceSource_CC_symbol: 'BCH',
        type: WALLET_TYPE_UTXO,
        addressType: ADDRESS_TYPE_BCHABC,
        symbol: 'BCHABC',
        displayName: 'BCash ABC',
        desc: 'Bitcoin Cash ABC',
        displaySymbol: 'BCHABC',
        imageUrl: 'img/asset-icon/bchabc.png',
        primaryColor: '#380E09',
        sortOrder: 11,
        bip44_index: 145,
        tx_perInput_vsize: 147,
    },
    'dash': {
        name: 'dash',
        use_BBv3: true,
        web: 'https://dash.org/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        desc: undefined,
        type: WALLET_TYPE_UTXO,
        addressType: ADDRESS_TYPE_DASH,
        symbol: 'DASH',
        displayName: 'Dash',
        displaySymbol: 'DASH',
        imageUrl: 'img/asset-icon/dash.png',
        primaryColor: '#E38C00',
        sortOrder: 20,
        bip44_index: 5,
        tx_perInput_vsize: 147,
    },
    'vertcoin': {
        name: 'vertcoin',
        use_BBv3: true,
        web: 'https://vertcoin.org/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        desc: undefined,
        type: WALLET_TYPE_UTXO,
        addressType: ADDRESS_TYPE_VTC,
        symbol: 'VTC',
        displayName: 'Vertcoin',
        displaySymbol: 'VTC',
        imageUrl: 'img/asset-icon/vtc.png',
        primaryColor: '#2C5C20',
        sortOrder: 21,
        bip44_index: 28,
        tx_perInput_vsize: 147,
    },
    'qtum': {
        name: 'qtum',
        use_BBv3: true,
        web: 'https://qtum.org/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        desc: undefined,
        type: WALLET_TYPE_UTXO,
        addressType: ADDRESS_TYPE_QTUM,
        symbol: 'QTUM',
        displayName: 'Qtum',
        displaySymbol: 'QTUM',
        imageUrl: 'img/asset-icon/qtum.png',
        primaryColor: '#D09A44',
        sortOrder: 19,
        bip44_index: 2301,
        tx_perInput_vsize: 147,
    },
    'digibyte': {
        name: 'digibyte',
        use_BBv3: true,
        web: 'https://digibyte.io/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        desc: undefined,
        type: WALLET_TYPE_UTXO,
        addressType: ADDRESS_TYPE_DGB,
        symbol: 'DGB',
        displayName: 'DigiByte',
        displaySymbol: 'DGB',
        imageUrl: 'img/asset-icon/dgb.png',
        primaryColor: '#4F2109',
        sortOrder: 22,
        bip44_index: 20,
        tx_perInput_vsize: 147,
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
        bip44_index: 60,
        decimals: 18,
    },
    'trueusd': {
        name: 'trueusd',
        web: 'https://trusttoken.com/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_ETH,
        symbol: 'TUSD',
        displayName: 'TrueUSD',
        displaySymbol: 'TUSD',
        imageUrl: 'img/asset-icon/tusd.png',
        primaryColor: '#6eaffa',
        sortOrder: 4,
        bip44_index: WALLET_BIP44_COINTYPE_UNREGISTERED + 0,
        erc20_transferGasLimit: 120000,
        decimals: 18,
    },
    'bancor': {
        name: 'bancor',
        web: 'https://bancor.network/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_ETH,
        symbol: 'BNT',
        displayName: 'Bancor',
        displaySymbol: 'BNT',
        imageUrl: 'img/asset-icon/bnt.png',
        primaryColor: '#010c2a',
        sortOrder: 32,
        bip44_index: WALLET_BIP44_COINTYPE_UNREGISTERED + 1,
        erc20_transferGasLimit: 120000,
        decimals: 18,
    },
    '0x': {
        name: '0x',
        desc: undefined,
        web: 'https://0x.org/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_ETH,
        symbol: 'ZRX',
        displayName: '0x',
        displaySymbol: 'ZRX',
        imageUrl: 'img/asset-icon/zrx.png',
        primaryColor: '#535353',
        sortOrder: 33,
        bip44_index: WALLET_BIP44_COINTYPE_UNREGISTERED + 2,
        erc20_transferGasLimit: 120000,
        decimals: 18,
    },
    'bat': {
        name: 'bat',
        web: 'https://basicattentiontoken.org/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_ETH,
        symbol: 'BAT',
        displayName: 'BAT',
        desc: 'Basic Attention Token',
        displaySymbol: 'BAT',
        imageUrl: 'img/asset-icon/bat.png',
        primaryColor: '#FF5800',
        sortOrder: 34,
        bip44_index: WALLET_BIP44_COINTYPE_UNREGISTERED + 3,
        erc20_transferGasLimit: 120000,
        decimals: 18,
    },
    'bnb': {
        name: 'bnb',
        desc: undefined,
        web: 'https://binance.com/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_ETH,
        symbol: 'BNB',
        displayName: 'Binance Coin',
        displaySymbol: 'BNB',
        imageUrl: 'img/asset-icon/bnb.png',
        primaryColor: '#eeba33',
        sortOrder: 35,
        bip44_index: 714,
        erc20_transferGasLimit: 120000,
        decimals: 18,
    },

    'omg': {
        name: 'omg',
        desc: undefined,
        web: 'https://omisego.network/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_ETH,
        symbol: 'OMG',
        displayName: 'OmiseGo',
        displaySymbol: 'OMG',
        imageUrl: 'img/asset-icon/omg.png',
        primaryColor: '#3250EE',
        sortOrder: 36,
        bip44_index: WALLET_BIP44_COINTYPE_UNREGISTERED + 4,
        erc20_transferGasLimit: 65000,
        decimals: 18,
    },
    'gto': {
        name: 'gto',
        desc: undefined,
        web: 'https://gifto.io/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_ETH,
        symbol: 'GTO',
        displayName: 'Gifto',
        displaySymbol: 'GTO',
        imageUrl: 'img/asset-icon/gto.png',
        primaryColor: '#801AFD',
        sortOrder: 37,
        bip44_index: WALLET_BIP44_COINTYPE_UNREGISTERED + 5,
        erc20_transferGasLimit: 120000,
        decimals: 5,
    },
    'snt': {
        name: 'snt',
        desc: undefined,
        web: 'https://status.im/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_ETH,
        symbol: 'SNT',
        displayName: 'Status',
        displaySymbol: 'SNT',
        imageUrl: 'img/asset-icon/snt.png',
        primaryColor: '#5B6DEE',
        sortOrder: 38,
        bip44_index: WALLET_BIP44_COINTYPE_UNREGISTERED + 6,
        erc20_transferGasLimit: 120000,
        decimals: 18,
    },
    'ht': {
        name: 'ht',
        desc: undefined,
        web: 'https://huobipro.com/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_ETH,
        symbol: 'HT',
        displayName: 'Huobi Token',
        displaySymbol: 'HT',
        imageUrl: 'img/asset-icon/ht.png',
        primaryColor: '#46A2D9',
        sortOrder: 40,
        bip44_index: WALLET_BIP44_COINTYPE_UNREGISTERED + 7,
        erc20_transferGasLimit: 120000,
        decimals: 18,
    },
    // 'ven': { // old erc20 - now on its own mainnet ("vet")
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
    // 'btm': { // same as vechain - now on mainnet
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
        desc: 'USDT ERC20',
        displaySymbol: 'USDT',
        imageUrl: 'img/asset-icon/usdt.png',
        primaryColor: '#94AE53',
        sortOrder: 5,
        bip44_index: WALLET_BIP44_COINTYPE_UNREGISTERED + 8,
        erc20_transferGasLimit: 120000,
        decimals: 6,
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
        desc: 'EURT ERC20',
        displaySymbol: 'EURT',
        imageUrl: 'img/asset-icon/eurt.png',
        primaryColor: '#94AE53',
        sortOrder: 6,
        bip44_index: WALLET_BIP44_COINTYPE_UNREGISTERED + 9,
        erc20_transferGasLimit: 120000,
        decimals: 6,
    },

    'link': {
        name: 'link',
        desc: undefined,
        web: 'https://chain.link/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_ETH,
        symbol: 'LINK',
        displayName: 'Chainlink',
        displaySymbol: 'LINK',
        imageUrl: 'img/asset-icon/link.png',
        primaryColor: '#D75739',
        sortOrder: 50,
        bip44_index: WALLET_BIP44_COINTYPE_UNREGISTERED + 10,
        erc20_transferGasLimit: 120000,
        decimals: 18,
    },
    'zil': {
        name: 'zil',
        desc: undefined,
        web: 'https://zilliqa.com/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_ETH,
        symbol: 'ZIL',
        displayName: 'Zilliqa',
        displaySymbol: 'ZIL',
        imageUrl: 'img/asset-icon/zil.png',
        primaryColor: '#C0C15B',
        sortOrder: 51,
        bip44_index: 313,
        erc20_transferGasLimit: 120000,
        decimals: 12,
    },
    'hot': {
        name: 'hot',
        desc: undefined,
        web: 'https://holo.host/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_ETH,
        symbol: 'HOT',
        displayName: 'HoloToken',
        displaySymbol: 'HOT',
        imageUrl: 'img/asset-icon/hot.png',
        primaryColor: '#8D8300',
        sortOrder: 52,
        bip44_index: WALLET_BIP44_COINTYPE_UNREGISTERED + 11,
        erc20_transferGasLimit: 120000,
        decimals: 18,
    },
    'rep': {
        name: 'rep',
        desc: undefined,
        web: 'https://augur.net/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_ETH,
        symbol: 'REP',
        displayName: 'Augur',
        displaySymbol: 'REP',
        imageUrl: 'img/asset-icon/rep.png',
        primaryColor: '#672241',
        sortOrder: 53,
        bip44_index: WALLET_BIP44_COINTYPE_UNREGISTERED + 12,
        erc20_transferGasLimit: 120000,
        decimals: 18,
    },
    'mkr': {
        name: 'mkr',
        desc: undefined,
        web: 'https://makerdao.com/',
        priceSource: PRICE_SOURCE_CRYPTOCOMPARE,
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_ETH,
        symbol: 'MKR',
        displayName: 'Maker',
        displaySymbol: 'MKR',
        imageUrl: 'img/asset-icon/mkr.png',
        primaryColor: '#95B54D',
        sortOrder: 54,
        bip44_index: WALLET_BIP44_COINTYPE_UNREGISTERED + 13,  // https://github.com/satoshilabs/slips/blob/master/slip-0044.md
        erc20_transferGasLimit: 120000,
        decimals: 18,
    },

    'btc(t)': {
        name: 'btc(t)',
        type: WALLET_TYPE_UTXO,
        addressType: ADDRESS_TYPE_BTC,
        symbol: 'BTC_TEST',
        displayName: 'BTC*',
        desc: 'Testnet3',
        displaySymbol: 'BTC*',
        imageUrl: 'img/asset-icon/btc_test2.png',
        primaryColor: '#f2a235',
        sortOrder: 888,
        bip44_index: 1, // ##
        tx_base_vsize: 3028,
    },
    'eth(t)': {
        name: 'eth(t)',
        type: WALLET_TYPE_ACCOUNT,
        addressType: ADDRESS_TYPE_ETH,
        symbol: 'ETH_TEST',
        displayName: 'ETH*',
        desc: 'Ropsten',
        displaySymbol: 'ETH*',
        imageUrl: 'img/asset-icon/eth_test2.png',
        primaryColor: '#6e7bc4',
        sortOrder: 999,
        bip44_index: 1, // ##
        decimals: 18,
    },

    // 'tron': {
    //     type: WALLET_TYPE_ACCOUNT,
    //     addressType: ADDRESS_TYPE_ETH,
    //     name: 'Tron',
    //     symbol: 'TRX',
    //     imageUrl: 'img/asset-icon/trx.png',
    //     primaryColor: '#e70014',
    //     sortOrder: 12,
    //     bip44_index: 195,
    // },
}

module.exports = {

      WALLET_VER: '0.2.4'
    , WALLET_ENV: isNode ? "SERVER" : "BROWSER"

    // wallet config - core
    , WALLET_INCLUDE_ETHTEST
    , WALLET_INCLUDE_BTCTEST
    , WALLET_REGEN_EVERYTIME: true                          // LEAVE THIS ON! - we no longer save addr's on the server (regenerate wallet raw assets (& persist to server) on every login (for testing multi-addr, but also a good start for offline/no-server mode))
    , WALLET_DEFAULT_ADDRESSES: 1                           // no. of address slots to (re)gen by default
    , WALLET_MAX_UNUSED_ADDRESSES: 2                        // max. no. of unused (zero-tx) addresses - don't allow add beyond this
    , WALLET_MAX_ADDRESSES: 10                              // hard cap max. no. addresses per asset, used or otherwise
    , WALLET_MAX_TX_HISTORY: 100                            // local storage is limited: we cap the # of tx's that we read from 3PBPs (this is limit per addr)

    // wallet config - utxo
    , UTXO_DUST_SAT: 1                                      // maybe not needed - for tolerence in accepting atomic utxo bal/tx updates

    // wallet config - eth
    , ETH_SENDMAX_PADDING_WEI: 50                           // help ETH transactions by reducing this amount of Wei (intermittent Geth issues with full sends)
    , ETH_COALESCE_DUST_TO_ZERO: true                       // hide dust values: modifies balances at API and at calculation layers
    , ETH_DUST_WEI: 200                                     // if less than this, we coalesce the Wei balance to zero
    , ETH_USEWEB3_ACCOUNT_BALANCES: true                    // use web3 and eth.getBalance to get ethereum balances; otherwise use 3PBP (etherscan or blockscout)
    , ETH_ERC20_USEWEB3_TOKEN_BALANCES: true                // use web3 and make contract call to get erc20 token balances; otherwise use 3PBP (etherscan or blockscout)
    , ETH_ERC20_TX_FALLBACK_WEI_GASLIMIT: 120000            // static gasLimit for ERC20 token transfers, if not specified on the asset's config

    // wallet config - network
    , AXIOS_RETRY_3PBP: {
        retries: 8,
        retryDelay: require('axios-retry').exponentialDelay,
        retryCondition: (res) => { return true }
    }

    // wallet test params
    //,TEST_PAD_TXS:100                                   // pad TX list -- testing LS/SS limits
    //,TEST_LARGE_BALANCE:123.12345678                    // mock balances


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

    // static - supported assets
    , getSupportedWalletTypes: () => { // use walletsMeta keys for this list
        var ret = [
            'bitcoin', 'litecoin', 'ethereum', 'eos', 'btc(s)', 'zcash',
            'dash', 'vertcoin', 'qtum', 'digibyte', 'bchabc',

            'bnb', 'trueusd', 'bancor', '0x', 'bat',

            'omg', 'snt', 'gto', 'ht',

            //'btm', // on mainnet, erc20 deprecated
            //'ven', // on mainnet, erc20 deprecated

            'usdt', 'eurt',

            'mkr', 'rep', 'hot', 'zil', 'link',

            // todo 
            //'tgbp' (new)
        ]

        if (WALLET_INCLUDE_ETHTEST) {
            ret.push('eth(t)')
        }
        if (WALLET_INCLUDE_BTCTEST) {
            ret.push('btc(t)')
        }
        return ret
    }

    , getMetaBySymbol: (symbol) => {
        var ret
        Object.keys(walletsMeta).map(p => {
            if (walletsMeta[p].symbol === symbol) // *A*
                ret = walletsMeta[p]
        })
        return ret
    }

    , walletsMeta

    // network (API)
    , API_DOMAIN
    , API_URL
    , AXIOS_RETRY_API: {
        retries: 2,
        retryDelay: () => { return 200 }, // ms
        retryCondition: (res) => { return true }
    }
}