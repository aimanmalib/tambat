# Measured

Facts measured on a real run, failures included. Newest first.

## 2026-11-16: live demo at https://tambat.sasateguh.com with a binding on public relays

- Demo identity made by `scripts/demo-binding.ts keys` (fresh BIP39 phrase, wallet paths):
  npub `npub18yklrtcpe34drm9t4pu8nfytlwqy30clje05ue8j0298v3quqn6qh8pfwt`,
  address `bitcoincash:qr2fkhyknwxwxurvmnkyexhlhm5mpd5fmykwdplz77`. It is a demo key, not a Paytaca wallet.
- `scripts/demo-binding.ts publish`: event `f00647858dd2dae400b33d2f7955832c49babc568480c3567ca85cfbe5af46e2` (kind 10011,
  created_at 1794827488). Accepted by 3 of 3 relays: relay.damus.io, nos.lol, relay.primal.net. Asking each relay for the id
  afterwards: each returned the event (3 of 3).
- `tambat lookup <npub>` and `tambat lookup <address>` from the default relays: VERIFIED, every step passes (exit code 0).
- `scripts/demo-binding.ts signin https://tambat.sasateguh.com`: login HTTP 200, session cookie set, session holds the npub
  above, the verified address above and `bchSigned: true`; the server found binding event `f006478...46e2` on its own.
- Public URL: `/healthz` 200; HTML carries the Content-Security-Policy from config, `cache-control: no-cache, no-transform`,
  `x-content-type-options: nosniff`; `/api/did/<npub>` 200 in 0.93 s; plain HTTP redirects with 301 to HTTPS.
- Live browser checks (`e2e/live.spec.ts`, Chromium desktop and WebKit iPhone 13): the first run failed 3 of 6 because of
  the test, not the site: it expected a sign-in button on the demo app before any key is connected, and it counted a
  relay's refused WebSocket (relay.damus.io answered 503 once) as a page error. After fixing both: 6 of 6 pass, including
  look-up of the published binding from the real relays.
- Before the deploy, the local end-to-end run with the new Content-Security-Policy failed every test: the browser refused to
  compile libauth's WebAssembly under `script-src 'self'`. Adding `'wasm-unsafe-eval'` fixed it (ADR 0004).

## 2026-11-16: server against the default relays

- Before the fix (ADR 0003): `GET /api/did/<npub of the test vector>` against the default relays answered 200 a few times and then
  the process exited with `RangeError: Maximum call stack size exceeded` from the WebSocket error handler. Reproduced on
  in-process sockets: a relay that rejects the handshake ends the process on the first query.
- After the fix: `npm start` on Node 22, `GET /api/did/<npub of the test vector>` 12 times in a row: 12 x HTTP 200, 0.79 to
  0.99 s each. `GET /healthz` afterwards: 200. No error lines in the server log.
