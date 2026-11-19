/**
 * The WalletConnect pairing link on a phone. A phone cannot scan the QR code on its own screen, so the pairing link is
 * shown as text with a copy button, above the QR code on a narrow screen, with the steps for pasting it into Paytaca.
 * The WalletConnect client is replaced at the library boundary by a fake wallet that only hands out a pairing link.
 */
import type { Page } from '@playwright/test';
import { en, expect, expectAccessible, expectNoOverflow, ms, test } from './fixtures.js';

const exact = (name: string) => ({ name, exact: true });
/** A made-up pairing link with low-entropy filler, so it cannot be mistaken for a real topic or key. */
const pairingUri = `wc:${'ab'.repeat(32)}@2?relay-protocol=irn&symKey=${'cd'.repeat(32)}`;
/** The narrow-screen breakpoint in web/styles.css (40rem at the default 16px). */
const narrow = 640;

/** A fake WalletConnect client: `connect` returns the pairing link and the wallet never approves. */
async function fakePairing(page: Page) {
  await page.addInitScript((uri: string) => {
    const w = window as unknown as Record<string, unknown>;
    // WebKit gives Playwright no clipboard read permission, so the text written is also kept for the test to read.
    const clipboard = navigator.clipboard;
    const write = clipboard.writeText.bind(clipboard);
    clipboard.writeText = async (text: string) => {
      w.__copied = text;
      return write(text);
    };
    w.__tambatSignClient = {
      init: async () => ({
        connect: async () => ({ uri, approval: () => new Promise(() => undefined) }),
        request: async () => {
          throw new Error('not paired');
        },
      }),
    };
  }, pairingUri);
}

async function readClipboard(page: Page, chromium: boolean): Promise<string> {
  if (chromium) return page.evaluate(() => navigator.clipboard.readText());
  return page.evaluate(() => String((window as unknown as { __copied?: string }).__copied ?? ''));
}

async function checkPairing(page: Page, t: typeof en, chromium: boolean) {
  const phone = page.locator('[data-pairing="phone"]');
  await expect(phone).toBeVisible();
  await expect(phone.locator('.value__label')).toHaveText(t.bch.wcLink);
  await expect(phone.locator('.value__text')).toHaveText(pairingUri);
  await expect(phone.locator('.pairing__steps li')).toHaveText(Object.values(t.bch.wcPhoneSteps));

  const qr = page.getByRole('img', exact(t.bch.wc));
  const [linkBox, qrBox] = [await phone.boundingBox(), await qr.boundingBox()];
  if (!linkBox || !qrBox) throw new Error('pairing link or QR code has no box');
  const width = page.viewportSize()?.width ?? 0;
  // Above the QR code on a narrow screen, below it on a wide one.
  if (width <= narrow) expect(linkBox.y + linkBox.height).toBeLessThanOrEqual(qrBox.y);
  else expect(linkBox.y).toBeGreaterThanOrEqual(qrBox.y + qrBox.height);

  await phone.getByRole('button', exact(`${t.common.copy}: ${t.bch.wcLink}`)).click();
  await expect(phone.getByText(t.common.copied, { exact: true })).toBeVisible();
  expect(await readClipboard(page, chromium)).toBe(pairingUri);

  for (const w of [320, 390]) {
    await page.setViewportSize({ width: w, height: 800 });
    await phone.scrollIntoViewIfNeeded();
    await expectNoOverflow(page);
    const fits = await phone.evaluate((el) => el.scrollWidth <= el.clientWidth);
    expect(fits).toBe(true);
  }
  await expectAccessible(page);
}

test('Link shows the pairing link as copyable text, above the QR code on a phone', async ({ page, context }, info) => {
  const chromium = info.project.name === 'chromium';
  if (chromium) await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await fakePairing(page);
  await page.goto('/');
  await page.getByRole('button', exact(en.nostr.demo)).click();
  await page.getByRole('button', exact(en.bch.wcStart)).click();
  await expect(page.getByText(en.bch.wcWaiting)).toBeVisible();
  await checkPairing(page, en, chromium);
});

test('the demo sign-in shows the same pairing link and steps in Malay', async ({ page, context }, info) => {
  const chromium = info.project.name === 'chromium';
  if (chromium) await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await fakePairing(page);
  await page.goto('/demo?lang=ms');
  await page.getByRole('button', exact(ms.bch.wcStart)).click();
  await expect(page.getByText(ms.bch.wcWaiting)).toBeVisible();
  await checkPairing(page, ms, chromium);
});

test('/judges links the phone pairing steps in the wallet guide', async ({ page }) => {
  await page.goto('/judges');
  const link = page.locator('[data-req="auth"] a', { hasText: en.judges.link.phone });
  await expect(link).toHaveAttribute('href', /\/docs\/PAYTACA\.md#on-an-iphone$/);
});
