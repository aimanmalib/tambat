/**
 * Bitcoin Cash signed messages in the format used by Electron Cash "Sign message" and Paytaca `bch_signMessage`:
 * preimage = 0x18 | "Bitcoin Signed Message:\n" | CompactSize(len) | message, digest = double SHA-256,
 * signature = header byte (recovery id + 27, or + 31 for a compressed key) | r | s, base64 encoded.
 */
import {
  base64ToBin,
  binToBase64,
  bigIntToCompactUint,
  flattenBinArray,
  hash256,
  secp256k1,
  utf8ToBin,
  type RecoveryId,
} from '@bitauth/libauth';

const MAGIC = utf8ToBin('Bitcoin Signed Message:\n');

/** Double SHA-256 digest of the signed-message preimage. */
export function messageHash(message: string): Uint8Array {
  const body = utf8ToBin(message);
  return hash256(
    flattenBinArray([bigIntToCompactUint(BigInt(MAGIC.length)), MAGIC, bigIntToCompactUint(BigInt(body.length)), body]),
  );
}

/** Signs a message with a private key and returns the base64 signature (compressed-key header). */
export function signMessage(privateKey: Uint8Array, message: string): string {
  const result = secp256k1.signMessageHashRecoverableCompact(privateKey, messageHash(message));
  if (typeof result === 'string') throw new Error(`signing failed: ${result}`);
  return binToBase64(flattenBinArray([Uint8Array.of(31 + result.recoveryId), result.signature]));
}

export interface RecoveredSigner {
  /** Public key in the encoding the signature header declares (33 bytes compressed, 65 uncompressed). */
  publicKey: Uint8Array;
  compressed: boolean;
}

/** Recovers the signing public key from a base64 signature over a message, or returns the reason it cannot. */
export function recoverSigner(message: string, signatureBase64: string): RecoveredSigner | string {
  const text = signatureBase64.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return 'signature is not base64';
  const bytes = base64ToBin(text);
  if (bytes.length !== 65) return `signature must be 65 bytes, got ${bytes.length}`;
  const header = bytes[0] ?? 0;
  if (header < 27 || header > 34) return `unsupported signature header ${header}`;
  const compressed = header >= 31;
  const recoveryId = ((header - 27) & 3) as RecoveryId;
  const compact = bytes.slice(1);
  const hash = messageHash(message);
  const publicKey = compressed
    ? secp256k1.recoverPublicKeyCompressed(compact, recoveryId, hash)
    : secp256k1.recoverPublicKeyUncompressed(compact, recoveryId, hash);
  if (typeof publicKey === 'string') return `public key recovery failed: ${publicKey}`;
  return { publicKey, compressed };
}
