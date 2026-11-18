/** `tambat attest` and `tambat attestations`: pin to the subject's current binding, then list what still counts. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { main } from '../bin/tambat.js';
import type { Event } from '../src/core/nostr.js';
import { bindingFromKeys } from '../src/core/paytaca.js';
import { fakeRelay, keys, other, vectors } from './helpers.js';

const T = 1_800_000_000;
const subjectBinding = bindingFromKeys(other, T - 50);

describe('tambat attest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tambat-attest-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const keyFile = join(dir, 'keys.json');
  writeFileSync(keyFile, JSON.stringify({ phrase: vectors.phrase }), { mode: 0o600 });
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
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
    return { code: await main(argv, deps), published };
  };

  it('attests the current binding, which the listing then shows, printing no secret', async () => {
    const { code, published } = await run(['attest', other.npub, '--keys', keyFile], [subjectBinding]);
    expect(code).toBe(0);
    const attestation = published[0] as Event;
    expect(attestation.pubkey).toBe(keys.nostrPubkey);
    expect(attestation.tags).toContainEqual(['e', subjectBinding.id]);
    expect(log.mock.calls.flat().join('\n')).not.toContain(vectors.phrase.split(' ')[0] + ' ');

    log.mockClear();
    expect((await run(['attestations', other.npub], [subjectBinding, attestation])).code).toBe(0);
    expect(log.mock.calls.flat().join('\n')).toContain(`verified by ${keys.npub}`);

    log.mockClear();
    const newer = bindingFromKeys(other, T + 50);
    expect((await run(['attestations', other.npub], [subjectBinding, newer, attestation])).code).toBe(1);
    expect(log.mock.calls.flat().join('\n')).toContain('1 attester(s) attested an earlier binding only');
  });

  it('refuses a key without a verified binding and the attester itself', async () => {
    error.mockClear();
    const none = await run(['attest', other.npub, '--keys', keyFile], []);
    expect(none.code).toBe(2);
    expect(none.published).toEqual([]);
    expect(error.mock.calls.flat().join('\n')).toContain('no verified binding');
    const self = await run(['attest', keys.npub, '--keys', keyFile], [bindingFromKeys(keys, T - 10)]);
    expect(self.code).toBe(2);
    expect(self.published).toEqual([]);
    expect((await run(['attestations', 'not-a-key'], [])).code).toBe(2);
  });
});
