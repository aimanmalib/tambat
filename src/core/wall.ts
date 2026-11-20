/**
 * The wall: the newest binding events on the relays, each verified in the browser. Relays are untrusted, so the
 * query keeps events whose signature fails (a plain pool would drop them unseen) and every one is checked here. An
 * event that fails a step is never listed; it only adds to the `hidden` count. An event replaced by a newer one from
 * the same key is not current and is left out without counting as a failure.
 */
import { config } from '../config.js';
import { claimFromTag } from './binding.js';
import { createRelayQuery, guardedQuery, type DiscoverOptions, type QueryFn } from './discover.js';
import { eventShapeError, idMatches, signatureValid, type Event } from './nostr.js';
import type { ProofForm, TxLookup } from './tx-proof.js';
import { verifyBinding, type BindingResult } from './verify.js';
import { proofTxids, readTxLookups, type ChainReading } from './verify-chain.js';

export interface WallEntry {
  npub: string;
  pubkey: string;
  /** The first BCH address the event claims; every claim in it verified. */
  address: string;
  createdAt: number;
  eventId: string;
  /** How the first claim proves the address: a signed message or a transaction (`tx:<txid>`). */
  proof: ProofForm;
}

export interface Wall {
  entries: WallEntry[];
  /** Binding events that failed verification and were not shown. */
  hidden: number;
  /** Distinct identity events read from the relays to find the entries. */
  scanned: number;
  /** Bindings whose on-chain proof was not read yet: neither listed nor hidden. Absent when there are none. */
  unchecked?: number;
}

export interface WallOptions extends DiscoverOptions {
  limit?: number;
  /** Events asked of each relay per page. */
  pageSize?: number;
  /** Pages asked of each relay at most. */
  maxPages?: number;
  /** Chain servers for on-chain proofs (`tx:<txid>`); without them those bindings stay unchecked. */
  chain?: ChainReading;
  /** Called with the wall built from the relays alone, before the chain is read, so a page can show it at once. */
  onRelays?: (wall: Wall) => void;
}

/** Browser relay query that keeps events with bad signatures, so the wall can count them instead of losing them. */
export const uncheckedRelayQuery: QueryFn = createRelayQuery(undefined, { keepUnverified: true });

/** True when the item is shaped like a binding event and names at least one BCH identity. */
function namesBch(item: unknown): boolean {
  const tags = (item as { tags?: unknown } | null)?.tags;
  return Array.isArray(tags) && tags.some((t) => Array.isArray(t) && claimFromTag(t as string[]) !== null);
}

const genuine = (e: Event): boolean => idMatches(e) && signatureValid(e);

/** Nothing failed, but an on-chain proof was not read from the chain: the binding is not checked yet. */
function awaitsChain(r: BindingResult): boolean {
  const all = [...r.steps, ...r.claims.flatMap((c) => c.steps)];
  return !all.some((s) => s.status === 'fail') && r.claims.some((c) => c.steps.some((s) => s.code === 'chain_unreadable'));
}

/** Only the `newest` step failed: a genuine event that a newer one from the same key replaced. */
function onlyReplaced(r: BindingResult): boolean {
  const failed = r.steps.filter((s) => s.status === 'fail');
  return failed.length > 0 && failed.every((s) => s.name === 'newest') && r.claims.length > 0 && r.claims.every((c) => c.ok);
}

/** Verifies relay results for the wall. Pure: no network, so tests feed it any mix of events. */
export function buildWall(raw: unknown[], limit: number, network = config.network, txLookups: Record<string, TxLookup> = {}): Wall {
  const byId = new Map<string, Event>();
  let hidden = 0;
  let unchecked = 0;
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
  // Every genuine kind 10011 event by an author of a BCH claim counts for the newest check, including revocations
  // that name no BCH address. Other authors cannot change the result, so their signatures are not checked here.
  const authors = new Set([...byId.values()].filter(namesBch).map((e) => e.pubkey));
  const sameAuthorEvents = [...byId.values()].filter((e) => authors.has(e.pubkey) && genuine(e));
  const results: BindingResult[] = [];
  for (const e of byId.values()) {
    if (!namesBch(e)) continue;
    const r = verifyBinding(e, { network, sameAuthorEvents, txLookups });
    if (r.ok) results.push(r);
    else if (awaitsChain(r)) unchecked += 1;
    else if (!onlyReplaced(r)) hidden += 1;
  }
  const entries = results
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map((r) => ({
      npub: r.npub,
      pubkey: r.pubkey,
      address: r.claims[0]?.address ?? '',
      createdAt: r.createdAt,
      eventId: r.eventId,
      proof: r.claims[0]?.proof ?? 'message',
    }));
  return unchecked > 0 ? { entries, hidden, scanned: byId.size, unchecked } : { entries, hidden, scanned: byId.size };
}

/** Where one relay's paging stands: the `until` for its next page, or done. */
interface Cursor {
  relay: string;
  until?: number;
  done: boolean;
}

const createdAtOf = (item: unknown): number | null => {
  const t = (item as { created_at?: unknown } | null)?.created_at;
  return typeof t === 'number' && Number.isInteger(t) ? t : null;
};

/** What the relays returned so far, kept between reads so a refresh adds to it instead of starting over. */
export interface WallPool {
  raw: unknown[];
  seen: Set<string>;
}

export const createWallPool = (): WallPool => ({ raw: [], seen: new Set() });

/** Adds relay results to the pool; returns how many were new and the oldest `created_at` among them all. */
function addToPool(pool: WallPool, got: unknown[]): { fresh: number; oldest: number } {
  let fresh = 0;
  let oldest = Infinity;
  for (const item of got) {
    const at = createdAtOf(item);
    if (at !== null) oldest = Math.min(oldest, at);
    const id = (item as { id?: unknown } | null)?.id;
    // Two copies of one id may differ (one forged), so the whole item is the key; buildWall keeps the genuine one.
    const key = typeof id === 'string' ? `${id}:${JSON.stringify(item)}` : JSON.stringify(item);
    if (pool.seen.has(key)) continue;
    pool.seen.add(key);
    pool.raw.push(item);
    fresh += 1;
  }
  return { fresh, oldest };
}

/** Adds one event that arrived on an open subscription. True when it is new and names a BCH identity. */
export function addLiveEvent(pool: WallPool, item: unknown): boolean {
  return addToPool(pool, [item]).fresh > 0 && namesBch(item);
}

/**
 * Builds the wall from the pool. Transactions named by on-chain proofs are read only when some binding names one;
 * `onRelays` sees the wall before that read.
 */
export async function wallFromPool(pool: WallPool, options: WallOptions = {}): Promise<Wall> {
  const limit = options.limit ?? config.wall.limit;
  const wall = buildWall(pool.raw, limit, options.network);
  const txids = options.chain ? proofTxids(pool.raw.filter(namesBch)) : [];
  if (!options.chain || txids.length === 0) return wall;
  options.onRelays?.(wall);
  return buildWall(pool.raw, limit, options.network, await readTxLookups(txids, options.chain));
}

/**
 * Asks the relays for identity events newest first and verifies each one. Relays cannot filter on the value of an
 * `i` tag, so bindings of other platforms crowd out BCH ones; each relay is paged back with `until` on its own
 * cursor until `limit` verified BCH bindings are found, the relay runs out, or `maxPages` pages were read.
 */
export async function loadWall(options: WallOptions = {}, pool: WallPool = createWallPool()): Promise<Wall> {
  const limit = options.limit ?? config.wall.limit;
  const pageSize = options.pageSize ?? config.wall.pageSize;
  const maxPages = options.maxPages ?? config.wall.maxPages;
  const query = options.query ?? uncheckedRelayQuery;
  const timeoutMs = options.timeoutMs ?? config.nostr.queryTimeoutMs;
  const cursors: Cursor[] = (options.relays ?? config.nostr.relays).map((relay) => ({ relay, done: false }));
  let wall = buildWall(pool.raw, limit, options.network);
  for (let page = 0; page < maxPages && wall.entries.length < limit; page += 1) {
    const open = cursors.filter((c) => !c.done);
    if (open.length === 0) break;
    await Promise.all(
      open.map(async (c) => {
        const filter = { kinds: [config.nostr.bindingKind], limit: pageSize, ...(c.until === undefined ? {} : { until: c.until }) };
        const got = await guardedQuery(query, [c.relay], filter, timeoutMs, options.watch);
        const { fresh, oldest } = addToPool(pool, got);
        // `until` is inclusive, so the next page starts at the oldest second seen; a page with nothing new ends it.
        c.done = got.length < pageSize || fresh === 0 || oldest === Infinity;
        c.until = oldest;
      }),
    );
    wall = buildWall(pool.raw, limit, options.network);
  }
  return wallFromPool(pool, options);
}

/**
 * Checks the wall again: asks every relay for its newest page only, adds what is new to the pool and verifies the
 * whole pool once more, so a binding replaced or added since the last read shows up without paging back again.
 */
export async function refreshWall(pool: WallPool, options: WallOptions = {}): Promise<Wall> {
  const query = options.query ?? uncheckedRelayQuery;
  const timeoutMs = options.timeoutMs ?? config.nostr.queryTimeoutMs;
  const filter = { kinds: [config.nostr.bindingKind], limit: options.pageSize ?? config.wall.pageSize };
  const relays = options.relays ?? config.nostr.relays;
  const pages = await Promise.all(relays.map((relay) => guardedQuery(query, [relay], filter, timeoutMs, options.watch)));
  for (const got of pages) addToPool(pool, got);
  return wallFromPool(pool, options);
}
