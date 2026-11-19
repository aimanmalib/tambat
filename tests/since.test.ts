/**
 * The "anchored since block N" badge on the wall and Pay: given only by an agreed chain read whose verdict is bound,
 * and chain reads for it run a few at a time. Chains are fake (tests/fake-fulcrum.ts); no transaction is sent.
 */
import { describe, expect, it } from 'vitest';
import { buildAnchorTransaction, txidOf, type AnchorPayload } from '../src/core/anchor.js';
import { addressStatus, scripthashOf } from '../src/core/anchor-chain.js';
import type { ChainServer } from '../src/core/chain-quorum.js';
import { boundSince, createLimiter, createReadOnce } from '../src/core/since.js';
import { signP2pkh, hexOf } from './anchor-wallet.js';
import { fakeSource, headerWithTime, type FakeChain } from './fake-fulcrum.js';
import { keys, other, vectors } from './helpers.js';

const P = keys.nostrPubkey;
const bind: AnchorPayload = { pubkey: P, eventId: vectors.bindingEvent.id };

function tx(vout: number, payload: AnchorPayload, height: number) {
  const unsigned = buildAnchorTransaction(keys.address, [{ txid: '57'.repeat(32), vout, satoshis: 5000 }], payload);
  const bytes = signP2pkh(unsigned.transaction, unsigned.sourceOutputs, keys.bchPrivateKey);
  return { hex: hexOf(bytes), txid: txidOf(bytes), height };
}
function chainOf(...txs: ReturnType<typeof tx>[]): FakeChain {
  const headers: Record<number, string> = {};
  for (const t of txs) if (t.height > 0) headers[t.height] = headerWithTime(1_763_000_000 + t.height);
  return { history: { [scripthashOf(keys.address)]: txs }, headers };
}
const servers = (...chains: (FakeChain | null)[]): ChainServer[] =>
  chains.map((c, i) => ({ name: `s${i}`, open: async () => (c ? fakeSource(c) : Promise.reject(new Error('down'))) }));
const since = async (s: ChainServer[], pubkey = P) => boundSince(await addressStatus(keys.address, pubkey, bind.eventId, s));

describe('boundSince', () => {
  it('gives the first block of a binding the chain still holds, read alike from every server', async () => {
    const chain = chainOf(tx(0, bind, 977_901), tx(1, bind, 978_000));
    expect(await since(servers(chain, chain, chain))).toBe(977_901);
  });

  it('dates the binding from after its last revocation', async () => {
    const chain = chainOf(tx(0, bind, 900_100), tx(1, { ...bind, action: 'revoke' }, 900_200), tx(2, bind, 900_300));
    expect(await since(servers(chain, chain))).toBe(900_300);
  });

  it('gives no badge for a revoked, conflicting, unconfirmed or missing commitment', async () => {
    const revoked = chainOf(tx(0, bind, 900_100), tx(1, { ...bind, action: 'revoke' }, 900_200));
    const conflict = chainOf(tx(0, bind, 900_100), tx(1, { ...bind, pubkey: other.nostrPubkey }, 900_200));
    const pending = chainOf(tx(0, bind, 0));
    const empty: FakeChain = { history: {}, headers: {} };
    for (const chain of [revoked, conflict, pending, empty]) expect(await since(servers(chain, chain))).toBeNull();
  });

  it('gives no badge when servers disagree, too few answer, or none answers, and never throws', async () => {
    const bound = chainOf(tx(0, bind, 977_901));
    const hidden: FakeChain = { history: {}, headers: {} };
    expect(await since(servers(bound, bound, hidden))).toBeNull();
    expect(await since(servers(bound, null, null))).toBeNull();
    expect(await since(servers(null, null))).toBeNull();
    expect(boundSince(null)).toBeNull();
  });
});

describe('createLimiter', () => {
  it('runs no more than the limit at once and runs every task in the order given', async () => {
    const limit = createLimiter(2);
    let running = 0;
    let peak = 0;
    const started: number[] = [];
    const releases: (() => void)[] = [];
    const tasks = Array.from({ length: 5 }, (_, i) =>
      limit(async () => {
        started.push(i);
        running += 1;
        peak = Math.max(peak, running);
        await new Promise<void>((r) => releases.push(r));
        running -= 1;
        return i;
      }),
    );
    for (let done = 0; done < 5; done += 1) {
      await new Promise((r) => setTimeout(r, 0));
      releases.shift()?.();
    }
    expect(await Promise.all(tasks)).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(2);
    expect(started).toEqual([0, 1, 2, 3, 4]);
  });

  it('keeps going after a task fails', async () => {
    const limit = createLimiter(1);
    const failed = limit(() => Promise.reject(new Error('no')));
    const next = limit(async () => 'ok');
    await expect(failed).rejects.toThrow('no');
    expect(await next).toBe('ok');
  });
});

describe('createReadOnce', () => {
  it('reads each key once, shares a read in flight and forgets a failed one', async () => {
    const once = createReadOnce<number>();
    let calls = 0;
    const read = async () => (calls += 1);
    const [a, b] = await Promise.all([once('k', read), once('k', read)]);
    expect([a, b, calls]).toEqual([1, 1, 1]);
    expect(await once('k', read)).toBe(1);
    expect(await once('other', read)).toBe(2);

    await expect(once('bad', () => Promise.reject(new Error('down')))).rejects.toThrow('down');
    expect(await once('bad', read)).toBe(3);
    expect(calls).toBe(3);
  });
});
