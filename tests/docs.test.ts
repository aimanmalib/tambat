/** The protocol documents quote code and vectors; these checks fail when the documents and the code drift apart. */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VERIFY_STEPS } from '../src/core/binding.js';
import { vectors } from './helpers.js';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const BOUNTY_REQUIREMENTS = [
  'Identity creation and management',
  'Cryptographic identity binding',
  'Decentralized discovery',
  'Verification and authentication',
  'Working demonstration and documentation',
];

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

  it('README and the docs link files that exist', () => {
    for (const doc of ['README.md', 'docs/SPEC.md', 'docs/VERIFY.md', 'docs/PAYTACA.md']) {
      for (const [, target] of read(doc).matchAll(/\]\(((?:\.\.\/|[A-Za-z])[^)#:]*)(?:#[^)]*)?\)/g)) {
        expect(existsSync(new URL(target ?? '', new URL(`../${doc}`, import.meta.url))), `${doc} -> ${target}`).toBe(true);
      }
    }
  });

  it('README maps every bounty requirement to files that exist', () => {
    const readme = read('README.md');
    const section = /## Bounty requirements\n([\s\S]*?)\n## /.exec(readme)?.[1] ?? '';
    for (const requirement of BOUNTY_REQUIREMENTS) {
      const row = section.split('\n').find((line) => line.startsWith(`| ${requirement} |`));
      expect(row, requirement).toBeDefined();
      const paths = [...(row ?? '').matchAll(/`([\w./-]+)`/g)].map((match) => match[1] ?? '');
      expect(paths.length, requirement).toBeGreaterThan(0);
      for (const path of paths) expect(existsSync(new URL(`../${path}`, import.meta.url)), path).toBe(true);
    }
  });

  it('PAYTACA.md says the WalletConnect path is not yet recorded with a real wallet', () => {
    const today = /## Today, with no wallet change\n([\s\S]*?)\n## /.exec(read('docs/PAYTACA.md'))?.[1] ?? '';
    expect(today).toMatch(/not yet been recorded with a real Paytaca wallet/);
    expect(today).toContain('(MEASURED.md)');
  });
});
