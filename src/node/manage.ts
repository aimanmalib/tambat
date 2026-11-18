/**
 * Changing a binding from the command line: revoke it, or move it to another address of the same wallet. Both sign
 * with keys derived from a BIP39 phrase file (wallet paths, see src/core/paytaca.ts), publish one replacing kind 10011
 * event and report each relay's answer. Nothing secret is printed.
 */
import { readFileSync } from 'node:fs';
import { finalizeEvent } from 'nostr-tools/pure';
import { config } from '../config.js';
import { signMessage } from '../core/bchmsg.js';
import { createRevocationEvent, createRotationEvent, hasClaim, replacingCreatedAt } from '../core/binding.js';
import { lookupByPubkey, type QueryFn } from '../core/discover.js';
import { parsePubkey, verificationText, type Event } from '../core/nostr.js';
import { createRecoveryEvent, recoveryText, verifyRecovery } from '../core/recover.js';
import { bchKeysOf, keysFromPhrase, type PhraseKeys } from '../core/paytaca.js';
import type { RelayOutcome } from '../core/publish.js';
import { verifyBinding } from '../core/verify.js';

export interface ManageDeps {
  query: QueryFn;
  publish: (event: Event) => Promise<RelayOutcome[]>;
  /** Unix seconds; tests pass a fixed clock. */
  now?: () => number;
}

export interface ManageResult {
  action: 'revoke' | 'rotate';
  npub: string;
  /** The event this one replaces. */
  replaces: string;
  id: string;
  created_at: number;
  removed: string;
  added?: string;
  outcomes: RelayOutcome[];
}

/** Reads `{ "phrase": "..." }` from a key file. The phrase is returned to the caller and never printed. */
export function readPhrase(file: string): string {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { phrase?: unknown };
  if (typeof parsed.phrase !== 'string' || parsed.phrase.trim() === '') throw new Error(`${file} has no phrase`);
  return parsed.phrase;
}

async function currentEvent(keys: PhraseKeys, deps: ManageDeps): Promise<Event> {
  const result = await lookupByPubkey(keys.nostrPubkey, { query: deps.query });
  if (!result?.event) throw new Error(`no binding event found on the relays for ${keys.npub}`);
  return result.event;
}

/** A replacing event must be newer than the one it replaces, even when both are made in the same second. */
const after = (previous: Event, deps: ManageDeps): number =>
  Math.max((deps.now ?? (() => Math.floor(Date.now() / 1000)))(), previous.created_at + 1);

async function finish(
  action: ManageResult['action'],
  keys: PhraseKeys,
  previous: Event,
  event: Event,
  deps: ManageDeps,
  change: Pick<ManageResult, 'removed' | 'added'>,
): Promise<ManageResult> {
  const outcomes = await deps.publish(event);
  return { action, npub: keys.npub, replaces: previous.id, id: event.id, created_at: event.created_at, ...change, outcomes };
}

/** Publishes an event that removes the key's BCH claim for `address`. */
export async function revokeAddress(phrase: string, address: string, deps: ManageDeps): Promise<ManageResult> {
  const keys = keysFromPhrase(phrase, config.network);
  const previous = await currentEvent(keys, deps);
  if (!hasClaim(previous, address)) throw new Error(`the current binding of ${keys.npub} does not claim ${address}`);
  const event = finalizeEvent(createRevocationEvent(previous, after(previous, deps)), keys.nostrSecretKey);
  return finish('revoke', keys, previous, event, deps, { removed: address });
}

/** Publishes one event that replaces the claim for `oldAddress` with a freshly signed claim for `newAddress`. */
export async function rotateAddress(phrase: string, oldAddress: string, newAddress: string, deps: ManageDeps): Promise<ManageResult> {
  const keys = keysFromPhrase(phrase, config.network);
  const wanted = newAddress.toLowerCase();
  const bch = bchKeysOf(phrase, config.cli.addressSearchLimit, config.network).find((k) => k.address === wanted);
  if (!bch) throw new Error(`${newAddress} is not among the first ${config.cli.addressSearchLimit} addresses of this wallet`);
  const previous = await currentEvent(keys, deps);
  const claim = { address: bch.address, signature: signMessage(bch.bchPrivateKey, verificationText(keys.npub)) };
  const event = finalizeEvent(createRotationEvent(previous, oldAddress, claim, after(previous, deps)), keys.nostrSecretKey);
  const check = verifyBinding(event, { sameAuthorEvents: [previous] });
  if (!check.ok) throw new Error('the new binding did not verify; nothing was published');
  return finish('rotate', keys, previous, event, deps, { removed: oldAddress, added: bch.address });
}

export interface RecoverResult {
  action: 'recover';
  /** The new key that now carries the binding. */
  npub: string;
  /** The lost key it recovered from, and that key's binding event. */
  from: string;
  fromEvent: string;
  address: string;
  id: string;
  created_at: number;
  outcomes: RelayOutcome[];
}

/**
 * Publishes, for the Nostr key of `nostrPhrase`, a binding for the address the lost key `oldKey` is still bound to,
 * with the recovery tag signed by that address. The address key comes from the wallet phrase `bchPhrase`. Nothing is
 * published unless the new event and its recovery claim verify against what the relays hold for the old key.
 */
export async function recoverFrom(nostrPhrase: string, bchPhrase: string, oldKey: string, deps: ManageDeps): Promise<RecoverResult> {
  const keys = keysFromPhrase(nostrPhrase, config.network);
  const parsed = parsePubkey(oldKey);
  if ('error' in parsed) throw new Error(parsed.error);
  const old = await lookupByPubkey(parsed.hex, { query: deps.query, followRecovery: false });
  const address = old?.ok ? old.claims[0]?.address : undefined;
  if (!old || !address) throw new Error(`no verified binding found on the relays for ${oldKey}`);
  const bch = bchKeysOf(bchPhrase, config.cli.addressSearchLimit, config.network).find((k) => k.address === address.toLowerCase());
  if (!bch) throw new Error(`${address} is not among the first ${config.cli.addressSearchLimit} addresses of the wallet phrase`);
  const own = await lookupByPubkey(keys.nostrPubkey, { query: deps.query, followRecovery: false });
  const now = deps.now ? deps.now() : undefined;
  const event = finalizeEvent(
    createRecoveryEvent({
      claim: { address: bch.address, signature: signMessage(bch.bchPrivateKey, verificationText(keys.npub)) },
      oldNpub: old.npub,
      recoverySignature: signMessage(bch.bchPrivateKey, recoveryText(old.npub)),
      createdAt: replacingCreatedAt(own?.event, now),
    }),
    keys.nostrSecretKey,
  );
  const check = verifyRecovery(verifyBinding(event, { sameAuthorEvents: own?.event ? [own.event] : [] }), old);
  if (!check?.ok) throw new Error('the recovery did not verify; nothing was published');
  const outcomes = await deps.publish(event);
  return { action: 'recover', npub: keys.npub, from: old.npub, fromEvent: old.eventId, address: bch.address, id: event.id, created_at: event.created_at, outcomes };
}
