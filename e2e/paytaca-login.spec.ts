/**
 * Sign-in with a BCH wallet only. The WalletConnect client is replaced at the library boundary by a fake wallet that
 * answers like Paytaca: a `bch:<cashaddr>` session account, and `bch_signMessage` with `{ message }` returning a
 * base64 signed message. The page, the app server and the relay look-up are the real ones.
 */
import type { Page } from '@playwright/test';
import WebSocket from 'ws';
import { signMessage } from '../src/core/bchmsg.js';
import { allowFailedLoad, en, expect, expectAccessible, expectNoOverflow, ms, otherAddress, phraseKeys, test, vectors } from './fixtures.js';
import { E2E } from './ports.js';

const exact = (name: string) => ({ name, exact: true });
const address = vectors.bch.address.bitcoincash;
const challengeText = /^Sign in to http:\/\/127\.0\.0\.1:\d+ with challenge [0-9a-f]{64}$/;

interface SignRequest {
  topic: string;
  chainId: string;
  request: { method: string; params: { message: string } };
}

/** Puts the public test phrase's binding on the local fake relay, as a published binding would be. */
async function publishBinding(): Promise<void> {
  const ws = new WebSocket(E2E.relayUrl);
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => ws.send(JSON.stringify(['EVENT', vectors.bindingEvent])));
    ws.on('message', () => resolve());
    ws.on('error', reject);
  });
  ws.close();
}

/**
 * Installs the fake wallet. `bound` picks the address whose key has a binding on the relay; otherwise the wallet
 * offers an address of a key with no binding. The wallet approves pairing when the test calls window.__approve().
 */
async function fakeWallet(page: Page, bound: boolean) {
  const secret = bound ? phraseKeys.bchPrivateKey : phraseKeys.nostrSecretKey;
  await page.exposeFunction('__walletSign', (message: string) => signMessage(secret, message));
  await page.addInitScript((account: string) => {
    const w = window as unknown as Record<string, unknown> & { __walletSign: (m: string) => Promise<string> };
    const requests: unknown[] = [];
    w.__requests = requests;
    w.__tambatSignClient = {
      init: async () => ({
        connect: async (opts: { requiredNamespaces: { bch: { chains: string[]; methods: string[] } } }) => {
          w.__namespaces = opts.requiredNamespaces;
          return {
            uri: 'wc:0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0@2?relay-protocol=irn&symKey=00',
            approval: () =>
              new Promise((resolve) => {
                w.__approve = () => resolve({ topic: 'fake-topic', namespaces: { bch: { accounts: [`bch:${account}`], methods: opts.requiredNamespaces.bch.methods, events: [] } } });
              }),
          };
        },
        request: async (req: { topic: string; chainId: string; request: { method: string; params: { message: string } } }) => {
          requests.push(req);
          if (req.request.method !== 'bch_signMessage') throw new Error('unsupported method');
          return w.__walletSign(req.request.params.message);
        },
      }),
    };
  }, bound ? address : otherAddress);
}

async function pairAndApprove(page: Page, t: typeof en) {
  await page.getByRole('button', exact(t.bch.wcStart)).click();
  await expect(page.getByRole('img', exact(t.bch.wc))).toBeVisible();
  await expect(page.getByRole('link', exact(t.bch.wcOpen))).toHaveAttribute('href', /^wc:/);
  await page.evaluate(() => (window as unknown as { __approve: () => void }).__approve());
  await expect(page.locator('.keybadge__value')).toHaveText(address);
}

test.beforeAll(publishBinding);

test('a Paytaca-style wallet signs the challenge and the server finds the linked Nostr key', async ({ page }) => {
  await fakeWallet(page, true);
  await page.goto('/demo');
  await expect(page.getByRole('heading', exact(en.demo.bchTitle))).toBeVisible();
  await pairAndApprove(page, en);
  await expectAccessible(page);
  await page.getByRole('button', exact(en.demo.bchSignIn)).click();

  const session = page.getByTestId('session');
  await expect(session).toContainText(vectors.nostr.npub);
  await expect(session).toContainText(address);
  await expect(session.getByText(en.demo.viaBch)).toBeVisible();
  const sent = (await page.evaluate(() => (window as unknown as { __requests: unknown[] }).__requests)) as SignRequest[];
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ topic: 'fake-topic', chainId: 'bch:bitcoincash', request: { method: 'bch_signMessage' } });
  expect(sent[0]?.request.params.message).toMatch(challengeText);
  const namespaces = await page.evaluate(() => (window as unknown as { __namespaces: unknown }).__namespaces);
  expect(namespaces).toMatchObject({ bch: { chains: ['bch:bitcoincash'], methods: expect.arrayContaining(['bch_signMessage']) } });
  await expectAccessible(page);

  await page.getByRole('button', exact(en.demo.signOut)).click();
  await expect(page.getByRole('button', exact(en.demo.bchSignIn))).toBeVisible();
});

test('a signature pasted from any wallet signs in, and a reused challenge is refused', async ({ page }) => {
  allowFailedLoad(page, '/api/rp/login');
  await page.goto('/demo');
  await page.getByText(en.demo.bchPaste).click();
  await page.getByRole('button', exact(en.demo.bchGetChallenge)).click();
  const text = (await page.locator('.value__text').first().textContent()) ?? '';
  expect(text).toMatch(challengeText);
  const signature = signMessage(phraseKeys.bchPrivateKey, text);
  await page.getByLabel(en.bch.addressLabel, { exact: true }).fill(address);
  await page.getByLabel(en.bch.signatureLabel, { exact: true }).fill(signature);
  await page.getByRole('button', exact(en.demo.bchPasteSubmit)).click();
  await expect(page.getByTestId('session')).toContainText(vectors.nostr.npub);

  const nonce = text.split(' ').pop() ?? '';
  const replay = await page.evaluate(
    async (body) => (await fetch('/api/rp/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json(),
    { type: 'bch', address, signature, nonce },
  );
  expect(replay).toMatchObject({ error: 'challenge_unknown' });
});

test('a wallet whose address has no linked Nostr key is refused with a clear reason', async ({ page }) => {
  allowFailedLoad(page, '/api/rp/login');
  await fakeWallet(page, false);
  await page.goto('/demo');
  await page.getByRole('button', exact(en.bch.wcStart)).click();
  await page.evaluate(() => (window as unknown as { __approve: () => void }).__approve());
  await expect(page.locator('.keybadge__value')).toHaveText(otherAddress);
  await page.getByRole('button', exact(en.demo.bchSignIn)).click();
  await expect(page.getByText(en.errors.api.no_binding)).toBeVisible();
  await expect(page.getByTestId('session')).toHaveCount(0);
});

test('in Malay at 320 px the BCH sign-in fits and reads in Malay', async ({ page }) => {
  await fakeWallet(page, true);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/demo');
  await page.getByLabel(en.lang.label).selectOption('ms');
  await expect(page.getByRole('heading', exact(ms.demo.bchTitle))).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.getByText(ms.demo.bchPaste).click();
  await page.getByRole('button', exact(ms.demo.bchGetChallenge)).click();
  await expect(page.getByText(ms.demo.bchTextLabel)).toBeVisible();
  await expectNoOverflow(page);
  await pairAndApprove(page, ms);
  await expectNoOverflow(page);
  await page.getByRole('button', exact(ms.demo.bchSignIn)).click();
  await expect(page.getByText(ms.demo.viaBch)).toBeVisible();
  await expectNoOverflow(page);
  await expectAccessible(page);
});
