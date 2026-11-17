# Tambat

Bind a Bitcoin Cash address to a Nostr public key, publish the binding to Nostr relays, and let anyone verify it without
trusting a server.

Built for BCH BLAZE 2026, bounty "Decentralized Identity".

Live demo: https://tambat.sasateguh.com

- [Protocol specification](docs/SPEC.md): the protocol, the verification algorithm, sign-in and test vectors.
- [Verify it yourself](docs/VERIFY.md): check a binding with the command line or by hand.
- [Wallet guide for Paytaca](docs/PAYTACA.md): how a wallet that holds a BIP39 phrase publishes a binding.
- [Measurements](docs/MEASURED.md): what was measured on real relays and the live site, failures included.
- [docs/decisions/](docs/decisions/): why each choice was made.

## What it is

A person proves that one Bitcoin Cash key and one Nostr key are theirs by signing each with the other in mind:

- the BCH key signs the NIP-39 text `Verifying that I control the following Nostr public key: <npub>`;
- the Nostr key signs a NIP-39 identity event (kind `10011`) that carries `["i", "bch:<cashaddr>", "<that signature>"]`.

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

| Requirement | Code | Try it or read it |
| --- | --- | --- |
| Identity creation and management | `src/core/binding.ts` (create, revoke, rotate), `src/node/manage.ts`, `web/pages/LinkPage.tsx`, `web/pages/OwnerActions.tsx`, `web/keys/` | **Link** on https://tambat.sasateguh.com; **Revoke this link** and **Move to a new address** on your own look-up result; [revocation measured](docs/MEASURED.md) |
| Cryptographic identity binding | `src/core/binding.ts`, `src/core/bchmsg.ts`, `src/core/verify.ts` | [SPEC.md](docs/SPEC.md), [vectors](examples/vectors.json) |
| Decentralized discovery | `src/core/discover.ts`, `src/core/nip05.ts`, `src/core/publish.ts`, `web/pages/LookupPage.tsx` | **Look up** or **Pay** on the live site by npub, address or NIP-05 name (`demo@tambat.sasateguh.com`), the [one-file verifier](#one-file-verifier) at https://tambat.sasateguh.com/verify/, [MEASURED.md](docs/MEASURED.md) |
| Verification and authentication | `src/core/verify.ts`, `src/core/auth.ts`, `src/core/auth-bch.ts`, `server/`, `bin/tambat.ts`, `verifier/` | **Demo app** on the live site: sign in with Nostr or with a BCH wallet only ([sign-in measured](docs/MEASURED.md)), [VERIFY.md](docs/VERIFY.md) |
| Working demonstration and documentation | `web/`, `deploy/`, `examples/` | https://tambat.sasateguh.com, this README, [docs/](docs/) |

## Demo in 60 seconds

1. Open https://tambat.sasateguh.com. **Link**: connect a Nostr key (a NIP-07 extension, a NIP-46 remote signer, or "Use a
   demo key"), then a BCH key (Paytaca over WalletConnect, a signature pasted from any wallet with "Sign message", or a demo key).
2. Sign. The page runs every verification step on the event before you publish, then publishes to three public relays and shows
   which ones accepted it.
3. **Look up**: paste the npub, the address or a NIP-05 name such as `demo@tambat.sasateguh.com`. The browser asks the relays and verifies the result itself: the step list, the
   signed event and the DID document.
4. **Pay**: an npub or a NIP-05 name becomes a verified address, a BIP21 link and a QR code. Your own wallet sends the payment.
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

## Command-line verifier

```
npx tsx bin/tambat.ts text <npub>                # the exact text the BCH wallet signs
npx tsx bin/tambat.ts verify examples/binding-event.json
npx tsx bin/tambat.ts lookup <npub|bitcoincash:...> [--json]
npx tsx bin/tambat.ts revoke <bitcoincash:...> [--keys <file>]        # remove this address from your binding
npx tsx bin/tambat.ts rotate <old address> <new address> [--keys <file>]   # move the binding in one event
```

`verify` works offline. `lookup` asks the relays in `config/tambat.json` and verifies every event they return. Exit code 0 means
verified, 1 not verified, 2 a usage error. Test vectors from the public BIP39 phrase `abandon ... about` are in
[examples/vectors.json](examples/vectors.json). [examples/paytaca-binding.ts](examples/paytaca-binding.ts) writes a binding
from a phrase with only `@bitauth/libauth` and `nostr-tools`.

`revoke` and `rotate` sign with keys derived from a BIP39 phrase file (`{ "phrase": "..." }`, default `cli.keysFile` in the
config, never tracked), on the paths a phrase wallet uses. `rotate` looks for the new address among the first
`cli.addressSearchLimit` receiving addresses of that wallet and signs it fresh. Both publish one event that replaces the current
binding, keep other identity tags, and print each relay's answer; nothing secret is printed.

## Server

```
npm start
```

Serves the built web app when `dist/` exists (`npm run build`) and:

- `POST /api/rp/challenge`, `POST /api/rp/login`, `GET /api/rp/session`, `POST /api/rp/logout`: challenge and response sign-in
  with a NIP-98 event. The server finds the user's binding on relays itself and puts the verified BCH address in the session.
- `GET /api/did/<npub>`: a `did:nostr` document with the verified BCH address as a CAIP-10 account.
- `GET /.well-known/nostr.json?name=<name>`: NIP-05 for the one demo name in `config/tambat.json` (`nip05.names`), readable
  from any origin. Other names get an empty list; the site is not a name service.
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
| One key used for both roles | `key_separation` fails, so a leak of one role's key is not a leak of both. |
| A replayed or cross-site sign-in | Nonces are random, single-use, short-lived and bound to the origin; the NIP-98 event names the login URL and method, and the BCH challenge text names the origin. |
| Signing in with someone else's address | A BCH-only sign-in must recover to the key of the address before any relay is asked; the Nostr key then comes from the server's own look-up, and a missing or revoked link refuses the sign-in. |
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
6a3b5c54cc8b800bccac1bbf6395eb0d9596cb21bebb397287170cf2e25e8076  tambat-verify.html
```

To check a copy, rebuild it and compare: `npm ci && npm run build:verifier` prints the hash of `dist-verifier/tambat-verify.html`;
`sha256sum` on a downloaded copy must print the same value (the site also serves it at `/verify/tambat-verify.html.sha256`).
Two builds of the same commit give the same bytes, and a test fails when this hash no longer matches the build
(`tests/verifier-build.test.ts`). `e2e/verifier.spec.ts` opens the file from `file://` in Chromium and WebKit and fails on any
request that is not the file itself.

## Decentralisation

- Relays are untrusted, interchangeable stores. The default list is three public relays in `config/tambat.json`; any NIP-01
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
  the way Paytaca does (`e2e/paytaca-login.spec.ts`), but the WalletConnect relay network and a real phone wallet are
  not covered by automated tests. The paste path and the signature format are tested.
- **Recovery**: a lost Nostr key cannot revoke or move its binding; a stolen one can. A future version could require a BCH
  signature over a revocation, or a time-locked handover.
- **One address per Nostr key**, P2PKH only. Multisig and P2SH addresses cannot sign a message; CashTokens are not covered.
- **Credentials, reputation and selective disclosure** are out of scope. A binding says two keys belong together, not who the
  person is.
- **Privacy**: a binding is public by design and links a payment address to a social identity. Users who want unlinkable
  payments should bind a separate address.
- **NIP-05 names** depend on the domain that serves them: if it is down, or does not let browsers read its file, a name
  cannot be looked up (the npub still can). The one-file verifier takes npubs and addresses only, since it talks to relays
  and nothing else.
- **Single sign-in instance**: nonces and sessions live in memory, so more than one server process needs a shared store.

## Web app

English by default with a Malay toggle; all text is in `lang/en.json` and `lang/ms.json`.

- **Link** (`/`), **Look up** (`/lookup`), **Demo app** (`/demo`) and **Pay** (`/pay`) as in the demo above.
- The demo app only talks to `/api/rp/*`; its server checks the signed challenge and reads the binding from relays on its own.
  It offers two ways in: a Nostr key, or a BCH wallet alone (the server finds the Nostr key linked to the address).
- When the connected Nostr key is the author of a look-up result, the result offers **Revoke this link** (with a confirm
  step) and **Move to a new address** (the Link page signs the new address and publishes one replacing event). A key whose
  newest event carries no BCH address shows "no current BCH link".
- **Look up** and **Pay** also take a NIP-05 name (`name@domain`): the browser asks the domain for the key, then verifies
  that key's binding on the relays and says which npub the name led to.
- Demo keys live in memory for the open tab only.
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
- `@bitauth/libauth`, `qrcode-generator`, `fastify`, `react`: MIT.
- `@walletconnect/sign-client` 2.21.8 with `@walletconnect/core`, `types`, `utils` 2.21.8: Apache-2.0. Later versions use a
  non-OSI licence, so this version is pinned. See [docs/decisions/0001-protocol.md](docs/decisions/0001-protocol.md).

## AI disclosure

The code and documents in this repository were written by an AI coding agent. The owner chose the problem, set the scope and
reviews the work.

## License

MIT. See [LICENSE](LICENSE).
