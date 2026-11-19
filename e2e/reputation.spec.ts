/**
 * The reputation summary on the look-up page, against this spec's own fake relay and a fake chain (no transaction is
 * sent anywhere). Key A is bound to address X and anchored since BLOCK. Key B attests A's binding. Payer P, bound to
 * its own address, paid X and published a receipt; a stranger's receipt claims a payment from an unbound address.
 * When the relays refuse the queries and the chain servers drop, every line says "could not be read", never 0.
 */
import { secp256k1 } from '@bitauth/libauth';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { Page } from '@playwright/test';
import WebSocket from 'ws';
import config from '../config/tambat.json' with { type: 'json' };
import { buildAnchorTransaction, txidOf } from '../src/core/anchor.js';
import { scripthashOf } from '../src/core/anchor-chain.js';
import { createAttestationEvent } from '../src/core/attest.js';
import { addressFromPublicKey } from '../src/core/cashaddr.js';
import { toNpub } from '../src/core/nostr.js';
import { bindingFromKeys } from '../src/core/paytaca.js';
import { createReceiptEvent } from '../src/core/receipt.js';
import { verifyReputationBundle } from '../src/core/reputation.js';
import { hexOf, signP2pkh } from '../tests/anchor-wallet.js';
import { headerWithTime, type FakeChain } from '../tests/fake-fulcrum.js';
import { transaction } from '../tests/receipt-chain.js';
import { routeToRelay, startFakeRelay } from './fake-relay.js';
import { chainServers, en, expect, expectAccessible, expectNoOverflow, ms, routeChain, test } from './fixtures.js';
import { E2E } from './ports.js';

const REP_RELAY_PORT = E2E.relayPort + 70;
const BLOCK = 977_901;
const now = Math.floor(Date.now() / 1000);

function person() {
  const nostrSecretKey = generateSecretKey();
  const bchPrivateKey = generateSecretKey();
  const address = addressFromPublicKey(secp256k1.derivePublicKeyCompressed(bchPrivateKey) as Uint8Array, 'bitcoincash');
  const pubkey = getPublicKey(nostrSecretKey);
  const keys = { nostrSecretKey, bchPrivateKey, address, npub: toNpub(pubkey) };
  return { ...keys, pubkey, binding: bindingFromKeys(keys, now - 200) };
}
const [A, B, P] = [person(), person(), person()];
const strangerAddress = addressFromPublicKey(secp256k1.derivePublicKeyCompressed(generateSecretKey()) as Uint8Array, 'bitcoincash');

const unsigned = buildAnchorTransaction(A.address, [{ txid: '68'.repeat(32), vout: 0, satoshis: 5000 }], { pubkey: A.pubkey, eventId: A.binding.id });
const anchorBytes = signP2pkh(unsigned.transaction, unsigned.sourceOutputs, A.bchPrivateKey);
const anchorTx = { hex: hexOf(anchorBytes), txid: txidOf(anchorBytes), height: BLOCK };
const funding = transaction([{ txid: '55'.repeat(32), vout: 0 }], [{ address: P.address, sats: 50_000 }]);
const payment = transaction([{ txid: funding.txid, vout: 0 }], [{ address: A.address, sats: 40_000 }]);
const strangerFunding = transaction([{ txid: '66'.repeat(32), vout: 2 }], [{ address: strangerAddress, sats: 12_000 }]);
const strangerPayment = transaction([{ txid: strangerFunding.txid, vout: 0 }], [{ address: A.address, sats: 11_000 }]);
const chain: FakeChain = {
  history: { [scripthashOf(A.address)]: [anchorTx], all: [funding, payment, strangerFunding, strangerPayment] },
  headers: { [BLOCK]: headerWithTime(Date.UTC(2026, 10, 17) / 1000) },
};

const attestation = finalizeEvent(createAttestationEvent({ subject: A.pubkey, bindingEventId: A.binding.id, createdAt: now - 100 }), B.nostrSecretKey);
const paid = finalizeEvent(createReceiptEvent({ payee: A.pubkey, txid: payment.txid, createdAt: now - 50 }), P.nostrSecretKey);
const claimed = finalizeEvent(createReceiptEvent({ payee: A.pubkey, txid: strangerPayment.txid, createdAt: now - 40 }), generateSecretKey());

let relay: ReturnType<typeof startFakeRelay>;
test.beforeAll(() => {
  relay = startFakeRelay(REP_RELAY_PORT);
  for (const e of [A.binding, B.binding, P.binding, attestation, paid, claimed]) relay.events.set(e.id, e);
});
test.afterAll(() => relay.close());

const row = (page: Page, name: string) => page.locator(`.result[data-ok="true"] .rep__row[data-rep="${name}"]`);

test('the summary counts verified attestations, verified receipts and the anchor block, each opening to its sources', async ({ page }) => {
  await routeToRelay(page, REP_RELAY_PORT);
  await routeChain(page, chain);
  await page.setViewportSize({ width: 390, height: 664 });
  await page.goto(`/lookup?q=${A.npub}`);
  await expect(page.locator('.rep h3')).toHaveText(en.reputation.title);

  const attest = row(page, 'attestations');
  await expect(attest).toHaveAttribute('data-count', '1', { timeout: 20_000 });
  await expect(attest).toContainText(en.reputation.attestationCount.replace('{count}', '1'));
  await attest.locator('summary').click();
  await expect(attest.locator('.rep__sources')).toContainText(B.npub);
  await expect(attest.locator(`code[data-full="${attestation.id}"]`)).toHaveCount(1);

  const receipts = row(page, 'receipts');
  await expect(receipts).toHaveAttribute('data-count', '1', { timeout: 20_000 });
  await expect(receipts).toContainText(en.reputation.receiptsUnproven.replace('{count}', '1'));
  await receipts.locator('summary').click();
  await expect(receipts.locator(`code[data-full="${payment.txid}"]`)).toHaveCount(1);
  await expect(receipts.locator('.rep__sources')).toContainText(P.npub);
  await expect(receipts.locator(`code[data-full="${strangerPayment.txid}"]`)).toHaveCount(0);

  const anchor = row(page, 'anchor');
  await expect(anchor).toHaveAttribute('data-state', 'block', { timeout: 20_000 });
  await expect(anchor).toContainText(en.reputation.anchoredSince.replace('{height}', String(BLOCK)));
  await anchor.locator('summary').click();
  await expect(anchor.locator(`code[data-full="${anchorTx.txid}"]`)).toHaveCount(1);
  // The anchor and attestation panels below show the same reads as the summary.
  await expect(page.locator('.result .attest')).toHaveAttribute('data-attest', '1');
  await expect(page.locator('.result .anchor')).toHaveAttribute('data-chain', 'bound');

  // The counted attestations download as a portable bundle that recounts offline to the same number.
  const download = page.waitForEvent('download');
  await page.locator('.rep').getByRole('link', { name: en.reputation.download }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`${config.vc.reputationFilePrefix}-${A.pubkey.slice(0, 12)}.json`);
  const chunks: Buffer[] = [];
  for await (const chunk of await file.createReadStream()) chunks.push(chunk as Buffer);
  const bundle = verifyReputationBundle(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  expect(bundle.ok && [bundle.count.counted.map((c) => c.attestationEvent), bundle.anchor]).toEqual([
    [attestation.id],
    { kind: 'claimed', height: BLOCK, txid: anchorTx.txid },
  ]);

  await expectNoOverflow(page);
  await expectAccessible(page);
  await page.getByLabel(en.lang.label).selectOption('ms');
  await expect(page.locator('.rep h3')).toHaveText(ms.reputation.title);
  await expect(page.locator('.rep').getByRole('link', { name: ms.reputation.download })).toHaveCount(1);
  await expect(anchor).toContainText(ms.reputation.anchoredSince.replace('{height}', String(BLOCK)));
  await page.setViewportSize({ width: 320, height: 700 });
  await expectNoOverflow(page);
});

test('when the relays refuse and the chain servers drop, every line says it could not be read, not 0', async ({ page }) => {
  // Bindings still load; queries for labels (attestations, receipts) are refused by every relay.
  await page.routeWebSocket(/^wss:\/\//, (ws) => {
    const upstream = new WebSocket(`ws://127.0.0.1:${REP_RELAY_PORT}`);
    const queue: string[] = [];
    upstream.on('open', () => queue.splice(0).forEach((m) => upstream.send(m)));
    upstream.on('message', (data) => ws.send(String(data)));
    upstream.on('close', () => ws.close());
    upstream.on('error', () => ws.close());
    ws.onMessage((m) => {
      const msg = JSON.parse(String(m)) as unknown[];
      const filter = msg[2] as { kinds?: number[] } | undefined;
      if (msg[0] === 'REQ' && filter?.kinds?.includes(config.attest.kind)) ws.send(JSON.stringify(['CLOSED', msg[1], 'blocked: test']));
      else if (upstream.readyState === WebSocket.OPEN) upstream.send(String(m));
      else queue.push(String(m));
    });
    ws.onClose(() => upstream.close());
  });
  await page.routeWebSocket(chainServers, (ws) => ws.close());
  await page.goto(`/lookup?q=${A.npub}`);
  for (const name of ['attestations', 'receipts']) {
    await expect(row(page, name)).toHaveAttribute('data-state', 'unreadable', { timeout: 30_000 });
    await expect(row(page, name)).toContainText(en.reputation.unreadableRelays);
    await expect(row(page, name)).not.toHaveAttribute('data-count');
  }
  await expect(row(page, 'anchor')).toHaveAttribute('data-state', 'unreadable', { timeout: 30_000 });
  await expect(row(page, 'anchor')).toContainText(en.reputation.unreadableChain);
  await expect(page.locator('.result .attest')).toHaveAttribute('data-attest', 'unreadable');
  await expect(page.locator('.rep')).not.toContainText(en.reputation.attestationCount.replace('{count}', '0'));
  await page.setViewportSize({ width: 320, height: 700 });
  await expectNoOverflow(page);
});

test('/judges links the reputation summary of the Paytaca-signed key', async ({ page }) => {
  await routeToRelay(page, REP_RELAY_PORT);
  await routeChain(page);
  await page.goto('/judges');
  const link = page.locator('[data-req="discovery"] a', { hasText: en.judges.link.reputation });
  await expect(link).toHaveAttribute('href', `/lookup?q=${encodeURIComponent(config.judges.paytaca.npub)}`);
  await page.getByRole('combobox').selectOption('ms');
  await expect(page.locator('[data-req="discovery"] a', { hasText: ms.judges.link.reputation })).toHaveCount(1);
});
