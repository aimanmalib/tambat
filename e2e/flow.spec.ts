import { en, expect, expectAccessible, expectNoOverflow, fakeExtension, ms, otherAddress, test, vectors } from './fixtures.js';

const address = vectors.bch.address.bitcoincash;
const exact = (name: string) => ({ name, exact: true });

test('link with an extension and a pasted wallet signature, then look up, pay and sign in', async ({ page }) => {
  await fakeExtension(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.app.headline);
  await expectAccessible(page);

  await page.getByRole('button', exact(en.nostr.extension)).click();
  await expect(page.locator('.keybadge__value')).toHaveText(vectors.nostr.npub);
  await page.getByText(en.bch.paste).click();
  await page.getByLabel(en.bch.addressLabel, { exact: true }).fill(address);
  await page.getByLabel(en.bch.signatureLabel, { exact: true }).fill(vectors.bchSignature);
  await page.getByRole('button', exact(en.bch.pasteCheck)).click();

  await page.getByRole('button', exact(en.link.publish)).click();
  await expect(page.getByText(en.link.result.replace('{ok}', '3').replace('{total}', '3'))).toBeVisible();
  await expect(page.locator('.check[data-status="fail"]')).toHaveCount(0);
  await expect(page.locator('.check[data-status="pass"]')).toHaveCount(9);
  await expectAccessible(page);

  await page.getByRole('button', exact(en.link.lookUp)).click();
  await expect(page).toHaveURL(/\/lookup\?q=/);
  await expect(page.locator('.result[data-ok="true"]')).toHaveCount(1);
  await expect(page.locator('.result').getByText(vectors.nostr.npub)).toBeVisible();
  await page.getByText(en.lookup.did).click();
  await expect(page.locator('pre.json').last()).toContainText(`did:nostr:${vectors.nostr.pubkey}`);
  await expectAccessible(page);

  await page.getByRole('button', exact(en.lookup.pay)).click();
  await expect(page.getByText(address).first()).toBeVisible();
  await page.getByLabel(en.pay.amount).fill('0.001');
  await expect(page.getByRole('link', exact(en.pay.open))).toHaveAttribute('href', `${address}?amount=0.001`);
  await expect(page.getByRole('img', exact(en.pay.qr))).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('link', exact(en.nav.demo)).click();
  await page.getByRole('button', exact(en.demo.signIn)).click();
  const session = page.getByTestId('session');
  await expect(session).toContainText(address);
  await expect(session).toContainText(vectors.nostr.npub);
  await expectAccessible(page);
  await page.getByRole('button', exact(en.demo.signOut)).click();
  await expect(page.getByRole('button', exact(en.demo.signIn))).toBeVisible();
});

test('demo keys link, then the demo app signs in with both keys', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', exact(en.nostr.demo)).click();
  await expect(page.getByText(en.common.demoBadge)).toBeVisible();
  await page.getByRole('button', exact(en.bch.demo)).click();
  await page.getByRole('button', exact(en.link.publish)).click();
  await expect(page.getByText(en.link.result.replace('{ok}', '3').replace('{total}', '3'))).toBeVisible();
  const demoAddress = (await page.locator('.facts dd code').first().textContent()) ?? '';
  expect(demoAddress).toMatch(/^bitcoincash:q/);

  await page.getByRole('button', exact(en.link.signIn)).click();
  await page.getByLabel(en.demo.alsoBch).check();
  await page.getByRole('button', exact(en.demo.signIn)).click();
  const session = page.getByTestId('session');
  await expect(session).toContainText(demoAddress);
  await expect(session).toContainText(en.demo.bchSigned);
});

test('a wrong signature is refused before anything is published', async ({ page }) => {
  await fakeExtension(page);
  await page.goto('/');
  await page.getByRole('button', exact(en.nostr.extension)).click();
  await page.getByText(en.bch.paste).click();
  await page.getByLabel(en.bch.addressLabel, { exact: true }).fill(otherAddress);
  await page.getByLabel(en.bch.signatureLabel, { exact: true }).fill(vectors.bchSignature);
  await page.getByRole('button', exact(en.bch.pasteCheck)).click();
  await expect(page.getByRole('alert')).toContainText('signature was not made by the key of');
  await expect(page.getByRole('button', exact(en.link.publish))).toHaveCount(0);
});

test('Malay text and no sideways scroll at 320 px on every page', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  await page.getByLabel(en.lang.label).selectOption('ms');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ms.app.headline);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ms');
  for (const path of ['/', '/lookup?q=' + encodeURIComponent(vectors.nostr.npub), '/demo', '/pay']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 400));
    await expectNoOverflow(page);
  }
  await page.goto('/lookup');
  await page.getByLabel(ms.lookup.label).fill('not-a-key');
  await page.getByRole('button', exact(ms.lookup.submit)).click();
  await expect(page.getByRole('alert')).toHaveText(ms.lookup.inputError);
});
