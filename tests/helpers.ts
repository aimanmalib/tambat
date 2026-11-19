/** Shared fixtures for core tests. Keys come only from the public BIP39 phrase "abandon ... about". */
import { readFileSync } from 'node:fs';
import { deriveHdPath, deriveHdPrivateNodeFromBip39Mnemonic, secp256k1 } from '@bitauth/libauth';
import { getPublicKey } from 'nostr-tools/pure';
import type { Filter, QueryFn } from '../src/core/discover.js';
import { addressFromPublicKey } from '../src/core/cashaddr.js';
import { toNpub, type Event } from '../src/core/nostr.js';
import { keysFromPhrase, type PhraseKeys } from '../src/core/paytaca.js';

export const vectors = JSON.parse(readFileSync(new URL('../examples/vectors.json', import.meta.url), 'utf8')) as {
  phrase: string;
  nostr: { pubkey: string; npub: string };
  bch: { publicKey: string; address: { bitcoincash: string; bchtest: string } };
  bchSignature: string;
  bindingEvent: Event;
  external: { message: string; signature: string; legacyAddress: string };
};

export const keys = keysFromPhrase(vectors.phrase, 'bitcoincash');
/** Keys at account 1 of the same public phrase, standing in for a second person. */
function account(index: number): PhraseKeys {
  const root = deriveHdPrivateNodeFromBip39Mnemonic(vectors.phrase);
  const bchPrivateKey = deriveHdPath(root, `m/44'/145'/${index}'/0/0`).privateKey;
  const nostrSecretKey = deriveHdPath(root, `m/44'/1237'/${index}'/0/0`).privateKey;
  const bchPublicKey = secp256k1.derivePublicKeyCompressed(bchPrivateKey) as Uint8Array;
  const nostrPubkey = getPublicKey(nostrSecretKey);
  return {
    bchPrivateKey,
    bchPublicKey,
    address: addressFromPublicKey(bchPublicKey, 'bitcoincash'),
    nostrSecretKey,
    nostrPubkey,
    npub: toNpub(nostrPubkey),
  };
}
export const other = account(1);
/** Account 2 of the same phrase: a third person. */
export const third = account(2);

export const clone = (e: Event): Event => JSON.parse(JSON.stringify(e)) as Event;

/** An in-process relay: answers ids, authors and tag (#i, #p, #L) filters from a fixed list, like a NIP-01 relay would. */
export function fakeRelay(events: unknown[]): QueryFn {
  return async (_relays: string[], filter: Filter) =>
    events.filter((raw) => {
      const e = raw as Event;
      if (!e || typeof e !== 'object' || !Array.isArray(e.tags)) return true; // relays may return junk
      if (filter.kinds && !filter.kinds.includes(e.kind)) return false;
      if (filter.authors && !filter.authors.includes(e.pubkey)) return false;
      if (filter.ids && !filter.ids.includes(e.id)) return false;
      return Object.entries(filter)
        .filter(([name]) => name.startsWith('#'))
        .every(([name, wanted]) => e.tags.some((t) => t[0] === name.slice(1) && (wanted as string[]).includes(t[1] ?? '')));
    });
}
