/**
 * The WizardConnect address scan in the browser: a fake wallet at the session boundary
 * (`window.__tambatWizardSession`, web/keys/anchor-wizard-session.ts) and a fake chain. The wallet gave a new address
 * for every payment, so its only coin sits at receive index 23 and is not in a block yet; the page must walk past the
 * first addresses (gap limit) and accept the unconfirmed coin. An empty wallet gets the count of addresses checked and
 * no address of any kind in the text.
 */
import { binToHex, encodeTransaction, hashTransaction, secp256k1, sha256, utf8ToBin, cashAddressToLockingBytecode } from '@bitauth/libauth';
import type { Page } from '@playwright/test';
import { scripthashOf } from '../src/core/anchor-chain.js';
import { addressFromPublicKey } from '../src/core/cashaddr.js';
import type { FakeChain } from '../tests/fake-fulcrum.js';
import { config } from '../src/config.js';
import { en, expect, expectAccessible, expectNoOverflow, ms, routeChain, test } from './fixtures.js';

const exact = (name: string) => ({ name, exact: true });
const { gapLimit } = config.wizardConnect.scan;

/** Public keys of the fake wallet (from a hash, not a phrase), as hex, for receive and change up to `count`. */
const pubkey = (path: string, index: number) => secp256k1.derivePublicKeyCompressed(sha256.hash(utf8ToBin(`e2e wallet ${path} ${index}`))) as Uint8Array;
const at = (path: string, index: number) => addressFromPublicKey(pubkey(path, index), 'bitcoincash');
const KEYS = 3 * gapLimit;
const table = Object.fromEntries(
  (['receive', 'change'] as const).map((path) => [path, Array.from({ length: KEYS }, (_, i) => binToHex(pubkey(path, i)))]),
);

/** A transaction paying `sats` to `address`. */
function payment(address: string, sats: number, seed: number) {
  const lock = cashAddressToLockingBytecode(address);
  if (typeof lock === 'string') throw new Error(lock);
  const raw = encodeTransaction({
    version: 2,
    inputs: [{ outpointTransactionHash: new Uint8Array(32).fill(seed), outpointIndex: 0, sequenceNumber: 0, unlockingBytecode: Uint8Array.of() }],
    outputs: [{ lockingBytecode: lock.bytecode, valueSatoshis: BigInt(sats) }],
    locktime: 0,
  });
  return { hex: binToHex(raw), txid: hashTransaction(raw) };
}

/** Receive 0..22 used and spent; receive 23 holds 5000 sat not yet in a block. */
function deepChain(): FakeChain {
  const history: FakeChain['history'] = {};
  for (let i = 0; i < 23; i++) history[scripthashOf(at('receive', i))] = [{ ...payment(at('receive', i), 1000, i + 1), height: 900000 + i }];
  const coin = payment(at('receive', 23), 5000, 99);
  const hash = scripthashOf(at('receive', 23));
  history[hash] = [{ ...coin, height: 0 }];
  return { history, headers: {}, unspent: { [hash]: [{ tx_hash: coin.txid, tx_pos: 0, value: 5000, height: 0 }] } };
}

/** Installs the fake wallet: it connects at once, shares the keys in `table`, and never answers a sign request. */
async function fakeWizardWallet(page: Page) {
  await page.addInitScript((keys: Record<string, string[]>) => {
    const bytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
    const wallet = {
      publicKey: (path: string, index: number) => (keys[path]?.[index] ? bytes(keys[path][index]) : undefined),
      sign: () => new Promise<string>(() => undefined),
    };
    (window as unknown as Record<string, unknown>).__tambatWizardSession = async () => ({
      uri: 'wiz://test',
      ready: Promise.resolve({ wallet, name: 'Test wallet' }),
      close: () => undefined,
    });
  }, table);
}

async function startWizard(page: Page, t: typeof en, path: string) {
  await fakeWizardWallet(page);
  await page.goto(path);
  await page.getByRole('button', exact(t.nostr.demo)).click();
  const option = page.locator('[data-option="wizardconnect"]');
  await option.getByRole('button', exact(t.wizard.start)).click();
  return option;
}

test('finds the coin at receive index 23 past the first addresses, and says it is not in a block yet', async ({ page }) => {
  await routeChain(page, deepChain());
  const option = await startWizard(page, en, '/');
  await expect(option.getByRole('button', exact(en.wizard.sign))).toBeVisible({ timeout: 20_000 });
  await expect(option.getByText(at('receive', 23), { exact: false })).toBeVisible();
  await expect(option.locator('[data-unconfirmed="yes"]')).toHaveText(en.wizard.previewUnconfirmed);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await option.scrollIntoViewIfNeeded();
    await expectNoOverflow(page);
  }
  await expectAccessible(page);
});

test('an empty wallet hears how many addresses were checked, in Malay at 320 px, and is shown no address', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const option = await startWizard(page, ms, '/?lang=ms');
  const text = ms.wizard.noCoins.replace('{count}', String(2 * gapLimit)).replace('{gap}', String(gapLimit));
  const notice = option.getByText(text);
  await expect(notice).toBeVisible({ timeout: 20_000 });
  expect(await option.locator('.notice, [role="alert"], [role="status"]').allTextContents()).not.toContainEqual(
    expect.stringMatching(/(bitcoincash|bchtest):/),
  );
  await expectNoOverflow(page);
});
