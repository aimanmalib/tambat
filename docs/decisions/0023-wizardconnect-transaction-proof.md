# 0023: WizardConnect as a second wallet option, with a transaction proof

Status: accepted. Revisits [0015](0015-no-wizardconnect-connector.md).

## Context

ADR 0015 declined a WizardConnect connector for two reasons: the protocol has no message signing action, so a wallet
cannot sign the binding text, and the client libraries are LGPL-3.0-or-later.

Since then the verifier reads a second proof form (ADR 0021): `tx:<txid>` in the `i` tag, a transaction from the bound
address whose OP_RETURN is exactly the NIP-39 verification text. Other NIP-39 clients already publish bindings in that
form, and every Tambat verifier (Look up, the wall, the CLI) checks it against the chain. A wallet that only signs
transactions can therefore make a binding that all of them accept, so the first reason no longer holds.

What was read on 2026-11-20: npm `@wizardconnect/core` 0.2.11 and `@wizardconnect/dapp` 0.2.8. Both carry an LGPL-3.0-
or-later header in every source file and no `license` field. The dapp side opens a session over one Nostr relay
(NIP-59 gift-wrapped messages between two throwaway session keys), receives the wallet's extended public keys for the
`receive` and `change` paths in `wallet_ready`, and sends `sign_transaction_request` with the transaction, the outputs
it spends and, for each input, the path and address index the wallet should sign with.

## Decision

Link gets a third option next to Paytaca over WalletConnect and the demo key: "WizardConnect wallet".

1. The page shows a `wiz://` pairing link as a QR code (pressing it copies the link) and as text with a copy button.
2. When the wallet connects, the page walks its addresses from the shared public keys (see "Address discovery" below)
   and reads their history and coins from the chain servers in `config.anchor.electrum`.
3. From the funded address with the most BCH whose coins pay the fee (`config.anchor.feePerByte`, at most
   `config.anchor.maxFeeSats`) it builds the transaction: that address's coins in, `OP_RETURN <NIP-39 text>` (0 sat)
   and the change back to the same address. The proof comes from one address on purpose: the bound address is the
   one that signs. Coins not yet in a block are spent when `config.wizardConnect.acceptUnconfirmed` is on, and the
   preview says so. The outputs and the fee are shown before the wallet is asked.
4. The wallet signs (`broadcast: false`). The page refuses any answer that is not the planned transaction (same
   outpoints, same outputs) or that fails `checkTxProof` from `src/core/tx-proof.ts`, the check every verifier runs.
5. Only then does the page send the transaction to a chain server, and the binding is published with `tx:<txid>`. The
   Link step verifies the signed event against that transaction before publishing.

The code that sends lives only in `web/keys/anchor-wizard.ts`, next to the existing anchor code. The server never sees
the transaction.

Licence. The libraries are used as published, without changes, and are loaded with a dynamic `import()` only when the
person presses "Connect with WizardConnect"; the build puts them in their own script files, separate from the app.
The option names the library, its licence and links to the source and the licence text, and the README lists it under
third-party licences. This keeps the work that uses the library separable and replaceable, which is what LGPL-3.0 asks
of a combined work. Tambat itself stays MIT. If this reading turns out wrong, `config.wizardConnect.enabled: false`
removes the option and the libraries from what users load, and dropping the two packages removes them from the build.

Session. The library's session storage is turned off (`session: false`), so no key is written to the browser. The
relay for the session messages is `config.wizardConnect.relay`; the default is one of the relays Tambat already uses,
not the library's default relay.

Address discovery. A wallet that gives a new address for every payment keeps its coins far from index 0, so a fixed
count of addresses misses them. `web/keys/wallet-scan.ts` walks the receive path, then the change path, in batches of
`config.wizardConnect.scan.gapLimit` addresses (20, the BIP44 gap limit), and stops after that many unused addresses in
a row (no history and no coin) or at `scan.maxAddresses` on one path. Each batch is one round of `get_history` and
`listunspent` calls. When nothing is found, the page says how many addresses it checked; it never shows an address of
its own or asks anyone to send BCH to the site: the fee comes from the person's own wallet.

Unconfirmed coins. A proof that spends a coin still in the mempool verifies the same way: `checkTxProof` reads the
transaction and the outputs it spends, not their block height, and chain servers return mempool transactions. The CLI
anchor with the demo key keeps `config.anchor.confirmedCoinsOnly`.

## Consequences

- People whose wallet speaks WizardConnect but not WalletConnect can bind without pasting a signature. The binding
  costs a small fee and is public on chain; message bindings stay free.
- Not yet tested with a wallet. Tests use a fake wallet that signs with keys from the public BIP39 test phrase and a
  fake chain (`tests/anchor-wizard.test.ts`, `tests/wallet-scan.test.ts`); the browser tests check the pairing code
  and link, and a fake wallet whose only coin is unconfirmed at receive index 23 (`e2e/wizard-scan.spec.ts`).
- Bindings made this way are verified by everything that reads `tx:` proofs. The single-file verifier and server
  sign-in do not read the chain (ADR 0021), so they report such a binding as not checked.
- The libraries add about 420 kB to the files a browser downloads after pressing the button, and nothing before.
