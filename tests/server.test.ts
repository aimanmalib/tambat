import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeEvent } from 'nostr-tools/pure';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../server/app.js';
import { config } from '../src/config.js';
import { bchChallengeText, createAuthEvent, LOGIN_PATH } from '../src/core/auth.js';
import { signMessage } from '../src/core/bchmsg.js';
import { createRevocationEvent } from '../src/core/binding.js';
import { clone, fakeRelay, keys, other, vectors } from './helpers.js';

const ORIGIN = 'https://rp.example';
const T = vectors.bindingEvent.created_at + 100;
const binding = clone(vectors.bindingEvent);

function makeApp(events: unknown[]) {
  return buildApp({ query: fakeRelay(events), now: () => T, allowedOrigins: [ORIGIN], staticDir: '/nonexistent' });
}

async function challenge(app: ReturnType<typeof makeApp>, origin = ORIGIN) {
  const res = await app.inject({ method: 'POST', url: '/api/rp/challenge', headers: { origin } });
  return { res, body: res.json() as { nonce: string; url: string; method: string; bchText: string } };
}

function signIn(app: ReturnType<typeof makeApp>, nonce: string, secret = keys.nostrSecretKey, extra: object = {}) {
  const event = clone(finalizeEvent(createAuthEvent({ origin: ORIGIN, nonce }, T), secret));
  return app.inject({ method: 'POST', url: LOGIN_PATH, headers: { origin: ORIGIN }, payload: { event, ...extra } });
}

describe('relying app server', () => {
  const app = makeApp([binding]);
  afterAll(() => app.close());

  it('answers /healthz', async () => {
    const res = await app.inject({ url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('refuses a challenge to an origin not on the list', async () => {
    expect((await challenge(app, 'https://evil.example')).res.statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/rp/challenge' })).statusCode).toBe(403);
  });

  it('signs in, looks the binding up on relays and keeps an HttpOnly session', async () => {
    const { body } = await challenge(app);
    expect(body).toMatchObject({ url: `${ORIGIN}${LOGIN_PATH}`, method: 'POST' });
    const res = await signIn(app, body.nonce);
    expect(res.statusCode).toBe(200);
    expect(res.json().session).toMatchObject({ pubkey: keys.nostrPubkey, address: keys.address, bchSigned: false });
    const cookie = res.cookies.find((c) => c.name === config.auth.cookieName);
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', secure: true, path: '/api/rp' });
    expect(res.headers['cache-control']).toBe('no-store');
    const again = await app.inject({ url: '/api/rp/session', cookies: { [config.auth.cookieName]: cookie?.value ?? '' } });
    expect(again.json().session.address).toBe(keys.address);
    const out = await app.inject({
      method: 'POST',
      url: '/api/rp/logout',
      headers: { origin: ORIGIN },
      cookies: { [config.auth.cookieName]: cookie?.value ?? '' },
    });
    expect(out.statusCode).toBe(204);
    const gone = await app.inject({ url: '/api/rp/session', cookies: { [config.auth.cookieName]: cookie?.value ?? '' } });
    expect(gone.statusCode).toBe(401);
  });

  it('rejects a replayed answer', async () => {
    const { body } = await challenge(app);
    expect((await signIn(app, body.nonce)).statusCode).toBe(200);
    const replay = await signIn(app, body.nonce);
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error).toBe('challenge_unknown');
  });

  it('accepts a BCH signature over the challenge from the bound address only', async () => {
    const first = (await challenge(app)).body;
    const good = await signIn(app, first.nonce, keys.nostrSecretKey, { bchSignature: signMessage(keys.bchPrivateKey, first.bchText) });
    expect(good.json().session.bchSigned).toBe(true);
    const second = (await challenge(app)).body;
    const bad = await signIn(app, second.nonce, keys.nostrSecretKey, { bchSignature: signMessage(other.bchPrivateKey, second.bchText) });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error).toBe('bch_sig');
    expect(bchChallengeText({ origin: ORIGIN, nonce: second.nonce })).toBe(second.bchText);
  });

  it('signs in a key without a binding but shows no address', async () => {
    const { body } = await challenge(app);
    const res = await signIn(app, body.nonce, other.nostrSecretKey);
    expect(res.json().session).toMatchObject({ pubkey: other.nostrPubkey, address: null });
  });

  it('shows no address after the binding is revoked by a newer event', async () => {
    const revoked = clone(finalizeEvent(createRevocationEvent(binding, binding.created_at + 50), keys.nostrSecretKey));
    const app2 = makeApp([binding, revoked]);
    const { body } = await challenge(app2);
    expect((await signIn(app2, body.nonce)).json().session.address).toBeNull();
    await app2.close();
  });

  it('still signs in when relays do not answer', async () => {
    const app3 = buildApp({ query: () => Promise.reject(new Error('down')), now: () => T, allowedOrigins: [ORIGIN], staticDir: '/nonexistent' });
    const { body } = await challenge(app3);
    const res = await signIn(app3, body.nonce);
    expect(res.statusCode).toBe(200);
    expect(res.json().session.address).toBeNull();
    await app3.close();
  });

  it('serves a DID document for an npub and rejects a bad key', async () => {
    const res = await app.inject({ url: `/api/did/${keys.npub}` });
    expect(res.headers['content-type']).toMatch(/application\/did\+json/);
    expect(res.json()).toMatchObject({ id: `did:nostr:${keys.nostrPubkey}`, alsoKnownAs: [keys.address] });
    expect((await app.inject({ url: `/api/did/did:nostr:${keys.nostrPubkey}` })).json().id).toBe(`did:nostr:${keys.nostrPubkey}`);
    expect((await app.inject({ url: '/api/did/npub1nope' })).statusCode).toBe(400);
  });
});

describe('static web app', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tambat-web-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>t</title>');
  const app = buildApp({ query: fakeRelay([]), staticDir: dir });
  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves index.html for app routes with no-transform, and JSON 404 under /api', async () => {
    const page = await app.inject({ url: '/demo' });
    expect(page.statusCode).toBe(200);
    expect(page.headers['cache-control']).toBe('no-cache, no-transform');
    expect(page.headers['content-security-policy']).toContain("script-src 'self'");
    expect(page.headers['x-content-type-options']).toBe('nosniff');
    expect((await app.inject({ url: '/api/missing' })).statusCode).toBe(404);
  });
});
