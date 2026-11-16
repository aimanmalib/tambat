import { finalizeEvent } from 'nostr-tools/pure';
import { describe, expect, it } from 'vitest';
import { signMessage } from '../src/core/bchmsg.js';
import { claimsOf, createBindingEvent, createRevocationEvent } from '../src/core/binding.js';
import { addressFromPublicKey } from '../src/core/cashaddr.js';
import { toNpub, verificationText } from '../src/core/nostr.js';
import { bindingFromKeys, keysFromPhrase } from '../src/core/paytaca.js';
import { verifyBinding, type BindingResult, type StepName } from '../src/core/verify.js';
import { clone, keys, other, vectors } from './helpers.js';

const T = 1763251200;
const status = (r: BindingResult, name: StepName) =>
  [...r.steps, ...r.claims.flatMap((c) => c.steps)].find((s) => s.name === name)?.status;

describe('verifyBinding', () => {
  it('passes the published vector with every named step', () => {
    const r = verifyBinding(clone(vectors.bindingEvent));
    expect(r.ok).toBe(true);
    expect(r.npub).toBe(vectors.nostr.npub);
    expect(r.steps.map((s) => s.name)).toEqual(['event_shape', 'kind', 'event_id', 'nostr_sig', 'newest']);
    expect(status(r, 'newest')).toBe('skip');
    expect(r.claims).toHaveLength(1);
    expect(r.claims[0]?.steps.map((s) => [s.name, s.status])).toEqual([
      ['bch_sig', 'pass'],
      ['address_match', 'pass'],
      ['network', 'pass'],
      ['key_separation', 'pass'],
    ]);
  });

  it('rejects a BCH signature copied into another author event', () => {
    const tags = vectors.bindingEvent.tags.map((t) => [...t]);
    const stolen = finalizeEvent({ kind: 10011, created_at: T, content: '', tags }, other.nostrSecretKey);
    const r = verifyBinding(clone(stolen));
    expect(status(r, 'nostr_sig')).toBe('pass');
    expect(status(r, 'address_match')).toBe('fail');
    expect(r.ok).toBe(false);
  });

  it('rejects one key used for both BCH and Nostr', () => {
    const shared = { ...keys, nostrSecretKey: keys.bchPrivateKey };
    const npub = toNpub(Buffer.from(keys.bchPublicKey.slice(1)).toString('hex'));
    const r = verifyBinding(clone(bindingFromKeys({ ...shared, npub }, T)));
    expect(status(r, 'address_match')).toBe('pass');
    expect(status(r, 'key_separation')).toBe('fail');
    expect(r.ok).toBe(false);
  });

  it('rejects an address on the wrong network', () => {
    expect(status(verifyBinding(clone(vectors.bindingEvent), { network: 'bchtest' }), 'network')).toBe('fail');
    const testnet = keysFromPhrase(vectors.phrase, 'bchtest');
    const r = verifyBinding(clone(bindingFromKeys(testnet, T)), { network: 'bitcoincash' });
    expect(status(r, 'address_match')).toBe('pass');
    expect(status(r, 'network')).toBe('fail');
  });

  it('rejects an event edited after signing', () => {
    const edited = clone(vectors.bindingEvent);
    edited.content = 'edited';
    expect(status(verifyBinding(edited), 'event_id')).toBe('fail');
    const badSig = clone(vectors.bindingEvent);
    badSig.sig = `${badSig.sig.slice(0, -2)}${badSig.sig.endsWith('00') ? '01' : '00'}`;
    expect(status(verifyBinding(badSig), 'nostr_sig')).toBe('fail');
  });

  it('does not trust the verified marker a signing library leaves on the object', () => {
    const signed = bindingFromKeys(keys, T);
    signed.tags.push(['i', 'github:someone-else', 'x']);
    const r = verifyBinding(signed);
    expect(status(r, 'event_id')).toBe('fail');
    expect(status(r, 'nostr_sig')).toBe('fail');
  });

  it('rejects the wrong kind, a non-event and an event without a claim', () => {
    const kind1 = finalizeEvent({ kind: 1, created_at: T, content: '', tags: vectors.bindingEvent.tags }, keys.nostrSecretKey);
    expect(status(verifyBinding(clone(kind1)), 'kind')).toBe('fail');
    expect(verifyBinding({ hello: 1 }).steps[0]).toMatchObject({ name: 'event_shape', status: 'fail' });
    const empty = finalizeEvent(createRevocationEvent(vectors.bindingEvent, T + 1), keys.nostrSecretKey);
    const r = verifyBinding(clone(empty));
    expect(r.claims).toHaveLength(0);
    expect(r.ok).toBe(false);
  });

  it('fails the newest step when a newer event from the author exists', () => {
    const revoked = clone(finalizeEvent(createRevocationEvent(vectors.bindingEvent, T + 60), keys.nostrSecretKey));
    const older = clone(finalizeEvent(createRevocationEvent(vectors.bindingEvent, T - 60), keys.nostrSecretKey));
    const r = verifyBinding(clone(vectors.bindingEvent), { sameAuthorEvents: [revoked] });
    expect(status(r, 'newest')).toBe('fail');
    expect(r.ok).toBe(false);
    expect(status(verifyBinding(clone(vectors.bindingEvent), { sameAuthorEvents: [older] }), 'newest')).toBe('pass');
  });

  it('ignores a forged newer event that is not signed by the author', () => {
    const forged = clone(finalizeEvent(createRevocationEvent(vectors.bindingEvent, T + 60), other.nostrSecretKey));
    forged.pubkey = keys.nostrPubkey;
    expect(status(verifyBinding(clone(vectors.bindingEvent), { sameAuthorEvents: [forged] }), 'newest')).toBe('pass');
  });
});

describe('createBindingEvent', () => {
  it('keeps other identity tags and replaces an earlier BCH claim', () => {
    const previous = { content: 'hi', tags: [['i', 'github:alice', 'gist'], ['i', 'bch:bitcoincash:old', 'sig'], ['alt', 'x']] };
    const signature = signMessage(keys.bchPrivateKey, verificationText(keys.npub));
    const e = createBindingEvent({ claim: { address: keys.address, signature }, previous, createdAt: T });
    expect(e.kind).toBe(10011);
    expect(e.content).toBe('hi');
    expect(e.tags).toEqual([['i', 'github:alice', 'gist'], ['alt', 'x'], ['i', `bch:${keys.address}`, signature]]);
    expect(claimsOf(e)).toEqual([{ address: keys.address, signature }]);
  });

  it('refuses an address without prefix, a P2SH address or an empty signature', () => {
    const bare = keys.address.split(':')[1] ?? '';
    expect(() => createBindingEvent({ claim: { address: bare, signature: 'x' } })).toThrow(/prefix/);
    const p2sh = 'bitcoincash:pp8skudq3x5hzw8ew7vzsw8tn4k8wxsqsv0lt0mf3g';
    expect(() => createBindingEvent({ claim: { address: p2sh, signature: 'x' } })).toThrow(/P2PKH/);
    expect(() => createBindingEvent({ claim: { address: keys.address, signature: ' ' } })).toThrow(/empty/);
  });

  it('binds a second identity independently', () => {
    expect(other.address).not.toBe(keys.address);
    expect(addressFromPublicKey(other.bchPublicKey, 'bitcoincash')).toBe(other.address);
    expect(verifyBinding(clone(bindingFromKeys(other, T))).ok).toBe(true);
  });
});
