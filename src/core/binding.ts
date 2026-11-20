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

/**
 * The named checks of a recovery claim (a new Nostr key taking over the binding of a lost one), run only when the
 * event carries one. They never change whether the binding itself verifies. The checks live in `recover.ts`.
 */
export const RECOVERY_STEPS = ['recovery_tag', 'recovery_claim', 'recovery_sig', 'old_binding', 'no_cycle'] as const;

/**
 * The checks that take the place of `bch_sig` when a claim carries an on-chain proof (`tx:<txid>`) instead of a
 * signed message: the transaction was found and hashes to the txid, and it carries the verification text. Spending
 * from the address is reported as `address_match`. The checks live in `tx-proof.ts`.
 */
export const TX_PROOF_STEPS = ['tx_found', 'tx_text'] as const;

export type StepName = (typeof VERIFY_STEPS)[number] | (typeof RECOVERY_STEPS)[number] | (typeof TX_PROOF_STEPS)[number];

export interface BchClaim {
  /** CashAddr as written in the tag: with its prefix, or without it (read on the verifier's network). */
  address: string;
  /** Base64 signed message over the NIP-39 verification text for the author's npub. */
  signature: string;
}

/** Network prefix of a mainnet CashAddr; only mainnet claims drop it (`bchtest:` cannot be told from the address alone). */
const MAINNET = 'bitcoincash';

/** The address with its CashAddr prefix, lower case: `q…` is read on `network` (the checksum covers the prefix). */
export const fullClaimAddress = (address: string, network: string = config.network): string =>
  (address.includes(':') ? address : `${network}:${address}`).trim().toLowerCase();

/**
 * The identity string for the `i` tag. With `claimForm` `bare` a mainnet address is written without its prefix
 * (`bch:q…`), the canonical form other NIP-39 verifiers read; any other address, or `prefixed`, keeps the prefix.
 */
export function claimIdentity(address: string, form: 'bare' | 'prefixed' = config.nostr.claimForm, platform = config.nostr.platform): string {
  const [prefix, payload] = address.split(':');
  if (form === 'bare' && prefix?.toLowerCase() === MAINNET && payload) return `${platform}:${payload}`;
  return `${platform}:${address}`;
}

/** Every spelling of one address in an `i` tag that a verifier reads, for a relay `#i` query. */
export function claimIdentities(address: string): string[] {
  const full = fullClaimAddress(address);
  const payload = full.split(':')[1] ?? '';
  const names = [config.nostr.platform, ...config.nostr.platformAliases];
  return [...new Set(names.flatMap((name) => [`${name}:${full}`, `${name}:${payload}`]))];
}

/**
 * Splits an `i` tag into a BCH claim, or returns null when the tag is not a claim. The platform is `bch` or one of
 * `platformAliases` (`bitcoincash:q…`); the address is what follows it, with or without the CashAddr prefix.
 */
export function claimFromTag(tag: readonly string[], platform = config.nostr.platform): BchClaim | null {
  if (tag[0] !== 'i' || typeof tag[1] !== 'string') return null;
  const name = [platform, ...config.nostr.platformAliases].find((n) => tag[1]!.startsWith(`${n}:`));
  if (name === undefined) return null;
  return { address: tag[1].slice(name.length + 1), signature: tag[2] ?? '' };
}

/** All BCH claims carried by an event, in tag order. Several tags may name the same address in different forms. */
export function claimsOf(event: Pick<Event, 'tags'>, platform = config.nostr.platform): BchClaim[] {
  return event.tags.map((t) => claimFromTag(t, platform)).filter((c): c is BchClaim => c !== null);
}

/**
 * The tags a replacing event keeps: everything except BCH claims and a recovery claim. A recovery claim is signed for
 * one address and one moment, so it is never carried into a later event.
 */
function keptTags(tags: readonly (readonly string[])[]): string[][] {
  return tags.filter((t) => claimFromTag(t) === null && t[0] !== config.nostr.recoveryTag).map((t) => [...t]);
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
  const kept = keptTags(input.previous?.tags ?? []);
  return {
    kind: config.nostr.bindingKind,
    created_at: input.createdAt ?? Math.floor(Date.now() / 1000),
    content: input.previous?.content ?? '',
    tags: [...kept, ['i', claimIdentity(parsed.address), input.claim.signature.trim()]],
  };
}

/** True when the event carries a BCH claim for this address (case-insensitive CashAddr). */
export function hasClaim(event: Pick<Event, 'tags'>, address: string): boolean {
  const wanted = fullClaimAddress(address);
  return claimsOf(event).some((c) => fullClaimAddress(c.address) === wanted);
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
    tags: keptTags(previous.tags),
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
