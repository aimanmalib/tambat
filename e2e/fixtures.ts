/**
 * Test fixtures: relays are faked by routing every wss:// connection from the page to the local fake relay, and a
 * NIP-07 extension is faked with the key from the public test phrase. Console errors fail the test.
 */
import AxeBuilder from '@axe-core/playwright';
import { test as base, expect, type Page } from '@playwright/test';
import WebSocket from 'ws';
import { finalizeEvent } from 'nostr-tools/pure';
import type { EventTemplate } from 'nostr-tools/pure';
import en from '../lang/en.json' with { type: 'json' };
import ms from '../lang/ms.json' with { type: 'json' };
import vectors from '../examples/vectors.json' with { type: 'json' };
import { secp256k1 } from '@bitauth/libauth';
import { addressFromPublicKey } from '../src/core/cashaddr.js';
import { keysFromPhrase } from '../src/core/paytaca.js';
import { E2E } from './ports.js';

export { en, ms, vectors };
export const phraseKeys = keysFromPhrase(vectors.phrase, 'bitcoincash');
/** A valid address of a different key (the Nostr secret used as a BCH key), for the wrong-signer case. */
export const otherAddress = addressFromPublicKey(secp256k1.derivePublicKeyCompressed(phraseKeys.nostrSecretKey) as Uint8Array, 'bitcoincash');

async function routeRelays(page: Page) {
  await page.routeWebSocket(/^wss:\/\//, (ws) => {
    const upstream = new WebSocket(E2E.relayUrl);
    const queue: string[] = [];
    upstream.on('open', () => queue.splice(0).forEach((m) => upstream.send(m)));
    upstream.on('message', (data) => ws.send(String(data)));
    upstream.on('close', () => ws.close());
    upstream.on('error', () => ws.close());
    ws.onMessage((m) => {
      const text = String(m);
      if (upstream.readyState === WebSocket.OPEN) upstream.send(text);
      else queue.push(text);
    });
    ws.onClose(() => upstream.close());
  });
}

/** Installs window.nostr backed by the test phrase's Nostr key. Call before the first navigation. */
export async function fakeExtension(page: Page) {
  await page.exposeFunction('__tambatSign', (template: EventTemplate) => finalizeEvent(template, phraseKeys.nostrSecretKey));
  await page.addInitScript((pubkey: string) => {
    const w = window as unknown as { nostr: unknown; __tambatSign: (t: unknown) => Promise<unknown> };
    w.nostr = { getPublicKey: async () => pubkey, signEvent: (t: unknown) => w.__tambatSign(t) };
  }, phraseKeys.nostrPubkey);
}

export async function expectAccessible(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

export async function expectNoOverflow(page: Page) {
  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
}

const allowedFailedLoads = new WeakMap<Page, string[]>();

/** Lets a test expect the browser to log a failed load for a path, for a request the server is meant to refuse. */
export function allowFailedLoad(page: Page, path: string) {
  allowedFailedLoads.set(page, [...(allowedFailedLoads.get(page) ?? []), path]);
}

export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (msg) => {
        // Asking for the session before signing in answers 401 by design; browsers log that as a failed load.
        const allowed = ['/api/rp/session', ...(allowedFailedLoads.get(page) ?? [])];
        if (msg.type() === 'error' && !allowed.some((path) => msg.location().url.endsWith(path))) errors.push(msg.text());
      });
      await routeRelays(page);
      await use(errors);
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
