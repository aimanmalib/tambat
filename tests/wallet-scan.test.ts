/**
 * Address discovery for a WizardConnect wallet (web/keys/wallet-scan.ts): the gap limit, the cap, wallets that share
 * fewer keys, and the change path. Pure: addresses are labels, the chain is a set of used labels.
 */
import { describe, expect, it } from 'vitest';
import type { Utxo } from '../src/core/anchor.js';
import { activityOf, scanWallet, type ScanOptions, type WalletPath } from '../web/keys/wallet-scan.js';

const label = (path: WalletPath, index: number) => `${path}/${index}`;
const coin = (sats: number): Utxo => ({ txid: '00'.repeat(32), vout: 0, satoshis: sats, height: 1 });

/** A wallet whose `used` addresses have history (and `funded` ones coins); `keys` limits how many keys a path shares. */
function options(o: { used?: string[]; funded?: Record<string, number>; keys?: Partial<Record<WalletPath, number>>; gapLimit?: number; maxAddresses?: number }) {
  const batches: string[][] = [];
  const used = new Set([...(o.used ?? []), ...Object.keys(o.funded ?? {})]);
  const scan: ScanOptions = {
    derive: (path, index) => (index < (o.keys?.[path] ?? Infinity) ? { path, index, address: label(path, index) } : undefined),
    lookup: async (addresses) => {
      batches.push([...addresses]);
      return addresses.map((a) => {
        const sats = o.funded?.[a];
        return { used: used.has(a), coins: sats ? [coin(sats)] : [] };
      });
    },
    gapLimit: o.gapLimit ?? 20,
    maxAddresses: o.maxAddresses ?? 200,
  };
  return { scan, batches };
}

describe('wallet scan', () => {
  it('stops after exactly gapLimit unused addresses in a row, in batches of gapLimit', async () => {
    const { scan, batches } = options({});
    const r = await scanWallet(scan);
    expect(r.scanned).toEqual({ receive: 20, change: 20 });
    expect(batches.map((b) => b.length)).toEqual([20, 20]);
    expect(r.funded).toEqual([]);
    expect(r.capped).toBe(false);
  });

  it('keeps going when index 19 is used, and finds a coin at receive 23 and change 7', async () => {
    const { scan } = options({ used: ['receive/19'], funded: { 'receive/23': 900, 'change/7': 3000 } });
    const r = await scanWallet(scan);
    // Last used receive index is 23, so the walk covers 24..43 unused: 44 addresses in 3 batches (20 + 20 + 20 = 60).
    expect(r.scanned.receive).toBe(60);
    expect(r.scanned.change).toBe(40);
    expect(r.funded.map((f) => [f.path, f.index, f.sats])).toEqual([['change', 7, 3000], ['receive', 23, 900]]);
  });

  it('reads one more batch when the first ends with 19 unused in a row, not 20', async () => {
    const { scan, batches } = options({ used: ['receive/0'] });
    const r = await scanWallet(scan);
    expect(r.scanned.receive).toBe(40);
    expect(batches[1]?.[0]).toBe('receive/20');
  });

  it('stops at maxAddresses on a path and says so', async () => {
    const used = Array.from({ length: 100 }, (_, i) => `receive/${i}`);
    const { scan } = options({ used, gapLimit: 10, maxAddresses: 50 });
    const r = await scanWallet(scan);
    expect(r.scanned).toEqual({ receive: 50, change: 10 });
    expect(r.capped).toBe(true);
  });

  it('ends a path where the wallet stops sharing keys, and skips a path with none', async () => {
    const { scan, batches } = options({ keys: { receive: 7, change: 0 }, funded: { 'receive/6': 1000 } });
    const r = await scanWallet(scan);
    expect(r.scanned).toEqual({ receive: 7, change: 0 });
    expect(batches).toHaveLength(1);
    expect(r.funded).toHaveLength(1);
  });

  it('counts an address with history and no coins as used, not funded', () => {
    expect(activityOf([{ tx_hash: 'a' }], [])).toEqual({ used: true, coins: [] });
    expect(activityOf([], [])).toEqual({ used: false, coins: [] });
    expect(activityOf([], [coin(5)]).used).toBe(true);
  });
});
