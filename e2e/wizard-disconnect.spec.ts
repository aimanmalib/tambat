/**
 * A WizardConnect wallet that disconnects after it connected (docs/decisions/0025-wallet-disconnect.md): the fake
 * wallet (e2e/wizard-fake.ts) ends the session while the page shows the preview, or while it waits for the signature.
 * The page must go back to the Connect button within two seconds and say why, in English and Malay, without overflow
 * on a phone.
 */
import type { Page } from '@playwright/test';
import { en, expect, expectAccessible, expectNoOverflow, ms, routeChain, test } from './fixtures.js';
import { deepChain, exact, startWizard } from './wizard-fake.js';

const endSession = (page: Page) => page.evaluate(() => (window as unknown as { __tambatWizardEnd: () => void }).__tambatWizardEnd());

test('the wallet disconnects at the preview: back to Connect with the reason, within two seconds', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await routeChain(page, deepChain());
  const option = await startWizard(page, en, '/');
  await expect(option.getByRole('button', exact(en.wizard.sign))).toBeVisible({ timeout: 20_000 });
  await endSession(page);
  await expect(option.getByRole('button', exact(en.wizard.start))).toBeVisible({ timeout: 2_000 });
  await expect(option.getByText(en.wizard.disconnected, { exact: true })).toBeVisible({ timeout: 2_000 });
  await expect(option.getByRole('button', exact(en.wizard.sign))).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __tambatWizardClosed?: boolean }).__tambatWizardClosed)).toBe(true);
  await option.scrollIntoViewIfNeeded();
  await expectNoOverflow(page);
  await expectAccessible(page);
});

test('the wallet disconnects while the page waits for the signature: the wait ends, in Malay at 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await routeChain(page, deepChain());
  const option = await startWizard(page, ms, '/?lang=ms');
  await option.getByRole('button', exact(ms.wizard.sign)).click({ timeout: 20_000 });
  await expect(option.getByText(ms.wizard.signing)).toBeVisible();
  await endSession(page);
  await expect(option.getByRole('button', exact(ms.wizard.start))).toBeVisible({ timeout: 2_000 });
  await expect(option.getByText(ms.wizard.disconnected, { exact: true })).toBeVisible({ timeout: 2_000 });
  await expect(option.getByText(ms.wizard.signing)).toHaveCount(0);
  await option.scrollIntoViewIfNeeded();
  await expectNoOverflow(page);
});
