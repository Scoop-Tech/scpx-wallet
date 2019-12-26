// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.

//
// utxo v2 - insight api rest (absolete, but backup for non-BB supported types - now only using websockets/insight WS interfaces for Insight)
//
const serverBaseApi = 'https://scpx-svr.azurewebsites.net' 

//const btcInsightApi = 'https://scp-btc2.southeastasia.cloudapp.azure.com:4001/insight-api/'
//const btcInsightApi = 'https://insight.bitpay.com/api/'   // ??? api/tx lags substantially, also quite possibly /utxo also -- not usable?

//const ltcInsightApi = 'https://insight.litecore.io/api/'
//const ltcInsightApi = 'https://scp-ltc2.southeastasia.cloudapp.azure.com:4001/insight-lite-api/'

//const zecInsightApi = 'https://zcashnetwork.info/api/'
//const zecInsightApi = 'https://scp-zec1.southeastasia.cloudapp.azure.com:4001/insight-api-zcash/' // hard to find usable and maintained insight forks

//const bchabcInsightApi = 'https://blockdozer.com/insight-api/'

// TODO: setup node0 btc_test insight instance (or BB front-end, heard it's API-compatible with insight-api?)
const btcTestInsightApi = 'https://scp-btct.southeastasia.cloudapp.azure.com:4001/insight-api/'
//const btcTestInsightApi = 'https://node0.scoop.tech:7545/api/' //'https://test-insight.bitpay.com/api/' --> gives 429's
//const btcTestInsightApi = 'https://test-insight.bitpay.com/api/'

//
// eth - geth
// 
const ethHttpProvider = 
      'https://ac-dev0.net:10545'
    //'https://node0.scoop.tech:10545'
    //'https://scp-eth4.southeastasia.cloudapp.azure.com:9545' 
    //'https://main-rpc.linkpool.io'

const ethTestHttpProvider = 
      'https://ac-dev0.net:9545'
    //'https://node0.scoop.tech:9545'
    //'https://scp-bb-etht01.southeastasia.cloudapp.azure.com:9545'
    //'https://ropsten.infura.io/v3/93db2c7fd899496d8400e86100058297'

const erc20Contracts = { 
    TUSD: '0x0000000000085d4780b73119b644ae5ecd22b376',
    BNT:  '0x1f573d6fb3f13d689ff844b4ce37794d79a7ff1c',
    ZRX:  '0xe41d2489571d322189246dafa5ebde1f4699f498',
    BAT:  '0x0d8775f648430679a709e98d2b0cb6250d2887ef',
    BNB:  '0xB8c77482e45F1F44dE1745F52C74426C631bDD52',
    
    OMG:  '0xd26114cd6EE289AccF82350c8d8487fedB8A0C07',
    GTO:  '0xC5bBaE50781Be1669306b9e001EFF57a2957b09d',
    SNT:  '0x744d70FDBE2Ba4CF95131626614a1763DF805B9E',
    HT:   '0x6f259637dcD74C767781E37Bc6133cd6A68aa161',
    //BTM:  '0xcB97e65F07DA24D46BcDD078EBebd7C6E6E3d750',
    //VEN:  '0xD850942eF8811f2A866692A623011bDE52a462C1',

    USDT: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    EURT: '0xabdf147870235fcfc34153828c769a70b3fae01f',

    LINK: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
    ZIL:  '0x05f4a42e251f2d52b8ed15E9FEdAacFcEF1FAD27',
    HOT:  '0x6c6EE5e31d828De241282B9606C8e98Ea48526E2',
    REP:  '0x1985365e9f78359a9B6AD760e32412f4a445E862',
    MKR:  '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2',

    NEXO:  '0xb62132e35a6c13ee1ee0f84dc5d40bad8d815206',

    CCC_TEST: '0xe222aBB273F1C32bD353522A1b8899189552548d',
    
}

function eth_AddrExplorer(address) { 
    //return `https://blockscout.com/eth/mainnet/address/${address}` 
    return `https://etherscan.io/address/${address}`
}
function erc20_AddrExplorer(address) {
    return `https://etherscan.io/tokentxns?a=${address}`
}
function eth_TxExplorer(tx) {
    //return `https://blockscout.com/eth/mainnet/tx/${tx}/internal_transactions`
    return `https://etherscan.io/tx/${tx}`
}

module.exports = {

    // utxo v2- insight api legacy - kept alive only for btc_test
    serverBaseApi
    //,btcInsightApi
    //,ltcInsightApi
    //,zecInsightApi
    //,bchabcInsightApi
    ,btcTestInsightApi

    // eth
    ,erc20Contracts
    ,ethHttpProvider

    //
    // utxo/BB v3 - pure blockbook
    // using proxy with CORS to external trezor nodes for https, and direct trezor node for sockets
    //
    ,zecBlockbookApi: 'https://ac-dev0.net:10000/api/' //'https://scp-bb-zec01.southeastasia.cloudapp.azure.com:8888/api/' //'https://zec1.trezor.io/api/'

    ,ltcBlockbookApi: 'https://ac-dev0.net:10001/api/' //'https://scp-bb-ltc01.southeastasia.cloudapp.azure.com:8888/api/' //'https://ltc1.trezor.io/api/'

    ,btcBlockbookApi: 'https://ac-dev0.net:10002/api/' //'https://scp-btcsw.southeastasia.cloudapp.azure.com:10130/api/' //,btcBlockbookApi: 'https://btc1.trezor.io/api/'

    ,dashBlockbookApi: 'https://ac-dev0.net:10004/api/' //'https://scp-bb-dash01.southeastasia.cloudapp.azure.com:8888/api/' // 'https://scp-btcsw.southeastasia.cloudapp.azure.com:10133/api/'

    ,vtcBlockbookApi: 'https://ac-dev0.net:10005/api/' //'https://scp-bb-vtc01.southeastasia.cloudapp.azure.com:8888/api/'

    ,dgbBlockbookApi: 'https://ac-dev0.net:10006/api/' //'https://scp-bb-dgb01.southeastasia.cloudapp.azure.com:8888/api/'

    ,bchabcBlockbookApi: 'https://ac-dev0.net:10007/api/' //'https://scp-bb-bch02.southeastasia.cloudapp.azure.com:8888/api/'

    ,rvnTestBlockbookApi: 'https://ac-dev0.net:10008/api/'

    ,qtumBlockbookApi: 'https://ac-dev0.net:29188/api/' //'https://scp-bb-qtum01.southeastasia.cloudapp.azure.com:8888/api/'

    ,zecTestBlockbookApi: 'https://ac-dev0.net:29132/api/' //'https://scp-bb-etht01.southeastasia.cloudapp.azure.com:29132/api'

    // NOT USED
    ,ltcTestBlockbookApi: '' //'https://scp-bb-etht01.southeastasia.cloudapp.azure.com:29134/api'

    //
    // fee oracles
    // 
    ,ethFeeOracle_EtherChainOrg: `https://www.etherchain.org/api/gasPriceOracle`
    ,btcFeeOracle_BitGo: `https://www.bitgo.com/api/v1/tx/fee?numBlocks=2`
    ,ltcFeeOracle_BlockCypher: `https://api.blockcypher.com/v1/ltc/main`
    ,dashFeeOracle_BlockCypher: `https://api.blockcypher.com/v1/dash/main`

    ,qtumFeeOracle_Blockbook: `https://ac-dev0.net:29188/api/v2/estimatefee/1` // `https://scp-bb-qtum01.southeastasia.cloudapp.azure.com:8888/api/v2/estimatefee/1`
    ,vtcFeeOracle_Blockbook: `https://ac-dev0.net:10005/api/v2/estimatefee/1` //`https://scp-bb-vtc01.southeastasia.cloudapp.azure.com:8888/api/v2/estimatefee/1`
    ,dgbFeeOracle_Blockbook: 'https://ac-dev0.net:10006/api/v2/estimatefee/1' //`https://scp-bb-dgb01.southeastasia.cloudapp.azure.com:8888/api/v2/estimatefee/1`
    ,bchabcFeeOracle_Blockbook: 'https://ac-dev0.net:10007/api/v2/estimatefee/1' //`https://scp-bb-bch02.southeastasia.cloudapp.azure.com:8888/api/v2/estimatefee/1`
    
    ,rvnFeeOracle_Blockbook: 'https://blockbook.ravencoin.org/api/v2/estimatefee/1'

    // NOT USED
    ,ltcTestFeeOracle_Blockbook: '' //`https://scp-bb-etht01.southeastasia.cloudapp.azure.com:29134/api/v2/estimatefee/1`

    ,walletExternal_config: {
    
        BTC: {
            donate: '192baToCaVeVTrsYdKTib8QXkoL4Jppg9x',
            explorerPath: (address) => { return     'https://www.blockchain.com/en/btc/address/' + address },
            txExplorerPath: (txid) => { return 'https://www.blockchain.com/btc/tx/' + txid },
            api: {
                utxo: (address) => { return `${btcBlockbookApi}v1/utxo/${address}` },
            }
        },
        BTC_SEG: {
            donate: '32FtNE5ShUDh4wQJm3bGYGtjKpFeJqeVEw',
            explorerPath: (address) => { return 'https://www.blockchain.com/en/btc/address/' + address },
            txExplorerPath: (txid) => { return 'https://www.blockchain.com/btc/tx/' + txid },
            api: {
                utxo: (address) => { return `${btcBlockbookApi}v1/utxo/${address}` },
            }
        },
        DASH: {
            donate: 'Xw9oJkZHqMYiEiRTVjQ3sqhLBxyrZgd2WH',
            explorerPath: (address) => { return 'https://insight.dash.org/insight/address/' + address },
            txExplorerPath: (txid) => { return 'https://insight.dash.org/insight/tx/' + txid },
            api: {
                utxo: (address) => { return `${dashBlockbookApi}v1/utxo/${address}` },
            }
        },
        VTC: {
            donate: 'VxUmA3JdxdFjGn75FF7jpBzt63quPsfzm7',
            explorerPath: (address) => { return 'https://insight.vertcoin.org/address/' + address },
            txExplorerPath: (txid) => { return 'https://insight.vertcoin.org/tx/' + txid },
            api: {
                utxo: (address) => { return `${vtcBlockbookApi}v1/utxo/${address}` },
            }
        },
        QTUM: {
            donate: 'QbXCeBHPoyNz99r9gRdWbRJMA3FZJQyYVH',
            explorerPath: (address) => { return 'https://explorer.qtum.org/address/' + address },
            txExplorerPath: (txid) => { return 'https://explorer.qtum.org/tx/' + txid },
            api: {
                utxo: (address) => { return `${qtumBlockbookApi}v1/utxo/${address}` },
            }
        },
        DGB: {
            donate: 'D6nE8r7Bwh25ER8rfMYF99qVG2R7kd9pHv',
            explorerPath: (address) => { return 'https://digiexplorer.info/address/' + address },
            txExplorerPath: (txid) => { return 'https://digiexplorer.info/tx/' + txid },
            api: {
                utxo: (address) => { return `${dgbBlockbookApi}v1/utxo/${address}` },
            }
        },
        BCHABC: {
            donate: 'bitcoincash:qr64xlxssq62t0ntyccxgwk7x0ftpw52lc0yflvyje',
            explorerPath: (address) => { return 'https://blockdozer.com/address/' + address },
            txExplorerPath: (txid) => { return 'https://blockdozer.com/tx/' + txid },
            api: {
                utxo: (address) => { return `${bchabcBlockbookApi}v1/utxo/${address}` },
            }
        },

        BTC_TEST: { // BTC TestNet3 -- https://testnet-faucet.mempool.co/  https://tbtc.bitaps.com/   http://bitcoinfaucet.uo1.net/send.php
            donate: 'mju9idRjxM2JD8bzPkZpF1t68B1M4Pgn2Y', // testnets@scoop.tech
            explorerPath: (address) => { return 'https://live.blockcypher.com/btc-testnet/address/' + address },
            txExplorerPath: (txid) => { return 'https://live.blockcypher.com/btc-testnet/tx/' + txid },
            api: { // insight-api -- active/fallback
                baseUrl: () => { return btcTestInsightApi },
                sync: () => { return btcTestInsightApi + 'sync' },
                block: (blockHash) => { return btcTestInsightApi + 'block/' + blockHash },
                v2_tx: (txid) => { return btcTestInsightApi + 'tx/' + txid },
                v2_addrData: (address, from, to) => { return `${btcTestInsightApi}addr/${address}?from=${from}&to=${to}` },
                v2_addrBal: (address) => { return `${btcTestInsightApi}addr/${address}?noTxList=1` },
                balance: (address) => { return btcTestInsightApi + 'addr/' + address + '/balance' },
                unconfirmedBalance: (address) => { return btcTestInsightApi + 'addr/' + address + '/unconfirmedBalance' },
                tx: (txid) => { return btcTestInsightApi + 'tx/' + txid },
                txs: (address) => { return btcTestInsightApi + 'txs/?address=' + address },
                utxo: (address) => { return btcTestInsightApi + 'addrs/' + address + '/utxo' },
                push_tx: btcTestInsightApi + 'tx/send',
            }
        },
        LTC: {
            donate: 'LcTqsN3agVPA6EX2hhq2gtJBwjdpq2c6GC',
            explorerPath: (address) => { return 'https://live.blockcypher.com/ltc/address/' + address },
            txExplorerPath: (txid) => { return 'https://live.blockcypher.com/ltc/tx/' + txid },
            api: {
                utxo: (address) => { return `${ltcBlockbookApi}v1/utxo/${address}` },
            }
        },
        LTC_TEST: { // LTC TestNet4 -- no working faucet
            donate: 'mxkquCpjQraMcYJVF8p7EnSkbWsFd8cQdq', 
            explorerPath: (address) => { return 'https://chain.so/address/LTCTEST/address/' + address },
            txExplorerPath: (txid) => { return 'https://chain.so/tx/LTCTEST/' + txid },
            api: {
                utxo: (address) => { return `${ltcTestBlockbookApi}v1/utxo/${address}` },
            }
        },

        ZEC: {
            donate: 't1cf9PNYWAaF5u54nuQV9ki3G6LwE3dB4bi',
            explorerPath: (address) => { return 'https://chain.so/address/ZEC/' + address }, // shows unconfirmed better than zcha.in
            txExplorerPath: (txid) => { return 'https://chain.so/tx/ZEC/' + txid },
            //explorerPath: (address) => { return 'https://explorer.zcha.in/accounts/' + address },
            //txExplorerPath: (txid) => { return 'https://explorer.zcha.in/transactions/' + txid },
            api: {
                utxo: (address) => { return `${zecBlockbookApi}v1/utxo/${address}` },
            }        
        },
        ZEC_TEST: { // ZEC Testnet faucet -- https://faucet.testnet.z.cash/  https://zcashfaucet.info/complete
            donate: 'tmH76MkVHc1ZDyWvdY3RDnZzzmXoFpFtXt9', // testnets@scoop.tech
            explorerPath: (address) => { return 'https://explorer.testnet.z.cash/address/' + address },
            txExplorerPath: (txid) => { return 'https://explorer.testnet.z.cash/tx/' + txid },
            api: {
                utxo: (address) => { return `${zecTestBlockbookApi}v1/utxo/${address}` },
            }
        },

        RVN: {
            donate: 'RG7VkPniBt9K3nqhSucTxM6x8o1xsoEGHW', 
            explorerPath: (address) => { return 'https://ravencoin.network/address/' + address },
            txExplorerPath: (txid) => { return 'https://ravencoin.network/tx/' + txid },
            api: {
                utxo: (address) => { return `${rvnBlockbookApi}v1/utxo/${address}` },
            }
        },

        EOS: {
            donate: 'guytmnrrguge',
            explorerPath: (address) => { return 'https://etherscan.io/address/' + address },
            txExplorerPath: (txid) => { return 'https://etherscan.io/tx/' + txid },
            api: {
                txlist: (address) => {
                    return 'https://api.etherscan.io/api?module=account&action=txlist&address=' + address + '&startblock=0&endblock=99999999&sort=asc&apikey=EG3Q7SGYF2CN7AWZIFFY2UEC8MN7M6B883'
                }
            }
        },

        ETH: { 
            donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
            explorerPath: (address) => eth_AddrExplorer(address),
            txExplorerPath: (txid) => eth_TxExplorer(txid),
            httpProvider: ethHttpProvider,
            // api: { // etherscan-compatible REST API (deprecated)
            //     // txlist: (address) =>  { return `https://api.etherscan.io/api?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=asc&apikey=${es_apiKeys[0]}` },
            //     // balance: (address) => { return `https://api.etherscan.io/api?module=account&action=balance&address=${address}&tag=latest&apikey=${es_apiKeys[0]}` }
            //     txlist: (address) =>  { return `https://blockscout.com/eth/mainnet/api?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=asc` },
            //     balance: (address) => { return `https://blockscout.com/eth/mainnet/api?module=account&action=balance&address=${address}` }
            // }
        },
        ETH_TEST: { // ropsten  https://faucet.metamask.io/  
            donate: '0x8443b1edf203f96d1a5ec98301cfebc4d3cf2b20', // testnets@scoop.tech
            explorerPath: (address) => { return 'https://ropsten.etherscan.io/address/' + address },
            txExplorerPath: (txid) =>  { return 'https://ropsten.etherscan.io/tx/' + txid },
            httpProvider: ethTestHttpProvider,
        },

        TUSD: { 
            donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
            contractAddress: erc20Contracts.TUSD,
            explorerPath: (address) => erc20_AddrExplorer(address),
            txExplorerPath: (txid) => eth_TxExplorer(txid),
            httpProvider: ethHttpProvider,
        },
        // TUSD_TEST: {
        //     donate: '0x8443b1edf203f96d1a5ec98301cfebc4d3cf2b20', // testnets@scoop.tech
        //     explorerPath: (address) => { return 'https://ropsten.etherscan.io/address/' + address },
        //     txExplorerPath: (txid) =>  { return 'https://ropsten.etherscan.io/tx/' + txid },
        //     httpProvider: ethTestHttpProvider,
        // },
        CCC_TEST: {
            donate: '0x8443b1edf203f96d1a5ec98301cfebc4d3cf2b20', // testnets@scoop.tech
            contractAddress: erc20Contracts.CCC_TEST,
            explorerPath: (address) => { return 'https://ropsten.etherscan.io/address/' + address },
            txExplorerPath: (txid) =>  { return 'https://ropsten.etherscan.io/tx/' + txid },
            httpProvider: ethTestHttpProvider,
        },

        BNT: {
            donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
            contractAddress: erc20Contracts.BNT,
            explorerPath: (address) => erc20_AddrExplorer(address),
            txExplorerPath: (txid) => eth_TxExplorer(txid),
            httpProvider: ethHttpProvider,
        },
        ZRX: {
            donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
            contractAddress: erc20Contracts.ZRX,
            explorerPath: (address) => erc20_AddrExplorer(address),
            txExplorerPath: (txid) => eth_TxExplorer(txid),
            httpProvider: ethHttpProvider,
        },
        BAT: {
            donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
            contractAddress: erc20Contracts.BAT,
            explorerPath: (address) => erc20_AddrExplorer(address),
            txExplorerPath: (txid) => eth_TxExplorer(txid),
            httpProvider: ethHttpProvider,
        },
        BNB: {
            donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
            contractAddress: erc20Contracts.BNB,
            explorerPath: (address) => erc20_AddrExplorer(address),
            txExplorerPath: (txid) => eth_TxExplorer(txid),
            httpProvider: ethHttpProvider,
        },
        
        OMG: {
            donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
            contractAddress: erc20Contracts.OMG,
            explorerPath: (address) => erc20_AddrExplorer(address),
            txExplorerPath: (txid) => eth_TxExplorer(txid),
            httpProvider: ethHttpProvider,
        },
        GTO: {
            donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
            contractAddress: erc20Contracts.GTO,
            explorerPath: (address) => erc20_AddrExplorer(address),
            txExplorerPath: (txid) => eth_TxExplorer(txid),
            httpProvider: ethHttpProvider,
        },
        SNT: {
            donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
            contractAddress: erc20Contracts.SNT,
            explorerPath: (address) => erc20_AddrExplorer(address),
            txExplorerPath: (txid) => eth_TxExplorer(txid),
            httpProvider: ethHttpProvider,
        },
        HT: {
            donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
            contractAddress: erc20Contracts.HT,
            explorerPath: (address) => erc20_AddrExplorer(address),
            txExplorerPath: (txid) => eth_TxExplorer(txid),
            httpProvider: ethHttpProvider,
        },
        // BTM: { // old erc20 - now on mainnet
        //     donate: '0x8c7015Be965CFa11ec7BfC25FDDDA4FE4A1e34AB',
        //     contractAddress: erc20Contracts.BTM,
        //     explorerPath: (address) => erc20_AddrExplorer(address),
        //     txExplorerPath: (txid) => eth_TxExplorer(txid),
        //     httpProvider: ethHttpProvider,
        // },    
        // VEN: { // old erc20 - now on mainnet
        //     donate: '0x8c7015Be965CFa11ec7BfC25FDDDA4FE4A1e34AB',
        //     contractAddress: erc20Contracts.VEN,
        //     explorerPath: (address) => erc20_AddrExplorer(address),
        //     txExplorerPath: (txid) => eth_TxExplorer(txid),
        //     httpProvider: ethHttpProvider,
        // },

        USDT: {
            donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
            contractAddress: erc20Contracts.USDT,
            explorerPath: (address) => erc20_AddrExplorer(address),
            txExplorerPath: (txid) => eth_TxExplorer(txid),
            httpProvider: ethHttpProvider,
        },
        EURT: {
            donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
            contractAddress: erc20Contracts.EURT,
            explorerPath: (address) => erc20_AddrExplorer(address),
            txExplorerPath: (txid) => eth_TxExplorer(txid),
            httpProvider: ethHttpProvider,
        },

        LINK: {
            donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
            contractAddress: erc20Contracts.LINK,
            explorerPath: (address) => erc20_AddrExplorer(address),
            txExplorerPath: (txid) => eth_TxExplorer(txid),
            httpProvider: ethHttpProvider,
        },
        ZIL: {
            donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
            contractAddress: erc20Contracts.ZIL,
            explorerPath: (address) => erc20_AddrExplorer(address),
            txExplorerPath: (txid) => eth_TxExplorer(txid),
            httpProvider: ethHttpProvider,
        },
        HOT: {
            donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
            contractAddress: erc20Contracts.HOT,
            explorerPath: (address) => erc20_AddrExplorer(address),
            txExplorerPath: (txid) => eth_TxExplorer(txid),
            httpProvider: ethHttpProvider,
        },
        REP: {
            donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
            contractAddress: erc20Contracts.REP,
            explorerPath: (address) => erc20_AddrExplorer(address),
            txExplorerPath: (txid) => eth_TxExplorer(txid),
            httpProvider: ethHttpProvider,
        },
        MKR: {
            donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
            contractAddress: erc20Contracts.MKR,
            explorerPath: (address) => erc20_AddrExplorer(address),
            txExplorerPath: (txid) => eth_TxExplorer(txid),
            httpProvider: ethHttpProvider,
        },
        NEXO: {
            donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
            contractAddress: erc20Contracts.NEXO,
            explorerPath: (address) => erc20_AddrExplorer(address),
            txExplorerPath: (txid) => eth_TxExplorer(txid),
            httpProvider: ethHttpProvider,
        },
    }
}