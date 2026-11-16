# Tambat

Bind a Bitcoin Cash address to a Nostr public key, publish the binding to Nostr relays, and let anyone verify it without
trusting a server.

Built for BCH BLAZE 2026, bounty "Decentralized Identity".

Status: early. The protocol is fixed in [docs/decisions/0001-protocol.md](docs/decisions/0001-protocol.md). The core library
(`src/core/`), the command-line verifier and the relying app server work; the web app follows. Sign-in and the DID document are
described in [docs/decisions/0002-sign-in-and-did.md](docs/decisions/0002-sign-in-and-did.md).

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

Serves the built web app when `dist/` exists (`npm run build`; the web app is not written yet) and:

- `POST /api/rp/challenge`, `POST /api/rp/login`, `GET /api/rp/session`, `POST /api/rp/logout`: challenge and response sign-in
  with a NIP-98 event. The server finds the user's binding on relays itself and puts the verified BCH address in the session.
- `GET /api/did/<npub>`: a `did:nostr` document with the verified BCH address as a CAIP-10 account.
- `GET /healthz`.

Limits, origins and relays are in `config/tambat.json`.

## Development

Node 22, npm.

```
npm ci
npm test
npm run gate
```

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
