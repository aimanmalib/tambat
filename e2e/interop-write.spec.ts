/**
 * The write form and a read dialect (docs/decisions/0024-claim-write-form.md). Link publishes a new claim as `bch:q…`,
 * the address without its prefix, to this spec's own fake relay. Look up reads a real mainnet event from another client
 * written `["i", "bitcoincash:q…", "<txid>"]`, with the proof transaction on a fake chain server
 * (tests/fixtures/dialect-bitcoincash-mainnet.json). Nothing is sent to a real relay or chain.
 */
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { config } from '../src/config.js';
import { toNpub, type Event } from '../src/core/nostr.js';
import type { FakeChain } from '../tests/fake-fulcrum.js';
import { startFakeRelay } from './fake-relay.js';
import { en, expect, expectAccessible, expectNoOverflow, fakeExtension, ms, routeChain, routeRelays, test, vectors } from './fixtures.js';
import { E2E } from './ports.js';

const fx = JSON.parse(readFileSync(new URL('../tests/fixtures/dialect-bitcoincash-mainnet.json', import.meta.url), 'utf8')) as {
  address: string;
  txid: string;
  raw: string[];
  sources: Record<string, string[]>;
  event: Event;
};
const npub = toNpub(fx.event.pubkey);
const RELAY_PORT = E2E.relayPort + 100;
const chain: FakeChain = {
  history: { proof: [{ hex: fx.raw.join(''), txid: fx.txid, height: 0 }, ...Object.entries(fx.sources).map(([txid, hex]) => ({ hex: hex.join(''), txid, height: 0 }))] },
  headers: {},
};
const exact = (name: string) => ({ name, exact: true });

let relay: ReturnType<typeof startFakeRelay>;
test.beforeAll(() => {
  relay = startFakeRelay(RELAY_PORT);
  relay.events.set(fx.event.id, fx.event);
});
test.afterAll(() => relay.close());

async function useRelay(page: Page) {
  await routeRelays(page, `ws://127.0.0.1:${RELAY_PORT}`);
  await routeChain(page, chain);
}

test('Link publishes a new claim as bch:q…, without the CashAddr prefix', async ({ page }) => {
  await fakeExtension(page);
  await useRelay(page);
  const address = vectors.bch.address.bitcoincash;
  await page.goto('/link');
  await page.getByRole('button', exact(en.nostr.extension)).click();
  await page.getByText(en.bch.paste).click();
  await page.getByLabel(en.bch.addressLabel, { exact: true }).fill(address);
  await page.getByLabel(en.bch.signatureLabel, { exact: true }).fill(vectors.bchSignature);
  await page.getByRole('button', exact(en.bch.pasteCheck)).click();
  await page.getByRole('button', exact(en.link.publish)).click();
  const n = String(config.nostr.relays.length);
  await expect(page.getByText(en.link.result.replace('{ok}', n).replace('{total}', n))).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.check[data-status="fail"]')).toHaveCount(0);
  const published = [...relay.events.values()].find((e) => e.pubkey === vectors.nostr.pubkey && e.kind === config.nostr.bindingKind);
  expect(published?.tags.filter((t) => t[0] === 'i')).toEqual([['i', `bch:${address.split(':')[1]}`, vectors.bchSignature]]);
});

test('Look up verifies a bitcoincash: claim with a bare txid, by npub and by address', async ({ page }) => {
  await useRelay(page);
  for (const q of [npub, fx.address]) {
    await page.goto(`/lookup?q=${q}`);
    const result = page.locator(`.result[data-ok="true"]`);
    await expect(result.locator('.badge--ok').first()).toHaveText(en.lookup.verified, { timeout: 30_000 });
    await expect(result.locator('[data-proof-form="tx"]')).toContainText(en.lookup.proofTx);
    await expect(result.locator('[data-proof-form="tx"] [title]').first()).toHaveAttribute('title', fx.txid);
  }
  await expectAccessible(page);
});

test('in Malay at 320 px the dialect result fits without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/');
  await page.getByLabel(en.lang.label).selectOption('ms');
  await useRelay(page);
  await page.goto(`/lookup?q=${npub}`);
  await expect(page.locator('.result .badge--ok').first()).toHaveText(ms.lookup.verified, { timeout: 30_000 });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expectNoOverflow(page);
});
