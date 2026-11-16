/**
 * Read-only checks against a deployed site: E2E_BASE_URL=https://... npx playwright test (the config picks this
 * file alone when that variable is set). Uses the real relays and publishes nothing. When E2E_LIVE_LOOKUP holds npubs
 * or addresses (space separated) that have a published binding, the look-up must verify each of them.
 */
import { test as base } from '@playwright/test';
import { en, expect, expectAccessible, expectNoOverflow, ms } from './fixtures.js';

const lookups = (process.env.E2E_LIVE_LOOKUP ?? '').split(/\s+/).filter(Boolean);

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
