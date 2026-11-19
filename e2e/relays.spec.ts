/**
 * Which relays answered, on Look up and on the wall. Of the configured relays, the first closes every connection before
 * answering (as a relay refusing the handshake does), the second accepts and never answers, and the rest go to the
 * in-memory relay. Every configured relay must be listed with its own state, and only the answering ones with a time.
 */
import type { Page } from '@playwright/test';
import WebSocket from 'ws';
import { config } from '../src/config.js';
import { en, expect, expectAccessible, expectNoOverflow, ms, test, vectors } from './fixtures.js';
import { E2E } from './ports.js';

const relays = config.nostr.relays;
const host = (url: string) => url.replace(/^wss:\/\//, '');
const exactUrl = (url: string) => new RegExp(`^${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?$`);
const fill = (text: string, vars: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
const refusing = relays[0] ?? '';
const silent = relays[1] ?? '';

/** Puts the public test phrase's binding on the in-memory relay, as the link flow would. */
async function publishBinding() {
  const ws = new WebSocket(E2E.relayUrl);
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => ws.send(JSON.stringify(['EVENT', vectors.bindingEvent])));
    ws.on('message', () => resolve());
    ws.on('error', reject);
  });
  ws.close();
}

/** Registered after the fixture's relay route, so these two relays get their own behaviour. */
async function breakTwoRelays(page: Page) {
  await page.routeWebSocket(exactUrl(refusing), (ws) => ws.close());
  await page.routeWebSocket(exactUrl(silent), () => undefined);
}

async function expectStates(page: Page, text: typeof en) {
  const box = page.locator('.relay-answers');
  const answered = relays.length - 2;
  await expect(box).toHaveAttribute('data-answered', String(answered));
  await expect(box).toHaveAttribute('data-total', String(relays.length));
  await expect(box.locator('summary')).toHaveText(fill(text.relays.summary, { answered, total: relays.length }));
  await box.locator('summary').click();
  for (const relay of relays) {
    const row = box.locator(`li[data-relay="${host(relay)}"]`);
    const state = relay === refusing ? 'refused' : relay === silent ? 'silent' : 'answered';
    await expect(row).toHaveAttribute('data-state', state);
    await expect(row).toContainText(text.relays[state]);
    await expect(row.locator('.relays__time')).toHaveCount(state === 'silent' ? 0 : 1);
  }
}

test.beforeAll(publishBinding);

test('Look up lists every configured relay as answered, refused or silent, in English and Malay', async ({ page }) => {
  test.setTimeout(60_000);
  await breakTwoRelays(page);
  await page.goto(`/lookup?q=${vectors.nostr.npub}`);
  await expect(page.locator('.result[data-ok="true"]')).toBeVisible({ timeout: 20_000 });
  await expectStates(page, en);
  await expectNoOverflow(page);
  await expectAccessible(page);

  await page.goto(`/lookup?q=${vectors.nostr.npub}&lang=ms`);
  await expect(page.locator('.result[data-ok="true"]')).toBeVisible({ timeout: 20_000 });
  await expectStates(page, ms as typeof en);
  await expectNoOverflow(page);
});

test('the wall lists every configured relay with its state', async ({ page }) => {
  test.setTimeout(60_000);
  await breakTwoRelays(page);
  await page.goto('/wall');
  await expect(page.locator('.relay-answers')).toBeVisible({ timeout: 30_000 });
  await expectStates(page, en);
  await expectNoOverflow(page);
});
