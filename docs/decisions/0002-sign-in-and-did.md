# 0002: Sign-in for a relying app and the did:nostr document

Status: accepted

## Context

The bounty asks for authentication against the bound identity and for a dependent app. ADR 0001 fixed the shape of the sign-in
(a single-use nonce answered with a NIP-98 event). This record fixes the exact checks, the server boundary and the DID document.

## Decision

### Challenge

- `POST /api/rp/challenge` with an `Origin` header from `auth.allowedOrigins` returns a 32-byte random nonce, its expiry
  (`auth.challengeTtlSeconds`), the login URL and the text for an optional BCH signature:
  `Sign in to <origin> with challenge <nonce>`.
- Nonces live in memory. Expired ones are pruned on every issue; at `auth.maxPendingChallenges` the oldest is dropped.

### Answer

`POST /api/rp/login` with `{ "event": <kind 27235 event>, "bchSignature"?: <base64> }`. Checks, in order:

1. NIP-01 event shape, kind `27235`, id, BIP-340 signature.
2. Tag `u` equals `<request origin>/api/rp/login` (NIP-98 uses the absolute request URL) and tag `method` equals `POST`.
3. `created_at` within `auth.clockSkewSeconds` of server time.
4. Tag `challenge` names a pending nonce. The nonce is removed at this point, before the expiry and origin checks, so a correctly
   signed answer can use a nonce at most once even when it is rejected.
5. The nonce has not expired and was issued to the same origin.

The server then looks up the signer's newest kind `10011` event on its own relays and verifies it with the full step list of
ADR 0001. The browser never tells the server which address is bound. A key without a verified binding still signs in, with no
address. When `bchSignature` is present it must recover to the key of the verified address, or sign-in fails.

### Session

A random session id in a cookie (`auth.cookieName`): `HttpOnly`, `SameSite=Strict`, `Secure` on https origins, path `/api/rp`,
lifetime `auth.sessionTtlSeconds`. Sessions are in memory, capped at `auth.maxSessions`; a restart signs everyone out. Logout and
every state-changing route check the `Origin` header.

### Relays that fail

A relay query that throws or does not answer within the timeout becomes an empty result. Sign-in and lookups degrade to "no
binding found" instead of failing.

### DID document

`GET /api/did/<npub|hex|did:nostr:hex>` returns `application/did+json` following the W3C Nostr Community Group did:nostr draft:

- `id` `did:nostr:<hex>`, `#key1` a `Multikey` with `publicKeyMultibase` `fe70102<hex>` (base16, secp256k1-pub multicodec,
  even-y compressed key as BIP-340 implies).
- For each claim that passed verification: a `EcdsaSecp256k1RecoveryMethod2020` method with a CAIP-10 `blockchainAccountId`
  (`did.chains` in config gives the CAIP-2 chain id; the CashAddr is written without its prefix because CAIP-10 does not allow a
  colon there), listed under `assertionMethod`; the CashAddr in `alsoKnownAs`; a service `NostrBindingEvent` whose endpoint is a
  `nostr:nevent1...` pointer to the binding event and the relays it was read from.
- A failed or missing binding gives the plain Nostr document.

The server resolves the document from relays at request time; anyone can rebuild it with the same lookup and does not need to
trust this server.

## Consequences

- The nonce, session and relay lookup run in one process with no database. Running more than one instance would need a shared
  store; the demo runs one.
- The `bchtest` CAIP-2 id in config uses the testnet4 genesis prefix, which chipnet shares. It can be changed in config without
  code changes.
