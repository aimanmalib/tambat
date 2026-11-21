/**
 * The optional BCH anchor on the look-up page. Chain servers are a fake Fulcrum (Electrum JSON-RPC over WebSocket,
 * tests/fake-fulcrum.ts) and the wallet is a fake WalletConnect client that answers `bch_signTransaction` the way
 * Paytaca does: extended JSON params in, `{ signedTransaction, signedTransactionHash }` out. Nothing is sent anywhere.
 */
import type { Page } from '@playwright/test';
import WebSocket from 'ws';
import { hexToBin, type Input, type Output, type TransactionCommon } from '@bitauth/libauth';
import { buildAnchorTransaction, commitmentFromTransaction, txidOf } from '../src/core/anchor.js';
import { scripthashOf } from '../src/core/anchor-chain.js';
import { signP2pkh, hexOf } from '../tests/anchor-wallet.js';
import { headerWithTime, type FakeChain } from '../tests/fake-fulcrum.js';
import { chainServers, en, expect, expectAccessible, expectNoOverflow, ms, phraseKeys, routeChain, test, vectors } from './fixtures.js';
import { E2E } from './ports.js';

const exact = (name: string) => ({ name, exact: true });
const address = vectors.bch.address.bitcoincash;
const payload = { pubkey: vectors.nostr.pubkey, eventId: vectors.bindingEvent.id };
const before = (text: string) => text.split('{')[0] ?? text;

function anchoredChain(): FakeChain {
  const unsigned = buildAnchorTransaction(address, [{ txid: '33'.repeat(32), vout: 0, satoshis: 4000 }], payload);
  const bytes = signP2pkh(unsigned.transaction, unsigned.sourceOutputs, phraseKeys.bchPrivateKey);
  return {
    history: { [scripthashOf(address)]: [{ hex: hexOf(bytes), txid: txidOf(bytes), height: 900_010 }] },
    headers: { 900_010: headerWithTime(Date.UTC(2026, 10, 18) / 1000) },
  };
}
const coins: FakeChain = {
  history: {},
  headers: {},
  unspent: { [scripthashOf(address)]: [{ tx_hash: '44'.repeat(32), tx_pos: 1, value: 20_000, height: 900_000 }] },
};
/** The coins are still in the mempool (Electrum height 0), as after a fresh payment to the bound address. */
const pendingCoins: FakeChain = {
  history: {},
  headers: {},
  unspent: { [scripthashOf(address)]: [{ tx_hash: '45'.repeat(32), tx_pos: 0, value: 50_000, height: 0 }] },
};

async function publishBinding(): Promise<void> {
  const ws = new WebSocket(E2E.relayUrl);
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => ws.send(JSON.stringify(['EVENT', vectors.bindingEvent])));
    ws.on('message', () => resolve());
    ws.on('error', reject);
  });
  ws.close();
}

/** Reads wc2-bch-bcr extended JSON ("<Uint8Array: 0x..>", "<bigint: ..n>") as Paytaca does. */
function parseExtended<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value), (_key, v: unknown) => {
    if (typeof v !== 'string') return v;
    const big = /^<bigint: (\d+)n>$/.exec(v);
    if (big) return BigInt(big[1]!);
    const bin = /^<Uint8Array: 0x([0-9a-f]*)>$/.exec(v);
    return bin ? hexToBin(bin[1]!) : v;
  }) as T;
}

/**
 * A WalletConnect wallet holding the test phrase's BCH key; it signs transactions with that key and records requests.
 * With `refuse`, it answers a signing request with that plain JSON-RPC error object, as Paytaca does when you reject.
 */
async function fakeWallet(page: Page, refuse?: { code: number; message: string }) {
  await page.exposeFunction('__walletSignTx', (params: unknown) => {
    const p = parseExtended<{ transaction: TransactionCommon; sourceOutputs: (Input & Output)[] }>(params);
    const bytes = signP2pkh(p.transaction, p.sourceOutputs, phraseKeys.bchPrivateKey);
    return { signedTransaction: hexOf(bytes), signedTransactionHash: txidOf(bytes) };
  });
  await page.addInitScript(({ account, refuse }: { account: string; refuse: { code: number; message: string } | null }) => {
    const w = window as unknown as Record<string, unknown> & { __walletSignTx: (p: unknown) => Promise<unknown> };
    const requests: unknown[] = [];
    w.__requests = requests;
    w.__tambatSignClient = {
      init: async () => ({
        on: () => undefined,
        connect: async (opts: { requiredNamespaces: { bch: { methods: string[] } } }) => ({
          uri: 'wc:0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0@2?relay-protocol=irn&symKey=00',
          approval: () =>
            new Promise((resolve) => {
              w.__approve = () => resolve({ topic: 'fake-topic', namespaces: { bch: { accounts: [`bch:${account}`], methods: opts.requiredNamespaces.bch.methods, events: [] } } });
            }),
        }),
        request: async (req: { request: { method: string; params: unknown } }) => {
          requests.push(req.request);
          if (req.request.method !== 'bch_signTransaction') throw new Error('unsupported method');
          if (refuse) throw refuse;
          return w.__walletSignTx(req.request.params);
        },
      }),
    };
  }, { account: address, refuse: refuse ?? null });
}

/** Links the fake wallet on the Link page, then looks up the binding in the language of `text`. */
async function lookUpAsOwner(page: Page, text: typeof en, settled: string = text.anchor.none) {
  await page.goto('/');
  if (text === ms) await page.getByLabel(en.lang.label).selectOption('ms');
  await page.getByRole('button', exact(text.nostr.demo)).click();
  await page.getByRole('button', exact(text.bch.wcStart)).click();
  await page.evaluate(() => (window as unknown as { __approve: () => void }).__approve());
  await expect(page.locator('.keybadge__value').last()).toHaveText(address);
  await page.getByRole('link', exact(text.nav.lookup)).click();
  await page.getByLabel(text.lookup.label, { exact: true }).fill(vectors.nostr.npub);
  await page.getByRole('button', exact(text.lookup.submit)).click();
  // WebKit can take more than 5 s to read the relays and the chain on a shared host.
  await expect(page.getByText(settled)).toBeVisible({ timeout: 20_000 });
}

const walletRequests = (page: Page) => page.evaluate(() => (window as unknown as { __requests: unknown[] }).__requests);

test.beforeAll(publishBinding);

test('look-up reads the earliest anchor from the chain and shows its block', async ({ page }) => {
  await routeChain(page, anchoredChain());
  await page.goto(`/lookup?q=${vectors.nostr.npub}`);
  const anchor = page.locator('.anchor');
  await expect(anchor).toHaveAttribute('data-anchor', 'anchored', { timeout: 20_000 });
  await expect(anchor.getByText(before(en.anchor.since))).toBeVisible();
  await expect(anchor).toContainText('900010');
  await expect(anchor.locator('.anchor__tx code')).toHaveAttribute('data-full', anchoredChain().history[scripthashOf(address)]![0]!.txid);
  // Not the owner's wallet, so no offer to anchor.
  await expect(page.getByRole('button', exact(en.anchor.offer))).toHaveCount(0);
  await expectAccessible(page);
});

/** The card holding the anchor and the page are no wider than the screen: nothing scrolls sideways. */
async function expectAnchorCardFits(page: Page) {
  const card = page.locator('.result', { has: page.locator('.anchor') });
  for (const box of [card, page.locator('.anchor')]) {
    const widths = await box.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client);
  }
  await expectNoOverflow(page);
}

test('the anchor transaction id is shortened in the middle and fits the card on a phone and at 320 px', async ({ page }) => {
  const txid = anchoredChain().history[scripthashOf(address)]![0]!.txid;
  await routeChain(page, anchoredChain());
  await page.goto(`/lookup?q=${vectors.nostr.npub}`);
  const shown = page.locator('.anchor__tx code');
  await expect(shown).toHaveText(`${txid.slice(0, 8)}…${txid.slice(-4)}`, { timeout: 20_000 });
  await expect(shown).toHaveAttribute('title', txid);
  await expect(page.locator('.anchor').getByRole('button', { name: `${en.common.copy}: ${en.anchor.tx}` })).toBeVisible();
  await expectAnchorCardFits(page);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expectAnchorCardFits(page);
});

test('the copy button puts the full anchor transaction id on the clipboard and says so', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'chromium', 'clipboard read permission is Chromium only');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const txid = anchoredChain().history[scripthashOf(address)]![0]!.txid;
  await routeChain(page, anchoredChain());
  await page.goto(`/lookup?q=${vectors.nostr.npub}`);
  const anchor = page.locator('.anchor');
  await anchor.getByRole('button', { name: `${en.common.copy}: ${en.anchor.tx}` }).click();
  await expect(anchor.locator('.hexid__copy')).toHaveText(en.common.copied);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(txid);
});

test('chain servers that close at once leave the binding verified and say so', async ({ page }) => {
  await page.routeWebSocket(chainServers, (ws) => ws.close());
  await page.goto(`/lookup?q=${vectors.nostr.npub}`);
  await expect(page.locator('.result[data-ok="true"]')).toHaveCount(1);
  await expect(page.getByText(en.anchor.unreachable)).toBeVisible({ timeout: 30_000 });
});

test('the owner previews the outputs and the fee, then the wallet signs and sends the anchor', async ({ page }) => {
  await routeChain(page, coins);
  await fakeWallet(page);
  // The Link page asks for the BCH key after a Nostr key; any Nostr key will do, the offer follows the BCH address.
  await lookUpAsOwner(page, en);

  await page.getByRole('button', exact(en.anchor.offer)).click();
  await expect(page.getByText(before(en.anchor.preview))).toBeVisible();
  const preview = (await page.getByText(before(en.anchor.preview)).textContent()) ?? '';
  const fee = Number(/Fee: (\d+) sat/.exec(preview)?.[1]);
  expect(fee).toBeGreaterThan(0);
  expect(fee).toBeLessThanOrEqual(1000);
  expect(preview).toContain(`${20_000 - fee} sat back to ${address}`);
  await expectAccessible(page);

  await page.getByRole('button', exact(en.anchor.ask)).click();
  await expect(page.getByText(en.anchor.sent)).toBeVisible();
  const requests = (await walletRequests(page)) as {
    method: string;
    params: { broadcast: boolean; userPrompt: string; sourceOutputs: unknown[]; transaction: { outputs: unknown[] } };
  }[];
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ method: 'bch_signTransaction', params: { broadcast: true, userPrompt: en.anchor.prompt } });
  expect(requests[0]?.params.sourceOutputs).toHaveLength(1);
  expect(requests[0]?.params.transaction.outputs).toHaveLength(2);
  const shown = (await page.locator('.anchor .notice--ok code').getAttribute('data-full')) ?? '';
  const signed = parseExtended<{ transaction: TransactionCommon; sourceOutputs: (Input & Output)[] }>(requests[0]!.params);
  const bytes = signP2pkh(signed.transaction, signed.sourceOutputs, phraseKeys.bchPrivateKey);
  expect(shown).toBe(txidOf(bytes));
  // The anchor commits to the binding this look-up verified. The e2e relay is shared by every spec and both browsers,
  // so a newer binding by the same key may be the one shown; read its id from the page rather than the vector.
  const card = page.locator('.result', { has: page.locator('.anchor .notice--ok') });
  const verified = JSON.parse((await card.getByLabel(en.lookup.event, { exact: true }).textContent()) ?? '{}') as { id: string; pubkey: string };
  expect(verified.pubkey).toBe(payload.pubkey);
  expect(commitmentFromTransaction(bytes, address)).toEqual({ pubkey: payload.pubkey, eventId: verified.id });
});

test('in Malay at 320 px the anchor panel fits and reads in Malay', async ({ page }) => {
  await routeChain(page, coins);
  await fakeWallet(page);
  await page.setViewportSize({ width: 320, height: 700 });
  await lookUpAsOwner(page, ms);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.getByRole('button', exact(ms.anchor.offer)).click();
  await expect(page.getByText(before(ms.anchor.preview))).toBeVisible();
  await expectNoOverflow(page);
  await expectAccessible(page);
});

test('in Malay at 320 px, coins not yet in a block mean wait for a confirmation, and the wallet is not asked', async ({ page }) => {
  await routeChain(page, pendingCoins);
  await fakeWallet(page);
  await page.setViewportSize({ width: 320, height: 700 });
  await lookUpAsOwner(page, ms);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.getByRole('button', exact(ms.anchor.offer)).click();
  await expect(page.locator('.anchor .notice--error')).toHaveText(ms.anchor.unconfirmed.replace('{address}', address));
  await expect(page.getByRole('button', exact(ms.anchor.ask))).toHaveCount(0);
  expect(await walletRequests(page)).toEqual([]);
  await expectNoOverflow(page);
  await expectAccessible(page);
});

test('a wallet that rejects the anchor is named, never "[object Object]"', async ({ page }) => {
  await routeChain(page, coins);
  await fakeWallet(page, { code: 5000, message: 'User rejected' });
  await lookUpAsOwner(page, en);
  await page.getByRole('button', exact(en.anchor.offer)).click();
  await page.getByRole('button', exact(en.anchor.ask)).click();
  const error = page.locator('.anchor .notice--error');
  await expect(error).toHaveText(en.errors.wallet.rejected);
  await expect(error).not.toContainText('[object Object]');
  expect(await walletRequests(page)).toHaveLength(1);
  // The preview stays, so the owner can ask again.
  await expect(page.getByRole('button', exact(en.anchor.ask))).toBeEnabled();
});

test('the owner of an anchored link can revoke it on BCH: the wallet signs the same format with the revoke type', async ({ page }) => {
  test.slow();
  // Anchored once (bound) and the address still holds coins for the fee. A simulated chain: nothing is sent anywhere.
  await routeChain(page, { ...anchoredChain(), unspent: coins.unspent ?? {} });
  await fakeWallet(page);
  await lookUpAsOwner(page, en, before(en.anchor.since));
  await expect(page.locator('.anchor')).toHaveAttribute('data-chain', 'bound');
  await page.getByRole('button', exact(en.anchor.revokeOffer)).click();
  await expect(page.getByText(before(en.anchor.preview))).toBeVisible();
  await page.getByRole('button', exact(en.anchor.ask)).click();
  await expect(page.getByText(en.anchor.sent)).toBeVisible();
  const requests = (await walletRequests(page)) as { params: { userPrompt: string } }[];
  expect(requests).toHaveLength(1);
  expect(requests[0]?.params.userPrompt).toBe(en.anchor.revokePrompt);
  const signed = parseExtended<{ transaction: TransactionCommon; sourceOutputs: (Input & Output)[] }>(requests[0]!.params);
  const found = commitmentFromTransaction(signP2pkh(signed.transaction, signed.sourceOutputs, phraseKeys.bchPrivateKey), address);
  expect(found).toMatchObject({ pubkey: payload.pubkey, action: 'revoke' });
  await expectNoOverflow(page);
});
