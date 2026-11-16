# 0004: Deployment, security headers and the demo identity

Status: accepted

## Context

The demo runs on one public host name behind a shared reverse proxy and a CDN. Judges must be able to open it, look up a
real binding on public relays and sign in to the demo app. The server must not hold keys.

## Decision

- One container built from a clean `git archive` of HEAD (`Dockerfile`, `deploy/deploy.sh`). The image runs the TypeScript
  server through `tsx`, so `tsx` is a runtime dependency; there is no separate compile step to drift from the tested code.
  The container is read-only with a tmpfs `/tmp`, no published port, no volume and no secrets.
- `deploy/deploy.sh` keeps the previous image in a stopped holder container, retries the public `/healthz` for up to 90 s
  after the route changes, then runs `e2e/live.spec.ts` (read-only, Chromium desktop and WebKit iPhone 13) against the
  public URL. A failed browser check rolls back. `--rollback` and `--status` are available by hand.
- HTML responses carry a Content-Security-Policy built from `config/tambat.json` `server.contentSecurityPolicy`, plus
  `Cache-Control: no-cache, no-transform` so the CDN neither caches nor rewrites the page. Scripts and styles are `'self'`
  only, plus `'wasm-unsafe-eval'` in `script-src`: libauth checks secp256k1 signatures with WebAssembly, and the browser
  refuses to compile it without that source (measured: every end-to-end test failed with a CSP error before it was added).
  It allows WebAssembly compilation only, not `eval` of JavaScript. `connect-src` allows any `wss:` and `https:` origin because a NIP-46 signer and a NIP-05 name point at relays and
  domains the user chooses; a fixed list would break those sign-in paths. `frame-src` allows the WalletConnect verify
  frame only. `frame-ancestors 'none'` stops the page being framed.
- The demo identity is made by `scripts/demo-binding.ts` from a fresh BIP39 phrase on the paths a phrase wallet uses
  (BCH `m/44'/145'/0'/0/0`, Nostr `m/44'/1237'/0'/0/0`). The phrase stays in an untracked state file with mode 0600 and
  is never printed. The script publishes only the binding event (kind 10011) to the configured relays.

## Consequences

- Undo a deploy with `deploy/deploy.sh --rollback`.
- Changing relays or allowed sources is a config change; the CSP follows it without code changes.
- The live browser check cannot publish or sign in (it would need keys in the browser test); sign-in on the live site is
  measured with `scripts/demo-binding.ts signin` and recorded in `docs/MEASURED.md`.
