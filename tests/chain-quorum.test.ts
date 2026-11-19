/**
 * Commitments are read from several chain servers and kept only when enough agree (docs/decisions/0014-chain-quorum.md).
 * Three fake sources: all agree, one lies, two are down. Every chain here is a fake; no transaction is sent anywhere.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAnchorTransaction, txidOf, type AnchorPayload } from '../src/core/anchor.js';
import { addressStatus, scripthashOf, type OpenChain } from '../src/core/anchor-chain.js';
import { firstAnswering, readQuorum, type ChainServer } from '../src/core/chain-quorum.js';
import { proofState } from '../src/core/anchor-proof.js';
import { config, parseConfig } from '../src/config.js';
import { main } from '../bin/tambat.js';
import { signP2pkh, hexOf } from './anchor-wallet.js';
import { fakeSource, headerWithTime, type FakeChain } from './fake-fulcrum.js';
import { keys, other, vectors } from './helpers.js';

const P = keys.nostrPubkey;
const bind: AnchorPayload = { pubkey: P, eventId: vectors.bindingEvent.id };

function tx(vout: number, payload: AnchorPayload, height: number) {
  const unsigned = buildAnchorTransaction(keys.address, [{ txid: '66'.repeat(32), vout, satoshis: 5000 }], payload);
  const bytes = signP2pkh(unsigned.transaction, unsigned.sourceOutputs, keys.bchPrivateKey);
  return { hex: hexOf(bytes), txid: txidOf(bytes), height };
}
function chainOf(...txs: ReturnType<typeof tx>[]): FakeChain {
  const headers: Record<number, string> = {};
  for (const t of txs) if (t.height > 0) headers[t.height] = headerWithTime(1_763_000_000 + t.height);
  return { history: { [scripthashOf(keys.address)]: txs }, headers };
}

const bound = chainOf(tx(0, bind, 900_100));
/** A server that hides the revocation the others report. */
const revoked = chainOf(tx(0, bind, 900_100), tx(1, { ...bind, action: 'revoke' }, 900_200));
/** A server that invents a commitment to another key. */
const forged = chainOf(tx(2, { pubkey: other.nostrPubkey, eventId: bind.eventId }, 900_100));
const down: OpenChain = async () => Promise.reject(new Error('down'));

let closed = 0;
const serve = (name: string, chain: FakeChain): ChainServer => ({
  name,
  open: async () => {
    const s = fakeSource(chain);
    return { ...s, close: async () => { closed += 1; await s.close(); } };
  },
});
const three = (b: FakeChain | null, c: FakeChain | null) => [
  serve('a.example', bound),
  b ? serve('b.example', b) : { name: 'b.example', open: down },
  c ? serve('c.example', c) : { name: 'c.example', open: down },
];
async function readStatus(servers: ChainServer[], quorum: number) {
  const saved = config.anchor.quorum;
  config.anchor.quorum = quorum;
  try {
    return await addressStatus(keys.address, P, bind.eventId, servers);
  } finally {
    config.anchor.quorum = saved;
  }
}

afterEach(() => {
  closed = 0;
  vi.restoreAllMocks();
});

describe('reading commitments from several chain servers', () => {
  it('gives the answer when all three agree, and closes every connection', async () => {
    const s = await readStatus(three(bound, bound), 2);
    expect(s.anchor).toMatchObject({ kind: 'anchored', commitment: { height: 900_100, pubkey: P } });
    expect(s.verdict).toMatchObject({ kind: 'bound' });
    expect(s.servers).toEqual({ quorum: 2, total: 3, agreed: ['a.example', 'b.example', 'c.example'], differing: [], unreachable: [] });
    expect(closed).toBe(3);
  });

  it('gives no answer when one server lies, and names it', async () => {
    const s = await readStatus(three(bound, forged), 2);
    expect(s.anchor).toEqual({ kind: 'unknown' });
    expect(s.verdict).toBeNull();
    expect(s.servers.differing).toEqual(['c.example']);
    expect(s.servers.agreed).toEqual(['a.example', 'b.example']);
    expect(proofState(s.anchor, { txid: bound.history[scripthashOf(keys.address)]![0]!.txid, block: 900_100, eventId: bind.eventId })).toBe('unknown');
  });

  it('a server that hides a revocation cannot make the binding read as bound', async () => {
    const s = await readStatus([serve('a.example', revoked), serve('b.example', revoked), serve('c.example', bound)], 2);
    expect(s.verdict).toBeNull();
    expect(s.anchor).toEqual({ kind: 'unknown' });
    expect(s.servers.differing).toEqual(['c.example']);
  });

  it('gives no answer when two of three are down and the quorum is two, naming them', async () => {
    const s = await readStatus(three(null, null), 2);
    expect(s.anchor).toEqual({ kind: 'unknown' });
    expect(s.servers).toEqual({ quorum: 2, total: 3, agreed: ['a.example'], differing: [], unreachable: ['b.example', 'c.example'] });
  });

  it('one server down is left out when the rest still meet the quorum', async () => {
    const s = await readStatus(three(bound, null), 2);
    expect(s.anchor.kind).toBe('anchored');
    expect(s.servers.unreachable).toEqual(['c.example']);
  });

  it('reads as unreachable when no server answers', async () => {
    const s = await readStatus([{ name: 'a.example', open: down }], 1);
    expect(s.anchor).toEqual({ kind: 'unreachable' });
    expect(s.servers.unreachable).toEqual(['a.example']);
  });

  it('a server that fails while reading counts as not answering', async () => {
    const broken = { name: 'b.example', open: async () => ({ ...fakeSource(bound), history: async () => Promise.reject(new Error('reset')) }) };
    const r = await readQuorum([serve('a.example', bound), broken], 1, (c) => c.history('x'));
    expect(r.tally.unreachable).toEqual(['b.example']);
  });

  it('firstAnswering opens the first server that answers, in order', async () => {
    const source = await firstAnswering([{ name: 'x', open: down }, serve('a.example', bound)])();
    expect(await source.history(scripthashOf(keys.address))).toHaveLength(1);
    await expect(firstAnswering([{ name: 'x', open: down }])()).rejects.toThrow(/no chain server/);
  });
});

describe('tambat anchor-lookup with several servers', () => {
  it('prints how many servers agreed, and exits 1 naming the server that differs', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const noRelay = { query: async () => Promise.reject(new Error('relays must not be asked')), publish: async () => [] };
    expect(await main(['anchor-lookup', keys.address], noRelay, three(bound, bound))).toBe(0);
    expect(String(log.mock.calls[0]?.[0])).toMatch(/read from 3 of 3 chain servers, all alike: a\.example, b\.example, c\.example \(quorum 2\)/);
    expect(await main(['anchor-lookup', keys.address], noRelay, three(bound, forged))).toBe(1);
    expect(String(err.mock.calls.at(-1)?.[0])).toMatch(/c\.example answered differently/);
    expect(await main(['anchor-lookup', keys.address], noRelay, three(null, null))).toBe(1);
    expect(String(err.mock.calls.at(-1)?.[0])).toMatch(/b\.example, c\.example did not answer; 1 answered alike, 2 needed/);
  });
});

describe('config anchor.quorum', () => {
  const fresh = () => JSON.parse(readFileSync(new URL('../config/tambat.json', import.meta.url), 'utf8'));
  it('is at least two and at most the number of servers', () => {
    expect(config.anchor.quorum).toBeGreaterThanOrEqual(2);
    expect(config.anchor.quorum).toBeLessThanOrEqual(config.anchor.electrum.length);
  });
  it.each([0, 4, 1.5, '2'])('rejects %s', (value) => {
    const c = fresh();
    c.anchor.quorum = value;
    expect(() => parseConfig(c)).toThrow(/config anchor\.quorum:/);
  });
});
