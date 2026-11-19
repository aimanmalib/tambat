/**
 * Attestations on the look-up page, against this spec's own fake relay. Key A is bound twice to address X: an older
 * binding and its current one. Key B attests A's current binding; key C attested only the older one. The look-up of A
 * shows B's attestation and counts C's as no longer counting; key D, bound once and never attested, shows none.
 */
import { secp256k1 } from '@bitauth/libauth';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { Page } from '@playwright/test';
import config from '../config/tambat.json' with { type: 'json' };
import { createAttestationEvent } from '../src/core/attest.js';
import { verifyCredential } from '../src/core/vc.js';
import { signMessage } from '../src/core/bchmsg.js';
import { createBindingEvent } from '../src/core/binding.js';
import { addressFromPublicKey } from '../src/core/cashaddr.js';
import { toNpub, verificationText } from '../src/core/nostr.js';
import { routeToRelay, startFakeRelay } from './fake-relay.js';
import { en, expect, expectAccessible, expectNoOverflow, ms, routeChain, test } from './fixtures.js';
import { E2E } from './ports.js';

const ATTEST_RELAY_PORT = E2E.relayPort + 50;
const now = Math.floor(Date.now() / 1000);
const nostrKey = () => {
  const secret = generateSecretKey();
  const pubkey = getPublicKey(secret);
  return { secret, pubkey, npub: toNpub(pubkey) };
};
const [A, B, C, D] = [nostrKey(), nostrKey(), nostrKey(), nostrKey()];
const bindingOf = (who: typeof A, at: number) => {
  const bchKey = generateSecretKey();
  const address = addressFromPublicKey(secp256k1.derivePublicKeyCompressed(bchKey) as Uint8Array, 'bitcoincash');
  const claim = { address, signature: signMessage(bchKey, verificationText(who.npub)) };
  return finalizeEvent(createBindingEvent({ claim, createdAt: at }), who.secret);
};
const older = bindingOf(A, now - 300);
const current = bindingOf(A, now - 100);
const attestBy = (by: typeof A, bindingEventId: string, at: number) =>
  finalizeEvent(createAttestationEvent({ subject: A.pubkey, bindingEventId, createdAt: at }), by.secret);
const fromB = attestBy(B, current.id, now - 50);
const fromC = attestBy(C, older.id, now - 200);

let relay: ReturnType<typeof startFakeRelay>;
test.beforeAll(() => {
  relay = startFakeRelay(ATTEST_RELAY_PORT);
  for (const e of [older, current, fromB, fromC, bindingOf(D, now - 100)]) relay.events.set(e.id, e);
});
test.afterAll(() => relay.close());

async function useAttestRelay(page: Page) {
  await routeToRelay(page, ATTEST_RELAY_PORT);
  await routeChain(page);
}

test('an attestation of the current binding shows; one of a replaced binding only counts as dropped', async ({ page }) => {
  await useAttestRelay(page);
  await page.goto(`/lookup?q=${A.npub}`);
  const panel = page.locator('.result[data-ok="true"] .attest');
  await expect(panel).toHaveAttribute('data-attest', '1', { timeout: 20_000 });
  await expect(panel.locator('.attest__item')).toContainText(B.npub);
  await expect(panel.locator(`.attest__item code[data-full="${fromB.id}"]`)).toHaveCount(1);
  await expect(panel).not.toContainText(C.npub);
  await expect(panel).toContainText(en.attest.replaced.replace('{count}', '1'));
  await expectNoOverflow(page);
  await expectAccessible(page);

  // The attestation downloads as a W3C VC 2.0 that verifies offline and names B as issuer.
  const download = page.waitForEvent('download');
  await panel.getByRole('link', { name: en.attest.vcDownload }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`${config.vc.filePrefix}-${fromB.id.slice(0, 12)}.json`);
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const vc = verifyCredential(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  expect(vc.ok && [vc.credential.issuer, vc.credential.credentialSubject.bindingEvent]).toEqual([`did:nostr:${B.pubkey}`, current.id]);

  await page.getByLabel(en.lang.label).selectOption('ms');
  await expect(panel).toContainText(ms.attest.replaced.replace('{count}', '1'));
  await expect(panel.getByRole('link', { name: ms.attest.vcDownload })).toHaveCount(1);
  await page.setViewportSize({ width: 320, height: 700 });
  await expectNoOverflow(page);
});

test('a binding nobody attested says so', async ({ page }) => {
  await useAttestRelay(page);
  await page.goto(`/lookup?q=${D.npub}`);
  const panel = page.locator('.result[data-ok="true"] .attest');
  await expect(panel).toHaveAttribute('data-attest', '0', { timeout: 20_000 });
  await expect(panel).toContainText(en.attest.none);
});
