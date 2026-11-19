/**
 * The snippets Look up offers under "Embed this badge": each must point at a route the server answers, with the
 * badge page frameable by other sites, and carry the id, language and size from config.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import en from '../lang/en.json' with { type: 'json' };
import { buildApp } from '../server/app.js';
import { config } from '../src/config.js';
import { embedSnippets } from '../src/core/embed-code.js';
import { fakeRelay, keys } from './helpers.js';

const ORIGIN = 'https://badge.example';
const dir = mkdtempSync(join(tmpdir(), 'tambat-embed-code-'));
const page = join(dir, config.embed.page);
mkdirSync(dirname(page), { recursive: true });
writeFileSync(page, '<!doctype html><html><body><main class="embed"></main></body></html>');
writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body>app</body></html>');
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const attr = (html: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(html)?.[1];

describe('embed snippets', () => {
  const code = embedSnippets(`${ORIGIN}/lookup?q=x`, keys.npub, 'ms', config.embed, en.embed.title);

  it('carry the origin, id, language and configured size', () => {
    expect(attr(code.script, 'src')).toBe(`${ORIGIN}/embed.js`);
    expect(attr(code.script, 'data-tambat-id')).toBe(keys.npub);
    expect(attr(code.script, 'data-lang')).toBe('ms');
    expect(attr(code.iframe, 'src')).toBe(`${ORIGIN}/embed/${keys.npub}?lang=ms`);
    expect(attr(code.iframe, 'width')).toBe(String(config.embed.width));
    expect(attr(code.iframe, 'height')).toBe(String(config.embed.height));
    expect(attr(code.iframe, 'title')).toBe(en.embed.title);
  });

  it('point at routes the server answers, with the badge frameable by other sites', { timeout: 30_000 }, async () => {
    const app = buildApp({ query: fakeRelay([]), staticDir: dir, verifierFile: '/nonexistent.html' });
    try {
      const script = await app.inject({ url: new URL(attr(code.script, 'src') ?? '').pathname });
      expect(script.statusCode).toBe(200);
      expect(String(script.headers['content-type'])).toContain('javascript');
      const frameUrl = new URL(attr(code.iframe, 'src') ?? '');
      const frame = await app.inject({ url: frameUrl.pathname + frameUrl.search });
      expect(frame.statusCode).toBe(200);
      expect(String(frame.headers['content-security-policy'])).toContain(`frame-ancestors ${config.embed.frameAncestors.join(' ')}`);
    } finally {
      await app.close();
    }
  });

  it('escape values that would break out of an attribute', () => {
    const odd = embedSnippets(ORIGIN, 'a"b<c', 'en', config.embed, 'Say "hi" & <go>');
    expect(odd.iframe).toContain('title="Say &quot;hi&quot; &amp; &lt;go&gt;"');
    expect(odd.iframe).toContain(`src="${ORIGIN}/embed/a%22b%3Cc?lang=en"`);
    expect(odd.script).toContain('data-tambat-id="a&quot;b&lt;c"');
    expect(odd.script).not.toMatch(/data-tambat-id="a"/);
  });
});
