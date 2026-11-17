import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../server/app.js';
import { config, parseConfig } from '../src/config.js';
import { lookupByNip05, nip05Url, parseNip05, resolveNip05, servedNames, type Nip05Problem } from '../src/core/nip05.js';
import { leafKeys, translate, type Dictionary } from '../src/i18n.js';
import { clone, fakeRelay, keys, other, vectors } from './helpers.js';

const alice = { name: 'alice', domain: 'names.example' };

/** A domain that answers every request with this JSON body (or status), recording the URL and init it was asked with. */
function domain(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const problem = async (body: unknown, status = 200): Promise<Nip05Problem | 'ok'> => {
  const r = await resolveNip05(alice, { fetch: domain(body, status).fetch });
  return r.ok ? 'ok' : r.problem;
};

describe('parseNip05', () => {
  it('reads name@domain in lower case', () => {
    expect(parseNip05(' Alice@Names.Example ')).toEqual(alice);
    expect(parseNip05('_@names.example')).toEqual({ name: '_', domain: 'names.example' });
  });

  it('does not take npubs, addresses, bare domains or a domain without a dot', () => {
    for (const input of [vectors.nostr.npub, vectors.bch.address.bitcoincash, 'names.example', 'alice@localhost', '@names.example', 'a b@names.example']) {
      expect(parseNip05(input), input).toBeNull();
    }
  });

  it('builds the well-known URL from the name', () => {
    expect(nip05Url(alice)).toBe('https://names.example/.well-known/nostr.json?name=alice');
  });
});

describe('resolveNip05', () => {
  it('returns the key the domain lists for the name, refusing redirects', async () => {
    const d = domain({ names: { alice: keys.nostrPubkey } });
    const r = await resolveNip05(alice, { fetch: d.fetch });
    expect(r).toMatchObject({ ok: true, pubkey: keys.nostrPubkey, npub: keys.npub, name: 'alice' });
    expect(d.calls[0]?.url).toBe(nip05Url(alice));
    expect(d.calls[0]?.init?.redirect).toBe('error');
  });

  it('reports a domain that does not answer', async () => {
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof globalThis.fetch;
    expect(await resolveNip05(alice, { fetch: down })).toMatchObject({ ok: false, problem: 'unreachable' });
    expect(await problem({ names: { alice: keys.nostrPubkey } }, 404)).toBe('unreachable');
  });

  it('gives up on a domain that hangs', async () => {
    const hang = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as unknown as typeof globalThis.fetch;
    expect(await resolveNip05(alice, { fetch: hang, timeoutMs: 20 })).toMatchObject({ ok: false, problem: 'unreachable' });
  });

  it('rejects an answer whose names do not match the name asked for', async () => {
    expect(await problem({ names: { bob: keys.nostrPubkey } })).toBe('unknown_name');
    expect(await problem({ names: { Alice: keys.nostrPubkey } })).toBe('unknown_name');
    expect(await problem({ names: {} })).toBe('unknown_name');
  });

  it('rejects an answer without a names object or with a bad key', async () => {
    expect(await problem({ pubkey: keys.nostrPubkey })).toBe('bad_answer');
    expect(await problem({ names: [keys.nostrPubkey] })).toBe('bad_answer');
    expect(await problem(null)).toBe('bad_answer');
    expect(await problem({ names: { alice: keys.nostrPubkey.toUpperCase() } })).toBe('bad_key');
    expect(await problem({ names: { alice: keys.npub } })).toBe('bad_key');
  });
});

describe('lookupByNip05', () => {
  const binding = clone(vectors.bindingEvent);

  it('verifies the binding of the key the name points to', async () => {
    const r = await lookupByNip05(alice, { fetch: domain({ names: { alice: keys.nostrPubkey } }).fetch, query: fakeRelay([binding]) });
    expect(r.binding?.ok).toBe(true);
    expect(r.binding?.claims[0]?.address).toBe(vectors.bch.address.bitcoincash);
  });

  it('finds no binding for a key that never signed one, even when the domain lists it', async () => {
    const r = await lookupByNip05(alice, { fetch: domain({ names: { alice: other.nostrPubkey } }).fetch, query: fakeRelay([binding]) });
    expect(r.resolution.ok).toBe(true);
    expect(r.binding).toBeNull();
  });

  it('does not ask relays when the name does not resolve', async () => {
    let asked = false;
    const query = fakeRelay([binding]);
    const r = await lookupByNip05(alice, {
      fetch: domain({ names: {} }).fetch,
      query: (...args) => {
        asked = true;
        return query(...args);
      },
    });
    expect(r).toMatchObject({ resolution: { ok: false, problem: 'unknown_name' }, binding: null });
    expect(asked).toBe(false);
  });
});

describe('served /.well-known/nostr.json', () => {
  const [demoName, demoKey] = Object.entries(config.nip05.names)[0] ?? ['', ''];
  const app = buildApp({ query: fakeRelay([]), staticDir: '/nonexistent', verifierFile: '/nonexistent.html' });

  it('answers the configured demo name with its key, readable from any origin', async () => {
    const res = await app.inject({ method: 'GET', url: `/.well-known/nostr.json?name=${demoName}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.json()).toEqual({ names: { [demoName]: demoKey } });
  });

  it('answers no other name and does not list names when none is asked for', async () => {
    for (const url of ['/.well-known/nostr.json?name=someone', '/.well-known/nostr.json', '/.well-known/nostr.json?name=__proto__']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.json(), url).toEqual({ names: {} });
      expect(res.headers['access-control-allow-origin']).toBe('*');
    }
  });

  it('matches names without regard to case', () => {
    expect(servedNames('Alice', { alice: keys.nostrPubkey })).toEqual({ names: { alice: keys.nostrPubkey } });
  });

  it('config rejects a name or key NIP-05 does not allow', () => {
    const fresh = () => JSON.parse(readFileSync(new URL('../config/tambat.json', import.meta.url), 'utf8'));
    const badName = fresh();
    badName.nip05.names = { 'Bad Name': keys.nostrPubkey };
    expect(() => parseConfig(badName)).toThrow(/nip05.names/);
    const badKey = fresh();
    badKey.nip05.names = { demo: keys.npub };
    expect(() => parseConfig(badKey)).toThrow(/nip05.names.demo/);
  });
});

describe('name lookup text', () => {
  it('every problem has a sentence in both languages', () => {
    const problems: Nip05Problem[] = ['unreachable', 'bad_answer', 'unknown_name', 'bad_key'];
    for (const lang of ['en', 'ms']) {
      const dict = JSON.parse(readFileSync(new URL(`../lang/${lang}.json`, import.meta.url), 'utf8')) as Dictionary;
      for (const p of problems) {
        expect(leafKeys(dict), `${lang} nip05.${p}`).toContain(`nip05.${p}`);
        expect(translate(dict, `nip05.${p}`), `${lang} ${p}`).toContain('{name}');
      }
    }
  });
});
