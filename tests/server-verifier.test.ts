import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../server/app.js';
import { verifierPolicy } from '../server/verifier.js';
import { fakeRelay } from './helpers.js';

const META = `default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; connect-src ws: wss:`;
const SCRIPT = 'document.body.dataset.ok = "1";';
const STYLE = 'body { color: black; }';
const HTML = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${META}" />
<script type="module" crossorigin>${SCRIPT}</script><style rel="stylesheet" crossorigin>${STYLE}</style></head><body></body></html>`;
const b64 = (s: string) => createHash('sha256').update(s).digest('base64');

const dir = mkdtempSync(join(tmpdir(), 'tambat-verify-route-'));
const file = join(dir, 'tambat-verify.html');
writeFileSync(file, HTML);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('verifier routes', () => {
  const app = buildApp({ query: fakeRelay([]), staticDir: '/nonexistent', verifierFile: file });
  afterAll(() => app.close());

  it('serves the file at /verify/ under a hash-based policy that forbids framing', async () => {
    const res = await app.inject({ url: '/verify/' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(HTML);
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain(`script-src 'wasm-unsafe-eval' 'sha256-${b64(SCRIPT)}'`);
    expect(csp).toContain(`style-src 'sha256-${b64(STYLE)}'`);
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain('connect-src ws: wss:');
  });

  it('offers the same bytes as a download with their SHA-256, and redirects /verify', async () => {
    const download = await app.inject({ url: '/verify/tambat-verify.html' });
    expect(download.headers['content-disposition']).toBe('attachment; filename="tambat-verify.html"');
    expect(download.body).toBe(HTML);
    const digest = await app.inject({ url: '/verify/tambat-verify.html.sha256' });
    expect(digest.body).toBe(`${createHash('sha256').update(HTML).digest('hex')}  tambat-verify.html\n`);
    const bare = await app.inject({ url: '/verify' });
    expect(bare.statusCode).toBe(301);
    expect(bare.headers.location).toBe('/verify/');
  });

  it('refuses a verifier file without its own policy', () => {
    expect(() => verifierPolicy('<html><script>x</script></html>')).toThrow(/Content-Security-Policy/);
  });
});
