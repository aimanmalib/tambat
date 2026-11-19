import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { config, configure } from '../src/config.js';
import { lookupByPubkey } from '../src/core/index.js';
import { bareImports } from '../scripts/pack-core.js';

const root = resolve(import.meta.dirname, '..');
const pkgDir = join(root, 'docs/pkg');
const tarballs = readdirSync(pkgDir).filter((f) => f.endsWith('.tgz'));
const tarball = join(pkgDir, tarballs[0] ?? 'missing.tgz');
const fromTar = (member: string) => execFileSync('tar', ['xzOf', tarball, member], { encoding: 'utf8' });
const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string; dependencies: Record<string, string> };
/** Tests that run npm or git in a temp folder must not inherit GIT_* from a hook. */
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));

type LockEntry = { version: string; dependencies?: Record<string, string> } & Record<string, unknown>;
/**
 * A lockfile for a consumer that depends only on the tarball, with every package entry taken from the root lockfile
 * (same paths, so nested copies stay nested). `npm ci --offline` then needs only tarballs the root `npm ci` cached,
 * which keeps the test off the network on a fresh CI runner.
 */
function consumerLock(file: string, integrity: string, deps: Record<string, string>): object {
  const rootLock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')) as { packages: Record<string, LockEntry> };
  const packages: Record<string, unknown> = {
    '': { name: 'consumer', dependencies: { '@tambat/core': `file:${file}` } },
    'node_modules/@tambat/core': { version: rootPkg.version, resolved: `file:${file}`, integrity, license: 'MIT', dependencies: deps },
  };
  const visit = (from: string, name: string): void => {
    for (let dir = from; ; dir = dir.replace(/\/?node_modules\/(@[^/]+\/)?[^/]+$/, '')) {
      const key = `${dir ? `${dir}/` : ''}node_modules/${name}`;
      const entry = rootLock.packages[key];
      if (entry) {
        if (packages[key]) return;
        packages[key] = entry;
        for (const dep of Object.keys(entry.dependencies ?? {})) visit(key, dep);
        return;
      }
      if (!dir) throw new Error(`${name} is not in package-lock.json`);
    }
  };
  for (const name of Object.keys(deps)) visit('', name);
  return { name: 'consumer', lockfileVersion: 3, requires: true, packages };
}

describe('configure', () => {
  const before = structuredClone(config);
  afterEach(() => configure(before));

  it('changes the values every module reads and keeps the rest', async () => {
    configure({ nostr: { relays: ['wss://relay.test'] } });
    expect(config.nostr.relays).toEqual(['wss://relay.test']);
    expect(config.nostr.bindingKind).toBe(before.nostr.bindingKind);
    const seen: string[][] = [];
    await lookupByPubkey('0'.repeat(64), { query: async (relays) => (seen.push(relays), []) });
    expect(seen[0]).toEqual(['wss://relay.test']);
  });

  it('throws on a bad value and leaves the config unchanged', () => {
    expect(() => configure({ nostr: { relays: ['http://not-a-relay'] } })).toThrow(/nostr\.relays/);
    expect(config).toEqual(before);
  });
});

describe('bareImports', () => {
  it('names packages, not subpaths, and skips relative and node: imports', () => {
    const src = `import { a } from 'nostr-tools/pure';\nimport x from "@noble/curves/secp256k1.js";\nimport './x.js';\nimport { y } from '../config.js';\nimport { z } from 'node:fs';`;
    expect(bareImports([src])).toEqual(['@noble/curves', 'nostr-tools']);
  });
});

describe('tracked library tarball', () => {
  it('is one file and matches SHA256SUMS', () => {
    expect(tarballs).toEqual([`tambat-core-${rootPkg.version}.tgz`]);
    const hash = createHash('sha256').update(readFileSync(tarball)).digest('hex');
    expect(readFileSync(join(pkgDir, 'SHA256SUMS'), 'utf8')).toBe(`${hash}  ${tarballs[0]}\n`);
    expect(readFileSync(join(root, 'README.md'), 'utf8')).toContain(`npm install ./${tarballs[0]}`);
  });

  it('is linked as a release asset of the same version from README and the release notes', () => {
    const url = `releases/download/core-v${rootPkg.version}/${tarballs[0]}`;
    expect(readFileSync(join(root, 'README.md'), 'utf8')).toContain(url);
    const notes = readFileSync(join(pkgDir, 'RELEASE-NOTES.md'), 'utf8');
    expect(notes.split('\n')[0]).toBe(`# @tambat/core ${rootPkg.version}`);
    expect(notes).toContain(url);
    expect(notes).toContain('not on the npm registry');
  });

  it('holds only the built library, no local or secret files', () => {
    const list = execFileSync('tar', ['tzf', tarball], { encoding: 'utf8' }).trim().split('\n');
    expect(list).toContain('package/package.json');
    expect(list).toContain('package/dist/src/core/index.js');
    expect(list).toContain('package/dist/src/core/index.d.ts');
    expect(list.filter((f) => /(^|\/)(\.env[^/]*|state\/|dalaman\/|node_modules\/)/.test(f))).toEqual([]);
    expect(list.every((f) => /^package\/(dist\/(src\/(config|core\/[a-z0-9-]+)\.(js|d\.ts)|config\/tambat\.json)|package\.json|README\.md|LICENSE)$/.test(f))).toBe(true);
  });

  it('carries the repo version, pinned root dependencies and the current config (repack after a change)', () => {
    const pkg = JSON.parse(fromTar('package/package.json')) as { name: string; version: string; dependencies: Record<string, string>; exports: unknown };
    expect(pkg.name).toBe('@tambat/core');
    expect(pkg.version).toBe(rootPkg.version);
    for (const [name, version] of Object.entries(pkg.dependencies)) expect(rootPkg.dependencies[name]).toBe(version);
    expect(JSON.parse(fromTar('package/dist/config/tambat.json'))).toEqual(JSON.parse(readFileSync(join(root, 'config/tambat.json'), 'utf8')));
    expect(fromTar('package/README.md')).toContain('not on the npm registry');
  });

  it('installs into a clean folder and both examples run against it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tambat-pkg-'));
    try {
      const env = cleanEnv();
      const deps = (JSON.parse(fromTar('package/package.json')) as { dependencies: Record<string, string> }).dependencies;
      copyFileSync(tarball, join(dir, 'core.tgz'));
      const integrity = `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`;
      const manifest = { name: 'consumer', private: true, type: 'module', dependencies: { '@tambat/core': 'file:core.tgz' } };
      writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
      writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(consumerLock('core.tgz', integrity, deps)));
      execFileSync('npm', ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: dir, env, stdio: 'pipe' });
      for (const f of ['core-nostr-client.ts', 'core-wallet.ts', 'binding-event.json']) copyFileSync(join(root, 'examples', f), join(dir, f));
      const tsx = join(root, 'node_modules/tsx/dist/cli.mjs');
      const client = execFileSync(process.execPath, [tsx, 'core-nostr-client.ts'], { cwd: dir, env, encoding: 'utf8' });
      expect(client).toMatch(/^bound npub1\S+ -> bitcoincash:q/m);
      const wallet = JSON.parse(execFileSync(process.execPath, [tsx, 'core-wallet.ts'], { cwd: dir, env, encoding: 'utf8' })) as { claimOk: boolean; template: { kind: number } };
      expect(wallet.claimOk).toBe(true);
      expect(wallet.template.kind).toBe(config.nostr.bindingKind);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);
});
