/** Writing a binding: the NIP-39 kind 10011 event that carries `["i", "bch:<cashaddr>", "<base64 signature>"]`. */
import { config } from '../config.js';
import { parseP2pkhAddress } from './cashaddr.js';
import type { Event, EventTemplate } from './nostr.js';

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

/** Builds the event that removes every BCH claim while keeping the other identity tags (revocation). */
export function createRevocationEvent(previous: Pick<Event, 'tags' | 'content'>, createdAt?: number): EventTemplate {
  return {
    kind: config.nostr.bindingKind,
    created_at: createdAt ?? Math.floor(Date.now() / 1000),
    content: previous.content,
    tags: previous.tags.filter((t) => claimFromTag(t) === null).map((t) => [...t]),
  };
}
