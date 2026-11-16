/** The protocol documents quote code and vectors; these checks fail when the documents and the code drift apart. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VERIFY_STEPS } from '../src/core/binding.js';
import { vectors } from './helpers.js';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('docs', () => {
  it('PAYTACA.md shows code taken verbatim from examples/paytaca-binding.ts', () => {
    const block = /```ts\n([\s\S]*?)```/.exec(read('docs/PAYTACA.md'))?.[1] ?? '';
    expect(block.split('\n').length).toBeGreaterThan(20);
    expect(block.split('\n').length).toBeLessThanOrEqual(41);
    expect(read('examples/paytaca-binding.ts')).toContain(block);
  });

  it('SPEC.md names every verification step and quotes the test vectors', () => {
    const spec = read('docs/SPEC.md');
    for (const step of VERIFY_STEPS) expect(spec).toContain(`| \`${step}\` |`);
    for (const value of [
      vectors.phrase,
      vectors.nostr.pubkey,
      vectors.nostr.npub,
      vectors.bch.publicKey,
      vectors.bch.address.bitcoincash,
      vectors.bchSignature,
      vectors.bindingEvent.id,
      String(vectors.bindingEvent.created_at),
    ]) {
      expect(spec).toContain(value);
    }
  });

  it('VERIFY.md and SPEC.md link files that exist', () => {
    for (const doc of ['docs/SPEC.md', 'docs/VERIFY.md', 'docs/PAYTACA.md']) {
      for (const [, target] of read(doc).matchAll(/\]\(((?:\.\.\/|[A-Za-z])[^)#:]*)(?:#[^)]*)?\)/g)) {
        expect(() => readFileSync(new URL(target ?? '', new URL(`../${doc}`, import.meta.url))), `${doc} -> ${target}`).not.toThrow();
      }
    }
  });
});
