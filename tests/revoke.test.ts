/** Revoking a binding and moving it to a new address (library, discovery and the CLI commands). */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeEvent } from 'nostr-tools/pure';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { main } from '../bin/tambat.js';
import { signMessage } from '../src/core/bchmsg.js';
import { claimsOf, fullClaimAddress, createBindingEvent, createRevocationEvent, createRotationEvent, replacingCreatedAt } from '../src/core/binding.js';
import { lookupByAddress, lookupByPubkey, type QueryFn } from '../src/core/discover.js';
import { verificationText, type Event } from '../src/core/nostr.js';
import { bchKeyAt } from '../src/core/paytaca.js';
import { verifyBinding } from '../src/core/verify.js';
import { clone, fakeRelay, keys, other, vectors } from './helpers.js';

const T = 1763251200;
const second = bchKeyAt(vectors.phrase, 1, 'bitcoincash');
const secondClaim = { address: second.address, signature: signMessage(second.bchPrivateKey, verificationText(keys.npub)) };

/** A binding that also carries a GitHub identity, as a user with other NIP-39 identities would have. */
const withGithub = clone(
  finalizeEvent(
    createBindingEvent({
      claim: { address: keys.address, signature: vectors.bchSignature },
      previous: { content: '', tags: [['i', 'github:example', 'abc123']] },
      createdAt: T,
    }),
    keys.nostrSecretKey,
  ),
);
const revoked = clone(finalizeEvent(createRevocationEvent(withGithub, T + 60), keys.nostrSecretKey));
const rotated = clone(finalizeEvent(createRotationEvent(withGithub, keys.address, secondClaim, T + 60), keys.nostrSecretKey));

/** Two relays: the first is slow and still serves the old event, the second has the replacing one. */
const twoRelays = (oldOnly: Event, newer: Event): QueryFn => {
  const a = fakeRelay([oldOnly]);
  const b = fakeRelay([newer]);
  return async (relays, filter, ms) => [...(await a(relays, filter, ms)), ...(await b(relays, filter, ms))];
};

describe('revocation', () => {
  it('removes the BCH claim and keeps the github identity tag', () => {
    expect(claimsOf(revoked)).toEqual([]);
    expect(revoked.tags).toContainEqual(['i', 'github:example', 'abc123']);
    expect(revoked.content).toBe(withGithub.content);
  });

  it('the newer event wins when an old relay still serves the old one', async () => {
    const query = twoRelays(withGithub, revoked);
    const result = await lookupByPubkey(keys.nostrPubkey, { query });
    expect(result?.eventId).toBe(revoked.id);
    expect(result?.claims).toEqual([]);
    const old = verifyBinding(withGithub, { sameAuthorEvents: [withGithub, revoked] });
    expect(old.ok).toBe(false);
    expect(old.steps.find((s) => s.name === 'newest')?.status).toBe('fail');
  });

  it('address to npub no longer returns the npub that revoked', async () => {
    expect(await lookupByAddress(keys.address, { query: fakeRelay([withGithub]) })).toHaveLength(1);
    expect(await lookupByAddress(keys.address, { query: twoRelays(withGithub, revoked) })).toEqual([]);
  });

  it('ignores a revoking event signed by another key', async () => {
    const forged = clone(finalizeEvent(createRevocationEvent(withGithub, T + 60), other.nostrSecretKey));
    const query = fakeRelay([withGithub, forged]);
    expect((await lookupByPubkey(keys.nostrPubkey, { query }))?.ok).toBe(true);
    const found = await lookupByAddress(keys.address, { query });
    expect(found.map((r) => r.npub)).toEqual([keys.npub]);
  });
});

describe('rotation', () => {
  it('moves the binding in one event: old address gone, new address verified', async () => {
    expect(claimsOf(rotated).map((c) => fullClaimAddress(c.address))).toEqual([second.address]);
    expect(rotated.tags).toContainEqual(['i', 'github:example', 'abc123']);
    const query = twoRelays(withGithub, rotated);
    expect(await lookupByAddress(keys.address, { query })).toEqual([]);
    const found = await lookupByAddress(second.address, { query });
    expect(found).toHaveLength(1);
    expect(found[0]?.ok).toBe(true);
    expect(found[0]?.npub).toBe(keys.npub);
  });

  it('refuses to rotate from an address the binding does not claim, or to the same address', () => {
    expect(() => createRotationEvent(withGithub, other.address, secondClaim)).toThrow(/does not claim/);
    expect(() => createRotationEvent(withGithub, keys.address, { address: keys.address, signature: vectors.bchSignature })).toThrow(
      /same|old address/,
    );
  });
});

describe('tambat revoke and rotate', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tambat-manage-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const keyFile = join(dir, 'keys.json');
  writeFileSync(keyFile, JSON.stringify({ phrase: vectors.phrase }), { mode: 0o600 });
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const run = async (argv: string[]) => {
    const published: Event[] = [];
    const deps = {
      query: fakeRelay([withGithub]),
      publish: async (e: Event) => {
        published.push(e);
        return [{ relay: 'wss://relay.example', ok: true }];
      },
      now: () => T + 5,
    };
    return { code: await main([...argv, '--keys', keyFile], deps), published };
  };

  it('revoke publishes one newer event without the claim and prints no secret', async () => {
    const { code, published } = await run(['revoke', keys.address]);
    expect(code).toBe(0);
    expect(published).toHaveLength(1);
    const e = published[0] as Event;
    expect(e.pubkey).toBe(keys.nostrPubkey);
    expect(e.created_at).toBe(T + 5);
    expect(claimsOf(e)).toEqual([]);
    expect(e.tags).toContainEqual(['i', 'github:example', 'abc123']);
    const printed = log.mock.calls.flat().join('\n');
    expect(printed).toContain(e.id);
    expect(printed).not.toContain(vectors.phrase.split(' ')[0] + ' ');
  });

  it('rotate signs the new address with the wallet key and the result verifies', async () => {
    const { code, published } = await run(['rotate', keys.address, second.address]);
    expect(code).toBe(0);
    const e = published[0] as Event;
    expect(verifyBinding(e, { sameAuthorEvents: [withGithub, e] }).ok).toBe(true);
    expect(claimsOf(e).map((c) => fullClaimAddress(c.address))).toEqual([second.address]);
  });

  it('refuses an address the binding does not claim or the wallet does not hold, and publishes nothing', async () => {
    for (const argv of [['revoke', other.address], ['rotate', keys.address, other.address], ['rotate', keys.address]]) {
      const { code, published } = await run(argv);
      expect(code).toBe(2);
      expect(published).toEqual([]);
    }
  });
});

describe('replacingCreatedAt', () => {
  it('moves a replacement made in the same second (or earlier, on a slow clock) one second past the event it replaces', () => {
    expect(replacingCreatedAt({ created_at: 1000 }, 1000)).toBe(1001);
    expect(replacingCreatedAt({ created_at: 1005 }, 1000)).toBe(1006);
    expect(replacingCreatedAt({ created_at: 1000 }, 1200)).toBe(1200);
    expect(replacingCreatedAt(null, 1200)).toBe(1200);
  });

  it('keeps a replacement made in the same second newest, whatever the two ids', () => {
    const first = finalizeEvent(createBindingEvent({ claim: { address: keys.address, signature: signMessage(keys.bchPrivateKey, verificationText(keys.npub)) }, createdAt: 1000 }), keys.nostrSecretKey);
    for (let i = 0; i < 8; i++) {
      const revocation = finalizeEvent(createRevocationEvent({ ...first, content: `n${i}` }, replacingCreatedAt(first, 1000)), keys.nostrSecretKey);
      const step = verifyBinding(revocation, { sameAuthorEvents: [first] }).steps.find((s) => s.name === 'newest');
      expect(step?.status).toBe('pass');
    }
  });
});
