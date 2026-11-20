/**
 * The wall against its own fake relay holding two binding events: one genuine and one named `forged` whose Nostr
 * signature was changed after signing. Only the genuine one may be listed; the forged one only counts as hidden. Both
 * sit behind more newer identity events of another platform than one page holds, so the wall must page back to them.
 */
import { join } from 'node:path';
import { secp256k1 } from '@bitauth/libauth';
import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from 'nostr-tools/pure';
import type { Page, TestInfo } from '@playwright/test';
import WebSocket from 'ws';
import { config as siteConfig } from '../src/config.js';
import { addressFromPublicKey } from '../src/core/cashaddr.js';
import { shortAddress, shortNpub } from '../src/core/badge.js';
import { toNpub } from '../src/core/nostr.js';
import { bindingFromKeys } from '../src/core/paytaca.js';
import { startFakeRelay } from './fake-relay.js';
import { en, expect, expectAccessible, expectNoOverflow, ms, test } from './fixtures.js';
import { E2E } from './ports.js';

const WALL_RELAY_PORT = E2E.relayPort + 10;
const wallRelayUrl = `ws://127.0.0.1:${WALL_RELAY_PORT}`;

function freshBinding(createdAt: number) {
  const nostrSecretKey = generateSecretKey();
  const bchPrivateKey = generateSecretKey();
  const address = addressFromPublicKey(secp256k1.derivePublicKeyCompressed(bchPrivateKey) as Uint8Array, 'bitcoincash');
  const npub = toNpub(getPublicKey(nostrSecretKey));
  return { npub, address, event: bindingFromKeys({ nostrSecretKey, bchPrivateKey, address, npub }, createdAt) };
}

const now = Math.floor(Date.now() / 1000);
const genuine = freshBinding(now - 5000);
const forgedSource = freshBinding(now - 4000);
/** Newer identity events naming another platform: more than one page, so the BCH bindings are only on a later page. */
const crowdKey = generateSecretKey();
const crowd = Array.from({ length: siteConfig.wall.pageSize + 50 }, (_, i) =>
  finalizeEvent({ kind: siteConfig.nostr.bindingKind, created_at: now - 1000 + i, content: '', tags: [['i', `github:user${i}`, 'proof']] }, crowdKey),
);
const scanned = String(crowd.length + 2);
const forged: Event = { ...forgedSource.event, sig: `${forgedSource.event.sig.slice(0, -4)}${forgedSource.event.sig.endsWith('0000') ? '1111' : '0000'}` };

let relay: ReturnType<typeof startFakeRelay>;
test.beforeAll(() => {
  relay = startFakeRelay(WALL_RELAY_PORT);
  // Stored directly: the fake relay, like a real one, would refuse the forged event if it were published.
  relay.events.set(genuine.event.id, genuine.event);
  relay.events.set(forged.id, forged);
  for (const e of crowd) relay.events.set(e.id, e);
});
test.afterAll(() => relay.close());

/** Sends every relay connection of the page to the wall relay (registered last, so it wins over the shared relay). */
async function useWallRelay(page: Page) {
  await page.routeWebSocket(/^wss:\/\//, (ws) => {
    const upstream = new WebSocket(wallRelayUrl);
    const queue: string[] = [];
    upstream.on('open', () => queue.splice(0).forEach((m) => upstream.send(m)));
    upstream.on('message', (data) => ws.send(String(data)));
    upstream.on('close', () => ws.close());
    upstream.on('error', () => ws.close());
    ws.onMessage((m) => (upstream.readyState === WebSocket.OPEN ? upstream.send(String(m)) : queue.push(String(m))));
    ws.onClose(() => upstream.close());
  });
}

/** Review screenshot when SHOTS_DIR is set. WebKit injects a stylesheet while it takes the picture, which the page policy refuses; that one message is dropped. */
async function shot(page: Page, info: TestInfo, errors: string[], name: string) {
  const dir = process.env.SHOTS_DIR ?? '';
  if (!dir) return;
  const before = errors.length;
  await page.screenshot({ path: join(dir, `i6-${info.project.name}-${name}.png`), fullPage: true, caret: 'initial' });
  await page.waitForTimeout(300);
  const after = errors.splice(before).filter((e) => !e.startsWith('Refused to apply a stylesheet'));
  errors.push(...after);
}

test('the wall lists the genuine binding and only counts the forged one', async ({ page, consoleErrors }, info) => {
  await useWallRelay(page);
  await page.goto('/wall');
  await expect(page.getByRole('heading', { level: 1, name: en.wall.title })).toBeVisible();
  const cards = page.locator('.wall__card');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toHaveAttribute('data-event', genuine.event.id);
  await expect(page.locator(`[data-event="${forged.id}"]`)).toHaveCount(0);
  await expect(cards.first()).toContainText(shortNpub(genuine.npub));
  await expect(cards.first()).toContainText(shortAddress(genuine.address));
  await expect(page.locator('.wall__hidden')).toHaveAttribute('data-hidden', '1');
  await expect(page.locator('.wall__hidden')).toHaveText(en.wall.hidden.replace('{count}', '1'));
  await expect(page.locator('.wall__scanned')).toHaveText(en.wall.scanned.replace('{shown}', '1').replace('{scanned}', scanned));
  await expect(page.getByRole('link', { name: en.nav.wall })).toHaveAttribute('aria-current', 'page');
  await expectAccessible(page);
  await expectNoOverflow(page);
  await shot(page, info, consoleErrors, 'en');

  await cards.first().getByRole('link', { name: en.wall.open }).click();
  await expect(page).toHaveURL(`/lookup?q=${genuine.npub}`);
  await expect(page.locator('.result[data-ok="true"]')).toBeVisible();
});

test('the wall in Malay at 320 px fits and keeps the same verdicts', async ({ page, consoleErrors }, info) => {
  await useWallRelay(page);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/wall?lang=ms');
  await expect(page.getByRole('heading', { level: 1, name: ms.wall.title })).toBeVisible();
  await expect(page.locator('.wall__card')).toHaveCount(1);
  await expect(page.locator('.wall__hidden')).toHaveText(ms.wall.hidden.replace('{count}', '1'));
  await expect(page.locator('.wall__scanned')).toHaveText(ms.wall.scanned.replace('{shown}', '1').replace('{scanned}', scanned));
  await expectNoOverflow(page);
  await expectAccessible(page);
  await shot(page, info, consoleErrors, 'ms-320');
});

test('blocked relays read as unreachable, not as an empty wall', async ({ page }) => {
  await page.routeWebSocket(/^wss:\/\//, (ws) => ws.close());
  await page.goto('/wall');
  await expect(page.getByRole('alert')).toHaveText(en.wall.unreachable);
  await expect(page.locator('.wall__card')).toHaveCount(0);
});

/** Publishes an event to the wall relay the way a client does, and waits for the relay to accept it. */
function publish(event: Event): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wallRelayUrl);
    ws.on('open', () => ws.send(JSON.stringify(['EVENT', event])));
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data)) as unknown[];
      if (msg[0] !== 'OK') return;
      ws.close();
      if (msg[2] === true) resolve();
      else reject(new Error(String(msg[3])));
    });
    ws.on('error', reject);
  });
}

const count = (page: Page, key: string) => page.locator(`.wall__count[data-count="${key}"] dd`);

test('the wall keeps itself current: no Check again button, a count strip, and new bindings without a reload', async ({ page }) => {
  await page.clock.install();
  await useWallRelay(page);
  await page.goto('/wall');
  await expect(page.locator('.wall__card')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Check again' })).toHaveCount(0);
  const strip = page.getByRole('region', { name: en.wall.strip.label });
  await expect(strip).toBeVisible();
  await expect(count(page, 'verified')).toHaveText('1');
  await expect(count(page, 'on-chain')).toHaveText('0');
  const total = String(siteConfig.nostr.relays.length);
  await expect(count(page, 'relays')).toHaveText(en.wall.strip.relaysOf.replace('{answered}', total).replace('{total}', total));
  await expect(count(page, 'attestations')).toHaveText('0');
  // The chain servers are not reachable in this test, so nothing about anchors was read: a dash, not a zero.
  await expect(count(page, 'latest-block')).toHaveText(en.wall.strip.none);
  await expect(page.locator('.wall__counts')).toHaveAttribute('aria-live', 'polite');
  const updated = page.locator('.wall__updated');
  const first = await updated.getAttribute('data-updated');
  expect(first).toMatch(/^\d\d:\d\d:\d\d$/);
  await expect(updated).toHaveText(en.wall.strip.updated.replace('{time}', first ?? '').replace('{seconds}', String(siteConfig.wall.refreshSeconds)));

  // One interval later the wall was checked again.
  await page.clock.fastForward(siteConfig.wall.refreshSeconds * 1000 + 1000);
  await expect(updated).not.toHaveAttribute('data-updated', first ?? '', { timeout: 15_000 });

  // A binding published while the page is open joins it from the open subscription.
  const later = freshBinding(Math.floor(Date.now() / 1000) + 60);
  await publish(later.event);
  await expect(page.locator(`[data-event="${later.event.id}"]`)).toBeVisible({ timeout: 15_000 });
  await expect(count(page, 'verified')).toHaveText('2');
  relay.events.delete(later.event.id);
  await expectAccessible(page);
  await expectNoOverflow(page);
});

test('a hidden tab is not checked, and is checked again once shown', async ({ page }) => {
  await page.clock.install();
  await useWallRelay(page);
  await page.goto('/wall?lang=ms');
  await expect(page.locator('.wall__card')).toHaveCount(1);
  await expect(page.getByRole('region', { name: ms.wall.strip.label })).toBeVisible();
  const updated = page.locator('.wall__updated');
  const first = (await updated.getAttribute('data-updated')) ?? '';
  const setHidden = (hidden: boolean) =>
    page.evaluate((h) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  await setHidden(true);
  await page.clock.fastForward(siteConfig.wall.refreshSeconds * 3000);
  await page.waitForTimeout(1500);
  await expect(updated).toHaveAttribute('data-updated', first);
  await setHidden(false);
  await expect(updated).not.toHaveAttribute('data-updated', first, { timeout: 15_000 });
  await expect(updated).toContainText(ms.wall.strip.updated.split(' {time}')[0] ?? '');
});
