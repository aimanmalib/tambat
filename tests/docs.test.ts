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

  it('the NIP-39 draft gives the claim format, the exact text, every step and the example vector', () => {
    const nip = read('docs/NIP-39-bch.md');
    expect(nip).toContain('["i", "bch:<cashaddr>", "<proof>"]');
    expect(nip).toContain('Verifying that I control the following Nostr public key: <npub>');
    for (const step of ['event_id', 'nostr_sig', 'newest', 'bch_sig', 'address_match', 'network', 'key_separation']) {
      expect(nip).toContain(`\`${step}\``);
    }
    for (const value of [vectors.bch.address.bitcoincash, vectors.bchSignature, vectors.nostr.npub]) expect(nip).toContain(value);
    expect(nip).toContain('examples/third-party-vectors.json');
    for (const doc of ['docs/SPEC.md', 'docs/VERIFY.md']) expect(read(doc)).toContain('NIP-39-bch.md');
  });

  it('VERIFY.md shows how to check a reputation file and a selective disclosure presentation', () => {
    const verify = read('docs/VERIFY.md');
    for (const [heading, command] of [
      ['## A reputation file', 'npx tsx bin/tambat.ts rep verify examples/reputation-bundle.json'],
      ['## A selective disclosure presentation', 'npx tsx bin/tambat.ts sd verify examples/sd-presentation.json'],
    ] as const) {
      const section = verify.split(heading)[1]?.split('\n## ')[0] ?? '';
      expect(section, heading).toContain(command);
      const file = command.split(' ').at(-1) ?? '';
      expect(existsSync(new URL(`../${file}`, import.meta.url)), file).toBe(true);
    }
  });

  it('README and the docs link files that exist', () => {
    for (const doc of ['README.md', 'docs/SPEC.md', 'docs/VERIFY.md', 'docs/PAYTACA.md', 'docs/NIP-39-bch.md']) {
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

  it('MEASURED.md records the Paytaca binding with its event id, npub and address', () => {
    const entry = /## [^\n]*Paytaca[^\n]*\n([\s\S]*?)\n## /.exec(read('docs/MEASURED.md'))?.[1] ?? '';
    expect(entry).toContain('signed with a Paytaca wallet over WalletConnect');
    expect(entry).toContain('d7c03eee500222e86c5d2b1836a26983a5115b91a5ba23b59b80ed480b1b489b');
    expect(entry).toContain('npub16lxyujttr050u2a884r0xszc7wjjfzqkyy0u7qlh9ghmswcdkf3sascsuz');
    expect(entry).toContain('bitcoincash:qp2n90karn7qnp7thtqzsgj2hfjze6ktgs8r2mm56u');
  });

  it('PAYTACA.md and the README point to the recorded Paytaca signature and keep the test gap honest', () => {
    const today = /## Today, with no wallet change\n([\s\S]*?)\n## /.exec(read('docs/PAYTACA.md'))?.[1] ?? '';
    expect(today).toMatch(/used with a real Paytaca wallet/);
    expect(today).toContain('(MEASURED.md)');
    const limits = /## Known limits and next steps\n([\s\S]*?)(\n## |$)/.exec(read('README.md'))?.[1] ?? '';
    expect(limits).toMatch(/used once with a real Paytaca wallet/);
    expect(limits).toMatch(/not covered by automated tests/);
    expect(read('README.md')).not.toMatch(/not yet been recorded/);
  });
});
