/**
 * Optional BCH anchor: an ordinary BCH transaction from the bound address with one OP_RETURN output that commits to
 * the Nostr key and the binding event id. Format (docs/SPEC.md "Optional BCH anchor"):
 *   OP_RETURN <prefix, 4 bytes> <type, 1 byte> <Nostr x-only public key, 32 bytes> <binding event id, 32 bytes>
 * The type byte is `anchor.version` for a commitment (bind) and `anchor.revokeVersion` for a revocation of that key
 * (docs/decisions/0013-revoke-by-transaction.md). The block that confirms it dates the pair (Nostr key, BCH address)
 * without trusting any relay or created_at.
 * This module only builds and reads transactions. It never signs or sends one: the wallet does (web/keys/anchor.ts).
 */
import {
  binToHex,
  cashAddressToLockingBytecode,
  decodeAuthenticationInstructions,
  decodeTransaction,
  encodeDataPush,
  hash160,
  hashTransaction,
  hexToBin,
  type Input,
  type Output,
  type TransactionCommon,
} from '@bitauth/libauth';
import { config } from '../config.js';
import { parseP2pkhAddress } from './cashaddr.js';

const OP_RETURN = 0x6a;
const HEX32 = /^[0-9a-f]{64}$/;

export interface AnchorPayload {
  /** Hex x-only Nostr public key. */
  pubkey: string;
  /** Hex id of the kind 10011 binding event. */
  eventId: string;
  /** Present only on a revocation: the address withdraws this key. Absent means a commitment (bind). */
  action?: 'revoke';
}

/** Why a transaction is not a valid commitment for an address. */
export type AnchorProblem = 'not_transaction' | 'no_payload' | 'wrong_prefix' | 'wrong_version' | 'not_from_address';

/** A commitment found in a confirmed transaction. */
export interface Commitment extends AnchorPayload {
  txid: string;
  /** Block height; 0 or less means not yet in a block. */
  height: number;
  /** Block time in Unix seconds, when known. */
  blockTime?: number;
}

export const prefixBytes = (prefix: string = config.anchor.prefix): Uint8Array => new TextEncoder().encode(prefix);

/** The OP_RETURN locking bytecode that commits a Nostr key and a binding event id. */
export function encodeAnchorScript(payload: AnchorPayload, prefix: string = config.anchor.prefix): Uint8Array {
  if (!HEX32.test(payload.pubkey) || !HEX32.test(payload.eventId)) throw new Error('pubkey and eventId must be 64 hex characters');
  // The version is a one-byte push (0x01 <version>), not OP_1: readers that only take data pushes see it the same way.
  const version = [0x01, payload.action === 'revoke' ? config.anchor.revokeVersion : config.anchor.version];
  const push = (bytes: Uint8Array) => [...encodeDataPush(bytes)];
  return Uint8Array.from([OP_RETURN, ...push(prefixBytes(prefix)), ...version, ...push(hexToBin(payload.pubkey)), ...push(hexToBin(payload.eventId))]);
}

/** Reads a commitment from an OP_RETURN locking bytecode, or says why it is not one. */
export function decodeAnchorScript(script: Uint8Array, prefix: string = config.anchor.prefix): AnchorPayload | AnchorProblem {
  if (script[0] !== OP_RETURN) return 'no_payload';
  const instructions = decodeAuthenticationInstructions(script.slice(1));
  // OP_1 to OP_16 also count as one-byte data, so a version written as a small-number opcode reads the same.
  const data = instructions.map((i) => ('data' in i ? i.data : i.opcode >= 0x51 && i.opcode <= 0x60 ? Uint8Array.of(i.opcode - 0x50) : undefined));
  if (data.length === 0 || data.some((d) => d === undefined)) return 'no_payload';
  const [tag, version, pubkey, eventId] = data as Uint8Array[];
  if (binToHex(tag ?? new Uint8Array()) !== binToHex(prefixBytes(prefix))) return 'wrong_prefix';
  const type = version?.length === 1 ? version[0] : undefined;
  if (data.length !== 4 || (type !== config.anchor.version && type !== config.anchor.revokeVersion)) return 'wrong_version';
  if (pubkey?.length !== 32 || eventId?.length !== 32) return 'wrong_version';
  const payload: AnchorPayload = { pubkey: binToHex(pubkey), eventId: binToHex(eventId) };
  return type === config.anchor.revokeVersion ? { ...payload, action: 'revoke' } : payload;
}

/** Public key pushed by a P2PKH unlocking bytecode (<signature> <public key>), if the input has that shape. */
function p2pkhInputKey(input: Input): Uint8Array | undefined {
  const pushes = decodeAuthenticationInstructions(input.unlockingBytecode);
  if (pushes.length !== 2) return undefined;
  const key = pushes[1] && 'data' in pushes[1] ? pushes[1].data : undefined;
  return key && (key.length === 33 || key.length === 65) ? key : undefined;
}

/**
 * Checks that a transaction is a commitment made from `address`: it carries the payload and at least one P2PKH input
 * spends with the key behind the address (HASH160 of the input's public key equals the address payload). A confirmed
 * transaction proves that key signed it, because the network checked the signature.
 */
export function commitmentFromTransaction(tx: TransactionCommon | Uint8Array, address: string): AnchorPayload | AnchorProblem {
  const decoded = tx instanceof Uint8Array ? decodeTransaction(tx) : tx;
  if (typeof decoded === 'string') return 'not_transaction';
  const parsed = parseP2pkhAddress(address);
  if (typeof parsed === 'string') return 'not_from_address';
  let payload: AnchorPayload | AnchorProblem = 'no_payload';
  for (const output of decoded.outputs) {
    const found = decodeAnchorScript(output.lockingBytecode);
    if (typeof found !== 'string') {
      payload = found;
      break;
    }
    if (found !== 'no_payload') payload = found;
  }
  if (typeof payload === 'string') return payload;
  const fromAddress = decoded.inputs.some((input) => {
    const key = p2pkhInputKey(input);
    return key !== undefined && binToHex(hash160(key)) === binToHex(parsed.payload);
  });
  return fromAddress ? payload : 'not_from_address';
}

/**
 * Order of commitments on the chain: lower block first; in the same block a commitment before a revocation (the
 * cautious reading: the revocation is the last word), then lower txid, so every reader agrees.
 */
export function chainOrder(a: Commitment, b: Commitment): number {
  if (a.height !== b.height) return a.height - b.height;
  const rank = (c: Commitment) => (c.action === 'revoke' ? 1 : 0);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  return a.txid < b.txid ? -1 : a.txid > b.txid ? 1 : 0;
}

/**
 * The commitment that dates a binding: confirmed, for the Nostr key whose current binding still claims the address,
 * and the earliest such block after the last revocation of that key (lowest height, then lowest txid for a stable
 * answer). Null when there is none, or when the key's last word on the chain is a revocation.
 */
export function earliestCommitment(commitments: Commitment[], currentPubkey: string): Commitment | null {
  const mine = commitments.filter((c) => c.height > 0 && c.pubkey === currentPubkey).sort(chainOrder);
  let start = 0;
  mine.forEach((c, i) => {
    if (c.action === 'revoke') start = i + 1;
  });
  return mine.slice(start)[0] ?? null;
}

/** An unspent output of the bound address, as a chain server lists it. */
export interface Utxo {
  txid: string;
  vout: number;
  satoshis: number;
  /** Block height of the coin; 0 or less, or missing, means not yet in a block. */
  height?: number;
}

/** What the wallet is asked to sign: the transaction without signatures and the outputs it spends (wc2-bch-bcr). */
export interface UnsignedAnchor {
  transaction: TransactionCommon;
  sourceOutputs: (Input & Output)[];
  feeSats: number;
  changeSats: number;
}

/** Serialized size of a P2PKH input with a 65-byte Schnorr signature and a compressed key. */
const P2PKH_INPUT_BYTES = 32 + 4 + 1 + (1 + 65 + 1 + 33) + 4;

/** Size in bytes of the signed transaction, for the fee. */
export function anchorSize(inputCount: number, anchorScriptBytes: number, changeScriptBytes: number): number {
  const output = (scriptBytes: number) => 8 + 1 + scriptBytes;
  return 4 + 1 + inputCount * P2PKH_INPUT_BYTES + 1 + output(anchorScriptBytes) + output(changeScriptBytes) + 4;
}

/**
 * Builds the commitment transaction: every UTXO of the address in, one OP_RETURN (0 sat) and the change back to the
 * SAME address out. Throws when the fee would pass `maxFeeSats` or the change would be dust.
 */
export function buildAnchorTransaction(address: string, utxos: Utxo[], payload: AnchorPayload): UnsignedAnchor {
  return buildOpReturnTransaction(address, utxos, encodeAnchorScript(payload));
}

/**
 * The same transaction with any OP_RETURN locking bytecode as its first output: the anchor's, or the NIP-39 text of an
 * on-chain binding proof (tx-proof.ts `proofOutput`).
 */
export function buildOpReturnTransaction(address: string, utxos: Utxo[], anchorScript: Uint8Array): UnsignedAnchor {
  const locking = cashAddressToLockingBytecode(address);
  if (typeof locking === 'string' || typeof parseP2pkhAddress(address) === 'string') throw new Error('address must be a P2PKH CashAddr');
  if (utxos.length === 0) throw new Error('the address has no unspent outputs to pay the fee');
  const feeSats = Math.ceil(anchorSize(utxos.length, anchorScript.length, locking.bytecode.length) * config.anchor.feePerByte);
  if (feeSats > config.anchor.maxFeeSats) throw new Error(`fee ${feeSats} sat is above the limit of ${config.anchor.maxFeeSats} sat`);
  const total = utxos.reduce((sum, u) => sum + u.satoshis, 0);
  const changeSats = total - feeSats;
  if (changeSats < config.anchor.dustSats) throw new Error(`the address holds ${total} sat, too little to pay the fee and keep the change`);
  const inputs: Input[] = utxos.map((u) => ({
    outpointTransactionHash: hexToBin(u.txid),
    outpointIndex: u.vout,
    sequenceNumber: 0xffffffff,
    unlockingBytecode: new Uint8Array(),
  }));
  const outputs: Output[] = [
    { lockingBytecode: anchorScript, valueSatoshis: 0n },
    { lockingBytecode: locking.bytecode, valueSatoshis: BigInt(changeSats) },
  ];
  const sourceOutputs = utxos.map((u, i) => ({ ...inputs[i]!, lockingBytecode: locking.bytecode, valueSatoshis: BigInt(u.satoshis) }));
  return { transaction: { version: 2, inputs, outputs, locktime: 0 }, sourceOutputs, feeSats, changeSats };
}

/** The transaction to ask the wallet for, and whether it spends a coin not yet in a block. */
export interface PreparedAnchor extends UnsignedAnchor {
  unconfirmed: boolean;
}

/** Why no anchor can be built from the coins: none, only coins not yet in a block, too little, or the fee limit. */
export type AnchorRefusal = 'no_coins' | 'unconfirmed' | 'too_little' | 'fee_high';

const confirmed = (u: Utxo): boolean => (u.height ?? 0) > 0;

function tryBuild(address: string, coins: Utxo[], script: Uint8Array): UnsignedAnchor | 'too_little' | 'fee_high' {
  try {
    return buildOpReturnTransaction(address, coins, script);
  } catch (e) {
    if ((e as Error).message.includes('above the limit')) return 'fee_high';
    if (coins.length === 0 || (e as Error).message.includes('too little')) return 'too_little';
    throw e;
  }
}

/**
 * The anchor from an address's coins. With `confirmedOnly` (config anchor.confirmedCoinsOnly) coins not yet in a block
 * are left out, and when only they would pay the fee the answer is 'unconfirmed': wait for one block, then try again,
 * rather than ask a wallet that may not know those coins yet.
 */
export function anchorFromCoins(
  address: string,
  utxos: Utxo[],
  payload: AnchorPayload,
  confirmedOnly: boolean = config.anchor.confirmedCoinsOnly,
): PreparedAnchor | AnchorRefusal {
  return opReturnFromCoins(address, utxos, encodeAnchorScript(payload), confirmedOnly);
}

/** `anchorFromCoins` for any OP_RETURN locking bytecode. */
export function opReturnFromCoins(
  address: string,
  utxos: Utxo[],
  script: Uint8Array,
  confirmedOnly: boolean = config.anchor.confirmedCoinsOnly,
): PreparedAnchor | AnchorRefusal {
  if (utxos.length === 0) return 'no_coins';
  const coins = confirmedOnly ? utxos.filter(confirmed) : utxos;
  const built = tryBuild(address, coins, script);
  if (typeof built !== 'string') return { ...built, unconfirmed: !coins.every(confirmed) };
  if (coins.length < utxos.length && typeof tryBuild(address, utxos, script) !== 'string') return 'unconfirmed';
  return built;
}

/** Transaction id (UI byte order) of an encoded transaction. */
export const txidOf = (encoded: Uint8Array): string => hashTransaction(encoded);
