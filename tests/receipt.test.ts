import { finalizeEvent } from 'nostr-tools/pure';
import { describe, expect, it } from 'vitest';
import { bindingFromKeys } from '../src/core/paytaca.js';
import { createReceiptEvent, parseReceipt, checkReceipt, type ParsedReceipt } from '../src/core/receipt.js';
import { checkReceipts, findReceipts } from '../src/core/receipt-find.js';
import { fakeSource, type FakeChain } from './fake-fulcrum.js';
import { clone, fakeRelay, keys, other } from './helpers.js';
import { transaction } from './receipt-chain.js';

const T = 1763400000;
// `keys` pays `other`: a coin at keys.address is spent to other.address.
const funding = transaction([{ txid: '11'.repeat(32), vout: 0 }], [{ address: keys.address, sats: 20_000 }]);
const payment = transaction([{ txid: funding.txid, vout: 0 }], [{ address: other.address, sats: 15_000 }, { address: keys.address, sats: 4_000 }]);
// A third party's coin pays `other` too; `keys` claims it anyway.
const strangerFunding = transaction([{ txid: '33'.repeat(32), vout: 0 }], [{ address: 'bitcoincash:qp3wjpa3tjlj042z2wv7hahsldgwhwy0rq9sywjpyy', sats: 9_000 }]);
const strangerPayment = transaction([{ txid: strangerFunding.txid, vout: 0 }], [{ address: other.address, sats: 8_000 }]);
// One coin from `keys` and one from the stranger in the same payment.
const mixedPayment = transaction([{ txid: funding.txid, vout: 0 }, { txid: strangerFunding.txid, vout: 0 }], [{ address: other.address, sats: 25_000 }]);
const chain: FakeChain = { history: { all: [funding, payment, strangerFunding, strangerPayment, mixedPayment] }, headers: {} };

const receiptFor = (txid: string, signer = keys, payee = other.nostrPubkey, at = T) =>
  finalizeEvent(createReceiptEvent({ payee, txid, createdAt: at }), signer.nostrSecretKey);
const parsed = (event: unknown): ParsedReceipt => {
  const r = parseReceipt(event);
  if (typeof r === 'string') throw new Error(r);
  return r;
};

describe('receipt event', () => {
  it('names the paid key and the transaction as a NIP-73 bitcoincash:tx id under the configured label', () => {
    const event = receiptFor(payment.txid);
    expect(event.kind).toBe(1985);
    expect(event.tags).toContainEqual(['i', `bitcoincash:tx:${payment.txid}`]);
    expect(event.tags).toContainEqual(['k', 'bitcoincash:tx']);
    expect(event.tags).toContainEqual(['p', other.nostrPubkey]);
    expect(parsed(event)).toMatchObject({ payer: keys.nostrPubkey, payee: other.nostrPubkey, txid: payment.txid });
  });

  it('rejects a tampered receipt and events that are not receipts', () => {
    const changed = clone(receiptFor(payment.txid));
    changed.tags[3] = ['i', `bitcoincash:tx:${strangerPayment.txid}`];
    expect(parseReceipt(changed)).toBe('event_id');
    const unlabelled = finalizeEvent({ ...createReceiptEvent({ payee: other.nostrPubkey, txid: payment.txid, createdAt: T }), tags: [['p', other.nostrPubkey]] }, keys.nostrSecretKey);
    expect(parseReceipt(unlabelled)).toBe('not_receipt');
    expect(() => createReceiptEvent({ payee: other.nostrPubkey, txid: 'xyz' })).toThrow(/txid/);
  });
});

describe('checking a receipt against the chain', () => {
  const bound = { payerAddresses: [keys.address], payeeAddresses: [other.address] };

  it('says "from a bound address" when every input spends from the payer\'s bound address', async () => {
    const check = await checkReceipt(parsed(receiptFor(payment.txid)), { ...bound, chain: fakeSource(chain) });
    expect(check).toMatchObject({ chain: 'found', paysPayee: true, payer: 'from_bound', inputAddresses: [keys.address] });
  });

  it('says "payer not proven" when the coins came from an address the payer has not bound', async () => {
    const check = await checkReceipt(parsed(receiptFor(strangerPayment.txid)), { ...bound, chain: fakeSource(chain) });
    expect(check).toMatchObject({ chain: 'found', paysPayee: true, payer: 'not_proven' });
    const mixed = await checkReceipt(parsed(receiptFor(mixedPayment.txid)), { ...bound, chain: fakeSource(chain) });
    expect(mixed).toMatchObject({ payer: 'not_proven', inputAddresses: [keys.address, 'bitcoincash:qp3wjpa3tjlj042z2wv7hahsldgwhwy0rq9sywjpyy'] });
    // Same transaction as before, but the payer's binding is gone: not proven either.
    const unbound = await checkReceipt(parsed(receiptFor(payment.txid)), { payerAddresses: [], payeeAddresses: [other.address], chain: fakeSource(chain) });
    expect(unbound.payer).toBe('not_proven');
  });

  it('reports a txid no chain server knows as missing, and a chain server that lies about the bytes as missing too', async () => {
    const unknown = await checkReceipt(parsed(receiptFor('ab'.repeat(32))), { ...bound, chain: fakeSource(chain) });
    expect(unknown).toMatchObject({ chain: 'missing', paysPayee: false, payer: 'not_proven' });
    const lying: FakeChain = { history: { all: [{ ...strangerPayment, txid: payment.txid }, funding] }, headers: {} };
    const swapped = await checkReceipt(parsed(receiptFor(payment.txid)), { ...bound, chain: fakeSource(lying) });
    expect(swapped.chain).toBe('missing');
    const offline = await checkReceipt(parsed(receiptFor(payment.txid)), { ...bound, chain: null });
    expect(offline.chain).toBe('unreachable');
  });

  it('does not count a payment to an address the payee has not bound', async () => {
    const check = await checkReceipt(parsed(receiptFor(payment.txid)), { payerAddresses: [keys.address], payeeAddresses: [], chain: fakeSource(chain) });
    expect(check.paysPayee).toBe(false);
  });
});

describe('finding receipts on relays', () => {
  const mine = bindingFromKeys(keys, T - 100);
  const theirs = bindingFromKeys(other, T - 100);
  const good = receiptFor(payment.txid);
  const forged = { ...clone(receiptFor(payment.txid, keys, other.nostrPubkey, T + 5)), sig: '00'.repeat(64) };
  const query = fakeRelay([mine, theirs, good, forged, 'junk']);

  it('finds receipts by txid and by paid key, dropping forged ones, and checks them with the bindings', async () => {
    const byTx = await findReceipts({ txid: payment.txid }, { query });
    expect(byTx.map((r) => r.event.id)).toEqual([good.id]);
    expect((await findReceipts({ payee: other.nostrPubkey }, { query })).map((r) => r.event.id)).toEqual([good.id]);
    let closed = 0;
    const [check] = await checkReceipts(byTx, async () => ({ ...fakeSource(chain), close: async () => void (closed += 1) }), { query });
    expect(check).toMatchObject({ eventId: good.id, paysPayee: true, payer: 'from_bound' });
    expect(closed).toBe(1);
  });

  it('still answers when no chain server is reachable', async () => {
    const [check] = await checkReceipts(await findReceipts({ txid: payment.txid }, { query }), async () => {
      throw new Error('down');
    }, { query });
    expect(check?.chain).toBe('unreachable');
  });
});
