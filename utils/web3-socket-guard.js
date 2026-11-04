// Distributed under AGPLv3 license: see /LICENSE for terms. Copyright 2019-2025 Dominic Morris.

// web3 2.0.0-alpha.1's socket provider (AbstractSocketProvider.onMessage) treats every message without an `id` as a
// subscription notification and reads `response.params.subscription`. Some public RPCs send JSON-RPC errors with no id,
// e.g. publicnode on an idle socket:  {"jsonrpc":"2.0","error":{"code":-32701,"message":"connection timeout exceeded"}}
// That throws inside the socket's message handler and surfaces as an uncaughtException ("Cannot read property
// 'subscription' of undefined"); prod logged ~1,600 a day from 2026-11-03.
//
// install() patches the shared base class once, before any WebsocketProvider is created (providers bind onMessage
// at construction). Messages with neither an id nor params are logged (rate-limited) and dropped; everything else is
// passed through unchanged. The base class isn't exported, so it is reached offline through an IpcProvider built on a
// dummy connection (no network, no socket).

const { EventEmitter } = require('events')

const LOG_EVERY = 100 // after the first of each kind, log every Nth
var installed = false
const seen = {}

function isOrphan(o) {
    return o !== null && typeof o === 'object' && !Array.isArray(o)
        && typeof o.id === 'undefined'
        && !(o.params && typeof o.params === 'object')
}

function describe(o) {
    if (o && o.error) return `error ${o.error.code}: ${o.error.message}`
    return JSON.stringify(o).slice(0, 200)
}

module.exports = {
    isOrphan, // exported for tests

    install: (log = console.warn) => {
        if (installed) return true
        try {
            const { ProvidersModuleFactory } = require('web3-providers')
            const probe = new ProvidersModuleFactory().createIpcProvider('web3-socket-guard', { connect: () => new EventEmitter() })
            const base = Object.getPrototypeOf(Object.getPrototypeOf(probe))
            try { probe.connection.removeAllListeners() } catch (err) {}

            if (!base || typeof base.onMessage !== 'function' || base.constructor.name !== 'AbstractSocketProvider') {
                log(`web3-socket-guard: AbstractSocketProvider not found (web3-providers changed?) - not installed`)
                return false
            }

            const original = base.onMessage
            base.onMessage = function (response) {
                var o = response
                if (typeof o === 'string') {
                    try { o = JSON.parse(o) }
                    catch (err) {
                        log(`web3-socket-guard: dropped non-JSON socket message: ${String(response).slice(0, 120)}`)
                        return
                    }
                }
                if (isOrphan(o)) {
                    const d = describe(o)
                    const key = (d in seen || Object.keys(seen).length < 50) ? d : 'other' // bounded
                    const n = seen[key] = (seen[key] || 0) + 1
                    if (n === 1 || n % LOG_EVERY === 0) {
                        log(`web3-socket-guard: dropped socket message with no id/params (x${n}): ${key}`)
                    }
                    return
                }
                return original.call(this, o)
            }
            installed = true
            return true
        }
        catch (err) {
            log(`web3-socket-guard: install failed - ${err.message}`)
            return false
        }
    },
}
