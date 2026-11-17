import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildVerifier } from '../scripts/build-verifier.js';

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'tambat-verifier-'));
  dirs.push(dir);
  return dir;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('one-file verifier build', () => {
  it('is reproducible, self-contained and quoted in the README', async () => {
    const first = await buildVerifier(tempDir());
    const second = await buildVerifier(tempDir());
    expect(second.sha256).toBe(first.sha256);

    const html = readFileSync(first.file, 'utf8');
    // Markup only: the inline script's own text may mention tags.
    const markup = html.replace(/(<(script|style)\b[^>]*>)[\s\S]*?<\/\2>/g, '$1</$2>');
    expect(markup.match(/<script\b[^>]*>/g)).toEqual(['<script type="module" crossorigin>']);
    expect(markup).not.toMatch(/\ssrc=|\shref=|<link\b/);
    // The file allows no fetches except relay WebSockets, even when opened from disk.
    expect(html).toMatch(/http-equiv="Content-Security-Policy" content="default-src 'none';[^"]*connect-src ws: wss:;/);
    expect(readFileSync(`${first.file}.sha256`, 'utf8')).toBe(`${first.sha256}  tambat-verify.html\n`);

    const readme = readFileSync(join(import.meta.dirname, '..', 'README.md'), 'utf8');
    expect(readme, 'README must quote the SHA-256 of the current build (npm run build:verifier)').toContain(first.sha256);
  }, 180_000);
});
