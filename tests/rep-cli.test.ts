/** `tambat rep export` and `tambat rep verify`, on the committed example and on fixtures. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nip19 } from 'nostr-tools';
import { finalizeEvent } from 'nostr-tools/pure';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { main } from '../bin/tambat.js';
import { createAttestationEvent } from '../src/core/attest.js';
import type { Event } from '../src/core/nostr.js';
import { bindingFromKeys } from '../src/core/paytaca.js';
import { fakeRelay, keys, other, third } from './helpers.js';

const example = new URL('../examples/reputation-bundle.json', import.meta.url).pathname;
const T = 1_800_000_000;
const binding = bindingFromKeys(keys, T);
const attest = (by: typeof other, at: number) =>
  finalizeEvent(createAttestationEvent({ subject: keys.nostrPubkey, bindingEventId: binding.id, createdAt: at }), by.nostrSecretKey);
const noChain = async () => {
  throw new Error('no chain in tests');
};

describe('tambat rep', { timeout: 30_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'tambat-rep-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const deps = (relay: Event[]) => ({ query: fakeRelay(relay), publish: async () => [] });
  const printed = () => log.mock.calls.map((c) => String(c[0])).join('\n');

  it('verifies the committed example offline, exit 0, and names why each skipped credential does not count', async () => {
    log.mockClear();
    expect(await main(['rep', 'verify', example], deps([]), noChain)).toBe(0);
    const out = printed();
    expect(out).toMatch(/^VERIFIED {2}reputation summary of npub1/);
    expect(out).toContain('attestations 2 counted of 4 credential(s)');
    expect(out).toContain('the holder attests itself');
    expect(out).toContain('it pins an older binding of the holder');
  });

  it('exits 1 when the example claims more attestations than it carries', async () => {
    const b = JSON.parse(readFileSync(example, 'utf8')) as { reputationSummary: { attestations: number } };
    b.reputationSummary.attestations += 1;
    const file = join(dir, 'inflated.json');
    writeFileSync(file, JSON.stringify(b));
    log.mockClear();
    expect(await main(['rep', 'verify', file], deps([]), noChain)).toBe(1);
    expect(printed()).toBe('NOT VERIFIED  a claimed count differs from the recount (reputationSummary.attestations); recount: 2 attestation(s)');
  });

  it('exports from the relays by nprofile, one count per issuer, and the file verifies', async () => {
    const out = join(dir, 'bundle.json');
    const nprofile = nip19.nprofileEncode({ pubkey: keys.nostrPubkey, relays: ['wss://relay.example'] });
    error.mockClear();
    const relay = [binding, attest(other, T + 5), attest(other, T + 6), attest(third, T + 7)];
    expect(await main(['rep', 'export', nprofile, '--out', out], deps(relay), noChain)).toBe(0);
    expect(String(error.mock.calls[0]?.[0])).toContain('2 attestation(s) from 2 issuer(s)');
    log.mockClear();
    expect(await main(['rep', 'verify', out, '--json'], deps([]), noChain)).toBe(0);
    expect(JSON.parse(printed())).toMatchObject({ ok: true, holder: keys.nostrPubkey, binding: binding.id, anchor: { kind: 'none' } });
  });

  it('exits 1 for a key with no binding and 2 for a bad key', async () => {
    expect(await main(['rep', 'export', other.npub], deps([]), noChain)).toBe(1);
    expect(await main(['rep', 'export', 'nprofile1bad'], deps([]), noChain)).toBe(2);
    expect(await main(['rep', 'list', 'x'], deps([]), noChain)).toBe(2);
  });
});
