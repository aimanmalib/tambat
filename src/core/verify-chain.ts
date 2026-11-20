/**
 * Verification that reads the chain for on-chain proofs (`tx:<txid>`). Signed-message claims need no network; a claim
 * that names a transaction is checked against what the chain servers agree on. Without servers, or when they do not
 * agree, such a claim is skipped and does not pass (`chain_unreadable`).
 */
import { config } from '../config.js';
import type { ChainServer } from './chain-quorum.js';
import { claimsOf } from './binding.js';
import { eventShapeError, type Event } from './nostr.js';
import { parseProofs, readTxEvidence, type TxLookup } from './tx-proof.js';
import { verifyBinding, type BindingResult, type VerifyOptions } from './verify.js';

/** The txids named by on-chain proofs in these events, once each. Items that are not events are ignored. */
export function proofTxids(items: unknown[]): string[] {
  const ids = new Set<string>();
  for (const item of items) {
    if (eventShapeError(item)) continue;
    for (const c of claimsOf(item as Event)) {
      for (const proof of parseProofs(c.signature)) if (proof.form === 'tx') ids.add(proof.txid);
    }
  }
  return [...ids];
}

/** Where to read on-chain proofs: the chain servers and how many must agree. */
export interface ChainReading {
  servers: ChainServer[];
  quorum?: number;
}

/** Reads every txid from the chain servers at once. `known` answers are reused, so a caller can keep a cache. */
export async function readTxLookups(txids: string[], chain: ChainReading, known: Record<string, TxLookup> = {}): Promise<Record<string, TxLookup>> {
  const quorum = chain.quorum ?? config.anchor.quorum;
  const out: Record<string, TxLookup> = { ...known };
  const wanted = txids.filter((id) => !(id in out));
  const read = await Promise.all(wanted.map((id) => readTxEvidence(id, chain.servers, quorum)));
  wanted.forEach((id, i) => {
    const r = read[i];
    if (r) out[id] = r;
  });
  return out;
}

/** `verifyBinding` with the transactions of on-chain proofs read first. Events with signed messages only make no chain call. */
export async function verifyBindingOnChain(input: unknown, options: VerifyOptions & { chain?: ChainReading } = {}): Promise<BindingResult> {
  const { chain, ...rest } = options;
  const txids = proofTxids([input]);
  if (!chain || txids.length === 0) return verifyBinding(input, rest);
  const txLookups = await readTxLookups(txids, chain, rest.txLookups);
  return verifyBinding(input, { ...rest, txLookups });
}
