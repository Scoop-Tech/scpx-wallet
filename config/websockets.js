// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2025 Dominic Morris.
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
        'BTC_TEST' : { url: 'wss://x-btc-testnet.d0m1.com:10009',                              subBlocks: true },
        'BTC_TEST2': { url: 'wss://x-btc-testnet.d0m1.com:10009',                              subBlocks: true },

        'BTC'      : { url: 'wss://btc1.trezor.io',                                            subBlocks: true },
        'BTC_SEG'  : { url: 'wss://btc2.trezor.io',                                            subBlocks: true },
        'BTC_SEG2' : { url: 'wss://btc3.trezor.io',                                            subBlocks: true },
        'ZEC'      : { url: 'wss://zec1.trezor.io',                                            subBlocks: true }, // READ-ONLY asset; Blockbook 0.6 on Zebra (verified Nov 2026; ws getBlock = 'Not supported', estimateFee n/a; zec2/zec3 also live)
        'LTC'      : { url: 'wss://ltc1.trezor.io',                                            subBlocks: true },

      'ETH': { url: 'wss://eth.trezor.io', subBlocks: true }, // Trezor public Blockbook 0.6 (mainnet)
    //'ETH': { url: 'wss://ac-dev0.net:10003', subBlocks: true }, // (dead: ac-dev0 decommissioned)
      //'ETH': { url: 'wss://eth1.trezor.io',                                                  subBlocks: false },

      'DASH': { url: 'wss://dash1.trezor.io', subBlocks: true },
      //'VTC'      : { url: 'wss://vtc1.trezor.io',                                            subBlocks: true },
        'DGB'      : { url: 'wss://dgb1.trezor.io',                                            subBlocks: true },
      //'BCHABC'   : { url: 'wss://bch1.trezor.io',                                            subBlocks: true },
      //'RVN'      : { url: 'wss://blockbook.ravencoin.org',                                   subBlocks: true },

        // ### -- no public BB nodes: self-hosted on scp-dm-0
      //'QTUM'     : { url: 'wss://ac-dev0.net:29188',                                         subBlocks: true },
      // ZEC_TEST: NO public testnet Blockbook exists (Nov 2026) - needs a self-hosted zcash_testnet Blockbook before WALLET_INCLUDE_ZEC_TEST.
      // Never point it at a MAINNET Blockbook (e.g. zec1): it silently converts tm- testnet addresses to t1- mainnet ones and reports 0.
      //'ZEC_TEST' : { url: 'wss://<self-hosted zcash_testnet blockbook>:19132',                subBlocks: true },
        'ETH_TEST' : { url: 'wss://sepolia.trezor.io',                                         subBlocks: true }, // Trezor public Blockbook 0.6 (Sepolia)
      //'ETH_TEST' : { url: 'wss://ac-dev0.net:29136',                                         subBlocks: true }, // (dead: ac-dev0 decommissioned; was Ropsten)

      // (not used) -- issues with addr formats/creation iirc
      //'LTC_TEST' : { url: 'wss://scp-bb-etht01.southeastasia.cloudapp.azure.com:29134',      subBlocks: true },
    },

    //
    // ETH -- web3 WS providers, supporting pendingTransactions
    // UPDATE: DEC 2019 -- keeping subBlocks for worker-geth; it's duplicated in worker-blockbook::isosocket_Setup_Blockbook()
    //                     but seems required somehow (low value TUSD tx's aren't getting confirmed without it)
    //
    geth_ws_config: {
        'ETH'     : { url: 'wss://ethereum-rpc.publicnode.com',                         subBlocks: true  }, // publicnode free mainnet (no key)
      //'ETH'     : { url: 'wss://ac-dev0.net:10546',                                   subBlocks: true  }, // (dead: ac-dev0 decommissioned)
      //'ETH'     : { url: 'wss://node0.scoop.tech:10546',                              subBlocks: true  },
      //'ETH'     : { url: 'wss://main-rpc.linkpool.io/ws',                             subBlocks: true  }, // ## no newPendingTransactions
      //'ETH'     : { url: 'wss://scp-eth4.southeastasia.cloudapp.azure.com:9546',      subBlocks: true  },
      
        'ETH_TEST': { url: 'wss://ethereum-sepolia-rpc.publicnode.com',                 subBlocks: true  }, // publicnode free Sepolia (no key)
      //'ETH_TEST': { url: 'wss://ac-dev0.net:9546',                                    subBlocks: true  }, // (dead: ac-dev0 decommissioned; was Ropsten)
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
            '5~CCCAGG~USDC~USD',
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
