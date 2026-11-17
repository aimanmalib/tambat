/**
 * Read-only checks against a deployed site: E2E_BASE_URL=https://... npx playwright test (the config picks this
 * file alone when that variable is set). Uses the real relays and publishes nothing. When E2E_LIVE_LOOKUP holds npubs
 * or addresses (space separated) that have a published binding, the look-up must verify each of them. When
 * E2E_LIVE_REVOKED holds npubs and addresses of a binding that was revoked, the page must show no current link for each.
 */
import { test as base } from '@playwright/test';
import { npubEncode } from 'nostr-tools/nip19';
import siteConfig from '../config/tambat.json' with { type: 'json' };
import { en, expect, expectAccessible, expectNoOverflow, ms } from './fixtures.js';

const list = (value: string | undefined) => (value ?? '').split(/\s+/).filter(Boolean);
const lookups = list(process.env.E2E_LIVE_LOOKUP);
const revoked = list(process.env.E2E_LIVE_REVOKED);

const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (msg) => {
        // Asking for the session before signing in answers 401 by design; browsers log that as a failed load.
        // Public relays sometimes refuse a connection; the app reports that per relay, the browser also logs it.
        const relayRefused = /^WebSocket connection to 'wss:\/\//.test(msg.text());
        if (msg.type() === 'error' && !relayRefused && !msg.location().url.endsWith('/api/rp/session')) errors.push(msg.text());
      });
      await use(errors);
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
});

test('health, headers and the home page in both languages', async ({ page, request }) => {
  expect((await request.get('/healthz')).status()).toBe(200);
  const res = await page.goto('/');
  const headers = res?.headers() ?? {};
  expect(headers['content-security-policy']).toContain("script-src 'self'");
  expect(headers['cache-control']).toContain('no-transform');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.app.headline);
  await expectAccessible(page);
  await page.getByLabel(en.lang.label).selectOption('ms');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ms.app.headline);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.mouse.move(10, 10);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expectNoOverflow(page);
});

test('the demo app and the look-up page load', async ({ page }) => {
  await page.goto('/demo');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.demo.title);
  await expect(page.getByRole('heading', { name: en.nostr.title })).toBeVisible();
  await page.goto('/lookup');
  await expect(page.getByRole('heading', { name: en.lookup.title })).toBeVisible();
  await expectAccessible(page);
});

test('a published binding verifies from the real relays', async ({ page }) => {
  test.skip(lookups.length === 0, 'set E2E_LIVE_LOOKUP to npubs or addresses with a published binding');
  for (const lookup of lookups) {
    await page.goto(`/lookup?q=${encodeURIComponent(lookup)}`);
    await expect(page.locator('.result[data-ok="true"]').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.result[data-ok="false"]')).toHaveCount(0);
  }
});

test('a revoked binding shows no current link from either direction', async ({ page }) => {
  test.skip(revoked.length === 0, 'set E2E_LIVE_REVOKED to the npub and addresses of a revoked binding');
  for (const lookup of revoked) {
    await page.goto(`/lookup?q=${encodeURIComponent(lookup)}`);
    const expected = lookup.startsWith('npub') ? (en.lookup.noLink.split('{')[0] ?? '') : en.lookup.none;
    await expect(page.getByText(expected)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.result')).toHaveCount(0);
  }
});

test('the one-file verifier is served whole and verifies a binding from the real relays', async ({ page, request }) => {
  const res = await request.get('/verify/');
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html.replace(/(<(script|style)\b[^>]*>)[\s\S]*?<\/\2>/g, '$1</$2>')).not.toMatch(/\ssrc=/);
  expect(res.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  const digest = await (await request.get('/verify/tambat-verify.html.sha256')).text();
  expect(digest).toMatch(/^[0-9a-f]{64} {2}tambat-verify\.html\n$/);

  const off: string[] = [];
  page.on('request', (r) => {
    if (!r.url().endsWith('/verify/')) off.push(r.url());
  });
  await page.goto('/verify/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.verifier.title);
  await expectAccessible(page);
  const first = lookups[0];
  if (first) {
    await page.getByLabel(en.verifier.inputLabel, { exact: true }).fill(first);
    await page.getByRole('button', { name: en.verifier.submit, exact: true }).click();
    await expect(page.locator('.result[data-ok="true"]').first()).toBeVisible({ timeout: 20_000 });
  }
  expect(off).toEqual([]);
});

test('the demo NIP-05 name is served and pays to its verified address from the real relays', async ({ page, request, baseURL }) => {
  const [name, key] = Object.entries(siteConfig.nip05.names as Record<string, string>)[0] ?? ['', ''];
  const res = await request.get(`/.well-known/nostr.json?name=${name}`);
  expect(res.headers()['access-control-allow-origin']).toBe('*');
  expect(await res.json()).toEqual({ names: { [name]: key } });

  const host = new URL(baseURL ?? '').hostname;
  await page.goto('/pay');
  await page.getByLabel(en.pay.label).fill(`${name}@${host}`);
  await page.getByRole('button', { name: en.pay.find, exact: true }).click();
  await expect(page.locator('.notice', { hasText: `${name}@${host}` })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('img', { name: en.pay.qr, exact: true })).toBeVisible();
});

test('the badge for the demo identity may be framed and verifies from the real relays; other pages may not', async ({ page, request }) => {
  const key = Object.values(siteConfig.nip05.names as Record<string, string>)[0] ?? '';
  const npub = npubEncode(key);
  const frameAncestors = (csp: string | undefined) => (csp ?? '').split(';').map((d) => d.trim()).find((d) => d.startsWith('frame-ancestors'));
  expect(frameAncestors((await request.get(`/embed/${npub}`)).headers()['content-security-policy'])).toBe(
    `frame-ancestors ${siteConfig.embed.frameAncestors.join(' ')}`,
  );
  expect(frameAncestors((await request.get('/')).headers()['content-security-policy'])).toBe("frame-ancestors 'none'");
  const script = await request.get('/embed.js');
  expect(script.status()).toBe(200);
  expect(await script.text()).toContain('data-tambat-id');

  await page.goto(`/embed/${npub}?lang=ms`);
  await expect(page.locator('.embed[data-state="verified"] .embed__state')).toHaveText(ms.embed.verified, { timeout: 20_000 });
  await expect(page.locator('.embed__detail')).toContainText(npub.slice(0, 10));
});
