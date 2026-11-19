/**
 * The home page hero: the owner's real Paytaca binding (public relay data, tests/fixtures/paytaca-binding.json) served
 * by a fake relay, and its real anchor transaction served by a fake chain server. The card must be above the fold on an
 * iPhone 13 with the Link form below it, earn each mark from its own check, name the step that failed, and open Look up.
 */
import type { Page } from '@playwright/test';
import type { Event } from 'nostr-tools/pure';
import config from '../config/tambat.json' with { type: 'json' };
import { scripthashOf } from '../src/core/anchor-chain.js';
import binding from '../tests/fixtures/paytaca-binding.json' with { type: 'json' };
import paytacaAnchor from './paytaca-anchor.json' with { type: 'json' };
import { routeToRelay, startFakeRelay } from './fake-relay.js';
import { chainServers, en, expect, expectAccessible, expectNoOverflow, ms, routeChain, test } from './fixtures.js';
import { E2E } from './ports.js';

const HERO_RELAY_PORT = E2E.relayPort + 80;
const EMPTY_RELAY_PORT = E2E.relayPort + 81;
const STEPS = ['relay', 'nostr_sig', 'bch_sig', 'address_match', 'anchor'];

let relay: ReturnType<typeof startFakeRelay>;
let empty: ReturnType<typeof startFakeRelay>;
test.beforeAll(() => {
  relay = startFakeRelay(HERO_RELAY_PORT);
  relay.events.set(binding.id, binding as Event);
  empty = startFakeRelay(EMPTY_RELAY_PORT);
});
test.afterAll(async () => {
  await relay.close();
  await empty.close();
});

const anchoredChain = {
  history: { [scripthashOf(paytacaAnchor.address)]: [{ hex: paytacaAnchor.hex, txid: paytacaAnchor.txid, height: paytacaAnchor.height }] },
  headers: { [paytacaAnchor.height]: paytacaAnchor.header },
};

const hero = (page: Page) => page.locator('[data-hero]');
const statuses = (page: Page) => hero(page).locator('[data-step]').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-step')}=${e.getAttribute('data-status')}`));

test('the hero checks the real Paytaca binding step by step above the fold, with the Link form below it', async ({ page }) => {
  await routeToRelay(page, HERO_RELAY_PORT);
  await routeChain(page, anchoredChain);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.hero.line);
  await expect(hero(page)).toHaveAttribute('data-state', 'verified');
  await expect(hero(page).locator('[data-step="anchor"]')).toHaveAttribute('data-status', 'pass');
  expect(await statuses(page)).toEqual(STEPS.map((s) => `${s}=pass`));
  await expect(hero(page).locator('[data-step="anchor"]')).toContainText(en.hero.block.replace('{block}', String(paytacaAnchor.height)));
  await expect(hero(page)).toContainText(en.hero.by);
  await expect(hero(page).locator('code').first()).toHaveAttribute('title', config.hero.npub);

  const box = await page.evaluate(() => {
    const card = document.querySelector('.herocard')!.getBoundingClientRect();
    const link = document.getElementById('link')!.getBoundingClientRect();
    return { cardBottom: card.bottom, linkTop: link.top, inner: window.innerHeight, width: window.innerWidth };
  });
  expect(box.cardBottom, 'the whole card is on the first screen').toBeLessThanOrEqual(box.inner);
  if (box.width < 640) expect(box.linkTop, 'the Link form starts below the fold on a phone').toBeGreaterThanOrEqual(box.inner);
  await expectNoOverflow(page);
  await expectAccessible(page);
});

test('each mark waits for its own check: the anchor stays open while the chain servers are silent', async ({ page }) => {
  await routeToRelay(page, HERO_RELAY_PORT);
  // Chain servers that accept the connection and never answer.
  await page.routeWebSocket(chainServers, () => undefined);
  await page.goto('/');
  await expect(hero(page).locator('[data-step="address_match"]')).toHaveAttribute('data-status', 'pass');
  expect(await statuses(page)).toEqual([...STEPS.slice(0, 4).map((s) => `${s}=pass`), 'anchor=wait']);
  await expect(hero(page)).toHaveAttribute('data-state', 'busy');
  await expect(hero(page).locator('.hstep--pass')).toHaveCount(4);
});

test('with no relay holding the event the hero says it could not check and names the step, with no marks', async ({ page }) => {
  await routeToRelay(page, EMPTY_RELAY_PORT);
  await routeChain(page);
  await page.goto('/');
  await expect(hero(page)).toHaveAttribute('data-state', 'failed', { timeout: config.hero.timeoutMs + 10_000 });
  expect(await statuses(page)).toEqual(['relay=fail', ...STEPS.slice(1).map((s) => `${s}=wait`)]);
  await expect(page.getByRole('status').filter({ hasText: en.hero.steps.relay })).toHaveText(
    en.hero.failed.replace('{step}', en.hero.steps.relay),
  );
  await expect(hero(page).locator('.hstep--pass')).toHaveCount(0);
});

test('tapping the card opens Look up for the npub, and the own-keys link reaches the Link form', async ({ page }) => {
  await routeToRelay(page, HERO_RELAY_PORT);
  await routeChain(page, anchoredChain);
  await page.goto('/');
  await expect(hero(page)).toHaveAttribute('data-state', 'verified');
  await page.locator('.herocard').click();
  await expect(page).toHaveURL(new RegExp(`/lookup\\?q=${config.hero.npub}$`));
  await expect(page.locator('.result').first()).toBeVisible();
  await page.goto('/');
  await page.getByRole('link', { name: en.hero.own }).click();
  await expect(page.locator('#link-step')).toBeInViewport();
});

test('in Malay at 320 px the hero fits without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await routeToRelay(page, HERO_RELAY_PORT);
  await routeChain(page, anchoredChain);
  await page.goto('/?lang=ms');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ms.hero.line);
  await expect(hero(page)).toHaveAttribute('data-state', 'verified');
  await expect(hero(page)).toContainText(ms.hero.by);
  await expectNoOverflow(page);
  const card = await page.locator('.herocard').evaluate((el) => [el.scrollWidth, el.clientWidth]);
  expect(card[0]).toBeLessThanOrEqual(card[1]!);
  await expectAccessible(page);
});
