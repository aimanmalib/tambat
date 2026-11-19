/**
 * The reputation summary of a verified binding: three separate facts, each read and checked elsewhere, put side by side.
 * It adds nothing of its own and gives no score: there is no sound basis for weighing an attestation against a payment
 * or an anchor, so each count stands alone and can be opened to the evidence behind it (docs/SPEC.md, Reputation summary).
 * A source that could not be read is reported as unreadable, never as zero.
 */
import type { AttestationSummary, ParsedAttestation } from './attest.js';
import type { AddressStatus } from './anchor-chain.js';
import type { Commitment } from './anchor.js';
import type { ReceiptCheck } from './receipt.js';

/** A count with the items behind it, or the plain fact that the source could not be read. */
export type Counted<T> = { kind: 'counted'; items: T[] } | { kind: 'unreadable' };

export type ReceiptTally =
  | {
      kind: 'counted';
      /** Verified receipts, one per transaction, newest first. */
      items: ReceiptCheck[];
      /** Receipts found on the relays whose transaction no chain server could be asked about. */
      unchecked: number;
      /** Receipts checked on the chain that do not prove a payment from the author's bound address to this key. */
      unproven: number;
    }
  | { kind: 'unreadable' };

export type AnchoredSince =
  | { kind: 'block'; height: number; commitment: Commitment }
  /** The chain servers agreed and their record does not bind this address to this key (no commitment, revoked, other key). */
  | { kind: 'not_anchored' }
  /** No chain server answered, or too few agreed for an answer. */
  | { kind: 'unreadable' };

export interface Reputation {
  attestations: Counted<ParsedAttestation>;
  receipts: ReceiptTally;
  anchoredSince: AnchoredSince;
}

export interface ReputationInput {
  /** Attestations of the current binding; null when no relay answered the query. */
  attestations: AttestationSummary | null;
  /** Checked receipts naming this key as payee; null when no relay answered the query. */
  receipts: ReceiptCheck[] | null;
  /** The agreed chain read of the bound address; null when it was not made. */
  chain: AddressStatus | null;
}

/** A receipt counts only when the chain shows its transaction paying this key's bound address from the author's. */
export const receiptVerified = (r: ReceiptCheck): boolean => r.chain === 'found' && r.paysPayee && r.payer === 'from_bound';

function tallyReceipts(receipts: ReceiptCheck[]): ReceiptTally {
  const byTx = new Map<string, ReceiptCheck>();
  let unchecked = 0;
  let unproven = 0;
  for (const r of receipts) {
    if (r.chain === 'unreachable') unchecked += 1;
    else if (!receiptVerified(r)) unproven += 1;
    else if (!byTx.has(r.txid)) byTx.set(r.txid, r);
  }
  return { kind: 'counted', items: [...byTx.values()], unchecked, unproven };
}

function anchoredSince(status: AddressStatus | null): AnchoredSince {
  const anchor = status?.anchor.kind;
  if (!status || anchor === 'unreachable' || anchor === 'unknown') return { kind: 'unreadable' };
  const verdict = status.verdict;
  if (verdict?.kind !== 'bound' || verdict.since.height <= 0) return { kind: 'not_anchored' };
  return { kind: 'block', height: verdict.since.height, commitment: verdict.since };
}

/** Puts the three checked sources side by side. Pure: every read happens before this is called. */
export function summarizeReputation(input: ReputationInput): Reputation {
  return {
    attestations: input.attestations ? { kind: 'counted', items: input.attestations.current } : { kind: 'unreadable' },
    receipts: input.receipts ? tallyReceipts(input.receipts) : { kind: 'unreadable' },
    anchoredSince: anchoredSince(input.chain),
  };
}
