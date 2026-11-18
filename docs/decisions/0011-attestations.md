# 0011: Attestations as NIP-32 labels pinned to a binding event id

Status: accepted

## Context

A binding proves that one Nostr key and one BCH address are held together. A reader may also want to know that someone
else checked it, for example a service that met the owner. Such a statement must not outlive the binding it was about: if
the owner moves to another address, recovers to a new key or revokes, an old "verified" must not carry over.

## Decision

- An attestation is a NIP-32 label event, kind `1985` (an existing kind, set in `config/tambat.json` as `attest.kind`):
  `["L", "cash.tambat.attest"]`, `["l", "verified", "cash.tambat.attest"]`, `["e", <binding event id>]`,
  `["p", <subject key hex>]`. Content is empty. No new kind is defined, and the namespace differs from the receipt
  namespace (ADR 0010) so the two never mix.
- The `e` tag pins the exact binding event. A reader looks up the subject's newest binding and counts the attestation only
  when that binding verifies and has the pinned id. Any newer binding of the subject drops every older attestation. Pinning
  by the subject key alone was rejected: it would let an attestation follow a key to an address the attester never saw.
- Attesting one's own key is rejected. Readers keep the newest attestation per attester.
- `tambat attest` reads the subject's current binding from the relays and refuses when it does not verify, so the CLI only
  publishes attestations of a binding it has checked.
- The web look-up page shows the attestations that count and the number of attesters whose attestation dropped. It does not
  publish attestations.

## Consequences

- An attestation is the attester's word. There is no score, expiry, reason or revocation of an attestation; an attester who
  changes their mind can publish a deletion (NIP-09), which relays may or may not honour.
- Each binding update by the subject resets its attestations. That is intended: the attester checked one event.
- Rollback: remove `src/core/attest*.ts`, `src/node/attest.ts`, the `attest` config block and the panel on the look-up page.
  Attestation events already on relays are ordinary NIP-32 labels.
