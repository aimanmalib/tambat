/**
 * Chain first (docs/decisions/0013-revoke-by-transaction.md): the Pay page reads the address's BCH commitments before it
 * shows a payment link, and refuses an address the chain revoked or gave to another key; the look-up page says the same.
 * Chain servers are a fake Fulcrum (tests/fake-fulcrum.ts); no transaction is sent anywhere.
 */
import type { Page } from '@playwright/test';
import WebSocket from 'ws';
import { buildAnchorTransaction, txidOf, type AnchorPayload } from '../src/core/anchor.js';
import { scripthashOf } from '../src/core/anchor-chain.js';
import { toNpub } from '../src/core/nostr.js';
import { signP2pkh, hexOf } from '../tests/anchor-wallet.js';
import { headerWithTime, type FakeChain } from '../tests/fake-fulcrum.js';
import { chainServers, en, expect, expectAccessible, expectNoOverflow, ms, phraseKeys, routeChain, test, vectors } from './fixtures.js';
import { E2E } from './ports.js';

const exact = (name: string) => ({ name, exact: true });
const address = vectors.bch.address.bitcoincash;
const bind: AnchorPayload = { pubkey: vectors.nostr.pubkey, eventId: vectors.bindingEvent.id };
/** Another Nostr key the address committed to on the chain after the relay binding's key. */
const otherKey = '7e'.repeat(32);
const before = (text: string) => text.split('{')[0] ?? text;

/** A chain whose history holds one transaction from the test address per payload, in blocks 900100, 900200, ... */
function chainOf(...payloads: AnchorPayload[]): FakeChain {
  const txs = payloads.map((p, i) => {
    const unsigned = buildAnchorTransaction(address, [{ txid: '66'.repeat(32), vout: i, satoshis: 5000 }], p);
    const bytes = signP2pkh(unsigned.transaction, unsigned.sourceOutputs, phraseKeys.bchPrivateKey);
    return { hex: hexOf(bytes), txid: txidOf(bytes), height: 900_100 + 100 * i };
  });
  const headers = Object.fromEntries(txs.map((t) => [t.height, headerWithTime(Date.UTC(2026, 10, 18) / 1000 + t.height)]));
  return { history: { [scripthashOf(address)]: txs }, headers };
}
const revoked = chainOf(bind, { ...bind, action: 'revoke' });
const conflict = chainOf(bind, { ...bind, pubkey: otherKey });
const rebound = chainOf(bind, { ...bind, action: 'revoke' }, bind);

test.beforeAll(async () => {
  const ws = new WebSocket(E2E.relayUrl);
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => ws.send(JSON.stringify(['EVENT', vectors.bindingEvent])));
    ws.on('message', () => resolve());
    ws.on('error', reject);
  });
  ws.close();
});

async function pay(page: Page, chain: FakeChain, lang: 'en' | 'ms' = 'en') {
  await routeChain(page, chain);
  if (lang === 'ms') {
    await page.goto('/');
    await page.getByLabel(en.lang.label).selectOption('ms');
  }
  await page.goto(`/pay?npub=${vectors.nostr.npub}`);
}

test('Pay refuses an address the chain revoked, with the block, and shows no payment link', async ({ page }) => {
  await pay(page, revoked);
  const refused = page.locator('[data-pay="refused"]');
  await expect(refused).toContainText(en.pay.revoked.replace('{height}', '900200'), { timeout: 20_000 });
  await expect(refused.getByRole('button', exact(en.pay.open))).toBeDisabled();
  await expect(page.getByRole('link', exact(en.pay.open))).toHaveCount(0);
  await expect(page.getByRole('img', exact(en.pay.qr))).toHaveCount(0);
  await expectAccessible(page);
});

test('Pay refuses an address the chain gave to another key, and names that key', async ({ page }) => {
  await pay(page, conflict);
  await expect(page.locator('[data-pay="refused"]')).toContainText(en.pay.conflict.replace('{npub}', toNpub(otherKey)), { timeout: 20_000 });
  await expect(page.getByRole('link', exact(en.pay.open))).toHaveCount(0);
});

test('Pay offers the link again after bind, revoke, bind', async ({ page }) => {
  await pay(page, rebound);
  await expect(page.getByRole('link', exact(en.pay.open))).toHaveAttribute('href', address, { timeout: 20_000 });
  await expect(page.locator('[data-pay="refused"]')).toHaveCount(0);
});

test('Pay with chain servers down still offers the verified address and says the chain was not checked', async ({ page }) => {
  await page.routeWebSocket(chainServers, (ws) => ws.close());
  await page.goto(`/pay?npub=${vectors.nostr.npub}`);
  await expect(page.getByText(en.pay.unreachable)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('link', exact(en.pay.open))).toHaveAttribute('href', address);
});

test('in Malay at 320 px the refusal reads in Malay and fits after scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await pay(page, conflict, 'ms');
  const refused = page.locator('[data-pay="refused"]');
  await expect(refused).toContainText(before(ms.pay.conflict), { timeout: 20_000 });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expectNoOverflow(page);
  const widths = await refused.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
});

test('Look up shows the chain status: revoked, and conflict with the other key', async ({ page }) => {
  await routeChain(page, revoked);
  await page.goto(`/lookup?q=${vectors.nostr.npub}`);
  const anchor = page.locator('.anchor');
  await expect(anchor).toHaveAttribute('data-chain', 'revoked', { timeout: 20_000 });
  await expect(anchor.locator('.notice--error')).toContainText(before(en.anchor.revoked));
  await expect(anchor).toContainText('900200');

  await routeChain(page, conflict);
  await page.reload();
  await expect(anchor).toHaveAttribute('data-chain', 'conflict', { timeout: 20_000 });
  await expect(anchor.locator('.notice--error')).toContainText(toNpub(otherKey));
  await expectNoOverflow(page);
  await expectAccessible(page);
});
