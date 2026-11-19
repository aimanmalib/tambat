# @tambat/core

The library behind Tambat: write, find and verify NIP-39 bindings (kind 10011) between a Bitcoin Cash key and a
Nostr key. ESM only, Node 22 or a modern browser bundler, TypeScript types included.

This package is not on the npm registry. Install it from the tarball kept in the Tambat repository:

```sh
npm install ./tambat-core-<version>.tgz
```

Check the file against `SHA256SUMS` next to it first (`sha256sum -c SHA256SUMS`).

## Verify a binding (Nostr client)

```ts
import { verifyBinding } from '@tambat/core';

const result = verifyBinding(event); // a kind 10011 event from any relay
if (result.ok) console.log(result.npub, '->', result.claims[0]?.address);
```

`lookupByPubkey(npubOrHex)` and `lookupByAddress(cashaddr)` query the configured relays and return the same result.

## Write a binding (wallet)

```ts
import { createBindingEvent, verificationText } from '@tambat/core';

const text = verificationText(npub);      // the wallet signs this with its BCH key (bch_signMessage)
const template = createBindingEvent({ claim: { address, signature } });
// sign `template` with the Nostr key (NIP-07, NIP-46 or the wallet's own key) and publish it
```

## Config

Relays, network, event kinds and timeouts start from the values the package was built with. Change any of them
once at start-up; every function reads the new values, and a bad value throws without changing anything:

```ts
import { configure } from '@tambat/core';

configure({ network: 'bchtest', nostr: { relays: ['wss://relay.example'] } });
```

The protocol is described in `docs/SPEC.md` of the Tambat repository. License: MIT.
