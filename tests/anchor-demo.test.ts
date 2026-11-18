import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decodeTransaction, hexToBin } from '@bitauth/libauth';
import { config } from '../src/config.js';
import { buildAnchorTransaction, commitmentFromTransaction, txidOf } from '../src/core/anchor.js';
import { scripthashOf, type ChainSource } from '../src/core/anchor-chain.js';
import { budgetRefusal, outputProblem, planAnchor, readLedger, sendAnchor, type AnchorPlan, type Ledger } from '../scripts/anchor-demo.js';
import { signP2pkh, hexOf } from './anchor-wallet.js';
import { fakeSource, type FakeChain } from './fake-fulcrum.js';
import { keys, other, vectors } from './helpers.js';

const payload = { pubkey: keys.nostrPubkey, eventId: vectors.bindingEvent.id };
const coin = (value: number, height = 950_000, pos = 0) => ({ tx_hash: '55'.repeat(32), tx_pos: pos, value, height });
const funded = (coins = [coin(5000)]): FakeChain => ({ history: {}, headers: {}, unspent: { [scripthashOf(keys.address)]: coins } });
const entry = (feeSats: number, n = 1) => ({ utc: '2026-11-18T00:00:00.000Z', txid: String(n).repeat(64).slice(0, 64), feeSats, signer: 'demo' as const });
const empty: Ledger = { transactions: [] };

let dir: string;
let ledgerFile: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tambat-anchor-demo-'));
  ledgerFile = join(dir, 'anchor', 'budget.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A chain source that records what it is asked to send, and what the ledger said at that moment. */
function sending(data: FakeChain, reply?: (hex: string) => string) {
  const sent: { hex: string; ledgerAtSend: Ledger | null }[] = [];
  const source: ChainSource = {
    ...fakeSource(data),
    send: async (hex) => {
      sent.push({ hex, ledgerAtSend: existsSync(ledgerFile) ? readLedger(ledgerFile) : null });
      return reply ? reply(hex) : txidOf(hexToBin(hex));
    },
  };
  return { source, sent };
}

describe('demo key anchor budget', () => {
  it('reads the limits from config and refuses a third transaction or a fee over the total', () => {
    expect(config.anchor.demoBudget.maxTransactions).toBeGreaterThan(0);
    expect(budgetRefusal(empty, 300)).toBeNull();
    const full = { transactions: Array.from({ length: config.anchor.demoBudget.maxTransactions }, (_, i) => entry(100, i + 1)) };
    expect(budgetRefusal(full, 1)).toBe('budget_full');
    const nearly = { transactions: [entry(config.anchor.demoBudget.maxTotalFeeSats - 100)] };
    expect(budgetRefusal(nearly, 101)).toBe('fee_budget');
    expect(budgetRefusal(empty, config.anchor.maxFeeSats + 1)).toBe('fee_budget');
  });

  it('treats a missing ledger as empty and refuses a malformed one', () => {
    expect(readLedger(ledgerFile)).toEqual(empty);
    writeFileSync(join(dir, 'bad.json'), '{"spent": 3}');
    expect(() => readLedger(join(dir, 'bad.json'))).toThrow(/no transactions list/);
  });
});

describe('demo key anchor plan', () => {
  it('signs a commitment from the demo address with one OP_RETURN and the change back, sending nothing', async () => {
    const { source, sent } = sending(funded());
    const plan = (await planAnchor(keys.address, keys.bchPrivateKey, payload, source, empty)) as AnchorPlan;
    expect(typeof plan).toBe('object');
    const bytes = hexToBin(plan.hex);
    expect(commitmentFromTransaction(bytes, keys.address)).toEqual(payload);
    const tx = decodeTransaction(bytes);
    if (typeof tx === 'string') throw new Error(tx);
    expect(tx.outputs).toHaveLength(2);
    expect(plan.feeSats).toBeLessThanOrEqual(config.anchor.maxFeeSats);
    expect(Number(tx.outputs[1]!.valueSatoshis)).toBe(5000 - plan.feeSats);
    expect(plan.txid).toBe(txidOf(bytes));
    expect(sent).toHaveLength(0);
    expect(existsSync(ledgerFile)).toBe(false);
  });

  it('says why when there are no coins, only unconfirmed coins, or too little', async () => {
    const plan = (data: FakeChain) => planAnchor(keys.address, keys.bchPrivateKey, payload, fakeSource(data), empty);
    expect(await plan(funded([]))).toBe('no_coins');
    expect(await plan(funded([coin(5000, 0)]))).toBe('unconfirmed');
    expect(await plan(funded([coin(600)]))).toBe('too_little');
  });

  it('refuses when the budget is full, before reading coins', async () => {
    const full = { transactions: [entry(300, 1), entry(300, 2)] };
    expect(await planAnchor(keys.address, keys.bchPrivateKey, payload, fakeSource(funded()), full)).toBe('budget_full');
  });

  it('refuses to commit the same binding twice, even while the first is not yet in a block', async () => {
    const unsigned = buildAnchorTransaction(keys.address, [{ txid: '66'.repeat(32), vout: 0, satoshis: 5000 }], payload);
    const bytes = signP2pkh(unsigned.transaction, unsigned.sourceOutputs, keys.bchPrivateKey);
    const data = funded();
    data.history[scripthashOf(keys.address)] = [{ hex: hexOf(bytes), txid: txidOf(bytes), height: 0 }];
    expect(await planAnchor(keys.address, keys.bchPrivateKey, payload, fakeSource(data), empty)).toBe('already_anchored');
  });

  it('rejects change that goes to another address', () => {
    const unsigned = buildAnchorTransaction(other.address, [{ txid: '77'.repeat(32), vout: 0, satoshis: 5000 }], payload);
    const bytes = signP2pkh(unsigned.transaction, unsigned.sourceOutputs, other.bchPrivateKey);
    expect(outputProblem(bytes, keys.address, payload, [5000])).toMatch(/change/);
  });
});

describe('output check', () => {
  const build = (p = payload, address = keys.address) => {
    const unsigned = buildAnchorTransaction(address, [{ txid: '88'.repeat(32), vout: 0, satoshis: 5000 }], p);
    return { bytes: signP2pkh(unsigned.transaction, unsigned.sourceOutputs, keys.bchPrivateKey), fee: unsigned.feeSats };
  };

  it('accepts the commitment and rejects another event, missing inputs or a fee over the limit', () => {
    const { bytes } = build();
    expect(outputProblem(bytes, keys.address, payload, [5000])).toBeNull();
    expect(outputProblem(bytes, keys.address, { ...payload, eventId: 'ab'.repeat(32) }, [5000])).toMatch(/demo binding/);
    expect(outputProblem(bytes, keys.address, payload, [5000, 1])).toMatch(/inputs/);
    expect(outputProblem(bytes, keys.address, payload, [5000 + config.anchor.maxFeeSats])).toMatch(/fee/);
  });

  it('rejects a third output', () => {
    const unsigned = buildAnchorTransaction(keys.address, [{ txid: '99'.repeat(32), vout: 0, satoshis: 5000 }], payload);
    const extra = { ...unsigned.transaction, outputs: [...unsigned.transaction.outputs, unsigned.transaction.outputs[1]!] };
    const bytes = signP2pkh(extra, unsigned.sourceOutputs, keys.bchPrivateKey);
    expect(outputProblem(bytes, keys.address, payload, [5000])).toMatch(/2 outputs/);
  });
});

describe('sending', () => {
  it('writes the ledger entry before the transaction leaves, mode 0600', async () => {
    const { source, sent } = sending(funded());
    const plan = (await planAnchor(keys.address, keys.bchPrivateKey, payload, source, empty)) as AnchorPlan;
    const txid = await sendAnchor(plan, source, ledgerFile, new Date('2026-11-18T12:00:00Z'));
    expect(txid).toBe(plan.txid);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.ledgerAtSend?.transactions).toEqual([{ utc: '2026-11-18T12:00:00.000Z', txid: plan.txid, feeSats: plan.feeSats, signer: 'demo' }]);
    expect(statSync(ledgerFile).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(ledgerFile, 'utf8'))).toEqual(sent[0]!.ledgerAtSend);
  });

  it('sends nothing when the ledger on disk filled up after the plan was made', async () => {
    const { source, sent } = sending(funded());
    const plan = (await planAnchor(keys.address, keys.bchPrivateKey, payload, source, empty)) as AnchorPlan;
    mkdirSync(join(dir, 'anchor'), { recursive: true });
    writeFileSync(ledgerFile, JSON.stringify({ transactions: [entry(300, 1), entry(300, 2)] }));
    await expect(sendAnchor(plan, source, ledgerFile)).rejects.toThrow(/budget_full/);
    expect(sent).toHaveLength(0);
  });

  it('refuses a plan whose txid does not match its transaction, and reports a server txid that differs', async () => {
    const { source, sent } = sending(funded());
    const plan = (await planAnchor(keys.address, keys.bchPrivateKey, payload, source, empty)) as AnchorPlan;
    await expect(sendAnchor({ ...plan, txid: 'cd'.repeat(32) }, source, ledgerFile)).rejects.toThrow(/does not match/);
    expect(sent).toHaveLength(0);
    const liar = sending(funded(), () => 'ef'.repeat(32));
    await expect(sendAnchor(plan, liar.source, ledgerFile)).rejects.toThrow(/reported txid/);
    expect(readLedger(ledgerFile).transactions).toHaveLength(1);
  });
});
