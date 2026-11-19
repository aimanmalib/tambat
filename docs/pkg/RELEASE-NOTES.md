# @tambat/core 0.2.0

The library behind Tambat: write, find and verify NIP-39 bindings (kind 10011) between a Bitcoin Cash key and a Nostr
key. ESM only, TypeScript types included, MIT license. Built by `npx tsx scripts/pack-core.ts` with tsc from `src/core`.

This package is not on the npm registry. The tarball is attached to this release and kept in the repository at
`docs/pkg/`.

## What is in the package

- Bindings: `createBindingEvent`, `createRevocationEvent`, `verifyBinding`, `verifyClaim`, `verificationText`.
- Discovery: `lookupByPubkey`, `lookupByAddress`, `lookupInput` against the configured relays.
- Keys and signatures: BCH signed messages (`signMessage`, `recoverSigner`), CashAddr, the NIP-06 and BCH paths a
  wallet uses (`keysFromPhrase`, `bindingFromKeys`).
- DID documents (`didDocument`, `didOf`), attestations (`createAttestationEvent`, `parseAttestation`) and
  W3C VC 2.0 export of a binding (`exportCredential`, `verifyCredential`).
- New in 0.2.0: a portable reputation file, a VP 2.0 of attestation credentials that the verifier recounts
  (`buildReputationBundle`, `verifyReputationBundle`, `summarizeReputation`).
- New in 0.2.0: selective disclosure, a credential of salted field digests that reveals the BCH address and its
  signature only (`issueSd`, `presentSd`, `verifySdPresentation`).
- `configure()` to change relays, network, kinds and timeouts at start-up.

## Install

```sh
curl -LO https://github.com/aimanmalib/tambat/releases/download/core-v0.2.0/tambat-core-0.2.0.tgz
curl -LO https://github.com/aimanmalib/tambat/releases/download/core-v0.2.0/SHA256SUMS
sha256sum -c SHA256SUMS
npm install ./tambat-core-0.2.0.tgz
```

## Check the file

`sha256sum -c SHA256SUMS` must print `tambat-core-0.2.0.tgz: OK`. The same hash is in `docs/pkg/SHA256SUMS` of the
tagged commit, and running `npx tsx scripts/pack-core.ts` on that commit rebuilds the package from source.

Two examples run against the installed package: `examples/core-nostr-client.ts` (a Nostr client checks that an npub
is bound to a BCH address) and `examples/core-wallet.ts` (a wallet writes a binding). The protocol is described in
`docs/SPEC.md`.
