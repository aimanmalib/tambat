/** BCH signers: a throwaway demo key in memory, or a wallet over WalletConnect (see walletconnect.ts). */
import { secp256k1 } from '@bitauth/libauth';
import { config } from '../../src/config.js';
import { signMessage } from '../../src/core/bchmsg.js';
import { addressFromPublicKey } from '../../src/core/cashaddr.js';

export type BchSignerKind = 'walletconnect' | 'demo';

export interface BchSigner {
  kind: BchSignerKind;
  address: string;
  signMessage(text: string): Promise<string>;
  /** WalletConnect only: send any request of the session's methods to the wallet (see anchor.ts). */
  request?(method: string, params: unknown): Promise<unknown>;
  /**
   * WalletConnect only: called once when the wallet ends the session (`session_delete`) or it expires
   * (`session_expire`). Requests still waiting are rejected at that moment (docs/decisions/0025-wallet-disconnect.md).
   */
  onEnd?(listener: () => void): void;
}

export function demoBchSigner(): BchSigner {
  let secret = crypto.getRandomValues(new Uint8Array(32));
  while (!secp256k1.validatePrivateKey(secret)) secret = crypto.getRandomValues(new Uint8Array(32));
  const publicKey = secp256k1.derivePublicKeyCompressed(secret);
  if (typeof publicKey === 'string') throw new Error(publicKey);
  return {
    kind: 'demo',
    address: addressFromPublicKey(publicKey, config.network),
    signMessage: async (text) => signMessage(secret, text),
  };
}
