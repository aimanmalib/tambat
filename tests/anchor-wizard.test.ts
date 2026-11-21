/**
 * The WizardConnect proof (web/keys/anchor-wizard.ts) against a fake wallet and a fake chain: the wallet signs with keys
 * from the public BIP39 test phrase, the chain is a map of coins and raw transactions. No relay, no network.
 */
import {
  cashAddressToLockingBytecode,
  decodeTransaction,
  encodeTransaction,
  hashTransaction,
  hexToBin,
  binToHex,
  type TransactionCommon,
} from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import type { ChainSource, OpenChain } from '../src/core/anchor-chain.js';
import { scripthashOf } from '../src/core/anchor-chain.js';
import { signP2pkh } from '../src/core/anchor-sign.js';
import { bchKeysOf, keysFromPhrase } from '../src/core/paytaca.js';
import { proofOutput } from '../src/core/tx-proof.js';
import { verifyClaim } from '../src/core/verify.js';
import { TextError } from '../src/errors.js';
import { planProof, signProof, walletAddresses, type ProofWallet } from '../web/keys/anchor-wizard.js';
import vectors from '../examples/vectors.json' with { type: 'json' };

const phrase = vectors.phrase;
const nostr = keysFromPhrase(phrase, 'bitcoincash');
/** Receive keys 0..4, derived once (deriving from the phrase is slow). */
const keys = bchKeysOf(phrase, 5, 'bitcoincash');
const key = (i: number) => keys[i]!;
const lockOf = (address: string) => {
  const l = cashAddressToLockingBytecode(address);
  if (typeof l === 'string') throw new Error(l);
  return l.bytecode;
};

/** A funding transaction paying `sats` to `address` (its own input is never checked). */
function funding(address: string, sats: number, seed: number) {
  const tx: TransactionCommon = {
    version: 2,
    inputs: [{ outpointTransactionHash: new Uint8Array(32).fill(seed), outpointIndex: 0, sequenceNumber: 0, unlockingBytecode: Uint8Array.of() }],
    outputs: [{ lockingBytecode: lockOf(address), valueSatoshis: BigInt(sats) }],
    locktime: 0,
  };
  const raw = encodeTransaction(tx);
  return { raw: binToHex(raw), txid: hashTransaction(raw) };
}

interface Coin { address: string; sats: number; height: number; seed: number }

function fakeChain(coins: Coin[], send?: (hex: string) => Promise<string>) {
  const sent: string[] = [];
  const txs: Record<string, string> = {};
  const unspent: Record<string, { txid: string; vout: number; satoshis: number; height: number }[]> = {};
  for (const c of coins) {
    const f = funding(c.address, c.sats, c.seed);
    txs[f.txid] = f.raw;
    (unspent[scripthashOf(c.address)] ??= []).push({ txid: f.txid, vout: 0, satoshis: c.sats, height: c.height });
  }
  const source: ChainSource = {
    history: async () => [],
    header: async () => '',
    unspent: async (s) => unspent[s] ?? [],
    transaction: async (id) => {
      const raw = txs[id];
      if (!raw) throw new Error('No such mempool or blockchain transaction');
      return raw;
    },
    send: async (hex) => {
      sent.push(hex);
      return send ? send(hex) : hashTransaction(hexToBin(hex));
    },
    close: async () => undefined,
  };
  const open: OpenChain = async () => source;
  return { open, sent };
}

/** A wallet holding receive keys 0..4 of the test phrase. `tamper` changes the transaction before it is signed. */
function fakeWallet(options: { signWith?: number; tamper?: (tx: TransactionCommon) => TransactionCommon } = {}) {
  const calls: [number, string, number][][] = [];
  const wallet: ProofWallet = {
    publicKey: (path, index) => (path === 'receive' && index < 5 ? key(index).bchPublicKey : undefined),
    sign: async (request, inputPaths) => {
      calls.push(inputPaths);
      const [, , index] = inputPaths[0]!;
      const tx = options.tamper ? options.tamper(request.transaction) : request.transaction;
      return binToHex(signP2pkh(tx, request.sourceOutputs, key(options.signWith ?? index).bchPrivateKey));
    },
  };
  return { wallet, calls };
}

const textKey = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof TextError ? e.key : String(e);
  }
  return 'resolved';
};

describe('WizardConnect proof: finding a coin', () => {
  it('lists the receive addresses the wallet shares, up to the scan count', () => {
    const { wallet } = fakeWallet();
    const list = walletAddresses(wallet, { receive: 3, change: 2 });
    expect(list.map((a) => [a.path, a.index])).toEqual([['receive', 0], ['receive', 1], ['receive', 2]]);
    expect(list[1]?.address).toBe(key(1).address);
  });

  it('builds the proof from the first address that can pay: OP_RETURN with the NIP-39 text, change to the same address', async () => {
    const { wallet } = fakeWallet();
    const chain = fakeChain([{ address: key(3).address, sats: 5000, height: 900000, seed: 1 }]);
    const plan = await planProof(wallet, nostr.npub, chain.open);
    expect([plan.path, plan.index, plan.address]).toEqual(['receive', 3, key(3).address]);
    expect(binToHex(plan.transaction.outputs[0]!.lockingBytecode)).toBe(binToHex(proofOutput(nostr.npub)));
    expect(binToHex(plan.transaction.outputs[1]!.lockingBytecode)).toBe(binToHex(lockOf(key(3).address)));
    expect(plan.feeSats).toBeLessThanOrEqual(config.anchor.maxFeeSats);
    expect(plan.changeSats + plan.feeSats).toBe(5000);
    expect(Object.keys(plan.sources)).toHaveLength(1);
  });

  it('names why no address can pay, and does not ask the wallet', async () => {
    const empty = fakeWallet();
    expect(await textKey(planProof(empty.wallet, nostr.npub, fakeChain([]).open))).toBe('wizard.noCoins');
    const fresh = fakeChain([{ address: key(0).address, sats: 5000, height: 0, seed: 2 }]);
    expect(await textKey(planProof(empty.wallet, nostr.npub, fresh.open))).toBe('wizard.unconfirmed');
    const dust = fakeChain([{ address: key(0).address, sats: 600, height: 900000, seed: 3 }]);
    expect(await textKey(planProof(empty.wallet, nostr.npub, dust.open))).toBe('wizard.tooLittle');
    const none: ProofWallet = { publicKey: () => undefined, sign: async () => '' };
    expect(await textKey(planProof(none, nostr.npub, fakeChain([]).open))).toBe('wizard.noAddresses');
    const down: OpenChain = async () => {
      throw new Error('refused');
    };
    expect(await textKey(planProof(empty.wallet, nostr.npub, down))).toBe('wizard.unreachable');
    expect(empty.calls).toHaveLength(0);
  });
});

describe('WizardConnect proof: signing and sending', () => {
  const ready = async (options?: Parameters<typeof fakeWallet>[0], send?: (hex: string) => Promise<string>) => {
    const w = fakeWallet(options);
    const chain = fakeChain([{ address: key(2).address, sats: 4000, height: 900000, seed: 4 }], send);
    const plan = await planProof(w.wallet, nostr.npub, chain.open);
    return { ...w, chain, plan };
  };

  it('sends the signed proof once and returns a claim every verifier accepts', async () => {
    const { wallet, calls, chain, plan } = await ready();
    const { claim, txLookups } = await signProof(wallet, plan, nostr.npub, 'prompt', chain.open);
    expect(calls).toEqual([[[0, 'receive', 2]]]);
    expect(chain.sent).toHaveLength(1);
    const txid = hashTransaction(hexToBin(chain.sent[0]!));
    expect(claim).toEqual({ address: key(2).address, signature: `tx:${txid}` });
    const result = verifyClaim(claim.address, claim.signature, nostr.npub, nostr.nostrPubkey, 'bitcoincash', txLookups);
    expect(result.ok).toBe(true);
    // Without the transaction the claim is not taken on trust.
    expect(verifyClaim(claim.address, claim.signature, nostr.npub, nostr.nostrPubkey, 'bitcoincash').ok).toBe(false);
  });

  it('refuses a transaction signed by another key, and sends nothing', async () => {
    const { wallet, chain, plan } = await ready({ signWith: 0 });
    expect(await textKey(signProof(wallet, plan, nostr.npub, 'prompt', chain.open))).toBe('wizard.badReply');
    expect(chain.sent).toHaveLength(0);
  });

  it('refuses a transaction that pays anywhere the page did not ask for, and sends nothing', async () => {
    const extra = (tx: TransactionCommon): TransactionCommon => {
      const outputs = tx.outputs.map((o, i) => (i === 1 ? { ...o, valueSatoshis: o.valueSatoshis - 1000n } : o));
      return { ...tx, outputs: [...outputs, { lockingBytecode: lockOf(key(4).address), valueSatoshis: 1000n }] };
    };
    const { wallet, chain, plan } = await ready({ tamper: extra });
    expect(await textKey(signProof(wallet, plan, nostr.npub, 'prompt', chain.open))).toBe('wizard.badReply');
    expect(chain.sent).toHaveLength(0);
  });

  it('refuses an answer that is not a transaction', async () => {
    const { chain, plan } = await ready();
    const wallet: ProofWallet = { publicKey: () => undefined, sign: async () => 'not a transaction' };
    expect(await textKey(signProof(wallet, plan, nostr.npub, 'prompt', chain.open))).toBe('wizard.badReply');
  });

  it('takes "already known" from the chain as sent, and names any other refusal', async () => {
    const known = await ready(undefined, async () => {
      throw new Error('transaction already in block chain');
    });
    const ok = await signProof(known.wallet, known.plan, nostr.npub, 'prompt', known.chain.open);
    expect(ok.claim.signature).toMatch(/^tx:[0-9a-f]{64}$/);
    const refused = await ready(undefined, async () => {
      throw new Error('min relay fee not met');
    });
    expect(await textKey(signProof(refused.wallet, refused.plan, nostr.npub, 'prompt', refused.chain.open))).toBe('wizard.sendFailed');
  });

  it('keeps the signed transaction as the evidence the Link step checks', async () => {
    const { wallet, chain, plan } = await ready();
    const { txLookups } = await signProof(wallet, plan, nostr.npub, 'prompt', chain.open);
    const [lookup] = Object.values(txLookups);
    expect(lookup?.kind).toBe('found');
    if (lookup?.kind !== 'found') return;
    expect(lookup.evidence.raw).toBe(chain.sent[0]);
    expect(typeof decodeTransaction(hexToBin(lookup.evidence.raw))).not.toBe('string');
  });
});

describe('wireSignRequest', () => {
  it('turns a sign request with bigint values and bytes into plain JSON a relay can send', async () => {
    const { wireSignRequest } = await import('../web/keys/anchor-wizard.js');
    const request = {
      transaction: { version: 2, locktime: 0, inputs: [], outputs: [{ lockingBytecode: hexToBin('6a'), valueSatoshis: 0n }] },
      sourceOutputs: [{ lockingBytecode: hexToBin('76a9'), valueSatoshis: 49732n }],
      userPrompt: 'p',
      broadcast: false,
    };
    expect(() => JSON.stringify(request)).toThrow(/BigInt/);
    const wire = wireSignRequest(request);
    const text = JSON.stringify(wire);
    expect(text).toContain('<bigint: 49732n>');
    expect(text).toContain('<Uint8Array: 0x76a9>');
  });
});
