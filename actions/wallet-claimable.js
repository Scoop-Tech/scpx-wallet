// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2025 Dominic Morris.

const bitcoinJsLib = require('bitcoinjs-lib')
const bitgoUtxoLib = require('bitgo-utxo-lib')
const bchAddr = require('bchaddrjs')
const BigNumber = require('bignumber.js')
const _ = require('lodash')

const actionsWallet = require('.')
const walletExternal = require('./wallet-external')

const configWallet = require('../config/wallet')
const configExternal = require('../config/wallet-external')

const configWS = require('../config/websockets')
const workerBlockbookWs = require('../app-worker/worker-blockbook-ws')

const utilsWallet = require('../utils')



module.exports = {

    //
    // lists all claimable p_op tx's: benefactor any time (ELSE branch); beneficiary once the CLTV lock is final.
    // Finality is consensus time, not wall-clock: a time-locked spend can be mined once lockTime < median-time-past (BIP113).
    // MTP can run ahead of real time (testnet4: often by 1-2h) or ~1h behind it (mainnet), so callers should pass
    // medianTimePast (see getMedianTimePast); without it we fall back to the legacy wall-clock estimate.
    //
    claimable_List: (p) => {
        const { asset, medianTimePast } = p
        if (!asset) throw 'Invalid or missing asset'
        if (!asset.OP_CLTV) throw `Invalid p_op for ${asset.symbol}`

        const all_txs = walletExternal.getAll_txs(asset)
        const p_addrs = asset.addresses
            .filter(a => a.path.startsWith('~p/'))
            .filter(a => a.utxos !== undefined && a.utxos.length > 0)
            .filter(a => { 
                const protect_op_tx = all_txs.find(p2 => p2.txid == a.nonStd_protectOp_txid)
                return (protect_op_tx.p_op_weAreBenefactor
                    || (protect_op_tx.p_op_weAreBeneficiary && module.exports.p_op_isFinal(protect_op_tx, medianTimePast)))
            })
            .map(a => { 
                const protect_op_tx = all_txs.find(p => p.txid == a.nonStd_protectOp_txid)
                return Object.assign(a, { protect_op_tx })
            })
        return p_addrs
    },

    //
    // CLTV finality of a protect_op output: spendable by the beneficiary in the next block once lockTime < MTP (BIP113).
    // Without MTP, falls back to wall clock + 1h (mainnet MTP typically lags real time by ~1h).
    //
    p_op_isFinal: (p_op_tx, medianTimePast) => {
        if (!p_op_tx || p_op_tx.p_op_lockTime === undefined) return false // pending: lock not known yet
        const lockTime = Number(p_op_tx.p_op_lockTime)
        if (medianTimePast !== undefined && medianTimePast !== null) return lockTime < Number(medianTimePast)
        return Date.now() / 1000 > lockTime + 3600
    },

    //
    // estimated wall-clock time the output becomes claimable by the beneficiary: MTP advances at ~real time,
    // so it's now + (lockTime - MTP). Same wall-clock + 1h fallback as p_op_isFinal. Returns a Date (or undefined if pending).
    //
    p_op_unlockEstimate: (p_op_tx, medianTimePast) => {
        if (!p_op_tx || p_op_tx.p_op_lockTime === undefined) return undefined
        const lockTime = Number(p_op_tx.p_op_lockTime)
        if (medianTimePast !== undefined && medianTimePast !== null) return new Date(Date.now() + (lockTime - Number(medianTimePast)) * 1000)
        return new Date((lockTime + 3600) * 1000)
    },

    //
    // BIP113 median-time-past for a UTXO asset, via a short-lived Blockbook websocket (getInfo + 11x getBlock).
    // Resolves { mtp, height }; rejects on timeout / Blockbook error.
    //
    getMedianTimePast: (symbol, timeoutMs) => {
        const cfg = configWS.blockbook_ws_config[symbol]
        if (!cfg) return Promise.reject(new Error(`No Blockbook websocket configured for ${symbol}`))
        const isoWs = require('isomorphic-ws')
        return new Promise((resolve, reject) => {
            const ws = new isoWs(cfg.url + '/websocket', configWallet.WALLET_ENV === 'BROWSER' ? undefined
                : { headers: { 'User-Agent': configExternal.blockbookHeaders['User-Agent'] } })
            const pending = {}
            var nextId = 0, done = false
            const finish = (err, res) => { if (done) return; done = true; clearTimeout(timer); try { ws.close() } catch (e) {} ; err ? reject(err) : resolve(res) }
            const timer = setTimeout(() => finish(new Error(`getMedianTimePast ${symbol}: timeout`)), timeoutMs || 15000)
            const send = (method, params, cb) => { const id = String(++nextId); pending[id] = cb; ws.send(JSON.stringify({ id, method, params })) }
            ws.onmessage = (msg) => {
                var m; try { m = JSON.parse(msg.data) } catch (e) { return }
                const cb = pending[m.id]; delete pending[m.id]
                if (cb) cb(m.data)
            }
            ws.onerror = (e) => finish(new Error(`getMedianTimePast ${symbol}: websocket error ${e && e.message ? e.message : ''}`))
            ws.onopen = () => workerBlockbookWs.getMedianTimePast(send).then(res => finish(null, res)).catch(finish)
        })
    },

    //
    // spends ("reclaims" if we are benefactor, or "claim" if we are beneficiary) a specific p_op txid output
    //  (or, spends all claimable p_op tx's if no txid supplied)
    //
    // (all claims output to the first standard address, as a standard UTXO)
    //
    claimable_Claim: async (asset) => {
        //...
    },

}