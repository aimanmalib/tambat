import { finalizeEvent } from 'nostr-tools/pure';
import { describe, expect, it } from 'vitest';
import type { AddressStatus } from '../src/core/anchor-chain.js';
import type { Commitment } from '../src/core/anchor.js';
import { createAttestationEvent } from '../src/core/attest.js';
import type { Event } from '../src/core/nostr.js';
import { bindingFromKeys, type PhraseKeys } from '../src/core/paytaca.js';
import { buildReputationBundle, bundleFileName, verifyReputationBundle, type ReputationBundle } from '../src/core/reputation.js';
import { credentialFrom, exportCredential, type AttestationCredential } from '../src/core/vc.js';
import { verifyBinding } from '../src/core/verify.js';
import { keys, other, third } from './helpers.js';

const T = 1763400000;
const old = bindingFromKeys(keys, T - 500);
const current = bindingFromKeys(keys, T);
const currentResult = verifyBinding(current);

const attest = (by: PhraseKeys, binding: Event, at: number): Event =>
  finalizeEvent(createAttestationEvent({ subject: binding.pubkey, bindingEventId: binding.id, createdAt: at }), by.nostrSecretKey);

function vcOf(by: PhraseKeys, binding: Event, at: number): AttestationCredential {
  const r = exportCredential(attest(by, binding, at), binding);
  if (!r.ok) throw new Error(r.reason);
  return r.credential;
}

/** A credential of the holder vouching for itself: it cannot be exported, so it is assembled here as a forger would. */
function selfVc(): AttestationCredential {
  const event = attest(keys, current, T + 30);
  return credentialFrom({ event, attester: keys.nostrPubkey, subject: keys.nostrPubkey, bindingEventId: current.id }, currentResult);
}

const commitment = { pubkey: keys.nostrPubkey, eventId: current.id, txid: 'ab'.repeat(32), height: 900000 } as Commitment;

const credentials = [vcOf(other, current, T + 10), vcOf(third, current, T + 20), selfVc(), vcOf(other, old, T - 400), vcOf(other, current, T + 5)];
const built = JSON.stringify(buildReputationBundle({ binding: currentResult, credentials, anchoredSince: commitment, now: T + 100 }));
/** A fresh copy of one bundle with two counted issuers and one credential for each rule that skips. */
const bundle = (): ReputationBundle => JSON.parse(built) as ReputationBundle;

const reasonOf = (b: unknown) => {
  const r = verifyReputationBundle(b);
  return r.ok ? 'ok' : `${r.reason}${r.path ? ` ${r.path}` : ''}`;
};

// Each recount checks every signature of five credentials; allow for a loaded machine.
describe('portable reputation bundle', { timeout: 30_000 }, () => {
  it('is a VP 2.0 with the holder as did:nostr and every credential embedded', () => {
    const b = bundle();
    expect(b['@context']).toEqual(['https://www.w3.org/ns/credentials/v2']);
    expect(b.type).toEqual(['VerifiablePresentation', 'TambatReputationSummary']);
    expect(b.holder).toBe(`did:nostr:${keys.nostrPubkey}`);
    expect(b.verifiableCredential).toHaveLength(5);
    expect(b.reputationSummary).toMatchObject({ bindingEvent: current.id, credentials: 5, attestations: 2, created: '2025-11-17T17:21:40Z' });
    expect(b.reputationSummary.issuers).toEqual([`did:nostr:${other.nostrPubkey}`, `did:nostr:${third.nostrPubkey}`].sort());
    expect(b.reputationSummary.anchoredSince).toEqual({ height: 900000, txid: commitment.txid, eventId: current.id });
    expect(bundleFileName(keys.nostrPubkey)).toBe(`tambat-reputation-${keys.nostrPubkey.slice(0, 12)}.json`);
  });

  it('recounts: one per issuer (newest kept), self, old-binding and other-subject credentials not counted, each with a reason', () => {
    const r = verifyReputationBundle(bundle());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.count.counted.map((c) => c.issuer).sort()).toEqual([`did:nostr:${other.nostrPubkey}`, `did:nostr:${third.nostrPubkey}`].sort());
    expect(r.count.counted.find((c) => c.issuer.endsWith(other.nostrPubkey))?.validFrom).toBe('2025-11-17T17:20:10Z');
    expect(r.count.excluded.map((e) => [e.index, e.reason])).toEqual([[2, 'self'], [3, 'old_binding'], [4, 'duplicate_issuer']]);
    expect(r.anchor).toEqual({ kind: 'claimed', height: 900000, txid: commitment.txid });
  });

  it('rejects an inflated or deflated count, naming the field', () => {
    const cases: [(b: ReputationBundle) => void, string][] = [
      [(b) => (b.reputationSummary.attestations = 3), 'count reputationSummary.attestations'],
      [(b) => (b.reputationSummary.attestations = 1), 'count reputationSummary.attestations'],
      [(b) => b.reputationSummary.issuers.push(`did:nostr:${keys.nostrPubkey}`), 'count reputationSummary.issuers'],
      [(b) => (b.reputationSummary.credentials = 4), 'count reputationSummary.credentials'],
      [(b) => (b.reputationSummary.bindingEvent = old.id), 'count reputationSummary.bindingEvent'],
    ];
    for (const [mutate, want] of cases) {
      const b = bundle();
      mutate(b);
      expect(reasonOf(b)).toBe(want);
    }
  });

  it('does not count a credential whose signature was broken, so the claimed count no longer matches', () => {
    const b = bundle();
    const vc = b.verifiableCredential[1] as AttestationCredential;
    vc.proof.attestation.sig = `${vc.proof.attestation.sig.slice(0, -2)}00`;
    expect(reasonOf(b)).toBe('count reputationSummary.attestations');
    const r = verifyReputationBundle({ ...b, reputationSummary: { ...b.reputationSummary, attestations: 1, issuers: [`did:nostr:${other.nostrPubkey}`] } });
    expect(r.ok && r.count.excluded[0]).toEqual({ index: 1, reason: 'credential', problem: 'attestation_signature' });
  });

  it('does not count a credential about another subject', () => {
    const b = bundle();
    const otherBinding = bindingFromKeys(third, T);
    b.verifiableCredential[1] = vcOf(other, otherBinding, T + 20);
    const r = verifyReputationBundle({ ...b, reputationSummary: { ...b.reputationSummary, attestations: 1, issuers: [`did:nostr:${other.nostrPubkey}`] } });
    expect(r.ok && r.count.excluded[0]).toEqual({ index: 1, reason: 'subject' });
  });

  it('rejects a bundle that names an older binding than one it carries, and a binding of another key', () => {
    const b = bundle();
    const stale = buildReputationBundle({ binding: verifyBinding(old), credentials: b.verifiableCredential as AttestationCredential[] });
    expect(reasonOf(JSON.parse(JSON.stringify(stale)))).toBe('stale_binding');
    expect(reasonOf({ ...b, holder: `did:nostr:${other.nostrPubkey}` })).toBe('binding reputationSummary.binding');
    const edited = bundle();
    edited.reputationSummary.binding.created_at += 1;
    expect(reasonOf(edited)).toBe('binding reputationSummary.binding');
  });

  it('rejects what is not a reputation presentation', () => {
    expect(reasonOf(null)).toBe('shape');
    expect(reasonOf({ ...bundle(), type: ['VerifiablePresentation'] })).toBe('shape');
    expect(reasonOf({ ...bundle(), '@context': ['https://www.w3.org/2018/credentials/v1'] })).toBe('shape');
    expect(reasonOf({ ...bundle(), holder: 'npub1x' })).toBe('holder');
    const b = bundle();
    b.reputationSummary.anchoredSince = { height: 0, txid: 'x', eventId: '' };
    expect(reasonOf(b)).toBe('shape reputationSummary.anchoredSince');
  });

  it('keeps the anchor a claim offline, confirms it with an agreeing chain read and rejects it with a differing one', () => {
    const status = (since: Commitment | null): AddressStatus =>
      ({ anchor: { kind: 'none' }, verdict: since ? { kind: 'bound', since } : { kind: 'none' }, servers: {} }) as unknown as AddressStatus;
    const b = bundle();
    const confirmed = verifyReputationBundle(b, { chain: status(commitment) });
    expect(confirmed.ok && confirmed.anchor.kind).toBe('confirmed');
    const later = verifyReputationBundle(b, { chain: status({ ...commitment, height: 900100 }) });
    expect(later.ok ? 'ok' : later.reason).toBe('anchor');
    const none = verifyReputationBundle(b, { chain: status(null) });
    expect(none.ok ? 'ok' : none.reason).toBe('anchor');
    const unread = verifyReputationBundle(b, { chain: { anchor: { kind: 'unreachable' }, verdict: null } as unknown as AddressStatus });
    expect(unread.ok && unread.anchor.kind).toBe('claimed');
  });

  it('builds only from a verified binding', () => {
    expect(() => buildReputationBundle({ binding: verifyBinding({}), credentials: [] })).toThrow();
  });
});
