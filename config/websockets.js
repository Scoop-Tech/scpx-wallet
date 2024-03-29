// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2023 Dominic Morris.
module.exports = {
        
    //
    // insight-api WS 
    // used for "inv" (new tx & block) subs and for "bitcoind/addresstxid" (tx for addr) sub, i.e. just for twinkling lights on the footer
    //
    // note: for BB v3 assets (see worker-blockbook), we don't need to subscribe to insight blocks (we use BB's subscribeNewBlock socket method instead)
    // note also: that insight doesn't support segwit mempool tx's at all - so BB v3 is a strong requirement for btc_seg
    //
    insightApi_ws_config: {
      //'BTC_TEST': { url: 'https://test-insight.bitpay.com',                                subBlocks: true  },
      //'BTC_TEST': { url: 'wss://scp-btct.southeastasia.cloudapp.azure.com:4001',           subBlocks: true  },
        
        'BTC_SEG' : { url: 'https://btc.com',                                                subBlocks: false },
        'BTC_SEG2': { url: 'https://btc.com',                                                subBlocks: false },
        'BTC'     : { url: 'https://btc.com',                                                subBlocks: false },
        
        'LTC'     : { url: 'wss://insight.litecore.io',                                      subBlocks: false },
        'ZEC'     : { url: 'wss://explorer.zecmate.com',                                     subBlocks: false },
        'DASH'    : { url: 'wss://insight.dash.org',                                         subBlocks: false },
      //'VTC'     : { url: 'wss://insight.vertcoin.org',                                     subBlocks: false },
      //'QTUM'    : { url: 'wss://explorer.qtum.org',                                        subBlocks: false },
        'DGB'     : { url: 'wss://digiexplorer.info',                                        subBlocks: false },
      //'BCHABC'  : { url: 'wss://bch.btc.com',                                              subBlocks: false },
      //'RVN'     : { url: 'wss://explorer.rvn.zelcore.io',                                  subBlocks: false },
      //'LTC_TEST': { url: 'wss://testnet.litecore.io',                                      subBlocks: false },
      //'ZEC_TEST': { url: 'wss://explorer.testnet.z.cash',                                  subBlocks: false },
    },

    //
    // BBv3 - blockbook WS
    // used for "bitcoind/addresstxid" sub, block sub, mempool tx queries and for BB v3 (tx detail, tx addr history, and pushes)
    //
    blockbook_ws_config: {
      //'BTC_TEST' : { url: 'wss://tbtc2.trezor.io',                                           subBlocks: true },
        'BTC_TEST' : { url: 'wss://ac-dev0.net:10009',                                         subBlocks: true },
        'BTC_TEST2': { url: 'wss://ac-dev0.net:10009',                                         subBlocks: true },
        'BTC'      : { url: 'wss://btc1.trezor.io',                                            subBlocks: true },
        'BTC_SEG'  : { url: 'wss://btc2.trezor.io',                                            subBlocks: true },
        'BTC_SEG2' : { url: 'wss://btc3.trezor.io',                                            subBlocks: true },
        'ZEC'      : { url: 'wss://zec1.trezor.io',                                            subBlocks: true },
        'LTC'      : { url: 'wss://ltc1.trezor.io',                                            subBlocks: true },
        'ETH'      : { url: 'wss://eth1.trezor.io',                                            subBlocks: false },
        'DASH'     : { url: 'wss://dash1.trezor.io',                                           subBlocks: true },
      //'VTC'      : { url: 'wss://vtc1.trezor.io',                                            subBlocks: true },
        'DGB'      : { url: 'wss://dgb1.trezor.io',                                            subBlocks: true },
      //'BCHABC'   : { url: 'wss://bch1.trezor.io',                                            subBlocks: true },
      //'RVN'      : { url: 'wss://blockbook.ravencoin.org',                                   subBlocks: true },

        // ### -- no public BB nodes: self-hosted on scp-dm-0
      //'QTUM'     : { url: 'wss://ac-dev0.net:29188',                                         subBlocks: true },
      //'ZEC_TEST' : { url: 'wss://zec1.trezor.io',                                            subBlocks: true },
        'ETH_TEST' : { url: 'wss://ac-dev0.net:29136',                                         subBlocks: true },

      // (not used) -- issues with addr formats/creation iirc
      //'LTC_TEST' : { url: 'wss://scp-bb-etht01.southeastasia.cloudapp.azure.com:29134',      subBlocks: true },
    },

    //
    // ETH -- web3 WS providers, supporting pendingTransactions
    // UPDATE: DEC 2019 -- keeping subBlocks for worker-geth; it's duplicated in worker-blockbook::isosocket_Setup_Blockbook()
    //                     but seems required somehow (low value TUSD tx's aren't getting confirmed without it)
    //
    geth_ws_config: {
        'ETH'     : { url: 'wss://ac-dev0.net:10546',                                   subBlocks: true  },
      //'ETH'     : { url: 'wss://node0.scoop.tech:10546',                              subBlocks: true  },
      //'ETH'     : { url: 'wss://main-rpc.linkpool.io/ws',                             subBlocks: true  }, // ## no newPendingTransactions
      //'ETH'     : { url: 'wss://scp-eth4.southeastasia.cloudapp.azure.com:9546',      subBlocks: true  },
      
        'ETH_TEST': { url: 'wss://ac-dev0.net:9546',                                    subBlocks: true  },
      //'ETH_TEST': { url: 'wss://node0.scoop.tech:9546',                               subBlocks: true  },
      //'ETH_TEST': { url: 'wss://scp-bb-etht01.southeastasia.cloudapp.azure.com:9546', subBlocks: true  },
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
            //'5~CCCAGG~EOS~USD',
            '5~CCCAGG~TUSD~USD',
            //'5~CCCAGG~ZRX~USD',
            //'5~CCCAGG~BNT~USD',
            //'5~CCCAGG~BAT~USD',
            //'5~CCCAGG~BNB~USD',
            //'5~CCCAGG~OMG~USD',
            //'5~CCCAGG~GTO~USD',      //# bitfinex missing
            //'5~CCCAGG~SNT~USD',
            //'5~CCCAGG~HT~USD',       //# bitfinex missing
            '5~CCCAGG~DASH~USD',       //  bitfinex "tDSHUSD"
            //'5~CCCAGG~VTC~USD',      //# bitfinex missing
            //'5~CCCAGG~QTUM~USD',     //  bitfinex "tQTMUSD"
            '5~CCCAGG~DGB~USD',
            '5~CCCAGG~USDT~USD',       //  bitfinex "tUSTUSD"
            //'5~CCCAGG~EURT~USD',     //  bitfinex "tEUTUSD"
            '5~CCCAGG~LINK~USD',     
            //'5~CCCAGG~ZIL~USD',     
            //'5~CCCAGG~HOT~USD',     
            //'5~CCCAGG~REP~USD',     
            //'5~CCCAGG~MKR~USD',     
            //'5~CCCAGG~BCH~USD',
            '5~CCCAGG~NEXO~USD',
            //'5~CCCAGG~RVN~USD',

            //'5~CCCAGG~BAND~USD',
            //'5~CCCAGG~DOS~USD',
            //'5~CCCAGG~RING~USD',
            '5~CCCAGG~SWAP~USD',
            '5~CCCAGG~UNI~USD',
        ]
    },

}
