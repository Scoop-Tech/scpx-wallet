// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2020 Dominic Morris.

const walletUtxo = require('../actions/wallet-utxo')

const utilsWallet = require('../utils')

const workerBlockbook = require('./worker-blockbook')

module.exports = {

    blockbook_pushTx: (asset, txhex, wallet) => {
        if (!asset.use_BBv3) {
            postMessage({ msg: 'PUSH_TX_BLOCKBOOK_DONE', status: 'RES', data: { symbol: asset.symbol, txhex, error: 'Unsupported BB asset type' } }) 
            return
        }

        const socket = self.get_BlockbookSocketIo(asset)
        if (socket === undefined) {
            postMessage({ msg: 'PUSH_TX_BLOCKBOOK_DONE', status: 'RES', data: { symbol: asset.symbol, txhex, error: 'Failed getting Blockbook socket.io'} })
            return
        }

        const ownAddresses = asset.addresses.map(p => { return p.addr })

        utilsWallet.debug(`appWorker >> blockbook_pushTx - ${asset.symbol}...`)
        socket.send({ method: 'sendTransaction', params: [ txhex ] }, (data) => {
            if (data && data.result) {
                const txid = data.result
                utilsWallet.log(`appWorker >> blockbook_pushTx - OK: txid=`, txid)

                // get tx details (BB websocket interface)
                workerBlockbook.isosocket_send_Blockbook(asset.symbol, 'getTransaction', { txid }, (bbTx) => {
                    if (bbTx) {
                        const insightTx = workerBlockbook.mapTx_BlockbookToInsight(asset, bbTx)  // convert BB to base insight format
                        const mappedTx = walletUtxo.map_insightTxs([insightTx], ownAddresses)[0] // then to our own internal store format

                        // postback tx details
                        postMessage({ msg: 'PUSH_TX_BLOCKBOOK_DONE', status: 'RES', data: { symbol: asset.symbol, txhex, mappedTx } }) 
                    }
                    else {
                        postMessage({ msg: 'PUSH_TX_BLOCKBOOK_DONE', status: 'RES', data: { symbol: asset.symbol, txhex, error: 'Blockbook getTransaction failed' } })
                    }
                })


                // can drop this, when we pass back the websocket tx struct (caller will push local_tx) ?

                // get tx details (BB socket.io interface) and push a local tx 
                // socket.send({ method: 'getDetailedTransaction', params: [txid] }, (bb_txData) => {
                //     utilsWallet.log('appWorker >> blockbook_pushTx - getDetailedTransaction OK: ', bb_txData)

                //     if (bb_txData && bb_txData.result) {
                //         const tx = bb_txData.result
                //         const ownAddresses = asset.addresses.map(p => { return p.addr })
                //         const weAreSender = tx.inputs.some(p => { return ownAddresses.some(p2 => p2 === p.address) })
                //         const spent_txids = []
                        
                //         workerAddrMemPool.mempool_process_BB_UtxoTx(wallet, asset, txid, tx, weAreSender, ownAddresses, spent_txids)

                //         utilsWallet.log('appWorker >> blockbook_pushTx - spent_txids=', spent_txids)

                //         // ** mempool latency ** refreshAssetFull() relies on the tx being in BB mempool (which often it isn't)
                //         // so, we pass in the known spent txid(s) directly
                //         worker.refreshAssetFull(asset, wallet, false, spent_txids) // request full asset refresh to update the lagging insight api utxo's
                //     }
                // })
            }
            else {
                // postback: failed
                postMessage({ msg: 'PUSH_TX_BLOCKBOOK_DONE', status: 'RES', data: { symbol: asset.symbol, txhex, error: data ? data.error.message : "Network error (BB)" } }) 
            }
        })
    }
}
