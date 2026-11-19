# 0019: Selective disclosure with salted digests in a self-issued credential

Status: accepted

## Context

A binding (NIP-39 kind 10011) is public: anyone who reads the relays sees every address it carries. Some uses need
less: a shop or a service may need to know that a Nostr key controls a given BCH address, without being handed the
binding event, its date or anything else the holder could later want to keep apart. The holder should be able to
choose, per recipient, which facts to reveal, and the recipient should be able to check them offline.

Three ways were weighed:

1. SD-JWT itself (IETF OAuth working group). It needs a JWS signer and a JWT library, and Nostr keys sign BIP-340
   Schnorr, which has no registered JWS algorithm.
2. Zero-knowledge proofs or BBS signatures. Stronger privacy, but new cryptography, new dependencies and no Nostr or
   BCH key can sign them today.
3. The SD-JWT digest scheme carried in a W3C VC 2.0 whose proof is a signed Nostr event, the same pattern as ADR 0017.

## Decision

Option 3. The format is "SD-JWT style": it uses the SD-JWT disclosure and digest rules but is not a JWT and was not
tested against SD-JWT implementations.

- `src/core/sd.ts`, no new dependency. The holder issues a credential about itself: `issuer` and
  `credentialSubject.id` are both `did:nostr:<holder hex>`, `type` `["VerifiableCredential", config sd.credentialType]`,
  `_sd_alg` `sha-256`.
- Fields (config `sd.fields`, at least three): `bchAddress`, `network`, `bindingEvent`, `boundAt`, all taken from the
  holder's verified binding. Each becomes a disclosure, the base64url (no padding) of the JSON array
  `[salt, name, value]` with a salt of config `sd.saltBytes` (16, that is 128 bits) from `crypto.getRandomValues`. The
  credential keeps only the SHA-256 digests of the disclosure texts in `credentialSubject._sd`, sorted so their order
  says nothing about which field is which.
- The `bchAddress` value is `{ address, signature }`: the BCH signature from the binding over the binding text for the
  holder's npub. A recipient who is given the address also checks that the BCH key signed for this Nostr key, so the
  disclosure proves control of both keys and not only a claim.
- Proof: `type` `NostrEventProof` (config `vc.proofType`), `verificationMethod` `<issuer>#key1`, and `event`: a NIP-32
  label event (kind 1985, `L` config `sd.namespace`, `l` config `sd.label`) signed by the holder whose content is the
  base64url SHA-256 of the RFC 8785 text of the credential without its proof. No new event kind. The event is never
  published; it exists only inside the credential.
- A presentation is a VC 2.0 VerifiablePresentation (`type` adds config `sd.presentationType`) with the one credential
  and the chosen disclosures in `disclosures`. The file the holder issues is the same shape with every disclosure; it
  stays with the holder. `tambat sd present` drops the others.
- Verification, all offline: shape and context; holder, issuer, subject and proof key are one key; the proof event id,
  signature, label and digest; then for each disclosure: it decodes to `[salt, name, value]` with a long enough salt
  and a known field, it is not repeated, its digest is in `_sd`, and for `bchAddress` the BCH signature recovers to the
  address for the holder's npub. Each failure has a name (`disclosure_unknown`, `disclosure_duplicate`,
  `bch_signature`, `proof_hash`, ...). A presentation with no disclosure verifies as "the holder committed to N
  fields" and nothing more.
- One path for every caller: `tambat sd issue|present|verify`, and the one-file verifier shows the revealed fields and
  "N fields hidden". No new screen in the app.

## Consequences

- Not zero-knowledge: a revealed value is seen as it is. Hidden values are protected by the salt only.
- The public binding already reveals the address to anyone who looks it up. Selective disclosure matters for the
  private path: a credential handed to one recipient that need not carry the binding event or its date.
- The same credential and the same proof signature appear in every presentation made from it, so two recipients can
  link them. Issuing a fresh credential per recipient avoids that.
- The presentation has no holder signature over a challenge, so whoever receives one can show it again elsewhere.
  Binding a presentation to a recipient and a nonce (key binding in SD-JWT terms) is left for later.
- `boundAt`, `bindingEvent` and `network` are claims of the holder about its own binding; a recipient who wants them
  checked can fetch the binding event by the revealed id.
