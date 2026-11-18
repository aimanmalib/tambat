/**
 * Finding attestations of a key on the relays. Relays are not trusted: every event they return is checked again,
 * and the subject's current binding is looked up so attestations of a replaced binding drop.
 */
import { config } from '../config.js';
import { guardedQuery, lookupByPubkey, relayQuery, type DiscoverOptions } from './discover.js';
import { parseAttestation, summarizeAttestations, type AttestationSummary, type ParsedAttestation } from './attest.js';
import type { BindingResult } from './verify.js';

/** Verified attestations that name `subject`, one per event id, in any order. */
export async function findAttestations(subject: string, options: DiscoverOptions = {}): Promise<ParsedAttestation[]> {
  const { kind, namespace } = config.attest;
  const raw = await guardedQuery(
    options.query ?? relayQuery,
    options.relays ?? config.nostr.relays,
    { kinds: [kind], '#p': [subject], '#L': [namespace] },
    options.timeoutMs ?? config.nostr.queryTimeoutMs,
  );
  const seen = new Map<string, ParsedAttestation>();
  for (const item of raw) {
    const a = parseAttestation(item);
    if (typeof a === 'string' || a.subject !== subject || seen.has(a.event.id)) continue;
    seen.set(a.event.id, a);
  }
  return [...seen.values()];
}

/**
 * The attestations of a subject that still count. Pass the subject's binding when the caller already looked it up
 * (the web page does); otherwise it is looked up here.
 */
export async function attestationsOf(
  subject: string,
  options: DiscoverOptions = {},
  current?: BindingResult | null,
): Promise<AttestationSummary & { binding: BindingResult | null }> {
  const [all, binding] = await Promise.all([
    findAttestations(subject, options),
    current === undefined ? lookupByPubkey(subject, options) : Promise.resolve(current),
  ]);
  return { ...summarizeAttestations(all, binding), binding };
}
