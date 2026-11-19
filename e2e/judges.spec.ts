/**
 * The judges page against its own fake relay holding the real demo binding (a public, signed event copied from the
 * relays into demo-binding-event.json). The page must fit one screen at 1440 x 900 and on an iPhone 13 without
 * scrolling, show every check of the live look-up, and say so plainly when the relays are blocked.
 */
import { join } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import type { Event } from 'nostr-tools/pure';
import config from '../config/tambat.json' with { type: 'json' };
import { scripthashOf } from '../src/core/anchor-chain.js';
import demoEvent from './demo-binding-event.json' with { type: 'json' };
import paytacaAnchor from './paytaca-anchor.json' with { type: 'json' };
import { routeToRelay, startFakeRelay } from './fake-relay.js';
import { chainServers, en, expect, expectAccessible, expectNoOverflow, ms, routeChain, routeOneServer, test } from './fixtures.js';
import { E2E } from './ports.js';

const JUDGES_RELAY_PORT = E2E.relayPort + 20;

let relay: ReturnType<typeof startFakeRelay>;
test.beforeAll(() => {
  relay = startFakeRelay(JUDGES_RELAY_PORT);
  relay.events.set(demoEvent.id, demoEvent as Event);
});
test.afterAll(() => relay.close());

/** The chain holds the owner's real Paytaca anchor transaction (public chain data) in its real block. */
const anchoredChain = {
  history: { [scripthashOf(paytacaAnchor.address)]: [{ hex: paytacaAnchor.hex, txid: paytacaAnchor.txid, height: paytacaAnchor.height }] },
  headers: { [paytacaAnchor.height]: paytacaAnchor.header },
};

async function useJudgesRelay(page: Page) {
  await routeToRelay(page, JUDGES_RELAY_PORT);
  await routeChain(page, anchoredChain);
}

/** The check mark with how many chain servers agreed (all of them here), then its spoken label. */
const servers = config.anchor.electrum.length;
const confirmedText = (d: typeof en) =>
  `✓ ${servers}/${servers}${d.judges.anchorState.confirmed}. ${d.judges.anchorServers.replace('{agreed}', String(servers)).replace('{total}', String(servers))}`;

/** The page is one screen: the document is no taller than the window. */
async function expectOneScreen(page: Page) {
  const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollHeight, inner: window.innerHeight }));
  expect(size.scroll, `scrollHeight ${size.scroll} > innerHeight ${size.inner}`).toBeLessThanOrEqual(size.inner);
}

async function shot(page: Page, info: TestInfo, errors: string[], name: string) {
  const dir = process.env.SHOTS_DIR ?? '';
  if (!dir) return;
  const before = errors.length;
  await page.screenshot({ path: join(dir, `i9-${info.project.name}-${name}.png`), caret: 'initial' });
  await page.waitForTimeout(300);
  errors.push(...errors.splice(before).filter((e) => !e.startsWith('Refused to apply a stylesheet')));
}

const desktop = (info: TestInfo) => info.project.name === 'chromium';

test('one screen with a green live check, the recorded proof and every requirement', async ({ page, consoleErrors }, info) => {
  if (desktop(info)) await page.setViewportSize({ width: 1440, height: 900 });
  await useJudgesRelay(page);
  await page.goto('/judges');
  await expect(page.getByRole('heading', { level: 1, name: en.judges.title })).toBeVisible();
  const live = page.locator('.jpanel--live');
  await expect(live).toHaveAttribute('data-state', 'verified', { timeout: 20_000 });
  const chips = live.locator('.chip');
  expect(await chips.count()).toBeGreaterThan(0);
  await expect(live.locator('.chip:not([data-status="pass"])')).toHaveCount(0);
  await expect(live.locator('.notice--ok')).toContainText(en.judges.verified.split(':')[0] ?? '');
  // Every relay goes to the fake relay here, so every one answered, and the count is shown with the live check.
  const answered = live.locator('.jrelays');
  await expect(answered).toHaveAttribute('data-answered', String(config.nostr.relays.length));
  await expect(answered).toHaveText(en.relays.judges.replace('{answered}', String(config.nostr.relays.length)).replace('{total}', String(config.nostr.relays.length)));

  await expect(page.locator(`[data-proof="paytaca"] a[data-event="${config.judges.paytaca.eventId}"]`)).toHaveAttribute('href', `/lookup?q=${config.judges.paytaca.npub}`);
  await expect(page.locator(`[data-proof="revocation"] a[data-event="${config.judges.revocation.eventId}"]`)).toBeVisible();
  const anchor = page.locator('[data-proof="anchor"]');
  await expect(anchor).toHaveAttribute('data-anchor', 'confirmed', { timeout: 20_000 });
  await expect(anchor).toContainText(en.judges.anchor.replace('{block}', String(config.judges.anchor.block)));
  await expect(anchor.getByRole('status')).toHaveText(confirmedText(en));
  await expect(anchor.locator('code')).toHaveAttribute('title', config.judges.anchor.txid);
  await expect(anchor.getByRole('link', { name: en.judges.explorer })).toHaveAttribute('href', config.anchor.explorerTx.replace('{txid}', config.judges.anchor.txid));
  for (const name of [en.judges.signIn, en.judges.verifyYourself, en.judges.spec, en.judges.repo]) {
    await expect(page.getByRole('main').getByRole('link', { name })).toBeVisible();
  }
  // Lists start open on a wide screen and closed on a phone; either way all five requirements and six criteria are there.
  const folds = page.locator('details.jfold');
  await expect(folds).toHaveCount(2);
  for (const f of await folds.all()) expect(await f.evaluate((d: HTMLDetailsElement) => d.open)).toBe(desktop(info));
  await expect(page.locator('[data-req]')).toHaveCount(5);
  await expect(page.locator('[data-crit]')).toHaveCount(6);

  await expectOneScreen(page);
  await expectNoOverflow(page);
  await expectAccessible(page);
  await shot(page, info, consoleErrors, 'en');

  await page.getByRole('combobox').selectOption('ms');
  await expect(page.getByRole('heading', { level: 1, name: ms.judges.title })).toBeVisible();
  await expect(live).toHaveAttribute('data-state', 'verified', { timeout: 20_000 });
  await expect(anchor.getByRole('status')).toHaveText(confirmedText(ms));
  await expect(anchor).toContainText(ms.judges.anchor.replace('{block}', String(config.judges.anchor.block)));
  await expectOneScreen(page);
  await expectNoOverflow(page);
  await shot(page, info, consoleErrors, 'ms');

  await page.locator('[data-proof="paytaca"] a').click();
  await expect(page).toHaveURL(`/lookup?q=${config.judges.paytaca.npub}`);
});

test('at 320 px the page does not overflow sideways and the lists still open', async ({ page }) => {
  await useJudgesRelay(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/judges');
  await expect(page.locator('.jpanel--live')).toHaveAttribute('data-state', 'verified', { timeout: 20_000 });
  for (const s of await page.locator('details.jfold > summary').all()) await s.click();
  await expect(page.locator('[data-req="discovery"]')).toBeVisible();
  await expectNoOverflow(page);
});

test('the copy button puts the full anchor transaction id on the clipboard', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'chromium', 'clipboard read permission is Chromium only');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await useJudgesRelay(page);
  await page.goto('/judges');
  const anchor = page.locator('[data-proof="anchor"]');
  await anchor.getByRole('button', { name: `${en.common.copy}: ${en.judges.anchorTx}` }).click();
  await expect(anchor.getByRole('button')).toHaveText(en.common.copied);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(config.judges.anchor.txid);
});

test('a chain that holds another block or cannot be read is never shown as confirmed', async ({ page }) => {
  await routeToRelay(page, JUDGES_RELAY_PORT);
  const height = paytacaAnchor.height + 1;
  const tx = { hex: paytacaAnchor.hex, txid: paytacaAnchor.txid, height };
  await routeChain(page, { history: { [scripthashOf(paytacaAnchor.address)]: [tx] }, headers: { [height]: paytacaAnchor.header } });
  await page.goto('/judges');
  const anchor = page.locator('[data-proof="anchor"]');
  await expect(anchor).toHaveAttribute('data-anchor', 'differs', { timeout: 20_000 });
  await expect(anchor.getByRole('status')).toHaveText(en.judges.anchorState.differs);

  // One server that answers differently from the others: no check mark, and the label names it.
  await routeChain(page, anchoredChain);
  const liar = await routeOneServer(page, 1);
  await page.reload();
  await expect(anchor).toHaveAttribute('data-anchor', 'unknown', { timeout: 20_000 });
  await expect(anchor.getByRole('status')).toHaveText(en.judges.anchorState.unknown);
  await expect(anchor.getByRole('status')).toHaveAttribute('title', new RegExp(`${liar} answered differently`));

  await page.routeWebSocket(chainServers, (ws) => ws.close());
  await page.reload();
  await expect(anchor).toHaveAttribute('data-anchor', 'unreachable', { timeout: 30_000 });
  await expect(anchor.getByRole('status')).toHaveText(en.judges.anchorState.unreachable);
});

test('blocked relays read as not found, never as verified', async ({ page }, info) => {
  if (desktop(info)) await page.setViewportSize({ width: 1440, height: 900 });
  await page.routeWebSocket(/^wss:\/\//, (ws) => ws.close());
  await page.goto('/judges');
  const live = page.locator('.jpanel--live');
  await expect(live.getByRole('alert')).toBeVisible({ timeout: 15_000 });
  await expect(live).not.toHaveAttribute('data-state', 'verified', { timeout: 20_000 });
  await expect(live.locator('.chip')).toHaveCount(0);
  await expect(live.locator('.jrelays')).toHaveAttribute('data-answered', '0');
  await expectOneScreen(page);
});
