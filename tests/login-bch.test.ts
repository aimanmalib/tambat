import { finalizeEvent } from 'nostr-tools/pure';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../server/app.js';
import { config } from '../src/config.js';
import { bchChallengeText, ChallengeStore, LOGIN_PATH } from '../src/core/auth.js';
import { verifyBchLogin } from '../src/core/auth-bch.js';
import { signMessage } from '../src/core/bchmsg.js';
import { createRevocationEvent } from '../src/core/binding.js';
import type { QueryFn } from '../src/core/discover.js';
import { clone, fakeRelay, keys, other, vectors } from './helpers.js';

const ORIGIN = 'https://rp.example';
const T = vectors.bindingEvent.created_at + 100;
const binding = clone(vectors.bindingEvent);

/** A fake relay that also counts queries, to prove a bad signature never reaches the relays. */
function counted(events: unknown[]): { query: QueryFn; calls: () => number } {
  const inner = fakeRelay(events);
  let calls = 0;
  return {
    query: (relays, filter, timeoutMs) => {
      calls += 1;
      return inner(relays, filter, timeoutMs);
    },
    calls: () => calls,
  };
}

function makeApp(query: QueryFn) {
  return buildApp({ query, now: () => T, allowedOrigins: [ORIGIN], staticDir: '/nonexistent' });
}

async function nonce(app: ReturnType<typeof makeApp>): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/rp/challenge', headers: { origin: ORIGIN } });
  return (res.json() as { nonce: string }).nonce;
}

function bchSignIn(app: ReturnType<typeof makeApp>, n: string, address = keys.address, secret = keys.bchPrivateKey) {
  const signature = signMessage(secret, bchChallengeText({ origin: ORIGIN, nonce: n }));
  return app.inject({ method: 'POST', url: LOGIN_PATH, headers: { origin: ORIGIN }, payload: { type: 'bch', address, signature, nonce: n } });
}

describe('sign-in with a BCH key only', () => {
  const relay = counted([binding]);
  const app = makeApp(relay.query);
  afterAll(() => app.close());

  it('verifies the signature, finds the bound Nostr key on relays and keeps a session', async () => {
    const res = await bchSignIn(app, await nonce(app));
    expect(res.statusCode).toBe(200);
    expect(res.json().session).toMatchObject({ method: 'bch', pubkey: keys.nostrPubkey, npub: keys.npub, address: keys.address, bchSigned: true });
    expect(res.json().binding.eventId).toBe(binding.id);
    const cookie = res.cookies.find((c) => c.name === config.auth.cookieName);
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/api/rp' });
    const again = await app.inject({ url: '/api/rp/session', cookies: { [config.auth.cookieName]: cookie?.value ?? '' } });
    expect(again.json().session).toMatchObject({ method: 'bch', npub: keys.npub });
  });

  it('refuses an address with no Nostr identity linked', async () => {
    const res = await bchSignIn(app, await nonce(app), other.address, other.bchPrivateKey);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'no_binding', reason: 'no Nostr identity linked to this address on the relays' });
  });

  it('refuses an address whose binding was revoked by a newer event', async () => {
    const revoked = clone(finalizeEvent(createRevocationEvent(binding, binding.created_at + 50), keys.nostrSecretKey));
    const app2 = makeApp(fakeRelay([binding, revoked]));
    const res = await bchSignIn(app2, await nonce(app2));
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('no_binding');
    await app2.close();
  });

  it('refuses a reused nonce', async () => {
    const n = await nonce(app);
    expect((await bchSignIn(app, n)).statusCode).toBe(200);
    const replay = await bchSignIn(app, n);
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error).toBe('challenge_unknown');
  });

  it('refuses a signature made by another address and never asks the relays', async () => {
    const before = relay.calls();
    const res = await bchSignIn(app, await nonce(app), keys.address, other.bchPrivateKey);
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('bch_sig');
    expect(relay.calls()).toBe(before);
  });

  it('refuses a signature over the challenge of another origin', async () => {
    const n = await nonce(app);
    const signature = signMessage(keys.bchPrivateKey, bchChallengeText({ origin: 'https://evil.example', nonce: n }));
    const res = await app.inject({ method: 'POST', url: LOGIN_PATH, headers: { origin: ORIGIN }, payload: { type: 'bch', address: keys.address, signature, nonce: n } });
    expect(res.json().error).toBe('bch_sig');
  });

  it('refuses missing fields and an address of another network', async () => {
    const res = await app.inject({ method: 'POST', url: LOGIN_PATH, headers: { origin: ORIGIN }, payload: { type: 'bch', address: keys.address } });
    expect(res.json().error).toBe('input');
    const test = await bchSignIn(app, await nonce(app), vectors.bch.address.bchtest);
    expect(test.json().error).toBe('address');
  });
});

describe('verifyBchLogin', () => {
  const store = new ChallengeStore(120, 10);
  const answer = (n: string, origin = ORIGIN) => ({
    type: 'bch',
    address: keys.address,
    nonce: n,
    signature: signMessage(keys.bchPrivateKey, bchChallengeText({ origin, nonce: n })),
  });

  it('refuses an expired challenge and a challenge issued to another origin', () => {
    const old = store.issue(ORIGIN, T - 500);
    expect(verifyBchLogin(answer(old.nonce), { origin: ORIGIN, store, now: T })).toMatchObject({ ok: false, error: 'challenge_expired' });
    const elsewhere = store.issue('https://other.example', T);
    expect(verifyBchLogin(answer(elsewhere.nonce), { origin: ORIGIN, store, now: T })).toMatchObject({ ok: false, error: 'origin' });
  });

  it('keeps the nonce when the signature does not verify, and consumes it once it does', () => {
    const c = store.issue(ORIGIN, T);
    const bad = { ...answer(c.nonce), signature: signMessage(other.bchPrivateKey, bchChallengeText(c)) };
    expect(verifyBchLogin(bad, { origin: ORIGIN, store, now: T })).toMatchObject({ ok: false, error: 'bch_sig' });
    expect(verifyBchLogin(answer(c.nonce), { origin: ORIGIN, store, now: T })).toMatchObject({ ok: true, address: keys.address });
    expect(verifyBchLogin(answer(c.nonce), { origin: ORIGIN, store, now: T })).toMatchObject({ ok: false, error: 'challenge_unknown' });
  });
});
