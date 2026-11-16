import { binToHex, decodeBase58Address, hash160 } from '@bitauth/libauth';
import { privateKeyFromSeedWords } from 'nostr-tools/nip06';
import { getPublicKey } from 'nostr-tools/pure';
import { describe, expect, it } from 'vitest';
import { messageHash, recoverSigner, signMessage } from '../src/core/bchmsg.js';
import { parseP2pkhAddress } from '../src/core/cashaddr.js';
import { verificationText } from '../src/core/nostr.js';
import { keysFromPhrase } from '../src/core/paytaca.js';
import { keys, vectors } from './helpers.js';

describe('keys from the public BIP39 test phrase', () => {
  it('derives the well-known BIP44 BCH address and the vector npub', () => {
    expect(keys.address).toBe('bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6');
    expect(keys.npub).toBe(vectors.nostr.npub);
    expect(keysFromPhrase(vectors.phrase, 'bchtest').address).toBe(vectors.bch.address.bchtest);
  });

  it('matches an independent NIP-06 derivation', () => {
    expect(getPublicKey(privateKeyFromSeedWords(vectors.phrase))).toBe(vectors.nostr.pubkey);
  });
});

describe('signed messages', () => {
  it('reproduces the vector signature and recovers the vector key', () => {
    const text = verificationText(keys.npub);
    expect(text.endsWith(`: ${vectors.nostr.npub}`)).toBe(true);
    expect(signMessage(keys.bchPrivateKey, text)).toBe(vectors.bchSignature);
    const signer = recoverSigner(text, vectors.bchSignature);
    expect(signer).toMatchObject({ compressed: true });
    expect(typeof signer !== 'string' && binToHex(signer.publicKey)).toBe(vectors.bch.publicKey);
  });

  it('verifies an externally published uncompressed-key signature', () => {
    const { message, signature, legacyAddress } = vectors.external;
    const signer = recoverSigner(message, signature);
    if (typeof signer === 'string') throw new Error(signer);
    expect(signer.compressed).toBe(false);
    const decoded = decodeBase58Address(legacyAddress);
    if (typeof decoded === 'string') throw new Error(decoded);
    expect(binToHex(hash160(signer.publicKey))).toBe(binToHex(decoded.payload));
  });

  it('hashes different messages differently', () => {
    expect(binToHex(messageHash('a'))).not.toBe(binToHex(messageHash('b')));
  });

  it('rejects malformed signatures with a reason', () => {
    expect(recoverSigner('x', 'not base64!')).toMatch(/base64/);
    expect(recoverSigner('x', 'AAAA')).toMatch(/65 bytes/);
    expect(recoverSigner('x', Buffer.alloc(65, 1).toString('base64'))).toMatch(/header/);
  });
});

describe('CashAddr parsing', () => {
  it('accepts a prefixed P2PKH address in any case', () => {
    const parsed = parseP2pkhAddress(vectors.bch.address.bitcoincash.toUpperCase());
    expect(parsed).toMatchObject({ prefix: 'bitcoincash', address: vectors.bch.address.bitcoincash });
  });

  it('rejects missing prefix, bad checksum and P2SH', () => {
    expect(parseP2pkhAddress(vectors.bch.address.bitcoincash.split(':')[1] ?? '')).toMatch(/prefix/);
    expect(parseP2pkhAddress(`${vectors.bch.address.bitcoincash.slice(0, -1)}q`)).toMatch(/invalid/);
    expect(parseP2pkhAddress('bitcoincash:pp8skudq3x5hzw8ew7vzsw8tn4k8wxsqsv0lt0mf3g')).toMatch(/P2PKH/);
  });
});
