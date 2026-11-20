/**
 * Shared test kit for on-chain proofs: a proof transaction signed with the public test phrase, and a fake chain server
 * holding given transactions. Nothing is sent anywhere.
 */
import { binToHex, cashAddressToLockingBytecode, encodeTransaction, hexToBin } from '@bitauth/libauth';
import { buildAnchorTransaction, txidOf } from '../src/core/anchor.js';
import type { ChainServer } from '../src/core/chain-quorum.js';
import { proofOutput, type TxEvidence } from '../src/core/tx-proof.js';
import { signP2pkh } from './anchor-wallet.js';
import { keys } from './helpers.js';

/** A transaction from `from` that carries `output` (default: the proof for `npub`), signed with the test phrase. */
export function proofTx(npub: string, output: Uint8Array = proofOutput(npub), from = keys) {
  const locking = cashAddressToLockingBytecode(from.address);
  if (typeof locking === 'string') throw new Error(locking);
  const funding = encodeTransaction({
    version: 2,
    inputs: [{ outpointTransactionHash: hexToBin('11'.repeat(32)), outpointIndex: 0, sequenceNumber: 0xffffffff, unlockingBytecode: new Uint8Array() }],
    outputs: [{ lockingBytecode: locking.bytecode, valueSatoshis: 5000n }],
    locktime: 0,
  });
  const fundingId = txidOf(funding);
  const unsigned = buildAnchorTransaction(from.address, [{ txid: fundingId, vout: 0, satoshis: 5000 }], { pubkey: '00'.repeat(32), eventId: '00'.repeat(32) });
  unsigned.transaction.outputs[0] = { lockingBytecode: output, valueSatoshis: 0n };
  const signed = signP2pkh(unsigned.transaction, unsigned.sourceOutputs, from.bchPrivateKey);
  return { txid: txidOf(signed), evidence: { raw: binToHex(signed), sources: { [fundingId]: binToHex(funding) } } };
}

const NOT_FOUND = 'daemon error: No such mempool or blockchain transaction.';
export function server(name: string, txs: Record<string, string>): ChainServer {
  return {
    name,
    open: async () => ({
      history: async () => [],
      header: async () => '',
      unspent: async () => [],
      transaction: async (id: string) => {
        const hex = txs[id];
        if (!hex) throw new Error(NOT_FOUND);
        return hex;
      },
      close: async () => undefined,
    }),
  };
}
export const holding = (e: TxEvidence): Record<string, string> => ({ ...e.sources, [hashOf(e)]: e.raw });
export const hashOf = (e: TxEvidence): string => txidOf(hexToBin(e.raw));

