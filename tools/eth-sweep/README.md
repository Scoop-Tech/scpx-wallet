# ETH / ERC20 send audit (2026-11-03) and the sweep tool

## Why

The BTC audit was repeated for the ETH / ERC20 path before sweeping two mainnet ETH addresses. The review was a workflow: three independent read-only auditors (fee/gas/value; recipient/chain/nonce; ERC20 and safety nets), each followed by a skeptic that tried to refute every finding against the code. Every finding below survived that check unless it says otherwise.

## Send path

1. `svr-wallet/sw-tx.js` `txPush`: validates the parameters, gets a fee quote (`txGetFee`), then calls `createAndPushTx`.
2. `actions/wallet-external.js`: the ACCOUNT branch of `createTxHex`.
3. `actions/wallet-account.js`, which calls into the worker.
4. `app-worker/worker-web3.js`: `getGasPrices`, `createTxHex_Eth` / `createTxHex_erc20` (ethereumjs-tx, legacy type 0, EIP-155) and the push.

## Findings and what changed

| # | Finding (skeptic-verified) | Risk | Change |
|---|---|---|---|
| 1 | No cap on gas price or total fee. One public node's `eth_gasPrice` was signed as-is, re-fetched at push time. | Could overpay up to the node's own fee cap | **New `actions/wallet-eth-sendguard.js`:** the signed hex is decoded before broadcast. Gas price ≤ 200 gwei and gasLimit × gasPrice ≤ 0.01 ETH (override: `WALLET_MAX_GAS_PRICE_GWEI` / `WALLET_MAX_FEE_ETH`). |
| 2 | Nothing checked the signed tx at all. | Builder bugs would go unnoticed | The guard verifies the signature; the signer == the from-address; the EIP-155 chain id (1 / 11155111); ETH `to` == receiver, data empty, value == requested wei exactly, value + max fee ≤ balance; ERC20 `to` == the configured contract, value 0, data == `transfer(receiver, amount × 10^decimals)` exactly. |
| 3 | The fee you see (or dry-run) is not the fee signed: it is re-quoted, and gasLimit can be raised after the balance check. | Surprises; fails safe for sweeps | Exact-gas mode, a dry run, and the sweep tool broadcasts **the exact checked hex**. |
| 4 | Amount went through a JS `Number`, losing the last wei digits. | Wrong by tens of wei; an exact sweep was impossible | Account-type values are kept as exact decimal strings; balance checks use BigNumber. |
| 5 | A full sweep could never leave 0: x1.25 gas headroom, a 50-wei padding hack, float value. | Dust left behind | `tx-push gasPrice=<wei> gasLimit=<n>` (ETH): signs exactly those, with no re-estimate and no padding. |
| 6 | Legacy gasPrice = bare `eth_gasPrice` ≈ baseFee + a few thousand wei, so the tx can get stuck. | Stuck tx (no loss) | The tool prices at max(2 × baseFee + tip, node price). `tx-push gasPrice` is also accepted for ERC20s. |
| 7 | `from` missing, or sent as the alias `f`, silently fell back to address index 0. | Wrong source (funds on index 1) | Aliases are mapped, and conflicting values refused. With more than one address, `from` is required. |
| 8 | Stray positional words (e.g. `dryRun` without `--`) were ignored, so the tx was broadcast. | Unintended broadcast | Refused. |
| 9 | An all-lowercase recipient has no checksum, so a typo can't be detected. | Wrong address | The tool requires the checksummed mixed-case form on mainnet and refuses contract addresses. |
| 10 | Sweeping ETH first strands tokens (no gas left to move them). | Stuck tokens | The tool refuses an ETH sweep while known tokens remain (or `--leave-tokens`). |
| 11 | The MPK was printed (CLI startup log; RPC/console in non-test mode). | Key exposure | Always `[secure]`. |
| 12 | Only index 0 is derived at load, and RPC had no way to add addresses. | Funds at index 1 invisible | RPC `wallet-add-address` (in memory only, never saved). |

**Still open (low, fail-safe or not on the sweep path):**
- Worker replies are matched by symbol only, so concurrent sends could cross-wire. The tool sends one tx at a time.
- A broadcast reported as failed may still have gone through. The tool checks the hash, and re-sending the same raw tx is safe.
- Normal (non-tool) sends still use the node's gas price.
- After a send, the next send in the same session can try to re-spend a coin its own pending tx already spent. The node rejects it, so it fails safe. Seen on BTC_TEST.

## The sweep tool: `tools/eth-sweep/eth-sweep.mjs`

It moves the whole balance of one wallet address, either ETH or one ERC20 token, to one address. It uses two independent RPC providers per network: mainnet publicnode + dRPC, Sepolia publicnode + Tenderly. Every read must agree. ethers v6 (`tools/eth-sweep/package.json`) is used for decoding, signer recovery and ABI.

1. **Chain and destination:** both providers are on the right chain. The destination checksum is valid (mixed-case required on mainnet), it is not a contract, and it is not one of the wallet's own addresses.
2. **Wallet:** loaded from the MPK (never printed). More HD addresses are derived (in memory) until `--from` is found.
3. **Balances:** the wallet's balance must equal both providers'. Nothing may be pending. An ETH sweep is refused while known tokens remain.
4. **Gas (ETH):** gasLimit = the exact `eth_estimateGas` (both providers agree); gasPrice = max(2 × baseFee + tip, node price); value = balance − gasLimit × gasPrice.
5. **Wallet dry run:** `tx-push dryRun=true` with exact gas. The wallet's send guard runs.
6. **Independent decode (ethers):** checks type 0, chain id, the recovered signer, nonce, to, value/data, gas and the hash. For ETH, value + fee == the whole balance. The exact call is then simulated on both providers.
7. **Confirm and broadcast:** after you type the last 6 characters of the destination, the exact checked raw tx is sent to both providers. The tool then waits for the receipt (status 1) and reports what is left on the source address.

## Tests

- `tests/lean/eth-sendguard.node14.js` (offline, 15 checks). It signs txs with throwaway keys and covers every accept and refuse case above: chain id mainnet/Sepolia/none; wrong signer, recipient or amount (1 wei); data on an ETH transfer; balance; both caps and their env overrides; tampered signature; ERC20 wrong contract, recipient, amount, ETH value, `approve()`, sub-unit amounts.
- `tests/lean/eth-sweep-rehearsal.test.mjs` (live Sepolia): checks that bad gas-parameter combinations are refused. It then funds B's index-1 address with ETH + USDC_TEST through the normal path (guard passes), sweeps the token and then the ETH with the tool, and asserts B/1 holds **exactly 0** of both.
