/**
 * The wall pages back through each relay with `until`, because a relay cannot filter on the value of an `i` tag and
 * the newest identity events may all name other platforms. An older BCH binding must still be found.
 */
import { describe, expect, it } from 'vitest';
import { finalizeEvent } from 'nostr-tools/pure';
import { config } from '../src/config.js';
import type { Filter, QueryFn } from '../src/core/discover.js';
import type { Event } from '../src/core/nostr.js';
import { loadWall } from '../src/core/wall.js';
import { clone, other, vectors } from './helpers.js';

const binding = clone(vectors.bindingEvent);

/** Genuine identity events naming another platform, all newer than the BCH binding. */
function otherPlatform(count: number, from: number): Event[] {
  return Array.from({ length: count }, (_, i) =>
    finalizeEvent({ kind: config.nostr.bindingKind, created_at: from + i, content: '', tags: [['i', `github:user${i}`, 'proof']] }, other.nostrSecretKey) as Event,
  );
}

/** A relay that honours kinds, until and limit, newest first, the way NIP-01 relays answer. */
function pagingRelay(byRelay: Record<string, Event[]>, filters: { relay: string; filter: Filter }[]): QueryFn {
  return (relays, filter) => {
    const relay = relays[0] ?? '';
    filters.push({ relay, filter });
    const hits = (byRelay[relay] ?? [])
      .filter((e) => (!filter.kinds || filter.kinds.includes(e.kind)) && (filter.until === undefined || e.created_at <= filter.until))
      .sort((a, b) => b.created_at - a.created_at);
    return Promise.resolve(hits.slice(0, filter.limit ?? hits.length));
  };
}

const crowd = otherPlatform(120, binding.created_at + 1000);

describe('loadWall paging', () => {
  it('finds an older BCH binding behind 120 newer events of other platforms', async () => {
    const filters: { relay: string; filter: Filter }[] = [];
    const query = pagingRelay({ 'wss://a.example': [...crowd, binding] }, filters);
    const wall = await loadWall({ relays: ['wss://a.example'], timeoutMs: 200, limit: 30, pageSize: 50, maxPages: 5, query });
    expect(wall.entries.map((e) => e.eventId)).toEqual([binding.id]);
    expect(wall.scanned).toBe(121);
    expect(wall.hidden).toBe(0);
    // Each page starts at the oldest second of the page before it.
    expect(filters.map((f) => f.filter.until)).toEqual([undefined, crowd[70]?.created_at, crowd[21]?.created_at]);
    expect(filters.every((f) => f.filter.limit === 50 && f.filter.kinds?.[0] === config.nostr.bindingKind)).toBe(true);
  });

  it('stops after maxPages even when no binding was found', async () => {
    const filters: { relay: string; filter: Filter }[] = [];
    const query = pagingRelay({ 'wss://a.example': [...crowd, binding] }, filters);
    const wall = await loadWall({ relays: ['wss://a.example'], timeoutMs: 200, limit: 30, pageSize: 50, maxPages: 2, query });
    expect(filters).toHaveLength(2);
    expect(wall.entries).toEqual([]);
    expect(wall.scanned).toBe(99);
  });

  it('stops paging once the limit of verified bindings is reached', async () => {
    const filters: { relay: string; filter: Filter }[] = [];
    const query = pagingRelay({ 'wss://a.example': [binding, ...otherPlatform(120, binding.created_at - 1000)] }, filters);
    const wall = await loadWall({ relays: ['wss://a.example'], timeoutMs: 200, limit: 1, pageSize: 50, maxPages: 5, query });
    expect(wall.entries.map((e) => e.eventId)).toEqual([binding.id]);
    expect(filters).toHaveLength(1);
  });

  it('keeps a cursor per relay, so a deep relay does not make the other skip events', async () => {
    const filters: { relay: string; filter: Filter }[] = [];
    const query = pagingRelay({ 'wss://a.example': crowd.slice(0, 60), 'wss://b.example': [...crowd.slice(60), binding] }, filters);
    const wall = await loadWall({ relays: ['wss://a.example', 'wss://b.example'], timeoutMs: 200, limit: 30, pageSize: 50, maxPages: 5, query });
    expect(wall.entries.map((e) => e.eventId)).toEqual([binding.id]);
    expect(wall.scanned).toBe(121);
    const untils = (relay: string) => filters.filter((f) => f.relay === relay).map((f) => f.filter.until);
    expect(untils('wss://a.example')).toEqual([undefined, crowd[10]?.created_at]);
    expect(untils('wss://b.example')).toEqual([undefined, crowd[70]?.created_at]);
  });
});
