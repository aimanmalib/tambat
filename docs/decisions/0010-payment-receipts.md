# 0010: Payment receipts as NIP-32 labels with a NIP-73 transaction id

Status: accepted

## Context

After paying an identity (SPEC section 9), the payer may want a public, signed note that says "I paid this key in this
transaction". Anyone can write such a note, so it is worth something only when a reader can check it against the chain.

## Decision

- A receipt is a NIP-32 label event, kind `1985` (an existing kind, set in `config/tambat.json` as `receipt.kind`):
  `["L", "cash.tambat.receipt"]`, `["l", "paid", "cash.tambat.receipt"]`, `["p", <paid key hex>]`,
  `["i", "bitcoincash:tx:<txid>"]` and `["k", "bitcoincash:tx"]` (NIP-73 blockchain transaction id). Content is empty.
- Kind `1111` (NIP-22 comment, the usual home of NIP-73 ids) was not chosen: comments are shown as social posts in clients,
  and a receipt is a machine-checked record. Zap receipts (kind `9735`) are for Lightning and signed by a zap service. No new
  kind is defined.
- Relays find receipts by transaction (`#i`) or by paid key (`#p` with `#L`). Every event they return is checked again.
- A reader fetches the transaction from a Fulcrum server (read only, `src/core/anchor-chain.ts`), and each previous
  transaction its inputs spend. Every transaction must hash to the id asked for, so a chain server cannot swap one in.
- **"From a bound address"** only when every input spends from an address in the receipt author's newest verified
  binding. One input from anywhere else, an input that cannot be read, a coinbase input or more inputs than
  `receipt.inputLimit` gives **"payer not proven"**. Whether an output pays an address bound to the `p` key is reported on
  its own line.
- Publishing is done by the payer's own Nostr key (browser extension, remote signer or demo key in the web app; a phrase file
  for the CLI). The server never sees a receipt.

## Consequences

- Wallets that pay from change addresses not bound to the payer's key get "payer not proven", even for an honest receipt.
  That is the intended reading: the receipt is then the author's claim only.
- Block confirmation is not required: a transaction a chain server knows (in the mempool or a block) is read the same way.
- Rollback: remove `src/core/receipt*.ts`, `src/node/receipt.ts`, the `receipt` config block and the panel on the pay page.
  Receipt events already on relays are ordinary NIP-32 labels.
