/**
 * Runs the pinned third-party vectors in examples/third-party-vectors.json through src/core/: BIP-340 signatures through
 * the Nostr signature check, CashAddr spec addresses through the P2PKH parser, and Electron Cash signed messages through
 * signer recovery plus the address check. Each vector is data with a pinned source and license.
 */
import { readFileSync } from 'node:fs';
import { binToHex, decodeBase58Address } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import { recoverSigner } from '../src/core/bchmsg.js';
import { keyControlsPayload, parseP2pkhAddress } from '../src/core/cashaddr.js';
import { schnorrValid } from '../src/core/nostr.js';

interface Pinned {
  source: string;
  license: string;
}
interface Bip340Vector extends Pinned {
  index: number;
  publicKey: string;
  message: string;
  signature: string;
  valid: boolean;
  comment: string;
}
interface CashAddrVector extends Pinned {
  table: string;
  address: string;
  legacyAddress?: string;
  p2pkh?: boolean;
  size?: number;
  type?: number;
  payload?: string;
}
interface SignedMessageVector extends Pinned {
  message: string;
  signature: string;
  legacyAddress: string;
  valid: boolean;
  note: string;
}

const file = JSON.parse(readFileSync(new URL('../examples/third-party-vectors.json', import.meta.url), 'utf8')) as {
  bip340: Bip340Vector[];
  cashaddr: CashAddrVector[];
  signedMessage: SignedMessageVector[];
};

function legacyPayload(address: string): Uint8Array {
  const decoded = decodeBase58Address(address);
  if (typeof decoded === 'string') throw new Error(decoded);
  return decoded.payload;
}

/** Address checks a binding relies on, applied to one signed message. */
function signedBy(v: SignedMessageVector): boolean {
  const signer = recoverSigner(v.message, v.signature);
  return typeof signer !== 'string' && keyControlsPayload(signer.publicKey, legacyPayload(v.legacyAddress));
}

describe('every vector is pinned', () => {
  it('has a source at a fixed commit and a license', () => {
    const all = [...file.bip340, ...file.cashaddr, ...file.signedMessage];
    expect(file.bip340.length).toBeGreaterThan(0);
    expect(file.cashaddr.length).toBeGreaterThan(0);
    expect(file.signedMessage.length).toBeGreaterThan(0);
    for (const v of all) {
      expect(v.source).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\/[0-9a-f]{40}\//);
      expect(v.license).toMatch(/^(MIT|BSD-2-Clause)$/);
    }
  });
});

describe('BIP-340 test vectors', () => {
  it.each(file.bip340.map((v) => [v.index, v.comment, v] as const))('vector %i %s', (_i, _c, v) => {
    expect(schnorrValid(v.publicKey, v.message, v.signature)).toBe(v.valid);
  });

  it('covers both outcomes and messages that are not 32 bytes', () => {
    expect(file.bip340.some((v) => v.valid) && file.bip340.some((v) => !v.valid)).toBe(true);
    expect(file.bip340.some((v) => v.valid && v.message.length !== 64)).toBe(true);
  });
});

describe('CashAddr spec vectors', () => {
  const translation = file.cashaddr.filter((v) => v.legacyAddress);
  const sized = file.cashaddr.filter((v) => v.size !== undefined);

  it.each(translation.map((v) => [v.address, v] as const))('translation %s', (_a, v) => {
    const parsed = parseP2pkhAddress(v.address);
    if (v.p2pkh) {
      if (typeof parsed === 'string') throw new Error(parsed);
      expect(binToHex(parsed.payload)).toBe(binToHex(legacyPayload(v.legacyAddress ?? '')));
    } else {
      expect(parsed).toMatch(/only P2PKH/);
    }
  });

  it.each(sized.map((v) => [v.size, v.type, v.address, v] as const))('size %i type %i %s', (_s, _t, _a, v) => {
    const parsed = parseP2pkhAddress(v.address);
    if (v.type === 0 && v.size === 20) {
      if (typeof parsed === 'string') throw new Error(parsed);
      expect(binToHex(parsed.payload)).toBe(v.payload);
      expect(parsed.prefix).toBe(v.address.split(':')[0]);
    } else {
      expect(typeof parsed).toBe('string');
    }
  });

  it('rejects a type 0 address whose hash is longer than 20 bytes', () => {
    const long = sized.find((v) => v.type === 0 && v.size === 24);
    expect(parseP2pkhAddress(long?.address ?? '')).toMatch(/20 bytes/);
  });

  it('rejects any one changed character through the checksum', () => {
    for (const v of sized) {
      const i = v.address.length - 3;
      const c = v.address[i] === 'q' ? 'p' : 'q';
      expect(typeof parseP2pkhAddress(v.address.slice(0, i) + c + v.address.slice(i + 1))).toBe('string');
    }
  });
});

describe('Electron Cash signed-message vectors', () => {
  it.each(file.signedMessage.map((v, i) => [i, v.note, v] as const))('vector %i %s', (_i, _n, v) => {
    expect(signedBy(v)).toBe(v.valid);
  });

  it('includes compressed and uncompressed signers', () => {
    const kinds = file.signedMessage
      .filter((v) => v.valid)
      .map((v) => recoverSigner(v.message, v.signature))
      .map((s) => typeof s !== 'string' && s.compressed);
    expect(new Set(kinds)).toEqual(new Set([true, false]));
  });

  it('fails when one byte of a valid signature changes', () => {
    const v = file.signedMessage.find((x) => x.valid);
    if (!v) throw new Error('no valid vector');
    const bytes = Buffer.from(v.signature, 'base64');
    bytes[40] = (bytes[40] ?? 0) ^ 1;
    expect(signedBy({ ...v, signature: bytes.toString('base64') })).toBe(false);
  });
});
