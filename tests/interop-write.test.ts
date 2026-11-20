/**
 * The write form and the read dialects of a BCH claim. New claims are written `["i", "bch:q…", proof]` (the CashAddr
 * without its prefix on mainnet), the form other NIP-39 verifiers read. A verifier also reads `bitcoincash:q…`, a bare
 * 64-hex txid as an on-chain proof, `<signature> | tx:<txid>` (both checked), and several tags for one address (one
 * claim; every tag must pass). The dialect vector is a real mainnet event and transaction kept as data with its source
 * and license (tests/fixtures/dialect-bitcoincash-mainnet.json). Every relay and chain here is a fake.
 */
import { readFileSync } from 'node:fs';
import { encodeDataPush, utf8ToBin } from '@bitauth/libauth';
import { finalizeEvent } from 'nostr-tools/pure';
import { describe, expect, it } from 'vitest';
import { signMessage } from '../src/core/bchmsg.js';
import { claimIdentities, claimIdentity, claimsOf, createBindingEvent, fullClaimAddress } from '../src/core/binding.js';
import { lookupByAddress } from '../src/core/discover.js';
import { toNpub, verificationText, type Event, type EventTemplate } from '../src/core/nostr.js';
import { carriesText, parseProof, parseProofs, type TxEvidence } from '../src/core/tx-proof.js';
import { verifyBindingOnChain } from '../src/core/verify-chain.js';
import { verifyBinding, type BindingResult } from '../src/core/verify.js';
import { fakeRelay, keys, other, vectors } from './helpers.js';
import { hashOf, holding, proofTx, server } from './tx-proof-kit.js';

const fx = JSON.parse(readFileSync(new URL('./fixtures/dialect-bitcoincash-mainnet.json', import.meta.url), 'utf8')) as {
  source: Record<string, string>;
  license: string;
  address: string;
  txid: string;
  raw: string[];
  sources: Record<string, string[]>;
  event: Event;
};
/** Hex is kept in short pieces so no line looks like a key to a secret scanner. */
const real: TxEvidence = { raw: fx.raw.join(''), sources: Object.fromEntries(Object.entries(fx.sources).map(([id, hex]) => [id, hex.join('')])) };
const found = (txid: string, evidence: TxEvidence) => ({ [txid]: { kind: 'found' as const, evidence } });
const T = 1_795_000_000;
const payload = (address: string) => address.split(':')[1] ?? '';
const sig = (npub = keys.npub) => signMessage(keys.bchPrivateKey, verificationText(npub));
const signed = (tags: string[][], createdAt = T): Event =>
  finalizeEvent({ kind: 10011, created_at: createdAt, content: '', tags } satisfies EventTemplate, keys.nostrSecretKey) as Event;
const stepsOf = (r: BindingResult) => r.claims.flatMap((c) => c.steps.map((s) => `${s.name}:${s.status}`));

describe('write form', () => {
  it('writes a new mainnet claim as bch:q… without the CashAddr prefix', () => {
    const e = createBindingEvent({ claim: { address: keys.address, signature: sig() }, createdAt: T });
    expect(e.tags).toEqual([['i', `bch:${payload(keys.address)}`, sig()]]);
    const r = verifyBinding(finalizeEvent(e, keys.nostrSecretKey));
    expect(r.ok).toBe(true);
    expect(r.claims.map((c) => c.address)).toEqual([keys.address]);
  });

  it('keeps the prefix on a test network, where the address alone cannot tell the network', () => {
    const testnet = vectors.bch.address.bchtest;
    expect(claimIdentity(testnet)).toBe(`bch:${testnet}`);
    expect(claimIdentity(keys.address, 'prefixed')).toBe(`bch:${keys.address}`);
  });

  it('still reads the earlier prefixed form bch:bitcoincash:q…', () => {
    expect(vectors.bindingEvent.tags.some((t) => t[1] === `bch:${keys.address}`)).toBe(true);
    expect(verifyBinding(vectors.bindingEvent).ok).toBe(true);
  });

  it('asks relays for every spelling of an address', () => {
    expect(claimIdentities(keys.address).sort()).toEqual(
      [`bch:${keys.address}`, `bch:${payload(keys.address)}`, `bitcoincash:${keys.address}`, `bitcoincash:${payload(keys.address)}`].sort(),
    );
  });
});

describe('the bitcoincash: dialect with a bare txid (real mainnet event)', () => {
  it('is pinned data with a source and a license', () => {
    expect(fx.source.event).toMatch(/relays/);
    expect(fx.license).toMatch(/Public network data/);
    expect(hashOf(real)).toBe(fx.txid);
    expect(fx.event.tags[0]).toEqual(['i', fx.address, fx.txid]);
  });

  it('reads the tag as a BCH claim with an on-chain proof, and every step passes', () => {
    expect(claimsOf(fx.event).map((c) => fullClaimAddress(c.address))).toEqual([fx.address]);
    expect(parseProof(fx.txid)).toEqual({ form: 'tx', txid: fx.txid });
    const r = verifyBinding(fx.event, { txLookups: found(fx.txid, real) });
    expect(r.npub).toBe(toNpub(fx.event.pubkey));
    expect(r.claims).toHaveLength(1);
    expect(r.claims[0]).toMatchObject({ address: fx.address, proof: 'tx', txid: fx.txid, ok: true });
    expect(r.ok).toBe(true);
  });

  it('passes when two chain servers agree, and is found by an address look-up', async () => {
    const chain = { servers: [server('a', holding(real)), server('b', holding(real))], quorum: 2 };
    expect((await verifyBindingOnChain(fx.event, { chain })).ok).toBe(true);
    const results = await lookupByAddress(fx.address, { query: fakeRelay([fx.event]), chain });
    expect(results.map((x) => x.eventId)).toEqual([fx.event.id]);
  });

  it('is not passed without the chain, and fails once a tag value is changed', () => {
    expect(verifyBinding(fx.event).ok).toBe(false);
    const changed = { ...fx.event, tags: [['i', fx.address, '0'.repeat(64)]] };
    expect(verifyBinding(changed, { txLookups: found(fx.txid, real) }).ok).toBe(false);
  });
});

describe('the OP_RETURN text', () => {
  const text = utf8ToBin(verificationText(keys.npub));
  const op = (...parts: number[][]) => Uint8Array.from([0x6a, ...parts.flat()]);
  const push = (b: Uint8Array) => [...encodeDataPush(b)];

  it('may follow a protocol tag push, as in the real dialect transaction', () => {
    expect(carriesText(op(push(utf8ToBin('TAG\u0000')), push(text)), text)).toBe(true);
    expect(carriesText(op(push(text)), text)).toBe(true);
  });

  it('must be one whole push in an OP_RETURN of data pushes only', () => {
    const half = text.length / 2;
    expect(carriesText(op(push(text.slice(0, half)), push(text.slice(half))), text)).toBe(false);
    expect(carriesText(op(push(text), [0x76]), text)).toBe(false);
    expect(carriesText(Uint8Array.from([0x76, ...push(text)]), text)).toBe(false);
    expect(carriesText(op(push(utf8ToBin(`${verificationText(keys.npub)} `))), text)).toBe(false);
  });
});

describe('proof values', () => {
  it('treats exactly 64 lower-case hex characters as a txid and anything else as a signature', () => {
    expect(parseProof('ab'.repeat(32))).toEqual({ form: 'tx', txid: 'ab'.repeat(32) });
    expect(parseProof('AB'.repeat(32)).form).toBe('message');
    expect(parseProof('ab'.repeat(31)).form).toBe('message');
    expect(parseProofs(`H5Kt | tx:${'ab'.repeat(32)}`)).toEqual([
      { form: 'message', signature: 'H5Kt' },
      { form: 'tx', txid: 'ab'.repeat(32) },
    ]);
  });

  it('reads bch:q… with a bare txid (written by our own test key)', () => {
    const tx = proofTx(keys.npub);
    const e = signed([['i', `bch:${payload(keys.address)}`, tx.txid]]);
    expect(verifyBinding(e, { txLookups: found(tx.txid, tx.evidence) }).ok).toBe(true);
  });

  it('checks both proofs of <signature> | tx:<txid>, and fails when either fails', () => {
    const tx = proofTx(keys.npub);
    const both = signed([['i', `bch:${payload(keys.address)}`, `${sig()} | tx:${tx.txid}`]]);
    const ok = verifyBinding(both, { txLookups: found(tx.txid, tx.evidence) });
    expect(ok.ok).toBe(true);
    expect(stepsOf(ok)).toEqual(expect.arrayContaining(['bch_sig:pass', 'tx_found:pass', 'tx_text:pass']));
    const wrongTx = proofTx(other.npub);
    const badTx = signed([['i', `bch:${payload(keys.address)}`, `${sig()} | tx:${wrongTx.txid}`]]);
    expect(verifyBinding(badTx, { txLookups: found(wrongTx.txid, wrongTx.evidence) }).ok).toBe(false);
    const badSig = signed([['i', `bch:${payload(keys.address)}`, `${sig(other.npub)} | tx:${tx.txid}`]]);
    expect(verifyBinding(badSig, { txLookups: found(tx.txid, tx.evidence) }).ok).toBe(false);
  });
});

describe('several tags for one address', () => {
  const tx = proofTx(keys.npub);
  const lookups = found(tx.txid, tx.evidence);

  it('are one claim that passes when every tag passes', () => {
    const e = signed([
      ['i', `bch:${payload(keys.address)}`, sig()],
      ['i', `bitcoincash:${payload(keys.address)}`, tx.txid],
      ['i', `bch:${keys.address}`, `tx:${tx.txid}`],
    ]);
    const r = verifyBinding(e, { txLookups: lookups });
    expect(r.claims).toHaveLength(1);
    expect(r.claims[0]).toMatchObject({ address: keys.address, ok: true, txid: tx.txid, proof: 'message' });
    expect(r.ok).toBe(true);
  });

  it('fail together when one tag fails', () => {
    const e = signed([
      ['i', `bch:${payload(keys.address)}`, sig()],
      ['i', `bitcoincash:${payload(keys.address)}`, sig(other.npub)],
    ]);
    const r = verifyBinding(e);
    expect(r.claims).toHaveLength(1);
    expect(r.claims[0]?.ok).toBe(false);
    expect(r.claims[0]?.steps.find((s) => s.name === 'address_match')?.status).toBe('fail');
    expect(r.ok).toBe(false);
  });

  it('keeps two different addresses as two claims', () => {
    const e = signed([
      ['i', `bch:${payload(keys.address)}`, sig()],
      ['i', `bch:${payload(other.address)}`, signMessage(other.bchPrivateKey, verificationText(keys.npub))],
    ]);
    expect(verifyBinding(e).claims.map((c) => c.address)).toEqual([keys.address, other.address]);
  });
});
