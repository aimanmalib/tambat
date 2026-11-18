/** `tambat receipt-publish` and `tambat receipt`: publish with the phrase file's Nostr key, then find and check. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { main } from '../bin/tambat.js';
import type { Event } from '../src/core/nostr.js';
import { bindingFromKeys } from '../src/core/paytaca.js';
import { fakeSource, type FakeChain } from './fake-fulcrum.js';
import { fakeRelay, keys, other, vectors } from './helpers.js';
import { transaction } from './receipt-chain.js';

const T = 1_800_000_000;
const funding = transaction([{ txid: '44'.repeat(32), vout: 1 }], [{ address: keys.address, sats: 30_000 }]);
const payment = transaction([{ txid: funding.txid, vout: 0 }], [{ address: other.address, sats: 29_000 }]);
const chain: FakeChain = { history: { all: [funding, payment] }, headers: {} };
const bindings = [bindingFromKeys(keys, T - 50), bindingFromKeys(other, T - 50)];

describe('tambat receipt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tambat-receipt-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const keyFile = join(dir, 'keys.json');
  writeFileSync(keyFile, JSON.stringify({ phrase: vectors.phrase }), { mode: 0o600 });
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const run = async (argv: string[], relay: Event[]) => {
    const published: Event[] = [];
    const deps = {
      query: fakeRelay(relay),
      publish: async (e: Event) => {
        published.push(e);
        return [{ relay: 'wss://relay.example', ok: true }];
      },
      now: () => T,
    };
    return { code: await main(argv, deps, async () => fakeSource(chain)), published };
  };

  it('publishes a receipt that the look-up finds and proves from the bound address, printing no secret', async () => {
    const { code, published } = await run(['receipt-publish', other.npub, payment.txid, '--keys', keyFile], bindings);
    expect(code).toBe(0);
    expect(published).toHaveLength(1);
    const receipt = published[0] as Event;
    expect(receipt.pubkey).toBe(keys.nostrPubkey);
    expect(log.mock.calls.flat().join('\n')).not.toContain(vectors.phrase.split(' ')[0] + ' ');

    log.mockClear();
    expect((await run(['receipt', payment.txid], [...bindings, receipt])).code).toBe(0);
    const lines = log.mock.calls.flat().join('\n');
    expect(lines).toContain(receipt.id);
    expect(lines).toContain('from a bound address');
    expect(lines).toContain('pays an address bound to the payee');
  });

  it('exits 1 with "payer not proven" when the payer has no binding, and when no receipt exists', async () => {
    const { published } = await run(['receipt-publish', other.npub, payment.txid, '--keys', keyFile], bindings);
    log.mockClear();
    expect((await run(['receipt', payment.txid], [bindings[1] as Event, published[0] as Event])).code).toBe(1);
    expect(log.mock.calls.flat().join('\n')).toContain('payer not proven');
    log.mockClear();
    expect((await run(['receipt', 'cd'.repeat(32)], bindings)).code).toBe(1);
    expect(log.mock.calls.flat().join('\n')).toContain('no receipt found');
    expect((await run(['receipt', 'not-a-txid'], bindings)).code).toBe(2);
  });
});
