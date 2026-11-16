import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeEvent } from 'nostr-tools/pure';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { main } from '../bin/tambat.js';
import { createRevocationEvent } from '../src/core/binding.js';
import { lookupByAddress, lookupByPubkey, type Filter, type QueryFn } from '../src/core/discover.js';
import type { Event } from '../src/core/nostr.js';
import { bindingFromKeys } from '../src/core/paytaca.js';
import { clone, keys, other, vectors } from './helpers.js';

const T = 1763251200;

/** An in-process relay: answers authors and #i filters from a fixed list, like a NIP-01 relay would. */
function fakeRelay(events: unknown[]): QueryFn {
  return async (_relays: string[], filter: Filter) =>
    events.filter((raw) => {
      const e = raw as Event;
      if (!e || typeof e !== 'object' || !Array.isArray(e.tags)) return true; // relays may return junk
      if (filter.kinds && !filter.kinds.includes(e.kind)) return false;
      if (filter.authors && !filter.authors.includes(e.pubkey)) return false;
      const wanted = filter['#i'];
      return !wanted || e.tags.some((t) => t[0] === 'i' && wanted.includes(t[1] ?? ''));
    });
}

const mine = clone(vectors.bindingEvent);
const theirs = clone(bindingFromKeys(other, T));

describe('discover', () => {
  it('finds the newest binding of a key and skips forged events', async () => {
    const forged = { ...clone(bindingFromKeys(keys, T + 99)), content: 'tampered' };
    const r = await lookupByPubkey(keys.nostrPubkey, { query: fakeRelay([mine, forged, { junk: true }]) });
    expect(r?.ok).toBe(true);
    expect(r?.claims[0]?.address).toBe(keys.address);
  });

  it('returns null when relays hold nothing', async () => {
    expect(await lookupByPubkey(keys.nostrPubkey, { query: fakeRelay([]) })).toBeNull();
  });

  it('finds keys by address and drops a claim revoked by a newer event', async () => {
    const copied = clone(finalizeEvent({ kind: 10011, created_at: T + 1, content: '', tags: mine.tags }, other.nostrSecretKey));
    const found = await lookupByAddress(keys.address, { query: fakeRelay([mine, theirs, copied]) });
    expect(found.map((r) => r.pubkey)).toEqual([keys.nostrPubkey]);
    const revoked = clone(finalizeEvent(createRevocationEvent(mine, T + 60), keys.nostrSecretKey));
    expect(await lookupByAddress(keys.address, { query: fakeRelay([mine, revoked]) })).toEqual([]);
  });
});

describe('tambat CLI', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tambat-cli-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  it('verifies a good event, rejects an edited one and reports usage errors', async () => {
    const good = join(dir, 'good.json');
    const bad = join(dir, 'bad.json');
    writeFileSync(good, JSON.stringify(mine));
    writeFileSync(bad, JSON.stringify({ ...mine, content: 'edited' }));
    expect(await main(['verify', good])).toBe(0);
    expect(await main(['verify', bad])).toBe(1);
    expect(await main(['verify'])).toBe(2);
    expect(await main(['text', keys.npub])).toBe(0);
    expect(log.mock.calls.flat().join('\n')).toContain(vectors.nostr.npub);
    expect(await main(['text', 'npub1nope'])).toBe(2);
    expect(err).toHaveBeenCalled();
  });
});
