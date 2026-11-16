/** CashAddr helpers for P2PKH claims. Only P2PKH can be bound: a signed message proves control of one public key. */
import { decodeCashAddress, encodeCashAddress, hash160 } from '@bitauth/libauth';
import type { Network } from '../config.js';

export interface P2pkhAddress {
  /** Full lowercase CashAddr with prefix, for example `bitcoincash:qq...`. */
  address: string;
  prefix: string;
  /** 20-byte public key hash. */
  payload: Uint8Array;
}

/** Encodes the P2PKH CashAddr of a public key (compressed or uncompressed) on a network. */
export function addressFromPublicKey(publicKey: Uint8Array, network: Network): string {
  return encodeCashAddress({ prefix: network, type: 'p2pkh', payload: hash160(publicKey) }).address;
}

/**
 * Parses a CashAddr that must carry its prefix. Returns an error string for anything else,
 * including P2SH and token-aware types, so callers can show the reason.
 */
export function parseP2pkhAddress(input: string): P2pkhAddress | string {
  const address = input.trim().toLowerCase();
  if (!address.includes(':')) return 'address must include its network prefix, for example bitcoincash:';
  const decoded = decodeCashAddress(address);
  if (typeof decoded === 'string') return `invalid CashAddr: ${decoded}`;
  if (decoded.type !== 'p2pkh') return `only P2PKH addresses can be bound, got ${decoded.type}`;
  return { address, prefix: decoded.prefix, payload: decoded.payload };
}
