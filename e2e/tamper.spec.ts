/**
 * The tamper demo on a look-up result: each field edit turns exactly its expected named steps red, the real result
 * stays verified, and Reset brings the form back. The edit happens on a local copy; nothing is published.
 */
import type { Page } from '@playwright/test';
import { TAMPER_CATCHES, TAMPER_FIELDS } from '../src/core/tamper.js';
import { VERIFY_STEPS } from '../src/core/binding.js';
import { en, expect, expectAccessible, expectNoOverflow, ms, test } from './fixtures.js';

const exact = (name: string) => ({ name, exact: true });
const accepted = (text: string) => text.replace('{ok}', '3').replace('{total}', '3');

/** Publishes a demo binding and opens its look-up result, in the language already chosen. */
async function lookUpFreshBinding(page: Page, text: typeof en) {
  await page.getByRole('button', exact(text.nostr.demo)).click();
  await page.getByRole('button', exact(text.bch.demo)).click();
  await page.getByRole('button', exact(text.link.publish)).click();
  await expect(page.getByText(accepted(text.link.result))).toBeVisible();
  await page.getByRole('button', exact(text.link.lookUp)).click();
  await expect(page.locator('.result[data-ok="true"]')).toHaveCount(1);
}

test('each tampered field fails its named steps, and Reset restores the form', async ({ page }) => {
  test.slow(); // one publish, then three local re-checks
  await page.goto('/');
  await lookUpFreshBinding(page, en);
  const tamper = page.getByRole('region', exact(en.tamper.title));
  for (const field of TAMPER_FIELDS) {
    await tamper.getByRole('radio', exact(en.tamper.field[field])).check();
    await tamper.getByRole('button', exact(en.tamper.try)).click();
    await expect(tamper).toHaveAttribute('data-tamper', field);
    const failed = await tamper.locator('.check[data-status="fail"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-step')));
    expect(failed).toEqual([...TAMPER_CATCHES[field]]);
    for (const step of VERIFY_STEPS.filter((s) => !TAMPER_CATCHES[field].includes(s))) {
      await expect(tamper.locator(`.check[data-step="${step}"]`)).not.toHaveAttribute('data-status', 'fail');
    }
    await expect(tamper.getByRole('status')).toContainText(en.tamper.caught.split('{')[0] ?? '');
    // The real result above is untouched.
    await expect(page.locator('.result[data-ok="true"] > .badge--ok')).toHaveText(en.lookup.verified);
    if (field === 'tag') await expectAccessible(page);
    await tamper.getByRole('button', exact(en.tamper.reset)).click();
    await expect(tamper).toHaveAttribute('data-tamper', 'none');
    await expect(tamper.locator('.check')).toHaveCount(0);
  }
});

test('in Malay at 320 px the tamper demo fits and reads in Malay', async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/');
  await page.getByLabel(en.lang.label).selectOption('ms');
  await lookUpFreshBinding(page, ms);
  const tamper = page.getByRole('region', exact(ms.tamper.title));
  await tamper.scrollIntoViewIfNeeded();
  await tamper.getByRole('radio', exact(ms.tamper.field.tag)).check();
  await tamper.getByRole('button', exact(ms.tamper.try)).click();
  await expect(tamper.getByRole('status')).toContainText(ms.tamper.caught.split('{')[0] ?? '');
  await expect(tamper.locator('.check[data-step="address_match"]')).toHaveAttribute('data-status', 'fail');
  await expectNoOverflow(page);
  await expectAccessible(page);
});
