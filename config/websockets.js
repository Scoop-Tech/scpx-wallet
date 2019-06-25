// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.
module.exports = {
        
    //
    // insight-api WS 
    // used for "inv" (new tx & block) subs and for "bitcoind/addresstxid" (tx for addr) sub
    // note: for BB v3 assets (see worker-blockbook), we don't need to subscribe to insight blocks (we use BB's subscribeNewBlock socket method instead)
    // note also: that insight doesn't support segwit mempool tx's at all - so BB v3 is a strong requirement for btc_seg
    //
    insightApi_ws_config: {
        'BTC_TEST': { url: 'wss://scp-btct.southeastasia.cloudapp.azure.com:4001',           subBlocks: true  },
        //'BTC_TEST': { url: 'wss://test-insight.bitpay.com',                                 subBlocks: true  },
        
        //'BTC_SEG' : { url: 'wss://scp-btc2.southeastasia.cloudapp.azure.com:4001',           subBlocks: false },
        'BTC_SEG' : { url: 'wss://insight.bitpay.com',                                       subBlocks: false },
        
        //'BTC'     : { url: 'wss://scp-btc2.southeastasia.cloudapp.azure.com:4001',           subBlocks: false  },
        'BTC'     : { url: 'wss://insight.bitpay.com',                                       subBlocks: false  },
        
        'LTC'     : { url: 'wss://insight.litecore.io',                                      subBlocks: false  },
        //'LTC'     : { url: 'wss://scp-ltc2.southeastasia.cloudapp.azure.com:4001',           subBlocks: true  },
    
        'ZEC'     : { url: 'wss://zcashnetwork.info',                                        subBlocks: false  },
        //'ZEC'     : { url: 'wss://scp-zec1.southeastasia.cloudapp.azure.com:4001',           subBlocks: true  },

        'DASH'    : { url: 'wss://insight.dash.org',                                         subBlocks: false }, // BB v3 -- (insight only needed for lights)

        'VTC'     : { url: 'wss://insight.vertcoin.org',                                     subBlocks: false }, // BB v3 -- (insight only needed for lights)

        'QTUM'    : { url: 'wss://explorer.qtum.org',                                        subBlocks: false }, // BB v3 -- (insight only needed for lights)

        'DGB'     : { url: 'wss://digiexplorer.info',                                        subBlocks: false }, // BB v3 -- (insight only needed for lights)

        'BCHABC'  : { url: 'wss://blockdozer.com',                                           subBlocks: false }, // BB v3 -- (insight only needed for lights)

        'LTC_TEST': { url: 'wss://testnet.litecore.io',                                      subBlocks: false }, // BB v3 -- (insight only needed for lights)
        
        'ZEC_TEST': { url: 'wss://explorer.testnet.z.cash',                                  subBlocks: false }, // BB v3 -- (insight only needed for lights)
    },

    //
    // BBv3 - blockbook WS
    // used for "bitcoind/addresstxid" sub, block sub, mempool tx queries and for BB v3 (tx detail, tx addr history, and pushes)
    //
    blockbook_ws_config: {
        'BTC_SEG' : { url: 'wss://scp-btcsw.southeastasia.cloudapp.azure.com:10130',           subBlocks: true  },
      //'BTC_SEG' : { url: 'wss://btc1.trezor.io',                                             subBlocks: true  },

        'ETH'     : { url: 'wss://scp-bb-eth01.southeastasia.cloudapp.azure.com:8888',         subBlocks: false },
      //'ETH'     : { url: 'wss://eth1.trezor.io',                                             subBlocks: false },

        'DASH'     : { url: 'wss://scp-bb-dash01.southeastasia.cloudapp.azure.com:8888',       subBlocks: true },
      //'DASH'    : { url: 'wss://scp-btcsw.southeastasia.cloudapp.azure.com:10133',           subBlocks: true },
      //'DASH'    : { url: 'wss://dash1.trezor.io',                                            subBlocks: true },

        'VTC'      : { url: 'wss://scp-bb-vtc01.southeastasia.cloudapp.azure.com:8888',        subBlocks: true },

        'QTUM'     : { url: 'wss://scp-bb-qtum01.southeastasia.cloudapp.azure.com:8888',       subBlocks: true },

        'DGB'      : { url: 'wss://scp-bb-dgb01.southeastasia.cloudapp.azure.com:8888',        subBlocks: true },

        'ZEC'      : { url: 'wss://scp-bb-zec01.southeastasia.cloudapp.azure.com:8888',        subBlocks: true },
      //'ZEC'      : { url: 'wss://zec1.trezor.io',                                            subBlocks: true },
        
        'BTC'      : { url: 'wss://scp-btcsw.southeastasia.cloudapp.azure.com:10130',          subBlocks: true },

        'LTC'      : { url: 'wss://scp-bb-ltc01.southeastasia.cloudapp.azure.com:8888',        subBlocks: true },

        'BCHABC'   : { url: 'wss://scp-bb-bch02.southeastasia.cloudapp.azure.com:8888',        subBlocks: true },

        'LTC_TEST' : { url: 'wss://scp-bb-etht01.southeastasia.cloudapp.azure.com:29134',      subBlocks: true },
        'ZEC_TEST' : { url: 'wss://scp-bb-etht01.southeastasia.cloudapp.azure.com:29132',      subBlocks: true },
        'ETH_TEST' : { url: 'wss://scp-bb-etht01.southeastasia.cloudapp.azure.com:29136',      subBlocks: true },
    },

    //
    // ETH -- web3 WS providers, supporting pendingTransactions
    //
    geth_ws_config: {
        'ETH'     : { url: 'wss://scp-eth4.southeastasia.cloudapp.azure.com:9546',      subBlocks: true  },
        'ETH_TEST': { url: 'wss://scp-bb-etht01.southeastasia.cloudapp.azure.com:9546', subBlocks: true  },
    },

    //
    // ETH -- Parity WSs: for singleton-web3-WS instance -- try-fix workaround WS issue on geth > 1.8.2
    //
    // parityPubSub_ws_config: {
    //     'ETH'     : { url: 'wss://scp-eth6.southeastasia.cloudapp.azure.com:9546', }
    // },

    //
    // prices 
    // note -- not currently used (but maintained, roughly) - cryptocompare is missing some pairs on its WS api
    // (using worker-prices.fetch() REST instead)
    //
    cryptocompare_priceSocketConfig: {
        baseURL: 'wss://streamer.cryptocompare.com',
        subAdd: [
            '5~CCCAGG~BTC~USD', 
            '5~CCCAGG~LTC~USD',
            '5~CCCAGG~ZEC~USD',
            '5~CCCAGG~ETH~USD', 
            '5~CCCAGG~EOS~USD',
            '5~CCCAGG~TUSD~USD',
            '5~CCCAGG~ZRX~USD',
            '5~CCCAGG~BNT~USD',
            '5~CCCAGG~BAT~USD',
            '5~CCCAGG~BNB~USD',
            '5~CCCAGG~OMG~USD',
            '5~CCCAGG~GTO~USD',      //# bitfinex missing
            '5~CCCAGG~SNT~USD',
            //'5~CCCAGG~BTM~USD',
            //'5~CCCAGG~VEN~USD',
            '5~CCCAGG~HT~USD',       //# bitfinex missing
            '5~CCCAGG~DASH~USD',     //  bitfinex "tDSHUSD"
            '5~CCCAGG~VTC~USD',      //# bitfinex missing
            '5~CCCAGG~QTUM~USD',     //  bitfinex "tQTMUSD"
            '5~CCCAGG~DGB~USD',
            '5~CCCAGG~USDT~USD',     //  bitfinex "tUSTUSD"
            '5~CCCAGG~EURT~USD',     //  bitfinex "tEUTUSD"
            '5~CCCAGG~LINK~USD',     
            '5~CCCAGG~ZIL~USD',     
            '5~CCCAGG~HOT~USD',     
            '5~CCCAGG~REP~USD',     
            '5~CCCAGG~MKR~USD',     
            '5~CCCAGG~BCH~USD',
            '5~CCCAGG~NEXO~USD',
        ]
    },

}
