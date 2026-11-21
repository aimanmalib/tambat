/**
 * Address discovery for a WizardConnect wallet (docs/decisions/0023-wizardconnect-transaction-proof.md, "Address
 * discovery"). A wallet that hands out a new address for every payment keeps its coins far from index 0, so each key
 * path (receive, then change) is walked in batches of `gapLimit` addresses and the walk stops after `gapLimit` unused
 * addresses in a row, as BIP44 wallets do, or at `maxAddresses` on that path. Pure: deriving and looking up are passed
 * in, so tests need no network.
 */
import type { Utxo } from '../../src/core/anchor.js';

export type WalletPath = 'receive' | 'change';
export const WALLET_PATHS: readonly WalletPath[] = ['receive', 'change'];

export interface WalletAddress {
  path: WalletPath;
  index: number;
  address: string;
}

/** What the chain says about one address: whether it has any history or coin, and its coins. */
export interface AddressActivity {
  used: boolean;
  coins: Utxo[];
}

export interface FundedAddress extends WalletAddress {
  coins: Utxo[];
  sats: number;
}

export interface ScanOptions {
  /** The address at `index` on `path`, or undefined when the wallet shared no key for that path. */
  derive(path: WalletPath, index: number): WalletAddress | undefined;
  /** One answer per address, in order; called once per batch. */
  lookup(addresses: readonly string[]): Promise<AddressActivity[]>;
  gapLimit: number;
  /** The most addresses looked up on one path. */
  maxAddresses: number;
}

export interface ScanResult {
  /** Addresses holding coins, largest first. */
  funded: FundedAddress[];
  /** Addresses derived and looked up on each path. */
  scanned: Record<WalletPath, number>;
  /** True when a path reached `maxAddresses` before `gapLimit` unused addresses in a row. */
  capped: boolean;
}

/** Reads the activity of one address from its Electrum history and unspent coins. */
export function activityOf(history: readonly unknown[], coins: Utxo[]): AddressActivity {
  return { used: history.length > 0 || coins.length > 0, coins };
}

interface PathScan {
  scanned: number;
  funded: FundedAddress[];
  capped: boolean;
}

async function scanPath(path: WalletPath, o: ScanOptions): Promise<PathScan> {
  const out: PathScan = { scanned: 0, funded: [], capped: false };
  let lastUsed = -1;
  while (out.scanned - lastUsed - 1 < o.gapLimit) {
    if (out.scanned >= o.maxAddresses) {
      out.capped = true;
      break;
    }
    const want = Math.min(o.gapLimit, o.maxAddresses - out.scanned);
    const batch: WalletAddress[] = [];
    for (let i = out.scanned; i < out.scanned + want; i++) {
      const a = o.derive(path, i);
      if (!a) break;
      batch.push(a);
    }
    if (batch.length === 0) break;
    const answers = await o.lookup(batch.map((a) => a.address));
    batch.forEach((a, i) => {
      const activity = answers[i] ?? { used: false, coins: [] };
      if (!activity.used) return;
      lastUsed = a.index;
      const sats = activity.coins.reduce((s, c) => s + c.satoshis, 0);
      if (sats > 0) out.funded.push({ ...a, coins: activity.coins, sats });
    });
    out.scanned += batch.length;
    // A path whose keys end before the batch does (a wallet that shares fewer keys) is done.
    if (batch.length < want) break;
  }
  return out;
}

/** Walks the receive path, then the change path, of a connected wallet. */
export async function scanWallet(o: ScanOptions): Promise<ScanResult> {
  const receive = await scanPath('receive', o);
  const change = await scanPath('change', o);
  return {
    funded: [...receive.funded, ...change.funded].sort((a, b) => b.sats - a.sats),
    scanned: { receive: receive.scanned, change: change.scanned },
    capped: receive.capped || change.capped,
  };
}
