/**
 * Receipts on the pay page, against this spec's own relay and a fake chain. The payer (the browser extension key of
 * the test phrase) is bound to its address and pays a payee bound to another address. Publishing a receipt for that
 * payment shows "from a bound address"; a receipt by an unbound key for a stranger's payment shows "payer not
 * proven"; a transaction with no receipt says so.
 */
import { secp256k1 } from '@bitauth/libauth';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { addressFromPublicKey } from '../src/core/cashaddr.js';
import { toNpub } from '../src/core/nostr.js';
import { bindingFromKeys } from '../src/core/paytaca.js';
import { createReceiptEvent } from '../src/core/receipt.js';
import type { FakeChain } from '../tests/fake-fulcrum.js';
import { transaction } from '../tests/receipt-chain.js';
import { routeToRelay, startFakeRelay } from './fake-relay.js';
import { en, expect, expectAccessible, expectNoOverflow, fakeExtension, ms, phraseKeys, routeChain, test } from './fixtures.js';
import { E2E } from './ports.js';

const RECEIPT_RELAY_PORT = E2E.relayPort + 40;
const now = Math.floor(Date.now() / 1000);
const payeeBch = generateSecretKey();
const payeeNostr = generateSecretKey();
const payeeAddress = addressFromPublicKey(secp256k1.derivePublicKeyCompressed(payeeBch) as Uint8Array, 'bitcoincash');
const payeePubkey = getPublicKey(payeeNostr);
const payee = { bchPrivateKey: payeeBch, address: payeeAddress, nostrSecretKey: payeeNostr, npub: toNpub(payeePubkey) };
const strangerAddress = addressFromPublicKey(secp256k1.derivePublicKeyCompressed(generateSecretKey()) as Uint8Array, 'bitcoincash');

const funding = transaction([{ txid: '55'.repeat(32), vout: 0 }], [{ address: phraseKeys.address, sats: 50_000 }]);
const payment = transaction([{ txid: funding.txid, vout: 0 }], [{ address: payeeAddress, sats: 40_000 }]);
const strangerFunding = transaction([{ txid: '66'.repeat(32), vout: 2 }], [{ address: strangerAddress, sats: 12_000 }]);
const strangerPayment = transaction([{ txid: strangerFunding.txid, vout: 0 }], [{ address: payeeAddress, sats: 11_000 }]);
const chain: FakeChain = { history: { all: [funding, payment, strangerFunding, strangerPayment] }, headers: {} };
const claimed = finalizeEvent(createReceiptEvent({ payee: payeePubkey, txid: strangerPayment.txid, createdAt: now - 10 }), generateSecretKey());

let relay: ReturnType<typeof startFakeRelay>;
test.beforeAll(() => {
  relay = startFakeRelay(RECEIPT_RELAY_PORT);
  for (const e of [bindingFromKeys(phraseKeys, now - 60), bindingFromKeys(payee, now - 60), claimed]) relay.events.set(e.id, e);
});
test.afterAll(() => relay.close());

async function openPay(page: Page) {
  await fakeExtension(page);
  await routeToRelay(page, RECEIPT_RELAY_PORT);
  await routeChain(page, chain);
  await page.goto(`/pay?npub=${payee.npub}`);
  await expect(page.locator('.value__text', { hasText: payeeAddress }).first()).toBeVisible();
}

const exact = (name: string) => ({ name, exact: true });

test('a receipt for a payment from the bound address shows "from a bound address"', async ({ page, consoleErrors }) => {
  await openPay(page);
  const panel = page.locator('.receipts');
  await panel.getByLabel(en.receipt.txid).fill(payment.txid);
  await expect(panel.getByRole('button', exact(en.receipt.publish))).toBeDisabled();
  await panel.getByRole('button', exact(en.nostr.extension)).click();
  await panel.getByRole('button', exact(en.receipt.publish)).click();
  const line = panel.locator('.receipt');
  await expect(line).toHaveCount(1);
  await expect(line).toHaveAttribute('data-payer', 'from_bound');
  await expect(line).toContainText(en.receipt.paysPayee);
  await expect(line).toContainText(phraseKeys.npub);
  await expect(panel.locator('.relays li[data-ok="true"]')).not.toHaveCount(0);
  await expectNoOverflow(page);
  await expectAccessible(page);
  if (process.env.SHOTS_DIR) {
    const known = consoleErrors.length;
    await panel.screenshot({ path: join(process.env.SHOTS_DIR, `receipt-${test.info().project.name}.png`), caret: 'initial' });
    await page.waitForTimeout(300);
    // WebKit injects a style into the page while it takes the picture; the page's CSP refuses it, as it should.
    const later = consoleErrors.splice(known);
    consoleErrors.push(...later.filter((e) => !e.startsWith('Refused to apply a stylesheet')));
  }
  await page.setViewportSize({ width: 320, height: 700 });
  await expectNoOverflow(page);
});

test('a receipt for coins from an unbound address says "payer not proven"; a transaction with none says so', async ({ page }) => {
  await openPay(page);
  const panel = page.locator('.receipts');
  await panel.getByLabel(en.receipt.txid).fill(strangerPayment.txid);
  await panel.getByRole('button', exact(en.receipt.check)).click();
  const line = panel.locator('.receipt');
  await expect(line).toHaveAttribute('data-payer', 'not_proven');
  await expect(line).toContainText(en.receipt.notProven);
  await expect(line).toContainText(en.receipt.chain.found);
  await expectNoOverflow(page);

  await panel.getByLabel(en.receipt.txid).fill('ab'.repeat(32));
  await panel.getByRole('button', exact(en.receipt.check)).click();
  await expect(panel.getByText(en.receipt.none)).toBeVisible();

  await page.getByLabel(en.lang.label).selectOption('ms');
  await expect(page.locator('.receipts h2')).toHaveText(ms.receipt.title);
});
