/**
 * The one-file verifier, opened from disk: it finds and checks a binding through relays only. Any request that is
 * not the file itself fails the test, and so does any request to the Tambat origin (the test server or the site).
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { secp256k1 } from '@bitauth/libauth';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import WebSocket from 'ws';
import type { Page } from '@playwright/test';
import config from '../config/tambat.json' with { type: 'json' };
import { addressFromPublicKey } from '../src/core/cashaddr.js';
import { toNpub } from '../src/core/nostr.js';
import { bindingFromKeys } from '../src/core/paytaca.js';
import { en, expect, expectAccessible, expectNoOverflow, ms, test } from './fixtures.js';
import { E2E } from './ports.js';

const FILE = pathToFileURL(resolve(import.meta.dirname, '..', 'dist-verifier', 'tambat-verify.html')).href;
const exact = (name: string) => ({ name, exact: true });

/** A fresh identity per run, so bindings other tests publish to the shared fake relay never interfere. */
function freshKeys() {
  const nostrSecretKey = generateSecretKey();
  const bchPrivateKey = generateSecretKey();
  const bchPublicKey = secp256k1.derivePublicKeyCompressed(bchPrivateKey) as Uint8Array;
  const nostrPubkey = getPublicKey(nostrSecretKey);
  return { nostrSecretKey, bchPrivateKey, address: addressFromPublicKey(bchPublicKey, 'bitcoincash'), npub: toNpub(nostrPubkey) };
}

function publish(event: object): Promise<void> {
  return new Promise((done, fail) => {
    const ws = new WebSocket(E2E.relayUrl);
    ws.on('open', () => ws.send(JSON.stringify(['EVENT', event])));
    ws.on('message', (data) => {
      const [type, , ok] = JSON.parse(String(data)) as [string, string, boolean];
      if (type === 'OK') {
        ws.close();
        if (ok) done();
        else fail(new Error('fake relay refused the event'));
      }
    });
    ws.on('error', fail);
  });
}

/** Records every request; requests to the Tambat origin are also aborted so they cannot succeed by accident. */
async function watchRequests(page: Page): Promise<string[]> {
  const seen: string[] = [];
  page.on('request', (r) => seen.push(r.url()));
  for (const origin of [E2E.origin, config.site.publicUrl]) {
    await page.route(`${origin}/**`, (route) => route.abort());
  }
  return seen;
}
const offDisk = (urls: string[]) => urls.filter((u) => !u.startsWith('file:') && !u.startsWith('data:'));

test('from disk: look up by npub and by address through relays only', async ({ page }) => {
  const keys = freshKeys();
  const binding = bindingFromKeys(keys, Math.floor(Date.now() / 1000));
  await publish(binding);
  const requests = await watchRequests(page);

  await page.goto(FILE);
  await expect(page.getByRole('heading', exact(en.verifier.title))).toBeVisible();
  await expect(page.getByLabel(en.verifier.relaysLabel, { exact: true })).toHaveValue(config.nostr.relays.join('\n'));

  for (const query of [keys.npub, keys.address]) {
    await page.getByLabel(en.verifier.inputLabel, { exact: true }).fill(query);
    await page.getByRole('button', exact(en.verifier.submit)).click();
    const result = page.locator('.result[data-ok="true"]');
    await expect(result).toHaveCount(1);
    await expect(result.locator('.facts')).toContainText(keys.npub);
    await expect(result.locator('.facts')).toContainText(keys.address);
    await expect(result.locator('[data-status="fail"]')).toHaveCount(0);
    await expect(result.locator('[data-step="newest"]')).toHaveAttribute('data-status', 'pass');
  }
  await expectNoOverflow(page);
  await expectAccessible(page);
  expect(offDisk(requests)).toEqual([]);
});

test('from disk: a pasted event is checked without relays and an edit names the failing step', async ({ page }) => {
  const keys = freshKeys();
  const binding = bindingFromKeys(keys, Math.floor(Date.now() / 1000));
  const requests = await watchRequests(page);
  await page.goto(FILE);

  await page.getByLabel(en.verifier.inputLabel, { exact: true }).fill(JSON.stringify(binding));
  await page.getByRole('button', exact(en.verifier.submit)).click();
  await expect(page.getByText(en.verifier.pastedNote)).toBeVisible();
  await expect(page.locator('.result[data-ok="true"] [data-step="newest"]')).toHaveAttribute('data-status', 'skip');

  await page.getByLabel(en.verifier.inputLabel, { exact: true }).fill(JSON.stringify({ ...binding, content: 'edited after signing' }));
  await page.getByRole('button', exact(en.verifier.submit)).click();
  await expect(page.locator('.result[data-ok="false"] [data-step="event_id"]')).toHaveAttribute('data-status', 'fail');
  expect(offDisk(requests)).toEqual([]);
});

test('from disk in Malay at 320 px: same checks, no horizontal overflow', async ({ page }) => {
  const keys = freshKeys();
  await publish(bindingFromKeys(keys, Math.floor(Date.now() / 1000)));
  const requests = await watchRequests(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(`${FILE}?lang=ms`);
  await expect(page.getByRole('heading', exact(ms.verifier.title))).toBeVisible();
  await page.getByLabel(ms.verifier.inputLabel, { exact: true }).fill(keys.address);
  await page.getByRole('button', exact(ms.verifier.submit)).click();
  await expect(page.locator('.result[data-ok="true"]')).toHaveCount(1);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expectNoOverflow(page);
  await expectAccessible(page);
  expect(offDisk(requests)).toEqual([]);
});

test('served at /verify/ as one file under its hash-based policy', async ({ page, request }) => {
  const res = await request.get('/verify/');
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).not.toMatch(/<script[^>]*\ssrc=/);
  expect(res.headers()['content-security-policy']).toContain("frame-ancestors 'none'");

  const keys = freshKeys();
  await publish(bindingFromKeys(keys, Math.floor(Date.now() / 1000)));
  await page.goto('/verify/');
  await page.getByLabel(en.verifier.inputLabel, { exact: true }).fill(keys.npub);
  await page.getByRole('button', exact(en.verifier.submit)).click();
  await expect(page.locator('.result[data-ok="true"]')).toHaveCount(1);
});

test('look-up links to the verifier page and its download', async ({ page }) => {
  await page.goto('/lookup');
  await expect(page.getByRole('link', exact(en.verifier.open))).toHaveAttribute('href', '/verify/');
  const download = page.getByRole('link', exact(en.verifier.download));
  await expect(download).toHaveAttribute('href', '/verify/tambat-verify.html');
  await expect(download).toHaveAttribute('download', '');
  await page.getByRole('link', exact(en.verifier.open)).click();
  await expect(page.getByRole('heading', exact(en.verifier.title))).toBeVisible();
});
