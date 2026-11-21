/**
 * The WizardConnect address scan in the browser: a fake wallet at the session boundary
 * (`window.__tambatWizardSession`, web/keys/anchor-wizard-session.ts) and a fake chain. The wallet gave a new address
 * for every payment, so its only coin sits at receive index 23 and is not in a block yet; the page must walk past the
 * first addresses (gap limit) and accept the unconfirmed coin. An empty wallet gets the count of addresses checked and
 * no address of any kind in the text.
 */
import { en, expect, expectAccessible, expectNoOverflow, ms, routeChain, test } from './fixtures.js';
import { at, deepChain, exact, gapLimit, startWizard } from './wizard-fake.js';

test('finds the coin at receive index 23 past the first addresses, and says it is not in a block yet', async ({ page }) => {
  await routeChain(page, deepChain());
  const option = await startWizard(page, en, '/');
  await expect(option.getByRole('button', exact(en.wizard.sign))).toBeVisible({ timeout: 20_000 });
  await expect(option.getByText(at('receive', 23), { exact: false })).toBeVisible();
  await expect(option.locator('[data-unconfirmed="yes"]')).toHaveText(en.wizard.previewUnconfirmed);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await option.scrollIntoViewIfNeeded();
    await expectNoOverflow(page);
  }
  await expectAccessible(page);
});

test('an empty wallet hears how many addresses were checked, in Malay at 320 px, and is shown no address', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const option = await startWizard(page, ms, '/?lang=ms');
  const text = ms.wizard.noCoins.replace('{count}', String(2 * gapLimit)).replace('{gap}', String(gapLimit));
  const notice = option.getByText(text);
  await expect(notice).toBeVisible({ timeout: 20_000 });
  expect(await option.locator('.notice, [role="alert"], [role="status"]').allTextContents()).not.toContainEqual(
    expect.stringMatching(/(bitcoincash|bchtest):/),
  );
  await expectNoOverflow(page);
});
