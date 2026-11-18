import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../server/app.js';
import { config } from '../src/config.js';
import { LOGIN_PATH } from '../src/core/auth.js';
import { fakeRelay, keys, vectors } from './helpers.js';

const ORIGIN = 'https://rp.example';

/** Asking who is signed in is not a refusal; signing in without a valid answer is. */
describe('session contract', () => {
  const app = buildApp({
    query: fakeRelay([]),
    now: () => vectors.bindingEvent.created_at + 100,
    allowedOrigins: [ORIGIN],
    staticDir: '/nonexistent',
    verifierFile: '/nonexistent.html',
  });
  afterAll(() => app.close());

  it('answers 200 with a null session when no cookie is sent', async () => {
    const res = await app.inject({ url: '/api/rp/session' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ session: null });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('answers 200 with a null session for an unknown cookie', async () => {
    const res = await app.inject({ url: '/api/rp/session', cookies: { [config.auth.cookieName]: 'not-a-session' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ session: null });
  });

  it('still refuses a sign-in without a valid signed answer with 401', async () => {
    const empty = await app.inject({ method: 'POST', url: LOGIN_PATH, headers: { origin: ORIGIN }, payload: {} });
    expect(empty.statusCode).toBe(401);
    const forged = await app.inject({
      method: 'POST',
      url: LOGIN_PATH,
      headers: { origin: ORIGIN },
      payload: { type: 'bch', address: keys.address, signature: 'AAAA', nonce: 'unknown' },
    });
    expect(forged.statusCode).toBe(401);
  });
});
