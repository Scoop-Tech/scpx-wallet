#!/usr/bin/env bash
# Run the scpx-wallet e2e suite against real testnets. Usage: tests/e2e/run.sh <label> [test-file...]
# Needs ~/.config/scpx-wallet/e2e.env (E2E_MPK_A, E2E_MPK_B) and Node 14.21.3 + Node 22 via nvm.
set -euo pipefail
cd "$(dirname "$0")/../.."
LABEL=${1:-run}; shift || true
FILES=${*:-tests/e2e/btc.e2e.test.mjs}
source ~/.nvm/nvm.sh >/dev/null; nvm use 22 >/dev/null
export E2E_LABEL="$LABEL" E2E_COMMIT="$(git rev-parse --short HEAD)$(git diff --quiet -- . ':!tests' || echo '+dirty')"
node --test --test-concurrency=1 --test-reporter=spec $FILES
