/** Nostr helpers: key encodings, the NIP-39 verification text and a cache-free event check. */
import { getEventHash, verifyEvent, type Event, type EventTemplate } from 'nostr-tools/pure';
import { decode, npubEncode } from 'nostr-tools/nip19';

export type { Event, EventTemplate };

const HEX64 = /^[0-9a-f]{64}$/;

/** Accepts an npub or a 64-character hex public key and returns the hex key, or the reason it is not one. */
export function parsePubkey(input: string): { hex: string } | { error: string } {
  const value = input.trim();
  if (HEX64.test(value.toLowerCase())) return { hex: value.toLowerCase() };
  if (!value.startsWith('npub1')) return { error: 'expected an npub or a 64-character hex public key' };
  try {
    const decoded = decode(value as `npub1${string}`);
    if (decoded.type === 'npub') return { hex: decoded.data };
  } catch {
    // reported below
  }
  return { error: 'invalid npub' };
}

export function isPubkeyHex(value: string): boolean {
  return HEX64.test(value);
}

export function toNpub(pubkeyHex: string): string {
  return npubEncode(pubkeyHex);
}

/** The exact text NIP-39 asks the external key to sign. */
export function verificationText(npub: string): string {
  return `Verifying that I control the following Nostr public key: ${npub}`;
}

/** Copies only the NIP-01 fields so no cached "verified" marker from a signing library survives. */
export function plainEvent(event: Event): Event {
  return {
    id: event.id,
    pubkey: event.pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: event.tags.map((t) => [...t]),
    content: event.content,
    sig: event.sig,
  };
}

/** Checks that the object has the NIP-01 event shape. Returns an error string or null. */
export function eventShapeError(value: unknown): string | null {
  const e = value as Partial<Event> | null;
  if (!e || typeof e !== 'object') return 'event must be a JSON object';
  if (typeof e.id !== 'string' || !HEX64.test(e.id)) return 'id must be 64 hex characters';
  if (typeof e.pubkey !== 'string' || !HEX64.test(e.pubkey)) return 'pubkey must be 64 hex characters';
  if (typeof e.sig !== 'string' || !/^[0-9a-f]{128}$/.test(e.sig)) return 'sig must be 128 hex characters';
  if (!Number.isInteger(e.created_at) || !Number.isInteger(e.kind)) return 'created_at and kind must be integers';
  if (typeof e.content !== 'string') return 'content must be a string';
  if (!Array.isArray(e.tags) || !e.tags.every((t) => Array.isArray(t) && t.every((x) => typeof x === 'string'))) {
    return 'tags must be a list of string lists';
  }
  return null;
}

/** True when the id is the NIP-01 hash of the event fields. */
export function idMatches(event: Event): boolean {
  return getEventHash(event) === event.id;
}

/** True when the BIP-340 signature over the id verifies. Never trusts a cached marker. */
export function signatureValid(event: Event): boolean {
  return verifyEvent(plainEvent(event));
}
