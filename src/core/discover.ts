/**
 * Finding bindings on relays. Relays are untrusted: every event they return is verified again here, and a
 * claim found by address only counts if it is still in the author's newest kind 10011 event.
 */
import type { Filter } from 'nostr-tools/filter';
import { AbstractSimplePool } from 'nostr-tools/abstract-pool';
import { verifyEvent } from 'nostr-tools/pure';
import { config } from '../config.js';
import { claimIdentity } from './binding.js';
import { parseP2pkhAddress } from './cashaddr.js';
import { eventShapeError, idMatches, signatureValid, type Event } from './nostr.js';
import { isNewer, verifyBinding, type BindingResult, type VerifyOptions } from './verify.js';

export type { Filter };

/** Queries relays and resolves with whatever events arrived before the timeout. Must not reject. */
export type QueryFn = (relays: string[], filter: Filter, timeoutMs: number) => Promise<unknown[]>;

/**
 * Builds a relay query on a fresh pool. `websocketImplementation` is the WebSocket class to use; browsers pass
 * nothing and get the global one. Node must pass the `ws` package (see src/node/relay.ts): Node's built-in
 * WebSocket re-enters its error handler when a relay fails during the handshake and the process dies.
 */
export function createRelayQuery(websocketImplementation?: typeof WebSocket): QueryFn {
  return async (relays, filter, timeoutMs) => {
    const pool = new AbstractSimplePool({
      verifyEvent,
      // A relay that accepts the TCP connection but never answers must not hold the query past its timeout.
      maxWaitForConnection: timeoutMs,
      websocketImplementation: websocketImplementation ?? globalThis.WebSocket,
    });
    try {
      return await pool.querySync(relays, filter, { maxWait: timeoutMs });
    } catch {
      return [];
    } finally {
      pool.close(relays);
    }
  };
}

/** Relay query using the global WebSocket. For browsers; Node code uses the query from src/node/relay.ts. */
export const relayQuery: QueryFn = createRelayQuery();

export interface DiscoverOptions extends Pick<VerifyOptions, 'network'> {
  relays?: string[];
  timeoutMs?: number;
  query?: QueryFn;
}

/** Extra wait after a query's own timeout before a stuck relay call is given up. */
const GRACE_MS = 250;

/**
 * Runs a query so that a relay which throws or never answers cannot break a lookup: errors become an empty
 * result and a query still pending after the timeout (plus a small grace period) resolves empty.
 */
export async function guardedQuery(query: QueryFn, relays: string[], filter: Filter, timeoutMs: number): Promise<unknown[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<unknown[]>((resolve) => {
    timer = setTimeout(() => resolve([]), timeoutMs + GRACE_MS);
  });
  try {
    const result = await Promise.race([query(relays, filter, timeoutMs).catch(() => []), late]);
    return Array.isArray(result) ? result : [];
  } finally {
    clearTimeout(timer);
  }
}

function validEvents(raw: unknown[]): Event[] {
  const seen = new Map<string, Event>();
  for (const item of raw) {
    if (eventShapeError(item)) continue;
    const e = item as Event;
    if (e.kind !== config.nostr.bindingKind || seen.has(e.id) || !idMatches(e) || !signatureValid(e)) continue;
    seen.set(e.id, e);
  }
  return [...seen.values()];
}

function newest(events: Event[]): Event | null {
  return events.reduce<Event | null>((best, e) => (best === null || isNewer(e, best) ? e : best), null);
}

/** The newest binding event of a Nostr key, verified, or null when relays hold none. */
export async function lookupByPubkey(pubkey: string, options: DiscoverOptions = {}): Promise<BindingResult | null> {
  const raw = await guardedQuery(
    options.query ?? relayQuery,
    options.relays ?? config.nostr.relays,
    { kinds: [config.nostr.bindingKind], authors: [pubkey] },
    options.timeoutMs ?? config.nostr.queryTimeoutMs,
  );
  const events = validEvents(raw).filter((e) => e.pubkey === pubkey);
  const top = newest(events);
  if (!top) return null;
  const verifyOptions: VerifyOptions = { sameAuthorEvents: events };
  if (options.network) verifyOptions.network = options.network;
  return verifyBinding(top, verifyOptions);
}

/** Nostr keys whose newest binding still claims this address and passes every step. */
export async function lookupByAddress(address: string, options: DiscoverOptions = {}): Promise<BindingResult[]> {
  const parsed = parseP2pkhAddress(address);
  if (typeof parsed === 'string') throw new Error(parsed);
  const raw = await guardedQuery(
    options.query ?? relayQuery,
    options.relays ?? config.nostr.relays,
    { kinds: [config.nostr.bindingKind], '#i': [claimIdentity(parsed.address)] },
    options.timeoutMs ?? config.nostr.queryTimeoutMs,
  );
  const authors = [...new Set(validEvents(raw).map((e) => e.pubkey))];
  const results = await Promise.all(authors.map((a) => lookupByPubkey(a, options)));
  return results.filter(
    (r): r is BindingResult => r !== null && r.ok && r.claims.some((c) => c.address.toLowerCase() === parsed.address),
  );
}
