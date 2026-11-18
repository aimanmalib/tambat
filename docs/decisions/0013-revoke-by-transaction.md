# 0013: Revoke by transaction, and the chain wins over relays

Status: accepted

## Context

The optional BCH anchor (ADR 0008) records a pair (Nostr key, BCH address) in a block. Until now a revocation happened only
on Nostr, by publishing a newer kind 10011 event; relays decide whether a reader sees it. Someone who holds the address key
had no way to say on the chain "this key is no longer mine", and a reader had no rule for a relay binding that the chain
contradicts, for example when a stolen BCH key publishes a binding to the thief's Nostr key after the owner anchored theirs.

## Decision

- Payload: the existing `TMBT` format, with the one-byte field after the prefix read as a type. `0x01` (`anchor.version`)
  is a commitment, exactly as before, so the commitment in block 977901 reads the same. `0x02` (`anchor.revokeVersion`) is
  a revocation of the key it names; the event id field carries the binding being withdrawn. Both live in config and must
  differ. A type byte rather than a fifth push keeps one length and one parser, and older readers, which accept only
  `0x01`, ignore a revocation instead of misreading it.
- Order: lower block first; in one block a commitment before a revocation (the cautious reading), then lower txid.
  Transactions not yet in a block do not count.
- The newest confirmed commitment decides: `bound`, `revoked`, `conflict` (a bind to another key) or `none`
  (`src/core/chain-status.ts`). "Bound since" is the earliest bind of the key after its last revocation.
- The chain wins: the Pay page reads the chain before showing a payment link and refuses `revoked` and `conflict` with the
  reason; the look-up page shows the status. A chain that cannot be read is said to be unchecked; payment is not refused
  for it, because anchors are optional and most bindings have none.
- The revoke transaction is built and asked for exactly like a commitment (wc2-bch-bcr `bch_signTransaction`), shown only
  to the wallet that holds the bound address when the chain status is `bound`. The server never signs or sends.
- No new Nostr kind.

## Consequences

- Revocation by transaction is tested against a simulated chain only (fake Fulcrum in unit and browser tests). No
  revocation has been sent on mainnet.
- A thief holding the BCH key can also revoke or re-bind on the chain; the chain cannot tell owner from thief. What it adds
  is that a relay binding cannot silently override the chain, and every change leaves a dated public record.
- Readers of the chain status depend on Fulcrum servers; reading from more than one server is a separate change.
