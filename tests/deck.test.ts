/**
 * The event banner and its deck: config.banner holds all three links, the deck follows the event's slide template, cites
 * only sections that exist in MEASURED.md, and web/public/deck.pdf was printed from the current source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeCashAddress } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import config from '../config/tambat.json' with { type: 'json' };
import { inputsHash, loadSlides, OUT, ROOT, STAMP } from '../tools/deck/deck.js';

/** The slide titles of the event template, in its order. */
const TEMPLATE = ['Title', 'Tagline', 'Title here', 'The Story of', 'Benefits of', 'BCH Usage', 'The Vision for', 'Thank you'];

const pdf = () => readFileSync(resolve(ROOT, OUT));
const pageCount = (bytes: Buffer) => (bytes.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;

describe('event banner', () => {
  it('links the deck on this site, the repository and a BCH address', () => {
    const b = config.banner;
    expect(b.deckUrl).toBe(`${config.site.publicUrl}/deck.pdf`);
    expect(b.repoUrl).toMatch(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/);
    expect(typeof decodeCashAddress(b.contactAddress)).toBe('object');
    expect(b.contactAddress.startsWith('bitcoincash:')).toBe(true);
  });
});

describe('event deck', () => {
  const slides = loadSlides();

  it('has 6 to 8 slides in the order of the event template', () => {
    expect(slides.length).toBeGreaterThanOrEqual(6);
    expect(slides.length).toBeLessThanOrEqual(8);
    const order = slides.map((s) => TEMPLATE.indexOf(s.template));
    expect(order).not.toContain(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(slides[0]?.template).toBe('Title');
    expect(slides.at(-1)?.template).toBe('Thank you');
  });

  it('cites only sections that exist in MEASURED.md', () => {
    const headings = new Set(readFileSync(resolve(ROOT, 'docs/MEASURED.md'), 'utf8').split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3)));
    const cited = slides.flatMap((s) => s.items ?? []).flatMap((i) => (i.measured ? [i.measured] : []));
    expect(cited.length).toBeGreaterThan(0);
    for (const c of cited) expect(headings, c).toContain(c);
  });

  it('keeps to the plain style of the rest of the docs', () => {
    const text = JSON.stringify(slides);
    expect(text).not.toMatch(/[—!]/u);
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('is a PDF with one page per slide, printed from the current source', () => {
    const bytes = pdf();
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pageCount(bytes)).toBe(slides.length);
    // Stale when any input changed since the last `npx tsx tools/deck/build.ts`.
    expect(readFileSync(resolve(ROOT, STAMP), 'utf8').trim()).toBe(inputsHash());
  });
});
