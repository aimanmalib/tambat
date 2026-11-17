/**
 * The wall: the newest binding events on the relays, each verified in the browser. Relays are untrusted, so the
 * query keeps events whose signature fails (a plain pool would drop them unseen) and every one is checked here. An
 * event that fails a step is never listed; it only adds to the `hidden` count. An event replaced by a newer one from
 * the same key is not current and is left out without counting as a failure.
 */
import { config } from '../config.js';
import { createRelayQuery, guardedQuery, type DiscoverOptions, type QueryFn } from './discover.js';
import { eventShapeError, idMatches, signatureValid, type Event } from './nostr.js';
import { verifyBinding, type BindingResult } from './verify.js';

export interface WallEntry {
  npub: string;
  pubkey: string;
  /** The first BCH address the event claims; every claim in it verified. */
  address: string;
  createdAt: number;
  eventId: string;
}

export interface Wall {
  entries: WallEntry[];
  /** Binding events that failed verification and were not shown. */
  hidden: number;
}

export interface WallOptions extends DiscoverOptions {
  limit?: number;
}

/** Browser relay query that keeps events with bad signatures, so the wall can count them instead of losing them. */
export const uncheckedRelayQuery: QueryFn = createRelayQuery(undefined, { keepUnverified: true });

const bchPrefix = (): string => `${config.nostr.platform}:`;

/** True when the item is shaped like a binding event and names at least one BCH identity. */
function namesBch(item: unknown): boolean {
  const tags = (item as { tags?: unknown } | null)?.tags;
  return Array.isArray(tags) && tags.some((t) => Array.isArray(t) && t[0] === 'i' && typeof t[1] === 'string' && t[1].startsWith(bchPrefix()));
}

const genuine = (e: Event): boolean => idMatches(e) && signatureValid(e);

/** Only the `newest` step failed: a genuine event that a newer one from the same key replaced. */
function onlyReplaced(r: BindingResult): boolean {
  const failed = r.steps.filter((s) => s.status === 'fail');
  return failed.length > 0 && failed.every((s) => s.name === 'newest') && r.claims.length > 0 && r.claims.every((c) => c.ok);
}

/** Verifies relay results for the wall. Pure: no network, so tests feed it any mix of events. */
export function buildWall(raw: unknown[], limit: number, network = config.network): Wall {
  const byId = new Map<string, Event>();
  let hidden = 0;
  for (const item of raw) {
    const shaped = !eventShapeError(item) && (item as Event).kind === config.nostr.bindingKind;
    if (!shaped) {
      if (namesBch(item)) hidden += 1;
      continue;
    }
    const e = item as Event;
    // Keep the copy that checks out when relays return the same id twice.
    const seen = byId.get(e.id);
    if (!seen || (!genuine(seen) && genuine(e))) byId.set(e.id, e);
  }
  // Every genuine kind 10011 event counts for the newest check, including revocations that name no BCH address.
  const sameAuthorEvents = [...byId.values()].filter(genuine);
  const results: BindingResult[] = [];
  for (const e of byId.values()) {
    if (!namesBch(e)) continue;
    const r = verifyBinding(e, { network, sameAuthorEvents });
    if (r.ok) results.push(r);
    else if (!onlyReplaced(r)) hidden += 1;
  }
  const entries = results
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map((r) => ({ npub: r.npub, pubkey: r.pubkey, address: r.claims[0]?.address ?? '', createdAt: r.createdAt, eventId: r.eventId }));
  return { entries, hidden };
}

/** Asks the relays for the newest binding events and verifies each one. */
export async function loadWall(options: WallOptions = {}): Promise<Wall> {
  const limit = options.limit ?? config.wall.limit;
  const raw = await guardedQuery(
    options.query ?? uncheckedRelayQuery,
    options.relays ?? config.nostr.relays,
    { kinds: [config.nostr.bindingKind], limit },
    options.timeoutMs ?? config.nostr.queryTimeoutMs,
  );
  return buildWall(raw, limit, options.network);
}
