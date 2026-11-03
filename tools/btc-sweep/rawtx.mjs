// Independent Bitcoin raw-transaction decoder + address codecs (Node >= 18, no dependencies).
// Deliberately shares NO code with the wallet (no bitcoinjs-lib): it is the second opinion on a signed tx before broadcast.
//   parseTx(hex)              -> { txid, wtxid, version, locktime, ins: [{ txid, vout, sequence, scriptSig, witness }],
//                                  outs: [{ n, sats (BigInt), script }], segwit, size, weight, vsize }
//   scriptToAddress(script, net)  net: 'main' | 'test'   (P2PKH, P2SH, P2WPKH, P2WSH, P2TR; else null)
//   addressToScript(addr, net)    throws on bad checksum / wrong network / unknown type
import crypto from 'node:crypto'

const sha256 = b => crypto.createHash('sha256').update(b).digest()
const dsha = b => sha256(sha256(b))

// ---- base58check
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function b58encode(buf) {
    let n = BigInt('0x' + (buf.toString('hex') || '0')), s = ''
    while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n }
    for (const b of buf) { if (b === 0) s = '1' + s; else break }
    return s
}
function b58decode(str) {
    let n = 0n
    for (const c of str) { const i = B58.indexOf(c); if (i < 0) throw new Error(`bad base58 char "${c}"`); n = n * 58n + BigInt(i) }
    let hex = n.toString(16); if (hex.length % 2) hex = '0' + hex
    let lead = 0; for (const c of str) { if (c === '1') lead++; else break }
    return Buffer.concat([Buffer.alloc(lead), Buffer.from(n === 0n ? '' : hex, 'hex')])
}
function b58check(version, payload) { const b = Buffer.concat([Buffer.from([version]), payload]); return b58encode(Buffer.concat([b, dsha(b).subarray(0, 4)])) }
function b58checkDecode(str) {
    const b = b58decode(str)
    if (b.length < 5) throw new Error('base58 too short')
    const body = b.subarray(0, -4), chk = b.subarray(-4)
    if (!dsha(body).subarray(0, 4).equals(chk)) throw new Error('base58 checksum mismatch')
    return { version: body[0], payload: body.subarray(1) }
}

// ---- bech32 / bech32m (BIP173 / BIP350)
const CH = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
function polymod(values) { let chk = 1; for (const v of values) { const b = chk >>> 25; chk = ((chk & 0x1ffffff) << 5) ^ v; for (let i = 0; i < 5; i++) if ((b >>> i) & 1) chk ^= GEN[i] } return chk >>> 0 }
const hrpExpand = hrp => [...[...hrp].map(c => c.charCodeAt(0) >> 5), 0, ...[...hrp].map(c => c.charCodeAt(0) & 31)]
const CONST = { bech32: 1, bech32m: 0x2bc830a3 }
function convertBits(data, from, to, pad) {
    let acc = 0, bits = 0; const out = [], maxv = (1 << to) - 1
    for (const v of data) { if (v < 0 || v >> from) throw new Error('bad value'); acc = (acc << from) | v; bits += from; while (bits >= to) { bits -= to; out.push((acc >> bits) & maxv) } }
    if (pad) { if (bits) out.push((acc << (to - bits)) & maxv) } else if (bits >= from || ((acc << (to - bits)) & maxv)) throw new Error('bad padding')
    return out
}
function segwitEncode(hrp, version, program) {
    const data = [version, ...convertBits([...program], 8, 5, true)]
    const c = polymod([...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ (version === 0 ? CONST.bech32 : CONST.bech32m)
    const chk = []; for (let i = 0; i < 6; i++) chk.push((c >>> (5 * (5 - i))) & 31)
    return hrp + '1' + [...data, ...chk].map(d => CH[d]).join('')
}
function segwitDecode(hrpWant, addr) {
    if (addr !== addr.toLowerCase() && addr !== addr.toUpperCase()) throw new Error('mixed-case bech32')
    const a = addr.toLowerCase(), pos = a.lastIndexOf('1')
    if (pos < 1 || pos + 7 > a.length || a.length > 90) throw new Error('bad bech32 length')
    const hrp = a.slice(0, pos); if (hrp !== hrpWant) throw new Error(`wrong network prefix "${hrp}" (expected "${hrpWant}")`)
    const data = [...a.slice(pos + 1)].map(c => { const i = CH.indexOf(c); if (i < 0) throw new Error('bad bech32 char'); return i })
    const pm = polymod([...hrpExpand(hrp), ...data])
    const version = data[0]
    const enc = pm === CONST.bech32 ? 'bech32' : pm === CONST.bech32m ? 'bech32m' : null
    if (!enc) throw new Error('bech32 checksum mismatch')
    if ((version === 0 && enc !== 'bech32') || (version > 0 && enc !== 'bech32m')) throw new Error('bech32 variant does not match witness version')
    const program = Buffer.from(convertBits(data.slice(1, -6), 5, 8, false))
    if (program.length < 2 || program.length > 40 || version > 16) throw new Error('bad witness program')
    if (version === 0 && program.length !== 20 && program.length !== 32) throw new Error('bad v0 program length')
    return { version, program }
}

const NET = { main: { p2pkh: 0x00, p2sh: 0x05, hrp: 'bc' }, test: { p2pkh: 0x6f, p2sh: 0xc4, hrp: 'tb' },
              ltc: { p2pkh: 0x30, p2sh: 0x32, hrp: 'ltc' }, rvn: { p2pkh: 0x3c, p2sh: 0x7a, hrp: null } } // rvn: no segwit

export function scriptToAddress(script, net) {
    const n = NET[net]; const s = Buffer.isBuffer(script) ? script : Buffer.from(script, 'hex')
    if (s.length === 25 && s[0] === 0x76 && s[1] === 0xa9 && s[2] === 0x14 && s[23] === 0x88 && s[24] === 0xac) return b58check(n.p2pkh, s.subarray(3, 23))
    if (s.length === 23 && s[0] === 0xa9 && s[1] === 0x14 && s[22] === 0x87) return b58check(n.p2sh, s.subarray(2, 22))
    if (!n.hrp) return null
    if (s.length === 22 && s[0] === 0x00 && s[1] === 0x14) return segwitEncode(n.hrp, 0, s.subarray(2))
    if (s.length === 34 && s[0] === 0x00 && s[1] === 0x20) return segwitEncode(n.hrp, 0, s.subarray(2))
    if (s.length === 34 && s[0] === 0x51 && s[1] === 0x20) return segwitEncode(n.hrp, 1, s.subarray(2))
    return null
}

export function addressToScript(addr, net) {
    const n = NET[net]
    if (/^(bc|tb|bcrt|ltc|tltc)1/i.test(addr)) {
        if (!n.hrp) throw new Error(`${net} has no segwit addresses`)
        const { version, program } = segwitDecode(n.hrp, addr)
        return { type: version === 0 ? (program.length === 20 ? 'p2wpkh' : 'p2wsh') : version === 1 && program.length === 32 ? 'p2tr' : `witness_v${version}`,
                 script: Buffer.concat([Buffer.from([version === 0 ? 0 : 0x50 + version, program.length]), program]) }
    }
    const { version, payload } = b58checkDecode(addr)
    if (payload.length !== 20) throw new Error('bad base58 payload length')
    if (version === n.p2pkh) return { type: 'p2pkh', script: Buffer.concat([Buffer.from([0x76, 0xa9, 0x14]), payload, Buffer.from([0x88, 0xac])]) }
    if (version === n.p2sh) return { type: 'p2sh', script: Buffer.concat([Buffer.from([0xa9, 0x14]), payload, Buffer.from([0x87])]) }
    throw new Error(`address version 0x${version.toString(16)} is not ${net}net P2PKH/P2SH`)
}

export function parseTx(hex) {
    if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2) throw new Error('not hex')
    const b = Buffer.from(hex, 'hex'); let o = 0
    const u8 = () => b[o++]
    const u32 = () => { const v = b.readUInt32LE(o); o += 4; return v }
    const u64 = () => { const v = b.readBigUInt64LE(o); o += 8; return v }
    const vi = () => { const f = u8(); if (f < 0xfd) return f; if (f === 0xfd) { const v = b.readUInt16LE(o); o += 2; return v } if (f === 0xfe) return u32(); const v = Number(u64()); return v }
    const bytes = n => { if (o + n > b.length) throw new Error('truncated'); const s = b.subarray(o, o + n); o += n; return s }
    const version = b.readInt32LE(0); o = 4
    let segwit = false
    if (b[o] === 0x00 && b[o + 1] === 0x01) { segwit = true; o += 2 }
    const nin = vi(); const ins = []
    for (let i = 0; i < nin; i++) ins.push({ txid: Buffer.from(bytes(32)).reverse().toString('hex'), vout: u32(), scriptSig: bytes(vi()).toString('hex'), sequence: u32(), witness: [] })
    const nout = vi(); const outs = []
    for (let i = 0; i < nout; i++) { const sats = u64(); outs.push({ n: i, sats, script: bytes(vi()).toString('hex') }) }
    const witStart = o
    if (segwit) for (const inp of ins) { const k = vi(); for (let j = 0; j < k; j++) inp.witness.push(bytes(vi()).toString('hex')) }
    const witEnd = o
    const locktime = u32()
    if (o !== b.length) throw new Error(`trailing bytes (${b.length - o})`)
    // txid = hash of the non-witness serialization
    const stripped = segwit ? Buffer.concat([b.subarray(0, 4), b.subarray(6, witStart), b.subarray(witEnd)]) : b
    const size = b.length, base = stripped.length
    const weight = base * 3 + size
    return { txid: Buffer.from(dsha(stripped)).reverse().toString('hex'), wtxid: Buffer.from(dsha(b)).reverse().toString('hex'),
             version, locktime, segwit, ins, outs, size, weight, vsize: Math.ceil(weight / 4) }
}
