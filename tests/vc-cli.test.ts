/** `tambat vc export` and `tambat vc verify`, on the committed example and on fixtures. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeEvent } from 'nostr-tools/pure';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { main } from '../bin/tambat.js';
import { createAttestationEvent } from '../src/core/attest.js';
import type { Event } from '../src/core/nostr.js';
import { bindingFromKeys } from '../src/core/paytaca.js';
import { fakeRelay, keys, other } from './helpers.js';

const example = new URL('../examples/attestation-vc.json', import.meta.url).pathname;
const T = 1_800_000_000;
const binding = bindingFromKeys(keys, T);
const attestation = finalizeEvent(createAttestationEvent({ subject: keys.nostrPubkey, bindingEventId: binding.id, createdAt: T + 5 }), other.nostrSecretKey);

describe('tambat vc', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tambat-vc-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const deps = (relay: Event[]) => ({ query: fakeRelay(relay), publish: async () => [] });
  const printed = () => log.mock.calls.map((c) => String(c[0])).join('\n');

  it('verifies the committed example offline, exit 0', async () => {
    log.mockClear();
    expect(await main(['vc', 'verify', example], deps([]))).toBe(0);
    expect(printed()).toMatch(/^VERIFIED/);
  });

  it('exits 1 and names the field when the example is changed', async () => {
    const vc = JSON.parse(readFileSync(example, 'utf8')) as { validFrom: string };
    vc.validFrom = '2020-01-01T00:00:00Z';
    const file = join(dir, 'changed.json');
    writeFileSync(file, JSON.stringify(vc));
    log.mockClear();
    expect(await main(['vc', 'verify', file], deps([]))).toBe(1);
    expect(printed()).toContain('NOT VERIFIED  a field differs from what the signed events say (validFrom)');
  });

  it('exports by attestation id from the relays, and the output verifies', async () => {
    log.mockClear();
    expect(await main(['vc', 'export', attestation.id], deps([attestation, binding]))).toBe(0);
    const file = join(dir, 'out.json');
    writeFileSync(file, printed());
    expect(await main(['vc', 'verify', file, '--json'], deps([]))).toBe(0);
    expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({ ok: true, issuer: `did:nostr:${other.nostrPubkey}` });
  });

  it('exports from files with --binding, and refuses a binding the attestation does not pin', async () => {
    const a = join(dir, 'a.json');
    const b = join(dir, 'b.json');
    writeFileSync(a, JSON.stringify(attestation));
    writeFileSync(b, JSON.stringify(binding));
    expect(await main(['vc', 'export', a, '--binding', b], deps([]))).toBe(0);
    writeFileSync(b, JSON.stringify(bindingFromKeys(keys, T + 1)));
    error.mockClear();
    expect(await main(['vc', 'export', a, '--binding', b], deps([]))).toBe(1);
    expect(String(error.mock.calls[0]?.[0])).toContain('does not pin');
    expect(await main(['vc', 'export', attestation.id], deps([]))).toBe(1);
    expect(await main(['vc', 'sign', a], deps([]))).toBe(2);
  });
});
