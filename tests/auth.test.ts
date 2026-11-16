import { finalizeEvent } from 'nostr-tools/pure';
import { describe, expect, it } from 'vitest';
import { bchAnswerValid, bchChallengeText, ChallengeStore, createAuthEvent, verifyLogin } from '../src/core/auth.js';
import { signMessage } from '../src/core/bchmsg.js';
import { clone, keys, other } from './helpers.js';

const ORIGIN = 'https://rp.example';
const T = 1763251200;

function answer(store: ChallengeStore, origin = ORIGIN, at = T) {
  const c = store.issue(origin, at);
  return { c, event: clone(finalizeEvent(createAuthEvent(c, at), keys.nostrSecretKey)) };
}

describe('sign-in challenge', () => {
  it('accepts a fresh answer and returns the signer', () => {
    const store = new ChallengeStore(120, 10);
    const { c, event } = answer(store);
    const r = verifyLogin(event, { origin: ORIGIN, store, now: T + 5 });
    expect(r).toMatchObject({ ok: true, pubkey: keys.nostrPubkey, challenge: { nonce: c.nonce } });
  });

  it('rejects a nonce used twice', () => {
    const store = new ChallengeStore(120, 10);
    const { event } = answer(store);
    expect(verifyLogin(event, { origin: ORIGIN, store, now: T }).ok).toBe(true);
    expect(verifyLogin(event, { origin: ORIGIN, store, now: T })).toMatchObject({ ok: false, error: 'challenge_unknown' });
  });

  it('rejects an expired nonce', () => {
    const store = new ChallengeStore(120, 10);
    const c = store.issue(ORIGIN, T);
    const event = clone(finalizeEvent(createAuthEvent(c, T + 121), keys.nostrSecretKey));
    expect(verifyLogin(event, { origin: ORIGIN, store, now: T + 121 })).toMatchObject({ ok: false, error: 'challenge_expired' });
  });

  it('rejects a nonce issued to another origin, and burns it', () => {
    const store = new ChallengeStore(120, 10);
    const c = store.issue('https://evil.example', T);
    const event = clone(finalizeEvent(createAuthEvent({ origin: ORIGIN, nonce: c.nonce }, T), keys.nostrSecretKey));
    expect(verifyLogin(event, { origin: ORIGIN, store, now: T })).toMatchObject({ ok: false, error: 'origin' });
    expect(store.size).toBe(0);
  });

  it('rejects an event whose u tag names another site', () => {
    const store = new ChallengeStore(120, 10);
    const { event } = answer(store, ORIGIN);
    expect(verifyLogin(event, { origin: 'http://localhost:5173', store, now: T })).toMatchObject({ ok: false, error: 'url' });
    expect(store.size).toBe(1);
  });

  it('rejects edited, unsigned and wrong-kind events', () => {
    const store = new ChallengeStore(120, 10);
    const { c, event } = answer(store);
    const edited = { ...event, tags: [...event.tags, ['extra', '1']] };
    expect(verifyLogin(edited, { origin: ORIGIN, store, now: T })).toMatchObject({ error: 'event_id' });
    const badSig = { ...event, sig: '0'.repeat(128) };
    expect(verifyLogin(badSig, { origin: ORIGIN, store, now: T })).toMatchObject({ error: 'nostr_sig' });
    const wrongKind = clone(finalizeEvent({ ...createAuthEvent(c, T), kind: 1 }, keys.nostrSecretKey));
    expect(verifyLogin(wrongKind, { origin: ORIGIN, store, now: T })).toMatchObject({ error: 'kind' });
    expect(verifyLogin('nope', { origin: ORIGIN, store, now: T })).toMatchObject({ error: 'event_shape' });
    expect(store.size).toBe(1);
  });

  it('rejects a wrong method tag and a stale created_at', () => {
    const store = new ChallengeStore(120, 10);
    const c = store.issue(ORIGIN, T);
    const tmpl = createAuthEvent(c, T);
    tmpl.tags = tmpl.tags.map((t) => (t[0] === 'method' ? ['method', 'GET'] : t));
    expect(verifyLogin(clone(finalizeEvent(tmpl, keys.nostrSecretKey)), { origin: ORIGIN, store, now: T })).toMatchObject({
      error: 'method',
    });
    const stale = clone(finalizeEvent(createAuthEvent(c, T - 600), keys.nostrSecretKey));
    expect(verifyLogin(stale, { origin: ORIGIN, store, now: T, clockSkewSeconds: 60 })).toMatchObject({ error: 'created_at' });
  });

  it('drops the oldest pending nonce at the size cap and prunes expired ones', () => {
    const store = new ChallengeStore(120, 2);
    const first = store.issue(ORIGIN, T);
    store.issue(ORIGIN, T);
    store.issue(ORIGIN, T);
    expect(store.size).toBe(2);
    expect(store.take(first.nonce)).toBeUndefined();
    store.issue(ORIGIN, T + 500);
    expect(store.size).toBe(1);
  });

  it('checks an optional BCH signature over the challenge against the bound address', () => {
    const c = { origin: ORIGIN, nonce: 'ab'.repeat(32) };
    const sig = signMessage(keys.bchPrivateKey, bchChallengeText(c));
    expect(bchAnswerValid(c, sig, keys.address)).toBe(true);
    expect(bchAnswerValid(c, sig, other.address)).toMatch(/not made by/);
    expect(bchAnswerValid({ ...c, nonce: 'cd'.repeat(32) }, sig, keys.address)).toMatch(/not made by/);
    expect(bchAnswerValid(c, 'xx', keys.address)).toMatch(/65 bytes|base64/);
  });
});
