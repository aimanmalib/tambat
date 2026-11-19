/**
 * The badge on another site: a local host page (its own origin) frames /embed/<npub> directly and loads /embed.js
 * for an address. Both badges check the binding on (fake) relays in the browser; blocked relays read as unreachable.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { secp256k1 } from '@bitauth/libauth';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import WebSocket from 'ws';
import { join } from 'node:path';
import type { FrameLocator, Page, TestInfo } from '@playwright/test';
import config from '../config/tambat.json' with { type: 'json' };
import { addressFromPublicKey } from '../src/core/cashaddr.js';
import { toNpub } from '../src/core/nostr.js';
import { bindingFromKeys } from '../src/core/paytaca.js';
import { en, expect, expectAccessible, ms, test } from './fixtures.js';
import { E2E } from './ports.js';

/**
 * The host site: a real HTTP server on 127.0.0.1 at another port, so it is another origin in the same (loopback)
 * address space as the badge server; browsers block a public page from loading loopback resources.
 */
const pages = new Map<string, string>();
let host: Server;
let HOST = '';
test.beforeAll(async () => {
  host = createServer((req, res) => {
    const body = pages.get(req.url ?? '');
    res.writeHead(body ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' }).end(body ?? '');
  });
  await new Promise<void>((done) => host.listen(0, '127.0.0.1', done));
  HOST = `http://127.0.0.1:${(host.address() as AddressInfo).port}`;
});
test.afterAll(() => new Promise<void>((done) => host.close(() => done())));

/**
 * Review screenshot when SHOTS_DIR is set; nothing otherwise. WebKit injects a stylesheet into every frame while it
 * takes the picture, which the badge policy refuses; that one message, logged during the screenshot, is dropped.
 */
async function shot(page: Page, info: TestInfo, errors: string[], name: string) {
  const dir = process.env.SHOTS_DIR ?? '';
  if (!dir) return;
  const before = errors.length;
  await page.screenshot({ path: join(dir, `i5-${info.project.name}-${name}.png`), fullPage: true, caret: 'initial' });
  await page.waitForTimeout(300);
  const after = errors.splice(before).filter((e) => !e.startsWith('Refused to apply a stylesheet'));
  errors.push(...after);
}

function freshKeys() {
  const nostrSecretKey = generateSecretKey();
  const bchPrivateKey = generateSecretKey();
  const address = addressFromPublicKey(secp256k1.derivePublicKeyCompressed(bchPrivateKey) as Uint8Array, 'bitcoincash');
  return { nostrSecretKey, bchPrivateKey, address, npub: toNpub(getPublicKey(nostrSecretKey)) };
}

function publish(event: object): Promise<void> {
  return new Promise((done, fail) => {
    const ws = new WebSocket(E2E.relayUrl);
    ws.on('open', () => ws.send(JSON.stringify(['EVENT', event])));
    ws.on('message', (data) => {
      const [type, , ok] = JSON.parse(String(data)) as [string, string, boolean];
      if (type !== 'OK') return;
      ws.close();
      if (ok) done();
      else fail(new Error('fake relay refused the event'));
    });
    ws.on('error', fail);
  });
}

/** Opens a page on another origin that embeds one badge as an iframe and one through the script. */
async function hostPage(page: Page, frameId: string, scriptId: string) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Host</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main><h1>Host site</h1>
<iframe id="direct" src="${E2E.origin}/embed/${frameId}" width="${config.embed.width}" height="${config.embed.height}" title="${en.embed.title}" style="border:0"></iframe>
<script src="${E2E.origin}/embed.js" data-tambat-id="${scriptId}" data-lang="ms"></script>
</main></body></html>`;
  const path = `/host-${pages.size}`;
  pages.set(path, html);
  await page.goto(`${HOST}${path}`);
  await expect(page.locator('iframe')).toHaveCount(2);
  return { direct: page.frameLocator('#direct'), viaScript: page.frameLocator('iframe:not(#direct)') };
}

async function expectFits(page: Page, frame: FrameLocator) {
  const box = await page.locator('iframe').first().boundingBox();
  expect(box?.width).toBeLessThanOrEqual(320);
  expect(box?.height).toBeLessThanOrEqual(96);
  const size = await frame.locator('html').evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight }));
  expect(size.sw).toBeLessThanOrEqual(size.cw);
  expect(size.sh).toBeLessThanOrEqual(size.ch);
}

test('a site embeds the badge by iframe and by script; both verify on relays', async ({ page, consoleErrors }, info) => {
  const keys = freshKeys();
  await publish(bindingFromKeys(keys, Math.floor(Date.now() / 1000)));
  const { direct, viaScript } = await hostPage(page, keys.npub, keys.address);

  const bare = keys.address.replace('bitcoincash:', '');
  await expect(direct.locator('.embed[data-state="verified"]')).toBeVisible();
  await expect(direct.locator('.embed__state')).toHaveText(en.embed.verified);
  await expect(direct.locator('.embed__detail')).toContainText(keys.npub.slice(0, 10));
  await expect(direct.locator('.embed__detail')).toContainText(bare.slice(-6));
  await expect(direct.getByRole('link', { name: en.embed.open })).toHaveAttribute('href', `/lookup?q=${encodeURIComponent(keys.npub)}&lang=en`);

  await expect(viaScript.locator('.embed[data-state="verified"]')).toBeVisible();
  await expect(viaScript.locator('.embed__state')).toHaveText(ms.embed.verified);
  await expect(viaScript.locator('html')).toHaveAttribute('lang', 'ms');
  await expect(page.locator('iframe:not(#direct)')).toHaveAttribute('title', ms.embed.title);
  await expect(viaScript.locator('.embed__detail')).toContainText(bare.slice(-6));

  await expectFits(page, direct);
  await expectFits(page, viaScript);
  await expectAccessible(page);
  await shot(page, info, consoleErrors, 'verified');
});

test('an identity without a binding reads as not linked; a bad id says so', async ({ page }) => {
  const { direct, viaScript } = await hostPage(page, freshKeys().npub, 'alice-at-example');
  await expect(direct.locator('.embed[data-state="not_linked"] .embed__state')).toHaveText(en.embed.notLinked);
  await expect(viaScript.locator('.embed[data-state="bad_input"] .embed__state')).toHaveText(ms.embed.badInput);
});

test('blocked relays read as unreachable, not as not linked', async ({ page, consoleErrors }, info) => {
  const keys = freshKeys();
  await publish(bindingFromKeys(keys, Math.floor(Date.now() / 1000)));
  await page.routeWebSocket(/^wss:\/\//, (ws) => ws.close());
  const { direct, viaScript } = await hostPage(page, keys.npub, keys.address);
  await expect(direct.locator('.embed[data-state="unreachable"] .embed__state')).toHaveText(en.embed.unreachable);
  await expect(viaScript.locator('.embed[data-state="unreachable"] .embed__state')).toHaveText(ms.embed.unreachable);
  await shot(page, info, consoleErrors, 'unreachable');
});

test('Look up offers the embed code; pasted into another site, both snippets verify', async ({ page, context, consoleErrors }, info) => {
  const keys = freshKeys();
  await publish(bindingFromKeys(keys, Math.floor(Date.now() / 1000)));

  await page.goto('/judges');
  const judgesLink = page.locator('[data-req="discovery"] a[href$="&embed=1"]');
  await expect(judgesLink).toHaveText(en.judges.link.embed);
  await expect(judgesLink).toHaveAttribute('href', `/lookup?q=${encodeURIComponent(config.judges.sample.npub)}&embed=1`);

  await page.goto(`/lookup?q=${encodeURIComponent(keys.npub)}&embed=1&lang=ms`);
  const panel = page.locator('details[data-embed]');
  await expect(panel).toHaveAttribute('open', '');
  await expect(panel.locator('summary')).toHaveText(ms.lookup.embed.title);
  const codes = panel.locator('.value__text');
  await expect(codes).toHaveCount(2);
  const [script, iframe] = await codes.allTextContents();
  expect(script).toContain(`data-tambat-id="${keys.npub}"`);
  expect(iframe).toContain(`${E2E.origin}/embed/${keys.npub}?lang=ms`);

  if (info.project.name === 'chromium') {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await panel.getByRole('button', { name: `${ms.common.copy}: ${ms.lookup.embed.iframe}` }).click();
    await expect(panel.getByText(ms.common.copied)).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(iframe);
  }

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await panel.scrollIntoViewIfNeeded();
    const fit = await page.evaluate(() => {
      const card = document.querySelector('.result') as HTMLElement;
      return { pageSw: document.documentElement.scrollWidth, pageCw: document.documentElement.clientWidth, cardSw: card.scrollWidth, cardCw: card.clientWidth };
    });
    expect(fit.pageSw).toBeLessThanOrEqual(fit.pageCw);
    expect(fit.cardSw).toBeLessThanOrEqual(fit.cardCw);
  }
  await expectAccessible(page);
  await shot(page, info, consoleErrors, 'lookup-embed');

  const path = `/host-${pages.size}`;
  pages.set(path, `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Host</title></head><body><main><h1>Pasted</h1>
${iframe}
${script}
</main></body></html>`);
  await page.goto(`${HOST}${path}`);
  await expect(page.locator('iframe')).toHaveCount(2);
  for (const frame of [page.frameLocator('iframe').first(), page.frameLocator('iframe').last()]) {
    await expect(frame.locator('.embed[data-state="verified"] .embed__state')).toHaveText(ms.embed.verified);
    await expect(frame.locator('.embed__detail')).toContainText(keys.npub.slice(0, 10));
  }
});
