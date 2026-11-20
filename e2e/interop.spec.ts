/**
 * Bindings by another NIP-39 client (docs/decisions/0021-tx-proof.md): a real mainnet event whose first claim is an
 * on-chain proof `tx:<txid>` and whose second is a signed message on an address written without prefix. The event sits on
 * this spec's own fake relay; the chain servers are a fake Fulcrum holding the real proof transaction and the one it spends
 * (tests/fixtures/tx-proof-mainnet.json). Nothing is sent to a real relay or chain.
 */
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import WebSocket from 'ws';
import type { Event } from '../src/core/nostr.js';
import { toNpub } from '../src/core/nostr.js';
import type { FakeChain } from '../tests/fake-fulcrum.js';
import { startFakeRelay } from './fake-relay.js';
import { chainServers, en, expect, expectAccessible, expectNoOverflow, ms, routeChain, test } from './fixtures.js';
import { E2E } from './ports.js';

const fx = JSON.parse(readFileSync(new URL('../tests/fixtures/tx-proof-mainnet.json', import.meta.url), 'utf8')) as {
  txid: string;
  raw: string;
  sources: Record<string, string>;
  event: Event;
};
const npub = toNpub(fx.event.pubkey);
const RELAY_PORT = E2E.relayPort + 90;
/** The proof transaction and the transaction it spends, under a script hash nothing asks for: only `transaction.get` finds them. */
const chain: FakeChain = {
  history: { proof: [{ hex: fx.raw, txid: fx.txid, height: 0 }, ...Object.entries(fx.sources).map(([txid, hex]) => ({ hex, txid, height: 0 }))] },
  headers: {},
};

let relay: ReturnType<typeof startFakeRelay>;
test.beforeAll(() => {
  relay = startFakeRelay(RELAY_PORT);
  relay.events.set(fx.event.id, fx.event);
});
test.afterAll(() => relay.close());

/** Every relay connection goes to this spec's relay; chain servers are routed after, so they win. */
async function useRelay(page: Page, withChain: boolean) {
  await page.routeWebSocket(/^wss:\/\//, (ws) => {
    const upstream = new WebSocket(`ws://127.0.0.1:${RELAY_PORT}`);
    const queue: string[] = [];
    upstream.on('open', () => queue.splice(0).forEach((m) => upstream.send(m)));
    upstream.on('message', (data) => ws.send(String(data)));
    upstream.on('close', () => ws.close());
    upstream.on('error', () => ws.close());
    ws.onMessage((m) => (upstream.readyState === WebSocket.OPEN ? upstream.send(String(m)) : queue.push(String(m))));
    ws.onClose(() => upstream.close());
  });
  if (withChain) await routeChain(page, chain);
  else await page.routeWebSocket(chainServers, (ws) => ws.close());
}

test('Look up verifies an on-chain proof from another client and labels both proof forms', async ({ page }) => {
  await useRelay(page, true);
  await page.goto(`/lookup?q=${npub}`);
  const result = page.locator('.result');
  await expect(result.locator('.badge--ok').first()).toHaveText(en.lookup.verified, { timeout: 30_000 });
  await expect(result.locator('[data-proof-form="tx"]')).toContainText(en.lookup.proofTx);
  await expect(result.locator('[data-proof-form="tx"] [title]').first()).toHaveAttribute('title', fx.txid);
  await expect(result.locator('[data-proof-form="message"]')).toContainText(en.lookup.proofMessage);
  await expect(result.getByText(en.steps.tx_text, { exact: true })).toBeVisible();
  await expectNoOverflow(page);
  await expectAccessible(page);
});

test('without the chain the on-chain proof is not checked and the binding does not pass', async ({ page }) => {
  await useRelay(page, false);
  await page.goto(`/lookup?q=${npub}`);
  const result = page.locator('.result');
  await expect(result.locator('.badge--fail').first()).toHaveText(en.lookup.failed, { timeout: 40_000 });
  await expect(result.getByText(en.steps.reasons.chain_unreadable).first()).toBeVisible();
});

test('the wall lists it as an on-chain proof, in Malay at 320 px without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/');
  await page.getByLabel(en.lang.label).selectOption('ms');
  await useRelay(page, true);
  await page.goto('/wall');
  const card = page.locator(`.wall__card[data-event="${fx.event.id}"]`);
  await expect(card.locator('[data-proof-form="tx"]')).toHaveText(ms.lookup.proofTx, { timeout: 30_000 });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expectNoOverflow(page);
  const widths = await card.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
});
