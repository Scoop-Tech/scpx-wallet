#!/usr/bin/env bash
# Lean test pathway (fast; real testnets; minimum amounts; mainnet READ-ONLY). Usage: tests/lean/run.sh [--no-send]
# Needs ~/.config/scpx-wallet/e2e.env (E2E_MPK_A = testnets4, E2E_MPK_B = counterparty), Node 14.21.3 + Node 22 via nvm.
set -uo pipefail
cd "$(dirname "$0")/../.."
source ~/.nvm/nvm.sh >/dev/null
NO_SEND=0; [ "${1:-}" = "--no-send" ] && NO_SEND=1
declare -a R; rc=0
FAIL_DIR="${LEAN_FAIL_DIR:-/tmp/lean-failures-$(date +%Y%m%d-%H%M%S)}"
run() { local name=$1; shift; local t0=$(date +%s); if "$@" > /tmp/lean-$$.log 2>&1; then R+=("✔ $name ($(( $(date +%s)-t0 ))s)"); rm -f /tmp/lean-$$.log; else
  rc=1; mkdir -p "$FAIL_DIR"; local f="$FAIL_DIR/$(echo "$name" | tr -c 'A-Za-z0-9' '_' | cut -c1-60).log"
  grep -v -E 'PW5[1-9A-HJ-NP-Za-km-z]{40,}' /tmp/lean-$$.log > "$f"; rm -f /tmp/lean-$$.log   # full log kept (any MPK-shaped string dropped)
  R+=("✖ $name ($(( $(date +%s)-t0 ))s) - full log: $f"); echo "---- $name ----"; grep -E "✖|Error|expected|actual|FATAL|Fatal|Check failed" "$f" | head -20; echo "  (last lines:)"; tail -15 "$f"; fi; }
nvm use 22 >/dev/null
run "Blockbook websocket adapter (mock + live testnet/mainnet contract)" node --test tests/lean/blockbook-ws.test.mjs
run "MAINNET backends (btc1/2/3, eth, zec1, publicnode: up, 0.6.x, at tip; non-zero BTC/ETH/USDT/USDC/ZEC == oracles)" node --test tests/lean/mainnet-backends.test.mjs
run "MAINNET read-only (BTC_SEG/SEG2, ETH, USDT, USDC: balances, history, fees; sends refused)" node --test tests/lean/mainnet-readonly.test.mjs
if [ $NO_SEND = 1 ]; then
  run "BTC testnet4 wallet (read-only)" env LEAN_NO_SEND=1 node --test tests/lean/btc-testnet.test.mjs
else
  run "BTC testnet4 wallet (balances, history, fees, self-sends, receive, alerts)" node --test tests/lean/btc-testnet.test.mjs
  run "BTC sends verified on chain (independent decode: receiver exact, change to own addr, fee == guard; dry run; param typos refused)" node --test tests/lean/btc-send-verify.test.mjs
  run "ETH Sepolia wallet (balance, history, fee, self-send, receive both ways, alerts)" node --test tests/lean/eth-testnet.test.mjs
  nvm use 14.21.3 >/dev/null
  run "PROTECT_OP P2SH{DSIG/CLTV} create + independent verification" node --experimental-worker tests/lean/protect-op.node14.js
  run "PROTECT_OP claims: beneficiary claim (matured) + benefactor reclaim (locked)" node --experimental-worker tests/lean/protect-op-claims.node14.js
  nvm use 22 >/dev/null
  run "Sepolia ERC20 USDT_TEST/USDC_TEST (balances, fees, A->B->A sends to a fresh holder, no-false-zero, ZEC read-only)" node --test tests/lean/sepolia-erc20.test.mjs
  run "ETH sweep rehearsal (Sepolia, tools/eth-sweep: index-1 address, token then ETH, exactly 0 left; gas-param safety)" node --test tests/lean/eth-sweep-rehearsal.test.mjs
fi
nvm use 14.21.3 >/dev/null
run "ETH/ERC20 send guard (signed-tx decode: chain id, signer, recipient, exact value/transfer data, gas caps)" node tests/lean/eth-sendguard.node14.js
run "BTC send guard (real builders, throwaway keys: sweep/change shapes accepted; bad amount/change/outputs/inputs/fees refused; fee oracle sanity)" node tests/lean/btc-sendguard.node14.js
run "ETH/ERC20 history mapping (Blockbook getTransaction fixtures: transfers, routers, mints, poisoning, creations; web3 parity; cache)" node tests/lean/eth-mapping.node14.js
run "UTXO/ETH read path (real-chain fixtures: coinbase, P2PKH, OP_RETURN, ZEC, contract creation; + mainnet read-only)" node --experimental-worker tests/lean/utxo-mapping.node14.js
run "MAINNET watch (wallet code on funded public BTC/ETH/USDT/USDC addresses == oracles; known bugs = TODO)" node --experimental-worker tests/lean/mainnet-watch.node14.js
run "wallet reload x15 in one process (walletConnect hang regression)" node --experimental-worker tests/lean/wallet-reload.node14.js 15
echo; echo "LEAN SUMMARY"; printf '  %s\n' "${R[@]}"; exit $rc
