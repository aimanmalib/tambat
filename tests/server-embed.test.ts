import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../server/app.js';
import { embedPolicy, loaderScript } from '../server/embed.js';
import { config, parseConfig } from '../src/config.js';
import { fakeRelay, keys } from './helpers.js';

const PAGE = '<!doctype html><html><body><main class="embed"></main></body></html>';
const dir = mkdtempSync(join(tmpdir(), 'tambat-embed-route-'));
const page = join(dir, config.embed.page);
mkdirSync(dirname(page), { recursive: true });
writeFileSync(page, PAGE);
writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body>app</body></html>');
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const directive = (csp: string, name: string) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `));

describe('embed routes', () => {
  const app = buildApp({ query: fakeRelay([]), staticDir: dir, verifierFile: '/nonexistent.html' });
  afterAll(() => app.close());

  it('lets other sites frame /embed/<id> with frame-ancestors from config', async () => {
    for (const id of [keys.npub, encodeURIComponent(keys.address)]) {
      const res = await app.inject({ url: `/embed/${id}` });
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe(PAGE);
      const csp = String(res.headers['content-security-policy']);
      expect(directive(csp, 'frame-ancestors')).toBe(`frame-ancestors ${config.embed.frameAncestors.join(' ')}`);
      expect(csp).not.toContain("frame-ancestors 'none'");
      expect(res.headers['cache-control']).toBe('no-cache, no-transform');
    }
  });

  it("keeps frame-ancestors 'none' on every other page", async () => {
    for (const url of ['/', '/lookup', '/embed', '/embed/', '/web/embed.html']) {
      const res = await app.inject({ url });
      expect(res.statusCode, url).toBe(200);
      expect(directive(String(res.headers['content-security-policy']), 'frame-ancestors'), url).toBe("frame-ancestors 'none'");
    }
  });

  it('only changes frame-ancestors from the server policy', () => {
    const strip = (csp: string) => csp.split('; ').filter((d) => !d.startsWith('frame-ancestors')).join('; ');
    const base = Object.entries(config.server.contentSecurityPolicy).map(([n, s]) => `${n} ${s.join(' ')}`).join('; ');
    expect(strip(embedPolicy())).toBe(strip(base));
  });

  it('serves /embed.js, which inserts one sized, titled iframe per script tag', async () => {
    const res = await app.inject({ url: '/embed.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('javascript');
    const inserted: Record<string, unknown>[] = [];
    const script = (id: string | null, lang = '') => {
      const attrs: Record<string, string> = { 'data-lang': lang };
      if (id !== null) attrs['data-tambat-id'] = id;
      return {
        src: 'https://badge.example/embed.js',
        getAttribute: (n: string) => attrs[n] ?? null,
        setAttribute: (n: string, v: string) => (attrs[n] = v),
        nextSibling: null,
        parentNode: { insertBefore: (el: Record<string, unknown>) => inserted.push(el) },
      };
    };
    const tags = [script(keys.npub), script(keys.address, 'ms')];
    const document = {
      querySelectorAll: () => tags,
      createElement: () => ({ style: {} as Record<string, string> }),
    };
    runInNewContext(res.body, { document, URL, encodeURIComponent });
    runInNewContext(res.body, { document, URL, encodeURIComponent }); // a second copy of the script adds nothing
    expect(inserted).toHaveLength(2);
    expect(inserted[0]).toMatchObject({ src: `https://badge.example/embed/${keys.npub}`, width: String(config.embed.width), height: String(config.embed.height) });
    expect(inserted[1]).toMatchObject({ src: `https://badge.example/embed/${encodeURIComponent(keys.address)}?lang=ms` });
    expect(String(inserted[0]?.title)).not.toBe('');
    expect(inserted[1]?.title).not.toBe(inserted[0]?.title);
    expect(loaderScript()).toBe(res.body);
  });
});

describe('embed config', () => {
  const withEmbed = (embed: unknown) => parseConfig({ ...config, embed });
  it('refuses a frame-ancestors list that would block the badge or break the header', () => {
    expect(() => withEmbed({ ...config.embed, frameAncestors: ["'none'"] })).toThrow(/embed.frameAncestors/);
    expect(() => withEmbed({ ...config.embed, frameAncestors: ['https://a.example; script-src *'] })).toThrow(/embed.frameAncestors/);
    expect(() => withEmbed({ ...config.embed, width: 0 })).toThrow(/embed.width/);
    expect(() => withEmbed({ ...config.embed, page: 'embed.js' })).toThrow(/embed.page/);
  });
  it('fits the size the plan allows for a badge', () => {
    expect(config.embed.width).toBeLessThanOrEqual(320);
    expect(config.embed.height).toBeLessThanOrEqual(96);
  });
});
