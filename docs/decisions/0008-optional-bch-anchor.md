# 0008: Optional BCH anchor

Status: accepted

## Context

A binding (ADR 0001) is two signatures in one Nostr event. Its time is `created_at`, written by the author, and address to
key lookup depends on relays keeping the event. Recording the pair on the BCH chain gives a time from a block, a lookup that
works from the chain alone, and an ordering that a thief of the Nostr key cannot forge. It also costs a fee and leaves a
permanent public record, so it cannot be required.

## Decision

- Format: an ordinary transaction from the bound address with one `OP_RETURN`: prefix `TMBT` (4 bytes), version byte `0x01`
  as a one-byte data push, the 32-byte x-only Nostr public key, the 32-byte binding event id. Details in `docs/SPEC.md`,
  "Optional BCH anchor".
- Prefix: `TMBT` is not in the bitcoincash.org OP_RETURN prefix list (`etc/protocols.csv`, checked 2026-11-17). It lives in
  config, so a collision found later is a config change and a version bump, not a code change.
- Both the key and the event id are committed. The key is what the anchor dates: the pair (key, address). The event id lets
  a reader point at the exact event that was current when the anchor was made; if it has since been replaced, the anchor
  still counts for the pair, so routine edits (adding a tag) do not need a new transaction.
- Validity is checked from the transaction itself: one P2PKH input whose public key hashes to the address. A confirmed
  transaction means the network checked that signature; no signature check is repeated here.
- Earliest block wins; ties go to the lower txid so every reader picks the same one.
- No new Nostr kind. The anchor lives on BCH; the binding event is unchanged and verifiers that ignore anchors are not
  affected.
- Chain reads use `@electrum-cash/network` and `@electrum-cash/web-socket` (exact versions) against Fulcrum servers listed in
  `anchor.electrum`, tried in order, each with `anchor.timeoutMs`. The same code runs in Node (CLI) and the browser.
- Signing: the web app asks the connected wallet with WalletConnect `bch_signTransaction` (wc2-bch-bcr: libauth extended JSON
  for `transaction` and `sourceOutputs`, `broadcast: true`). Paytaca handles this method: `paytaca-app`
  `src/components/walletconnect/WalletConnectV2.vue` at commit `450652c8f77b19382c025d627a5e8fb43b09b39c` routes it to a
  P2PKH Schnorr signer and sends the transaction unless `broadcast` is `false`. The request is added to
  `walletConnect.methods`.
- Fee: estimated from the signed size at `anchor.feePerByte`; the page refuses to ask the wallet above `anchor.maxFeeSats`
  and when the change would fall under `anchor.dustSats`. The preview shows both outputs and the fee before the request.
- Only `src/core/anchor*`, `web/keys/anchor*` and a demo script may name the signing or sending methods. The server never
  does.

## Consequences

- Reading an anchor needs a chain server; when none answers the page says so and the binding is still verified as before.
- Addresses with long histories are read up to `anchor.historyLimit` transactions, oldest first.
- Anyone can write the payload bytes, but only the address key can spend from it, which is what the input check enforces.

## Demo key commitments

- `scripts/anchor-demo.ts` makes the commitment for the project's own demo binding with the demo key, signing the same
  way a wallet does (`src/core/anchor-sign.ts`, shared with the tests that stand in for a wallet). Without `--broadcast` it
  only builds, signs, checks and prints.
- Before anything is recorded the signed transaction is decoded again: exactly two outputs, a 0 sat OP_RETURN carrying the
  demo key and the current binding event id, and the change back to the same demo address; every input is a coin of that
  address read from the chain; the fee is at most `anchor.maxFeeSats`.
- Budget: `anchor.demoBudget` (at most 2 transactions and 2000 sat in fees over the project). Each transaction is written
  to the ledger file `anchor.demoBudget.ledger` (not tracked) before it is sent, so the ledger can never show less than
  was spent. A binding already committed, even while unconfirmed, is not committed again.
