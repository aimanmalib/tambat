/**
 * Attestations pinned to a binding (docs/SPEC.md "Attestations", ADR 0011). One Nostr key says "I checked this
 * binding" with a NIP-32 label event (an existing kind, config `attest.kind`) that names the subject key in a `p` tag
 * and the exact binding event in an `e` tag. The attestation counts only while that event is still the subject's
 * current, verified binding: when the subject rotates, recovers, revokes or publishes any newer binding, every
 * attestation of the older one drops.
 */
import { config } from '../config.js';
import { eventShapeError, idMatches, isPubkeyHex, signatureValid, type Event, type EventTemplate } from './nostr.js';
import type { BindingResult } from './verify.js';

const EVENT_ID = /^[0-9a-f]{64}$/;

export interface CreateAttestationInput {
  /** Hex key whose binding is attested. */
  subject: string;
  /** Id of the subject's binding event (kind 10011) that the attester checked. */
  bindingEventId: string;
  createdAt?: number;
}

/** The unsigned attestation event. The attester's own Nostr key signs it. */
export function createAttestationEvent(input: CreateAttestationInput): EventTemplate {
  const id = input.bindingEventId.trim().toLowerCase();
  if (!EVENT_ID.test(id)) throw new Error('binding event id must be 64 hex characters');
  if (!isPubkeyHex(input.subject)) throw new Error('subject must be a 64-character hex public key');
  const { kind, namespace, label } = config.attest;
  return {
    kind,
    created_at: input.createdAt ?? Math.floor(Date.now() / 1000),
    content: '',
    tags: [
      ['L', namespace],
      ['l', label, namespace],
      ['e', id],
      ['p', input.subject],
    ],
  };
}

export interface ParsedAttestation {
  event: Event;
  attester: string;
  subject: string;
  bindingEventId: string;
}

export type AttestationProblem = 'shape' | 'event_id' | 'signature' | 'not_attestation' | 'no_subject' | 'no_binding' | 'self';

/** Checks an attestation on its own (shape, id, signature, tags) and reads who attests which binding. */
export function parseAttestation(input: unknown): ParsedAttestation | AttestationProblem {
  if (eventShapeError(input)) return 'shape';
  const event = input as Event;
  if (!idMatches(event)) return 'event_id';
  if (!signatureValid(event)) return 'signature';
  const { kind, namespace, label } = config.attest;
  const labelled = event.tags.some((t) => t[0] === 'l' && t[1] === label && t[2] === namespace);
  if (event.kind !== kind || !labelled) return 'not_attestation';
  const subjects = event.tags.filter((t) => t[0] === 'p' && isPubkeyHex(t[1] ?? ''));
  if (subjects.length !== 1) return 'no_subject';
  const pinned = event.tags.filter((t) => t[0] === 'e' && EVENT_ID.test(t[1] ?? ''));
  if (pinned.length !== 1) return 'no_binding';
  const subject = subjects[0]![1]!;
  if (subject === event.pubkey) return 'self';
  return { event, attester: event.pubkey, subject, bindingEventId: pinned[0]![1]! };
}

/**
 * `current`: the pinned event is the subject's newest binding and it verifies. `replaced`: the subject has a newer
 * binding, or the pinned one no longer verifies. `no_binding`: the relays hold no binding of the subject.
 */
export type AttestationStatus = 'current' | 'replaced' | 'no_binding';

/** Compares an attestation with the subject's current binding (from `lookupByPubkey`). */
export function attestationStatus(a: ParsedAttestation, current: BindingResult | null): AttestationStatus {
  if (!current || current.pubkey !== a.subject) return 'no_binding';
  return current.ok && current.eventId === a.bindingEventId ? 'current' : 'replaced';
}

export interface AttestationSummary {
  /** Attestations of the current binding, newest first, one per attester. */
  current: ParsedAttestation[];
  /** How many attesters only attested a binding that has since been replaced. */
  replaced: number;
}

/** Sorts a subject's attestations into those that still count and those that dropped with an older binding. */
export function summarizeAttestations(all: ParsedAttestation[], current: BindingResult | null): AttestationSummary {
  const byAttester = new Map<string, ParsedAttestation>();
  const stale = new Set<string>();
  for (const a of [...all].sort((x, y) => y.event.created_at - x.event.created_at)) {
    if (attestationStatus(a, current) === 'current') {
      if (!byAttester.has(a.attester)) byAttester.set(a.attester, a);
    } else stale.add(a.attester);
  }
  for (const attester of byAttester.keys()) stale.delete(attester);
  return { current: [...byAttester.values()], replaced: stale.size };
}
