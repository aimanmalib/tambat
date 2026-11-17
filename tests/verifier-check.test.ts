import { describe, expect, it, vi } from 'vitest';
import { toNpub } from '../src/core/nostr.js';
import { check, parseRelays } from '../verifier/check.js';
import { clone, fakeRelay, keys, vectors } from './helpers.js';

const RELAYS = 'wss://relay.one\nwss://relay.two';

describe('one-file verifier checks', () => {
  it('checks a pasted event on the device without asking any relay', async () => {
    const query = vi.fn(fakeRelay([]));
    const out = await check(JSON.stringify(vectors.bindingEvent), RELAYS, query);
    expect(out.kind).toBe('pasted');
    if (out.kind !== 'pasted') return;
    expect(out.result.ok).toBe(true);
    expect(out.result.steps.find((s) => s.name === 'newest')?.status).toBe('skip');
    expect(query).not.toHaveBeenCalled();
  });

  it('names the failing step of a pasted event that was edited after signing', async () => {
    const edited = { ...clone(vectors.bindingEvent), content: 'edited' };
    const out = await check(JSON.stringify(edited), RELAYS);
    expect(out.kind === 'pasted' && out.result.steps.find((s) => s.name === 'event_id')?.status).toBe('fail');
    expect(out.kind === 'pasted' && out.result.ok).toBe(false);
  });

  it('rejects text that starts like JSON but is not', async () => {
    expect(await check('{"kind": 10011,', RELAYS)).toMatchObject({ kind: 'error', key: 'verifier.badJson' });
  });

  it('looks up an npub and an address on exactly the relays in the field', async () => {
    const query = vi.fn(fakeRelay([vectors.bindingEvent]));
    const byKey = await check(toNpub(keys.nostrPubkey), RELAYS, query);
    expect(byKey).toMatchObject({ kind: 'found', relays: ['wss://relay.one', 'wss://relay.two'] });
    expect(byKey.kind === 'found' && byKey.results[0]?.ok).toBe(true);
    const byAddress = await check(keys.address, RELAYS, query);
    expect(byAddress.kind === 'found' && byAddress.results.map((r) => r.pubkey)).toEqual([keys.nostrPubkey]);
    for (const call of query.mock.calls) expect(call[0]).toEqual(['wss://relay.one', 'wss://relay.two']);
  });

  it('refuses relays that are not WebSocket URLs and input that is no key or address', async () => {
    expect(await check(keys.address, 'https://tambat.example', fakeRelay([]))).toMatchObject({ kind: 'error', key: 'verifier.badRelays' });
    expect(await check('hello', RELAYS, fakeRelay([]))).toMatchObject({ kind: 'error', key: 'lookup.inputError' });
    expect(parseRelays('wss://a, ws://127.0.0.1:4311  wss://a')).toEqual(['wss://a', 'ws://127.0.0.1:4311']);
    expect(parseRelays('  ')).toEqual({ bad: '' });
  });
});
