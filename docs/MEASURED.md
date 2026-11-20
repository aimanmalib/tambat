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

## Verifiable credential

Attestations as W3C Verifiable Credentials 2.0 (SPEC "Attestations as Verifiable Credentials", ADR 0017), 2026-11-19. No new
event was published: the credential is built from the demo attestation in [Attestation](#attestation) and the binding it
pins. `tambat vc export e50c7901…` read both events from the relays and wrote `examples/attestation-vc.json`;
`tambat vc verify examples/attestation-vc.json` printed VERIFIED, exit code 0. The same file with `credentialSubject.bchAddress`
changed gave "a field differs from what the signed events say (credentialSubject.bchAddress[0])", and with another issuer
"the issuer is not the key that signed the attestation", both exit code 1. After the deploy of `62124b8`, the live look-up page
of the main demo identity offered "Download as Verifiable Credential" on the attestation; the downloaded file verified with
`src/core/vc.ts`, with no horizontal overflow. No W3C test suite was run.

| UTC | engine | page | file | issuer | result |
| --- | --- | --- | --- | --- | --- |
| 11:39:41 | WebKit iPhone 13 | look-up, main demo identity | `tambat-attestation-e50c7901d691.json` | `did:nostr:df3c97f00101f46378df1770e3dee069a01d89c0e613827543173139b18c46bb` | ok |
| 11:39:48 | Chromium 1280 by 900 | look-up, main demo identity | `tambat-attestation-e50c7901d691.json` | `did:nostr:df3c97f00101f46378df1770e3dee069a01d89c0e613827543173139b18c46bb` | ok |

## Portable reputation

Portable reputation files (SPEC "Portable reputation"), 2026-11-19. No event was published. `tambat rep export` read each
key's binding and attestations from the configured relays and the bound address from the chain servers; `tambat rep
verify` recounted the file. `examples/reputation-bundle.json` was made by `scripts/make-reputation-example.ts` from the main
demo binding, the published attestation above, and three attestations signed for the file and not published (a second
demo issuer, the holder vouching for itself, and one of an older binding signed offline). With its `attestations` changed
from 2 to 3 it gave "a claimed count differs from the recount (reputationSummary.attestations); recount: 2 attestation(s)",
exit code 1.

| UTC | holder | command | counted | anchor | exit code |
| --- | --- | --- | --- | --- | --- |
| 16:44:56 | Paytaca key `npub16lxyujttr050u2a884r0xszc7wjjfzqkyy0u7qlh9ghmswcdkf3sascsuz` | `rep export`, then `rep verify --chain` | 0 of 0 | since block 977901, confirmed by an agreed chain read | 0 |
| 16:45:20 | main demo identity `npub18yklrtcpe34drm9t4pu8nfytlwqy30clje05ue8j0298v3quqn6qh8pfwt` | `rep export`, then `rep verify` | 1 of 1 | none (no commitment on the chain) | 0 |
| 16:45 | main demo identity | `rep verify examples/reputation-bundle.json` | 2 of 4 (skipped: self, older binding) | none | 0 |

After the deploy of `9bb011d`, the live look-up page of the main demo identity offered "Download reputation summary"; the
downloaded `tambat-reputation-392df1af01cc.json` verified with `src/core/reputation.ts` (1 counted), with no horizontal
overflow: WebKit iPhone 13 at 16:54:56 UTC and Chromium 1280 by 900 at 16:55:01 UTC.

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

## Interoperability

Bindings written by another NIP-39 client, read from the default relays on 2026-11-20 and checked with the CLI from this
repository (`tambat lookup <hex key>`: newest event of the key from the relays, then every step; on-chain proofs read from
the three chain servers in `anchor.electrum`, quorum 2). The scan asked each relay for the newest 2000 kind 10011 events and
kept those with a `bch:` identity; events signed by this project's demo keys and the Paytaca binding are left out. "before"
is the verifier at tag 9c95138, which read only a prefixed CashAddr with a bare base64 signature.

Three spellings were found besides the one Tambat writes: a CashAddr without its prefix (`bch:qq…`), a signature written
`msg:<base64>`, and an on-chain proof `tx:<txid>` in place of a signature. The verifier now reads all three. A bare address
is read on the verifier's network; its checksum covers the prefix, so an address of another network fails. An on-chain
proof passes only when the chain servers agree on the transaction, it hashes to the txid, an input spends from the claimed
P2PKH address and the whole transaction passes the BCH virtual machine (libauth), and one output is exactly
`OP_RETURN <verification text for the author's npub>`. Without a chain read the proof is skipped and does not pass.

| UTC | event id | proof form | txid | before | result |
| --- | --- | --- | --- | --- | --- |
| 01:32:06 | `f156ff149bfafedb9b2caa08c9cb2af2847c7d6369f9d84c2990f71a106181f9` | `tx:1f765b727ee92b10c4c9d2d08439126c5e33bd53634e53dd6dfacd818b00895f` on an address without prefix, plus a second claim with a base64 signature on an address without prefix | `1f765b727ee92b10c4c9d2d08439126c5e33bd53634e53dd6dfacd818b00895f` | fail (`bch_sig`, `address_match`, `network`) | ok: tx_found, address_match, tx_text, network, key_separation pass for the proof; the second claim passes too |
| 01:32:06 | `0d10715b3a026c8d59648778bf340c9a0c85f75da551851480468bc24ff0474a` | signed message, address without prefix | | fail (`address_match`, `network`) | ok |
| 01:32:06 | `687125910c63f23e1c09e6f51b832f00dfeb6b7e14bb5b19e35a570ad6c0b4ee` | signed message, address without prefix | | fail (`address_match`, `network`) | ok |
| 01:32:06 | `c807c26ec834bf99fec83f6b0fc1ff40fc1340bf73469e3ddb7cbb121d713050` | signed message, address without prefix | | fail (`address_match`, `network`) | ok |
| 01:32:06 | `7c8d72e444fcb1a5dc6f166aee3a9a06eb58c6224fbdb0754a17ea502b223383` | `msg:<base64>` | | fail (`bch_sig`) | ok |
| 01:32:06 | `ca79c481ca37d3708533bf5c1d9ea9401f103e8d9c5998fc535d0ef01864010c` | `msg:<base64>` | | fail (`bch_sig`) | ok |
| 01:32:06 | `271cad218146e5e39d75f9aac55f6e7629751ba02ef354084a59535bbdf3a786` | signed message, prefixed address | | ok | ok |
| 01:32:06 | `4e0aeb7a4e4cfb8aef47719d592632d18dc9d9143f7a7579a23bf23bfa580aa9` | `msg:<base64>` on a `bchtest:` address | | fail (`bch_sig`, `network`) | fail: `network` (`wrong_network`, the address is on chipnet or testnet; this verifier expects mainnet) |

The proof transaction `1f765b72…895f` is kept as test data in `tests/fixtures/tx-proof-mainnet.json` with the transaction it
spends, as returned by the chain server named there.

2026-11-20: Tambat can now write this proof form too, through the WizardConnect option on Link
([ADR 0023](decisions/0023-wizardconnect-transaction-proof.md)). Not yet tested with a wallet: no proof transaction has been
made through it. What is measured is the code against a fake wallet that signs with keys from the public BIP39 test phrase
and a fake chain (`tests/anchor-wizard.test.ts`: the signed proof passes `verifyClaim`; a transaction signed by another key,
one with an extra output, and a reply that is not a transaction are refused before anything is sent), and the pairing code
and link in Chromium and WebKit on an iPhone 13 (`e2e/wizard.spec.ts`).

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

On 2026-11-20 the wall started keeping itself current (ADR 0022; tag fb427e7-202611200510): an open relay subscription,
a check of each relay's newest page every `wall.refreshSeconds` (30) while the tab is visible, and a count strip in place
of the Check again button. Live /wall before the deploy, WebKit iPhone 13 and Chromium at 320 px: 10 cards, the button
present, no strip. After: no button, no horizontal overflow (page 390 of 390 and 320 of 320, strip 324 of 324 and 254 of
254). Chromium desktop at about 05:38 UTC, 3 s after the list showed: verified 10, anchored 0 of 2 read, on-chain proofs 1,
attestations 1, relays answering 5 of 5, latest anchor block a dash; 15 s later: anchored 1 of 10 read, latest anchor
block 977901, the Paytaca entry carrying "Anchored since block 977901". In the WebKit run 3 s after the list, attestations
and the latest block were still a dash (not read yet) and 4 of 5 relays had answered.

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

Live site tag 777f545, 2026-11-19 10:16:58 UTC, WebKit with the iPhone 13 profile: Look up of the Paytaca binding's npub
`npub16lxyujttr050u2a884r0xszc7wjjfzqkyy0u7qlh9ghmswcdkf3sascsuz` verified event
`d7c03eee500222e86c5d2b1836a26983a5115b91a5ba23b59b80ed480b1b489b` and listed "4 of 5 relays answered": relay.damus.io refused
(0.6 s), nos.lol answered (0.7 s), relay.primal.net (0.8 s), relay.snort.social (0.7 s), nostr.mom (0.7 s); no sideways
scroll. The judges page then showed "5/5 relays" for its live check and still fit one screen (664 of 664 px). Result: ok.

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
