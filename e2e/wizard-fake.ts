/**
 * The fake WizardConnect wallet for end-to-end tests, installed at the session boundary
 * (`window.__tambatWizardSession`, web/keys/anchor-wizard-session.ts), and a fake chain for it. The wallet connects at
 * once, shares the keys in `table` and never answers a sign request. `window.__tambatWizardEnd()` makes it end the
 * session, as a wallet that disconnects does: listeners given to `onClose` are called once and a waiting sign request
 * is rejected.
 */
import { binToHex, encodeTransaction, hashTransaction, secp256k1, sha256, utf8ToBin, cashAddressToLockingBytecode } from '@bitauth/libauth';
import type { Page } from '@playwright/test';
import { scripthashOf } from '../src/core/anchor-chain.js';
import { addressFromPublicKey } from '../src/core/cashaddr.js';
import type { FakeChain } from '../tests/fake-fulcrum.js';
import { config } from '../src/config.js';
import type { en } from './fixtures.js';

export const exact = (name: string) => ({ name, exact: true });
export const { gapLimit } = config.wizardConnect.scan;

/** Public keys of the fake wallet (from a hash, not a phrase), as hex, for receive and change up to `count`. */
const pubkey = (path: string, index: number) => secp256k1.derivePublicKeyCompressed(sha256.hash(utf8ToBin(`e2e wallet ${path} ${index}`))) as Uint8Array;
export const at = (path: string, index: number) => addressFromPublicKey(pubkey(path, index), 'bitcoincash');
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
export function deepChain(): FakeChain {
  const history: FakeChain['history'] = {};
  for (let i = 0; i < 23; i++) history[scripthashOf(at('receive', i))] = [{ ...payment(at('receive', i), 1000, i + 1), height: 900000 + i }];
  const coin = payment(at('receive', 23), 5000, 99);
  const hash = scripthashOf(at('receive', 23));
  history[hash] = [{ ...coin, height: 0 }];
  return { history, headers: {}, unspent: { [hash]: [{ tx_hash: coin.txid, tx_pos: 0, value: 5000, height: 0 }] } };
}

/** Installs the fake wallet (see the top of this file). */
async function fakeWizardWallet(page: Page) {
  await page.addInitScript((keys: Record<string, string[]>) => {
    const bytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
    const listeners: (() => void)[] = [];
    const waiting: ((e: Error) => void)[] = [];
    let ended = false;
    const w = window as unknown as Record<string, unknown>;
    w.__tambatWizardEnd = () => {
      if (ended) return;
      ended = true;
      for (const reject of waiting) reject(new Error('wizard.disconnected'));
      for (const l of listeners) l();
    };
    const wallet = {
      publicKey: (path: string, index: number) => (keys[path]?.[index] ? bytes(keys[path][index]) : undefined),
      sign: () => new Promise<string>((_resolve, reject) => void waiting.push(reject)),
    };
    w.__tambatWizardSession = async () => ({
      uri: 'wiz://test',
      ready: Promise.resolve({ wallet, name: 'Test wallet' }),
      onClose: (l: () => void) => void listeners.push(l),
      close: () => {
        w.__tambatWizardClosed = true;
      },
    });
  }, table);
}

export async function startWizard(page: Page, t: typeof en, path: string) {
  await fakeWizardWallet(page);
  await page.goto(path);
  await page.getByRole('button', exact(t.nostr.demo)).click();
  const option = page.locator('[data-option="wizardconnect"]');
  await option.getByRole('button', exact(t.wizard.start)).click();
  return option;
}

