// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2025 Dominic Morris.

//
// insight utxo v2 - insight api rest (absolete, but backup for non-BB supported types - now only using websockets/insight WS interfaces for Insight)
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
// blockbook rest/api
//
const zecBlockbookApi     = 'https://ac-dev0.net:10000/api/'     // 'https://zec1.trezor.io/api/'
const ltcBlockbookApi     = 'https://ac-dev0.net:10001/api/'     // 'https://ltc1.trezor.io/api/'

const btcBlockbookApi     = 'https://ac-dev0.net:10002/api/'     // use different btc/btc_seg BB servers to minimize 429's on api/block calls
//const btcTestBlockbookApi = 'https://tbtc2.trezor.io/api/'
const btcTestBlockbookApi  = 'https://x-btc-testnet.d0m1.com:10009/api/'

const dashBlockbookApi    = 'https://ac-dev0.net:10004/api/'     // 'https://scp-btcsw.southeastasia.cloudapp.azure.com:10133/api/'
const vtcBlockbookApi     = 'https://ac-dev0.net:10005/api/'     // 'https://scp-bb-vtc01.southeastasia.cloudapp.azure.com:8888/api/'
const dgbBlockbookApi     = 'https://ac-dev0.net:10006/api/'     // 'https://scp-bb-dgb01.southeastasia.cloudapp.azure.com:8888/api/'
const bchabcBlockbookApi  = 'https://ac-dev0.net:10007/api/'     // 'https://scp-bb-bch02.southeastasia.cloudapp.azure.com:8888/api/'
const rvnBlockbookApi     = 'https://ac-dev0.net:10008/api/'
const qtumBlockbookApi    = 'https://ac-dev0.net:29188/api/'     // 'https://scp-bb-qtum01.southeastasia.cloudapp.azure.com:8888/api/'
const zecTestBlockbookApi = 'https://ac-dev0.net:29132/api/'     // 'https://scp-bb-etht01.southeastasia.cloudapp.azure.com:29132/api'
const ltcTestBlockbookApi = ''                                   // NOT USED //'https://scp-bb-etht01.southeastasia.cloudapp.azure.com:29134/api'

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
  //BNB:  '0xB8c77482e45F1F44dE1745F52C74426C631bDD52',
    
    OMG:  '0xd26114cd6EE289AccF82350c8d8487fedB8A0C07',
  //GTO:  '0xC5bBaE50781Be1669306b9e001EFF57a2957b09d',
    SNT:  '0x744d70FDBE2Ba4CF95131626614a1763DF805B9E',
  //HT:   '0x6f259637dcD74C767781E37Bc6133cd6A68aa161',
  //BTM:  '0xcB97e65F07DA24D46BcDD078EBebd7C6E6E3d750',
  //VEN:  '0xD850942eF8811f2A866692A623011bDE52a462C1',

    USDT: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    EURT: '0xabdf147870235fcfc34153828c769a70b3fae01f',

    LINK: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
    ZIL:  '0x05f4a42e251f2d52b8ed15E9FEdAacFcEF1FAD27',
    HOT:  '0x6c6EE5e31d828De241282B9606C8e98Ea48526E2',
    REP:  '0x1985365e9f78359a9B6AD760e32412f4a445E862',
    MKR:  '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2',

    NEXO: '0xb62132e35a6c13ee1ee0f84dc5d40bad8d815206',

    BAND: '0xba11d00c5f74255f56a5e366f4f77f5a186d7f55',
    DOS:  '0x0A913beaD80F321E7Ac35285Ee10d9d922659cB7',
    RING: '0x9469d013805bffb7d3debe5e7839237e535ec483',
    SWAP: '0xCC4304A31d09258b0029eA7FE63d032f52e44EFe',
    UNI: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',

    CCC_TEST: '0xD661a646E28D157eb60e74298CE799E23d17db07', // v0.96a
    AY1A_TEST: '0xf07aA78a849A441eBf882967F6130BD3E71C1D9C', // v0.95c
  //SD1A_TEST: '0x21d233232d7A53BCf7141FD83329455106796Ee9', // v0.95c
}

// eth explorers - mainnet
function eth_AddrExplorer(address) { 
    return `https://etherscan.io/address/${address}`
}
function eth_TxExplorer(tx) {
    return `https://etherscan.io/tx/${tx}`
}
function erc20_AddrExplorer(tokenAddr, holderAddr) {
    return `https://etherscan.io/token/${tokenAddr}?a=${holderAddr}` // `https://etherscan.io/tokentxns?a=${address}`
}

// eth explorers - ropsten
function eth_ropstenAddrExplorer(address) { 
    return `https://ropsten.etherscan.io/address/${address}`
}
function eth_ropstenTxExplorer(tx) {
    return `https://ropsten.etherscan.io/tx/${tx}`
}
function erc20_ropstenAddrExplorer(tokenAddr, holderAddr) {
    return `https://ropsten.etherscan.io/token/${tokenAddr}?a=${holderAddr}` // `https://ropsten.etherscan.io/tokentxns?a=${address}`
}

const walletExternal_config = {
    
    BTC: { // BTC mainnet - legacy, unused
        donate: '192baToCaVeVTrsYdKTib8QXkoL4Jppg9x', // d+10
        explorerPath: (address) => { return 'https://www.blockchain.com/en/btc/address/' + address },
        txExplorerPath: (txid) => { return 'https://www.blockchain.com/btc/tx/' + txid },
        api: {
            utxo: (address) => { return `${btcBlockbookApi}v1/utxo/${address}` },
            block: (blockHash, page) => { return `${btcBlockbookApi}v2/block/${blockHash}?page=${page}` },
        }
    },
    BTC_SEG: { // BTC mainnet - p2sh - current
        donate: '3BpYKfAp3Rks5ykGJXJNifJjnnH6me7Rmo', // d+11
        explorerPath: (address) => { return 'https://blockstream.info/testnet/address/' + address },
        txExplorerPath: (txid) => { return 'https://blockstream.info/testnet/tx/' + txid },
        api: {
            utxo: (address) => { return `${btcBlockbookApi}v1/utxo/${address}` },
            block: (blockHash, page) => { return `${btcBlockbookApi}v2/block/${blockHash}?page=${page}` },
        }
    },
    BTC_SEG2: { // BTC mainnet - p2wpkh - target
        donate: 'bc1qpm6knrsjl6cjfseyqzpwqczvynnrlh3wtzpuak', // d+11
        explorerPath: (address) => { return 'https://blockstream.info/testnet/address/' + address },
        txExplorerPath: (txid) => { return 'https://blockstream.info/testnet/tx/' + txid },
        api: {
            utxo: (address) => { return `${btcBlockbookApi}v1/utxo/${address}` },   
            block: (blockHash, page) => { return `${btcBlockbookApi}v2/block/${blockHash}?page=${page}` },
        }
    },

    BTC_TEST: { // BTC testnet4 - p2sh - 
        // (old: testnet3 - https://coinfaucet.eu/en/btc-testnet/  https://testnet-faucet.mempool.co/  https://tbtc.bitaps.com/   http://bitcoinfaucet.uo1.net/send.php)
        donate: '2N8YjBPwpXQCLbeJznJj9c9dhLqBSAm52LW', // testnets4@d0m1.com... was: //'2NFsNU7FJusZeNiCAHwHJvjw1UBLT1hw6iv', // testnets2@scoop.tech P2SH
        explorerPath: (address) => { return 'https://mempool.space/testnet4/address/' + address },
        txExplorerPath: (txid) => { return 'https://mempool.space/testnet4/tx/' + txid },
        api: {
            utxo: (address) => { return `${btcTestBlockbookApi}v1/utxo/${address}` },
            block: (blockHash, page) => { return `${btcTestBlockbookApi}v2/block/${blockHash}?page=${page}` },
        }
    },
    BTC_TEST2: { // BTC testnet4 - p2wpkh - https://faucet.testnet4.dev / https://coinfaucet.eu/en/btc-testnet4 / https://bitcoinfaucet.uo1.net/send.php
        donate: 'tb1q9s8qvvrvafadl7wxj2axp3l5tg7nensjr27e8r', // testnets4@d0m1.com... was: 'tb1qyghzsgls50k5l86q9tx0xf5n52c25lm0hpa6x9', // testnets2@scoop.tech Bech32 Testnet
        explorerPath: (address) => { return 'https://mempool.space/testnet4/address/' + address },
        txExplorerPath: (txid) => { return 'https://mempool.space/testnet4/tx/' + txid },
        api: {
            utxo: (address) => { return `${btcBlockbookApi}v1/utxo/${address}` },
            block: (blockHash, page) => { return `${btcBlockbookApi}v2/block/${blockHash}?page=${page}` },
        }
    },

    DASH: {
        donate: 'Xw9oJkZHqMYiEiRTVjQ3sqhLBxyrZgd2WH',
        explorerPath: (address) => { return 'https://insight.dash.org/insight/address/' + address },
        txExplorerPath: (txid) => { return 'https://insight.dash.org/insight/tx/' + txid },
        api: {
            utxo: (address) => { return `${dashBlockbookApi}v1/utxo/${address}` },
            block: (blockHash, page) => { return `${dashBlockbookApi}v2/block/${blockHash}?page=${page}` },
        }
    },
    VTC: {
        donate: 'VxUmA3JdxdFjGn75FF7jpBzt63quPsfzm7',
        explorerPath: (address) => { return 'https://insight.vertcoin.org/address/' + address },
        txExplorerPath: (txid) => { return 'https://insight.vertcoin.org/tx/' + txid },
        api: {
            utxo: (address) => { return `${vtcBlockbookApi}v1/utxo/${address}` },
            block: (blockHash, page) => { return `${vtcBlockbookApi}v2/block/${blockHash}?page=${page}` },
        }
    },
    QTUM: {
        donate: 'QbXCeBHPoyNz99r9gRdWbRJMA3FZJQyYVH',
        explorerPath: (address) => { return 'https://explorer.qtum.org/address/' + address },
        txExplorerPath: (txid) => { return 'https://explorer.qtum.org/tx/' + txid },
        api: {
            utxo: (address) => { return `${qtumBlockbookApi}v1/utxo/${address}` },
            block: (blockHash, page) => { return `${qtumBlockbookApi}v2/block/${blockHash}?page=${page}` },
        }
    },
    DGB: {
        donate: 'D6nE8r7Bwh25ER8rfMYF99qVG2R7kd9pHv',
        explorerPath: (address) => { return 'https://digiexplorer.info/address/' + address },
        txExplorerPath: (txid) => { return 'https://digiexplorer.info/tx/' + txid },
        api: {
            utxo: (address) => { return `${dgbBlockbookApi}v1/utxo/${address}` },
            block: (blockHash, page) => { return `${dgbBlockbookApi}v2/block/${blockHash}?page=${page}` },
        }
    },
    BCHABC: {
        donate: 'bitcoincash:qr64xlxssq62t0ntyccxgwk7x0ftpw52lc0yflvyje',
        explorerPath: (address) => { return 'https://explorer.bitcoin.com/bch/address/' + address },
        txExplorerPath: (txid) => { return 'https://explorer.bitcoin.com/bch/tx/' + txid },
        api: {
            utxo: (address) => { return `${bchabcBlockbookApi}v1/utxo/${address}` },
            block: (blockHash, page) => { return `${bchabcBlockbookApi}v2/block/${blockHash}?page=${page}` },
        }
    },

    LTC: {
        donate: 'LcTqsN3agVPA6EX2hhq2gtJBwjdpq2c6GC',
        explorerPath: (address) => { return 'https://live.blockcypher.com/ltc/address/' + address },
        txExplorerPath: (txid) => { return 'https://live.blockcypher.com/ltc/tx/' + txid },
        api: {
            utxo: (address) => { return `${ltcBlockbookApi}v1/utxo/${address}` },
            block: (blockHash, page) => { return `${ltcBlockbookApi}v2/block/${blockHash}?page=${page}` },
        }
    },
    LTC_TEST: { // ### LTC TestNet4 -- no working faucet 
        donate: 'mxkquCpjQraMcYJVF8p7EnSkbWsFd8cQdq', // ???
        explorerPath: (address) => { return 'https://chain.so/address/LTCTEST/address/' + address },
        txExplorerPath: (txid) => { return 'https://chain.so/tx/LTCTEST/' + txid },
        api: {
            utxo: (address) => { return `${ltcTestBlockbookApi}v1/utxo/${address}` },
            block: (blockHash, page) => { return `${ltcTestBlockbookApi}v2/block/${blockHash}?page=${page}` },
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
            block: (blockHash) => { return `${zecBlockbookApi}v2/block/${blockHash}` },
        }        
    },
    ZEC_TEST: { // ZEC Testnet faucet -- https://faucet.testnet.z.cash/  https://zcashfaucet.info/complete
        donate: 'tmAU27N3iHMeejD6GPHYiSnH8vit1XT9uEX', // testnets2@scoop.tech
        explorerPath: (address) => { return 'https://explorer.testnet.z.cash/address/' + address },
        txExplorerPath: (txid) => { return 'https://explorer.testnet.z.cash/tx/' + txid },
        api: {
            utxo: (address) => { return `${zecTestBlockbookApi}v1/utxo/${address}` },
            block: (blockHash, page) => { return `${zecTestBlockbookApi}v2/block/${blockHash}?page=${page}` },
        }
    },

    RVN: {
        donate: 'RG7VkPniBt9K3nqhSucTxM6x8o1xsoEGHW', 
        explorerPath: (address) => { return 'https://rvn.tokenview.com/en/address/' + address },
        txExplorerPath: (txid) => { return 'https://rvn.tokenview.com/en/tx/' + txid },
        api: {
            utxo: (address) => { return `${rvnBlockbookApi}v1/utxo/${address}` },
            block: (blockHash, page) => { return `${rvnBlockbookApi}v2/block/${blockHash}?page=${page}` },
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
    },
    ETH_TEST: { // ropsten  https://faucet.metamask.io/  
        donate: '0xda9abd90e6cd31e8e0c2d5f35d3d5a71c8661b0e', // testnets2@scoop.tech
        explorerPath: (address) => eth_ropstenAddrExplorer(address),
        txExplorerPath: (txid) =>  eth_ropstenTxExplorer(txid),
        httpProvider: ethTestHttpProvider,
    },

    TUSD: { 
        donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
        contractAddress: erc20Contracts.TUSD,
        explorerPath: (address) => erc20_AddrExplorer(erc20Contracts.TUSD, address), 
        txExplorerPath: (txid) => eth_TxExplorer(txid),
        httpProvider: ethHttpProvider,
    },
    // TUSD_TEST: {
    //     donate: '0xda9abd90e6cd31e8e0c2d5f35d3d5a71c8661b0e', // testnets2@scoop.tech
    //     explorerPath: (address) => eth_ropstenAddrExplorer(address),
    //     txExplorerPath: (txid) =>  eth_ropstenTxExplorer(txid),
    //     httpProvider: ethTestHttpProvider,
    // },
    CCC_TEST: {
        donate: '0xda9abd90e6cd31e8e0c2d5f35d3d5a71c8661b0e', // testnets2@scoop.tech
        contractAddress: erc20Contracts.CCC_TEST,
        explorerPath: (address) => erc20_ropstenAddrExplorer(erc20Contracts.CCC_TEST, address),
        txExplorerPath: (txid) => eth_ropstenTxExplorer(txid),
        httpProvider: ethTestHttpProvider,
    },
    // SD1A_TEST: {
    //     donate: '0xda9abd90e6cd31e8e0c2d5f35d3d5a71c8661b0e', // testnets2@scoop.tech
    //     contractAddress: erc20Contracts.SD1A_TEST,
    //     explorerPath: (address) => erc20_ropstenAddrExplorer(erc20Contracts.SD1A_TEST, address),
    //     txExplorerPath: (txid) => eth_ropstenTxExplorer(txid),
    //     httpProvider: ethTestHttpProvider,
    // },
    AY1A_TEST: {
        donate: '0xda9abd90e6cd31e8e0c2d5f35d3d5a71c8661b0e', // testnets2@scoop.tech
        contractAddress: erc20Contracts.AY1A_TEST,
        explorerPath: (address) => erc20_ropstenAddrExplorer(erc20Contracts.AY1A_TEST, address),
        txExplorerPath: (txid) => eth_ropstenTxExplorer(txid),
        httpProvider: ethTestHttpProvider,
    },

    BNT: {
        donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
        contractAddress: erc20Contracts.BNT,
        explorerPath: (address) => erc20_AddrExplorer(erc20Contracts.BNT, address),
        txExplorerPath: (txid) => eth_TxExplorer(txid),
        httpProvider: ethHttpProvider,
    },
    ZRX: {
        donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
        contractAddress: erc20Contracts.ZRX,
        explorerPath: (address) => erc20_AddrExplorer(erc20Contracts.ZRX, address),
        txExplorerPath: (txid) => eth_TxExplorer(txid),
        httpProvider: ethHttpProvider,
    },
    BAT: {
        donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
        contractAddress: erc20Contracts.BAT,
        explorerPath: (address) => erc20_AddrExplorer(erc20Contracts.BAT, address),
        txExplorerPath: (txid) => eth_TxExplorer(txid),
        httpProvider: ethHttpProvider,
    },
    // BNB: { // old erc20
    //     donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
    //     contractAddress: erc20Contracts.BNB,
    //     explorerPath: (address) => erc20_AddrExplorer(erc20Contracts.BNB, address),
    //     txExplorerPath: (txid) => eth_TxExplorer(txid),
    //     httpProvider: ethHttpProvider,
    // },
    
    OMG: {
        donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
        contractAddress: erc20Contracts.OMG,
        explorerPath: (address) => erc20_AddrExplorer(erc20Contracts.OMG, address),
        txExplorerPath: (txid) => eth_TxExplorer(txid),
        httpProvider: ethHttpProvider,
    },
    // GTO: { // retiring - not liked
    //     donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
    //     contractAddress: erc20Contracts.GTO,
    //     explorerPath: (address) => erc20_AddrExplorer(erc20Contracts.GTO, address),
    //     txExplorerPath: (txid) => eth_TxExplorer(txid),
    //     httpProvider: ethHttpProvider,
    // },
    SNT: {
        donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
        contractAddress: erc20Contracts.SNT,
        explorerPath: (address) => erc20_AddrExplorer(erc20Contracts.SNT, address),
        txExplorerPath: (txid) => eth_TxExplorer(txid),
        httpProvider: ethHttpProvider,
    },
    // HT: { // retiring - not liked
    //     donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
    //     contractAddress: erc20Contracts.HT,
    //     explorerPath: (address) => erc20_AddrExplorer(address),
    //     txExplorerPath: (txid) => eth_TxExplorer(txid),
    //     httpProvider: ethHttpProvider,
    // },
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
        explorerPath: (address) => erc20_AddrExplorer(erc20Contracts.USDT, address),
        txExplorerPath: (txid) => eth_TxExplorer(txid),
        httpProvider: ethHttpProvider,
    },
    EURT: {
        donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
        contractAddress: erc20Contracts.EURT,
        explorerPath: (address) => erc20_AddrExplorer(erc20Contracts.EURT, address),
        txExplorerPath: (txid) => eth_TxExplorer(txid),
        httpProvider: ethHttpProvider,
    },

    LINK: {
        donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
        contractAddress: erc20Contracts.LINK,
        explorerPath: (address) => erc20_AddrExplorer(erc20Contracts.LINK, address),
        txExplorerPath: (txid) => eth_TxExplorer(txid),
        httpProvider: ethHttpProvider,
    },
    ZIL: {
        donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
        contractAddress: erc20Contracts.ZIL,
        explorerPath: (address) => erc20_AddrExplorer(erc20Contracts.ZIL, address),
        txExplorerPath: (txid) => eth_TxExplorer(txid),
        httpProvider: ethHttpProvider,
    },
    HOT: {
        donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
        contractAddress: erc20Contracts.HOT,
        explorerPath: (address) => erc20_AddrExplorer(erc20Contracts.HOT, address),
        txExplorerPath: (txid) => eth_TxExplorer(txid),
        httpProvider: ethHttpProvider,
    },
    REP: {
        donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
        contractAddress: erc20Contracts.REP,
        explorerPath: (address) => erc20_AddrExplorer(erc20Contracts.REP, address),
        txExplorerPath: (txid) => eth_TxExplorer(txid),
        httpProvider: ethHttpProvider,
    },
    MKR: {
        donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
        contractAddress: erc20Contracts.MKR,
        explorerPath: (address) => erc20_AddrExplorer(erc20Contracts.MKR, address),
        txExplorerPath: (txid) => eth_TxExplorer(txid),
        httpProvider: ethHttpProvider,
    },
    NEXO: {
        donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
        contractAddress: erc20Contracts.NEXO,
        explorerPath: (address) => erc20_AddrExplorer(erc20Contracts.NEXO, address),
        txExplorerPath: (txid) => eth_TxExplorer(txid),
        httpProvider: ethHttpProvider,
    },
    BAND: {
        donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
        contractAddress: erc20Contracts.BAND,
        explorerPath: (address) => erc20_AddrExplorer(erc20Contracts.BAND, address),
        txExplorerPath: (txid) => eth_TxExplorer(txid),
        httpProvider: ethHttpProvider,
    },
    DOS: {
        donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
        contractAddress: erc20Contracts.DOS,
        explorerPath: (address) => erc20_AddrExplorer(erc20Contracts.DOS, address),
        txExplorerPath: (txid) => eth_TxExplorer(txid),
        httpProvider: ethHttpProvider,
    },
    RING: {
        donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
        contractAddress: erc20Contracts.RING,
        explorerPath: (address) => erc20_AddrExplorer(erc20Contracts.RING, address),
        txExplorerPath: (txid) => eth_TxExplorer(txid),
        httpProvider: ethHttpProvider,
    },
    SWAP: {
        donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
        contractAddress: erc20Contracts.SWAP,
        explorerPath: (address) => erc20_AddrExplorer(erc20Contracts.SWAP, address),
        txExplorerPath: (txid) => eth_TxExplorer(txid),
        httpProvider: ethHttpProvider,
    },
    UNI: {
        donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
        contractAddress: erc20Contracts.UNI,
        explorerPath: (address) => erc20_AddrExplorer(erc20Contracts.UNI, address),
        txExplorerPath: (txid) => eth_TxExplorer(txid),
        httpProvider: ethHttpProvider,
    },
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
    ,erc20Contracts_append: (symbol, addr) => { erc20Contracts[symbol] = addr }
    ,erc20Contracts
    ,ethHttpProvider

    //
    // utxo/BB v3 - pure blockbook
    // using proxy with CORS to external trezor nodes for https, and direct trezor node for sockets
    //
    ,zecBlockbookApi
    ,ltcBlockbookApi
    ,btcBlockbookApi
    ,dashBlockbookApi
    ,vtcBlockbookApi
    ,dgbBlockbookApi
    ,bchabcBlockbookApi
    ,rvnBlockbookApi
    ,qtumBlockbookApi
    ,zecTestBlockbookApi
    ,ltcTestBlockbookApi

    //
    // fee oracles
    // 
    ,ethFeeOracle_EtherGasStation: `https://www.etherchain.org/api/gasPriceOracle`
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

    // MAIN CONFIG
    ,walletExternal_config_append: (symbol, config) => { walletExternal_config[symbol] = config }
    ,walletExternal_config

    // HELPER REFS
    ,eth_ropstenAddrExplorer: (address) => eth_ropstenAddrExplorer(address)
    ,eth_ropstenTxExplorer: (tx) => eth_ropstenTxExplorer(tx)
    ,erc20_ropstenAddrExplorer: (tokenAddr, holderAddr) => erc20_ropstenAddrExplorer(tokenAddr, holderAddr)
    ,ethTestHttpProvider
    ,ethHttpProvider

    ,blockbookHeaders: {
         "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36"
        ,"Connection": "Upgrade"
        ,"Upgrade": "websocket"
        ,"Sec-WebSocket-Extensions": "permessage-deflate; client_max_window_bits"
        ,"Sec-WebSocket-Version": "13"
        ,"Accept-Encoding": "gzip, deflate, br"
        ,"Accept-Language": "en-US,en;q=0.9,id;q=0.8"
        ,"Cache-Control": "no-cache"
        ,"Pragma": "no-cache"
        , set(axios, headers) {
            const isNode = require('detect-node')
            if (isNode) {
                axios.defaults.headers.common['User-Agent'] = headers["User-Agent"]
                axios.defaults.headers.common['Cache-Control'] = headers["Cache-Control"]
                axios.defaults.headers.common['Pragma'] = headers["Pragma"]
            }
        }
    }
}