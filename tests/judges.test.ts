/** The judges page reads its proof from config.judges; these checks keep that block true to the records and the code. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { config, parseConfig } from '../src/config.js';
import { toNpub } from '../src/core/nostr.js';
import { verifyBinding } from '../src/core/verify.js';
import demoEvent from '../e2e/demo-binding-event.json' with { type: 'json' };

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const fresh = () => JSON.parse(read('config/tambat.json'));
const measured = read('docs/MEASURED.md');
const j = config.judges;

describe('config.judges', () => {
  it('names the demo identity this site serves over NIP-05', () => {
    const [name = '', domain] = j.sample.name.split('@');
    expect(domain).toBe(new URL(config.site.publicUrl).host);
    expect(j.sample.npub).toBe(toNpub(config.nip05.names[name]!));
  });

  it('points only at events, keys and addresses recorded in docs/MEASURED.md', () => {
    for (const value of [j.paytaca.eventId, j.paytaca.npub, j.revocation.eventId, j.revocation.npub, j.sample.npub, j.sample.address]) {
      expect(measured).toContain(value);
    }
  });

  it('the e2e copy of the demo binding is the genuine, verified event for the sample', () => {
    const result = verifyBinding(demoEvent);
    expect(result.ok).toBe(true);
    expect(result.npub).toBe(j.sample.npub);
    expect(result.claims.map((c) => c.address)).toEqual([j.sample.address]);
  });

  it('the page style switches layout at the same width the lists start open', () => {
    const css = read('web/judges/judges.css');
    const value = Number.parseFloat(j.openFromWidth);
    const unit = j.openFromWidth.replace(String(value), '');
    expect(css).toContain(`@media (min-width: ${j.openFromWidth})`);
    expect(css).toContain(`@media (max-width: ${(value - 0.01).toFixed(2)}${unit})`);
  });

  it.each([
    ['paytaca.eventId', (c: { judges: { paytaca: { eventId: string } } }) => (c.judges.paytaca.eventId = 'd7c03eee')],
    ['revocation.npub', (c: { judges: { revocation: { npub: string } } }) => (c.judges.revocation.npub = 'npub1short')],
    ['sample.address', (c: { judges: { sample: { address: string } } }) => (c.judges.sample.address = 'bitcoincash:pzzz')],
    ['openFromWidth', (c: { judges: { openFromWidth: string } }) => (c.judges.openFromWidth = 'wide')],
    ['repoUrl', (c: { judges: { repoUrl: string } }) => (c.judges.repoUrl = 'http://example.com')],
  ])('rejects a bad judges.%s', (path, spoil) => {
    const c = fresh();
    spoil(c);
    expect(() => parseConfig(c)).toThrow(new RegExp(`judges.${path.replace('.', '\\.')}`));
  });
});
