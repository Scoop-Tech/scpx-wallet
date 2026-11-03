// TCP pass-through proxy (TLS is NOT terminated: certs/hostnames stay end-to-end).
// Used to simulate a mid-session network drop: dropAll() kills every live connection; new ones still work.
import net from 'node:net'

export function startProxy(listenPort, targetHost, targetPort) {
    const live = new Set()
    let accepted = 0
    const server = net.createServer(client => {
        accepted++
        const upstream = net.connect(targetPort, targetHost)
        const pair = { client, upstream }
        live.add(pair)
        const close = () => { client.destroy(); upstream.destroy(); live.delete(pair) }
        client.on('error', close); upstream.on('error', close); client.on('close', close); upstream.on('close', close)
        client.pipe(upstream); upstream.pipe(client)
    })
    return new Promise(resolve => server.listen(listenPort, '127.0.0.1', () => resolve({
        dropAll() { const n = live.size; for (const p of [...live]) { p.client.destroy(); p.upstream.destroy() } live.clear(); return n },
        stats() { return { live: live.size, accepted } },
        close() { return new Promise(r => { for (const p of live) { p.client.destroy(); p.upstream.destroy() } server.close(r) }) },
    })))
}
