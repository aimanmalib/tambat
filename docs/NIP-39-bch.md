NIP-39 platform `bch`
=====================

Bitcoin Cash addresses as external identities
---------------------------------------------

`draft` `optional`

This document proposes `bch` as a [NIP-39](https://github.com/nostr-protocol/nips/blob/master/39.md) platform. It lets a
Nostr key claim a Bitcoin Cash P2PKH address and carry a signature from the address key as the proof, so anyone can check the
claim with the event alone and no third-party service. It adds no event kind and no new tag. The reference implementation is
`src/core/` in this repository; the full protocol, including discovery and sign-in, is in [SPEC.md](SPEC.md).

## Claim

A claim is an `i` tag in the author's kind `10011` event:

```json
["i", "bch:<cashaddr>", "<proof>"]
```

- `<cashaddr>` is the lowercase CashAddr. On mainnet a writer omits the `bitcoincash:` prefix (`bch:qqyx49…`, see "Write
  form"); on a test network it keeps the prefix (`bch:bchtest:qq…`), because a reader cannot tell the network from the
  address alone.
- The address must be P2PKH: CashAddr type `0` with a 20-byte hash. P2SH, token-aware types and type `0` addresses with a longer
  hash must be rejected, because a signed message proves control of one public key only.
- `<proof>` is a BCH signed message (below), base64 with padding.

An event should carry at most one `bch:` claim, so a look-up by public key has one answer. A writer keeps the author's other `i`
tags when it adds, replaces or removes the `bch:` tag.

## Signed text

The address key signs this exact UTF-8 text, the NIP-39 verification text, with no trailing newline:

```
Verifying that I control the following Nostr public key: <npub>
```

`<npub>` is the NIP-19 encoding of the event `pubkey`. A verifier builds the text from the event author and never takes it from
the event, so a proof copied into another author's event fails.

## Proof format

The BCH signed-message format of Electron Cash "Sign message" and of `bch_signMessage` over WalletConnect:

1. Preimage: `0x18`, the ASCII bytes `Bitcoin Signed Message:\n`, the CompactSize of the text length in bytes, the text bytes.
2. Digest: SHA-256 applied twice to the preimage.
3. Proof: 65 bytes, a header byte then the compact secp256k1 signature `r || s`. Header = recovery id + 27 for an uncompressed
   public key, recovery id + 31 for a compressed one.

### On-chain proof

A wallet that can sign a transaction but not a message may put `tx:<txid>` in place of the proof. The transaction spends from
the claimed P2PKH address and has an `OP_RETURN` output, made of data pushes only, in which one push is exactly the signed
text. Other pushes are allowed, so a client may put its own protocol tag first. A client checks that the transaction it reads
hashes to `txid`, that an input spends from the address and the transaction passes the BCH virtual machine with the outputs
it spends, and that the output carries the text for this `pubkey` (steps `tx_found`, `address_match`, `tx_text`). A client
that cannot read the chain must treat the claim as not verified.

## Write form

A new claim is written with platform `bch` and the mainnet CashAddr without its prefix, the form other NIP-39 verifiers read:

```json
["i", "bch:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6", "<proof>"]
```

Reference: `claimIdentity` in `src/core/binding.ts`, setting `nostr.claimForm` (`bare`) in
`config/tambat.json`.

## Read forms

A reader accepts every form below. Tags that name the same address in different forms are one claim, and every one of them
must pass; tags for two different addresses stay two claims.

| Identity (second value) | Proof (third value) | Read as |
|---|---|---|
| `bch:q…` | base64 signed message | the write form |
| `bch:bitcoincash:q…` | base64 signed message | the earlier form; bindings written before stay valid |
| `bitcoincash:q…` | any proof below | the same claim (`nostr.platformAliases`) |
| any of the above | `msg:<base64>` | a signed message; the marker is dropped |
| any of the above | `tx:<txid>` | an on-chain proof |
| any of the above | exactly 64 lower-case hex characters | an on-chain proof (a bare txid; a signature is 88 characters) |
| any of the above | `<base64> \| tx:<txid>` | both proofs; each is checked and both must pass |

## Verification

A client verifies a claim in this order and reports the first failing step:

1. `event_id`: the event `id` is the NIP-01 hash of the event.
2. `nostr_sig`: `sig` is a valid BIP-340 signature of `id` by `pubkey`.
3. `newest`: no newer kind `10011` event by the same author is known (kind `10011` is replaceable; a newer event without the
   `bch:` tag revokes the claim).
4. `bch_sig`: a public key is recovered from the proof over the signed text for this `pubkey`.
5. `address_match`: HASH160 of the recovered key, in the encoding the header declares, equals the 20-byte CashAddr hash.
6. `network`: the CashAddr prefix is the network the client expects.
7. `key_separation`: the x-coordinate of the recovered key differs from `pubkey`. Using one key for both is rejected.

To find the Nostr key for an address, query kind `10011` with `#i` set to every spelling of the address (`bch:` and
`bitcoincash:`, each with and without the prefix; `claimIdentities` in `src/core/binding.ts`), then verify each result against the
newest event of its author, since a relay may return an event that a newer one has replaced.

## Example

The vector below uses the earlier prefixed form, which every reader still accepts. Keys from the public BIP39 phrase `abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon
about` (never use them for funds). BCH key at `m/44'/145'/0'/0/0`, Nostr key at `m/44'/1237'/0'/0/0` (NIP-06).

```json
["i", "bch:bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6",
 "HyjnEw2ZzkLk2OKkjIH07qEM+hYu82QBpWun8L+0w1KiTpai5/0YVlsuEJ1Eb5q0gS+MoIfGRT+yPaCdMseShMk="]
```

The signed text is the verification text with `<npub>` set to
`npub1az708q3kd9zy6z6f44zav5ygvdwelkzspf6mtusttx47lft2z38sghk0w7`. The full event is
[examples/binding-event.json](../examples/binding-event.json).

## Test vectors

- [examples/vectors.json](../examples/vectors.json): the example above, regenerated by `scripts/make-vectors.ts`.
- [examples/third-party-vectors.json](../examples/third-party-vectors.json): vectors copied as data from their sources, each with a
  source pinned to a commit and its license: the BIP-340 test vectors (`bip340`), the CashAddr specification examples
  (`cashaddr`), and the Electron Cash signed-message tests (`signedMessage`). `tests/third-party-vectors.test.ts` runs all of them
  through the reference code.
