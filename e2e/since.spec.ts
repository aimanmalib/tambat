/**
 * "Anchored since block N" on the wall and on Pay. Every binding is fresh and every chain is a fake Fulcrum
 * (tests/fake-fulcrum.ts): no transaction is sent anywhere. The wall reads the chain only for entries on or near the screen.
 */
import { secp256k1 } from '@bitauth/libauth';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { Page } from '@playwright/test';
import WebSocket from 'ws';
import { buildAnchorTransaction, txidOf, type AnchorPayload } from '../src/core/anchor.js';
import { scripthashOf } from '../src/core/anchor-chain.js';
import { addressFromPublicKey } from '../src/core/cashaddr.js';
import { toNpub } from '../src/core/nostr.js';
import { bindingFromKeys } from '../src/core/paytaca.js';
import { signP2pkh, hexOf } from '../tests/anchor-wallet.js';
import { headerWithTime, type FakeChain, type FakeChainTx } from '../tests/fake-fulcrum.js';
import { startFakeRelay } from './fake-relay.js';
import { chainServers, en, expect, expectAccessible, expectNoOverflow, ms, routeChain, test } from './fixtures.js';
import { E2E } from './ports.js';

const SINCE_RELAY_PORT = E2E.relayPort + 60;
const relayUrl = `ws://127.0.0.1:${SINCE_RELAY_PORT}`;
const now = Math.floor(Date.now() / 1000);
const COUNT = 12;
const BLOCK = 977_901;

function freshBinding(createdAt: number) {
  const nostrSecretKey = generateSecretKey();
  const bchPrivateKey = generateSecretKey();
  const address = addressFromPublicKey(secp256k1.derivePublicKeyCompressed(bchPrivateKey) as Uint8Array, 'bitcoincash');
  const pubkey = getPublicKey(nostrSecretKey);
  const npub = toNpub(pubkey);
  return { npub, pubkey, address, bchPrivateKey, event: bindingFromKeys({ nostrSecretKey, bchPrivateKey, address, npub }, createdAt) };
}
type Binding = ReturnType<typeof freshBinding>;

/** Newest first on the wall: index 0 is at the top, the last one far below the fold of a phone. */
const bindings = Array.from({ length: COUNT }, (_, i) => freshBinding(now - 100 * (i + 1)));

function commitment(b: Binding, payload: AnchorPayload, vout: number, height: number): FakeChainTx {
  const unsigned = buildAnchorTransaction(b.address, [{ txid: '68'.repeat(32), vout, satoshis: 5000 }], payload);
  const bytes = signP2pkh(unsigned.transaction, unsigned.sourceOutputs, b.bchPrivateKey);
  return { hex: hexOf(bytes), txid: txidOf(bytes), height };
}

/** Each binding gets the transactions `txsOf` gives it; blocks get headers. */
function chainFor(txsOf: (b: Binding, i: number) => FakeChainTx[]): FakeChain {
  const history: FakeChain['history'] = {};
  const headers: FakeChain['headers'] = {};
  bindings.forEach((b, i) => {
    const txs = txsOf(b, i);
    history[scripthashOf(b.address)] = txs;
    for (const t of txs) if (t.height > 0) headers[t.height] = headerWithTime(Date.UTC(2026, 10, 17) / 1000 + t.height);
  });
  return { history, headers };
}
const bind = (b: Binding): AnchorPayload => ({ pubkey: b.pubkey, eventId: b.event.id });
/** Even entries are bound since BLOCK + i; odd entries are bound then revoked, so they earn no badge. */
const chain = chainFor((b, i) =>
  i % 2 === 0 ? [commitment(b, bind(b), 0, BLOCK + i)] : [commitment(b, bind(b), 0, BLOCK), commitment(b, { ...bind(b), action: 'revoke' }, 1, BLOCK + 50)],
);

let relay: ReturnType<typeof startFakeRelay>;
test.beforeAll(() => {
  relay = startFakeRelay(SINCE_RELAY_PORT);
  for (const b of bindings) relay.events.set(b.event.id, b.event);
});
test.afterAll(() => relay.close());

/** Relays go to this file's relay; the chain servers are routed after, so they win. */
async function routes(page: Page, fake: FakeChain) {
  await page.routeWebSocket(/^wss:\/\//, (ws) => {
    const upstream = new WebSocket(relayUrl);
    const queue: string[] = [];
    upstream.on('open', () => queue.splice(0).forEach((m) => upstream.send(m)));
    upstream.on('message', (data) => ws.send(String(data)));
    upstream.on('close', () => ws.close());
    upstream.on('error', () => ws.close());
    ws.onMessage((m) => (upstream.readyState === WebSocket.OPEN ? upstream.send(String(m)) : queue.push(String(m))));
    ws.onClose(() => upstream.close());
  });
  await routeChain(page, fake);
}

const card = (page: Page, b: Binding) => page.locator(`.wall__card[data-event="${b.event.id}"]`);
const badgeText = (lang: typeof en, height: number) => lang.anchor.badge.replace('{height}', String(height));

test('the wall badges bound entries on screen, reads the rest only when scrolled to, and never badges a revoked one', async ({ page }) => {
  await routes(page, chain);
  await page.setViewportSize({ width: 390, height: 664 });
  await page.goto('/wall');
  await expect(page.locator('.wall__card')).toHaveCount(COUNT);
  const first = bindings[0] as Binding;
  const second = bindings[1] as Binding;
  const last = bindings[COUNT - 1] as Binding;
  const lastBound = bindings[COUNT - 2] as Binding;
  await expect(card(page, first).locator('.badge--anchor')).toHaveText(badgeText(en, BLOCK), { timeout: 20_000 });
  await expect(card(page, first).locator('[data-since]')).toHaveAttribute('data-since', String(BLOCK));
  // Lazy: entries far below the fold have not been read.
  await expect(card(page, last).locator('.since')).toHaveAttribute('data-since-read', 'no');
  await expect(card(page, lastBound).locator('.since')).toHaveAttribute('data-since-read', 'no');
  // Revoked on the chain: read, no badge, no error.
  await card(page, second).scrollIntoViewIfNeeded();
  await expect(card(page, second).locator('.since')).toHaveAttribute('data-since-read', 'yes');
  await page.waitForTimeout(500);
  await expect(card(page, second).locator('.badge--anchor')).toHaveCount(0);

  await card(page, lastBound).scrollIntoViewIfNeeded();
  await expect(card(page, lastBound).locator('.badge--anchor')).toHaveText(badgeText(en, BLOCK + COUNT - 2), { timeout: 20_000 });
  await card(page, last).scrollIntoViewIfNeeded();
  await expect(card(page, last).locator('.since')).toHaveAttribute('data-since-read', 'yes');
  await expect(card(page, last).locator('.badge--anchor')).toHaveCount(0);
  await expectNoOverflow(page);
  await expectAccessible(page);
});

test('on a phone the wall reads entries just below the fold before they are reached, and badges them as the reader scrolls', async ({ page }) => {
  await routes(page, chain);
  await page.setViewportSize({ width: 390, height: 664 });
  await page.goto('/wall');
  await expect(page.locator('.wall__card')).toHaveCount(COUNT);
  // The first entry below the fold before any scroll, within one screen of it: read already because of
  // wall.sinceRootMargin. Found by position, so a change to what sits above the wall does not void the check. Even
  // entries are bound and earn a badge; odd ones were revoked and must earn none.
  const tops = await page.locator('.wall__card').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
  const at = tops.findIndex((top, i) => i > 0 && top >= 664);
  expect(at).toBeGreaterThan(0);
  expect(tops[at]).toBeLessThan(664 * 2);
  const anchored = bindings[at] as Binding;
  const further = bindings[8] as Binding;
  const last = bindings[COUNT - 1] as Binding;
  expect(at).toBeLessThan(8);
  await expect(card(page, anchored).locator('.since')).toHaveAttribute('data-since-read', 'yes', { timeout: 10_000 });
  const bound = at % 2 === 0;
  if (bound) await expect(card(page, anchored).locator('.badge--anchor')).toHaveText(badgeText(en, BLOCK + at), { timeout: 20_000 });
  await expect(card(page, last).locator('.since')).toHaveAttribute('data-since-read', 'no');
  // Scroll the way a reader does, a screen at a time, until the further entry is on screen.
  for (let i = 0; i < 20; i += 1) {
    const top = await card(page, further).evaluate((el) => el.getBoundingClientRect().top);
    if (top < 664 / 2) break;
    await page.evaluate(() => window.scrollBy(0, Math.round(innerHeight * 0.8)));
    await page.waitForFunction(() => document.readyState === 'complete');
  }
  await expect(card(page, further).locator('.since')).toHaveAttribute('data-since-read', 'yes');
  await expect(card(page, further).locator('.badge--anchor')).toHaveText(badgeText(en, BLOCK + 8), { timeout: 20_000 });
  if (bound) await expect(card(page, anchored).locator('.badge--anchor')).toHaveText(badgeText(en, BLOCK + at));
  else await expect(card(page, anchored).locator('.badge--anchor')).toHaveCount(0);
  await expectNoOverflow(page);
});

test('the wall with chain servers down shows every entry, no badge and no error', async ({ page }) => {
  await routes(page, chain);
  await page.routeWebSocket(chainServers, (ws) => ws.close());
  await page.goto('/wall');
  await expect(page.locator('.wall__card')).toHaveCount(COUNT);
  await expect(card(page, bindings[0] as Binding).locator('.since')).toHaveAttribute('data-since-read', 'yes');
  await page.waitForTimeout(1500);
  await expect(page.locator('.badge--anchor')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('the wall badge in Malay at 320 px fits after scrolling', async ({ page }) => {
  await routes(page, chain);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/wall?lang=ms');
  const target = bindings[4] as Binding;
  await card(page, target).scrollIntoViewIfNeeded();
  await expect(card(page, target).locator('.badge--anchor')).toHaveText(badgeText(ms, BLOCK + 4), { timeout: 20_000 });
  await expectNoOverflow(page);
  const fits = await card(page, target).evaluate((el) => el.scrollWidth <= el.clientWidth);
  expect(fits).toBe(true);
});

test('Pay shows since which block the chain binds the address, and no badge once it is revoked', async ({ page }) => {
  await routes(page, chain);
  const bound = bindings[0] as Binding;
  await page.goto(`/pay?npub=${bound.npub}`);
  await expect(page.locator('.stack > [data-since]')).toHaveText(badgeText(en, BLOCK), { timeout: 20_000 });
  await expect(page.getByRole('link', { name: en.pay.open, exact: true })).toHaveAttribute('href', bound.address);
  await expectNoOverflow(page);

  const revoked = bindings[1] as Binding;
  await page.goto(`/pay?npub=${revoked.npub}`);
  await expect(page.locator('[data-pay="refused"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-since]')).toHaveCount(0);
});
