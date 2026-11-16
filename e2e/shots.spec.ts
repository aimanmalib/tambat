/** Screenshots of each page for review. Runs only when SHOTS_DIR is set; writes nothing otherwise. */
import { join } from 'node:path';
import { en, expect, fakeExtension, test, vectors } from './fixtures.js';

const dir = process.env.SHOTS_DIR ?? '';
const exact = (name: string) => ({ name, exact: true });

test.skip(dir === '', 'set SHOTS_DIR to take screenshots');

test('screenshots of every page', async ({ page }, info) => {
  const shot = (name: string) => page.screenshot({ path: join(dir, `${info.project.name}-${name}.png`), fullPage: true });
  await fakeExtension(page);
  await page.goto('/');
  await shot('1-home');
  await page.getByRole('button', exact(en.nostr.extension)).click();
  await shot('2-step2');
  await page.getByText(en.bch.paste).click();
  await page.getByLabel(en.bch.addressLabel, { exact: true }).fill(vectors.bch.address.bitcoincash);
  await page.getByLabel(en.bch.signatureLabel, { exact: true }).fill(vectors.bchSignature);
  await page.getByRole('button', exact(en.bch.pasteCheck)).click();
  await page.getByRole('button', exact(en.link.publish)).click();
  await expect(page.getByRole('button', exact(en.link.lookUp))).toBeVisible();
  await shot('3-published');
  await page.getByRole('button', exact(en.link.lookUp)).click();
  await expect(page.locator('.result')).toHaveCount(1);
  await shot('4-lookup');
  await page.getByRole('button', exact(en.lookup.pay)).click();
  await page.getByLabel(en.pay.amount).fill('0.001');
  await expect(page.getByRole('img', exact(en.pay.qr))).toBeVisible();
  await shot('5-pay');
  await page.getByRole('link', exact(en.nav.demo)).click();
  await page.getByRole('button', exact(en.demo.signIn)).click();
  await expect(page.getByTestId('session')).toBeVisible();
  await shot('6-demo');
});
