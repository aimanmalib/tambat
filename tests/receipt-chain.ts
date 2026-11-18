/**
 * Transactions for receipt tests: a funding transaction pays an address, a payment spends it to another address.
 * Unsigned is enough: the receipt checks read which outputs were spent and where coins went, not signatures.
 */
import { cashAddressToLockingBytecode, encodeTransaction, hexToBin, type Output } from '@bitauth/libauth';
import { txidOf } from '../src/core/anchor.js';
import { hexOf } from './anchor-wallet.js';
import type { FakeChainTx } from './fake-fulcrum.js';

const locking = (address: string): Uint8Array => {
  const r = cashAddressToLockingBytecode(address);
  if (typeof r === 'string') throw new Error(r);
  return r.bytecode;
};

/** A transaction spending `from` outpoints and paying `to` addresses. */
export function transaction(from: { txid: string; vout: number }[], to: { address: string; sats: number }[], height = 900_000): FakeChainTx {
  const outputs: Output[] = to.map((o) => ({ lockingBytecode: locking(o.address), valueSatoshis: BigInt(o.sats) }));
  const inputs = from.map((f) => ({
    outpointTransactionHash: hexToBin(f.txid),
    outpointIndex: f.vout,
    sequenceNumber: 0xffffffff,
    unlockingBytecode: Uint8Array.of(0x51),
  }));
  const bytes = encodeTransaction({ version: 2, inputs, outputs, locktime: 0 });
  return { hex: hexOf(bytes), txid: txidOf(bytes), height };
}
