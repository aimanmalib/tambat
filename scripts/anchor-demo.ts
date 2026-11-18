/**
 * The optional BCH anchor (docs/SPEC.md "Optional BCH anchor") made from the project's own demo key, within a fixed
 * budget (config anchor.demoBudget).
 *   npx tsx scripts/anchor-demo.ts               build and sign the commitment for the demo key's current binding, check it, print it
 *   npx tsx scripts/anchor-demo.ts --broadcast   the same, then record it in the budget ledger and only then send it
 * Outputs are exactly one OP_RETURN (0 sat) and the change back to the same demo address. The ledger entry is written
 * before the transaction is sent, so a crash can never spend more than the ledger shows. Only public values are
 * printed (address, npub, txid, fee); the phrase stays in the key file.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { binToHex, cashAddressToLockingBytecode, decodeTransaction, hexToBin } from '@bitauth/libauth';
import { config } from '../src/config.js';
import { anchorFromCoins, decodeAnchorScript, txidOf, type AnchorPayload, type AnchorRefusal } from '../src/core/anchor.js';
import { electrumChain, readCommitments, scripthashOf, type ChainSource } from '../src/core/anchor-chain.js';
import { signP2pkh } from '../src/core/anchor-sign.js';
import { lookupByPubkey } from '../src/core/discover.js';
import { keysFromPhrase } from '../src/core/paytaca.js';
import { nodeRelayQuery } from '../src/node/relay.js';
import { readPhrase } from '../src/node/manage.js';

export interface LedgerEntry {
  utc: string;
  txid: string;
  feeSats: number;
  signer: 'demo';
}

export interface Ledger {
  transactions: LedgerEntry[];
}

export type DemoRefusal = AnchorRefusal | 'budget_full' | 'fee_budget' | 'already_anchored';

export interface AnchorPlan {
  txid: string;
  hex: string;
  feeSats: number;
  changeSats: number;
  inputs: number;
}

/** Reads the budget ledger; a missing file is an empty ledger, a malformed one is an error (never overwrite it). */
export function readLedger(file: string): Ledger {
  if (!existsSync(file)) return { transactions: [] };
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<Ledger>;
  if (!Array.isArray(parsed.transactions)) throw new Error(`${file} has no transactions list`);
  return { transactions: parsed.transactions };
}

/** Writes the ledger through a temporary file and a rename, mode 0600. */
export function writeLedger(file: string, ledger: Ledger): void {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, file);
}

/** Why a ledger cannot take one more transaction with this fee, or null when it can. */
export function budgetRefusal(ledger: Ledger, feeSats: number): 'budget_full' | 'fee_budget' | null {
  const { maxTransactions, maxTotalFeeSats } = config.anchor.demoBudget;
  if (ledger.transactions.length >= maxTransactions) return 'budget_full';
  const spent = ledger.transactions.reduce((sum, t) => sum + t.feeSats, 0);
  return feeSats > config.anchor.maxFeeSats || spent + feeSats > maxTotalFeeSats ? 'fee_budget' : null;
}

/**
 * Checks a signed commitment before anything is recorded or sent: exactly two outputs, the first a 0 sat OP_RETURN
 * carrying `payload`, the second the change to `address`; every input spends `address`; the fee is the inputs minus
 * the change. Returns the problem, or null.
 */
export function outputProblem(encoded: Uint8Array, address: string, payload: AnchorPayload, inputSats: number[]): string | null {
  const tx = decodeTransaction(encoded);
  if (typeof tx === 'string') return tx;
  const locking = cashAddressToLockingBytecode(address);
  if (typeof locking === 'string') return locking;
  const own = binToHex(locking.bytecode);
  if (tx.outputs.length !== 2) return `expected 2 outputs, found ${tx.outputs.length}`;
  const [data, change] = tx.outputs as [(typeof tx.outputs)[0], (typeof tx.outputs)[0]];
  const decoded = decodeAnchorScript(data.lockingBytecode);
  if (data.valueSatoshis !== 0n || typeof decoded === 'string') return 'first output is not a 0 sat commitment';
  if (decoded.pubkey !== payload.pubkey || decoded.eventId !== payload.eventId) return 'commitment does not carry the demo binding';
  if (binToHex(change.lockingBytecode) !== own) return 'change does not go back to the demo address';
  if (tx.inputs.length !== inputSats.length) return 'inputs do not match the coins read from the chain';
  const fee = inputSats.reduce((sum, s) => sum + s, 0) - Number(change.valueSatoshis);
  return fee >= 0 && fee <= config.anchor.maxFeeSats ? null : `fee ${fee} sat is outside 0 to ${config.anchor.maxFeeSats}`;
}

/** Builds, signs and checks the commitment from the address's confirmed coins, or says why not. Sends nothing. */
export async function planAnchor(
  address: string,
  privateKey: Uint8Array,
  payload: AnchorPayload,
  chain: ChainSource,
  ledger: Ledger,
): Promise<AnchorPlan | DemoRefusal> {
  if (budgetRefusal(ledger, 0) === 'budget_full') return 'budget_full';
  const done = await readCommitments(address, chain);
  if (done.some((c) => c.pubkey === payload.pubkey && c.eventId === payload.eventId)) return 'already_anchored';
  const prepared = anchorFromCoins(address, await chain.unspent(scripthashOf(address)), payload);
  if (typeof prepared === 'string') return prepared;
  const refusal = budgetRefusal(ledger, prepared.feeSats);
  if (refusal) return refusal;
  const encoded = signP2pkh(prepared.transaction, prepared.sourceOutputs, privateKey);
  const problem = outputProblem(encoded, address, payload, prepared.sourceOutputs.map((o) => Number(o.valueSatoshis)));
  if (problem) throw new Error(`refusing the signed transaction: ${problem}`);
  return { txid: txidOf(encoded), hex: binToHex(encoded), feeSats: prepared.feeSats, changeSats: prepared.changeSats, inputs: prepared.transaction.inputs.length };
}

/** Records the plan in the ledger, then sends it. Throws when the server reports another txid. */
export async function sendAnchor(plan: AnchorPlan, chain: ChainSource, ledgerFile: string, now: Date = new Date()): Promise<string> {
  if (!chain.send) throw new Error('the chain server connection cannot send transactions');
  const ledger = readLedger(ledgerFile);
  const refusal = budgetRefusal(ledger, plan.feeSats);
  if (refusal) throw new Error(`budget: ${refusal}`);
  if (txidOf(hexToBin(plan.hex)) !== plan.txid) throw new Error('plan txid does not match its transaction');
  writeLedger(ledgerFile, { transactions: [...ledger.transactions, { utc: now.toISOString(), txid: plan.txid, feeSats: plan.feeSats, signer: 'demo' }] });
  const reported = await chain.send(plan.hex);
  if (reported !== plan.txid) throw new Error(`the server reported txid ${reported}, expected ${plan.txid}`);
  return reported;
}

async function main(broadcast: boolean): Promise<number> {
  const keys = keysFromPhrase(readPhrase(resolve(process.env.TAMBAT_DEMO_KEYS ?? 'state/demo-keys.json')), config.network);
  const binding = await lookupByPubkey(keys.nostrPubkey, { query: nodeRelayQuery });
  if (!binding?.ok) throw new Error(`no verified binding on the relays for ${keys.npub}`);
  const payload = { pubkey: keys.nostrPubkey, eventId: binding.eventId };
  const ledgerFile = resolve(config.anchor.demoBudget.ledger);
  const chain = await electrumChain()();
  try {
    const plan = await planAnchor(keys.address, keys.bchPrivateKey, payload, chain, readLedger(ledgerFile));
    const summary = { address: keys.address, npub: keys.npub, eventId: binding.eventId };
    if (typeof plan === 'string') {
      console.log(JSON.stringify({ ...summary, refused: plan }, null, 2));
      return 1;
    }
    const shown = { txid: plan.txid, feeSats: plan.feeSats, changeSats: plan.changeSats, inputs: plan.inputs };
    if (!broadcast) {
      console.log(JSON.stringify({ ...summary, ...shown, sent: false }, null, 2));
      return 0;
    }
    const txid = await sendAnchor(plan, chain, ledgerFile);
    console.log(JSON.stringify({ ...summary, ...shown, txid, sent: true }, null, 2));
    return 0;
  } finally {
    await chain.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args.some((a) => a !== '--broadcast')) {
    console.error('usage: anchor-demo.ts [--broadcast]');
    process.exitCode = 2;
  } else {
    process.exitCode = await main(args.includes('--broadcast'));
  }
}
