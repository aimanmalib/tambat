# Verify a binding yourself

You do not need our web app or our server to check a binding. This page shows three ways: the one-file verifier, the
command-line verifier from this repository, and the same checks by hand with general tools. The algorithm is in [SPEC.md](SPEC.md) section 5.

## With the one-file verifier

Download `tambat-verify.html` from https://tambat.sasateguh.com/verify/ (or build it with `npm run build:verifier`), compare its
SHA-256 with the one in the [README](../README.md#one-file-verifier), and open it from disk in any browser. Paste the event
JSON to check it with no network at all, or enter an npub or address and list the relays to ask. Its policy allows WebSocket
connections only, so it cannot reach our server.

## With the command-line verifier

Node 22 and npm:

```
git clone <this repository> && cd tambat
npm ci
npx tsx bin/tambat.ts text <npub>                       # the text the BCH key must have signed
npx tsx bin/tambat.ts verify examples/binding-event.json  # offline, a saved event ("-" reads stdin)
npx tsx bin/tambat.ts lookup <npub>                     # newest binding of a Nostr key, from relays
npx tsx bin/tambat.ts lookup bitcoincash:<address>      # Nostr keys that bind this address, from relays
```

Add `--json` for the full result: every step, its status and reason, and the checked event. Exit code 0 means verified, 1 not
verified, 2 a usage error. `lookup` asks the relays listed in `config/tambat.json`; edit that list to use your own.

Example output for the test vector:

```
VERIFIED  npub1az708q3kd9zy6z6f44zav5ygvdwelkzspf6mtusttx47lft2z38sghk0w7
  pass event_shape
  pass kind
  pass event_id
  pass nostr_sig
  skip newest: no relay results given; run lookup to check for a newer event
  claim bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6
    pass bch_sig
    pass address_match
    pass network
    pass key_separation
```

`newest` is skipped offline because only relays can tell whether a newer event replaced this one. `lookup` runs it.

The same CLI reads the records that build on a binding, each with its own checks ([SPEC](SPEC.md)):

```
npx tsx bin/tambat.ts attestations <npub>                # attestations that pin the current binding event
npx tsx bin/tambat.ts receipt <txid>                     # receipts for a transaction, inputs read from a chain server
npx tsx bin/tambat.ts anchor-lookup bitcoincash:<address>  # optional BCH anchor, read from the chain only, no relays
```

`anchor-lookup` asks every chain server in `anchor.electrum` and prints a result only when at least `anchor.quorum` of
them answered alike ("read from N of M chain servers"); otherwise it names the servers that differed or did not answer and
exits 1. Each commitment is listed oldest block first, and a revocation by transaction is marked `revokes`. The newest
confirmed commitment decides whether the address is bound, revoked or given to another key ([SPEC](SPEC.md#revoke-by-transaction)).

A recovered binding needs no extra command: `lookup` checks the `replaces` tag and prints where the binding came from.

## By hand

### 1. Fetch the event

Send this to any relay with a WebSocket client, with the author's hex pubkey (decode the npub with any NIP-19 tool):

```
["REQ", "check", {"kinds": [10011], "authors": ["<pubkey hex>"]}]
```

Ask more than one relay. Keep the event with the largest `created_at`; that is the binding in force. If it has no
`bch:` tag, the claim was revoked. To start from an address instead, send
`["REQ", "check", {"kinds": [10011], "#i": ["bch:<cashaddr>"]}]`, then repeat the step above for each author found: only an
author whose newest event still carries the address counts.

### 2. Check the event id

The id is SHA-256 of the NIP-01 serialisation. With `jq` and `sha256sum`:

```
jq -cj '[0,.pubkey,.created_at,.kind,.tags,.content]' event.json | sha256sum
jq -r .id event.json
```

Both lines must print the same hex. (For events whose content or tags hold unusual characters, use a NIP-01 library instead:
`jq` escapes a few characters differently.)

### 3. Check the Nostr signature

Use any NIP-01 library or client that verifies events, for example `verifyEvent` in `nostr-tools`. The signature is BIP-340
Schnorr over the id with the `pubkey`.

### 4. Check the BCH signature and the address

Take the `bch:` tag: `["i", "bch:<cashaddr>", "<signature>"]`. In Electron Cash, open **Tools > Sign/verify message** and enter:

- Address: the CashAddr from the tag.
- Message: `Verifying that I control the following Nostr public key: <npub>`, with the npub of the event author (not one
  given to you by someone else).
- Signature: the third element of the tag.

**Verify** must succeed. This checks `bch_sig` and `address_match` together: the signature recovers to the key of that
address over the text for this author.

### 5. Check the rest

- The address prefix is the network you expect (`bitcoincash:` for mainnet).
- The BCH key is not the Nostr key. A wallet message verifier does not show the recovered key; `tambat verify --json` prints it
  as `bchPublicKey`. Its 32 bytes after the first byte must differ from the event `pubkey`.

## An on-chain proof

Some NIP-39 clients, and the WizardConnect option on Link, write `bitcoincash:tx:<txid>` in place of a signature: a
transaction spent from the claimed address with one output `OP_RETURN <verification text>` ([SPEC](SPEC.md)). The CLI reads
the transaction from the chain servers in `anchor.electrum` and counts it only when at least `anchor.quorum` of them agree.
A real one, written by another client and kept as test data:

```sh
jq .event tests/fixtures/tx-proof-mainnet.json | npx tsx bin/tambat.ts verify -
```

It exits 0 and prints `tx_found`, `address_match`, `tx_text`, `network` and `key_separation` as passed for the claim marked
`on-chain proof`. With no chain server answering, the claim is skipped and does not pass: there is no proof without the chain.

By hand, with any block explorer:

1. Open the transaction `<txid>` from the tag. Its id is the double SHA-256 of the raw transaction, so a confirmed
   transaction cannot be swapped for another.
2. One input spends from the claimed address (explorers show the input address).
3. One output is `OP_RETURN` with a single push. Decode its hex as UTF-8: it must equal the output of
   `npx tsx bin/tambat.ts text <npub of the event author>`, byte for byte.

The CLI also runs the whole transaction through the BCH virtual machine (libauth), which an explorer's address label does
not prove on its own.

## An attestation credential

An attestation exported as a W3C Verifiable Credential 2.0 ([ADR 0017](decisions/0017-attestation-verifiable-credential.md))
carries the signed attestation event and the signed binding event in its proof. Check one with no network:

```sh
npx tsx bin/tambat.ts vc verify examples/attestation-vc.json
```

It exits 0 and prints the issuer, subject, address, binding id and attestation id when both events verify and every field of
the credential matches them, compared as RFC 8785 canonical JSON. A changed field, issuer or proof exits 1 and names the
check that failed. The one-file verifier accepts the same file. A pass shows who attested which binding and when; whether the
binding is still current needs the relays: `npx tsx bin/tambat.ts attestations <npub>`.

## A reputation file

A portable reputation file ([SPEC](SPEC.md#portable-reputation)) is counted again from its signed events; the counts it
states are only compared with the recount. Check one with no network:

```sh
npx tsx bin/tambat.ts rep verify examples/reputation-bundle.json
```

It exits 0 and lists each credential as counted or skipped with its reason (for the example: 2 counted of 4, one skipped
because the holder attests itself and one because it pins an older binding). Change `"attestations": 2` to `3` in a copy
and it exits 1 with `a claimed count differs from the recount`. Offline, a pass cannot show that no newer binding exists:
`npx tsx bin/tambat.ts lookup <npub>` answers that. Add `--chain` to compare a stated anchor block with the chain.

## A selective disclosure presentation

A presentation ([SPEC](SPEC.md#selective-disclosure), [ADR 0019](decisions/0019-selective-disclosure.md)) reveals some
fields of a credential and hides the rest behind salted digests. Check one with no network:

```sh
npx tsx bin/tambat.ts sd verify examples/sd-presentation.json
```

It exits 0, prints the revealed BCH address with a note that its BCH signature for the holder's npub was checked, and
reports 3 of 4 fields hidden. A changed value, an unknown or repeated disclosure, or a broken proof exits 1 and names the
step. A pass shows what the holder chose to reveal; it is not a zero-knowledge proof, and whoever receives a presentation
can show it again.

## The library package

The `@tambat/core` tarball in [`docs/pkg/`](pkg/) is built by `npx tsx scripts/pack-core.ts`. Check that it is the file the
repository records, then build it again from the source and compare:

```sh
cd docs/pkg && sha256sum -c SHA256SUMS && cd ../..
npx tsx scripts/pack-core.ts && git diff --exit-code docs/pkg/
```

`tests/core-package.test.ts` installs the tarball into an empty folder and runs both library examples against it.

The same two files are attached to the GitHub release `core-v<version>`. A downloaded copy is checked the same way:
`sha256sum -c SHA256SUMS` in the download folder, and the hash equals the line in `docs/pkg/SHA256SUMS` of the tagged commit.

## Check the checker

The reference code that all three ways rely on is tested against vectors from outside this project: the BIP-340 test vectors,
the CashAddr specification examples and the Electron Cash signed-message tests, each pinned to a commit in
[examples/third-party-vectors.json](../examples/third-party-vectors.json). Run them with
`npx vitest run tests/third-party-vectors.test.ts`. The claim format is written up as [NIP-39-bch.md](NIP-39-bch.md).

## What a pass means

A verified binding proves that, when the event was signed, one person held the private key of the address and the private key
of the npub. It does not prove who that person is, that the keys are still held, or anything about the address balance. See the
threat model in the [README](../README.md#security-and-threat-model).
