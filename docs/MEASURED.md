# Measured

Facts measured on a real run, failures included. Newest first.

## Attestation

Attestations (SPEC "Attestations"), 2026-11-18. The second demo Nostr key ran `tambat attest` on the main demo identity. The
command read the main identity's current binding from the relays, checked it, and published a NIP-32 label (kind 1985) pinned
to that binding event's id. Relays: relay.damus.io refused the connection; nos.lol and relay.primal.net accepted. A few
seconds later `tambat attestations` on the main identity found the attestation, checked it against the current binding and
printed "verified by" the second demo key, exit code 0. After the deploy of `b3f6f59`, the live look-up page of the main
identity (WebKit, iPhone 13) showed the same attestation under **Attestations**, with no horizontal overflow at 390 px. Dropping an attestation when the binding is replaced is covered by
tests (`tests/attest*.test.ts`, `e2e/attest.spec.ts`); the main demo binding was not replaced for this.

| UTC | attestation event | attester | subject | pinned binding event | relays accepting | reading | result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 01:28:44 | `e50c7901d6917710faa235bfbbef57a9327a8e41fe3394a5224d10a674fc26e9` | `npub1mu7f0uqpq86xx7xlzacw8hhqdxspmzwqucfcya2rzucnnvvvg6asnqhqql` | `npub18yklrtcpe34drm9t4pu8nfytlwqy30clje05ue8j0298v3quqn6qh8pfwt` | `f00647858dd2dae400b33d2f7955832c49babc568480c3567ca85cfbe5af46e2` | nos.lol, relay.primal.net | current, counts | ok |

## Receipt

Payment receipts (SPEC "Payment receipts"), 2026-11-18. No payment was made for this: the transaction is an existing public
mainnet transaction, `dff40f79cef322369d1d7ab9dc20f71a75dd333dc30eb2d77c08dafdbd1a7e86` (block 478559, the first block of
BCH, position 1), not made by any key of this project. The second demo Nostr key (its binding revoked, so it has no bound
address) ran `tambat receipt-publish` naming the main demo identity as the payee. Relays: relay.damus.io refused the
connection; nos.lol and relay.primal.net accepted. A few seconds later `tambat receipt <txid>` found the receipt on the
relays, read the transaction and its input's previous transaction from a Fulcrum server in `config.anchor.electrum` (both
hashed to the ids asked for), and printed "transaction found on BCH, pays no address bound to the payee" and "payer not
proven", exit code 1. After the deploy of `0ed8a3b`, **Check receipts** on the live Pay page (WebKit, iPhone 13) showed the same
receipt with the same reading and no horizontal overflow at 390 px. That is the expected reading: the receipt is only the author's claim. The "from a bound address" reading
is covered by tests against a fake chain (`tests/receipt*.test.ts`, `e2e/receipt.spec.ts`), not by a live payment.

| UTC | receipt event | author | payee | txid | relays accepting | reading | result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 00:49:25 | `f036fb9d796eef42fd388fb90de668c2e8ec8851d69648649cde72511b98e506` | `npub1mu7f0uqpq86xx7xlzacw8hhqdxspmzwqucfcya2rzucnnvvvg6asnqhqql` | `npub18yklrtcpe34drm9t4pu8nfytlwqy30clje05ue8j0298v3quqn6qh8pfwt` | `dff40f79…7e86` | nos.lol, relay.primal.net | payer not proven | ok |

## Anchor

Optional BCH anchor (SPEC "Optional BCH anchor"), 2026-11-18. The demo BCH address
`bitcoincash:qr2fkhyknwxwxurvmnkyexhlhm5mpd5fmykwdplz77` was read from a Fulcrum server in `config.anchor.electrum` with the
library's own chain reader: no unspent outputs and no transaction history. An anchor needs a funded address, so no anchor
transaction was made from the demo key. `tambat anchor-lookup` on the same address printed "No commitment found on BCH".
"not funded" means no transaction was built or broadcast.

On 2026-11-18 the owner of the Paytaca binding (`bitcoincash:qp2n90karn7qnp7thtqzsgj2hfjze6ktgs8r2mm56u`, see Paytaca below)
made an anchor for it. The transaction spends from that address, so it was signed by the Paytaca wallet that holds the
address; the look-up page's **Anchor this link on BCH** asks the wallet for it over WalletConnect (`bch_signTransaction`).
At 16:03 UTC `tambat anchor-lookup` on that address, reading the chain only, printed block 977901 (2026-11-18 15:23:03 UTC), the Paytaca binding's npub, event
`d7c03eee500222e86c5d2b1836a26983a5115b91a5ba23b59b80ed480b1b489b` and the transaction below. `tambat lookup` on the same
address from the default relays still returned that event as the newest binding (every check `pass`), so the anchor counts
for the pair (SPEC "Optional BCH anchor", check 3).

| UTC | address | txid | block | event | signer | result |
| --- | --- | --- | --- | --- | --- | --- |
| 00:01:46 | demo address | - | - | - | demo key | not funded |
| 16:03 | qp2n90ka…m56u | a3cf6e76c990b851d2de0381d547eb9cde043454b4420bdde8270f7a69b74263 | 977901 | d7c03eee… | Paytaca (owner) | ok |

On 2026-11-19 at 00:18:13 UTC, after the reader was changed to require agreement (ADR 0014, `anchor.quorum` 2),
`tambat anchor-lookup` on the Paytaca binding's address printed "read from 3 of 3 chain servers, all alike:
bch.imaginary.cash, bch.loping.net, fulcrum.greyh.at (quorum 2)", then block 977901, the same npub, event `d7c03eee…` and
transaction `a3cf6e76…4263` as the row above (exit code 0).

## Wall

The wall's own code (`loadWall` in `src/core/wall.ts`, with the query that keeps events whose signature fails) run from the
host against the default relays, 2026-11-17, before deploying it. Each relay was asked for the newest 30 kind 10011 events
(`wall.limit`). relay.damus.io refused this host's connections, as all day. "shown" are bindings that passed every step;
"hidden" are events naming a BCH address that failed a step. Kind 10011 events without a BCH address are not counted.

| UTC | events per relay | unique events | shown | hidden | ms | result |
| --- | --- | --- | --- | --- | --- | --- |
| 17:46:12 | relay.damus.io 0, nos.lol 30, relay.primal.net 30 | 34 | 2: `d7c03eee500222e86c5d2b1836a26983a5115b91a5ba23b59b80ed480b1b489b` (the Paytaca binding below), `f00647858dd2dae400b33d2f7955832c49babc568480c3567ca85cfbe5af46e2` (main demo identity) | 0 | 3385 | ok |
| 2026-11-18 16:41:44 | relay.damus.io 0 (refused), nos.lol 5 pages of 200, relay.primal.net 5 pages of 200 | 1473 | 4: `368d108445a7317393b3af224bdd1803ae72f39f2be23c4a64d2094758f6d9e4`, `271cad218146e5e39d75f9aac55f6e7629751ba02ef354084a59535bbdf3a786`, `d7c03eee500222e86c5d2b1836a26983a5115b91a5ba23b59b80ed480b1b489b` (the Paytaca binding below), `f00647858dd2dae400b33d2f7955832c49babc568480c3567ca85cfbe5af46e2` (main demo identity) | 3 | 6631 | ok |
| 2026-11-19 08:15 | WebKit, iPhone 13 profile, live site tag ffaca93, no scroll; relay.damus.io refused (503) | not counted | 4 cards; the Paytaca binding `d7c03eee500222e86c5d2b1836a26983a5115b91a5ba23b59b80ed480b1b489b` third, below the fold; chain read for cards yes, no, no, no; no badge after 30 s | not counted | 38578 | no badge |
| 2026-11-19 09:12 | WebKit, iPhone 13 profile, live site tag bf8c5b6 (ADR 0016), no scroll; relay.damus.io refused (503) | not counted | 4 cards; `d7c03eee500222e86c5d2b1836a26983a5115b91a5ba23b59b80ed480b1b489b` third, below the fold, shows "Anchored since block 977901"; chain read for cards yes, yes, yes, no | not counted | 72208 | ok |

On 2026-11-18 at 16:13 UTC the newest 30 kind 10011 events held one BCH binding each on nos.lol and relay.primal.net, and
not the Paytaca binding: identity events of other platforms had pushed it out, and the relays cannot filter on the value
of an `i` tag. Asked for 500, both relays returned it. The wall now pages each relay back
on its own cursor with `until`, `wall.pageSize` (200) events per page and at most `wall.maxPages` (5) pages, until it holds
`wall.limit` verified bindings or the pages run out. The second row is the same host run of `loadWall` after that change;
"events per relay" counts pages times events per page. On the live site (tag 7c9be65) the same day, /wall in Chromium and
in WebKit on an iPhone 13 listed 4 bindings including `d7c03eee` after 6 to 8 seconds, with no horizontal overflow; the
only console errors were relay.damus.io refusing the WebSocket handshake.

The two 2026-11-19 rows are the live /wall in WebKit with the iPhone 13 profile (390 by 664), before and after reading
entries within one screen below the fold (`wall.sinceRootMargin`, ADR 0016). "ms" runs from opening the page to the badge
or to giving up; the host was under heavy load (load average above 200) during the second run. Scrolling each card into
view gave the badge before the change too; each chain server got one WebSocket per read, all closed after.

## Sign-in

BCH-only sign-in on the live demo app, 2026-11-17, after deploying `b21e09d`. A script on the host asked
`POST /api/rp/challenge` on https://tambat.sasateguh.com, signed the returned `bchText` with the demo BCH key (it matched
`Sign in to https://tambat.sasateguh.com with challenge <nonce>` exactly) and posted `{"type": "bch", ...}` to
`/api/rp/login`. The server found the Nostr key on its own relays. `ms` covers the challenge and the sign-in. Sending the same
answer again was refused with `challenge_unknown` in both rows. "ok" means a session for the bound npub; "refused" means no
session.

| UTC | method | address | npub from the server | binding event | ms | result |
| --- | --- | --- | --- | --- | --- | --- |
| 11:57:31 | bch | `bitcoincash:qr2fkhyknwxwxurvmnkyexhlhm5mpd5fmykwdplz77` (main demo identity) | `npub18yklrtcpe34drm9t4pu8nfytlwqy30clje05ue8j0298v3quqn6qh8pfwt` | `f00647858dd2dae400b33d2f7955832c49babc568480c3567ca85cfbe5af46e2` | 2196 | ok |
| 11:57:37 | bch | `bitcoincash:qruxnv4dpr6ygdvv5czupa9dgrqy69vtjceqzzvzc9` (second demo identity, revoked above) | none: `401 no_binding` | none | 1192 | refused |

## Relays

Candidate relays, 2026-11-19, from the host over WebSocket (not HTTP): open a connection, send a REQ for kind 10011 with
`limit` 1 and wait for EOSE, then send the main demo identity's existing binding event `f00647858dd2dae400b33d2f7955832c49babc568480c3567ca85cfbe5af46e2`
(signed by the demo key, unchanged) as EVENT and wait for OK. Times are milliseconds from opening the connection. A first
run a few minutes earlier gave the same answers for the three candidates (each newly stored the event) while relay.damus.io
refused the handshake with HTTP 503. relay.snort.social and nostr.mom were added to `config/tambat.json`, so the app now asks
five relays; offchain.pub also passed and is not used.

| UTC | relay | handshake ms | REQ answer | EVENT answer | result |
| --- | --- | --- | --- | --- | --- |
| 09:53:56 | nostr.mom | 592 | EOSE at 794, 1 event | `OK true` (duplicate) at 798 | ok |
| 09:53:56 | relay.snort.social | 600 | EOSE at 799, 1 event | `OK true` at 799 | ok |
| 09:53:56 | offchain.pub | 653 | EOSE at 908, 1 event | `OK true` (duplicate) at 895 | ok |
| 09:53:56 | relay.damus.io | 696 | EOSE at 896, 1 event | `OK true` (duplicate) at 813 | ok |

## Lookup

Second demo identity (not the main demo below), 2026-11-17, from the host with `tambat lookup` and the same library calls. `ms`
is the time of the whole look-up across the default relays. relay.damus.io returned nothing all session: it refused this host's
connections on every publish and every query. Result "ok" means a verified answer; "none" means no npub was found.

| UTC | direction | query | relays answered | ms | result |
| --- | --- | --- | --- | --- | --- |
| 11:01:11 | npub→address | `npub1mu7f0uqpq86xx7xlzacw8hhqdxspmzwqucfcya2rzucnnvvvg6asnqhqql` finds `bitcoincash:qpn5a800wqjmfvnkjqw6qmszctw3julmdsfparjhf7`, event `8d552e29246d...` | nos.lol, relay.primal.net | 1108 | ok |
| 11:01:15 | address→npub | `bitcoincash:qpn5a800wqjmfvnkjqw6qmszctw3julmdsfparjhf7` finds `npub1mu7f0uqpq86xx7xlzacw8hhqdxspmzwqucfcya2rzucnnvvvg6asnqhqql` | nos.lol, relay.primal.net | 2057 | ok |
| 11:01:48 | npub→address | `npub1mu7f0uqpq86xx7xlzacw8hhqdxspmzwqucfcya2rzucnnvvvg6asnqhqql` (after the move) finds `bitcoincash:qruxnv4dpr6ygdvv5czupa9dgrqy69vtjceqzzvzc9`, event `f918c39a4599...` | nos.lol, relay.primal.net | 1302 | ok |
| 11:01:54 | address→npub | `bitcoincash:qpn5a800wqjmfvnkjqw6qmszctw3julmdsfparjhf7` (old address): finds no npub | nos.lol and relay.primal.net hold no matching event | 2036 | none |
| 11:02:00 | address→npub | `bitcoincash:qruxnv4dpr6ygdvv5czupa9dgrqy69vtjceqzzvzc9` (new address) finds `npub1mu7f0uqpq86xx7xlzacw8hhqdxspmzwqucfcya2rzucnnvvvg6asnqhqql` | nos.lol, relay.primal.net | 2416 | ok |
| 11:02:30 | npub→address | `npub1mu7f0uqpq86xx7xlzacw8hhqdxspmzwqucfcya2rzucnnvvvg6asnqhqql` (after revoking): newest event `6aa1a2d0fe53...` names no address | nos.lol, relay.primal.net | 1021 | no current link |
| 11:02:40 | address→npub | `bitcoincash:qruxnv4dpr6ygdvv5czupa9dgrqy69vtjceqzzvzc9`: finds no npub | nos.lol and relay.primal.net hold no matching event | 1118 | none |
| 11:02:50 | address→npub | `bitcoincash:qpn5a800wqjmfvnkjqw6qmszctw3julmdsfparjhf7`: finds no npub | nos.lol and relay.primal.net hold no matching event | 1011 | none |

## Revocation

The replacing events were published with `tambat rotate` and `tambat revoke` (`--keys` pointing at the second demo identity's
phrase file). "Relays agreeing" are the relays whose newest kind 10011 event for the npub was the replacing event, asked a few
seconds after publishing. "ok" means the look-ups after the event matched it (the Lookup rows above): the removed address finds
no npub.

| UTC | binding event | revoking event | relays agreeing | result |
| --- | --- | --- | --- | --- |
| 11:01:44 | `8d552e29246d89aa8ac47e061cfa0893da21b4d2b04f35d80733c78778f2198a` | `f918c39a459905fae64afa2faf552f228760e0a03b73737571a4722b63ba28f3` (move to `bitcoincash:qruxnv4dpr6ygdvv5czupa9dgrqy69vtjceqzzvzc9`) | nos.lol, relay.primal.net; moved: the old address finds no npub, the new one verifies | ok |
| 11:02:26 | `f918c39a459905fae64afa2faf552f228760e0a03b73737571a4722b63ba28f3` | `6aa1a2d0fe533d3a68a17d53c6a91d166ee01c339ee1827e5d6e125065909ae0` | nos.lol, relay.primal.net; revoked: the npub has no current link and neither address finds the npub | ok |

## Recovery

Recovery from a lost Nostr key (SPEC "Recovery from a lost Nostr key"), 2026-11-18. A third demo Nostr key, made for this by
`scripts/demo-binding.ts keys`, ran `tambat recover` against the main demo identity (binding event
`f00647858dd2dae400b33d2f7955832c49babc568480c3567ca85cfbe5af46e2`), with the main demo wallet phrase as `--bch-keys`. The main
identity's event was not changed. Relays: relay.damus.io refused the connection; nos.lol and relay.primal.net accepted. A few
seconds later `tambat lookup` of the new npub printed "recovered from" the main demo npub with all five recovery steps passed,
and `tambat lookup` of the demo address listed both keys, the main one noted as recovered to the new npub. The live look-up page
showed the same on Chromium desktop and WebKit iPhone 13, with no horizontal overflow at 390 and 320 px.

| UTC | recovering event | new npub | recovered from | address | relays accepting | result |
| --- | --- | --- | --- | --- | --- | --- |
| 00:28:17 | `368d108445a7317393b3af224bdd1803ae72f39f2be23c4a64d2094758f6d9e4` | `npub19adq4gfjgm7cl38c3vj074rpfh5q5kucrzyh7s6zfe93uvrhp6pq66xyfz` | `npub18yklrtcpe34drm9t4pu8nfytlwqy30clje05ue8j0298v3quqn6qh8pfwt` | `bitcoincash:qr2fkhyknwxwxurvmnkyexhlhm5mpd5fmykwdplz77` | nos.lol, relay.primal.net | ok |

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
