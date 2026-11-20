/**
 * The WizardConnect option on Link: pressing the button loads the library, opens a session on the (fake) relay and shows
 * the `wiz://` pairing link as a QR code that copies the link when pressed, and as text with a copy button. No wallet
 * answers here; signing and the transaction checks are covered by tests/anchor-wizard.test.ts.
 */
import type { Page } from '@playwright/test';
import { en, expect, expectAccessible, expectNoOverflow, ms, test } from './fixtures.js';

const exact = (name: string) => ({ name, exact: true });

/** WebKit gives Playwright no clipboard read permission, so the text written is also kept for the test to read. */
async function keepCopies(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const clipboard = navigator.clipboard;
    const write = clipboard.writeText.bind(clipboard);
    clipboard.writeText = async (text: string) => {
      w.__copied = text;
      return write(text).catch(() => undefined);
    };
  });
}

const copied = (page: Page) => page.evaluate(() => String((window as unknown as { __copied?: string }).__copied ?? ''));

async function openPairing(page: Page, t: typeof en, path: string) {
  await keepCopies(page);
  await page.goto(path);
  await page.getByRole('button', exact(t.nostr.demo)).click();
  const option = page.locator('[data-option="wizardconnect"]');
  await expect(option.getByRole('heading', exact(t.wizard.title))).toBeVisible();
  await expect(option.getByText(t.wizard.untested, { exact: false })).toBeVisible();
  await option.getByRole('button', exact(t.wizard.start)).click();
  const pairing = option.locator('[data-pairing="wizard"]');
  await expect(pairing).toBeVisible({ timeout: 15_000 });
  return { option, pairing };
}

test('WizardConnect shows a pairing QR code that copies the link, and the link as text', async ({ page }) => {
  const { pairing } = await openPairing(page, en, '/');
  await expect(pairing.getByText(en.wizard.waiting)).toBeVisible();
  const link = (await pairing.locator('.value__text').textContent()) ?? '';
  expect(link).toMatch(/^wiz:\/\/[^\s]*\?p=[a-z0-9]+&s=[a-z0-9]+/);

  const qr = pairing.getByRole('button', exact(`${en.common.copy}: ${en.wizard.qr}`));
  await expect(qr.getByRole('img', exact(en.wizard.qr))).toBeVisible();
  await qr.click();
  await expect(pairing.locator('.wizard__copied')).toHaveText(en.common.copied);
  expect(await copied(page)).toBe(link);

  await page.evaluate(() => ((window as unknown as { __copied?: string }).__copied = ''));
  await pairing.locator('.value').getByRole('button', exact(`${en.common.copy}: ${en.wizard.link}`)).click();
  await expect.poll(() => copied(page)).toBe(link);

  // The link text sits below the QR code at every width.
  const [qrBox, linkBox] = [await qr.boundingBox(), await pairing.locator('.value').boundingBox()];
  if (!qrBox || !linkBox) throw new Error('QR code or link has no box');
  expect(linkBox.y).toBeGreaterThanOrEqual(qrBox.y + qrBox.height);

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await pairing.scrollIntoViewIfNeeded();
    await expectNoOverflow(page);
    expect(await pairing.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await expectAccessible(page);
});

test('the WizardConnect option reads in Malay at 320 px, with the library source and licence linked', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const { option, pairing } = await openPairing(page, ms, '/?lang=ms');
  await expect(pairing.getByText(ms.wizard.qrHint)).toBeVisible();
  await expect(option.getByRole('link', exact(ms.wizard.source))).toHaveAttribute('href', /^https:\/\//);
  await expect(option.getByRole('link', exact(ms.wizard.licenseLink))).toHaveAttribute('href', /lgpl/);
  await expectNoOverflow(page);
});
