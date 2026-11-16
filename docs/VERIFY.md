# Verify a binding yourself

You do not need our web app or our server to check a binding. This page shows two ways: the command-line verifier from this
repository, and the same checks by hand with general tools. The algorithm is in [SPEC.md](SPEC.md) section 5.

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

## What a pass means

A verified binding proves that, when the event was signed, one person held the private key of the address and the private key
of the npub. It does not prove who that person is, that the keys are still held, or anything about the address balance. See the
threat model in the [README](../README.md#security-and-threat-model).
