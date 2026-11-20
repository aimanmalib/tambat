/**
 * The wall keeps itself current (KT17 d): a check of every relay's newest page on a timer that stops while the tab is
 * hidden, events from an open subscription, and a count strip whose numbers come only from reads made on the page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { finalizeEvent } from 'nostr-tools/pure';
import { config } from '../src/config.js';
import type { Filter, QueryFn } from '../src/core/discover.js';
import type { Event } from '../src/core/nostr.js';
import type { ParsedAttestation } from '../src/core/attest.js';
import { bindingFromKeys } from '../src/core/paytaca.js';
import { addLiveEvent, createWallPool, loadWall, refreshWall, type Wall, type WallEntry } from '../src/core/wall.js';
import { startRefreshLoop } from '../web/wall/refresh-loop.js';
import { countAttestations, stripOf } from '../web/wall/strip.js';
import { clone, keys, other, third, vectors } from './helpers.js';

const T = vectors.bindingEvent.created_at;
const first = clone(vectors.bindingEvent);

/** A relay that answers kinds, until and limit, newest first; records every filter it was asked. */
function relay(events: () => Event[], asked: Filter[]): QueryFn {
  return (_relays, filter) => {
    asked.push(filter);
    const hits = events()
      .filter((e) => (!filter.kinds || filter.kinds.includes(e.kind)) && (filter.until === undefined || e.created_at <= filter.until))
      .sort((a, b) => b.created_at - a.created_at);
    return Promise.resolve(hits.slice(0, filter.limit ?? hits.length));
  };
}

describe('refreshWall', () => {
  it('adds a binding published after the first read, asking each relay for its newest page only', async () => {
    const held: Event[] = [first];
    const asked: Filter[] = [];
    const query = relay(() => held, asked);
    const pool = createWallPool();
    const options = { relays: ['wss://a.example', 'wss://b.example'], timeoutMs: 200, pageSize: 50, maxPages: 3, query };
    const before = await loadWall(options, pool);
    expect(before.entries.map((e) => e.eventId)).toEqual([first.id]);
    const later = bindingFromKeys(other, T + 60);
    held.push(later);
    asked.length = 0;
    const after = await refreshWall(pool, options);
    expect(after.entries.map((e) => e.eventId)).toEqual([later.id, first.id]);
    expect(asked).toHaveLength(2);
    expect(asked.every((f) => f.until === undefined && f.limit === 50 && f.kinds?.[0] === config.nostr.bindingKind)).toBe(true);
    // Events already in the pool are not counted twice.
    expect(after.scanned).toBe(2);
  });

  it('drops a binding its author replaced since the last read', async () => {
    const held: Event[] = [first];
    const query = relay(() => held, []);
    const pool = createWallPool();
    const options = { relays: ['wss://a.example'], timeoutMs: 200, pageSize: 50, query };
    await loadWall(options, pool);
    const replacement = bindingFromKeys(keys, T + 60);
    held.push(replacement);
    const after = await refreshWall(pool, options);
    expect(after.entries.map((e) => e.eventId)).toEqual([replacement.id]);
    expect(after.hidden).toBe(0);
  });
});

describe('addLiveEvent', () => {
  it('takes a new BCH binding once and ignores events of other platforms', () => {
    const pool = createWallPool();
    const live = bindingFromKeys(third, T + 10);
    const github = finalizeEvent({ kind: config.nostr.bindingKind, created_at: T, content: '', tags: [['i', 'github:x', 'p']] }, other.nostrSecretKey);
    expect(addLiveEvent(pool, live)).toBe(true);
    expect(addLiveEvent(pool, clone(live))).toBe(false);
    expect(addLiveEvent(pool, github)).toBe(false);
    expect(pool.raw).toHaveLength(2);
  });
});

describe('startRefreshLoop', () => {
  let hidden = false;
  let listener: (() => void) | null = null;
  const deps = () => ({ hidden: () => hidden, onVisibility: (cb: () => void) => ((listener = cb), () => (listener = null)) });
  const setVisible = (visible: boolean) => {
    hidden = !visible;
    listener?.();
  };
  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
  });
  afterEach(() => vi.useRealTimers());

  it('checks once per interval while visible', async () => {
    const check = vi.fn(() => Promise.resolve());
    const stop = startRefreshLoop(30_000, check, deps());
    await vi.advanceTimersByTimeAsync(29_999);
    expect(check).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(check).toHaveBeenCalledTimes(3);
    stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(check).toHaveBeenCalledTimes(3);
    expect(listener).toBeNull();
  });

  it('pauses while the tab is hidden and checks at once when it shows again past due', async () => {
    const check = vi.fn(() => Promise.resolve());
    startRefreshLoop(30_000, check, deps());
    await vi.advanceTimersByTimeAsync(10_000);
    setVisible(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(check).toHaveBeenCalledTimes(0);
    setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('waits out the rest of the interval when the tab shows again before it was due', async () => {
    const check = vi.fn(() => Promise.resolve());
    startRefreshLoop(30_000, check, deps());
    await vi.advanceTimersByTimeAsync(10_000);
    setVisible(false);
    await vi.advanceTimersByTimeAsync(5_000);
    setVisible(true);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(check).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('times the next check from the end of a slow one, so checks never overlap', async () => {
    let running = 0;
    let most = 0;
    const check = vi.fn(async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 45_000));
      running -= 1;
    });
    startRefreshLoop(30_000, check, deps());
    await vi.advanceTimersByTimeAsync(30_000 + 45_000 + 29_999);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(2);
    expect(most).toBe(1);
  });
});

const entry = (eventId: string, pubkey: string, proof: 'message' | 'tx' = 'message'): WallEntry => ({
  npub: `npub-${pubkey}`,
  pubkey,
  address: `bitcoincash:q${pubkey}`,
  createdAt: T,
  eventId,
  proof,
});
const wallOf = (entries: WallEntry[], extra: Partial<Wall> = {}): Wall => ({ entries, hidden: 0, scanned: entries.length, ...extra });
const relays = [
  { relay: 'wss://a', state: 'answered' as const, ms: 10 },
  { relay: 'wss://b', state: 'silent' as const, ms: null },
  { relay: 'wss://c', state: 'answered' as const, ms: 20 },
];

describe('stripOf', () => {
  it('counts only what was read: verified, anchored of read, on-chain, relays, newest block and the UTC time', () => {
    const wall = wallOf([entry('e1', 'p1'), entry('e2', 'p2', 'tx'), entry('e3', 'p3')]);
    const anchors = new Map([['e1', 977901], ['e2', null], ['gone', 999999]]);
    const strip = stripOf({ wall, relays, anchors, attestations: 2, updatedAt: new Date('2026-11-20T05:06:07.890Z') });
    expect(strip).toEqual({
      verified: 3,
      anchored: { count: 1, checked: 2 },
      onChain: 1,
      attestations: 2,
      relays: { answered: 2, total: 3 },
      latestBlock: 977901,
      updated: '05:06:07',
    });
  });

  it('leaves unread numbers empty instead of zero', () => {
    const none = stripOf({ wall: null, relays, anchors: new Map(), attestations: 4, updatedAt: null });
    expect(none).toMatchObject({ verified: null, anchored: null, onChain: null, attestations: null, latestBlock: null, updated: null });
    const unread = stripOf({ wall: wallOf([entry('e2', 'p2', 'tx')], { unchecked: 1 }), relays, anchors: new Map([['e2', null]]), attestations: null, updatedAt: null });
    expect(unread).toMatchObject({ verified: 1, anchored: { count: 0, checked: 1 }, onChain: null, attestations: null, latestBlock: null });
  });
});

describe('countAttestations', () => {
  const att = (attester: string, subject: string, bindingEventId: string) => ({ attester, subject, bindingEventId, event: {} }) as ParsedAttestation;
  it('counts one per attester and listed key, for the listed binding only', () => {
    const entries = [entry('e1', 'p1'), entry('e2', 'p2')];
    const found = [att('a', 'p1', 'e1'), att('a', 'p1', 'e1'), att('b', 'p1', 'e1'), att('a', 'p2', 'old'), att('c', 'p9', 'e9'), att('c', 'p2', 'e2')];
    expect(countAttestations(found, entries)).toBe(3);
  });
});
