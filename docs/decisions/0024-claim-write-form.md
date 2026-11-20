# 0024: Write claims as `bch:q…` and read the dialects other NIP-39 clients write

Status: accepted

## Context

Measured on 2026-11-20 against four NIP-39 verifiers built by other teams (verifier A to D, docs/MEASURED.md), none accepted a
Tambat binding. Tambat wrote `["i", "bch:bitcoincash:q…", "<signature>"]`. Verifier A reads only the address without its
prefix (`bch:q…`). Verifier B reads only an on-chain proof `tx:<txid>`. Verifier C reads the third value as a bare txid.
Verifier D reads `bitcoincash:` as the platform with a bare txid in the third value, and Tambat could not read its bindings
either: a real event in that form showed as "names no BCH address". Its proof transaction puts a protocol tag push before the
NIP-39 text in the OP_RETURN, which the exact-output check of ADR 0021 refused.

Options weighed:

1. Keep writing the prefixed form. Every reader we measured that is not Tambat rejects it.
2. Write `bch:q…` on mainnet and read every form we have seen, keeping old bindings valid.
3. Write several tags for one address, one per dialect, in every new event. More tags, and no measurement yet shows which
   extra tags a verifier needs.

## Decision

Option 2, with the reading side of option 3.

- **Write**: `claimIdentity` (`src/core/binding.ts`) writes `bch:q…` for a mainnet address when `nostr.claimForm` is `bare`
  (`config/tambat.json`). A test network keeps its prefix, because a reader cannot tell `bchtest` from the address alone. The
  recovery tag keeps the prefixed form; only Tambat reads it.
- **Read**: `claimFromTag` reads the platform `bch` and every name in `nostr.platformAliases` (`bitcoincash`). The earlier
  `bch:bitcoincash:q…` stays readable, so existing bindings stay valid. A third value of exactly 64 lower-case hex characters
  is a txid (`parseProof`; a base64 signature is 88 characters). `<signature> | tx:<txid>` carries two proofs and both are
  checked (`parseProofs`).
- **One claim per address**: `verifyBinding` groups tags that name the same address (in any form) into one claim and merges
  their results (`mergeClaims`): it passes only when every tag passes, and a step checked twice reports its worse outcome. Two
  different addresses stay two claims, as before.
- **OP_RETURN text**: `carriesText` (`src/core/tx-proof.ts`) passes an `OP_RETURN` made only of data pushes in which one push
  is exactly the verification text. A tag push before the text is allowed; the text split across pushes, padded, or next to a
  non-push opcode is not. The address owner signed the whole transaction either way, so this does not weaken the proof.
- **Look-up by address** asks relays for every spelling (`claimIdentities`).

Whether extra dialect tags on Tambat's own events raise the number of verifiers that accept them is measured separately;
extra tags are only written if that measurement shows they help.

## Consequences

- New bindings from Link, the CLI and the demo are written `bch:q…`. Readers that only accept the prefixed form would refuse
  them; we know of none.
- The released library `core-v0.2.0` writes the prefixed form and does not read `bitcoincash:` tags; it is not repacked
  (README "Known limits"). `tests/core-package.test.ts` lists the two new settings as added after that release.
- Tests: `tests/interop-write.test.ts` (write form, a real mainnet `bitcoincash:` event and its transaction as pinned data,
  bare txid, two proofs, several tags), `e2e/interop-write.spec.ts` (Link publishes `bch:q…`; Look up verifies the dialect
  event by npub and by address).

## Way back

Set `nostr.claimForm` to `prefixed` to write the earlier form again, or empty `nostr.platformAliases` to stop reading
`bitcoincash:` tags. Neither needs a code change.
