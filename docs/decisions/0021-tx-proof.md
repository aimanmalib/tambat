# 0021: Read bindings that other NIP-39 clients write, including on-chain proofs

Status: accepted

## Context

Other clients publish kind `10011` bindings with a `bch:` identity on the same public relays. Measured on 2026-11-20
(docs/MEASURED.md, Interoperability), they write three spellings Tambat did not read: a CashAddr without prefix, a signature
written `msg:<base64>`, and `tx:<txid>` in place of a signature, where the address owner sent a transaction from the address
with the NIP-39 text in an OP_RETURN output. Wallets that sign transactions but not messages can only bind that way. Of seven
mainnet bindings by other clients, one verified before this change.

Options weighed for `tx:<txid>`:

1. Treat it as unreadable. Simple, but a valid binding made with a wallet that cannot sign messages would show as failed.
2. Check it against one chain server. One server that lies could make a forged proof pass.
3. Check it against the chain servers already used for anchors, kept only when they agree (ADR 0014), and require the
   transaction to pass the BCH virtual machine with the outputs it spends.

## Decision

Option 3. `src/core/tx-proof.ts` reads the `i` tag value (`parseProof`), checks a transaction (`checkTxProof`: hash equals
txid, an input spends a P2PKH output of the claimed address with that address's key, the whole transaction passes libauth's
BCH virtual machine, one output is exactly `OP_RETURN <push of the verification text>`), and reads it through the quorum
(`readTxEvidence`). `verifyBinding` stays synchronous and takes the chain answers as `txLookups`; `verifyBindingOnChain` in
`src/core/verify-chain.ts` reads them first. Look up, the wall and the CLI pass the configured chain servers. A proof that
was not read is skipped, and a skipped step makes a `tx:` claim fail: without the chain there is no proof.

A bare address is read on the verifier's network (the CashAddr checksum covers the prefix, so another network fails), and a
`msg:` marker is dropped before the signature is read. Look up by address also asks relays for the bare spelling.

## Consequences

- Look up and the wall label each claim "Signed message" or "On-chain proof" (`lookup.proof*` in `lang/`).
- The wall waits for the chain servers once per proof transaction it finds; signed-message bindings make no chain call.
- The offline verifier and the server's sign-in do not read the chain, so a `tx:` claim does not pass there.
- `@tambat/core` 0.2.0 (the released tarball) predates this and checks signed-message proofs only.
- Tambat itself still writes signed messages; it does not write `tx:` proofs.
- Undo: drop the `tx:` branch in `verifyClaim` and the `chain` options; signed-message checks do not depend on them.
