// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019 Dominic Morris.

//
// Blockbook websocket API adapter - replaces the legacy Blockbook Socket.IO interface
// (removed upstream in Blockbook v0.6.0, PR #1487): getAddressTxids / sendTransaction / subscribe 'bitcoind/addresstxid'.
//
// Transport-agnostic: every function takes a `send(method, params, callback)` (and `sub(...)` for subscriptions),
// normally bound to worker-blockbook's isosocket_send_Blockbook / isosocket_sub_Blockbook for one asset symbol.
// That keeps this module unit-testable with a mock or a plain websocket client.
//
// Response contract (Blockbook websocket API): { result } / { error: { message } } / or the method's data object.
// Plain ES2015 only (used by the Node CLI and by scpx-app's webpack/babel6 build).
//

const MAX_PAGE_SIZE = 1000 // Blockbook account endpoints: default and maximum pageSize

function errMessage(data) {
    if (!data) return 'No response from Blockbook'
    if (data.error) return typeof data.error === 'string' ? data.error : (data.error.message || JSON.stringify(data.error))
    return undefined
}

// all txids for one address: unconfirmed first, then confirmed newest-first.
// Unlike legacy getAddressTxids(queryMempoolOnly:false), which was confirmed-only, this includes mempool txs;
// worker-account handles that (unconfirmed txs are re-queried until they confirm, never cached as final).
function getAddressTxids(send, address, maxTxs) {
    const cap = maxTxs && maxTxs > 0 ? maxTxs : MAX_PAGE_SIZE
    const pageSize = Math.min(cap, MAX_PAGE_SIZE)
    var txids = []
    return new Promise(function (resolve, reject) {
        function fetchPage(page) {
            send('getAccountInfo', { descriptor: address, details: 'txids', page: page, pageSize: pageSize }, function (data) {
                const err = errMessage(data)
                if (err) return reject(new Error(err))
                txids = txids.concat(data.txids || [])
                const totalPages = data.totalPages || 1
                if (page < totalPages && txids.length < cap) return fetchPage(page + 1)
                resolve(txids.slice(0, cap))
            })
        }
        fetchPage(1)
    })
}

// pending (mempool) txids across a set of addresses, de-duplicated
function getMempoolTxids(send, addresses) {
    return Promise.all(addresses.map(function (address) {
        return new Promise(function (resolve, reject) {
            send('getAccountInfo', { descriptor: address, details: 'txids', page: 1, pageSize: MAX_PAGE_SIZE }, function (data) {
                const err = errMessage(data)
                if (err) return reject(new Error(err))
                const n = data.unconfirmedTxs || 0                   // unconfirmed txs take the first slots of the history
                resolve((data.txids || []).slice(0, n))
            })
        })
    }))
    .then(function (lists) {
        const seen = {}
        return [].concat.apply([], lists).filter(function (txid) { if (seen[txid]) return false; seen[txid] = true; return true })
    })
}

// broadcast a signed tx hex; resolves txid
function sendTransaction(send, hex) {
    return new Promise(function (resolve, reject) {
        send('sendTransaction', { hex: hex }, function (data) {
            const err = errMessage(data)
            if (err) return reject(new Error(err))
            if (!data.result) return reject(new Error('Blockbook sendTransaction: no txid returned'))
            resolve(data.result)
        })
    })
}

// subscribe to activity on a set of addresses; onTxid(txid, address) per notification.
// Returns the subscription id from `sub`. Note: Blockbook keeps ONE address subscription per connection
// (a new subscribeAddresses replaces the previous set), and it does not survive a reconnect - callers must re-subscribe.
function subscribeAddresses(sub, addresses, onTxid, onAck) {
    return sub('subscribeAddresses', { addresses: addresses }, function (data) {
        if (!data || data.subscribed !== undefined || errMessage(data)) {          // ack / error frames
            if (onAck) onAck(data)
            return
        }
        const txid = data.tx && data.tx.txid
        if (txid) onTxid(txid, data.address)
    })
}

// BIP113 median-time-past: median time of the last 11 blocks (tip inclusive). Time-based CLTV / nLockTime is final
// for the next block only when lockTime < MTP. Resolves { mtp, height }.
function getMedianTimePast(send) {
    function call(method, params) {
        return new Promise(function (resolve, reject) {
            send(method, params, function (data) {
                const err = errMessage(data)
                if (err) return reject(new Error(err))
                resolve(data)
            })
        })
    }
    return call('getInfo', {}).then(function (info) {
        const tip = info.bestHeight
        if (!(tip > 10)) throw new Error('Blockbook getInfo: no bestHeight')
        const heights = []
        for (var h = tip; h > tip - 11; h--) heights.push(h)
        return Promise.all(heights.map(function (h) { return call('getBlock', { id: String(h), page: 1, pageSize: 1 }) }))
        .then(function (blocks) {
            const times = blocks.map(function (b) { return Number(b.time) })
            if (times.some(function (t) { return !(t > 0) })) throw new Error('Blockbook getBlock: missing block time')
            times.sort(function (a, b) { return a - b })
            return { mtp: times[5], height: tip }
        })
    })
}

module.exports = { getAddressTxids, getMempoolTxids, sendTransaction, subscribeAddresses, getMedianTimePast, MAX_PAGE_SIZE }
