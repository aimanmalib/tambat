/**
 * Builds the library package from src/core and packs it into docs/pkg/ with a SHA256SUMS file.
 * Nothing is copied by hand: tsc compiles src/core/index.ts (and the config it imports, frozen at build time),
 * the version comes from the root package.json, and the dependencies are the bare imports found in the output,
 * pinned to the root versions.
 * Run: npx tsx scripts/pack-core.ts
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const outDir = join(root, 'docs/pkg');
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

function jsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith('.js'))
    .map((e) => join(e.parentPath, e.name));
}

/** Package names of the bare `import ... from '<name>'` specifiers in the compiled files. */
export function bareImports(sources: string[]): string[] {
  const names = new Set<string>();
  for (const text of sources) {
    for (const m of text.matchAll(/(?:from|import)\s*['"]([^'".][^'"]*)['"]/g)) {
      const spec = m[1] as string;
      if (spec.startsWith('node:')) continue;
      const parts = spec.split('/');
      names.add(spec.startsWith('@') ? `${parts[0]}/${parts[1]}` : (parts[0] as string));
    }
  }
  return [...names].sort();
}

function main(): void {
  const rootPkg = readJson(join(root, 'package.json'));
  const rootDeps = rootPkg.dependencies as Record<string, string>;
  const stage = mkdtempSync(join(tmpdir(), 'tambat-core-'));
  try {
    execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(root, 'packages/core/tsconfig.json'), '--outDir', join(stage, 'dist')], { stdio: 'inherit' });
    const deps: Record<string, string> = {};
    for (const name of bareImports(jsFiles(join(stage, 'dist')).map((f) => readFileSync(f, 'utf8')))) {
      const version = rootDeps[name];
      if (!version) throw new Error(`src/core imports ${name}, which is not a dependency of the root package`);
      deps[name] = version;
    }
    const { name: pkgName, ...rest } = readJson(join(root, 'packages/core/package.json'));
    const pkg = { name: pkgName, version: rootPkg.version, ...rest, dependencies: deps };
    writeFileSync(join(stage, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
    copyFileSync(join(root, 'packages/core/README.md'), join(stage, 'README.md'));
    copyFileSync(join(root, 'LICENSE'), join(stage, 'LICENSE'));

    mkdirSync(outDir, { recursive: true });
    for (const old of readdirSync(outDir).filter((f) => f.endsWith('.tgz'))) rmSync(join(outDir, old));
    const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', outDir], { cwd: stage, encoding: 'utf8' })) as { filename: string }[];
    const file = (packed[0] as { filename: string }).filename.replace(/^.*\//, '');
    const hash = createHash('sha256').update(readFileSync(join(outDir, file))).digest('hex');
    writeFileSync(join(outDir, 'SHA256SUMS'), `${hash}  ${file}\n`);
    console.log(`${hash}  docs/pkg/${file}`);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
