/**
 * How a wallet that already holds a BIP39 phrase writes a binding, using only @bitauth/libauth and nostr-tools.
 * Paytaca derives its Nostr key from the wallet phrase (NIP-06), so it holds both keys already.
 * Run: npx tsx examples/paytaca-binding.ts  (public test phrase; never put a real phrase in code)
 */
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  console.log(JSON.stringify(makeBinding(phrase), null, 2));
}
