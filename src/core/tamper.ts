/**
 * Tamper demo: edit one field of a LOCAL copy of a verified binding and verify the copy again, so a person can see
 * which named step catches the edit. Nothing here publishes or signs; the original event is never changed.
 */
import { decodeCashAddress, encodeCashAddress } from '@bitauth/libauth';
import { config } from '../config.js';
import { claimFromTag } from './binding.js';
import type { Event } from './nostr.js';
import { verifyBinding, type BindingResult, type StepName } from './verify.js';

export const TAMPER_FIELDS = ['content', 'tag', 'sig'] as const;
export type TamperField = (typeof TAMPER_FIELDS)[number];

/** Steps each edit must turn red. Edits to signed fields also break the Schnorr signature, which covers the id. */
export const TAMPER_CATCHES: Record<TamperField, readonly StepName[]> = {
  content: ['event_id', 'nostr_sig'],
  tag: ['event_id', 'nostr_sig', 'address_match'],
  sig: ['nostr_sig'],
};

/** Same network, payload with its last byte flipped: a valid address that the claim's signature does not belong to. */
function otherAddress(address: string): string {
  const decoded = decodeCashAddress(address);
  if (typeof decoded === 'string') return `${address}x`;
  const payload = Uint8Array.from(decoded.payload);
  payload[payload.length - 1] = (payload[payload.length - 1] ?? 0) ^ 0xff;
  return encodeCashAddress({ prefix: decoded.prefix, type: decoded.type, payload }).address;
}

/** Flips the last hex digit, keeping the string a well-formed hex value of the same length. */
const flipHex = (hex: string): string => hex.slice(0, -1) + (hex.endsWith('0') ? '1' : '0');

/** A changed copy of `event`. The id and signature are kept as published, as an attacker would have to. */
export function tamperEvent(event: Event, field: TamperField): Event {
  const copy: Event = { ...event, tags: event.tags.map((t) => [...t]) };
  if (field === 'content') copy.content = `${event.content} (edited)`;
  if (field === 'sig') copy.sig = flipHex(event.sig);
  if (field === 'tag') {
    const tag = copy.tags.find((t) => claimFromTag(t) !== null);
    const claim = tag ? claimFromTag(tag) : null;
    if (tag && claim) tag[1] = `${config.nostr.platform}:${otherAddress(claim.address)}`;
  }
  return copy;
}

/**
 * Verifies the tampered copy. The relay comparison (`newest`) is carried over from the original result: the copy
 * keeps the original id, and asking the relays again would only repeat the answer about the real event.
 */
export function verifyTampered(original: BindingResult, field: TamperField): BindingResult | null {
  if (!original.event) return null;
  const result = verifyBinding(tamperEvent(original.event, field));
  const newest = original.steps.find((s) => s.name === 'newest');
  const steps = result.steps.map((s) => (s.name === 'newest' && newest ? newest : s));
  const ok = steps.every((s) => s.status !== 'fail') && result.claims.length > 0 && result.claims.every((c) => c.ok);
  return { ...result, steps, ok };
}

/** Names of the steps that failed in a result, event steps first. */
export const failedSteps = (r: BindingResult): StepName[] =>
  [...r.steps, ...r.claims.flatMap((c) => c.steps)].filter((s) => s.status === 'fail').map((s) => s.name);
