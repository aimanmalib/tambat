import { describe, expect, it } from 'vitest';
import type { AddressStatus } from '../src/core/anchor-chain.js';
import type { Commitment } from '../src/core/anchor.js';
import type { AttestationSummary, ParsedAttestation } from '../src/core/attest.js';
import type { ReceiptCheck } from '../src/core/receipt.js';
import { receiptVerified, summarizeReputation } from '../src/core/reputation.js';

const tally = { agreed: ['a', 'b'], differed: [], silent: [] } as unknown as AddressStatus['servers'];
const commitment = (height: number, action?: 'revoke'): Commitment =>
  ({ pubkey: 'aa'.repeat(32), eventId: 'bb'.repeat(32), txid: 'cc'.repeat(32), height, ...(action ? { action } : {}) }) as Commitment;
const attestation = (n: number): ParsedAttestation =>
  ({ event: { id: String(n).repeat(64).slice(0, 64) }, attester: String(n).padStart(64, '0'), subject: 'aa'.repeat(32), bindingEventId: 'bb'.repeat(32) }) as unknown as ParsedAttestation;
const receipt = (txid: string, over: Partial<ReceiptCheck> = {}): ReceiptCheck => ({
  eventId: `${txid.slice(0, 60)}${Math.random().toString(16).slice(2, 6)}`,
  txid,
  payerNpub: 'npub1payer',
  payeeNpub: 'npub1payee',
  chain: 'found',
  paysPayee: true,
  payer: 'from_bound',
  inputAddresses: [],
  ...over,
});
const none = { attestations: null, receipts: null, chain: null };

describe('reputation summary', () => {
  it('reports every unread source as unreadable, never as zero', () => {
    expect(summarizeReputation(none)).toEqual({
      attestations: { kind: 'unreadable' },
      receipts: { kind: 'unreadable' },
      anchoredSince: { kind: 'unreadable' },
    });
    const unreachable: AddressStatus = { anchor: { kind: 'unreachable' }, verdict: null, servers: tally };
    const unknown: AddressStatus = { anchor: { kind: 'unknown' }, verdict: null, servers: tally };
    expect(summarizeReputation({ ...none, chain: unreachable }).anchoredSince).toEqual({ kind: 'unreadable' });
    expect(summarizeReputation({ ...none, chain: unknown }).anchoredSince).toEqual({ kind: 'unreadable' });
  });

  it('counts a read with nothing in it as zero', () => {
    const empty: AttestationSummary = { current: [], replaced: 3 };
    const rep = summarizeReputation({ attestations: empty, receipts: [], chain: null });
    expect(rep.attestations).toEqual({ kind: 'counted', items: [] });
    expect(rep.receipts).toEqual({ kind: 'counted', items: [], unchecked: 0, unproven: 0 });
  });

  it('counts only attestations of the current binding, with their sources', () => {
    const items = [attestation(1), attestation(2)];
    const rep = summarizeReputation({ ...none, attestations: { current: items, replaced: 1 } });
    expect(rep.attestations).toEqual({ kind: 'counted', items });
  });

  it('counts a receipt only when the chain shows a payment from the bound address, once per transaction', () => {
    const tx = (c: string) => c.repeat(64);
    const receipts = [
      receipt(tx('1')),
      receipt(tx('1')),
      receipt(tx('2')),
      receipt(tx('3'), { payer: 'not_proven' }),
      receipt(tx('4'), { paysPayee: false }),
      receipt(tx('5'), { chain: 'missing', paysPayee: false, payer: 'not_proven' }),
      receipt(tx('6'), { chain: 'unreachable', paysPayee: false, payer: 'not_proven' }),
    ];
    const rep = summarizeReputation({ ...none, receipts });
    expect(rep.receipts.kind === 'counted' && rep.receipts.items.map((r) => r.txid)).toEqual([tx('1'), tx('2')]);
    expect(rep.receipts).toMatchObject({ unchecked: 1, unproven: 3 });
    expect(receipts.map(receiptVerified)).toEqual([true, true, true, false, false, false, false]);
  });

  it('gives the block of an agreed "bound" verdict, and "not anchored" for none, revoked or another key', () => {
    const since = commitment(977_901);
    const bound: AddressStatus = { anchor: { kind: 'anchored', commitment: since, sameEvent: true }, verdict: { kind: 'bound', since }, servers: tally };
    expect(summarizeReputation({ ...none, chain: bound }).anchoredSince).toEqual({ kind: 'block', height: 977_901, commitment: since });

    const pending = commitment(0);
    const unconfirmed: AddressStatus = { anchor: { kind: 'anchored', commitment: pending, sameEvent: true }, verdict: { kind: 'bound', since: pending }, servers: tally };
    const nothing: AddressStatus = { anchor: { kind: 'none' }, verdict: { kind: 'none' }, servers: tally };
    const revoked: AddressStatus = {
      anchor: { kind: 'anchored', commitment: since, sameEvent: true },
      verdict: { kind: 'revoked', revocation: commitment(977_950, 'revoke') },
      servers: tally,
    };
    const conflict: AddressStatus = {
      anchor: { kind: 'none' },
      verdict: { kind: 'conflict', chainPubkey: 'dd'.repeat(32), commitment: since },
      servers: tally,
    };
    for (const chain of [unconfirmed, nothing, revoked, conflict]) {
      expect(summarizeReputation({ ...none, chain }).anchoredSince).toEqual({ kind: 'not_anchored' });
    }
  });

  it('has no combined score', () => {
    expect(Object.keys(summarizeReputation(none)).sort()).toEqual(['anchoredSince', 'attestations', 'receipts']);
  });
});
