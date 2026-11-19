/** `tambat sd issue|present|verify`, on the committed example and on a fixture issued with the public test phrase. */
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { main } from '../bin/tambat.js';
import type { Event } from '../src/core/nostr.js';
import { bindingFromKeys } from '../src/core/paytaca.js';
import { decodeDisclosure, makeDisclosure, type SdPresentation } from '../src/core/sd.js';
import { fakeRelay, keys, vectors } from './helpers.js';

const example = new URL('../examples/sd-presentation.json', import.meta.url).pathname;

describe('tambat sd', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tambat-sd-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const deps = (relay: Event[]) => ({ query: fakeRelay(relay), publish: async () => [] });
  const printed = () => log.mock.calls.map((c) => String(c[0])).join('\n');
  const file = (name: string, value: unknown) => {
    const f = join(dir, name);
    writeFileSync(f, JSON.stringify(value));
    return f;
  };

  it('verifies the committed example: the address revealed, at least two fields hidden', async () => {
    log.mockClear();
    expect(await main(['sd', 'verify', example], deps([]))).toBe(0);
    expect(printed()).toMatch(/^VERIFIED {2}selective disclosure by npub1/);
    expect(printed()).toMatch(/bchAddress bitcoincash:q\S+ \(BCH signature for this npub checked\)/);
    expect(printed()).toMatch(/[2-9] of \d field\(s\) hidden/);
  });

  it('exits 1 and names the reason when the revealed value is changed', async () => {
    const p = JSON.parse(readFileSync(example, 'utf8')) as SdPresentation;
    const d = decodeDisclosure(p.disclosures[0]!)!;
    p.disclosures[0] = makeDisclosure(d.salt, d.name, { ...(d.value as object), address: keys.address });
    log.mockClear();
    expect(await main(['sd', 'verify', file('changed.json', p)], deps([]))).toBe(1);
    expect(printed()).toContain('NOT VERIFIED  a disclosure digest is not in the credential (changed value or another credential) (disclosures[0])');
  });

  it('issues from a key file and a binding read from the relays, presents one field and verifies it', async () => {
    const binding = bindingFromKeys(keys, 1_800_000_000);
    const issued = join(dir, 'issued.json');
    const shown = join(dir, 'shown.json');
    const keyFile = file('keys.json', { phrase: vectors.phrase });
    expect(await main(['sd', 'issue', '--keys', keyFile, '--out', issued], deps([binding]))).toBe(0);
    expect(statSync(issued).mode & 0o777).toBe(0o600);
    expect(await main(['sd', 'present', issued, '--reveal', 'boundAt', '--out', shown], deps([]))).toBe(0);
    log.mockClear();
    expect(await main(['sd', 'verify', shown, '--json'], deps([]))).toBe(0);
    const r = JSON.parse(printed()) as { disclosed: { name: string; value: string }[]; hidden: number };
    expect(r.disclosed).toEqual([{ name: 'boundAt', value: new Date(1_800_000_000_000).toISOString().replace('.000Z', 'Z') }]);
    expect(r.hidden).toBe(3);
  });

  it('exits 1 when no binding of the key is found and 2 on a field name that does not exist', async () => {
    const keyFile = file('keys2.json', { phrase: vectors.phrase });
    expect(await main(['sd', 'issue', '--keys', keyFile], deps([]))).toBe(1);
    expect(await main(['sd', 'present', example, '--reveal', 'nickname'], deps([]))).toBe(2);
    expect(await main(['sd', 'show', example], deps([]))).toBe(2);
  });
});
