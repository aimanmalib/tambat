/**
 * A stand-in for the wallet side of wc2-bch-bcr signing (tests and e2e only). The signing itself is shared with the
 * demo key script: src/core/anchor-sign.ts.
 */
import { binToHex } from '@bitauth/libauth';

export { signP2pkh } from '../src/core/anchor-sign.js';

export const hexOf = (bytes: Uint8Array): string => binToHex(bytes);
