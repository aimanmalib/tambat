/**
 * `tambat recover` and the recovery lines of `tambat lookup`/`verify`. The lost key is the Nostr key of account 1,
 * bound to the account 0 address; the new key and the wallet are the public phrase file (account 0).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeEvent } from 'nostr-tools/pure';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { main } from '../bin/tambat.js';
import { signMessage } from '../src/core/bchmsg.js';
import { createBindingEvent } from '../src/core/binding.js';
import { lookupByPubkey } from '../src/core/discover.js';
import { verificationText, type Event } from '../src/core/nostr.js';
import { fakeRelay, keys, other, vectors } from './helpers.js';

const T = 1_800_000_000;
const lost = finalizeEvent(
  createBindingEvent({ claim: { address: keys.address, signature: signMessage(keys.bchPrivateKey, verificationText(other.npub)) }, createdAt: T }),
  other.nostrSecretKey,
);

describe('tambat recover', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tambat-recover-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const keyFile = join(dir, 'keys.json');
  writeFileSync(keyFile, JSON.stringify({ phrase: vectors.phrase }), { mode: 0o600 });
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const run = async (argv: string[], relay: Event[] = [lost]) => {
    const published: Event[] = [];
    const deps = {
      query: fakeRelay(relay),
      publish: async (e: Event) => {
        published.push(e);
        return [{ relay: 'wss://relay.example', ok: true }];
      },
      now: () => T + 5,
    };
    return { code: await main(argv, deps), published };
  };

  it('publishes a binding with a recovery tag that look-up accepts, and prints no secret', async () => {
    const { code, published } = await run(['recover', other.npub, '--keys', keyFile, '--bch-keys', keyFile]);
    expect(code).toBe(0);
    expect(published).toHaveLength(1);
    const e = published[0] as Event;
    expect(e.pubkey).toBe(keys.nostrPubkey);
    expect(e.tags.find((t) => t[0] === 'replaces')?.slice(0, 3)).toEqual(['replaces', other.npub, `bch:${keys.address}`]);
    const found = await lookupByPubkey(keys.nostrPubkey, { query: fakeRelay([lost, e]) });
    expect(found?.recovery?.ok).toBe(true);
    const printed = log.mock.calls.flat().join('\n');
    expect(printed).toContain(e.id);
    expect(printed).not.toContain(vectors.phrase.split(' ')[0] + ' ');

    log.mockClear();
    expect(await run(['lookup', keys.address], [lost, e]).then((r) => r.code)).toBe(0);
    const lines = log.mock.calls.flat().join('\n');
    expect(lines).toContain(`recovered from ${other.npub}`);
    expect(lines).toContain(`the owner of this address recovered to ${keys.npub}`);
  });

  it('publishes nothing without both key files or when the old key has no verified binding', async () => {
    for (const [argv, relay] of [
      [['recover', other.npub, '--keys', keyFile], [lost]],
      [['recover', other.npub, '--keys', keyFile, '--bch-keys', keyFile], []],
      [['recover', 'npub1nope', '--keys', keyFile, '--bch-keys', keyFile], [lost]],
    ] as const) {
      const { code, published } = await run([...argv], [...relay]);
      expect(code, argv.join(' ')).toBe(2);
      expect(published).toEqual([]);
    }
  });
});
