/**
 * Finding and checking payment receipts: receipts come from relays (untrusted, each one checked again here), the
 * payer's and payee's bound addresses from their newest verified bindings, and the transaction from a chain server.
 */
import { config } from '../config.js';
import type { OpenChain, ChainSource } from './anchor-chain.js';
import { guardedQuery, lookupByPubkey, relayQuery, type DiscoverOptions } from './discover.js';
import { checkReceipt, parseReceipt, txTagPrefix, type ParsedReceipt, type ReceiptCheck } from './receipt.js';
import type { BindingResult } from './verify.js';

export type ReceiptQuery = { txid: string } | { payee: string };

/** Verified receipts from the relays for one transaction or one paid key, newest first, one per event id. */
export async function findReceipts(by: ReceiptQuery, options: DiscoverOptions = {}): Promise<ParsedReceipt[]> {
  const { kind, namespace } = config.receipt;
  const filter = 'txid' in by
    ? { kinds: [kind], '#i': [`${txTagPrefix(options.network)}${by.txid.toLowerCase()}`] }
    : { kinds: [kind], '#p': [by.payee], '#L': [namespace] };
  const raw = await guardedQuery(
    options.query ?? relayQuery,
    options.relays ?? config.nostr.relays,
    filter,
    options.timeoutMs ?? config.nostr.queryTimeoutMs,
    options.watch,
  );
  const seen = new Map<string, ParsedReceipt>();
  for (const item of raw) {
    const r = parseReceipt(item, options.network);
    if (typeof r === 'string' || seen.has(r.event.id)) continue;
    if ('txid' in by ? r.txid !== by.txid.toLowerCase() : r.payee !== by.payee) continue;
    seen.set(r.event.id, r);
  }
  return [...seen.values()].sort((a, b) => b.event.created_at - a.event.created_at);
}

/** Addresses of a key's newest binding when it verifies, otherwise none. */
export const boundAddresses = (r: BindingResult | null): string[] =>
  r?.ok ? r.claims.filter((c) => c.ok).map((c) => c.address.toLowerCase()) : [];

/** Checks receipts against their authors' and payees' bindings and the chain. One chain connection for all. */
export async function checkReceipts(receipts: ParsedReceipt[], open: OpenChain, options: DiscoverOptions = {}): Promise<ReceiptCheck[]> {
  if (receipts.length === 0) return [];
  const keys = [...new Set(receipts.flatMap((r) => [r.payer, r.payee]))];
  const bindings = new Map(await Promise.all(keys.map(async (k) => [k, boundAddresses(await lookupByPubkey(k, options))] as const)));
  const chain: ChainSource | null = await open().catch(() => null);
  try {
    const checks: ReceiptCheck[] = [];
    for (const r of receipts) {
      checks.push(
        await checkReceipt(r, {
          payerAddresses: bindings.get(r.payer) ?? [],
          payeeAddresses: bindings.get(r.payee) ?? [],
          chain,
          ...(options.network ? { network: options.network } : {}),
        }),
      );
    }
    return checks;
  } finally {
    await chain?.close();
  }
}
