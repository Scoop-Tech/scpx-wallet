// Pinned PUBLIC mainnet addresses for the lean read-only tests (no keys; nobody here controls them).
// Picked 2026-11-02 for being funded and quiet. Expected amounts are NEVER hard-coded: tests compare against an
// independent oracle read at the same moment, and assert > 0. Keep coinbase-receiving addresses out of anything
// that goes through wallet code (mapTx_BlockbookToInsight cannot map coinbase inputs yet).
'use strict'
module.exports = {
    BTC: [ // one per Trezor BTC Blockbook the wallet uses, each the script type that backend serves in the wallet
        { sym: 'BTC_SEG2', metaKey: 'btc(s2)', kind: 'p2wpkh', addr: 'bc1q0pn2cup8ysr6wtn32sguc9jua4k7geacrhttwj' }, // 3 txs/3 utxos, unspent since block 750000
        { sym: 'BTC_SEG', metaKey: 'btc(s)', kind: 'p2sh', addr: '3Eitz6QP3jJ1EC5ftBZ5RW2ivJV82mdcBc' },            // 1 tx/1 utxo, dormant since block 750000
        { sym: 'BTC', metaKey: 'bitcoin', kind: 'p2pkh', addr: '1EvanBTCS99Vfgknz9vt8XauYsMgiVPfb6' },             // 2 txs/2 utxos (+ an OP_RETURN output)
    ],
    BTC_SPARE: { p2sh: '35N29C81zevzkRSUjRHJPJ3GDraQJPvZEF', p2pkh: '1JoMXkJ8C7RjTYA8S6STYvjY9wifFc3pAK' },
    BTC_STRESS_P2SH: '38UmuUqPCrFmQo4khkomQwZ4VbY2nZMJ67', // 368 txs / 32 utxos: drops a Trezor socket without a request limiter

    // EOA holding ETH + USDT + USDC; 163 txs (2 contract creations in the newest 100), no activity since 2026-08-08.
    // Much quieter than the Binance cold wallet (0xBE0e..., 13k txs, constant dust). Spare: 0x4968f9D6251b392F5D31Cf8d06Feb8dc46078f1F.
    ETH_HOLDER: '0xFfB3B82D6BAe4E1C341E7423069C695Eee1b4C78',

    // transparent t1, 251 txs, no coinbase in its history, dormant since 2021
    ZEC: { sym: 'ZEC', metaKey: 'zcash', addr: 't1cf9PNYWAaF5u54nuQV9ki3G6LwE3dB4bi' },
    ZEC_ORACLE_BB: 'blockbook.zec.zelcore.io',
    ZEC_TESTNET_ADDR: 'tmHTCmZ4dPGtVxtNJG1gC6bVYYrNRgNs1Cu', // a mainnet Blockbook answers for t1RcTSiaDzcNzpeArbHNTEvpnwsHc97LEtp instead
}
