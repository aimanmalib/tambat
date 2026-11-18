/**
 * Chain first: what the confirmed commitments of an address say about a binding found on the relays. The newest
 * confirmed commitment decides (docs/decisions/0013-revoke-by-transaction.md):
 * - `bound`: it commits to the same Nostr key as the relay binding;
 * - `revoked`: it revokes that key;
 * - `conflict`: it commits to another key, so the relay binding contradicts the chain and the chain wins;
 * - `none`: no confirmed commitment, or the last one revokes a key that is not the relay binding's.
 * Transactions not yet in a block do not count.
 */
import { chainOrder, earliestCommitment, type Commitment } from './anchor.js';

export type ChainVerdict =
  | { kind: 'none' }
  | { kind: 'bound'; since: Commitment }
  | { kind: 'revoked'; revocation: Commitment }
  | { kind: 'conflict'; chainPubkey: string; commitment: Commitment };

/** The newest confirmed commitment or revocation of an address, or null. */
export function latestCommitment(commitments: Commitment[]): Commitment | null {
  const confirmed = commitments.filter((c) => c.height > 0).sort(chainOrder);
  return confirmed[confirmed.length - 1] ?? null;
}

export function chainVerdict(commitments: Commitment[], relayPubkey: string): ChainVerdict {
  const latest = latestCommitment(commitments);
  if (!latest) return { kind: 'none' };
  if (latest.action === 'revoke') return latest.pubkey === relayPubkey ? { kind: 'revoked', revocation: latest } : { kind: 'none' };
  if (latest.pubkey !== relayPubkey) return { kind: 'conflict', chainPubkey: latest.pubkey, commitment: latest };
  return { kind: 'bound', since: earliestCommitment(commitments, relayPubkey) ?? latest };
}

/** True when a payment to the address of this binding should be refused: the chain revoked it or names another key. */
export const refusesPayment = (verdict: ChainVerdict): verdict is Extract<ChainVerdict, { kind: 'revoked' | 'conflict' }> =>
  verdict.kind === 'revoked' || verdict.kind === 'conflict';
