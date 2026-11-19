import { createHash } from 'node:crypto';
import { finalizeEvent } from 'nostr-tools/pure';
import { describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { canonicalize } from '../src/core/jcs.js';
import { bindingFromKeys } from '../src/core/paytaca.js';
import {
  credentialDigest,
  decodeDisclosure,
  disclosureDigest,
  issueSd,
  makeDisclosure,
  presentSd,
  sdFileName,
  verifySdPresentation,
  type SdPresentation,
} from '../src/core/sd.js';
import { verifyBinding } from '../src/core/verify.js';
import { keys, other } from './helpers.js';

const T = 1763400000;
const bindingEvent = bindingFromKeys(keys, T - 5000);
const binding = verifyBinding(bindingEvent);
let counter = 0;
/** Deterministic salts so a failing case can be reproduced; the real issuer uses crypto.getRandomValues. */
const random = (n: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (i * 31 + ++counter) & 0xff);

const issued = (): SdPresentation => issueSd({ binding, secretKey: keys.nostrSecretKey, now: T, random });
const copy = <V>(v: V): V => JSON.parse(JSON.stringify(v)) as V;
const reason = (p: unknown): string | undefined => {
  const r = verifySdPresentation(p);
  return r.ok ? undefined : r.reason;
};

describe('selective disclosure', () => {
  it('issues a VC 2.0 with one salted digest per field and a label event proof over the credential', () => {
    const p = issued();
    const c = p.verifiableCredential[0];
    expect(p.type).toEqual(['VerifiablePresentation', config.sd.presentationType]);
    expect(c['@context']).toEqual(['https://www.w3.org/ns/credentials/v2']);
    expect(c.issuer).toBe(`did:nostr:${keys.nostrPubkey}`);
    expect(c.credentialSubject.id).toBe(c.issuer);
    expect(c.credentialSubject._sd).toHaveLength(config.sd.fields.length);
    expect(c.credentialSubject._sd).toEqual([...c.credentialSubject._sd].sort());
    expect(p.disclosures.map((d) => decodeDisclosure(d)?.name).sort()).toEqual([...config.sd.fields].sort());
    for (const d of p.disclosures) expect(c.credentialSubject._sd).toContain(disclosureDigest(d));
    expect(c.proof.event.kind).toBe(1985);
    expect(c.proof.event.content).toBe(credentialDigest(c));
    expect(c.proof.event.tags).toEqual([['L', config.sd.namespace], ['l', config.sd.label, config.sd.namespace]]);
    expect(sdFileName(p)).toBe(`${config.sd.filePrefix}-${c.proof.event.id.slice(0, 12)}.json`);
  });

  it('uses a fresh salt of at least 128 bits for each disclosure', () => {
    const a = issueSd({ binding, secretKey: keys.nostrSecretKey, now: T });
    const salts = a.disclosures.map((d) => decodeDisclosure(d)!.salt);
    expect(new Set(salts).size).toBe(salts.length);
    for (const s of salts) expect(Buffer.from(s, 'base64url').length).toBeGreaterThanOrEqual(16);
    const b = issueSd({ binding, secretKey: keys.nostrSecretKey, now: T });
    expect(b.verifiableCredential[0].credentialSubject._sd).not.toEqual(a.verifiableCredential[0].credentialSubject._sd);
  });

  it('verifies the address alone, counts the other fields as hidden and leaves their values out of the bytes', () => {
    const p = copy(presentSd(issued(), ['bchAddress']));
    expect(p.disclosures).toHaveLength(1);
    const r = verifySdPresentation(p);
    expect(r).toMatchObject({ ok: true, holder: keys.nostrPubkey, hidden: config.sd.fields.length - 1, fields: config.sd.fields.length });
    if (r.ok) expect(r.disclosed).toEqual([{ name: 'bchAddress', value: { address: keys.address, signature: bindingEvent.tags.find((t) => t[0] === 'i')![2] } }]);
    const bytes = JSON.stringify(p);
    expect(bytes).not.toContain(bindingEvent.id);
    expect(bytes).not.toContain(new Date((T - 5000) * 1000).toISOString().slice(0, 19));
    expect(bytes).not.toContain('"network"');
  });

  it('verifies a presentation with no disclosure as a commitment to N fields only', () => {
    const r = verifySdPresentation(copy(presentSd(issued(), [])));
    expect(r).toMatchObject({ ok: true, disclosed: [], hidden: config.sd.fields.length });
    expect(() => presentSd(issued(), ['nickname'])).toThrow(/no disclosure for field nickname/);
  });

  it('verifies the full issued file', () => {
    const r = verifySdPresentation(copy(issued()));
    expect(r.ok && r.disclosed.map((d) => d.name)).toEqual(config.sd.fields);
  });

  it('refuses a disclosure whose value was changed (its digest is not in _sd)', () => {
    const p = copy(presentSd(issued(), ['bchAddress', 'network']));
    const d = decodeDisclosure(p.disclosures[1]!)!;
    p.disclosures[1] = makeDisclosure(d.salt, d.name, 'bchtest');
    expect(verifySdPresentation(p)).toEqual({ ok: false, reason: 'disclosure_unknown', path: 'disclosures[1]' });
  });

  it('refuses a disclosure from another credential', () => {
    const p = copy(presentSd(issued(), ['bchAddress']));
    p.disclosures.push(presentSd(issued(), ['boundAt']).disclosures[0]!);
    expect(reason(p)).toBe('disclosure_unknown');
  });

  it('refuses the same disclosure twice and the same field twice', () => {
    const p = copy(presentSd(issued(), ['bchAddress']));
    p.disclosures.push(p.disclosures[0]!);
    expect(verifySdPresentation(p)).toEqual({ ok: false, reason: 'disclosure_duplicate', path: 'disclosures[1]' });
    const q = copy(presentSd(issued(), ['network']));
    q.disclosures.push(makeDisclosure(decodeDisclosure(q.disclosures[0]!)!.salt + 'x', 'network', 'bitcoincash'));
    expect(reason(q)).toBe('disclosure_duplicate');
  });

  it('refuses a broken proof signature, a changed _sd list and another key as issuer', () => {
    const p = copy(issued());
    const sig = p.verifiableCredential[0].proof.event.sig;
    p.verifiableCredential[0].proof.event.sig = (sig[0] === '0' ? '1' : '0') + sig.slice(1);
    expect(reason(p)).toBe('proof_signature');

    const q = copy(issued());
    q.verifiableCredential[0].credentialSubject._sd.pop();
    q.disclosures = q.disclosures.filter((d) => q.verifiableCredential[0].credentialSubject._sd.includes(disclosureDigest(d)));
    expect(verifySdPresentation(q)).toMatchObject({ ok: false, reason: 'proof_hash' });

    const r = copy(issued());
    r.verifiableCredential[0].proof.event = finalizeEvent({ ...r.verifiableCredential[0].proof.event }, other.nostrSecretKey);
    expect(reason(r)).toBe('issuer');

    const s = copy(issued());
    s.holder = `did:nostr:${other.nostrPubkey}`;
    expect(reason(s)).toBe('issuer');
  });

  it('refuses an address signed for another npub', () => {
    const p = copy(presentSd(issued(), ['bchAddress']));
    const foreign = bindingFromKeys(other, T).tags.find((t) => t[0] === 'i')!;
    const d = decodeDisclosure(p.disclosures[0]!)!;
    const swapped = makeDisclosure(d.salt, 'bchAddress', { address: other.address, signature: foreign[2] });
    // Rebuild the credential around the swapped disclosure and re-sign, so only the BCH signature can fail.
    const c = p.verifiableCredential[0];
    c.credentialSubject._sd = [...c.credentialSubject._sd.filter((x) => x !== disclosureDigest(p.disclosures[0]!)), disclosureDigest(swapped)].sort();
    c.proof.event = finalizeEvent({ kind: c.proof.event.kind, created_at: c.proof.event.created_at, tags: c.proof.event.tags, content: credentialDigest(c) }, keys.nostrSecretKey);
    p.disclosures = [swapped];
    expect(verifySdPresentation(p)).toEqual({ ok: false, reason: 'bch_signature', path: 'disclosures[0].bchAddress' });
  });

  it('refuses a short salt, an unknown field and text that is not a disclosure', () => {
    for (const bad of [makeDisclosure('abc', 'network', 'bitcoincash'), makeDisclosure('A'.repeat(22), 'nickname', 'x'), 'not!base64', makeDisclosure('A'.repeat(22), 'network', 'x').slice(0, 10)]) {
      const p = copy(presentSd(issued(), []));
      p.disclosures = [bad];
      expect(reason(p)).toBe('disclosure_malformed');
    }
  });

  it('refuses another document type and a credential without the selective type', () => {
    expect(reason({ type: ['VerifiablePresentation', config.vc.presentationType] })).toBe('shape');
    const p = copy(issued());
    p.verifiableCredential[0].type = ['VerifiableCredential'];
    expect(reason(p)).toBe('shape');
    const q = copy(issued());
    q.verifiableCredential[0].proof.event.tags = [];
    expect(reason(q)).toBe('proof_event');
  });

  it('signs the RFC 8785 text of the credential without its proof', () => {
    const c = issued().verifiableCredential[0];
    const rest: Record<string, unknown> = { ...c };
    delete rest.proof;
    expect(credentialDigest(c)).toBe(createHash('sha256').update(canonicalize(rest)).digest('base64url'));
  });
});
