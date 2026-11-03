# BTC send audit (2026-11-03) and the sweep tool

## Why

Before moving real funds off an old wallet, the BTC send path was audited for two classes of loss:

- **Fee:** the transaction pays far more than intended.
- **Wrong address:** change (or the payment) goes to an address the owner can't spend.

The audit was one pass by hand plus two independent read-only reviews. Fixes and new tests are below.

## Send path (P2SH-P2WPKH: BTC_SEG on mainnet, BTC_TEST on testnet4)

1. `svr-wallet/sw-tx.js` `txPush`: validates the parameters, gets a fee quote (`txGetFee`), then calls `createAndPushTx`.
2. `actions/wallet-external.js` `computeTxFee`: fee rate from the BitGo oracle (`estimateFees_Utxo`). The fee is the vsize of the actual signed transaction multiplied by sat/KB.
3. `actions/wallet-utxo.js` `getUtxo_InputsOutputs`: picks the largest coins first and stops once the inputs cover value + fee. A leftover larger than the fee becomes change to the wallet's address 0. A leftover up to the fee goes to the miner, so the fee is at most 2x.
4. `actions/wallet-btc-p2sh.js` `createTxHex_BTC_P2SH`: builds and signs a bitcoinjs 5.2 PSBT.
5. **`actions/wallet-btc-sendguard.js` (new):** an independent check of the final signed hex before it can be broadcast.
6. `app-worker/worker-pushtx.js`: broadcasts with Blockbook `sendTransaction`.

## Findings and what changed

| # | Finding | Risk | Change |
|---|---|---|---|
| 1 | No upper limit on the fee anywhere. BitGo oracle values were used unchecked, and `psbt.extractTransaction(true)` switched off bitcoinjs's own fee-rate check. | A plausible but inflated oracle value pays it in full | Oracle values must be finite, ≥ 1000 sat/KB and ≤ the cap (`wallet-utxo.js`). bitcoinjs's check is on when signing for real, capped at 100 sat/vB. The send guard caps at 100 sat/vB **and** 100,000 sats per tx (override for one run: `WALLET_MAX_FEE_SAT_VB` / `WALLET_MAX_FEE_SATS`). |
| 2 | Nothing checked the final transaction: receiver amount, change address, extra outputs. | Builder or selection bugs would go unnoticed | The send guard decodes the signed hex. It requires: inputs exactly the selected coins; exactly one receiver output for exactly the requested sats; any other output is change to the change address; the change address re-derives (plain bitcoinjs `payments`) from a private key the wallet holds and is not a PROTECT_OP address; fee > 0, ≥ 1 sat/vB, within the caps, and ≤ 2x the intended fee. PROTECT_OP txs must keep their 5-output layout, with the dev fee only to the configured address. |
| 3 | Fee sized on full byte length / 1024 rather than vsize. | About 1.7x overpay on segwit | `ceil(vsize * satPerKB / 1000)` |
| 4 | Coin selection used a strict `>`. A sweep (value + fee == total) therefore pulled in every other coin, e.g. a dust-attack coin, which then went to the miner. | Small | `>=` |
| 5 | Balance check added floating-point numbers. On the `spendFullUtxos` path it joined two strings, so the check never fired. | Check didn't work (bitcoinjs still stopped overspends) | BigNumber arithmetic |
| 6 | Unknown `tx-push` parameters were ignored, so a mistyped `--dryrun` would broadcast for real. | Unintended broadcast | Unknown parameter names are refused. `dryRun` must be `true` or `false`. |
| 7 | An empty `dsigCltvPubKey` switched on the PROTECT_OP code path. | Failed safe (threw) | Empty or non-string values count as "not PROTECT_OP" |
| 8 | The MPK was printed to the console and the RPC log outside test mode. | Key exposure | Always `[secure]`. The RPC logs parameter names only. `SW_MPK` env var keeps the MPK out of the process list. |
| 9 | Legacy P2PKH inputs (asset `BTC`) don't sign-commit to their values, so a backend under-reporting a coin's value hides a huge real fee. | Can lose money | The guard refuses legacy `BTC` sends (override `WALLET_ALLOW_UNCOMMITTED_LEGACY_INPUTS=1`). Sweep those with a tool that checks parent txs. |
| 10 | No dry run. | Couldn't inspect before sending | `tx-push ... dryRun=true` returns the signed hex and the guard summary, and broadcasts nothing. |

**Checked and safe:**
- **Receiver address:** checked for checksum and network by both scp-address-validator and bitcoinjs. Taproot `bc1p` is refused (bitcoinjs 5.2 can't pay it).
- **Change address:** `asset.addresses[0]`; the guard now verifies it independently.
- **Coin amounts:** for P2SH-P2WPKH they are committed by the BIP143 signatures, so a backend lying about an amount makes the tx invalid, not expensive.
- **Broadcast:** sends exactly the signed hex.

**Known, not fixed:** if Blockbook accepts a tx but the follow-up `getTransaction` fails, `tx-push` reports an error even though the tx was sent. Always check an explorer before retrying.

## Tests

- `tests/lean/btc-sendguard.node14.js`, offline, 32 checks. Uses the real coin selection and P2SH builder with throwaway keys on mainnet and testnet parameters.
  - **Accepted:** sends with change, 2-coin sweeps and 3-address sweeps, each with exact amounts.
  - **Refused:** wrong receiver amount; change to a foreign address, to a listed address whose key doesn't match, or to a PROTECT_OP address; an extra output; tampered inputs; fee > 2x intended; fee above either cap (and bitcoinjs's own check fires first); < 1 sat/vB; a testnet receiver on mainnet; a garbage or absurd fee oracle.
- `tests/lean/btc-send-verify.test.mjs`, live testnet4. Checks what was actually put on chain:
  - The raw hex comes from mempool.space and is decoded by `rawtx.mjs`, with prevout values from mempool.space.
  - Receiver gets exactly the requested sats, the only other output is change to the sender's own address 0, and on-chain fee == the guard's fee.
  - A dry run never reaches the network, and mistyped parameters are refused.
- `tools/btc-sweep/rawtx.mjs` has no shared code with the wallet. It was checked against mempool.space's decode of real mainnet and testnet4 txs (legacy, P2SH, P2WPKH, P2WSH, taproot, OP_RETURN): txid, weight, values, scripts and addresses. It refuses bad checksums, the wrong network and mixed-case bech32.

## The sweep tool: `tools/btc-sweep/btc-sweep.mjs`

It moves every confirmed coin of a BTC_SEG (mainnet) or BTC_TEST (testnet4) wallet asset to **one** address, with no change output. It broadcasts **the exact transaction it checked**.

1. **Destination:** decoded independently (network, checksum, type; taproot refused).
2. **Wallet:** loaded from the MPK (env `SW_MPK`, or `--mpk-ref` looked up in the MPK CSVs; never printed) in a private temp dir that is deleted on exit.
3. **Coins:** every wallet address's coins are fetched from mempool.space, a backend independent of the wallet's Blockbook. They must match the wallet's balances, all be confirmed, and have nothing pending.
4. **Dry run:** the wallet builds and signs it with `tx-push dryRun=true spendFullUtxos=<exactly those coins>`, so its send guard runs.
5. **Independent decode:** inputs are exactly those coins; one output to the destination; amount = total − fee; fee ≤ `--max-fee-sats` (5000) and ≤ `--max-sat-vb` (50); txid and fee agree with the wallet's guard. Then **mempool.space `testmempoolaccept`** (a real Bitcoin node) must accept it, and its fee must match.
6. **Confirm and broadcast:** you type the last 6 characters of the destination address, then that exact hex is sent to mempool.space. `--yes` (skip the prompt) is testnet-only. `--check-only` stops before this step.

A record (hex and summary) is written to `~/.config/scpx-wallet/sweeps/` (mode 600).

## Addresses beyond index 0: `--derive N`

The wallet loads only standard address index 0. `btc-sweep.mjs` therefore first derives, in memory only (RPC `wallet-add-address`, never saved), the first `--derive N` standard addresses (default 10, the same range as the 2026-11 MPK scan). Every coin on any of them is checked and swept. PROTECT_OP addresses are skipped and reported.

## Legacy single keys (e.g. the 2018-12 pre-HD key): `legacy-sweep.mjs`

The wallet no longer derives pre-HD keys, and its send guard refuses legacy P2PKH sends. Legacy signatures don't commit to input amounts, so a backend that under-reports a coin hides the real fee. `legacy-sweep.mjs` handles these:

- **Key:** derived in a Node 14 helper (`legacy-sign.node14.js`) with the wallet's own libraries. For the pre-HD key that is `sha256_shex(pbkdf2(apk, mpk))`, the same code path as the scan. The key never leaves the helper, and it must derive exactly `--from`.
- **Coin values:** each value comes from its **parent transaction**, whose double-SHA256 must equal the coin's txid. The backend's figure isn't trusted.
- **Fee:** sized on an upper-bound vsize at max(2, mempool.space fastest) sat/vB, with caps (`--max-fee-sats` 3000, `--max-sat-vb` 50). The tool refuses if what's left would be dust.
- **Before broadcast:** an independent decode (inputs exactly those coins, one output to the destination, exact fee), then mempool.space `testmempoolaccept`. That proves the signatures are valid and the node-computed fee matches.
- **Broadcast:** only after you type the last 6 characters of the destination; then the exact hex is sent. Testnet rehearsals pass a throwaway key in `SWEEP_WIF`.
