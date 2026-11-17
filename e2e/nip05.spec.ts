/**
 * Pay and look up by NIP-05 name. The name's domain is faked by routing its https://<domain>/.well-known/nostr.json
 * request in the page; the binding comes from the in-memory relay as usual.
 */
import { join } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import WebSocket from 'ws';
import { allowFailedLoad, en, expect, expectAccessible, expectNoOverflow, ms, phraseKeys, test, vectors } from './fixtures.js';
import { E2E } from './ports.js';

const DOMAIN = 'names.example.test';
const address = vectors.bch.address.bitcoincash;
const exact = (name: string) => ({ name, exact: true });
const fill = (text: string, vars: Record<string, string>) => text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
/** A key that never published a binding. */
const UNBOUND = '0'.repeat(63) + '1';

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

/** The fake domain: alice is bound, nobody is a key without a binding, down does not answer. */
async function fakeDomain(page: Page) {
  allowFailedLoad(page, '/.well-known/nostr.json?name=down');
  await page.route(`https://${DOMAIN}/.well-known/nostr.json**`, async (route) => {
    const name = new URL(route.request().url()).searchParams.get('name') ?? '';
    if (name === 'down') return route.abort('connectionrefused');
    const names: Record<string, string> = { alice: phraseKeys.nostrPubkey, nobody: UNBOUND };
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ names: name in names ? { [name]: names[name] } : {} }),
    });
  });
}

/** Review screenshot when SHOTS_DIR is set; nothing otherwise. */
async function shot(page: Page, info: TestInfo, name: string) {
  const dir = process.env.SHOTS_DIR ?? '';
  if (dir) await page.screenshot({ path: join(dir, `i4-${info.project.name}-${name}.png`), fullPage: true, caret: 'initial' });
}

test.beforeAll(publishBinding);

test('pay a NIP-05 name: domain gives the key, the relay binding gives the address', async ({ page }, info) => {
  await fakeDomain(page);
  await page.goto('/pay');
  await page.getByLabel(en.pay.label).fill(`Alice@${DOMAIN}`);
  await page.getByRole('button', exact(en.pay.find)).click();
  await expect(page.getByText(fill(en.nip05.points, { name: `alice@${DOMAIN}`, npub: vectors.nostr.npub }))).toBeVisible();
  await expect(page.getByText(address).first()).toBeVisible();
  await page.getByLabel(en.pay.amount).fill('0.002');
  await expect(page.getByRole('link', exact(en.pay.open))).toHaveAttribute('href', `${address}?amount=0.002`);
  await expect(page.getByRole('img', exact(en.pay.qr))).toBeVisible();
  await shot(page, info, 'pay');
  await expectAccessible(page);
});

test('names that do not lead to a verified address say why', async ({ page }) => {
  await fakeDomain(page);
  await page.goto('/pay');
  const input = page.getByLabel(en.pay.label);
  const find = page.getByRole('button', exact(en.pay.find));

  await input.fill(`bob@${DOMAIN}`);
  await find.click();
  await expect(page.getByText(fill(en.nip05.unknown_name, { name: `bob@${DOMAIN}` }))).toBeVisible();

  await input.fill(`nobody@${DOMAIN}`);
  await find.click();
  await expect(page.getByText(en.pay.none)).toBeVisible();
  await expect(page.getByRole('img', exact(en.pay.qr))).toHaveCount(0);

  await input.fill(`down@${DOMAIN}`);
  await find.click();
  await expect(page.getByText(fill(en.nip05.unreachable, { name: `down@${DOMAIN}` }))).toBeVisible();

  await input.fill(address);
  await find.click();
  await expect(page.getByText(en.pay.inputError)).toBeVisible();
  await expectAccessible(page);
});

test('look up a name in Malay on a 320 px screen', async ({ page }, info) => {
  await fakeDomain(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(`/lookup?lang=ms&q=${encodeURIComponent(`alice@${DOMAIN}`)}`);
  await expect(page.getByText(fill(ms.nip05.points, { name: `alice@${DOMAIN}`, npub: vectors.nostr.npub }))).toBeVisible();
  await expect(page.locator('.result[data-ok="true"]')).toHaveCount(1);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expectNoOverflow(page);
  await shot(page, info, 'lookup-320-ms');
  await expectAccessible(page);
});
