/**
 * Recovery on the look-up page, against its own fake relay holding: key A bound to address X, key B recovering from A
 * (signed by X), and key C whose recovery from A is signed by another address. B shows "Recovered from A"; C shows the
 * refusal with its steps; an address look-up of X lists A and B and marks A as moved to B.
 */
import { secp256k1 } from '@bitauth/libauth';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { Page } from '@playwright/test';
import WebSocket from 'ws';
import { signMessage } from '../src/core/bchmsg.js';
import { createBindingEvent } from '../src/core/binding.js';
import { addressFromPublicKey } from '../src/core/cashaddr.js';
import { toNpub, verificationText } from '../src/core/nostr.js';
import { createRecoveryEvent, recoveryText } from '../src/core/recover.js';
import { startFakeRelay } from './fake-relay.js';
import { en, expect, expectAccessible, expectNoOverflow, ms, routeChain, test } from './fixtures.js';
import { E2E } from './ports.js';

const RECOVER_RELAY_PORT = E2E.relayPort + 30;
const now = Math.floor(Date.now() / 1000);
const bchKey = generateSecretKey();
const strangerKey = generateSecretKey();
const X = addressFromPublicKey(secp256k1.derivePublicKeyCompressed(bchKey) as Uint8Array, 'bitcoincash');
const nostrKey = () => {
  const secret = generateSecretKey();
  return { secret, npub: toNpub(getPublicKey(secret)) };
};
const [A, B, C] = [nostrKey(), nostrKey(), nostrKey()];
const claimFor = (npub: string) => ({ address: X, signature: signMessage(bchKey, verificationText(npub)) });
const bound = finalizeEvent(createBindingEvent({ claim: claimFor(A.npub), createdAt: now - 60 }), A.secret);
const recovered = finalizeEvent(
  createRecoveryEvent({ claim: claimFor(B.npub), oldNpub: A.npub, recoverySignature: signMessage(bchKey, recoveryText(A.npub)), createdAt: now - 30 }),
  B.secret,
);
const refused = finalizeEvent(
  createRecoveryEvent({ claim: claimFor(C.npub), oldNpub: A.npub, recoverySignature: signMessage(strangerKey, recoveryText(A.npub)), createdAt: now - 20 }),
  C.secret,
);

let relay: ReturnType<typeof startFakeRelay>;
test.beforeAll(() => {
  relay = startFakeRelay(RECOVER_RELAY_PORT);
  for (const e of [bound, recovered, refused]) relay.events.set(e.id, e);
});
test.afterAll(() => relay.close());

/** Sends relay connections to this spec's relay; the chain servers are routed again afterwards so they keep their fake. */
async function useRecoverRelay(page: Page) {
  await page.routeWebSocket(/^wss:\/\//, (ws) => {
    const upstream = new WebSocket(`ws://127.0.0.1:${RECOVER_RELAY_PORT}`);
    const queue: string[] = [];
    upstream.on('open', () => queue.splice(0).forEach((m) => upstream.send(m)));
    upstream.on('message', (data) => ws.send(String(data)));
    upstream.on('close', () => ws.close());
    upstream.on('error', () => ws.close());
    ws.onMessage((m) => (upstream.readyState === WebSocket.OPEN ? upstream.send(String(m)) : queue.push(String(m))));
    ws.onClose(() => upstream.close());
  });
  await routeChain(page);
}

const fill = (text: string, npub: string) => text.replace('{npub}', npub);

test('a recovered key shows where it came from; a recovery signed by another address is refused', async ({ page }) => {
  await useRecoverRelay(page);
  await page.goto(`/lookup?q=${B.npub}`);
  const ok = page.locator('.result[data-ok="true"]');
  await expect(ok).toHaveCount(1);
  await expect(ok.locator('.recovery[data-recovered="true"]')).toContainText(fill(en.recovery.from, A.npub));
  await ok.locator('.recovery summary').click();
  await expect(ok.locator('.recovery .check[data-status="pass"]')).toHaveCount(5);
  await expectNoOverflow(page);
  await expectAccessible(page);

  await page.goto(`/lookup?q=${C.npub}`);
  const other = page.locator('.result[data-ok="true"]');
  await expect(other.locator('.recovery[data-recovered="false"]')).toContainText(fill(en.recovery.refused, A.npub));
  await expect(other.locator('.recovery .check[data-step="recovery_sig"]')).toHaveAttribute('data-status', 'fail');
  await expect(other.locator('.recovery .check[data-step="recovery_sig"] .check__reason')).toContainText(X);
  await expectNoOverflow(page);
});

test('an address look-up lists both keys and marks the old one as moved, in Malay too', async ({ page }) => {
  await useRecoverRelay(page);
  await page.goto(`/lookup?q=${encodeURIComponent(X)}`);
  // C's own binding verifies too (only its recovery is refused), so three keys still claim X.
  await expect(page.locator('.result[data-ok="true"]')).toHaveCount(3);
  await expect(page.getByText(fill(en.recovery.by, B.npub))).toHaveCount(1);
  await page.getByLabel(en.lang.label).selectOption('ms');
  await expect(page.getByText(fill(ms.recovery.by, B.npub))).toHaveCount(1);
  await expect(page.getByText(fill(ms.recovery.from, A.npub))).toHaveCount(1);
  await expectNoOverflow(page);
});
