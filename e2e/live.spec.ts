/**
 * Read-only checks against a deployed site: E2E_BASE_URL=https://... npx playwright test (the config picks this
 * file alone when that variable is set). Uses the real relays and publishes nothing. When E2E_LIVE_LOOKUP holds npubs
 * or addresses (space separated) that have a published binding, the look-up must verify each of them. When
 * E2E_LIVE_REVOKED holds npubs and addresses of a binding that was revoked, the page must show no current link for each.
 */
import { test as base } from '@playwright/test';
import { npubEncode } from 'nostr-tools/nip19';
import siteConfig from '../config/tambat.json' with { type: 'json' };
import { PAGES, visit, watchPolicy } from './csp.js';
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
        // Public relays sometimes refuse a connection; the app reports that per relay, the browser also logs it.
        const relayRefused = /^WebSocket connection to 'wss:\/\//.test(msg.text());
        if (msg.type() === 'error' && !relayRefused) errors.push(msg.text());
      });
      await use(errors);
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
});

test('the home hero checks the real Paytaca binding on the live relays', async ({ page }) => {
  await page.goto('/');
  const hero = page.locator('[data-hero]');
  await expect(hero).toHaveAttribute('data-state', 'verified', { timeout: 30_000 });
  const steps = await hero.locator('[data-step]').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-step')}=${e.getAttribute('data-status')}`));
  expect(steps.slice(0, 4)).toEqual(['relay=pass', 'nostr_sig=pass', 'bch_sig=pass', 'address_match=pass']);
  // The chain read is extra: it may still be open or unreadable, but it never shows a mark it did not earn.
  expect(steps[4]).toMatch(/^anchor=(pass|skip|wait)$/);
  const card = await page.locator('.herocard').evaluate((el) => el.getBoundingClientRect().bottom);
  expect(card).toBeLessThanOrEqual(await page.evaluate(() => window.innerHeight));
});

test('health, headers and the home page in both languages', async ({ page, request }) => {
  expect((await request.get('/healthz')).status()).toBe(200);
  const res = await page.goto('/');
  const headers = res?.headers() ?? {};
  expect(headers['content-security-policy']).toContain("script-src 'self'");
  expect(headers['cache-control']).toContain('no-transform');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.hero.line);
  await expectAccessible(page);
  await page.getByLabel(en.lang.label).selectOption('ms');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ms.hero.line);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.mouse.move(10, 10);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expectNoOverflow(page);
});

test('no page of the deployed site breaks its content security policy', async ({ page }) => {
  const violations = await watchPolicy(page);
  const key = Object.values(siteConfig.nip05.names as Record<string, string>)[0] ?? '';
  for (const path of [...PAGES, `/embed/${npubEncode(key)}`]) await visit(page, path, 2000);
  expect(violations).toEqual([]);
});

test('the demo app and the look-up page load', async ({ page, baseURL }) => {
  const refused: string[] = [];
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().startsWith(baseURL ?? '')) refused.push(`${r.status()} ${r.url()}`);
  });
  await page.goto('/demo', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.demo.title);
  await expect(page.getByRole('heading', { name: en.demo.nostrTitle })).toBeVisible();
  await expect(page.getByTestId('session')).toHaveCount(0);
  expect(refused).toEqual([]);
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
  // The anchor and attestation panels above the tamper demo load from the chain and the relays after the result shows;
  // wait for them so the page does not move under the click (WebKit then clicks where the radio used to be).
  await expect(page.locator('.anchor[data-anchor="checking"]')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('.attest[data-attest="checking"]')).toHaveCount(0, { timeout: 30_000 });
  // Tampering edits a local copy only: the edited signature is caught and the real result stays verified.
  const tamper = page.getByRole('region', { name: en.tamper.title, exact: true }).first();
  await tamper.getByRole('radio', { name: en.tamper.field.sig, exact: true }).check();
  await tamper.getByRole('button', { name: en.tamper.try, exact: true }).click();
  await expect(tamper.locator('.check[data-status="fail"]')).toHaveCount(1);
  await expect(tamper.locator('.check[data-step="nostr_sig"]')).toHaveAttribute('data-status', 'fail');
  await expect(page.locator('.result[data-ok="false"]')).toHaveCount(0);
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
  await expect(page.getByRole('img', { name: en.pay.qr, exact: true })).toBeVisible({ timeout: 20_000 });
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

test('the wall checks the newest bindings from the real relays and lists only verified ones', async ({ page }) => {
  await page.goto('/wall');
  const hidden = page.locator('.wall__hidden');
  // The wall pages every real relay back before it shows; on 2026-11-20 that took 29 to 35 s on this host under load.
  await expect(hidden).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  const cards = page.locator('.wall__card');
  const shown = await cards.count();
  if (shown === 0) await expect(page.getByText(en.wall.empty)).toBeVisible();
  await expect(cards.locator('.badge--ok')).toHaveCount(shown);
  expect(shown).toBeLessThanOrEqual(siteConfig.wall.limit);
  await expectNoOverflow(page);
});

test('the judges page verifies the demo identity from the real relays on one screen', async ({ page }) => {
  await page.goto('/judges');
  const live = page.locator('.jpanel--live');
  await expect(live).toHaveAttribute('data-state', 'verified', { timeout: 20_000 });
  await expect(live.locator('.chip:not([data-status="pass"])')).toHaveCount(0);
  await expect(page.locator(`a[data-event="${siteConfig.judges.paytaca.eventId}"]`)).toBeVisible();
  const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollHeight, inner: window.innerHeight }));
  expect(size.scroll).toBeLessThanOrEqual(size.inner);
  await expectNoOverflow(page);
  await expectAccessible(page);
});

test('the banner on the home and judges pages links the deck, and the deck is a PDF', async ({ page, request }) => {
  const deckUrl = siteConfig.banner.deckUrl;
  for (const path of ['/', '/judges']) {
    await page.goto(path);
    const deck = page.locator('.banner [data-banner="deck"]');
    await expect(deck).toBeVisible();
    await expect(deck).toHaveAttribute('href', deckUrl);
    await expect(deck).toHaveText(en.banner.presentation);
  }
  const res = await request.get(deckUrl);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('application/pdf');
  expect((await res.body()).subarray(0, 5).toString()).toBe('%PDF-');
});
