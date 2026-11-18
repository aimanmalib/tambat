# 0009: Recovery from a lost Nostr key

Status: accepted

## Context

A binding ties a Nostr key to a BCH key. If the Nostr key is lost, its owner can no longer revoke or move the binding, and a
new key that binds the same address looks, to a reader of the address, like a second claimant. The BCH key is still there and
can say which Nostr key replaces which.

## Decision

- The new key publishes a normal kind `10011` binding for the same address and adds one tag:
  `["replaces", <old npub>, "bch:<cashaddr>", <BCH signature over "replaces <old npub>">]`. No new event kind.
- The signed text names the old key only. It is not replayable into another key's event, because a verifier also requires
  that event's own `bch:` claim for the same address to verify, and only the BCH key holder can sign that claim.
- Accepted only when the old key's newest binding on the relays still claims the address and verifies. One hop only, so a
  chain of recoveries cannot make a look-up loop; a pair of keys that each claim to recover from the other is refused.
- The recovery result is reported beside the binding result, with named steps and reason codes like the other checks. It
  never changes whether the binding verifies: a reader that ignores the tag sees an ordinary binding.
- A later event from the new key (revocation, rotation, re-binding) drops the tag, since its signature was for one address.
- Tag name and signed text live in `config/tambat.json` (`nostr.recoveryTag`, `nostr.recoveryText`).

## Consequences

- Covers lost keys. A stolen Nostr key can still publish a newer event without the claim, which makes recovery fail; dating
  the pair on BCH (ADR 0008) is the answer for that case.
- An address look-up shows both keys; the old one carries a note naming the key that recovered it.
- Rollback: remove the tag handling in `src/core/recover.ts` and the look-up call in `src/core/discover.ts`; events that carry
  the tag remain ordinary bindings.
