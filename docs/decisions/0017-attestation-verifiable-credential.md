# 0017: Export attestations as W3C Verifiable Credentials 2.0

Status: accepted

## Context

An attestation (ADR 0011) is a NIP-32 label event in which one Nostr key says it checked another key's binding, pinned
to that binding event by id. Tools outside Nostr understand W3C Verifiable Credentials better than NIP-32 labels. The
attestation must stay the source of truth: a credential is only another way to carry it.

Two ways to secure such a credential were weighed:

1. A Data Integrity proof made with the attester's Nostr key over the canonical credential (a BIP-340 Schnorr
   cryptosuite). This needs the attester's secret key at export time. The look-up page reads attestations made by other
   people from relays and never holds their keys, so it could not export them. The cryptosuite is also a community draft,
   not a W3C Recommendation.
2. A proof that carries the signed events themselves. The attester already signed the attestation event, and the
   subject already signed the binding event (which carries its own BCH signature). Anyone holding both events can check
   every signature offline and rebuild the credential from them.

## Decision

- `src/core/vc.ts` builds and verifies the credential; `src/core/jcs.ts` is a small RFC 8785 (JCS) canonicalizer, tested
  with the RFC's own examples. No new dependency.
- Shape: `@context` `["https://www.w3.org/ns/credentials/v2"]`, `type` `["VerifiableCredential", config vc.type]`,
  `issuer` `did:nostr:<attester hex>` (the same form as ADR 0002), `validFrom` from the attestation's `created_at`,
  `credentialSubject` with `id` `did:nostr:<subject hex>`, `bchAddress` (the verified addresses of the binding),
  `bindingEvent` and `attestationEvent` (event ids).
- Proof: `type` config `vc.proofType` (`NostrEventProof`), `proofPurpose` `assertionMethod`, `verificationMethod`
  `<issuer>#key1` (the key in the did:nostr document), `created`, and the two signed events, `attestation` and `binding`.
- Verification, all offline: the context and type; the attestation event (id, Schnorr signature, label, one subject,
  one pinned binding, not self); the binding event through the normal binding verifier (Nostr and BCH signatures); that
  the attestation pins that binding and names its author; then the whole credential, as JCS text, must equal the
  credential those two events imply. The first difference is reported by path (`field`, for example
  `credentialSubject.bchAddress[0]`), and a changed issuer is reported as `issuer`.
- One path for every caller: the look-up page builds the file in the browser from the two events it already checked
  ("Download as Verifiable Credential"), `tambat vc export` builds it from an attestation id (read from the relays) or a
  file, and `tambat vc verify` and the one-file verifier check it. `examples/attestation-vc.json` is the export of the
  demo attestation recorded in `docs/MEASURED.md` (both events signed by the project's demo keys).

## Consequences

- No JSON-LD processing and no context download: the verifier compares JSON text. A JSON-LD processor would see the
  Tambat terms only through the `@vocab` of the VC 2.0 context. No claim of W3C conformance is made; the official test
  suite was not run.
- The credential shows who attested which binding and when. Offline it cannot show that the binding is still the
  subject's newest one; `tambat attestations <npub>` and the look-up page check that against the relays.
- If a cryptosuite for BIP-340 Data Integrity proofs becomes a standard, a second proof can be added next to this one
  for credentials exported by the attester's own wallet.
