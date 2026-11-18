/**
 * Receipts from the command line: publish one with the Nostr key of a phrase file, or find the receipts of a
 * transaction and check them against the bindings and the chain. Nothing secret is printed.
 */
import { finalizeEvent } from 'nostr-tools/pure';
import { config } from '../config.js';
import type { OpenChain } from '../core/anchor-chain.js';
import { parsePubkey } from '../core/nostr.js';
import { keysFromPhrase } from '../core/paytaca.js';
import { createReceiptEvent, type ReceiptCheck } from '../core/receipt.js';
import { checkReceipts, findReceipts } from '../core/receipt-find.js';
import type { RelayOutcome } from '../core/publish.js';
import type { ManageDeps } from './manage.js';

export interface PublishedReceipt {
  npub: string;
  id: string;
  txid: string;
  payee: string;
  outcomes: RelayOutcome[];
}

/** Signs a receipt for `txid` paid to `payee` (npub or hex) with the phrase's Nostr key and publishes it. */
export async function publishReceipt(phrase: string, payee: string, txid: string, deps: ManageDeps): Promise<PublishedReceipt> {
  const key = parsePubkey(payee);
  if ('error' in key) throw new Error(key.error);
  const keys = keysFromPhrase(phrase, config.network);
  const now = (deps.now ?? (() => Math.floor(Date.now() / 1000)))();
  const event = finalizeEvent(createReceiptEvent({ payee: key.hex, txid, createdAt: now }), keys.nostrSecretKey);
  return { npub: keys.npub, id: event.id, txid: txid.trim().toLowerCase(), payee: key.hex, outcomes: await deps.publish(event) };
}

/** One line per check, in plain words. */
export function renderReceipt(c: ReceiptCheck): string {
  const chain = { found: 'transaction found on BCH', missing: 'transaction not found on BCH', unreachable: 'chain servers unreachable' }[c.chain];
  const payer = c.payer === 'from_bound' ? 'from a bound address' : 'payer not proven';
  const paid = c.chain !== 'found' ? '' : c.paysPayee ? ', pays an address bound to the payee' : ', pays no address bound to the payee';
  return `receipt ${c.eventId}\n  ${c.payerNpub} -> ${c.payeeNpub}\n  ${chain}${paid}\n  ${payer}`;
}

/** Finds and checks the receipts of a transaction. Exit 0 only when one is from a bound address and pays the payee. */
export async function receiptLookup(txid: string, json: boolean, deps: Pick<ManageDeps, 'query'>, open: OpenChain): Promise<number> {
  const checks = await checkReceipts(await findReceipts({ txid }, { query: deps.query }), open, { query: deps.query });
  if (json) console.log(JSON.stringify(checks, null, 2));
  else console.log(checks.length ? checks.map(renderReceipt).join('\n\n') : `no receipt found on the relays for ${txid}`);
  return checks.some((c) => c.payer === 'from_bound' && c.paysPayee) ? 0 : 1;
}
