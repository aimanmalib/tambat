/**
 * The event banner on the home page: the presentation, the source code and the BCH address are all visible, the banner fits
 * 320 px without sideways scrolling (also after scrolling down), and the deck it links is served by this site.
 */
import { join } from 'node:path';
import config from '../config/tambat.json' with { type: 'json' };
import { en, expect, expectAccessible, expectNoOverflow, ms, test } from './fixtures.js';

/** The rule the banner's `shortAddress` (web/ui/Banner.tsx) follows, restated here: Node cannot load the web modules. */
function shortAddress(address: string): string {
  const body = address.slice(address.indexOf(':') + 1);
  return body.length > 14 ? `${body.slice(0, 6)}…${body.slice(-6)}` : body;
}

const commitUrl = `${config.banner.repoUrl}/commit/${config.banner.firstCommit}`;

test('the banner links the deck, the repository and the address', async ({ page, consoleErrors }, info) => {
  await page.goto('/');
  const banner = page.locator('.banner');
  await expect(banner.locator('[data-banner="deck"]')).toHaveAttribute('href', config.banner.deckUrl);
  await expect(banner.locator('[data-banner="repo"]')).toHaveAttribute('href', config.banner.repoUrl);
  const address = banner.locator('[data-banner="address"]');
  const note = banner.locator('[data-banner="note"]');
  await expect(note).toHaveText(en.banner.note);
  await expect(note).toHaveAttribute('href', commitUrl);
  for (const part of [note, banner.getByRole('link', { name: en.banner.presentation }), banner.getByRole('link', { name: en.banner.source }), address]) {
    await expect(part).toBeVisible();
  }
  // The full address is there for screen readers and on hover; the copy button copies it whole.
  await expect(address.locator('code')).toHaveAttribute('title', config.banner.contactAddress);
  await expect(address.locator('.sr-only')).toHaveText(config.banner.contactAddress);
  // What people see and compare on a phone: the start and the end of the same address, without the prefix.
  await expect(address.locator('code span[aria-hidden="true"]')).toHaveText(shortAddress(config.banner.contactAddress));
  await expect(address.getByRole('button', { name: `${en.banner.copy}: ${en.banner.address}` })).toBeVisible();
  await expectAccessible(page);

  for (const width of [info.project.name === 'chromium' ? 1280 : 390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expectNoOverflow(page);
    for (const part of [address, note]) {
      const box = await part.boundingBox();
      expect(box && box.x + box.width).toBeLessThanOrEqual(width);
    }
  }
  const dir = process.env.SHOTS_DIR ?? '';
  if (dir) {
    await page.evaluate(() => window.scrollTo(0, 0));
    const before = consoleErrors.length;
    await page.screenshot({ path: join(dir, `i10-${info.project.name}-320.png`), caret: 'initial' });
    await page.waitForTimeout(300);
    // WebKit injects a style into the page while taking a screenshot, which the CSP refuses; that is the tool, not the page.
    consoleErrors.push(...consoleErrors.splice(before).filter((e) => !e.startsWith('Refused to apply a stylesheet')));
  }
});

test('the judges page keeps one line of links and leaves the address to the home page', async ({ page }) => {
  await page.goto('/judges');
  await expect(page.locator('.banner [data-banner="deck"]')).toBeVisible();
  await expect(page.locator('.banner [data-banner="address"]')).toHaveCount(0);
  await expect(page.locator('.banner').getByRole('link', { name: en.banner.judges })).toHaveCount(0);
  await expect(page.locator('.banner [data-banner="note"]')).toHaveAttribute('href', commitUrl);
  await expect(page.locator('.banner [data-banner="note"]')).toBeVisible();
});

test('the new project note is in Malay too and fits 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/?lang=ms');
  const note = page.locator('.banner [data-banner="note"]');
  await expect(note).toHaveText(ms.banner.note);
  await expect(note).toHaveAttribute('href', commitUrl);
  await expectNoOverflow(page);
});

test('the deck is served as a PDF', async ({ request }) => {
  const res = await request.get('/deck.pdf');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('application/pdf');
  expect((await res.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-');
});
