import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { main } from '../bin/tambat.js';
import { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import { buildAnchorTransaction, txidOf } from '../src/core/anchor.js';
import { anchorStatus, electrumChain, headerTime, readCommitments, scripthashOf } from '../src/core/anchor-chain.js';
import { signP2pkh, hexOf } from './anchor-wallet.js';
import { answer, fakeSource as source, headerWithTime, type FakeChain } from './fake-fulcrum.js';
import { keys, other, vectors } from './helpers.js';

const payload = { pubkey: keys.nostrPubkey, eventId: vectors.bindingEvent.id };
function commitmentTx(vout: number, signer = keys.bchPrivateKey, p = payload) {
  const unsigned = buildAnchorTransaction(keys.address, [{ txid: '22'.repeat(32), vout, satoshis: 5000 }], p);
  const bytes = signP2pkh(unsigned.transaction, unsigned.sourceOutputs, signer);
  return { hex: hexOf(bytes), txid: txidOf(bytes) };
}
const early = { ...commitmentTx(0), height: 900_010 };
const later = { ...commitmentTx(1), height: 900_200 };
const pending = { ...commitmentTx(2), height: 0 };
const forged = { ...commitmentTx(3, other.bchPrivateKey), height: 899_000 };
const chain: FakeChain = {
  history: { [scripthashOf(keys.address)]: [later, pending, forged, early] },
  headers: { 900_010: headerWithTime(1_763_000_000), 900_200: headerWithTime(1_763_100_000) },
  unspent: { [scripthashOf(keys.address)]: [{ tx_hash: '44'.repeat(32), tx_pos: 1, value: 50_000, height: 0 }] },
};

describe('chain helpers', () => {
  it('computes the Electrum script hash of an address (genesis coinbase address)', () => {
    expect(scripthashOf('bitcoincash:qp3wjpa3tjlj042z2wv7hahsldgwhwy0rq9sywjpyy')).toBe(
      '8b01df4e368ea28f8dc0423bcf7a4923e3a12d307c875e47a0cfbf90b5c39161',
    );
  });

  it('reads the time of a block header (genesis block)', () => {
    const genesis =
      '0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c';
    expect(headerTime(genesis)).toBe(1231006505);
  });
});

describe('reading commitments', () => {
  it('finds commitments spent from the address, oldest block first, and skips forged ones', async () => {
    const found = await readCommitments(keys.address, source(chain));
    expect(found.map((c) => c.txid)).toEqual([early.txid, later.txid, pending.txid]);
    expect(found[0]).toMatchObject({ pubkey: payload.pubkey, eventId: payload.eventId, height: 900_010, blockTime: 1_763_000_000 });
    expect(found[2]?.blockTime).toBeUndefined();
  });

  it('gives the earliest anchor for the current key, none for another key, and closes the connection', async () => {
    const closed = { count: 0 };
    const status = await anchorStatus(keys.address, payload.pubkey, payload.eventId, async () => source(chain, closed));
    expect(status).toEqual({ kind: 'anchored', commitment: expect.objectContaining({ txid: early.txid, height: 900_010 }), sameEvent: true });
    const replaced = await anchorStatus(keys.address, payload.pubkey, 'ff'.repeat(32), async () => source(chain, closed));
    expect(replaced).toMatchObject({ kind: 'anchored', sameEvent: false });
    expect(await anchorStatus(keys.address, other.nostrPubkey, payload.eventId, async () => source(chain, closed))).toEqual({ kind: 'none' });
    expect(closed.count).toBe(3);
  });

  it('reports unreachable chain servers instead of throwing', async () => {
    expect(await anchorStatus(keys.address, payload.pubkey, payload.eventId, async () => Promise.reject(new Error('down')))).toEqual({ kind: 'unreachable' });
    const broken = { ...chain, headers: {} };
    expect(await anchorStatus(keys.address, payload.pubkey, payload.eventId, async () => source(broken))).toEqual({ kind: 'unreachable' });
  });
});

describe('Electrum client over WebSocket', () => {
  let server: WebSocketServer;
  let url = '';
  beforeAll(async () => {
    server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => server.on('listening', () => resolve()));
    url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
    server.on('connection', (socket) => socket.on('message', (data) => socket.send(answer(chain, String(data).trim()))));
  });
  afterAll(async () => {
    for (const client of server.clients) client.terminate();
    await new Promise((resolve) => server.close(resolve));
  });

  it('skips a server that does not answer and reads the anchor from the next one', async () => {
    const open = electrumChain(['ws://127.0.0.1:9', url], 3000);
    const status = await anchorStatus(keys.address, payload.pubkey, payload.eventId, open);
    expect(status).toMatchObject({ kind: 'anchored', commitment: { txid: early.txid, blockTime: 1_763_000_000 } });
  });

  it('keeps the block height of each unspent coin, so unconfirmed coins are known before the wallet is asked', async () => {
    const source = await electrumChain([url], 3000)();
    try {
      expect(await source.unspent(scripthashOf(keys.address))).toEqual([{ txid: '44'.repeat(32), vout: 1, satoshis: 50_000, height: 0 }]);
    } finally {
      await source.close();
    }
  });
});

describe('tambat anchor-lookup', () => {
  it('lists the commitments from the chain alone and exits 0 when one is confirmed', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const noRelay = { query: async () => Promise.reject(new Error('relays must not be asked')), publish: async () => [] };
    const code = await main(['anchor-lookup', keys.address, '--json'], noRelay, async () => source(chain));
    const printed = JSON.parse(String(log.mock.calls[0]?.[0])) as { npub: string; height: number }[];
    log.mockRestore();
    expect(code).toBe(0);
    expect(printed.map((c) => c.height)).toEqual([900_010, 900_200, 0]);
    expect(printed[0]?.npub).toBe(keys.npub);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await main(['anchor-lookup', keys.address], noRelay, async () => Promise.reject(new Error('down')))).toBe(1);
    expect(await main(['anchor-lookup', 'npub1nope'], noRelay, async () => source(chain))).toBe(2);
    vi.restoreAllMocks();
  });
});
