/**
 * The judges page names the Paytaca binding's BCH commitment from config.judges.anchor and checks it live. These tests
 * keep that block equal to the recorded transaction (a public copy in e2e/paytaca-anchor.json) and to docs/MEASURED.md,
 * and check that only an exact match reads as confirmed.
 */
import { readFileSync } from 'node:fs';
import { hexToBin } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import { config, parseConfig } from '../src/config.js';
import { anchorStatus, scripthashOf } from '../src/core/anchor-chain.js';
import { commitmentFromTransaction, txidOf } from '../src/core/anchor.js';
import { proofState } from '../src/core/anchor-proof.js';
import { parsePubkey } from '../src/core/nostr.js';
import recorded from '../e2e/paytaca-anchor.json' with { type: 'json' };
import { fakeSource, type FakeChain } from './fake-fulcrum.js';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const fresh = () => JSON.parse(read('config/tambat.json'));
const a = config.judges.anchor;
const key = parsePubkey(config.judges.paytaca.npub);
const pubkey = 'hex' in key ? key.hex : '';

const chainWith = (height: number): FakeChain => ({
  history: { [scripthashOf(a.address)]: [{ hex: recorded.hex, txid: recorded.txid, height }] },
  headers: { [height]: recorded.header },
});

describe('config.judges.anchor', () => {
  it('is the recorded transaction: its id, its commitment to the Paytaca key and event, from that address', () => {
    expect(txidOf(hexToBin(recorded.hex))).toBe(a.txid);
    expect(recorded.address).toBe(a.address);
    expect(recorded.height).toBe(a.block);
    expect(commitmentFromTransaction(hexToBin(recorded.hex), a.address)).toEqual({ pubkey, eventId: a.eventId });
    expect(a.eventId).toBe(config.judges.paytaca.eventId);
  });

  it('matches an ok row of docs/MEASURED.md "## Anchor"', () => {
    const section = read('docs/MEASURED.md').split(/^## /m).find((s) => s.startsWith('Anchor')) ?? '';
    const row = section.split('\n').find((l) => l.includes(a.txid) && l.includes(String(a.block)));
    expect(row).toMatch(/\|\s*ok\s*\|\s*$/);
  });

  it('builds the explorer link from the full transaction id', () => {
    const url = config.anchor.explorerTx.replace('{txid}', a.txid);
    expect(url).toMatch(/^https:\/\//);
    expect(url).toContain(a.txid);
  });

  it.each([
    ['judges.anchor.txid', (c: ReturnType<typeof fresh>) => (c.judges.anchor.txid = 'a3cf6e76')],
    ['judges.anchor.block', (c: ReturnType<typeof fresh>) => (c.judges.anchor.block = '977901')],
    ['judges.anchor.block', (c: ReturnType<typeof fresh>) => (c.judges.anchor.block = 977901.5)],
    ['judges.anchor.address', (c: ReturnType<typeof fresh>) => (c.judges.anchor.address = 'qp2n90ka')],
    ['judges.anchor.eventId', (c: ReturnType<typeof fresh>) => (c.judges.anchor.eventId = 'D7C03EEE')],
    ['anchor.explorerTx', (c: ReturnType<typeof fresh>) => (c.anchor.explorerTx = 'https://example.com/tx/')],
    ['anchor.explorerTx', (c: ReturnType<typeof fresh>) => (c.anchor.explorerTx = 'http://example.com/tx/{txid}')],
  ])('rejects a bad %s', (path, spoil) => {
    const c = fresh();
    spoil(c);
    expect(() => parseConfig(c)).toThrow(new RegExp(`config ${path.replace(/\./g, '\\.')}:`));
  });
});

describe('proofState', () => {
  it('reads confirmed when the chain shows the recorded transaction in the recorded block', async () => {
    expect(proofState(await anchorStatus(a.address, pubkey, a.eventId, async () => fakeSource(chainWith(a.block))), a)).toBe('confirmed');
  });

  it('reads differs for another block, another key or no commitment', async () => {
    expect(proofState(await anchorStatus(a.address, pubkey, a.eventId, async () => fakeSource(chainWith(a.block + 1))), a)).toBe('differs');
    expect(proofState(await anchorStatus(a.address, '00'.repeat(32), a.eventId, async () => fakeSource(chainWith(a.block))), a)).toBe('differs');
    const empty = { history: {}, headers: {} };
    expect(proofState(await anchorStatus(a.address, pubkey, a.eventId, async () => fakeSource(empty)), a)).toBe('differs');
  });

  it('never reads confirmed when the chain cannot be read', async () => {
    const down = async () => {
      throw new Error('down');
    };
    expect(proofState(await anchorStatus(a.address, pubkey, a.eventId, down), a)).toBe('unreachable');
  });
});
