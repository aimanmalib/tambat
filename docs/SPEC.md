# Tambat binding protocol

This document is the protocol in one place: what a binding is, how it is written, how it is checked, how a relying app signs a
user in with it, and the test vectors. Reasons for each choice are in [decisions/0001-protocol.md](decisions/0001-protocol.md)
and [decisions/0002-sign-in-and-did.md](decisions/0002-sign-in-and-did.md). The reference code is `src/core/`.

## 1. Terms

- **Nostr key**: a secp256k1 key used with BIP-340 Schnorr signatures. `pubkey` is its 32-byte x-only public key in hex;
  `npub` is the NIP-19 bech32 form of the same key.
- **BCH key**: a secp256k1 key that controls a P2PKH Bitcoin Cash address.
- **CashAddr**: the full lowercase address with its network prefix, for example
  `bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6`. Networks: `bitcoincash` (mainnet) and `bchtest` (test networks).
- **Binding**: a Nostr event that claims one CashAddr for the event author and carries the BCH signature that proves it.

## 2. Verification text

The BCH key signs this exact UTF-8 text, the NIP-39 verification text, with one space before `<npub>` and no trailing newline:

```
Verifying that I control the following Nostr public key: <npub>
```

`<npub>` is the NIP-19 encoding of the binding event's `pubkey`. A verifier must build the text from the event author and must
NOT take it from anywhere else, so a signature copied into another author's event fails.

`tambat text <npub>` prints it.

## 3. BCH signed message

The format of Electron Cash "Sign message" and of `bch_signMessage` in Paytaca over WalletConnect:

1. Preimage: CompactSize(24) `0x18`, the ASCII bytes `Bitcoin Signed Message:\n`, CompactSize of the message length in bytes,
   the message bytes.
2. Digest: SHA-256 applied twice to the preimage.
3. Signature: 65 bytes, a header byte then the 64-byte compact secp256k1 signature `r || s`. Header = recovery id + 27 for an
   uncompressed public key, recovery id + 31 for a compressed one. Encoded as standard base64 with padding.

A verifier recovers the public key from the signature and the digest, in the encoding the header declares.

## 4. Binding event

A NIP-39 identity event:

```json
{
  "kind": 10011,
  "pubkey": "<author pubkey hex>",
  "created_at": <unix seconds>,
  "tags": [
    ["i", "github:example", "abc123"],
    ["i", "bch:<cashaddr>", "<base64 BCH signature over the verification text>"]
  ],
  "content": "",
  "id": "<NIP-01 id>",
  "sig": "<BIP-340 signature>"
}
```

- The claim is an `i` tag whose second element starts with `bch:` followed by the full CashAddr with its prefix. The third
  element is the BCH signature from section 3 over the text from section 2.
- Only P2PKH addresses can be bound: a signed message proves control of one public key. P2SH and token-aware address types
  must be rejected, and so must a type `0` CashAddr whose hash is not 20 bytes (the CashAddr format allows longer hashes).
- Kind `10011` is replaceable: relays keep the newest event of each author. A writer must keep the author's other `i` tags (for
  example `github:`) and should replace an earlier `bch:` tag, so one Nostr key claims one address and a look-up by npub has one
  answer. Reference: `createBindingEvent` in `src/core/binding.ts`.
- **Revocation**: publish a newer kind `10011` event without the `bch:` tag (`createRevocationEvent`). The newer event replaces
  the claim on every relay that receives it.
- **Rotation** (moving to a new address): publish one newer kind `10011` event in which the old `bch:` tag is gone and a tag for
  the new address, with a fresh BCH signature from the new address over the same text, takes its place; other `i` tags are kept
  (`createRotationEvent`). A writer must refuse to rotate from an address the current event does not claim.
- A replacing event must have a `created_at` greater than the event it replaces, so ordering does not fall to the id tie-break.
- The BCH key and the Nostr key must be different keys.

## 5. Verification algorithm

A verifier runs these named steps in this order and reports each one as `pass`, `fail` or `skip`, with a reason when it does not
pass. Reference: `verifyBinding` in `src/core/verify.ts`; the step names are `VERIFY_STEPS` in `src/core/binding.ts`.

Once per event:

| Step | Check |
|---|---|
| `event_shape` | The input is a NIP-01 event: hex `id`, `pubkey` and `sig` of the right length, integer `created_at` and `kind`, `tags` an array of string arrays, `content` a string. |
| `kind` | `kind` is `10011`. |
| `event_id` | `id` equals SHA-256 of the NIP-01 serialisation `[0, pubkey, created_at, kind, tags, content]`. |
| `nostr_sig` | `sig` is a valid BIP-340 signature of `id` by `pubkey`. |
| `newest` | No other valid kind `10011` event by the same author that the relays returned is newer. Newer means a larger `created_at`, or the same `created_at` and a lower `id` (NIP-01). Skipped when the verifier has no relay results, for example when checking a saved event offline. |

Once per `bch:` claim:

| Step | Check |
|---|---|
| `bch_sig` | A public key can be recovered from the signature over the verification text for the event author's npub. |
| `address_match` | HASH160 of the recovered key equals the 20-byte payload of the claimed CashAddr. Skipped when no key was recovered. |
| `network` | The CashAddr prefix is the network the verifier expects. |
| `key_separation` | The x-coordinate of the recovered BCH key differs from the Nostr `pubkey`. Skipped when no key was recovered. |

The binding is **verified** when no step fails, the event has at least one `bch:` claim, and every claim passes. A `skip` is
not a failure, so an event verified offline is verified only up to `newest`; a look-up from relays runs every step.

Stable reason codes (`REASON_CODES` in `src/core/verify.ts`) let an interface show the reason in its own language.

## 6. Discovery

Relays are untrusted stores. A verifier asks several and checks everything it receives itself.

- **From an npub**: `["REQ", <sub>, {"kinds": [10011], "authors": ["<pubkey hex>"]}]`. Drop every event whose id or signature
  fails, keep the newest, verify it with the others as `newest` input.
- **From an address**: `["REQ", <sub>, {"kinds": [10011], "#i": ["bch:<cashaddr>"]}]`. For each distinct author found, run the
  npub look-up above and keep the author only when the newest event verifies and still claims this address. A stale event that
  a relay still serves after a revocation therefore does not count.
- A relay that errors or does not answer within the timeout contributes nothing; the look-up continues with the others.

- **From a NIP-05 name** (`name@domain`): `GET https://<domain>/.well-known/nostr.json?name=<name>` with redirects refused, as
  NIP-05 requires. The answer must have a `names` object that lists the lower-case name with a 64-character hex key; anything
  else stops the look-up with a reason (`unreachable`, `bad_answer`, `unknown_name`, `bad_key`). The key then goes through the
  npub look-up above. The domain only points to a key: it cannot make a binding verify for a key that did not sign one, and
  the result shows which npub the name led to.

Reference: `lookupByPubkey` and `lookupByAddress` in `src/core/discover.ts`, `lookupByNip05` in `src/core/nip05.ts`.

## 7. Sign-in for a relying app

The relying app's server proves that the visitor holds a Nostr key now, then reads the BCH address from relays itself.

1. `POST /api/rp/challenge` with an allowed `Origin`. The answer: `nonce` (32 random bytes, hex), `expiresAt`, `url`
   (`<origin>/api/rp/login`), `method` (`POST`) and `bchText` (`Sign in to <origin> with challenge <nonce>`).
2. The client signs a NIP-98 event: kind `27235`, `content` empty, tags `["u", <url>]`, `["method", "POST"]`,
   `["challenge", <nonce>]`.
3. `POST /api/rp/login` with `{"event": <signed event>}` and, optionally, `"bchSignature"`: a BCH signed message over `bchText`.
4. The server checks, in order: event shape, kind, id and signature; `u` and `method`; `created_at` within the allowed clock skew;
   the nonce is pending, which removes it so it can be used at most once; the nonce has not expired; it was issued to the same
   origin. Then it looks up the binding of the signer from its own relays with section 6 and verifies it with section 5. When
   `bchSignature` is present it must recover to the key of the verified address.
5. The session cookie is `HttpOnly`, `SameSite=Strict` and `Secure` on https. The session holds the npub and, when verified, the
   address. The client never tells the server which address is bound.

### Sign-in with a BCH key only

A wallet that holds only the BCH key can sign in too; the binding leads from the address to the Nostr key.

1. Get a challenge as in step 1. The wallet signs `bchText` exactly (WalletConnect `bch_signMessage` with `{"message": bchText}`,
   or "Sign message" in any wallet).
2. `POST /api/rp/login` with `{"type": "bch", "address": <cashaddr>, "signature": <base64>, "nonce": <nonce>}`.
3. The server checks, in order: the three fields are present; the address is P2PKH on the configured network; the signature
   over `Sign in to <request origin> with challenge <nonce>` recovers to the key of the address. No relay is asked before this
   point. Then the nonce is consumed and must be unexpired and issued to the same origin.
4. The server looks up the address with section 6 (address to npub, each match re-checked against its author's newest event).
   No verified binding, or a revoked one, refuses the sign-in with `no_binding`. With several, the newest binding wins. The
   session holds that npub and the address, and records the method `bch`.

Limits (time to live, clock skew, allowed origins, cookie name) are in `config/tambat.json`.

## 8. DID document

`GET /api/did/<npub|hex|did:nostr:hex>` returns a `did:nostr:<hex>` document following the W3C Nostr Community Group draft. A
verified binding adds an `EcdsaSecp256k1RecoveryMethod2020` method with a CAIP-10 `blockchainAccountId`, the CashAddr in
`alsoKnownAs`, and a `NostrBindingEvent` service whose endpoint is a `nostr:nevent1...` pointer to the binding event. The
document is rebuilt from relays on every request; anyone can rebuild it with the same look-up.

## 9. Payment to an identity

An npub or a NIP-05 name is looked up with section 6; only a verified address is offered. The payment request is a BIP21 URI
(`bitcoincash:<address>?amount=<BCH>&label=...`) and its QR code. The payer's wallet builds and sends the transaction.

## 10. Test vectors

All keys come from the public BIP39 phrase
`abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about`. Never use them for funds.

| Item | Value |
|---|---|
| BCH path | `m/44'/145'/0'/0/0` |
| BCH public key | `02bbe7dbcdf8b2261530a867df7180b17a90b482f74f2736b8a30d3f756e42e217` |
| Address | `bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6` |
| Nostr path (NIP-06) | `m/44'/1237'/0'/0/0` |
| Nostr pubkey | `e8bcf3823669444d0b49ad45d65088635d9fd8500a75b5f20b59abefa56a144f` |
| npub | `npub1az708q3kd9zy6z6f44zav5ygvdwelkzspf6mtusttx47lft2z38sghk0w7` |
| BCH signature over the verification text | `HyjnEw2ZzkLk2OKkjIH07qEM+hYu82QBpWun8L+0w1KiTpai5/0YVlsuEJ1Eb5q0gS+MoIfGRT+yPaCdMseShMk=` |
| Binding event id (`created_at` 1763251200, with a `github:example` tag first) | `8fe8e97941cf72f148674cf1bd35169f10b470d0d395987f61f059a5a4ec355f` |

The full event is [examples/binding-event.json](../examples/binding-event.json); every value is in
[examples/vectors.json](../examples/vectors.json), which `scripts/make-vectors.ts` regenerates. The BCH signature is
deterministic (RFC 6979); BIP-340 signatures use random auxiliary data, so `sig` differs on every signing while `id` does not.

Third-party vectors, copied as data with a source pinned to a commit and a license, are in
[examples/third-party-vectors.json](../examples/third-party-vectors.json): the BIP-340 test vectors, the CashAddr specification
examples and the Electron Cash signed-message tests. `tests/third-party-vectors.test.ts` runs every one through `src/core/`. The
`bch` platform is also written up as a NIP-39 extension draft in [NIP-39-bch.md](NIP-39-bch.md).

## Optional BCH anchor

The binding above needs no blockchain transaction. An anchor is an optional extra: an ordinary BCH transaction, signed by
the wallet that holds the bound address, that records the pair (Nostr key, BCH address) in a block.

**Format.** The transaction spends at least one P2PKH input from the bound address and has one `OP_RETURN` output:

```
OP_RETURN <"TMBT", 4 bytes ASCII> <0x01, a one-byte push: version> <Nostr x-only public key, 32 bytes> <binding event id, 32 bytes>
```

That is 71 bytes of script. The tool in this repository adds a single change output back to the same address and nothing
else. The prefix is set in `config/tambat.json` (`anchor.prefix`); it was checked against the public OP_RETURN prefix list
of bitcoincash.org (`etc/protocols.csv`) and is not taken there.

**Valid when** all of these hold:

1. the transaction is confirmed in a block;
2. one input is P2PKH and HASH160 of its public key equals the payload of the address (the network already checked that
   key's signature when it accepted the block);
3. the Nostr key in the payload is the author of the newest kind 10011 event that still claims the address (section 5).

"Bound since" is the time of the earliest block holding a valid anchor for the pair. If the event id in the payload is no
longer on the relays (the binding was replaced by a newer event that still names the address), the anchor still counts for
the pair, and readers say the anchored event is an earlier one.

**Reading from the chain alone.** Address history, transactions and block headers come from Fulcrum servers over the
Electrum protocol (`blockchain.scripthash.get_history`, `blockchain.transaction.get`, `blockchain.block.header`), read only.
So address to Nostr key works with no relay: `tambat anchor-lookup <address>`. Check 3 still needs a relay, and the look-up
page runs both. Servers are listed in `anchor.electrum`; none answering is shown as "chain servers unreachable", never as
"not anchored".

**Why it is optional.**

- Every anchor costs a fee, and the address must hold coins. The base binding is free and works for an empty address.
- The record is public and permanent. A revocation happens on Nostr (section 5, newest event); the old anchor cannot be
  deleted. Readers ignore an anchor whose key no longer has a current binding to the address, but the bytes stay in the
  block.
- Verification of a binding (section 5) never depends on it.

**What it adds over the off-chain proof.**

- Time from a block instead of `created_at`, which the author writes and can set to any value.
- Address to Nostr key lookup that survives relays losing the event.
- A stolen Nostr key can publish a new binding event, but it cannot spend from the BCH address, so it cannot create an
  anchor, and it cannot create one dated before the owner's. A verifier that has to choose can prefer the pair with the
  earliest anchor.
- The signature is an ordinary BCH transaction from the wallet, so any block explorer shows it.

**Wallet request.** The web app builds the transaction without signatures from the address's coins, shows the outputs and
the fee, refuses a fee above `anchor.maxFeeSats`, and asks the connected wallet with the WalletConnect BCH method
`bch_signTransaction` (`transaction`, `sourceOutputs`, `broadcast: true`). The wallet signs and sends. The app checks that the
signed transaction it gets back carries the same payload from the same address. The server of this repository never signs
or sends a transaction and holds no key.
