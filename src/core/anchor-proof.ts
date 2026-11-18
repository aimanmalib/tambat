/**
 * Whether the chain still shows a recorded commitment: the anchor status read live for an address and key, compared
 * with the transaction and block written down for it. Only an exact match reads as confirmed; a different or missing
 * commitment reads as different, and a chain that cannot be read never reads as confirmed.
 */
import type { AnchorStatus } from './anchor-chain.js';

export interface RecordedAnchor {
  txid: string;
  block: number;
  eventId: string;
}

export type ProofState = 'confirmed' | 'differs' | 'unreachable';

export function proofState(status: AnchorStatus, recorded: RecordedAnchor): ProofState {
  if (status.kind === 'unreachable') return 'unreachable';
  if (status.kind === 'none') return 'differs';
  const c = status.commitment;
  return c.txid === recorded.txid && c.height === recorded.block && c.eventId === recorded.eventId ? 'confirmed' : 'differs';
}
