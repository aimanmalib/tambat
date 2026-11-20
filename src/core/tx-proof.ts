/**
 * The on-chain proof form of a BCH claim: `["i", "bch:<cashaddr>", "tx:<txid>"]`. Instead of a signed message, the
 * address owner made a transaction that spends from the address and carries the NIP-39 verification text for the
 * author's npub in an OP_RETURN output. Some wallets can sign transactions but not messages, so this is how they bind.
 *
 * The checks are pure (`checkTxProof`); reading the transaction and the outputs it spends goes through the chain
 * quorum (`readTxEvidence`), so one lying server cannot make a proof pass. No chain read means the claim is skipped,
 * never passed (docs/decisions/0021-tx-proof.md).
 */
import {
  binToHex,
  createVirtualMachineBCH,
  decodeTransaction,
  encodeDataPush,
  hashTransaction,
  hexToBin,
  utf8ToBin,
  type Output,
} from '@bitauth/libauth';
import type { ChainSource } from './anchor-chain.js';
import { readQuorum, type ChainServer, type Tally } from './chain-quorum.js';
import { keyControlsPayload, type P2pkhAddress } from './cashaddr.js';
import { verificationText } from './nostr.js';

/** Prefix of a proof value that names a transaction instead of carrying a signature. */
export const TX_PROOF_PREFIX = 'tx:';
/** Prefix some clients put before a base64 signed message. It is dropped before the signature is read. */
export const MESSAGE_PROOF_PREFIX = 'msg:';

export type ProofForm = 'message' | 'tx';

export type Proof = { form: 'message'; signature: string } | { form: 'tx'; txid: string };

const TXID = /^[0-9a-f]{64}$/;

/** Reads the third value of an `i` tag. A `tx:` value with a malformed txid is still the tx form; the check fails it. */
export function parseProof(value: string): Proof {
  const v = value.trim();
  if (v.toLowerCase().startsWith(TX_PROOF_PREFIX)) return { form: 'tx', txid: v.slice(TX_PROOF_PREFIX.length).toLowerCase() };
  if (v.startsWith(MESSAGE_PROOF_PREFIX)) return { form: 'message', signature: v.slice(MESSAGE_PROOF_PREFIX.length) };
  return { form: 'message', signature: v };
}

/** A transaction as the chain servers returned it, with every transaction whose outputs it spends. Hex throughout. */
export interface TxEvidence {
  raw: string;
  sources: Record<string, string>;
}

/** What the verifier knows about one txid: the evidence, that the chain does not have it, or that it was not read. */
export type TxLookup =
  | { kind: 'found'; evidence: TxEvidence }
  | { kind: 'missing' }
  | { kind: 'unread'; servers?: Tally };

export type TxCheck =
  | { ok: true; publicKey: Uint8Array }
  | { ok: false; step: 'tx_found' | 'address_match' | 'tx_text'; code: TxFailCode; reason: string };

export type TxFailCode = 'tx_not_found' | 'tx_id_mismatch' | 'tx_no_input_from_address' | 'tx_text_mismatch';

/** OP_RETURN followed by one push of the verification text: the exact output a proof must carry. */
export function proofOutput(npub: string): Uint8Array {
  const push = encodeDataPush(utf8ToBin(verificationText(npub)));
  const out = new Uint8Array(push.length + 1);
  out[0] = 0x6a;
  out.set(push, 1);
  return out;
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/** The public key at the end of a P2PKH unlocking bytecode (`<sig> <pubkey>`), or null for any other shape. */
function unlockingPublicKey(unlocking: Uint8Array): Uint8Array | null {
  const sigLength = unlocking[0];
  if (sigLength === undefined || sigLength < 1 || sigLength > 75) return null;
  const at = 1 + sigLength;
  const keyLength = unlocking[at];
  if (keyLength !== 33 && keyLength !== 65) return null;
  if (unlocking.length !== at + 1 + keyLength) return null;
  return unlocking.slice(at + 1);
}

/**
 * Checks a transaction proof for `address` and `npub`: the transaction hashes to `txid`, at least one input spends a
 * P2PKH output of the address and the whole transaction passes the BCH virtual machine with the outputs it spends,
 * and one output is exactly `OP_RETURN <verification text for npub>`.
 */
export function checkTxProof(txid: string, address: P2pkhAddress, npub: string, evidence: TxEvidence): TxCheck {
  if (!TXID.test(txid)) return { ok: false, step: 'tx_found', code: 'tx_not_found', reason: `${txid} is not a transaction id` };
  const tx = decodeTransaction(hexToBin(evidence.raw));
  if (typeof tx === 'string') return { ok: false, step: 'tx_found', code: 'tx_not_found', reason: `transaction cannot be read: ${tx}` };
  if (hashTransaction(hexToBin(evidence.raw)) !== txid) {
    return { ok: false, step: 'tx_found', code: 'tx_id_mismatch', reason: 'the transaction the chain returned does not hash to this txid' };
  }
  const sourceOutputs: Output[] = [];
  for (const input of tx.inputs) {
    const sourceHex = evidence.sources[binToHex(input.outpointTransactionHash)];
    const source = sourceHex ? decodeTransaction(hexToBin(sourceHex)) : 'missing';
    const out = typeof source === 'string' ? undefined : source.outputs[input.outpointIndex];
    if (!out) return { ok: false, step: 'tx_found', code: 'tx_not_found', reason: 'an output this transaction spends could not be read' };
    sourceOutputs.push(out);
  }
  const expectedLock = new Uint8Array([0x76, 0xa9, 0x14, ...address.payload, 0x88, 0xac]);
  let publicKey: Uint8Array | null = null;
  tx.inputs.forEach((input, i) => {
    const key = unlockingPublicKey(input.unlockingBytecode);
    const spent = sourceOutputs[i];
    if (!publicKey && key && spent && sameBytes(spent.lockingBytecode, expectedLock) && keyControlsPayload(key, address.payload)) publicKey = key;
  });
  const vmResult = createVirtualMachineBCH(true).verify({ transaction: tx, sourceOutputs });
  if (!publicKey || vmResult !== true) {
    const why = !publicKey ? `no input spends from ${address.address}` : `the transaction does not pass the BCH virtual machine: ${String(vmResult)}`;
    return { ok: false, step: 'address_match', code: 'tx_no_input_from_address', reason: why };
  }
  const wanted = proofOutput(npub);
  if (!tx.outputs.some((o) => sameBytes(o.lockingBytecode, wanted))) {
    return { ok: false, step: 'tx_text', code: 'tx_text_mismatch', reason: `no output is OP_RETURN with the verification text for ${npub}` };
  }
  return { ok: true, publicKey };
}

/** The error a chain server gives for a txid it does not have (bitcoind code -5, passed on by Fulcrum). */
const NOT_FOUND = /No such mempool or blockchain transaction/i;

type Read = { missing: true } | { missing: false; evidence: TxEvidence };

async function readOne(chain: ChainSource, txid: string): Promise<Read> {
  let raw: string;
  try {
    raw = await chain.transaction(txid);
  } catch (e) {
    if (NOT_FOUND.test(String(e))) return { missing: true };
    throw e;
  }
  const tx = decodeTransaction(hexToBin(raw));
  const sources: Record<string, string> = {};
  if (typeof tx !== 'string') {
    for (const input of tx.inputs) {
      const id = binToHex(input.outpointTransactionHash);
      sources[id] ??= await chain.transaction(id);
    }
  }
  return { missing: false, evidence: { raw, sources } };
}

/** Reads a transaction and the outputs it spends from every chain server; kept only when they agree (quorum). */
export async function readTxEvidence(txid: string, servers: ChainServer[], quorum: number): Promise<TxLookup> {
  if (!TXID.test(txid)) return { kind: 'missing' };
  const read = await readQuorum(servers, quorum, (chain) => readOne(chain, txid));
  if (read.kind !== 'agreed') return { kind: 'unread', servers: read.tally };
  return read.value.missing ? { kind: 'missing' } : { kind: 'found', evidence: read.value.evidence };
}
