# 0005: Sign-in with a BCH key only

Status: accepted

## Context

ADR 0002 signs a visitor in with a Nostr key and treats a BCH signature over the challenge as optional. A person whose wallet
holds only the BCH key (Paytaca over WalletConnect, or any wallet with "Sign message") should also be able to sign in to a
relying app, and arrive as the Nostr identity their binding names. The binding already leads both ways, so no new format is
needed.

## Decision

- Same challenge as ADR 0002. The wallet signs `bchText` (`Sign in to <origin> with challenge <nonce>`) exactly; over
  WalletConnect this is `bch_signMessage` with `{ message }`, the method Paytaca implements.
- `POST /api/rp/login` takes `{ "type": "bch", "address", "signature", "nonce" }`. The nonce travels in the body because there is
  no signed event to carry it; the text the server checks is rebuilt from the request `Origin` and that nonce, so a signature
  made for another site or nonce does not verify.
- Order of checks (`src/core/auth-bch.ts`): fields present, P2PKH on the configured network, signature recovers to the
  address key; only then is the nonce consumed (expiry, origin). A failed signature does not consume the nonce and does not reach
  the relays, so a stranger cannot make the server query relays or burn someone else's nonce with a bad answer.
- The Nostr key comes from the server's own look-up by address (`lookupByAddress`), which re-checks every match against the
  author's newest event. No match, or a revoked binding, answers `401 no_binding`. When several Nostr keys hold verified
  bindings to the same address (each needed the address key's signature), the newest binding wins.
- The session records `method: "bch"` and `bchSigned: true`; the session view shows how the person signed in.
- End-to-end tests replace the WalletConnect client class at one seam (`window.__tambatSignClient`) with a fake wallet that
  answers like Paytaca. The WalletConnect relay network cannot be reached from a test run; the code after the seam (namespaces,
  account parsing, request shape, result handling) is the code a real wallet talks to. A script that can set that global can
  already run any code on the page, so the seam adds no new capability.

## Consequences

- A relying app gets the npub without asking for a Nostr signature. The proof is the BCH key plus the published binding; a
  person who loses the binding (revokes it) can no longer sign in with the wallet alone.
- When the relays do not answer, a BCH-only sign-in is refused (no binding found), while a Nostr sign-in still succeeds without
  an address. This is the safe direction.
