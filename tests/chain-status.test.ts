/**
 * Chain first (docs/decisions/0013-revoke-by-transaction.md): the newest confirmed commitment of an address decides
 * whether a relay binding is bound, revoked or in conflict. Every chain here is a fake (tests/fake-fulcrum.ts); no
 * transaction is sent anywhere.
 */
import { hexToBin } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import { buildAnchorTransaction, commitmentFromTransaction, decodeAnchorScript, encodeAnchorScript, txidOf, type AnchorPayload, type Commitment } from '../src/core/anchor.js';
import { addressStatus, scripthashOf } from '../src/core/anchor-chain.js';
import { chainVerdict, latestCommitment, refusesPayment } from '../src/core/chain-status.js';
import recorded from '../e2e/paytaca-anchor.json' with { type: 'json' };
import { readFileSync } from 'node:fs';
import { config, parseConfig } from '../src/config.js';
import { signP2pkh, hexOf } from './anchor-wallet.js';
import { fakeSource, headerWithTime, type FakeChain } from './fake-fulcrum.js';
import { keys, other, vectors } from './helpers.js';

const P = keys.nostrPubkey;
const Q = other.nostrPubkey;
const bind: AnchorPayload = { pubkey: P, eventId: vectors.bindingEvent.id };
const revoke: AnchorPayload = { ...bind, action: 'revoke' };

/** A signed transaction from the test address carrying `payload`, at `height`. */
function tx(vout: number, payload: AnchorPayload, height: number) {
  const unsigned = buildAnchorTransaction(keys.address, [{ txid: '55'.repeat(32), vout, satoshis: 5000 }], payload);
  const bytes = signP2pkh(unsigned.transaction, unsigned.sourceOutputs, keys.bchPrivateKey);
  return { hex: hexOf(bytes), txid: txidOf(bytes), height };
}
function chainOf(...txs: ReturnType<typeof tx>[]): FakeChain {
  const headers: Record<number, string> = {};
  for (const t of txs) if (t.height > 0) headers[t.height] = headerWithTime(1_763_000_000 + t.height);
  return { history: { [scripthashOf(keys.address)]: txs }, headers };
}
const status = (chain: FakeChain, pubkey = P) => addressStatus(keys.address, pubkey, bind.eventId, async () => fakeSource(chain));
const c = (height: number, pubkey: string, txid: string, action?: 'revoke'): Commitment => ({ pubkey, eventId: bind.eventId, txid, height, ...(action ? { action } : {}) });

describe('revocation payload', () => {
  it('uses the same TMBT format with the revoke type byte, and reads back as a revocation', () => {
    const script = encodeAnchorScript(revoke);
    expect(script[7]).toBe(config.anchor.revokeVersion);
    expect(encodeAnchorScript(bind)[7]).toBe(config.anchor.version);
    expect(decodeAnchorScript(script)).toEqual(revoke);
  });

  it('reads the block 977901 commitment exactly as before: a bind, no action', () => {
    const found = commitmentFromTransaction(hexToBin(recorded.hex), recorded.address);
    expect(found).not.toHaveProperty('action');
    expect(found).toMatchObject({ eventId: config.judges.anchor.eventId });
  });

  it('rejects any other type byte', () => {
    const script = encodeAnchorScript(bind);
    script[7] = 3;
    expect(decodeAnchorScript(script)).toBe('wrong_version');
  });
});

describe('config anchor.revokeVersion', () => {
  const fresh = () => JSON.parse(readFileSync(new URL('../config/tambat.json', import.meta.url), 'utf8'));
  it.each([1, 0, 256, '2'])('rejects %s (equal to the bind byte, out of a byte, or not a number)', (value) => {
    const c = fresh();
    c.anchor.revokeVersion = value;
    expect(() => parseConfig(c)).toThrow(/config anchor\.revokeVersion:/);
  });
});

describe('chain verdict', () => {
  it('is none without a confirmed commitment', () => {
    expect(chainVerdict([], P)).toEqual({ kind: 'none' });
    expect(chainVerdict([c(0, Q, 'aa')], P)).toEqual({ kind: 'none' });
  });

  it('lets the newest commitment decide: bind, then revoke, then bind again', () => {
    expect(chainVerdict([c(10, P, 'aa')], P).kind).toBe('bound');
    expect(chainVerdict([c(10, P, 'aa'), c(20, P, 'bb', 'revoke')], P).kind).toBe('revoked');
    const again = chainVerdict([c(30, P, 'cc'), c(10, P, 'aa'), c(20, P, 'bb', 'revoke')], P);
    expect(again).toMatchObject({ kind: 'bound', since: { txid: 'cc' } });
  });

  it('names a conflict when the chain commits the address to another key, and the chain wins', () => {
    const v = chainVerdict([c(10, P, 'aa'), c(20, Q, 'bb')], P);
    expect(v).toMatchObject({ kind: 'conflict', chainPubkey: Q });
    expect(refusesPayment(v)).toBe(true);
    expect(chainVerdict([c(10, P, 'aa'), c(20, Q, 'bb')], Q).kind).toBe('bound');
  });

  it('reads a revocation of another key as no word on this one', () => {
    expect(chainVerdict([c(10, Q, 'aa'), c(20, Q, 'bb', 'revoke')], P)).toEqual({ kind: 'none' });
  });

  it('ignores commitments not yet in a block, and in one block puts the revocation last', () => {
    expect(chainVerdict([c(10, P, 'aa'), c(0, P, 'bb', 'revoke')], P).kind).toBe('bound');
    expect(latestCommitment([c(10, P, 'ff', 'revoke'), c(10, P, '00')])?.action).toBe('revoke');
    expect(refusesPayment({ kind: 'none' })).toBe(false);
  });
});

describe('addressStatus on a fake chain', () => {
  const first = tx(0, bind, 900_010);
  const withdrawn = tx(1, revoke, 900_020);
  const rebound = tx(2, bind, 900_030);

  it('bind: bound, anchored since that block', async () => {
    const s = await status(chainOf(first));
    expect(s.verdict?.kind).toBe('bound');
    expect(s.anchor).toMatchObject({ kind: 'anchored', commitment: { txid: first.txid, height: 900_010 } });
  });

  it('bind then revoke: revoked, and no longer anchored', async () => {
    const s = await status(chainOf(withdrawn, first));
    expect(s.verdict).toMatchObject({ kind: 'revoked', revocation: { txid: withdrawn.txid } });
    expect(s.anchor).toEqual({ kind: 'none' });
  });

  it('bind, revoke, bind: bound again, anchored since the new block', async () => {
    const s = await status(chainOf(first, rebound, withdrawn));
    expect(s.verdict?.kind).toBe('bound');
    expect(s.anchor).toMatchObject({ kind: 'anchored', commitment: { txid: rebound.txid, height: 900_030 } });
  });

  it('a relay binding to another key conflicts with the chain', async () => {
    const s = await status(chainOf(first), Q);
    expect(s.verdict).toMatchObject({ kind: 'conflict', chainPubkey: P });
    expect(s.anchor).toEqual({ kind: 'none' });
  });

  it('gives no verdict when the chain cannot be read', async () => {
    expect(await addressStatus(keys.address, P, bind.eventId, async () => Promise.reject(new Error('down')))).toMatchObject({ anchor: { kind: 'unreachable' }, verdict: null });
  });
});
