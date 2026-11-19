/**
 * The reputation summary of a verified binding: three separate facts, each read and checked elsewhere, put side by side.
 * It adds nothing of its own and gives no score: there is no sound basis for weighing an attestation against a payment
 * or an anchor, so each count stands alone and can be opened to the evidence behind it (docs/SPEC.md, Reputation summary).
 * A source that could not be read is reported as unreadable, never as zero.
 */
import { config } from '../config.js';
import type { AttestationSummary, ParsedAttestation } from './attest.js';
import type { AddressStatus } from './anchor-chain.js';
import type { Commitment } from './anchor.js';
import { didOf } from './did.js';
import { canonicalize } from './jcs.js';
import type { Event } from './nostr.js';
import type { ReceiptCheck } from './receipt.js';
import { VC_CONTEXT, verifyCredential, type AttestationCredential, type VcCheck, type VcProblem } from './vc.js';
import { isNewer, verifyBinding, type BindingResult } from './verify.js';

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

/*
 * Portable reputation (docs/SPEC.md "Portable reputation"). The attestation part of the summary as a W3C Verifiable
 * Presentation 2.0 that anyone can count again offline: it carries every attestation credential (ADR 0017) with its
 * signed events, the holder's current binding, and the counts the maker claims. The verifier recounts from the
 * embedded events and rejects a bundle whose claimed counts differ. No holder signature: the counts prove themselves.
 */

/** Why a credential in a bundle is not counted. `credential`: it does not verify (see `problem`). */
export type RepExclusion = 'credential' | 'self' | 'subject' | 'old_binding' | 'duplicate_issuer';

export interface ReputationBundle {
  '@context': string[];
  type: string[];
  holder: string;
  verifiableCredential: unknown[];
  reputationSummary: {
    /** The holder's binding that the counted attestations must pin, as the maker read it from the relays. */
    binding: Event;
    bindingEvent: string;
    /** Credentials in the bundle, counted or not. */
    credentials: number;
    /** Attestations counted: verified, of the holder's current binding, one per issuer, never by the holder. */
    attestations: number;
    /** The issuers counted, sorted. */
    issuers: string[];
    /** Claimed by the maker; checked only when the verifier is given a chain read. */
    anchoredSince?: { height: number; txid: string; eventId: string };
    created: string;
  };
}

export interface BundleCount {
  counted: { issuer: string; attestationEvent: string; validFrom: string }[];
  excluded: { index: number; reason: RepExclusion; problem?: VcProblem; path?: string }[];
  /** The newest binding of the holder found inside the credentials, when it is newer than the named one. */
  newer: Event | null;
}

/** Applies the counting rules to the credentials of a bundle. Pure; every signature is checked here. */
export function countBundle(holder: string, binding: BindingResult, credentials: unknown[]): BundleCount {
  const excluded: BundleCount['excluded'] = [];
  const candidates: { index: number; check: Extract<VcCheck, { ok: true }> }[] = [];
  let newer: Event | null = null;
  credentials.forEach((vc, index) => {
    const check = verifyCredential(vc);
    if (!check.ok) {
      if (check.reason === 'attestation_self') excluded.push({ index, reason: 'self' });
      else excluded.push({ index, reason: 'credential', problem: check.reason, ...(check.path ? { path: check.path } : {}) });
      return;
    }
    const b = check.binding.event;
    if (b && b.pubkey === holder && binding.event && isNewer(b, binding.event) && (!newer || isNewer(b, newer))) newer = b;
    if (check.attestation.subject !== holder) excluded.push({ index, reason: 'subject' });
    else if (check.binding.eventId !== binding.eventId) excluded.push({ index, reason: 'old_binding' });
    else candidates.push({ index, check });
  });
  const counted: BundleCount['counted'] = [];
  const seen = new Set<string>();
  const order = (x: (typeof candidates)[number], y: (typeof candidates)[number]) =>
    isNewer(x.check.attestation.event, y.check.attestation.event) ? -1 : 1;
  for (const { index, check } of [...candidates].sort(order)) {
    const issuer = check.credential.issuer;
    if (seen.has(issuer)) {
      excluded.push({ index, reason: 'duplicate_issuer' });
      continue;
    }
    seen.add(issuer);
    counted.push({ issuer, attestationEvent: check.attestation.event.id, validFrom: check.credential.validFrom });
  }
  excluded.sort((x, y) => x.index - y.index);
  return { counted, excluded, newer };
}

const isoSeconds = (unix: number): string => new Date(unix * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

export interface BuildBundleInput {
  /** The holder's current, verified binding. */
  binding: BindingResult;
  credentials: AttestationCredential[];
  /** The commitment of an agreed chain read whose verdict was `bound` (Reputation `anchoredSince.block`). */
  anchoredSince?: Commitment | null;
  /** Unix seconds; defaults to now. */
  now?: number;
}

/** Builds the presentation and the counts it claims, by the same rules the verifier recounts with. */
export function buildReputationBundle(input: BuildBundleInput): ReputationBundle {
  const { binding } = input;
  if (!binding.ok || !binding.event) throw new Error('the holder binding must be verified');
  const holder = binding.pubkey;
  const { counted } = countBundle(holder, binding, input.credentials);
  const a = input.anchoredSince;
  return {
    '@context': [VC_CONTEXT],
    type: ['VerifiablePresentation', config.vc.presentationType],
    holder: didOf(holder),
    verifiableCredential: input.credentials,
    reputationSummary: {
      binding: binding.event,
      bindingEvent: binding.eventId,
      credentials: input.credentials.length,
      attestations: counted.length,
      issuers: counted.map((c) => c.issuer).sort(),
      ...(a && a.height > 0 ? { anchoredSince: { height: a.height, txid: a.txid, eventId: a.eventId } } : {}),
      created: isoSeconds(input.now ?? Math.floor(Date.now() / 1000)),
    },
  };
}

/**
 * Why a bundle is rejected. `shape`: not a reputation presentation. `holder`: the holder is not a did:nostr key.
 * `binding`: the named binding does not verify or is not the holder's. `stale_binding`: a credential carries a newer
 * binding of the holder, so the named one is not current. `count`: a claimed count differs from the recount (`path`).
 * `anchor`: the chain read given to the verifier does not bind the address since the claimed block.
 */
export type BundleProblem = 'shape' | 'holder' | 'binding' | 'stale_binding' | 'count' | 'anchor';

/** `claimed`: stated by the maker, not checked. `confirmed`: an agreed chain read says the same block. */
export type BundleAnchor = { kind: 'none' } | { kind: 'claimed' | 'confirmed'; height: number; txid: string };

export type BundleCheck =
  | { ok: true; holder: string; binding: BindingResult; count: BundleCount; anchor: BundleAnchor; created: string }
  | { ok: false; reason: BundleProblem; path?: string; count?: BundleCount };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const HOLDER = /^did:nostr:([0-9a-f]{64})$/;

function checkAnchor(claim: unknown, chain: AddressStatus | null | undefined): BundleAnchor | 'anchor' | 'shape' {
  if (claim === undefined) return { kind: 'none' };
  if (!isRecord(claim) || !Number.isInteger(claim.height) || (claim.height as number) <= 0 || typeof claim.txid !== 'string') return 'shape';
  const height = claim.height as number;
  const txid = claim.txid;
  if (!chain) return { kind: 'claimed', height, txid };
  const read = anchoredSince(chain);
  if (read.kind === 'unreadable') return { kind: 'claimed', height, txid };
  return read.kind === 'block' && read.height === height && read.commitment.txid === txid ? { kind: 'confirmed', height, txid } : 'anchor';
}

/**
 * Verifies a reputation bundle offline and recounts it. Pass `chain` (an agreed read of the bound address, from
 * `addressStatus`) to check the claimed anchor block as well; without it the block stays a claim.
 */
export function verifyReputationBundle(input: unknown, options: { chain?: AddressStatus | null } = {}): BundleCheck {
  if (!isRecord(input)) return { ok: false, reason: 'shape' };
  const { type, verifiableCredential: vcs, reputationSummary: s } = input;
  const ctx = input['@context'];
  if (!Array.isArray(ctx) || ctx[0] !== VC_CONTEXT || !Array.isArray(type) || !type.includes('VerifiablePresentation') || !type.includes(config.vc.presentationType) || !Array.isArray(vcs) || !isRecord(s)) {
    return { ok: false, reason: 'shape' };
  }
  const holder = typeof input.holder === 'string' ? HOLDER.exec(input.holder)?.[1] : undefined;
  if (!holder) return { ok: false, reason: 'holder' };
  const binding = verifyBinding(s.binding);
  if (!binding.ok || !binding.event || binding.pubkey !== holder) return { ok: false, reason: 'binding', path: 'reputationSummary.binding' };
  const count = countBundle(holder, binding, vcs);
  if (count.newer) return { ok: false, reason: 'stale_binding', count };
  const want: Record<string, unknown> = {
    bindingEvent: binding.eventId,
    credentials: vcs.length,
    attestations: count.counted.length,
    issuers: count.counted.map((c) => c.issuer).sort(),
  };
  for (const [k, v] of Object.entries(want)) {
    if (canonicalize(s[k] ?? null) !== canonicalize(v)) return { ok: false, reason: 'count', path: `reputationSummary.${k}`, count };
  }
  if (typeof s.created !== 'string' || Number.isNaN(Date.parse(s.created))) return { ok: false, reason: 'shape', path: 'reputationSummary.created' };
  const anchor = checkAnchor(s.anchoredSince, options.chain);
  if (anchor === 'anchor' || anchor === 'shape') return { ok: false, reason: anchor, path: 'reputationSummary.anchoredSince', count };
  return { ok: true, holder, binding, count, anchor, created: s.created };
}

/** File name for a downloaded bundle: prefix plus the first 12 hex characters of the holder key. */
export const bundleFileName = (holderHex: string): string => `${config.vc.reputationFilePrefix}-${holderHex.slice(0, 12)}.json`;
