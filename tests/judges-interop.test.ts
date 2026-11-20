/**
 * The interoperability counts on the judges page come from config judges.interop, which the measuring run writes; they
 * must say what docs/MEASURED.md "## Interoperability" says, and the hero's fallback binding must be one it measured.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { config, parseConfig } from '../src/config.js';
import { REQUIREMENTS } from '../web/judges/links.js';
import en from '../lang/en.json' with { type: 'json' };
import ms from '../lang/ms.json' with { type: 'json' };

const measured = readFileSync(new URL('../docs/MEASURED.md', import.meta.url), 'utf8');
const section = /^## Interoperability\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(measured)?.[1] ?? '';

describe('judges.interop', () => {
  it('matches the sentences in MEASURED', () => {
    const by = /verified by (\d+) of (\d+) independent NIP-39 verifiers/i.exec(section);
    const theirs = /verifies (\d+) of (\d+) of theirs/i.exec(section);
    const i = config.judges.interop;
    expect([i.verifiedBy, i.verifiers]).toEqual([Number(by?.[1]), Number(by?.[2])]);
    expect([i.verifiesTheirs, i.theirs]).toEqual([Number(theirs?.[1]), Number(theirs?.[2])]);
    expect(section).toContain(`${i.measuredAt.slice(11, 16)} UTC`);
  });

  it('counts one row per third-party binding in the newest table', () => {
    const table = section.split('| event id | claims | result |')[1]?.split('###')[0] ?? '';
    const rows = table.split('\n').filter((l) => /^\| `[0-9a-f]{64}` \|/.test(l));
    expect(rows).toHaveLength(config.judges.interop.theirs);
    expect(rows.filter((l) => / ok \|$/.test(l))).toHaveLength(config.judges.interop.verifiesTheirs);
  });

  it('measured every hero candidate after the first, so the fallback is one the verifiers were asked about', () => {
    for (const c of config.hero.candidates) expect(section).toContain(c.npub);
  });

  it('puts the counts on the judges page in both languages, linking to the measurement', () => {
    const link = REQUIREMENTS.flatMap((r) => r.links).find((l) => l.key === 'interop');
    expect(link?.href).toMatch(/docs\/MEASURED\.md#interoperability$/);
    const { verifiedBy, verifiers, verifiesTheirs, theirs } = config.judges.interop;
    const counts = { verifiedBy, verifiers, verifiesTheirs, theirs };
    expect(link?.params).toEqual(counts);
    for (const text of [en.judges.link.interop, ms.judges.link.interop]) {
      expect(text).toContain('NIP-39');
      for (const k of Object.keys(counts)) expect(text).toContain(`{${k}}`);
    }
  });

  const bad = (edit: (i: typeof config.judges.interop) => void) => {
    const c = structuredClone(config);
    edit(c.judges.interop);
    return () => parseConfig(c);
  };
  it('rejects counts that cannot be true and a time that is not UTC', () => {
    expect(bad((i) => (i.verifiedBy = i.verifiers + 1))).toThrow(/judges\.interop\.verifiedBy/);
    expect(bad((i) => (i.verifiesTheirs = i.theirs + 1))).toThrow(/judges\.interop\.verifiesTheirs/);
    expect(bad((i) => (i.theirs = -1))).toThrow(/judges\.interop\.theirs/);
    expect(bad((i) => (i.verifiers = 1.5))).toThrow(/judges\.interop\.verifiers/);
    expect(bad((i) => (i.measuredAt = '2026-11-20 15:03'))).toThrow(/judges\.interop\.measuredAt/);
  });
});
