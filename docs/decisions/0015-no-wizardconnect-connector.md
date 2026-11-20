# 0015: No WizardConnect connector for now

Status: superseded by [0023](0023-wizardconnect-transaction-proof.md)

## Context

WizardConnect is a wallet connection protocol for Bitcoin Cash, carried over Nostr relays, that some BCH wallets
support. A second wallet connector next to WalletConnect was considered so that users of those wallets could link an
address without pasting a signature.

A Tambat binding needs one thing from a wallet: a signature over the binding text with the key of the bound address
(the `bch_signMessage` call over WalletConnect, or a pasted signed message). The research was limited to two hours and
read the published package and the protocol documents only.

What was read on 2026-11-19:

- npm `@wizardconnect/core` 0.2.11 and `@wizardconnect/react` 0.2.7 (both published 2026-11-18). Neither
  `package.json` declares a license; the react README and the source repository's `LICENSE.txt` (commit
  `86aa7fae987f2b0f712997079c852fcbd546b162`, 2026-11-13) state LGPL-3.0-or-later.
- The protocol document (`docs/protocol.md` at the same commit) and the `hdwalletv1` type definitions. The only
  signing actions are `sign_transaction_request`, `sign_transaction_response` and `sign_cancel`. The wallet shares
  extended public keys (`receive`, `change`, `defi`) in `wallet_ready`.
- The extensions document lists `bch_stealth_bip352`, `rpa_bip47` and a proposed `decrypt`. None signs a message.

## Decision

Tambat does not add a WizardConnect connector.

- There is no message signing method in the protocol, so a wallet cannot sign the binding text through it. Sharing an
  extended public key proves nothing about who holds the private key.
- Signing a transaction could prove control of an address only by spending a coin from it, which turns every binding
  into an on-chain payment with a fee. Bindings stay free and off-chain; on-chain commitments remain the optional
  anchor of ADR 0008, made through WalletConnect.
- The client library is LGPL-3.0-or-later. Tambat keeps its dependencies to permissive licenses, and writing a second
  client from the documents alone, for a protocol that cannot sign the binding, is not worth the risk before the code
  freeze.

No code changes. The site makes no claim about these wallets.

## Consequences

- Users of wallets without WalletConnect link by pasting a message signed in their wallet (the paste path on the Link
  page; `tambat text <npub>` prints the text to sign).
- To revisit: if the protocol gains a message signing action (as a core action or a standard extension) under a license
  Tambat can depend on, a connector fits behind a config switch next to `config.walletConnect`, tested against a fake
  wallet first, the same way the WalletConnect path is.
