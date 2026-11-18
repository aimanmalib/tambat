import { finalizeEvent } from 'nostr-tools/pure';
import { describe, expect, it } from 'vitest';
import { attestationStatus, createAttestationEvent, parseAttestation, summarizeAttestations, type ParsedAttestation } from '../src/core/attest.js';
import { attestationsOf, findAttestations } from '../src/core/attest-find.js';
import { createRevocationEvent } from '../src/core/binding.js';
import { lookupByPubkey } from '../src/core/discover.js';
import { bindingFromKeys } from '../src/core/paytaca.js';
import { clone, fakeRelay, keys, other } from './helpers.js';

const T = 1763400000;
// `other` checks the binding of `keys` and attests it.
const binding = bindingFromKeys(keys, T);
const newerBinding = bindingFromKeys(keys, T + 100);
const attest = (bindingEventId = binding.id, signer = other, subject = keys.nostrPubkey, at = T + 10) =>
  finalizeEvent(createAttestationEvent({ subject, bindingEventId, createdAt: at }), signer.nostrSecretKey);
const parsed = (event: unknown): ParsedAttestation => {
  const a = parseAttestation(event);
  if (typeof a === 'string') throw new Error(a);
  return a;
};

describe('attestation event', () => {
  it('is a NIP-32 label pinned to the binding event id and naming the subject key', () => {
    const event = attest();
    expect(event.kind).toBe(1985);
    expect(event.tags).toContainEqual(['L', 'cash.tambat.attest']);
    expect(event.tags).toContainEqual(['l', 'verified', 'cash.tambat.attest']);
    expect(event.tags).toContainEqual(['e', binding.id]);
    expect(event.tags).toContainEqual(['p', keys.nostrPubkey]);
    expect(parsed(event)).toMatchObject({ attester: other.nostrPubkey, subject: keys.nostrPubkey, bindingEventId: binding.id });
    expect(() => createAttestationEvent({ subject: keys.nostrPubkey, bindingEventId: 'xyz' })).toThrow();
  });

  it('rejects a tampered signature, a changed pin, a self attestation and other labels', () => {
    const event = attest();
    const badSig = clone(event);
    badSig.sig = (badSig.sig[0] === 'a' ? 'b' : 'a') + badSig.sig.slice(1);
    expect(parseAttestation(badSig)).toBe('signature');
    const moved = clone(event);
    moved.tags = moved.tags.map((t) => (t[0] === 'e' ? ['e', newerBinding.id] : t));
    expect(parseAttestation(moved)).toBe('event_id');
    expect(parseAttestation(attest(binding.id, keys))).toBe('self');
    const unlabelled = finalizeEvent({ ...createAttestationEvent({ subject: keys.nostrPubkey, bindingEventId: binding.id }), tags: [['e', binding.id], ['p', keys.nostrPubkey]] }, other.nostrSecretKey);
    expect(parseAttestation(unlabelled)).toBe('not_attestation');
    expect(parseAttestation({ kind: 1985 })).toBe('shape');
  });
});

describe('attestation status', () => {
  it('counts while the pinned binding is the current verified one', async () => {
    const relay = fakeRelay([binding, attest()]);
    const s = await attestationsOf(keys.nostrPubkey, { query: relay });
    expect(s.binding?.eventId).toBe(binding.id);
    expect(s.current.map((a) => a.attester)).toEqual([other.nostrPubkey]);
    expect(s.replaced).toBe(0);
  });

  it('drops when the subject publishes a newer binding, and when the binding is revoked', async () => {
    const replaced = await attestationsOf(keys.nostrPubkey, { query: fakeRelay([binding, newerBinding, attest()]) });
    expect(replaced.current).toEqual([]);
    expect(replaced.replaced).toBe(1);
    expect(attestationStatus(parsed(attest()), replaced.binding)).toBe('replaced');

    const revocation = finalizeEvent(createRevocationEvent(binding, T + 200), keys.nostrSecretKey);
    const revoked = await lookupByPubkey(keys.nostrPubkey, { query: fakeRelay([binding, revocation]) });
    expect(attestationStatus(parsed(attest()), revoked)).toBe('replaced');
    expect(attestationStatus(parsed(attest()), null)).toBe('no_binding');
  });

  it('keeps one attestation per attester and does not count an attester as dropped once it attested the new binding', async () => {
    const relay = fakeRelay([binding, newerBinding, attest(binding.id, other, keys.nostrPubkey, T + 10), attest(newerBinding.id, other, keys.nostrPubkey, T + 110), attest(newerBinding.id, other, keys.nostrPubkey, T + 120)]);
    const s = await attestationsOf(keys.nostrPubkey, { query: relay });
    expect(s.current).toHaveLength(1);
    expect(s.current[0]?.event.created_at).toBe(T + 120);
    expect(s.replaced).toBe(0);
    expect(summarizeAttestations(s.current, null).current).toEqual([]);
  });

  it('ignores relay junk, forged events and attestations of other keys', async () => {
    const forged = clone(attest());
    forged.content = 'changed';
    const ofOther = attest(binding.id, keys, other.nostrPubkey);
    const found = await findAttestations(keys.nostrPubkey, { query: fakeRelay([null, 'x', forged, ofOther, attest(), attest()]) });
    expect(found).toHaveLength(1);
  });
});
