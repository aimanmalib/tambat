/**
 * Payment receipts (docs/SPEC.md "Payment receipts", ADR 0010). After paying an identity, the payer may publish a
 * NIP-32 label event (an existing kind, config `receipt.kind`) that names the paid key in a `p` tag and the BCH
 * transaction as a NIP-73 external id, `["i", "bitcoincash:tx:<txid>"]`. A receipt is only a claim: the checks
 * below read the transaction from the chain and say "from a bound address" only when every input spends from an
 * address bound to the receipt's author. Anything less is "payer not proven".
 */
import { binToHex, decodeTransaction, hashTransaction, hexToBin, lockingBytecodeToCashAddress, type TransactionCommon } from '@bitauth/libauth';
import { config, type Network } from '../config.js';
import { eventShapeError, idMatches, isPubkeyHex, signatureValid, toNpub, type Event, type EventTemplate } from './nostr.js';
import type { ChainSource } from './anchor-chain.js';

const TXID = /^[0-9a-f]{64}$/;

/** NIP-73 blockchain transaction id prefix, `<blockchain>:tx:`. On mainnet this is `bitcoincash:tx:`. */
export const txTagPrefix = (network: Network = config.network): string => `${network}:tx:`;
/** NIP-73 `k` tag value for the same id kind. */
export const txKind = (network: Network = config.network): string => `${network}:tx`;

export interface CreateReceiptInput {
  /** Hex key of the identity that was paid. */
  payee: string;
  txid: string;
  createdAt?: number;
  network?: Network;
}

/** The unsigned receipt event. The payer's own Nostr key signs it. */
export function createReceiptEvent(input: CreateReceiptInput): EventTemplate {
  const txid = input.txid.trim().toLowerCase();
  if (!TXID.test(txid)) throw new Error('txid must be 64 hex characters');
  if (!isPubkeyHex(input.payee)) throw new Error('payee must be a 64-character hex public key');
  const { namespace, label } = config.receipt;
  return {
    kind: config.receipt.kind,
    created_at: input.createdAt ?? Math.floor(Date.now() / 1000),
    content: '',
    tags: [
      ['L', namespace],
      ['l', label, namespace],
      ['p', input.payee],
      ['i', `${txTagPrefix(input.network)}${txid}`],
      ['k', txKind(input.network)],
    ],
  };
}

export interface ParsedReceipt {
  event: Event;
  payer: string;
  payee: string;
  txid: string;
}

export type ReceiptProblem = 'shape' | 'event_id' | 'signature' | 'not_receipt' | 'no_payee' | 'no_txid';

/** Checks a receipt event on its own (shape, id, signature, tags) and reads who paid whom in which transaction. */
export function parseReceipt(input: unknown, network: Network = config.network): ParsedReceipt | ReceiptProblem {
  if (eventShapeError(input)) return 'shape';
  const event = input as Event;
  if (!idMatches(event)) return 'event_id';
  if (!signatureValid(event)) return 'signature';
  const { kind, namespace, label } = config.receipt;
  const labelled = event.tags.some((t) => t[0] === 'l' && t[1] === label && t[2] === namespace);
  if (event.kind !== kind || !labelled) return 'not_receipt';
  const payees = event.tags.filter((t) => t[0] === 'p' && isPubkeyHex(t[1] ?? ''));
  if (payees.length !== 1) return 'no_payee';
  const prefix = txTagPrefix(network);
  const ids = event.tags.filter((t) => t[0] === 'i' && t[1]?.startsWith(prefix) && TXID.test(t[1].slice(prefix.length)));
  if (ids.length !== 1) return 'no_txid';
  return { event, payer: event.pubkey, payee: payees[0]![1]!, txid: ids[0]![1]!.slice(prefix.length) };
}

export type PayerVerdict = 'from_bound' | 'not_proven';

export interface ReceiptCheck {
  eventId: string;
  txid: string;
  payerNpub: string;
  payeeNpub: string;
  /** `missing`: no chain server knows the transaction. `unreachable`: no chain server answered. */
  chain: 'found' | 'missing' | 'unreachable';
  /** An output of the transaction pays an address bound to the payee. */
  paysPayee: boolean;
  /** `from_bound` only when every input spends from an address bound to the receipt's author. */
  payer: PayerVerdict;
  /** The input addresses the chain reported, in input order (empty when not read). */
  inputAddresses: string[];
}

function addressOf(lockingBytecode: Uint8Array, network: Network): string | null {
  const r = lockingBytecodeToCashAddress({ bytecode: lockingBytecode, prefix: network });
  return typeof r === 'string' ? null : r.address;
}

/** Decodes a transaction from a chain server, and only if it hashes to the id asked for: the server is not trusted. */
function decode(hex: string, txid: string): TransactionCommon | null {
  if (typeof hex !== 'string' || !/^([0-9a-f]{2})+$/i.test(hex)) return null;
  const bytes = hexToBin(hex);
  if (hashTransaction(bytes) !== txid) return null;
  const tx = decodeTransaction(bytes);
  return typeof tx === 'string' ? null : tx;
}

/** The address each input spends from, read from the previous transactions. Null when one cannot be read. */
async function inputAddresses(tx: TransactionCommon, chain: ChainSource, network: Network): Promise<string[] | null> {
  if (tx.inputs.length > config.receipt.inputLimit) return null;
  const found: string[] = [];
  for (const input of tx.inputs) {
    const txid = binToHex(input.outpointTransactionHash);
    const previous = decode(await chain.transaction(txid), txid);
    const spent = previous?.outputs[input.outpointIndex];
    const address = spent ? addressOf(spent.lockingBytecode, network) : null;
    if (!address) return null;
    found.push(address);
  }
  return found;
}

export interface CheckReceiptOptions {
  /** Addresses in the payer's newest verified binding. */
  payerAddresses: string[];
  /** Addresses in the payee's newest verified binding. */
  payeeAddresses: string[];
  chain: ChainSource | null;
  network?: Network;
}

/** Reads the receipt's transaction from the chain and checks who it came from and whom it paid. Read only. */
export async function checkReceipt(receipt: ParsedReceipt, options: CheckReceiptOptions): Promise<ReceiptCheck> {
  const network = options.network ?? config.network;
  const base: ReceiptCheck = {
    eventId: receipt.event.id,
    txid: receipt.txid,
    payerNpub: toNpub(receipt.payer),
    payeeNpub: toNpub(receipt.payee),
    chain: 'unreachable',
    paysPayee: false,
    payer: 'not_proven',
    inputAddresses: [],
  };
  if (!options.chain) return base;
  let hex: string;
  try {
    hex = await options.chain.transaction(receipt.txid);
  } catch {
    return { ...base, chain: 'missing' };
  }
  const tx = decode(hex, receipt.txid);
  if (!tx) return { ...base, chain: 'missing' };
  const payee = new Set(options.payeeAddresses);
  const paysPayee = tx.outputs.some((o) => {
    const a = addressOf(o.lockingBytecode, network);
    return a !== null && o.valueSatoshis > 0n && payee.has(a);
  });
  let inputs: string[] | null;
  try {
    inputs = await inputAddresses(tx, options.chain, network);
  } catch {
    inputs = null;
  }
  const bound = new Set(options.payerAddresses);
  const fromBound = inputs !== null && inputs.length > 0 && inputs.every((a) => bound.has(a));
  return { ...base, chain: 'found', paysPayee, payer: fromBound ? 'from_bound' : 'not_proven', inputAddresses: inputs ?? [] };
}
