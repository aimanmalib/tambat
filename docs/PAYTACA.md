# Adding Tambat bindings to a wallet (Paytaca)

A wallet that holds a BIP39 phrase already holds both keys of a binding. Paytaca derives its Nostr key from the wallet phrase
with NIP-06 at `m/44'/1237'/0'/0/0` (`src/wallet/nostr.js` in `paytaca/paytaca-app`), and its default BCH receiving key is at
`m/44'/145'/0'/0/0`. So the wallet can publish a binding with no new key, no account and no server: one signed message and one
Nostr event.

## Today, with no wallet change

Paytaca already answers `bch_signMessage` over WalletConnect. In the web app, **Link** connects Paytaca by QR code, asks it to
sign the verification text, and publishes the event with the user's Nostr key (NIP-07 extension, NIP-46 remote signer or a demo
key). Any wallet with "Sign message" works the same way through the paste option.

This path has been used with a real Paytaca wallet: on 2026-11-17 a binding was signed with a Paytaca wallet over
WalletConnect and published to public relays; [the measurements](MEASURED.md) give the event id, the address and the relays
that return it. The app's WalletConnect calls (`bch_signMessage` with `{ message }`, a `bch:<cashaddr>` session account) are
tested end to end against a fake wallet that answers the same way; the WalletConnect relay network and a real phone wallet are
not covered by automated tests, because they cannot drive a phone. The paste path and the signature format are tested.

## Inside the wallet

1. Build the verification text from the wallet's own npub:
   `Verifying that I control the following Nostr public key: <npub>`.
2. Sign it with the BCH receiving key in the signed-message format (the format `bch_signMessage` already returns).
3. Read the user's current kind `10011` event from the wallet's relays, keep its other `i` tags, add or replace
   `["i", "bch:<cashaddr>", "<signature>"]`, sign with the Nostr key and publish.
4. To revoke, publish a newer kind `10011` event without the `bch:` tag.

The code below does steps 1 and 2 and the signing in step 3 with only `@bitauth/libauth` and `nostr-tools`. It is taken from
[examples/paytaca-binding.ts](../examples/paytaca-binding.ts); `tests/paytaca-example.test.ts` checks that this block matches
the file, that the event passes every verification step, and that it equals the library's output.

```ts
import {
  bigIntToCompactUint, binToBase64, deriveHdPath, deriveHdPrivateNodeFromBip39Mnemonic,
  encodeCashAddress, flattenBinArray, hash160, hash256, secp256k1, utf8ToBin,
} from '@bitauth/libauth';
import { npubEncode } from 'nostr-tools/nip19';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';

/** Electron Cash "Sign message" and Paytaca bch_signMessage format: base64 of header || r || s. */
function signMessage(privateKey: Uint8Array, message: string): string {
  const magic = utf8ToBin('Bitcoin Signed Message:\n');
  const body = utf8ToBin(message);
  const len = (b: Uint8Array) => bigIntToCompactUint(BigInt(b.length));
  const digest = hash256(flattenBinArray([len(magic), magic, len(body), body]));
  const sig = secp256k1.signMessageHashRecoverableCompact(privateKey, digest);
  if (typeof sig === 'string') throw new Error(sig);
  return binToBase64(flattenBinArray([Uint8Array.of(31 + sig.recoveryId), sig.signature]));
}

export function makeBinding(phrase: string, createdAt = Math.floor(Date.now() / 1000)) {
  const root = deriveHdPrivateNodeFromBip39Mnemonic(phrase);
  const bchKey = deriveHdPath(root, "m/44'/145'/0'/0/0").privateKey; // BCH receiving key
  const nostrKey = deriveHdPath(root, "m/44'/1237'/0'/0/0").privateKey; // NIP-06 Nostr key
  const bchPublicKey = secp256k1.derivePublicKeyCompressed(bchKey);
  if (typeof bchPublicKey === 'string') throw new Error(bchPublicKey);
  const address = encodeCashAddress({ prefix: 'bitcoincash', type: 'p2pkh', payload: hash160(bchPublicKey) }).address;
  const npub = npubEncode(getPublicKey(nostrKey));
  // 1. The BCH key signs the NIP-39 verification text for the npub.
  const signature = signMessage(bchKey, `Verifying that I control the following Nostr public key: ${npub}`);
  // 2. The Nostr key signs a kind 10011 event carrying the claim. A real wallet keeps the user's other "i" tags.
  const tags = [['i', `bch:${address}`, signature]];
  return finalizeEvent({ kind: 10011, created_at: createdAt, content: '', tags }, nostrKey);
}
```

Run it with the public test phrase: `npx tsx examples/paytaca-binding.ts | npx tsx bin/tambat.ts verify -`.

## What the wallet can show

- **Look-up before paying**: given an npub, fetch the newest kind `10011` event and show the address only when it verifies
  ([SPEC.md](SPEC.md) sections 5 and 6). The `bch:` tag is then a payment address the payer can trust as much as the npub.
- **Sign-in**: a wallet that already signs NIP-98 events can answer a relying app's challenge ([SPEC.md](SPEC.md) section 7).
  A wallet with only `bch_signMessage` can sign in too: it signs the challenge text, and the app finds the Nostr key linked to
  the address on relays (the demo app's "Sign in with a BCH wallet").

## Notes for wallet authors

- Never sign the verification text for an npub the wallet does not control: the signature is a public claim.
- Use a P2PKH receiving address. The wallet's Nostr key and BCH key must be different keys; NIP-06 and BIP44 paths give that.
- A wallet that rotates receiving addresses can bind one long-lived address and keep it, or publish a new binding for each
  change; verifiers use the newest event.
