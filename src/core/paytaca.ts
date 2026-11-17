/**
 * How a wallet that holds a BIP39 phrase, like Paytaca, already holds both keys of a binding:
 * the BCH receiving key at m/44'/145'/0'/0/0 and the NIP-06 Nostr key at m/44'/1237'/0'/0/0.
 * Used by tests and documentation only. The web app never asks for a phrase.
 */
import { deriveHdPath, deriveHdPrivateNodeFromBip39Mnemonic, secp256k1 } from '@bitauth/libauth';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import type { Network } from '../config.js';
import { signMessage } from './bchmsg.js';
import { createBindingEvent } from './binding.js';
import { addressFromPublicKey } from './cashaddr.js';
import { toNpub, verificationText, type Event } from './nostr.js';

export const BCH_PATH = "m/44'/145'/0'/0/0";
/** Receiving address `index` on the same account, as a phrase wallet shows the next address. */
export const bchPath = (index: number): string => `m/44'/145'/0'/0/${index}`;
export const NOSTR_PATH = "m/44'/1237'/0'/0/0";

export interface PhraseKeys {
  bchPrivateKey: Uint8Array;
  bchPublicKey: Uint8Array;
  address: string;
  nostrSecretKey: Uint8Array;
  nostrPubkey: string;
  npub: string;
}

function privateKeyAt(phrase: string, path: string): Uint8Array {
  const node = deriveHdPath(deriveHdPrivateNodeFromBip39Mnemonic(phrase), path);
  return node.privateKey;
}

/** Derives both keys of a binding from one BIP39 phrase, as Paytaca does. */
export function keysFromPhrase(phrase: string, network: Network): PhraseKeys {
  const bchPrivateKey = privateKeyAt(phrase, BCH_PATH);
  const bchPublicKey = secp256k1.derivePublicKeyCompressed(bchPrivateKey);
  if (typeof bchPublicKey === 'string') throw new Error(bchPublicKey);
  const nostrSecretKey = privateKeyAt(phrase, NOSTR_PATH);
  const nostrPubkey = getPublicKey(nostrSecretKey);
  return {
    bchPrivateKey,
    bchPublicKey,
    address: addressFromPublicKey(bchPublicKey, network),
    nostrSecretKey,
    nostrPubkey,
    npub: toNpub(nostrPubkey),
  };
}

type BchKey = Pick<PhraseKeys, 'bchPrivateKey' | 'bchPublicKey' | 'address'>;

/**
 * The first `count` BCH receiving keys of a phrase, as a phrase wallet shows its next addresses. The seed is
 * derived once (it is the slow step), so searching many addresses stays cheap.
 */
export function bchKeysOf(phrase: string, count: number, network: Network): BchKey[] {
  const root = deriveHdPrivateNodeFromBip39Mnemonic(phrase);
  return Array.from({ length: count }, (_, index) => {
    const bchPrivateKey = deriveHdPath(root, bchPath(index)).privateKey;
    const bchPublicKey = secp256k1.derivePublicKeyCompressed(bchPrivateKey);
    if (typeof bchPublicKey === 'string') throw new Error(bchPublicKey);
    return { bchPrivateKey, bchPublicKey, address: addressFromPublicKey(bchPublicKey, network) };
  });
}

/** The BCH receiving key and address at `index` of a phrase. */
export const bchKeyAt = (phrase: string, index: number, network: Network): BchKey =>
  bchKeysOf(phrase, index + 1, network)[index] as BchKey;

/** Signs the verification text with the BCH key and the binding event with the Nostr key. */
export function bindingFromKeys(
  keys: Pick<PhraseKeys, 'bchPrivateKey' | 'address' | 'nostrSecretKey' | 'npub'>,
  createdAt: number,
  previous?: Pick<Event, 'tags' | 'content'> | null,
): Event {
  const signature = signMessage(keys.bchPrivateKey, verificationText(keys.npub));
  const template = createBindingEvent({ claim: { address: keys.address, signature }, previous: previous ?? null, createdAt });
  return finalizeEvent(template, keys.nostrSecretKey);
}
