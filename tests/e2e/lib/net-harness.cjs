// TEST HARNESS ONLY - preloaded into the wallet (main thread + workers) via NODE_OPTIONS=--require.
// Not wallet code. Controlled by env:
//   E2E_DNS_DELAY_HOST / E2E_DNS_DELAY_MS : delay DNS for one host at startup (keeps its socket CONNECTING)
//   E2E_DNS_MAP="host=127.0.0.1"          : resolve host to a local TCP pass-through proxy (TLS stays end-to-end)
const dns = require('dns')
const orig = dns.lookup
const t0 = Date.now()
const delayHost = process.env.E2E_DNS_DELAY_HOST, delayMs = Number(process.env.E2E_DNS_DELAY_MS || 0)
const map = {}
for (const kv of (process.env.E2E_DNS_MAP || '').split(',').filter(Boolean)) { const [h, ip] = kv.split('='); map[h] = ip }

dns.lookup = function (host, ...args) {
    const cb = args[args.length - 1]
    const opts = typeof args[0] === 'object' ? args[0] : {}
    const go = () => {
        if (map[host]) {
            if (opts.all) return process.nextTick(cb, null, [{ address: map[host], family: 4 }])
            return process.nextTick(cb, null, map[host], 4)
        }
        return orig.call(dns, host, ...args)
    }
    const left = delayMs - (Date.now() - t0)
    if (host === delayHost && left > 0) { setTimeout(go, left); return {} }
    return go()
}
