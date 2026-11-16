# Tambat

Bind a Bitcoin Cash address to a Nostr public key, publish the binding to Nostr relays, and let anyone verify it without
trusting a server.

Built for BCH BLAZE 2026, bounty "Decentralized Identity".

Status: in development. The protocol is fixed in [docs/decisions/0001-protocol.md](docs/decisions/0001-protocol.md); sign-in and
the DID document are described in [docs/decisions/0002-sign-in-and-did.md](docs/decisions/0002-sign-in-and-did.md). The core library
(`src/core/`), the command-line verifier, the relying app server and the web app work.

## How it works

1. The user signs the NIP-39 verification text `Verifying that I control the following Nostr public key: <npub>` with their BCH
   key (Paytaca over WalletConnect `bch_signMessage`, any wallet with "Sign message", or a throwaway demo key).
2. The user publishes a NIP-39 event (kind `10011`) signed by their Nostr key with the tag `["i", "bch:<cashaddr>", "<signature>"]`.
3. Anyone can look up the binding from the npub or from the address on public relays and check every step locally: event id,
   Nostr signature, BCH signature recovered against the author's npub, address match, network, separate keys, newest event.
4. A relying app can sign the user in with a challenge answered by a NIP-98 event, then read the verified BCH address from relays.

## Command-line verifier

```
npx tsx bin/tambat.ts text <npub>                # the exact text the BCH wallet signs
npx tsx bin/tambat.ts verify examples/binding-event.json
npx tsx bin/tambat.ts lookup <npub|bitcoincash:...> [--json]
```

`verify` works offline. `lookup` asks the relays in `config/tambat.json` and verifies every event they return. Exit code 0 means
verified, 1 not verified, 2 a usage error. Test vectors from the public BIP39 phrase `abandon ... about` are in
[examples/vectors.json](examples/vectors.json).

## Server

```
npm start
```

Serves the built web app when `dist/` exists (`npm run build`) and:

- `POST /api/rp/challenge`, `POST /api/rp/login`, `GET /api/rp/session`, `POST /api/rp/logout`: challenge and response sign-in
  with a NIP-98 event. The server finds the user's binding on relays itself and puts the verified BCH address in the session.
- `GET /api/did/<npub>`: a `did:nostr` document with the verified BCH address as a CAIP-10 account.
- `GET /healthz`.

Limits, origins and relays are in `config/tambat.json`.

## Web app

English by default with a Malay toggle; all text is in `lang/en.json` and `lang/ms.json`.

- **Link** (`/`): connect a Nostr key (NIP-07 extension, NIP-46 remote signer or a throwaway demo key), get a BCH signature
  (Paytaca over WalletConnect, a signature pasted from any wallet, or a demo key), see every verification step, then publish to
  the relays in `config/tambat.json` and see which relays accepted the event.
- **Look up** (`/lookup`): an npub or a BCH address. The browser asks the relays and verifies each result itself, then shows the
  step list, the signed event and the DID document.
- **Demo app** (`/demo`): stands for any other app. It only talks to `/api/rp/*`; its server checks the signed challenge and
  reads the binding from relays on its own.
- **Pay** (`/pay`): an npub becomes a verified address, a BIP21 payment link and a QR code. The user's wallet sends the payment.

Private keys never reach the server. The demo keys live in memory for the open tab only.

## Development

Node 22, npm.

```
npm ci
npm test
npm run build && npm run e2e   # Chromium desktop and WebKit iPhone 13
npm run gate
```

End-to-end tests run the real server against an in-memory relay (`e2e/fake-relay.ts`); the page's relay connections are routed
to it, and a NIP-07 extension is faked with the key from the public test phrase. They check accessibility (axe, WCAG 2.1 AA),
console errors and horizontal overflow at 320 px.

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
  non-OSI licence, so this version is pinned. See the ADR above.

## AI disclosure

The code and documents in this repository were written by an AI coding agent. The owner chose the problem, set the scope and
reviews the work.

## License

MIT. See [LICENSE](LICENSE).
