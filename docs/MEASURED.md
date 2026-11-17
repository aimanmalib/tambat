# Measured

Facts measured on a real run, failures included. Newest first.

## Lookup

Second demo identity (not the main demo below), 2026-11-17, from the host with `tambat lookup` and the same library calls. `ms`
is the time of the whole look-up across the default relays. relay.damus.io returned nothing all session: it refused this host's
connections on every publish and every query.

| UTC | direction | query | relays answered | ms | result |
| --- | --- | --- | --- | --- | --- |
| 11:01:11 | npub→address | `npub1mu7f0uqpq86xx7xlzacw8hhqdxspmzwqucfcya2rzucnnvvvg6asnqhqql` | nos.lol, relay.primal.net | 1108 | ok: `bitcoincash:qpn5a800wqjmfvnkjqw6qmszctw3julmdsfparjhf7`, event `8d552e29246d...` |
| 11:01:15 | address→npub | `bitcoincash:qpn5a800wqjmfvnkjqw6qmszctw3julmdsfparjhf7` | nos.lol, relay.primal.net | 2057 | ok: `npub1mu7f0uqpq86xx7xlzacw8hhqdxspmzwqucfcya2rzucnnvvvg6asnqhqql` |
| 11:01:48 | npub→address | `npub1mu7f0uqpq86xx7xlzacw8hhqdxspmzwqucfcya2rzucnnvvvg6asnqhqql` (after the move) | nos.lol, relay.primal.net | 1302 | ok: `bitcoincash:qruxnv4dpr6ygdvv5czupa9dgrqy69vtjceqzzvzc9`, event `f918c39a4599...` |
| 11:01:54 | address→npub | `bitcoincash:qpn5a800wqjmfvnkjqw6qmszctw3julmdsfparjhf7` (old address) | nos.lol and relay.primal.net hold no matching event | 2036 | none: the old address finds no npub |
| 11:02:00 | address→npub | `bitcoincash:qruxnv4dpr6ygdvv5czupa9dgrqy69vtjceqzzvzc9` (new address) | nos.lol, relay.primal.net | 2416 | ok: `npub1mu7f0uqpq86xx7xlzacw8hhqdxspmzwqucfcya2rzucnnvvvg6asnqhqql` |
| 11:02:30 | npub→address | `npub1mu7f0uqpq86xx7xlzacw8hhqdxspmzwqucfcya2rzucnnvvvg6asnqhqql` (after revoking) | nos.lol, relay.primal.net | 1021 | no current link: newest event `6aa1a2d0fe53...` names no address |
| 11:02:40 | address→npub | `bitcoincash:qruxnv4dpr6ygdvv5czupa9dgrqy69vtjceqzzvzc9` | nos.lol and relay.primal.net hold no matching event | 1118 | none |
| 11:02:50 | address→npub | `bitcoincash:qpn5a800wqjmfvnkjqw6qmszctw3julmdsfparjhf7` | nos.lol and relay.primal.net hold no matching event | 1011 | none |

## Revocation

The replacing events were published with `tambat rotate` and `tambat revoke` (`--keys` pointing at the second demo identity's
phrase file). "Relays agreeing" are the relays whose newest kind 10011 event for the npub was the replacing event, asked a few
seconds after publishing.

| UTC | binding event | revoking event | relays agreeing | result |
| --- | --- | --- | --- | --- |
| 11:01:44 | `8d552e29246d89aa8ac47e061cfa0893da21b4d2b04f35d80733c78778f2198a` | `f918c39a459905fae64afa2faf552f228760e0a03b73737571a4722b63ba28f3` (move to `bitcoincash:qruxnv4dpr6ygdvv5czupa9dgrqy69vtjceqzzvzc9`) | nos.lol, relay.primal.net | moved: the old address finds no npub, the new one verifies |
| 11:02:26 | `f918c39a459905fae64afa2faf552f228760e0a03b73737571a4722b63ba28f3` | `6aa1a2d0fe533d3a68a17d53c6a91d166ee01c339ee1827e5d6e125065909ae0` | nos.lol, relay.primal.net | revoked: the npub has no current link and neither address finds the npub |

## 2026-11-17: revoke and move a binding on the live relays

- Deployed `d62db4a`: the live browser checks passed 6 of 6 (Chromium desktop and WebKit iPhone 13). A new live check,
  "a revoked binding shows no current link from either direction", passed on both engines against
  https://tambat.sasateguh.com for the npub and both addresses above.
- Second demo identity made by `scripts/demo-binding.ts keys` with `TAMBAT_DEMO_KEYS` pointing at a second state file:
  npub `npub1mu7f0uqpq86xx7xlzacw8hhqdxspmzwqucfcya2rzucnnvvvg6asnqhqql`, first address `bitcoincash:qpn5a800wqjmfvnkjqw6qmszctw3julmdsfparjhf7`. Binding event `8d552e29246d89aa8ac47e061cfa0893da21b4d2b04f35d80733c78778f2198a` published at 11:00 UTC: accepted by nos.lol and relay.primal.net;
  relay.damus.io: connection failure. `tambat lookup` of the address: VERIFIED, exit code 0.
- `tambat rotate` picked the new address as the second receiving address of the same phrase and signed it fresh. `tambat
  revoke` then removed it. Each command printed only the event id, the addresses and each relay's answer; each was accepted
  by nos.lol and relay.primal.net and failed to connect to relay.damus.io.
- After revoking, `tambat lookup <npub>` printed NOT VERIFIED (the newest event carries no claim) and `tambat lookup <address>`
  printed "no verified binding found", exit code 1.

## 2026-11-17: a binding signed with a Paytaca wallet over WalletConnect

- The BCH signature in this binding was signed with a Paytaca wallet over WalletConnect `bch_signMessage` (the wallet
  owner's statement; the WalletConnect client log below agrees). The Nostr key is not the demo key.
- Event `d7c03eee500222e86c5d2b1836a26983a5115b91a5ba23b59b80ed480b1b489b` (kind 10011, created_at 1794907987, 09:33 UTC),
  npub `npub16lxyujttr050u2a884r0xszc7wjjfzqkyy0u7qlh9ghmswcdkf3sascsuz`,
  address `bitcoincash:qp2n90karn7qnp7thtqzsgj2hfjze6ktgs8r2mm56u` (not the demo address below).
- When it was published: accepted by nos.lol and relay.primal.net; relay.damus.io could not be reached from the browser.
- Measured again at 10:09 UTC on 2026-11-17, asking each relay by event id and by address tag (`#i`): nos.lol and
  relay.primal.net return the event to both questions (under 1.1 s each); relay.damus.io refused the connection
  (no WebSocket upgrade), so it returned nothing.
- `tambat lookup bitcoincash:qp2n90karn7qnp7thtqzsgj2hfjze6ktgs8r2mm56u` from the default relays at 10:09 UTC: VERIFIED,
  every step passes (event_shape, kind, event_id, nostr_sig, newest, bch_sig, address_match, network, key_separation),
  exit code 0. Two of three relays were enough.
- The site log for that visit shows the page loaded at 09:27 UTC and the WalletConnect client requested at 09:29 UTC. The
  client loads only when a visitor picks the WalletConnect option.

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
