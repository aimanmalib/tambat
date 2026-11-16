#!/usr/bin/env bash
# Full gate: lint, types, unit tests, static build. No external network: relays and wallets are faked in tests.
set -euo pipefail
cd "$(dirname "$0")/.."

# Git hooks export GIT_* pointing at the real repository; tests that run git in temp folders must not inherit them.
while IFS= read -r name; do unset "$name"; done < <(env | sed -n 's/^\(GIT_[A-Z_]*\)=.*/\1/p')

export NO_COLOR=1

echo "== lint";  npm run -s lint
echo "== types"; npm run -s typecheck
echo "== unit";  npx vitest run --reporter=dot
echo "== build"; npm run -s build
if [ -d e2e ] && ls e2e/*.spec.ts >/dev/null 2>&1; then
  if [ "${CI:-}" = "1" ]; then
    echo "== browsers"; npx playwright install --with-deps chromium webkit >/dev/null
  fi
  echo "== e2e"; npx playwright test
fi
echo "gate ok"
