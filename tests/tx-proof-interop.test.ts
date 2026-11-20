/**
 * Interoperability: bindings written by other NIP-39 clients. The on-chain proof form `tx:<txid>` is checked against
 * a real mainnet transaction kept as data (tests/fixtures/tx-proof-mainnet.json, read from a public chain server), and
 * against transactions signed here with the public test phrase. Every chain is a fake; nothing is sent anywhere.
 */
import { readFileSync } from 'node:fs';
import { binToHex, encodeTransaction, hexToBin, utf8ToBin, encodeDataPush } from '@bitauth/libauth';
import { describe, expect, it } from 'vitest';
import { buildAnchorTransaction, txidOf } from '../src/core/anchor.js';
import { cashAddressToLockingBytecode } from '@bitauth/libauth';
import type { ChainServer } from '../src/core/chain-quorum.js';
import { parseP2pkhAddress, type P2pkhAddress } from '../src/core/cashaddr.js';
import { createBindingEvent } from '../src/core/binding.js';
import { finalizeEvent } from 'nostr-tools/pure';
import { verificationText, type Event } from '../src/core/nostr.js';
import { checkTxProof, parseProof, proofOutput, readTxEvidence, type TxEvidence } from '../src/core/tx-proof.js';
import { proofTxids, verifyBindingOnChain } from '../src/core/verify-chain.js';
import { verifyBinding } from '../src/core/verify.js';
import { buildWall, loadWall, type Wall } from '../src/core/wall.js';
import { lookupByAddress } from '../src/core/discover.js';
import { signMessage } from '../src/core/bchmsg.js';
import { signP2pkh } from './anchor-wallet.js';
import { fakeRelay, keys, other, vectors } from './helpers.js';

const fx = JSON.parse(readFileSync(new URL('./fixtures/tx-proof-mainnet.json', import.meta.url), 'utf8')) as {
  npub: string;
  address: string;
  txid: string;
  raw: string[];
  sources: Record<string, string[]>;
  event: Event;
};
/** The fixture keeps hex in short pieces so no line looks like a key to a secret scanner. */
const real: TxEvidence = { raw: fx.raw.join(''), sources: Object.fromEntries(Object.entries(fx.sources).map(([id, hex]) => [id, hex.join('')])) };
const addr = (a: string): P2pkhAddress => parseP2pkhAddress(a) as P2pkhAddress;

/** A transaction from `from` that carries `output` (default: the proof for `npub`), signed with the test phrase. */
function proofTx(npub: string, output: Uint8Array = proofOutput(npub), from = keys) {
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
function server(name: string, txs: Record<string, string>): ChainServer {
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
const holding = (e: TxEvidence): Record<string, string> => ({ ...e.sources, [hashOf(e)]: e.raw });
const hashOf = (e: TxEvidence): string => txidOf(hexToBin(e.raw));

describe('proof forms in the i tag', () => {
  it('reads tx:<txid>, msg:<signature> and a plain signature', () => {
    expect(parseProof(`tx:${'AB'.repeat(32)}`)).toEqual({ form: 'tx', txid: 'ab'.repeat(32) });
    expect(parseProof('msg:H5Kt')).toEqual({ form: 'message', signature: 'H5Kt' });
    expect(parseProof('H5Kt')).toEqual({ form: 'message', signature: 'H5Kt' });
  });

  it('builds the proof output as OP_RETURN with one push of the verification text', () => {
    const text = utf8ToBin(verificationText(fx.npub));
    expect(binToHex(proofOutput(fx.npub))).toBe(`6a${binToHex(encodeDataPush(text))}`);
    expect(binToHex(proofOutput(fx.npub)).slice(0, 6)).toBe('6a4c78');
  });
});

describe('a real on-chain proof from another client (mainnet)', () => {
  it('the fixture transaction hashes to its txid', () => {
    expect(hashOf(real)).toBe(fx.txid);
  });

  it('passes every step: found, spends from the address under the VM, carries the text', () => {
    const r = verifyBinding(fx.event, { txLookups: { [fx.txid]: { kind: 'found', evidence: real } } });
    const claim = r.claims.find((c) => c.proof === 'tx');
    expect(claim?.txid).toBe(fx.txid);
    expect(claim?.address).toBe(fx.address);
    expect(claim?.steps.map((s) => `${s.name}:${s.status}`)).toEqual([
      'tx_found:pass',
      'address_match:pass',
      'tx_text:pass',
      'network:pass',
      'key_separation:pass',
    ]);
    expect(claim?.ok).toBe(true);
    expect(r.ok).toBe(true);
  });

  it('reads the second claim, a signed message on an address written without prefix', () => {
    const r = verifyBinding(fx.event, { txLookups: { [fx.txid]: { kind: 'found', evidence: real } } });
    const message = r.claims.find((c) => c.proof === 'message');
    expect(message?.address.startsWith('bitcoincash:')).toBe(true);
    expect(message?.ok).toBe(true);
  });

  it('is skipped, never passed, when the chain was not read', () => {
    const r = verifyBinding(fx.event);
    const claim = r.claims.find((c) => c.proof === 'tx');
    expect(claim?.steps[0]).toMatchObject({ name: 'tx_found', status: 'skip', code: 'chain_unreadable' });
    expect(claim?.ok).toBe(false);
    expect(r.ok).toBe(false);
  });

  it('fails tx_text_mismatch for another npub', () => {
    expect(checkTxProof(fx.txid, addr(fx.address), other.npub, real)).toMatchObject({ ok: false, step: 'tx_text', code: 'tx_text_mismatch' });
  });

  it('fails tx_no_input_from_address when the claim names another address', () => {
    expect(checkTxProof(fx.txid, addr(keys.address), fx.npub, real)).toMatchObject({ ok: false, step: 'address_match', code: 'tx_no_input_from_address' });
  });

  it('fails tx_id_mismatch when the chain returns another transaction', () => {
    const elsewhere = proofTx(fx.npub).evidence;
    expect(checkTxProof(fx.txid, addr(fx.address), fx.npub, elsewhere)).toMatchObject({ ok: false, step: 'tx_found', code: 'tx_id_mismatch' });
  });

  it('fails the VM when the OP_RETURN text is changed after signing', () => {
    const raw = real.raw.replace(binToHex(utf8ToBin(fx.npub)), binToHex(utf8ToBin(other.npub)));
    expect(raw).not.toBe(real.raw);
    const changed = { raw, sources: real.sources };
    expect(checkTxProof(hashOf(changed), addr(fx.address), other.npub, changed)).toMatchObject({ ok: false, code: 'tx_no_input_from_address' });
  });
});

describe('proofs signed here with the public test phrase', () => {
  it('passes for the npub it names and fails for another', () => {
    const t = proofTx(keys.npub);
    expect(checkTxProof(t.txid, addr(keys.address), keys.npub, t.evidence).ok).toBe(true);
    expect(checkTxProof(t.txid, addr(keys.address), other.npub, t.evidence)).toMatchObject({ code: 'tx_text_mismatch' });
  });

  it('fails when the text is pushed with extra bytes', () => {
    const padded = new Uint8Array([0x6a, ...encodeDataPush(utf8ToBin(`${verificationText(keys.npub)} `))]);
    const t = proofTx(keys.npub, padded);
    expect(checkTxProof(t.txid, addr(keys.address), keys.npub, t.evidence)).toMatchObject({ code: 'tx_text_mismatch' });
  });

  it('fails when the spending input belongs to another address', () => {
    const t = proofTx(keys.npub, proofOutput(keys.npub), other);
    expect(checkTxProof(t.txid, addr(keys.address), keys.npub, t.evidence)).toMatchObject({ code: 'tx_no_input_from_address' });
  });

  it('a whole binding event with a tx proof verifies on chain, through the quorum', async () => {
    const t = proofTx(keys.npub);
    const event = finalizeEvent(createBindingEvent({ claim: { address: keys.address, signature: `tx:${t.txid}` }, createdAt: 1_800_000_000 }), keys.nostrSecretKey);
    expect(proofTxids([event])).toEqual([t.txid]);
    const servers = ['a', 'b', 'c'].map((n) => server(n, holding(t.evidence)));
    const r = await verifyBindingOnChain(event, { chain: { servers, quorum: 2 } });
    expect(r.ok).toBe(true);
    expect(r.claims[0]).toMatchObject({ proof: 'tx', txid: t.txid, ok: true });
  });
});

describe('reading a proof transaction from several chain servers', () => {
  const t = proofTx(keys.npub);
  it('keeps the transaction when every server agrees', async () => {
    const read = await readTxEvidence(t.txid, ['a', 'b', 'c'].map((n) => server(n, holding(t.evidence))), 2);
    expect(read).toEqual({ kind: 'found', evidence: t.evidence });
  });

  it('is unread when one server returns something else', async () => {
    const liar = server('b', { ...holding(t.evidence), ...real.sources, [t.txid]: real.raw });
    const read = await readTxEvidence(t.txid, [server('a', holding(t.evidence)), liar, server('c', holding(t.evidence))], 2);
    expect(read.kind).toBe('unread');
    expect(read.kind === 'unread' && read.servers?.differing).toEqual(['b']);
  });

  it('is missing when the servers agree they do not have it', async () => {
    const read = await readTxEvidence(t.txid, ['a', 'b'].map((n) => server(n, {})), 2);
    expect(read).toEqual({ kind: 'missing' });
    const event = finalizeEvent(createBindingEvent({ claim: { address: keys.address, signature: `tx:${t.txid}` }, createdAt: 1_800_000_000 }), keys.nostrSecretKey);
    const r = await verifyBindingOnChain(event, { chain: { servers: ['a', 'b'].map((n) => server(n, {})), quorum: 2 } });
    expect(r.claims[0]?.steps[0]).toMatchObject({ name: 'tx_found', status: 'fail', code: 'tx_not_found' });
  });

  it('makes no chain call for a signed-message binding', async () => {
    let opened = 0;
    const counting: ChainServer = { name: 'x', open: async () => { opened += 1; return server('x', {}).open(); } };
    const r = await verifyBindingOnChain(vectors.bindingEvent, { chain: { servers: [counting], quorum: 1 } });
    expect(r.ok).toBe(true);
    expect(r.claims[0]?.proof).toBe('message');
    expect(opened).toBe(0);
  });
});

describe('other clients on the wall and in look-ups', () => {
  const t = proofTx(keys.npub);
  const onChain = finalizeEvent(createBindingEvent({ claim: { address: keys.address, signature: `tx:${t.txid}` }, createdAt: 1_800_000_000 }), keys.nostrSecretKey);

  it('the wall lists an on-chain proof once the chain was read, and leaves it unchecked otherwise', () => {
    expect(buildWall([onChain], 30)).toEqual({ entries: [], hidden: 0, scanned: 1, unchecked: 1 });
    const wall = buildWall([onChain], 30, 'bitcoincash', { [t.txid]: { kind: 'found', evidence: t.evidence } });
    expect(wall.entries).toEqual([expect.objectContaining({ eventId: onChain.id, proof: 'tx', address: keys.address })]);
  });

  it('loadWall reads each proof transaction from the chain servers', async () => {
    const servers = ['a', 'b'].map((n) => server(n, holding(t.evidence)));
    const early: Wall[] = [];
    const wall = await loadWall({ relays: ['wss://a.example'], timeoutMs: 200, query: fakeRelay([onChain]), chain: { servers, quorum: 2 }, onRelays: (w) => early.push(w) });
    expect(early).toEqual([{ entries: [], hidden: 0, scanned: 1, unchecked: 1 }]);
    expect(wall.entries.map((e) => e.proof)).toEqual(['tx']);
    expect(wall.unchecked).toBeUndefined();
  });

  it('a forged on-chain proof is hidden once read, and the wall without one makes no chain call', async () => {
    const wrong = finalizeEvent(createBindingEvent({ claim: { address: other.address, signature: `tx:${t.txid}` }, createdAt: 1_800_000_000 }), other.nostrSecretKey);
    const servers = ['a', 'b'].map((n) => server(n, holding(t.evidence)));
    expect(await loadWall({ relays: ['wss://a.example'], timeoutMs: 200, query: fakeRelay([wrong]), chain: { servers, quorum: 2 } })).toMatchObject({ entries: [], hidden: 1 });
    let opened = 0;
    const counting: ChainServer = { name: 'x', open: async () => { opened += 1; return server('x', {}).open(); } };
    const early: Wall[] = [];
    await loadWall({ relays: ['wss://a.example'], timeoutMs: 200, query: fakeRelay([vectors.bindingEvent]), chain: { servers: [counting], quorum: 1 }, onRelays: (w) => early.push(w) });
    expect([opened, early.length]).toEqual([0, 0]);
  });

  it('finds and verifies a msg: signature on an address written without prefix', async () => {
    const bare = keys.address.split(':')[1] ?? '';
    const sig = signMessage(keys.bchPrivateKey, verificationText(keys.npub));
    const event = finalizeEvent({ kind: 10011, created_at: 1_800_000_000, content: '', tags: [['i', `bch:${bare}`, `msg:${sig}`]] }, keys.nostrSecretKey);
    const found = await lookupByAddress(keys.address, { relays: ['wss://a.example'], timeoutMs: 200, query: fakeRelay([event]) });
    expect(found.map((r) => [r.ok, r.claims[0]?.address, r.claims[0]?.proof])).toEqual([[true, keys.address, 'message']]);
  });
});
