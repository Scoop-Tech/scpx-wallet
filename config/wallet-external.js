// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.

//
// utxo v2 - insight api rest (absolete, but backup for non-BB supported types - now only using websockets/insight WS interfaces for Insight)
//
const serverBaseApi = 'https://scpx-svr.azurewebsites.net' 
const btcInsightApi = 'https://scp-btc2.southeastasia.cloudapp.azure.com:4001/insight-api/'
//const btcInsightApi = 'https://insight.bitpay.com/api/'   // api/tx lags substantially, also quite possibly /utxo also -- not usable
const ltcInsightApi = 'https://insight.litecore.io/api/'
//const ltcInsightApi = 'https://scp-ltc2.southeastasia.cloudapp.azure.com:4001/insight-lite-api/'
const zecInsightApi = 'https://zcashnetwork.info/api/'
//const zecInsightApi = 'https://scp-zec1.southeastasia.cloudapp.azure.com:4001/insight-api-zcash/' // hard to find usable and maintained insight forks
const bchabcInsightApi = 'https://blockdozer.com/insight-api/'

const btcTestInsightApi = 'https://scp-btct.southeastasia.cloudapp.azure.com:4001/insight-api/'
//const btcTestInsightApi = 'https://test-insight.bitpay.com/api/'

//
// eth
// 
const ethHttpProvider = 'https://scp-eth4.southeastasia.cloudapp.azure.com:9545' // geth
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

    // utxo v2
    serverBaseApi
    ,btcInsightApi
    ,ltcInsightApi
    ,zecInsightApi
    ,btcTestInsightApi
    ,bchabcInsightApi

    // eth
    ,erc20Contracts
    ,ethHttpProvider


    //
    // utxo/BB v3 - pure blockbook (only need an insight server for lights)
    //
    ,btcBlockbookApi: 'https://scp-btcsw.southeastasia.cloudapp.azure.com:10130/api/'
    //,btcBlockbookApi: 'https://btc1.trezor.io/api/'

    ,dashBlockbookApi: 'https://scp-bb-dash01.southeastasia.cloudapp.azure.com:8888/api/'
    //,dashBlockbookApi: 'https://scp-btcsw.southeastasia.cloudapp.azure.com:10133/api/'
    //,dashBlockbookApi: 'https://dash2.trezor.io/api/' 

    ,vtcBlockbookApi: 'https://scp-bb-vtc01.southeastasia.cloudapp.azure.com:8888/api/'

    ,qtumBlockbookApi: 'https://scp-bb-qtum01.southeastasia.cloudapp.azure.com:8888/api/'

    ,dgbBlockbookApi: 'https://scp-bb-dgb01.southeastasia.cloudapp.azure.com:8888/api/'

    ,zecBlockbookApi: 'https://scp-bb-zec01.southeastasia.cloudapp.azure.com:8888/api/' //'https://zec1.trezor.io/api/'
    ,ltcBlockbookApi: 'https://scp-bb-ltc01.southeastasia.cloudapp.azure.com:8888/api/' //'https://ltc1.trezor.io/api/'

    ,bchabcBlockbookApi: 'https://scp-bb-bch02.southeastasia.cloudapp.azure.com:8888/api/'

    //
    // fee oracles
    // 
    ,ethFeeOracle_EtherChainOrg: `https://www.etherchain.org/api/gasPriceOracle`
    ,btcFeeOracle_BitGo: `https://www.bitgo.com/api/v1/tx/fee?numBlocks=2`
    ,ltcFeeOracle_BlockCypher: `https://api.blockcypher.com/v1/ltc/main`
    ,dashFeeOracle_BlockCypher: `https://api.blockcypher.com/v1/dash/main`
    ,vtcFeeOracle_Blockbook: `https://scp-bb-vtc01.southeastasia.cloudapp.azure.com:8888/api/v2/estimatefee/1`
    ,qtumFeeOracle_Blockbook: `https://scp-bb-qtum01.southeastasia.cloudapp.azure.com:8888/api/v2/estimatefee/1`
    ,dgbFeeOracle_Blockbook: `https://scp-bb-dgb01.southeastasia.cloudapp.azure.com:8888/api/v2/estimatefee/1`
    ,bchabcFeeOracle_Blockbook: `https://scp-bb-bch02.southeastasia.cloudapp.azure.com:8888/api/v2/estimatefee/1`

    ,walletExternal_config: {
    
        BTC: {
            donate: '192baToCaVeVTrsYdKTib8QXkoL4Jppg9x',
            explorerPath: (address) => { return 'https://www.blockchain.com/en/btc/address/' + address },
            txExplorerPath: (txid) => { return 'https://www.blockchain.com/btc/tx/' + txid },
            api: {
                utxo: (address) => { return `${btcBlockbookApi}v1/utxo/${address}` },
            }
            // api: {
            //     sync: () => { return btcInsightApi + 'sync' },
            //     block: (blockHash) => { return btcInsightApi + 'block/' + blockHash },
            //     v2_tx: (txid) => { return btcInsightApi + 'tx/' + txid },
            //     v2_addrData: (address, from, to) => { return `${btcInsightApi}addr/${address}?from=${from}&to=${to}` },
            //     v2_addrBal: (address) => { return `${btcInsightApi}addr/${address}?noTxList=1` },
            //     balance: (address) => { return btcInsightApi + 'addr/' + address + '/balance' },
            //     unconfirmedBalance: (address) => { return btcInsightApi + 'addr/' + address + '/unconfirmedBalance' },
            //     tx: (txid) => { return btcInsightApi + 'tx/' + txid },
            //     txs: (address) => { return btcInsightApi + 'txs/?address=' + address },
            //     utxo: (address) => { return btcInsightApi + 'addrs/' + address + '/utxo' }, 
            //     push_tx: btcInsightApi + 'tx/send',
            // }
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

        BTC_TEST: { // BTC TestNet3 -- http://bitcoinfaucet.uo1.net/send.php
            donate: 'mwZeWAYfPRB2pair6T1FvvutMRg2jf92Ya',
            explorerPath: (address) => { return 'https://live.blockcypher.com/btc-testnet/address/' + address },
            txExplorerPath: (txid) => { return 'https://live.blockcypher.com/btc-testnet/tx/' + txid },
            api: {
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
                estimate_fee: btcTestInsightApi + 'utils/estimatefee'
            }
        },
        LTC: {
            donate: 'LcTqsN3agVPA6EX2hhq2gtJBwjdpq2c6GC',
            explorerPath: (address) => { return 'https://live.blockcypher.com/ltc/address/' + address },
            txExplorerPath: (txid) => { return 'https://live.blockcypher.com/ltc/tx/' + txid },

            api: {
                utxo: (address) => { return `${ltcBlockbookApi}v1/utxo/${address}` },
            }
            // api: {
            //     sync: () => { return ltcInsightApi + 'sync' },
            //     block: (blockHash) => { return ltcInsightApi + 'block/' + blockHash },
            //     v2_tx: (txid) => { return ltcInsightApi + 'tx/' + txid },
            //     v2_addrData: (address, from, to) => { return `${ltcInsightApi}addr/${address}?from=${from}&to=${to}` },
            //     v2_addrBal: (address) => { return `${ltcInsightApi}addr/${address}?noTxList=1` },
            //     balance: (address) => { return ltcInsightApi + 'addr/' + address + '/balance' },
            //     unconfirmedBalance: (address) => { return ltcInsightApi + 'addr/' + address + '/unconfirmedBalance' },
            //     tx: (txid) => { return ltcInsightApi + 'tx/' + txid },
            //     txs: (address) => { return ltcInsightApi + 'txs/?address=' + address },
            //     utxo: (address) => { return ltcInsightApi + 'addrs/' + address + '/utxo' },
            //     push_tx: ltcInsightApi + 'tx/send',
            // }
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
            // api: {
            //     sync: () => { return zecInsightApi + 'sync' },
            //     block: (blockHash) => { return zecInsightApi + 'block/' + blockHash },
            //     v2_tx: (txid) => { return zecInsightApi + 'tx/' + txid },
            //     v2_addrData: (address, from, to) => { return `${zecInsightApi}addr/${address}?from=${from}&to=${to}` },
            //     v2_addrBal: (address) => { return `${zecInsightApi}addr/${address}?noTxList=1` },
            //     balance: (address) => { return zecInsightApi + 'addr/' + address + '/balance' },
            //     unconfirmedBalance: (address) => { return zecInsightApi + 'addr/' + address + '/unconfirmedBalance' },
            //     tx: (txid) => { return zecInsightApi + 'tx/' + txid },
            //     txs: (address) => { return zecInsightApi + 'txs/?address=' + address },
            //     utxo: (address) => { return zecInsightApi + 'addrs/' + address + '/utxo' },
            //     push_tx: zecInsightApi + 'tx/send',
            // }
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
            // api: {
            //     // txlist: (address) =>  { return `https://api.etherscan.io/api?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=asc&apikey=${es_apiKeys[0]}` },
            //     // balance: (address) => { return `https://api.etherscan.io/api?module=account&action=balance&address=${address}&tag=latest&apikey=${es_apiKeys[0]}` }
            //     txlist: (address) =>  { return `https://blockscout.com/eth/mainnet/api?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=asc` },
            //     balance: (address) => { return `https://blockscout.com/eth/mainnet/api?module=account&action=balance&address=${address}` }
            // }
        },
        ETH_TEST: { // ropsten
            explorerPath: (address) => { return 'https://ropsten.etherscan.io/address/' + address },
            txExplorerPath: (txid) =>  { return 'https://ropsten.etherscan.io/tx/' + txid },
            httpProvider: 'https://ropsten.infura.io/v3/93db2c7fd899496d8400e86100058297',
            // api: {
            //     txlist: (address) =>  { return `https://api-ropsten.etherscan.io/api?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=asc&apikey=${es_apiKeys[0]}` },
            //     balance: (address) => { return `https://api-ropsten.etherscan.io/api?module=account&action=balance&address=${address}&tag=latest&apikey=${es_apiKeys[1]}` }
            //     //txlist: (address) =>  { return `https://blockscout.com/eth/ropsten/api?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=asc` },
            //     //balance: (address) => { return `https://blockscout.com/eth/ropsten/api?module=account&action=balance&address=${address}` }
            // }
        },

        TUSD: { 
            donate: '0xd183d12ced4accb265b0eda55b3526c7cb102485',
            contractAddress: erc20Contracts.TUSD,
            explorerPath: (address) => erc20_AddrExplorer(address),
            txExplorerPath: (txid) => eth_TxExplorer(txid),
            httpProvider: ethHttpProvider,
            // api: {
            //     // txlist: (address) =>  { return `https://api.etherscan.io/api?module=account&action=tokentx&contractaddress=0x0000000000085d4780b73119b644ae5ecd22b376&address=${address}&page=1&offset=100&sort=asc&apikey=${es_apiKeys[2]}` },
            //     // balance: (address) => { return `https://api.etherscan.io/api?module=account&action=tokenbalance&contractaddress=0x0000000000085d4780b73119b644ae5ecd22b376&address=${address}&tag=latest&apikey=${es_apiKeys[2]}` }
            //     txlist: (address) =>  { return `https://blockscout.com/eth/mainnet/api?module=account&action=tokentx&address=${address}&contractaddress=${erc20Contracts.TUSD}` },
            //     balance: (address) => { return `https://blockscout.com/eth/mainnet/api?module=account&action=tokenbalance&address=${address}&contractaddress=${erc20Contracts.TUSD}` }
            // }
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
            // api: {
            //     txlist: (address) =>  { return `https://blockscout.com/eth/mainnet/api?module=account&action=tokentx&address=${address}&contractaddress=${erc20Contracts.HT}` },
            //     balance: (address) => { return `https://blockscout.com/eth/mainnet/api?module=account&action=tokenbalance&address=${address}&contractaddress=${erc20Contracts.HT}` }
            // }
        },
        // BTM: { // old erc20 - now on mainnet
        //     donate: '0x8c7015Be965CFa11ec7BfC25FDDDA4FE4A1e34AB',
        //     contractAddress: erc20Contracts.BTM,
        //     explorerPath: (address) => erc20_AddrExplorer(address),
        //     txExplorerPath: (txid) => eth_TxExplorer(txid),
        //     httpProvider: ethHttpProvider,
        //     api: {
        //         txlist: (address) =>  { return `https://blockscout.com/eth/mainnet/api?module=account&action=tokentx&address=${address}&contractaddress=${erc20Contracts.BTM}` },
        //         balance: (address) => { return `https://blockscout.com/eth/mainnet/api?module=account&action=tokenbalance&address=${address}&contractaddress=${erc20Contracts.BTM}` }
        //     }
        // },    
        // VEN: { // old erc20 - now on mainnet
        //     donate: '0x8c7015Be965CFa11ec7BfC25FDDDA4FE4A1e34AB',
        //     contractAddress: erc20Contracts.VEN,
        //     explorerPath: (address) => erc20_AddrExplorer(address),
        //     txExplorerPath: (txid) => eth_TxExplorer(txid),
        //     httpProvider: ethHttpProvider,
        //     api: {
        //         txlist: (address) =>  { return `https://blockscout.com/eth/mainnet/api?module=account&action=tokentx&address=${address}&contractaddress=${erc20Contracts.VEN}` },
        //         balance: (address) => { return `https://blockscout.com/eth/mainnet/api?module=account&action=tokenbalance&address=${address}&contractaddress=${erc20Contracts.VEN}` }
        //     }
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
    }
}