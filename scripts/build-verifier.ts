/**
 * Builds the one-file verifier and prints its SHA-256, the value the README quotes. Anyone can run
 * `npm run build:verifier` on the same commit and compare. Usage: tsx scripts/build-verifier.ts [outDir]
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'vite';

export const VERIFIER_FILE = 'tambat-verify.html';

export async function buildVerifier(outDir = resolve(import.meta.dirname, '..', 'dist-verifier')): Promise<{ file: string; sha256: string }> {
  // Vite takes NODE_ENV from the environment when it is set (vitest sets it to "test"), which would build React's
  // development bundle and change the bytes. The published file is always the production build.
  const before = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await build({
      configFile: resolve(import.meta.dirname, '..', 'vite.verifier.config.ts'),
      mode: 'production',
      logLevel: 'warn',
      build: { outDir, emptyOutDir: true },
    });
  } finally {
    if (before === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = before;
  }
  const file = resolve(outDir, VERIFIER_FILE);
  const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex');
  writeFileSync(`${file}.sha256`, `${sha256}  ${VERIFIER_FILE}\n`);
  return { file, sha256 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { file, sha256 } = await buildVerifier(process.argv[2] ? resolve(process.argv[2]) : undefined);
  console.log(`${sha256}  ${file.split('/').pop()}`);
}
