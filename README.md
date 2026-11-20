# Tambat

Bind a Bitcoin Cash address to a Nostr public key, publish the binding to Nostr relays, and let anyone verify it without
trusting a server.

Built for BCH BLAZE 2026, bounty "Decentralized Identity". New project, first commit after the 14 November start:
https://github.com/aimanmalib/tambat/commit/988ff7db24092061477503a63fe28fcbb866b92c. Live demo: https://tambat.sasateguh.com

- [Protocol specification](docs/SPEC.md): the protocol, the verification algorithm, sign-in and test vectors.
- [Verify it yourself](docs/VERIFY.md): check a binding with the command line or by hand.
- [NIP-39 `bch` platform draft](docs/NIP-39-bch.md): the claim format written up as a NIP-39 extension.
- [Wallet guide for Paytaca](docs/PAYTACA.md): how a wallet that holds a BIP39 phrase publishes a binding.
- [Measurements](docs/MEASURED.md): what was measured on real relays and the live site, failures included.
- [docs/decisions/](docs/decisions/): why each choice was made.
- [Demo video](https://tambat.sasateguh.com/video) ([`public/media/tambat-demo.mp4`](public/media/tambat-demo.mp4), 56 s, no sound,
  captions in the picture) and [event deck](https://tambat.sasateguh.com/deck.pdf) (`npx tsx tools/deck/build.ts`): the banner
  of every page links both, this repository and the team's BCH address (`config/tambat.json` `banner`, `video`).

## What it is

A person proves that one Bitcoin Cash key and one Nostr key are theirs by signing each with the other in mind:

- the BCH key signs the NIP-39 text `Verifying that I control the following Nostr public key: <npub>`;
- the Nostr key signs a NIP-39 identity event (kind `10011`) that carries `["i", "bch:q…", "<that signature>"]` (mainnet address without its prefix).

The event goes to ordinary public Nostr relays. Anyone can find it from the npub or from the address and check both signatures
locally. Apps can then use the binding: show a verified payment address for an npub, sign a user in with their Nostr key and
read their BCH address, or publish a `did:nostr` document that lists the address.

The parts:

- `src/core/`: the library. Write a binding, verify it step by step, discover it on relays, challenge and response sign-in,
  DID document, BIP21 payment links.
- `bin/tambat.ts`: a command-line verifier that needs no server of ours.
- `server/`: a small relying-app server (sign-in, DID documents, static files).
- `web/`: the web app, in English and Malay.

## Bounty requirements

Where each required part of the "Decentralized Identity" bounty lives:

The same map is one screen on the live site at https://tambat.sasateguh.com/judges, in English and Malay: it looks up the
demo identity on the relays when it opens and shows every check, links the Paytaca binding and a revoked link from
[the measurements](docs/MEASURED.md), names the Paytaca binding's anchor transaction in block 977901 and reads it again
from every chain server (a check mark only when they agree that the chain shows that transaction in that block, with the
number of servers that agreed), links the badge embed code, and opens each requirement and
judging criterion. Under the requirement each one proves it also links the relay measurements, the attestation as a
VC 2.0, the reputation file, the selective disclosure example, the phone pairing steps, the library package and its
`core-v0.2.0` release. `tests/judges-links.test.ts` fails when a linked file or heading is missing from the tree or the
release link is not the one this README installs from; `e2e/judges.spec.ts` holds the page to one screen at 1440 x 900
and on an iPhone 13 and checks that every internal link answers 200.

| Requirement | Code | Try it or read it |
| --- | --- | --- |
| Identity creation and management | `src/core/binding.ts` (create, revoke, rotate), `src/core/recover.ts` (recover a lost Nostr key), `src/node/manage.ts`, `web/pages/LinkPage.tsx`, `web/pages/OwnerActions.tsx`, `web/keys/` | **Link** on https://tambat.sasateguh.com; **Revoke this link** and **Move to a new address** on your own look-up result; [revocation measured](docs/MEASURED.md) |
| Cryptographic identity binding | `src/core/binding.ts`, `src/core/bchmsg.ts`, `src/core/verify.ts`, `src/core/tx-proof.ts` | [SPEC.md](docs/SPEC.md), [vectors](examples/vectors.json), [third-party vectors](examples/third-party-vectors.json), [bindings by other NIP-39 clients](docs/MEASURED.md#interoperability) |
| Decentralized discovery | `src/core/discover.ts`, `src/core/nip05.ts`, `src/core/publish.ts`, `web/pages/LookupPage.tsx` | **Look up** or **Pay** on the live site by npub, address or NIP-05 name (`demo@tambat.sasateguh.com`), the [one-file verifier](#one-file-verifier) at https://tambat.sasateguh.com/verify/, [the measurements](docs/MEASURED.md) |
| Verification and authentication | `src/core/verify.ts`, `src/core/auth.ts`, `src/core/auth-bch.ts`, `server/`, `bin/tambat.ts`, `verifier/` | **Demo app** on the live site: sign in with Nostr or with a BCH wallet only ([sign-in measured](docs/MEASURED.md)), [the verification guide](docs/VERIFY.md) |
| Working demonstration and documentation | `web/`, `deploy/`, `examples/` | https://tambat.sasateguh.com, this README, [docs/](docs/) |

| Judging criterion | Where to check it |
| --- | --- |
| Technical correctness | Every verification step is named and reported (`src/core/verify.ts`); `tests/verify.test.ts` and `tests/tamper.test.ts` check that each kind of bad input fails the step meant to catch it. Vectors from outside the project pass (`tests/third-party-vectors.test.ts`). |
| Security | `key_separation` refuses one key in both roles; sign-in nonces are single-use, short-lived and origin-bound (`tests/auth.test.ts`, `tests/server.test.ts`). See [the threat model](#security-and-threat-model). |
| Decentralization | Relays are untrusted stores and every reader verifies for itself. Look-ups in [the measurements](docs/MEASURED.md#lookup) were answered by two of the three relays then in use and still verified; Look up now lists which relays answered each query ([relays measured](docs/MEASURED.md#relays)). |
| Interoperability | NIP-39 kind 10011, the Bitcoin signed-message format, NIP-98, NIP-05, NIP-32 labels, `did:nostr`, BIP21. No new event kind. |
| Usability | English and Malay throughout; end-to-end tests run in Chromium and in WebKit on an iPhone 13 at 320 px and up; a binding signed with a Paytaca wallet over WalletConnect is in [the measurements](docs/MEASURED.md). |
| Demo quality | Live at https://tambat.sasateguh.com on public relays; [the measurements](docs/MEASURED.md) records each live reading, failures included. |

Beyond the required parts, each live and tested:

- Revoke and rotate a link, from the look-up page or the CLI ([revocation measured](docs/MEASURED.md#revocation)).
- Recover from a lost Nostr key with the BCH wallet ([recovery measured](docs/MEASURED.md#recovery)).
- Sign in to the demo app with a BCH wallet alone: https://tambat.sasateguh.com/demo ([sign-in measured](docs/MEASURED.md#sign-in)).
- Payment receipts checked on chain ([receipt measured](docs/MEASURED.md#receipt)) and attestations by other keys
  ([attestation measured](docs/MEASURED.md#attestation)).
- Attestations export as W3C Verifiable Credentials 2.0 with a `did:nostr` issuer
  ([example](examples/attestation-vc.json), [ADR 0017](docs/decisions/0017-attestation-verifiable-credential.md)):
  "Download as Verifiable Credential" on Look up, `tambat vc export`, and `tambat vc verify` or the one-file verifier to
  check one offline.
- A reputation summary on Look up ([SPEC](docs/SPEC.md#reputation-summary)): verified attestations, receipts the chain
  confirms, and "anchored since block N", each opening to its sources. A source that could not be read says so instead of 0,
  and there is no combined score. Live for the Paytaca key: https://tambat.sasateguh.com/lookup?q=npub16lxyujttr050u2a884r0xszc7wjjfzqkyy0u7qlh9ghmswcdkf3sascsuz
- A portable reputation file ([SPEC](docs/SPEC.md#portable-reputation), [example](examples/reputation-bundle.json)): a W3C
  Verifiable Presentation 2.0 that carries every counted attestation credential and the holder's binding. "Download
  reputation summary" on Look up or `tambat rep export <npub>` makes one; `tambat rep verify` or the one-file verifier
  recounts it offline and rejects a file whose claimed count differs from the recount.
- Selective disclosure ([SPEC](docs/SPEC.md#selective-disclosure), [example](examples/sd-presentation.json),
  [ADR 0019](docs/decisions/0019-selective-disclosure.md)): a holder issues a credential whose fields are salted digests and
  reveals only the BCH address, with its BCH signature for the holder's npub; the other fields stay hidden.
  `tambat sd issue|present|verify` and the one-file verifier ("3 of 4 fields hidden").
- An optional BCH anchor ([SPEC](docs/SPEC.md#optional-bch-anchor), [ADR 0008](docs/decisions/0008-optional-bch-anchor.md)):
  the Paytaca binding is anchored on BCH since block 977901, signed by the Paytaca wallet that holds the address
  ([anchor measured](docs/MEASURED.md#anchor)). `tambat anchor-lookup <address>` reads it from the chain alone, no relays.
  Transaction and event ids are shortened in the middle on screen, with the full id in the tooltip and a copy button.
- Revoke by transaction, chain first ([SPEC](docs/SPEC.md#revoke-by-transaction),
  [ADR 0013](docs/decisions/0013-revoke-by-transaction.md)): the owner's wallet can revoke an anchored link with the same
  OP_RETURN format and a revoke type byte. The newest confirmed commitment decides (bound, revoked, conflict or none), Look up
  shows it, and Pay refuses an address the chain revoked or gave to another key. Tested against a simulated chain
  (`tests/chain-status.test.ts`, `e2e/chain-status.spec.ts`).
- Chain reads need agreement ([ADR 0014](docs/decisions/0014-chain-quorum.md)): commitments are read from every Fulcrum
  server in `config/tambat.json` at once and count only when at least `anchor.quorum` (2) answer alike and none answers
  differently; otherwise the result is unknown and the servers that differed or did not answer are named. Look up, the
  judges page and `tambat anchor-lookup` show how many servers agreed. Tested with fake servers
  (`tests/chain-quorum.test.ts`, `e2e/chain-status.spec.ts`, `e2e/judges.spec.ts`); the live reading is in [anchor measured](docs/MEASURED.md#anchor).
- A wall of verified links read from the relays, paging back past identity events of other platforms, that keeps itself current: an open relay subscription adds new bindings and every `wall.refreshSeconds` (30) the relays are checked again while the tab is visible; a strip above it counts verified, anchored, on-chain proofs, attestations, relays answering and the latest anchor block from the page's own reads, a dash where nothing was read (`tests/wall-live.test.ts`, `e2e/wall.spec.ts`): https://tambat.sasateguh.com/wall ([wall measured](docs/MEASURED.md#wall), [ADR 0022](docs/decisions/0022-live-wall.md)).
- Which relays answered: Look up, the wall and the judges page list every relay in `config/tambat.json` (five public relays)
  as answered, refused or no answer, with the time of each answer, taken from the sockets of that look-up itself
  (`src/core/relay-watch.ts`; `tests/relay-watch.test.ts` with one relay refusing the handshake with 503 and one staying
  silent; `e2e/relays.spec.ts`; [relays measured](docs/MEASURED.md#relays)). Publishing shows each relay's answer time too.
- "Anchored since block N" on wall entries and on Pay, shown only when the chain servers agree that the address is still
  bound to that key; the wall reads the chain only for entries on screen or within `wall.sinceRootMargin` of it (one screen
  below the fold, so on a phone the entries you scroll to next already carry their badge), `wall.chainConcurrency` at a
  time, each entry once, and a failed read shows no badge rather than an error (`tests/since.test.ts`, `e2e/since.spec.ts`
  in WebKit on an iPhone 13 and Chromium, [ADR 0016](docs/decisions/0016-wall-badge-read-margin.md)).
- An installable library, `@tambat/core`, kept in this repository as a tarball with a checksum file (not on the npm
  registry): see [Use the library](#use-the-library) and [check the package](docs/VERIFY.md#the-library-package).
- A pairing link that can be copied into a phone wallet on the same phone, shown above the QR code on a narrow screen
  (`e2e/wc-pairing.spec.ts` in WebKit on an iPhone 13 and Chromium; [steps](docs/PAYTACA.md#on-an-iphone)).
- A NIP-05 name for the demo identity, an [embeddable badge](#embeddable-badge), a [one-file verifier](#one-file-verifier)
  and a "Try tampering" demo on every verified look-up.

## Demo in 60 seconds

1. Open https://tambat.sasateguh.com. The first card is a real binding: the first of `hero.candidates` (`config/tambat.json`)
   whose newest binding passes and is written `bch:q…` (the owner's Paytaca binding, else this project's demo key; the card says
   which signed it). The browser checks the Nostr signature, the BCH signature, that the signer owns the address, then the BCH
   commitment; each mark appears only when its check returns, a failed step is named (`src/core/hero-check.ts`, `e2e/hero.spec.ts`).
   Tapping the card opens the full check in Look up. **Link**, below it: connect a Nostr key (a NIP-07 extension, a NIP-46 remote signer, or "Use a
   demo key"), then a BCH key (Paytaca over WalletConnect, a WizardConnect wallet, a signature pasted from any wallet with
   "Sign message", or a demo key). On a phone, the pairing link can be copied into a phone wallet ([steps](docs/PAYTACA.md#on-an-iphone)).
2. Sign. The page runs every verification step on the event before you publish, then publishes to the five public relays and shows
   which ones accepted it and how fast.
3. **Look up**: paste the npub, the address or a NIP-05 name such as `demo@tambat.sasateguh.com`. The browser asks the relays and verifies the result itself: the step list, the
   signed event and the DID document.
   **Try tampering** on a verified result edits one field of a local copy (content, the BCH address in the `i` tag, or the Nostr
   signature) and checks it again, showing which named steps catch the edit (`src/core/tamper.ts`). Nothing is published.
   **Embed this badge** on the same result gives the script tag and the iframe for that identity, each with a copy button.
4. **Pay**: an npub or a NIP-05 name becomes a verified address, a BIP21 link and a QR code. Your own wallet sends the payment.
   Pay reads the chain first: it shows "Anchored since block N" when the chain servers agree the address is still bound to that
   key, and refuses to offer a link when the chain shows the address revoked or bound to another key.
5. **Demo app**: "Sign in with Nostr", or "Sign in with a BCH wallet" (Paytaca over WalletConnect, or a signature pasted from
   any wallet). The demo app's server checks the signed challenge, finds the binding on relays on its own, and the session shows
   the npub and the verified BCH address. Signing in with the wallet alone works because the binding leads from the address
   to the Nostr key.

A binding made with a demo key is already on the public relays; its npub, address and event id are in
[the measurements](docs/MEASURED.md). Try **Look up** with either.

## Architecture

```
  BCH wallet                      Nostr signer
  (Paytaca via WalletConnect,     (NIP-07 extension,
   Electron Cash, demo key)        NIP-46, demo key)
        |  signed message               |  kind 10011 event
        v                               v
  +-------------------- web app (browser) ---------------------+
  |  Link: build text, collect both signatures, verify, publish |
  |  Look up / Pay: query relays, verify locally               |
  +--------------------------+---------------------------------+
                             | publish / query (WebSocket)
                             v
        +-----------+  +-----------+  +-----------+
        |  relay A  |  |  relay B  |  |  relay C  |   untrusted stores
        +-----------+  +-----------+  +-----------+
              ^                ^                ^
              | query          | query          | query
   +----------+-------+  +-----+---------+  +---+--------------+
   | relying app      |  | tambat CLI    |  | any NIP-39 aware |
   | server: sign-in, |  | (verify,      |  | client           |
   | DID document     |  | lookup)       |  |                  |
   +------------------+  +---------------+  +------------------+
```

Private keys stay in the wallet, the signer or the open browser tab. The server never receives a key and never tells a client
which address is bound: every reader checks the event itself.

Payment receipts also read BCH transactions from public Fulcrum servers listed in `config/tambat.json`. That access is
read-only: the server and the web app never broadcast a transaction; a wallet does.

## How verification works

For each event a verifier runs named steps and reports `pass`, `fail` or `skip` with a reason ([specification](docs/SPEC.md)
section 5):

1. `event_shape`, `kind`: a NIP-01 event of kind `10011`.
2. `event_id`: the id is the hash of the event fields, so nothing was edited after signing.
3. `nostr_sig`: the Schnorr signature is valid for the author.
4. `newest`: no newer kind `10011` event from the author exists on the relays asked. A newer event without the `bch:` tag is a
   revocation.
5. For each `bch:` claim, `bch_sig`: a public key is recovered from the BCH signature over the text built from the author's
   own npub. A signature copied into someone else's event recovers a different key.
6. `address_match`: that key is the key of the claimed address.
7. `network`: the address is on the expected network.
8. `key_separation`: the BCH key is not the Nostr key.

A look-up by address asks relays for events tagged with the address, then for each author re-reads the newest event and keeps
the author only when that event still claims the address and verifies.

Bindings written by any client that follows NIP-39 are read the same way ([read forms](docs/NIP-39-bch.md#read-forms), [ADR 0024](docs/decisions/0024-claim-write-form.md)). Some write
`bitcoincash:q…` as the platform, the earlier `bch:bitcoincash:q…`, a bare txid, or the signature as `msg:<base64>`; some prove the address with a transaction instead of a signed message (`tx:<txid>`: the
transaction spends from the address and carries the same text in an OP_RETURN output). For those, Look up, the wall and the
CLI read the transaction from the chain servers, keep it only when they agree, run it through the BCH virtual machine with
the outputs it spends and compare the OP_RETURN with the text for the author's npub (steps `tx_found`, `address_match`,
`tx_text`; [SPEC](docs/SPEC.md) section 4, [ADR 0021](docs/decisions/0021-tx-proof.md)). Each result is labelled "Signed
message" or "On-chain proof". On 2026-11-20 Tambat verified 12 of 13 newest bindings by other clients on the default relays
(the 13th is on chipnet), and the demo binding was verified by 1 of 4 independent NIP-39 verifiers; the other three take only an on-chain proof ([measured](docs/MEASURED.md#interoperability), `tests/tx-proof-interop.test.ts`, `tests/interop-write.test.ts`).

## Command-line verifier

```
npx tsx bin/tambat.ts text <npub>                # the exact text the BCH wallet signs
npx tsx bin/tambat.ts verify examples/binding-event.json
npx tsx bin/tambat.ts lookup <npub|bitcoincash:...> [--json]
npx tsx bin/tambat.ts revoke <bitcoincash:...> [--keys <file>]        # remove this address from your binding
npx tsx bin/tambat.ts rotate <old address> <new address> [--keys <file>]   # move the binding in one event
npx tsx bin/tambat.ts recover <old npub> --keys <new key file> --bch-keys <wallet file>   # lost Nostr key: hand the binding to a new key
npx tsx bin/tambat.ts receipt <txid> [--json]                        # payment receipts for a BCH transaction, checked on chain
npx tsx bin/tambat.ts receipt-publish <payee npub> <txid> [--keys <file>]   # publish a receipt for a payment you made
npx tsx bin/tambat.ts attest <npub> [--keys <file>]                  # attest another key's current binding
npx tsx bin/tambat.ts attestations <npub> [--json]                   # attestations that still count
npx tsx bin/tambat.ts vc export <attestation id|file> [--binding <file>]  # attestation as a W3C VC 2.0
npx tsx bin/tambat.ts vc verify examples/attestation-vc.json         # check a credential offline
```

`verify` works offline. `lookup` asks the relays in `config/tambat.json` and verifies every event they return. Exit code 0 means
verified, 1 not verified, 2 a usage error. Test vectors from the public BIP39 phrase `abandon ... about` are in
[examples/vectors.json](examples/vectors.json). The core code also passes vectors from outside this project, pinned to a
commit with their license in [examples/third-party-vectors.json](examples/third-party-vectors.json): BIP-340, the CashAddr
specification and Electron Cash signed messages. [examples/paytaca-binding.ts](examples/paytaca-binding.ts) writes a binding
from a phrase with only `@bitauth/libauth` and `nostr-tools`.

`revoke` and `rotate` sign with keys derived from a BIP39 phrase file (`{ "phrase": "..." }`, default `cli.keysFile` in the
config, never tracked), on the paths a phrase wallet uses. `rotate` looks for the new address among the first
`cli.addressSearchLimit` receiving addresses of that wallet and signs it fresh. Both publish one event that replaces the current
binding, keep other identity tags, and print each relay's answer; nothing secret is printed. `recover` is for a lost Nostr key:
the wallet that holds the bound address signs `replaces <old npub>`, and the new key (from `--keys`) publishes a binding for that
address with the signature in a `replaces` tag ([SPEC](docs/SPEC.md#recovery-from-a-lost-nostr-key),
[ADR 0009](docs/decisions/0009-recovery-tag.md)). Look-ups then show "Recovered from <old npub>" on the new key, and an address
look-up marks the old key as moved. A recovery of the demo identity on the public relays is in [the measurements](docs/MEASURED.md#recovery).

After paying an identity, the payer can publish a receipt: a NIP-32 label (kind 1985) naming the paid key and the
transaction as a NIP-73 id `bitcoincash:tx:<txid>` ([SPEC](docs/SPEC.md#payment-receipts),
[ADR 0010](docs/decisions/0010-payment-receipts.md)). The **Pay** page and `tambat receipt` read the transaction from a chain
server and say "from a bound address" only when every input spends from an address bound to the receipt's author; otherwise
"payer not proven". A receipt published on the public relays is in [the measurements](docs/MEASURED.md#receipt).

Another key can attest a binding: `tambat attest <npub>` publishes a NIP-32 label (kind 1985) that names the subject key and
pins the id of its current binding event ([SPEC](docs/SPEC.md#attestations),
[ADR 0011](docs/decisions/0011-attestations.md)). The look-up page and `tambat attestations` list only attestations of the
current binding: once the subject rotates, recovers, revokes or publishes any newer binding, older attestations no longer
count. An attestation is the attester's word, not a proof. One published on the public relays is in
[the measurements](docs/MEASURED.md#attestation).

An attestation also exports as a W3C Verifiable Credential 2.0 ([ADR 0017](docs/decisions/0017-attestation-verifiable-credential.md)):
issuer `did:nostr:<attester>`, subject `did:nostr:<subject>` with its BCH addresses, and a proof that carries the signed
attestation and binding events. `tambat vc verify` and the one-file verifier check both events and that every field is what
they say, compared as RFC 8785 canonical JSON, with no JSON-LD processing and nothing fetched. Offline it shows who attested
which binding and when, not whether that binding is still current.

`tambat rep export <npub|nprofile> --out file.json` bundles those credentials into one portable reputation file
([SPEC](docs/SPEC.md#portable-reputation)). `tambat rep verify file.json` checks every credential again and recounts: one
per issuer, only attestations of the named binding, never the holder's own; a file that claims more than that is rejected.
`--chain` also reads the chain to check the claimed "anchored since" block.

`tambat sd issue --keys <file> --out mine.json` makes a selective disclosure credential from the holder's binding with
every field disclosed; it stays with the holder. `tambat sd present mine.json --reveal bchAddress --out share.json` keeps
only the address, and `tambat sd verify share.json` checks it offline and counts the hidden fields
([SPEC](docs/SPEC.md#selective-disclosure)).

## Use the library

The code that writes, finds and verifies bindings (`src/core`) is also an installable package, `@tambat/core`
(ESM, TypeScript types, MIT). It is not on the npm registry: the tarball and a `SHA256SUMS` file are attached to the
[`core-v0.2.0` release](https://github.com/aimanmalib/tambat/releases/tag/core-v0.2.0) and kept in this repository at
[`docs/pkg/`](docs/pkg/), built by `npx tsx scripts/pack-core.ts` with tsc from `src/core`
([release notes](docs/pkg/RELEASE-NOTES.md)).

```sh
curl -LO https://github.com/aimanmalib/tambat/releases/download/core-v0.2.0/tambat-core-0.2.0.tgz
curl -LO https://github.com/aimanmalib/tambat/releases/download/core-v0.2.0/SHA256SUMS
sha256sum -c SHA256SUMS                       # or in docs/pkg/ of a clone
npm install ./tambat-core-0.2.0.tgz
```

- [`examples/core-nostr-client.ts`](examples/core-nostr-client.ts): a Nostr client checks that an npub is bound to a
  BCH address (`verifyBinding`, or `lookupByPubkey` against relays).
- [`examples/core-wallet.ts`](examples/core-wallet.ts): a wallet builds the verification text and the unsigned kind
  10011 event from its address and the user's npub.

Relays, network, kinds and timeouts start from the values the package was built with; `configure({ ... })` changes
them and rejects a bad value. `tests/core-package.test.ts` installs the tracked tarball into an empty folder and runs
both examples against it.

## Server

```
npm start
```

Serves the built web app when `dist/` exists (`npm run build`) and:

- `POST /api/rp/challenge`, `POST /api/rp/login`, `GET /api/rp/session`, `POST /api/rp/logout`: challenge and response sign-in
  with a NIP-98 event. The server finds the user's binding on relays itself and puts the verified BCH address in the session.
  `GET /api/rp/session` answers `{"session": null}` with status 200 when nobody is signed in, so the demo page loads without a
  refused request; a sign-in without a valid fresh signature is refused with 401.
- `GET /api/did/<npub>`: a `did:nostr` document with the verified BCH address as a CAIP-10 account.
- `GET /.well-known/nostr.json?name=<name>`: NIP-05 for the one demo name in `config/tambat.json` (`nip05.names`), readable
  from any origin. Other names get an empty list; the site is not a name service.
- `GET /embed/<npub or address>` and `GET /embed.js`: the [embeddable badge](#embeddable-badge).
- `GET /healthz`.

Limits, origins, relays and the Content-Security-Policy are in `config/tambat.json`.

## Security and threat model

What a verified binding proves: when the event was signed, whoever signed it held both private keys. Nothing more.

| Threat | What stops it |
|---|---|
| Someone claims your address for their npub | They cannot make a signature that recovers to your key over the text for their npub. |
| Someone copies your signature into their own event | The text is built from the event author, so the signature recovers a different key (`address_match` fails). |
| A relay edits or forges an event | `event_id` and `nostr_sig` fail. |
| A relay hides the newest event (for example a revocation) | Ask several relays; `newest` uses every result. A relay can only withhold, not forge, so one honest relay is enough. |
| A relay serves an old event after a revocation | Look-up by address re-reads the author's newest event and drops the author when it no longer claims the address. |
| A NIP-05 domain points a name at someone else's key | The name only leads to a key. The address still comes from that key's own signed binding, the page shows which npub the name led to, and redirects are refused. |
| A test-network address passed off as mainnet | `network` fails. |
| A lost Nostr key | The bound BCH key signs `replaces <old npub>` for a new key; the recovery is accepted only while the old key's newest binding still claims the address, and a copied recovery tag fails because the copier cannot sign its own claim for that address. |
| One key used for both roles | `key_separation` fails, so a leak of one role's key is not a leak of both. |
| A replayed or cross-site sign-in | Nonces are random, single-use, short-lived and bound to the origin; the NIP-98 event names the login URL and method, and the BCH challenge text names the origin. |
| Signing in with someone else's address | A BCH-only sign-in must recover to the key of the address before any relay is asked; the Nostr key then comes from the server's own look-up, and a missing or revoked link refuses the sign-in. |
| Injected script or style in the web app | The pages send `script-src 'self'` and `style-src 'self'` with no `'unsafe-inline'`; every page is loaded in Chromium and WebKit and any policy violation fails the test (`e2e/csp.spec.ts`, and against the deployed site in `e2e/live.spec.ts`). |
| A compromised demo server | It cannot change what a verifier sees: the browser, the CLI and any other client verify relay data themselves. It could lie in its own sessions only. |

Not covered: a stolen key (the thief can publish a new binding; see known limits), a person who controls both keys on purpose
for someone else, and relays that all withhold an event. The sign-in server keeps nonces and sessions in memory; a restart signs
everyone out.

## One-file verifier

`tambat-verify.html` is the whole verifier in one HTML file: scripts, styles and the secp256k1 WebAssembly are inline. Paste a
signed kind 10011 event to check it on your device, or enter an npub or a BCH address to fetch the newest binding from relays
you can edit. It runs the same checks as the app and the CLI (`src/core/`) and talks only to those relays: its own
Content-Security-Policy allows no connection except `ws:` and `wss:`, so it works when opened from disk and never calls this
site. Open it at https://tambat.sasateguh.com/verify/ or download it from there.

SHA-256 of `tambat-verify.html` built from this commit:

```
9f60d5c6826215a0743d2bac13c67cbe1b5358d173037fa3148b7aedaef8cf7a  tambat-verify.html
```

To check a copy, rebuild it and compare: `npm ci && npm run build:verifier` prints the hash of `dist-verifier/tambat-verify.html`;
`sha256sum` on a downloaded copy must print the same value (the site also serves it at `/verify/tambat-verify.html.sha256`).
Two builds of the same commit give the same bytes, and a test fails when this hash no longer matches the build
(`tests/verifier-build.test.ts`). `e2e/verifier.spec.ts` opens the file from `file://` in Chromium and WebKit and fails on any
request that is not the file itself.

## Embeddable badge

Any page can show whether an identity is linked, checked in the visitor's browser. Every verified result in
[Look up](https://tambat.sasateguh.com/lookup?q=npub18yklrtcpe34drm9t4pu8nfytlwqy30clje05ue8j0298v3quqn6qh8pfwt&embed=1)
has an "Embed this badge" panel with both snippets for that identity and a copy button for each; /judges links to it.

```html
<script src="https://tambat.sasateguh.com/embed.js" data-tambat-id="npub18yklrtcpe34drm9t4pu8nfytlwqy30clje05ue8j0298v3quqn6qh8pfwt" data-lang="en" async></script>
<iframe src="https://tambat.sasateguh.com/embed/npub18yklrtcpe34drm9t4pu8nfytlwqy30clje05ue8j0298v3quqn6qh8pfwt?lang=ms" width="320" height="96" title="Tambat identity badge" style="border:0"></iframe>
```

Use the script tag or the iframe; `data-tambat-id` (or the path after `/embed/`) takes an npub, a hex key or a BCH
address, and `lang` is `en` or `ms`. The badge is a 320 by 96 frame that looks the identity up on the relays in
`config/tambat.json` and verifies every event with the same code as Look up (`src/core/badge.ts`). It shows one of four
states: linked (short npub and address), no verified link, relays unreachable (no relay answered, checked separately so an
outage never reads as "not linked"), or not an npub or address. Only `/embed/` may be framed by other sites
(`embed.frameAncestors` in the config); every other page keeps `frame-ancestors 'none'`. Tested by
`tests/badge.test.ts`, `tests/server-embed.test.ts`, `tests/embed-code.test.ts` (the offered snippets point at routes
the server answers) and `e2e/embed.spec.ts` (a page on another origin embeds both forms, including the code copied from Look up).

## Decentralisation

- Relays are untrusted, interchangeable stores. The default list is five public relays in `config/tambat.json`; any NIP-01
  relay works, and users can publish to their own.
- Verification needs only the event and the public algorithm. The CLI, the browser, the server and the
  [one-file verifier](#one-file-verifier) each check independently;
  [the verification guide](docs/VERIFY.md) shows the same checks with a wallet's "Verify message" and `jq`.
- The binding uses existing open formats: NIP-39 identity events, the Bitcoin signed-message format that wallets already
  produce, NIP-98 for sign-in, `did:nostr` and CAIP-10 for the DID document, BIP21 for payments. No new event kind, no registry,
  no token.
- The demo server is one relying app among any number. Nothing it holds is needed to verify a binding.

## Known limits and next steps

- **Paytaca over WalletConnect** (`bch_signMessage`) has been used once with a real Paytaca wallet, recorded in
  [the measurements](docs/MEASURED.md). The app's WalletConnect calls are tested end to end against a fake wallet that answers
  the way Paytaca does (`e2e/paytaca-login.spec.ts`, and `e2e/wc-pairing.spec.ts` for the copied pairing link), but the
  WalletConnect relay network and a real phone wallet are not covered by automated tests; pasting the pairing link into
  Paytaca on an iPhone has not been measured. The paste path and the signature format are tested.
- **Recovery** covers a lost Nostr key, not a stolen one: a thief holding the old key can publish a newer event without the
  claim, and the recovery then fails its `old_binding` step. Publishing a recovery is a CLI command (`tambat recover`); the web
  app shows recoveries but has no form to make one.
- **One address per Nostr key**, P2PKH only. Multisig and P2SH addresses cannot sign a message; CashTokens are not covered.
- **Attestations** are one label ("verified") with no score, expiry or reason; the web app shows them but publishing one is a
  CLI command (`tambat attest`).
- **Reputation** is three separate counts with no score, and they are lower bounds: only what the queried relays hold is
  counted, and nothing shows whether attesting or paying keys are distinct people. The portable reputation file covers attestations
  only; offline it cannot show whether a newer binding replaced the one it names, and its anchor block stays a claim
  until checked with `tambat rep verify --chain`.
- **Selective disclosure** uses salted digests, not zero-knowledge proofs: a revealed value is seen as it is, presentations
  of one credential can be linked by its proof signature, and no holder signature binds a presentation to one recipient.
  The public binding already shows the address; the hiding applies to credentials handed out privately. "SD-JWT style",
  not SD-JWT; no JWT is made.
- **Identity**: a binding says two keys belong together, not who the person is.
- **Privacy**: a binding is public by design and links a payment address to a social identity. Users who want unlinkable
  payments should bind a separate address.
- **NIP-05 names** depend on the domain that serves them: if it is down, or does not let browsers read its file, a name
  cannot be looked up (the npub still can). The one-file verifier takes npubs and addresses only, since it talks to relays
  and nothing else.
- **The badge** is served by this site and checks in the visitor's browser, so a host page trusts this site for the badge
  code (not for the result, which comes from relays). Sites that want no such dependency can run the CLI or the one-file
  verifier themselves.
- **Optional BCH anchor**: one anchor exists, for the Paytaca binding, made by its owner. The demo address holds no coins, so the
  demo key has no anchor and no on-chain proof. The wallet request (`bch_signTransaction`) is tested against a fake wallet only;
  revoke by transaction is tested against a simulated chain only, and no revocation has been sent on mainnet.
- **WizardConnect** wallets sign a proof transaction ([ADR 0023](docs/decisions/0023-wizardconnect-transaction-proof.md)); not yet tested with a wallet, as the test needs a funded address.
- **Other NIP-39 verifiers**: three of the four measured take only an on-chain proof, so they do not read the demo binding yet,
  and none reads the Paytaca binding, which is in the earlier prefixed form ([measured](docs/MEASURED.md#interoperability)).
- **On-chain proofs** (`tx:<txid>`), from other clients or the WizardConnect option, need the chain: the one-file verifier
  and the server's sign-in do not read it, so there such a claim shows as not checked and does not pass. The released
  library `core-v0.2.0` predates them and checks signed-message proofs only; it also writes the prefixed form and does not read `bitcoincash:` tags.
- **Credentials** carry the signed attestation and binding events as their proof, not a Data Integrity proof, so a
  generic VC verifier cannot check them; `tambat vc verify` and the one-file verifier can. The official W3C test suite was
  not run ([ADR 0017](docs/decisions/0017-attestation-verifiable-credential.md)).
- **The library** is a tarball in this repository, also attached to a GitHub release with its checksums; it is not a
  package on the npm registry.
- **Single sign-in instance**: nonces and sessions live in memory, so more than one server process needs a shared store.

## Web app

English by default with a Malay toggle; all text is in `lang/en.json` and `lang/ms.json`.

- **Home** (`/`) opens with the live check of the owner's Paytaca binding described in the demo above; the **Link** form follows it
  (on a phone, below the first screen).
- **Link** (`/`), **Look up** (`/lookup`), **Wall** (`/wall`), **Demo app** (`/demo`) and **Pay** (`/pay`) as in the demo above.
- The demo app only talks to `/api/rp/*`; its server checks the signed challenge and reads the binding from relays on its own.
  It offers two ways in: a Nostr key, or a BCH wallet alone (the server finds the Nostr key linked to the address).
- When the connected Nostr key is the author of a look-up result, the result offers **Revoke this link** (with a confirm
  step) and **Move to a new address** (the Link page signs the new address and publishes one replacing event). A key whose
  newest event carries no BCH address shows "no current BCH link".
- **Wall** (`/wall`) asks the relays for the newest kind 10011 events (`wall.limit` in the config), keeps those that name a
  BCH address, and verifies each one in the browser with the same steps as Look up (`src/core/wall.ts`). Only bindings
  that pass every step are listed, with a link to Look up; the rest are never shown, only counted as "hidden: failed
  verification". The query keeps events with a bad signature so they are counted rather than silently dropped. Tested by
  `tests/wall.test.ts` and `e2e/wall.spec.ts` (a fake relay holding one genuine event and one with a forged signature).
- Demo keys live in memory for the open tab only.
- **Look up** and **Pay** also take a NIP-05 name (`name@domain`): the browser asks the domain for the key, then verifies
  that key's binding on the relays and says which npub the name led to.
- **Verify** (`/verify/`) is the [one-file verifier](#one-file-verifier), linked from Look up with a download link.

## Development

Node 22, npm.

```
npm ci
npm test
npm run build && npm run e2e   # Chromium desktop and WebKit iPhone 13
npm run gate                   # lint, types, unit tests, build, end-to-end tests
```

End-to-end tests run the real server against an in-memory relay (`e2e/fake-relay.ts`); the page's relay connections are routed
to it, and a NIP-07 extension is faked with the key from the public test phrase. They check
accessibility (axe, WCAG 2.1 AA), console errors and horizontal overflow at 320 px.

## Deployment

One container behind a reverse proxy: see [docs/decisions/0004-deploy-and-headers.md](docs/decisions/0004-deploy-and-headers.md).
Copy `deploy/hos.env.example` to `deploy/hos.env`, then `deploy/deploy.sh` (build from a clean `git archive`, run, check the
public `/healthz` and run `e2e/live.spec.ts` against the public URL), `deploy/deploy.sh --rollback` or `deploy/deploy.sh --status`.
The read-only live checks also run by hand: `E2E_BASE_URL=https://your.host npx playwright test`.

`scripts/demo-binding.ts` makes a demo identity, publishes its binding and signs in to a deployed demo app through the API.

## Third-party licenses

- `nostr-tools`: Unlicense.
- `@bitauth/libauth`, `@noble/curves`, `@electrum-cash/network`, `@electrum-cash/web-socket`, `qrcode-generator`, `fastify`,
  `@fastify/cookie`, `@fastify/static`, `react`, `react-dom`, `ws`, `tsx`, `lossless-json`, `eventemitter3`, `isomorphic-ws`, `@bch-wc2/interfaces`: MIT.
- `@walletconnect/sign-client` 2.21.8 with `@walletconnect/core`, `types`, `utils` 2.21.8: Apache-2.0. Later versions use a
  non-OSI licence, so this version is pinned. See [docs/decisions/0001-protocol.md](docs/decisions/0001-protocol.md).
- `@wizardconnect/core` 0.2.11, `@wizardconnect/dapp` 0.2.8: LGPL-3.0-or-later, unmodified, loaded only by the WizardConnect option.

## AI disclosure

The code and documents in this repository were written by an AI coding agent. The owner chose the problem, set the scope and
reviews the work.

## License

MIT. See [LICENSE](LICENSE).
