/** Writing a binding: the NIP-39 kind 10011 event that carries `["i", "bch:<cashaddr>", "<base64 signature>"]`. */
import { config } from '../config.js';
import { parseP2pkhAddress } from './cashaddr.js';
import type { Event, EventTemplate } from './nostr.js';

/**
 * The named checks a verifier runs on a binding, in the order they are reported. This list is part of the
 * protocol: `event_shape`, `kind`, `event_id`, `nostr_sig` and `newest` run once per event; `bch_sig`,
 * `address_match`, `network` and `key_separation` run once per BCH claim. `key_separation` rejects a claim whose
 * BCH key is the same key as the Nostr key. The checks themselves live in `verify.ts`.
 */
export const VERIFY_STEPS = [
  'event_shape',
  'kind',
  'event_id',
  'nostr_sig',
  'newest',
  'bch_sig',
  'address_match',
  'network',
  'key_separation',
] as const;

export type StepName = (typeof VERIFY_STEPS)[number];

export interface BchClaim {
  /** Full CashAddr with prefix. */
  address: string;
  /** Base64 signed message over the NIP-39 verification text for the author's npub. */
  signature: string;
}

/** `bch:<cashaddr>` identity string for the `i` tag. */
export function claimIdentity(address: string, platform = config.nostr.platform): string {
  return `${platform}:${address}`;
}

/** Splits an `i` tag into a BCH claim, or returns null when the tag is not a claim on the platform. */
export function claimFromTag(tag: readonly string[], platform = config.nostr.platform): BchClaim | null {
  if (tag[0] !== 'i' || typeof tag[1] !== 'string') return null;
  const head = `${platform}:`;
  if (!tag[1].startsWith(head)) return null;
  return { address: tag[1].slice(head.length), signature: tag[2] ?? '' };
}

/** All BCH claims carried by an event, in tag order. */
export function claimsOf(event: Pick<Event, 'tags'>, platform = config.nostr.platform): BchClaim[] {
  return event.tags.map((t) => claimFromTag(t, platform)).filter((c): c is BchClaim => c !== null);
}

export interface CreateBindingInput {
  claim: BchClaim;
  /** The author's current kind 10011 event, if any. Its other identity tags are kept. */
  previous?: Pick<Event, 'tags' | 'content'> | null;
  createdAt?: number;
}

/**
 * Builds the unsigned binding event. Every `i` tag the user already has is kept except earlier claims on the
 * same platform, which the new claim replaces (one BCH address per Nostr key keeps lookups unambiguous).
 */
export function createBindingEvent(input: CreateBindingInput): EventTemplate {
  const parsed = parseP2pkhAddress(input.claim.address);
  if (typeof parsed === 'string') throw new Error(parsed);
  if (input.claim.signature.trim() === '') throw new Error('signature is empty');
  const kept = (input.previous?.tags ?? []).filter((t) => claimFromTag(t) === null).map((t) => [...t]);
  return {
    kind: config.nostr.bindingKind,
    created_at: input.createdAt ?? Math.floor(Date.now() / 1000),
    content: input.previous?.content ?? '',
    tags: [...kept, ['i', claimIdentity(parsed.address), input.claim.signature.trim()]],
  };
}

/** True when the event carries a BCH claim for this address (case-insensitive CashAddr). */
export function hasClaim(event: Pick<Event, 'tags'>, address: string): boolean {
  const wanted = address.toLowerCase();
  return claimsOf(event).some((c) => c.address.toLowerCase() === wanted);
}

/**
 * Builds the event that removes every BCH claim while keeping the other identity tags (revocation). A key carries
 * at most one BCH claim, so removing the claim for one address removes them all. It replaces the author's binding
 * because relays keep only the newest kind 10011 event of a key, and verifiers fail any older one (`newest`).
 */
export function createRevocationEvent(previous: Pick<Event, 'tags' | 'content'>, createdAt?: number): EventTemplate {
  return {
    kind: config.nostr.bindingKind,
    created_at: createdAt ?? Math.floor(Date.now() / 1000),
    content: previous.content,
    tags: previous.tags.filter((t) => claimFromTag(t) === null).map((t) => [...t]),
  };
}

/**
 * created_at for an event that replaces `previous`: now, or one second after `previous` when that is not later. Two
 * events in the same second are ordered by id (NIP-01), so without this a quick replacement is dropped half the time.
 */
export function replacingCreatedAt(previous: Pick<Event, 'created_at'> | null | undefined, now = Math.floor(Date.now() / 1000)): number {
  return previous ? Math.max(now, previous.created_at + 1) : now;
}

/**
 * Builds one event that moves a binding from `oldAddress` to the address in `claim` (rotation): the old claim is
 * gone and the new one, with its own fresh BCH signature, takes its place; other identity tags are kept.
 */
export function createRotationEvent(
  previous: Pick<Event, 'tags' | 'content'>,
  oldAddress: string,
  claim: BchClaim,
  createdAt?: number,
): EventTemplate {
  if (!hasClaim(previous, oldAddress)) throw new Error(`the current binding does not claim ${oldAddress}`);
  if (hasClaim({ tags: [['i', claimIdentity(claim.address)]] }, oldAddress)) throw new Error('the new address is the old address');
  const input: CreateBindingInput = { claim, previous };
  if (createdAt !== undefined) input.createdAt = createdAt;
  return createBindingEvent(input);
}
