# ETH + ERC20 history from Blockbook (worker-account)

Status: implemented on top of `bc87fb7`. Measured 2026-11-02.

## What changed

- `app-worker/worker-account.js` used to enrich each Blockbook txid through web3: `getTransaction`, then `getTransactionReceipt`, then `getBlock`, over a dedicated publicnode websocket. It now makes one Blockbook websocket `getTransaction` per tx through `isosocket_send_Blockbook` (heavy in-flight cap 8 per socket). If Blockbook can't return a tx (error or timeout), that tx falls back to web3. The fallback times out after 30s and its result is not cached.
- `mapTxBundle_blockbook` is a pure, exported function. It maps one Blockbook tx to a bundle `{ v: 2, txid, block_no, eth, erc20: { SYM } }`, and every view has the same shape that `mapTx_web3` produces.
  - **eth** view: every tx of the address goes into ETH history, as it did before.
    - Contract creations are included: their `to` is `ethereumSpecific.createdContract` and they carry `isContractCreation`.
    - A tx that moves a known token but no ETH is tagged with `erc20`/`erc20_contract` and `value 0`, the same as the local `erc20_ethFeeTx`. The UI shows the ETH fee for these when outgoing and hides them when incoming.
  - **erc20[SYM]** views are built only for tokens in `configExternal.erc20Contracts`, which is the code's historical erc20 list. Tokens are matched by contract address, never by Blockbook's symbol, because spam tokens fake that symbol.
    - Each view comes from `tokenTransfers`, so it covers direct `transfer()` calls, deliveries through routers or `transferFrom`, and mints such as faucets.
    - `value` = |net token flow for us|, and the direction is the sign of that flow.
    - Zero-value transfers (address poisoning) are ignored.
    - A `transfer()` to a known token that emitted no Transfer event (reverted or pending) is decoded from the call data, as before.
  - **fees**: once mined, this is the fee actually paid (`gasUsed x effective price`, Blockbook `fees`). Before, it was `gas limit x price`. While a tx is pending, it is `limit x price`.
  - `txFailedReverted` is set from `ethereumSpecific.status === 0`. `block_no` is -1 while pending.
- Cache:
  - There is one bundle per tx, under the existing `ETH{_TEST}_<owner>_txid_<txid>` key.
  - Only confirmed txs are cached. Unconfirmed txs are re-queried.
  - Old web3-format entries are refetched and replaced.
  - Concurrent ETH and ERC20 refreshes share one in-flight fetch per tx, so ERC20 assets reuse the ETH fetch instead of fetching again for each asset.

## Timings (wallet's own fetch, lean watch harness, newest 100 txs)

| address | before (web3 enrich) | after (Blockbook) |
|---|---|---|
| 0xFfB3...4C78 (pinned holder, spam-heavy: 18 MB for 100 txs) | 73 s, 36 of 100 txs | 4.9-6.4 s, 100 of 100 (101 BB calls); USDT/USDC 0.5 s, 0 getTransaction |
| 0xBE0e...33E8 (Binance, 13k txs) | (research: 6 s - 4 min) | 6.1 s cold, 0.5 s warm |

`getAccountInfo details:'txs'` was also evaluated. One page of 100 txs took 1.7-2.7 s and returned 18 MB. 100 `getTransaction` calls with 8 in flight took 3.5 s for the same 18 MB.

Per-tx calls were kept, for three reasons:

- The cache means each later poll fetches only new or unconfirmed txs. `details:'txs'` cannot skip cached txs, so it would re-download all N full txs on every new block.
- A single huge reply puts the 10 s getAccountInfo timeout at risk.
- A single huge reply holds the socket and bypasses the heavy-request limiter.

## Tests

- `tests/lean/eth-mapping.node14.js` runs offline and has 22 checks. It uses 16 real mainnet and Sepolia fixtures from `fixtures/fetch-eth-fixtures.mjs`, checks web3 parity, and exercises the cache path.
- `tests/lean/mainnet-watch.node14.js` checks ETH history against all newest-100 txids, including contract creations. It checks the USDT/USDC history, net value and direction against Blockbook `tokenTransfers`. It also checks the call budget, speed, and that ERC20 fetches reuse the ETH data.

## Known limitations / followups

- ERC20 history is drawn from the newest `WALLET_MAX_TX_HISTORY` (100) address txs, which are shared with ETH, so spam can push older token txs out. A possible fix is Blockbook `getAccountInfo { contractFilter }` per token.
- Internal ETH transfers (`ethereumSpecific.internalTransfers`, e.g. ETH paid out by a swap router) are not counted in the ETH view. The web3 path didn't count them either.
- The ETH balance and block height still come from web3 HTTP (publicnode). Blockbook `getAccountInfo` could provide both.
- The mempool local_tx path (`worker-blockbook-mempool`) still recognises only direct `transfer()` calls.
- UI impact on scpx-app (`WalletDetailTxHistory.js`), with no change made there:
  - Token receipts via routers, mints, and real-token dust airdrops now appear in the token's history.
  - In ETH history these txs are tagged `erc20` and incoming ones are hidden. They used to show as "+0 CONTRACT CALL".
  - Outgoing erc20 "To" is now the recipient instead of the token contract.
  - Fees are lower (the fee actually paid).
  - For token txs in ETH history, "Now" value is $0, where it used to be token amount x ETH price.
