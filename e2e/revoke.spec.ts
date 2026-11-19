import { config } from '../src/config.js';
import { en, expect, expectAccessible, expectNoOverflow, ms, test } from './fixtures.js';

const exact = (name: string) => ({ name, exact: true });
const accepted = (text: string) => text.replace('{ok}', String(config.nostr.relays.length)).replace('{total}', String(config.nostr.relays.length));
const before = (text: string) => text.split('{')[0] ?? text;

test('the owner moves a link to a new address and look-ups follow', async ({ page }) => {
  test.slow(); // three publishes and four look-ups against the in-memory relays
  await page.goto('/');
  await page.getByRole('button', exact(en.nostr.demo)).click();
  await page.getByRole('button', exact(en.bch.demo)).click();
  await page.getByRole('button', exact(en.link.publish)).click();
  await expect(page.getByText(accepted(en.link.result))).toBeVisible();
  const first = (await page.locator('.facts dd code').first().textContent()) ?? '';
  await page.getByRole('button', exact(en.link.lookUp)).click();
  await expect(page.locator('.result[data-ok="true"]')).toHaveCount(1);
  await expect(page.getByRole('heading', exact(en.owner.title))).toBeVisible();
  await expectAccessible(page);

  // Move: the Link page signs a new demo address and publishes one replacing event.
  await page.getByRole('button', exact(en.owner.move)).click();
  await page.getByRole('button', exact(en.common.change)).last().click();
  await page.getByRole('button', exact(en.bch.demo)).click();
  await expect(page.getByText(before(en.link.moving))).toBeVisible();
  const second = (await page.locator('.facts dd code').first().textContent()) ?? '';
  expect(second).not.toBe(first);
  await page.getByRole('button', exact(en.link.publish)).click();
  await expect(page.getByText(accepted(en.link.result))).toBeVisible();

  await page.goto(`/lookup?q=${encodeURIComponent(first)}`);
  await expect(page.getByText(en.lookup.none)).toBeVisible();
  await page.goto(`/lookup?q=${encodeURIComponent(second)}`);
  await expect(page.locator('.result[data-ok="true"]')).toHaveCount(1);
  // The keys live in this tab only, so after a reload the owner actions are gone.
  await expect(page.getByRole('heading', exact(en.owner.title))).toHaveCount(0);
});

test('revoke from look-up: confirm, publish, then no current link in both directions', async ({ page }) => {
  test.slow();
  await page.goto('/');
  await page.getByRole('button', exact(en.nostr.demo)).click();
  await page.getByRole('button', exact(en.bch.demo)).click();
  await page.getByRole('button', exact(en.link.publish)).click();
  await expect(page.getByText(accepted(en.link.result))).toBeVisible();
  const address = (await page.locator('.facts dd code').first().textContent()) ?? '';
  const npub = (await page.locator('.keybadge__value').first().textContent()) ?? '';
  await page.getByRole('link', exact(en.nav.lookup)).click();
  await page.getByLabel(en.lookup.label).fill(npub);
  await page.getByRole('button', exact(en.lookup.submit)).click();
  await expect(page.locator('.result[data-ok="true"]')).toHaveCount(1);

  await page.getByRole('button', exact(en.owner.revoke)).click();
  await expect(page.getByText(before(en.owner.confirm))).toBeVisible();
  await page.getByRole('button', exact(en.owner.cancel)).click();
  await page.getByRole('button', exact(en.owner.revoke)).click();
  await page.getByRole('button', exact(en.owner.confirmYes)).click();
  await expect(page.getByText(accepted(en.owner.done))).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', exact(en.owner.again)).click();
  await expect(page.getByText(before(en.lookup.noLink))).toBeVisible();
  await expect(page.locator('.result')).toHaveCount(0);

  await page.getByLabel(en.lookup.label).fill(address);
  await page.getByRole('button', exact(en.lookup.submit)).click();
  await expect(page.getByText(en.lookup.none)).toBeVisible();
});

test('in Malay at 320 px the owner actions fit and read in Malay', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/');
  await page.getByLabel(en.lang.label).selectOption('ms');
  await page.getByRole('button', exact(ms.nostr.demo)).click();
  await page.getByRole('button', exact(ms.bch.demo)).click();
  await page.getByRole('button', exact(ms.link.publish)).click();
  await page.getByRole('button', exact(ms.link.lookUp)).click();
  await expect(page.getByRole('button', exact(ms.owner.revoke))).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.getByRole('button', exact(ms.owner.revoke)).click();
  await expect(page.getByText(before(ms.owner.confirm))).toBeVisible();
  await expectNoOverflow(page);
});
