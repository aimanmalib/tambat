# 0001. Binding format, signature format, sign-in and WalletConnect licence

Status: accepted (2026-11-16)

## Context

Tambat proves that one person controls both a Bitcoin Cash key and a Nostr key, publishes that proof to Nostr relays, and lets
anyone find and check it without our server. The bounty asks for existing open standards where they exist. Paytaca, the sponsor
wallet, already signs messages over WalletConnect and already derives a Nostr key from the wallet phrase. This record fixes the
formats before any code depends on them. Facts below were read from the public sources named in each section on 2026-11-16.

## Decision

### Binding event (NIP-39)

- A binding is a NIP-39 identity event: kind `10011`, signed by the Nostr key, carrying one `i` tag per claim:
  `["i", "bch:<cashaddr>", "<base64 BCH signature>"]`.
- `<cashaddr>` is the full lowercase CashAddr with its prefix, for example `bitcoincash:qq...`. NIP-39 forbids `:` in the platform
  name (`bch`) but not in the identity, so the network prefix stays in the claim and a verifier can reject the wrong network.
- The BCH signature signs the NIP-39 verification text exactly:
  `Verifying that I control the following Nostr public key: <npub>`, where `<npub>` is the NIP-19 encoding of the event author.
- Kind `10011` is replaceable. The newest event from an author wins, so publishing a new event without the `bch:` tag revokes the
  claim. Other `i` tags the user already has (for example `github:`) are kept when we write a new event.
- One `bch:` claim per Nostr key: writing a new binding replaces an earlier `bch:` tag, so a lookup by npub has one answer. A
  verifier still checks every `bch:` tag it finds in events written by other tools.

### Verification steps

A verifier runs these named steps and reports each one with a reason when it fails:

1. `event_id`: recompute the NIP-01 id from the serialised event.
2. `nostr_sig`: check the BIP-340 Schnorr signature over the id.
3. `bch_sig`: recover the public key from the BCH signature over the verification text built from the event author's npub. The
   npub is never taken from the caller, so a signature copied into another author's event fails.
4. `address_match`: `hash160` of the recovered key equals the payload of the claimed CashAddr (P2PKH).
5. `network`: the CashAddr prefix matches the configured network (`bitcoincash` or `bchtest`).
6. `key_separation`: the BCH public key x-coordinate differs from the Nostr public key. Reusing one key for both is rejected.
7. `newest`: the event is the newest kind `10011` event from that author that the queried relays return.

### BCH signed message format

Read from `paytaca/paytaca-app`: `src/wallet/walletconnect2/index.js` (`signMessage`), called by
`respondToSignMessageRequest` in `src/components/walletconnect/WalletConnectV2.vue` for the methods `bch_signMessage` and
`personal_sign` with `params.message`.

- Preimage: `0x18`, the ASCII bytes `Bitcoin Signed Message:\n`, a CompactSize length of the UTF-8 message, the message bytes.
- Digest: double SHA-256 of the preimage.
- Signature: 65 bytes, header byte then 64-byte compact ECDSA `r || s`. Header = recovery id + 31 for compressed keys, + 27 for
  uncompressed keys. Base64 encoded.
- This is the same format as Electron Cash "Sign message", so a signature pasted from either wallet verifies with one routine.
- Paytaca checks that the session account matches the signing address and returns JSON-RPC error `-32603` on failure.

### WalletConnect session

- Namespace `bch`, chains `bch:bitcoincash` and `bch:bchtest` (the identifiers Paytaca uses), methods `bch_getAddresses` and
  `bch_signMessage` only. We never request transaction signing.
- The project id is a public value and lives in `config/tambat.json`.

### Nostr key in Paytaca (NIP-06)

Read from `src/wallet/nostr.js`: Paytaca derives the Nostr key from the wallet BIP39 phrase at `m/44'/1237'/0'/0/0`. The default
BCH receiving key in BIP44 wallets is `m/44'/145'/0'/0/0`. A wallet holding the phrase therefore already holds both keys of a
binding; `docs/PAYTACA.md` (later) shows the steps. Test vectors use only the public phrase `abandon ... about`.

### Sign-in (challenge and response)

- The relying server issues a single-use nonce bound to an origin and an expiry (`auth.challengeTtlSeconds` in config).
- The user answers with a NIP-98 event, kind `27235`, tags `u` (origin URL), `method`, and `challenge`, signed by the Nostr key.
  An optional second answer is a BCH signed message over the challenge.
- The server checks the event locally, then fetches the binding from relays itself and opens a session. A reused, expired or
  cross-origin nonce is rejected.

### WalletConnect licence

`@walletconnect/sign-client` on npm is licensed "SEE LICENSE IN LICENSE.md" from version 2.21.9 onward, which is not an OSI
licence. Version 2.21.8 and its `@walletconnect/core`, `types` and `utils` 2.21.8 are Apache-2.0 (checked in the installed
`package.json` and `LICENSE` files); the smaller helper packages are MIT. We pin 2.21.8 exactly and list it under third-party
licences in the README.

## Consequences

- Any NIP-39 aware client can read our claims; we add the `bch` platform with a documented proof format.
- Pinning an older WalletConnect client means we do not get later relay fixes. If Paytaca changes its relay protocol in a way
  2.21.8 cannot follow, pasting a signature from the wallet still works with any wallet.
- Key rotation, recovery, credentials and reputation are out of scope and listed under known limits.
