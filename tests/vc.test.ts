import { finalizeEvent } from 'nostr-tools/pure';
import { describe, expect, it } from 'vitest';
import { createAttestationEvent } from '../src/core/attest.js';
import { bindingFromKeys } from '../src/core/paytaca.js';
import { credentialFileName, exportCredential, verifyCredential, VC_CONTEXT, type AttestationCredential } from '../src/core/vc.js';
import { keys, other, third } from './helpers.js';

const T = 1763400000;
const binding = bindingFromKeys(keys, T);
const attestation = finalizeEvent(createAttestationEvent({ subject: keys.nostrPubkey, bindingEventId: binding.id, createdAt: T + 10 }), other.nostrSecretKey);

function made(): AttestationCredential {
  const r = exportCredential(attestation, binding);
  if (!r.ok) throw new Error(r.reason);
  return JSON.parse(JSON.stringify(r.credential)) as AttestationCredential;
}

describe('attestation as a Verifiable Credential', () => {
  it('has the VC 2.0 context, did:nostr issuer and subject, and both signed events in the proof', () => {
    const vc = made();
    expect(vc['@context']).toEqual([VC_CONTEXT]);
    expect(vc.type).toEqual(['VerifiableCredential', 'BchNostrBindingAttestation']);
    expect(vc.issuer).toBe(`did:nostr:${other.nostrPubkey}`);
    expect(vc.validFrom).toBe(new Date((T + 10) * 1000).toISOString().replace('.000Z', 'Z'));
    expect(vc.credentialSubject).toEqual({
      id: `did:nostr:${keys.nostrPubkey}`,
      bchAddress: [keys.address],
      bindingEvent: binding.id,
      attestationEvent: attestation.id,
    });
    expect(vc.proof).toMatchObject({ type: 'NostrEventProof', proofPurpose: 'assertionMethod', verificationMethod: `${vc.issuer}#key1` });
    expect(vc.proof.attestation.id).toBe(attestation.id);
    expect(vc.proof.binding.id).toBe(binding.id);
    expect(credentialFileName(vc)).toBe(`tambat-attestation-${attestation.id.slice(0, 12)}.json`);
  });

  it('verifies offline', () => {
    const r = verifyCredential(made());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.binding.claims[0]?.address).toBe(keys.address);
  });

  it('fails with a named reason when one field, the issuer or the proof is changed', () => {
    const cases: [string, (vc: AttestationCredential) => void, string, string?][] = [
      ['subject address', (vc) => (vc.credentialSubject.bchAddress = [third.address]), 'field', 'credentialSubject.bchAddress[0]'],
      ['subject id', (vc) => (vc.credentialSubject.id = `did:nostr:${third.nostrPubkey}`), 'field', 'credentialSubject.id'],
      ['validFrom', (vc) => (vc.validFrom = '2020-01-01T00:00:00Z'), 'field', 'validFrom'],
      ['extra claim', (vc) => Object.assign(vc.credentialSubject, { name: 'x' }), 'field', 'credentialSubject.name'],
      ['issuer', (vc) => (vc.issuer = `did:nostr:${third.nostrPubkey}`), 'issuer', 'issuer'],
      ['attestation signature', (vc) => (vc.proof.attestation.sig = (vc.proof.attestation.sig[0] === 'a' ? 'b' : 'a') + vc.proof.attestation.sig.slice(1)), 'attestation_signature'],
      ['attestation content', (vc) => (vc.proof.attestation.created_at += 1), 'attestation_event_id'],
      ['binding signature', (vc) => (vc.proof.binding.sig = (vc.proof.binding.sig[0] === 'a' ? 'b' : 'a') + vc.proof.binding.sig.slice(1)), 'binding'],
      ['other binding', (vc) => (vc.proof.binding = bindingFromKeys(keys, T + 100)), 'pin'],
      ['proof type', (vc) => (vc.proof.type = 'DataIntegrityProof'), 'proof'],
      ['context', (vc) => (vc['@context'] = ['https://www.w3.org/2018/credentials/v1']), 'shape'],
    ];
    for (const [name, mutate, reason, path] of cases) {
      const vc = made();
      mutate(vc);
      const r = verifyCredential(vc);
      expect(r.ok, name).toBe(false);
      if (!r.ok) {
        expect(r.reason, name).toBe(reason);
        if (path) expect(r.path, name).toBe(path);
      }
    }
    expect(verifyCredential(null)).toEqual({ ok: false, reason: 'shape' });
    expect(verifyCredential({ ...made(), proof: undefined })).toEqual({ ok: false, reason: 'proof' });
  }, 20_000);

  it('will not export an attestation of another binding or an attestation that does not verify', () => {
    expect(exportCredential(attestation, bindingFromKeys(keys, T + 100))).toEqual({ ok: false, reason: 'pin' });
    expect(exportCredential({ ...attestation, content: 'x' }, binding)).toEqual({ ok: false, reason: 'attestation_event_id' });
    expect(exportCredential(attestation, { ...binding, sig: '00' })).toMatchObject({ ok: false });
  });
});
