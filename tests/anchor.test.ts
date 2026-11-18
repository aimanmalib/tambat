import { describe, expect, it } from 'vitest';
import { binToHex, cashAddressToLockingBytecode, decodeTransaction, encodeDataPush, encodeTransaction, hexToBin } from '@bitauth/libauth';
import raw from '../config/tambat.json' with { type: 'json' };
import { parseConfig } from '../src/config.js';
import {
  anchorFromCoins,
  buildAnchorTransaction,
  commitmentFromTransaction,
  decodeAnchorScript,
  earliestCommitment,
  encodeAnchorScript,
  type Commitment,
} from '../src/core/anchor.js';
import { signP2pkh } from './anchor-wallet.js';
import { keys, other, vectors } from './helpers.js';

const payload = { pubkey: keys.nostrPubkey, eventId: vectors.bindingEvent.id };
const utxo = { txid: '11'.repeat(32), vout: 1, satoshis: 10_000 };
const signedBy = (privateKey: Uint8Array, address = keys.address) => {
  const unsigned = buildAnchorTransaction(address, [utxo], payload);
  return signP2pkh(unsigned.transaction, unsigned.sourceOutputs, privateKey);
};

describe('anchor payload', () => {
  it('round-trips the Nostr key and event id through the OP_RETURN script', () => {
    const script = encodeAnchorScript(payload);
    expect(script[0]).toBe(0x6a);
    expect(new TextDecoder().decode(script.slice(2, 6))).toBe('TMBT');
    expect(script.length).toBe(1 + 5 + 2 + 33 + 33);
    expect(decodeAnchorScript(script)).toEqual(payload);
  });

  it('rejects another prefix, another version and a short key', () => {
    expect(decodeAnchorScript(encodeAnchorScript(payload, 'XXXX'))).toBe('wrong_prefix');
    const script = encodeAnchorScript(payload);
    const v2 = Uint8Array.from(script);
    v2[7] = 2;
    expect(decodeAnchorScript(v2)).toBe('wrong_version');
    const short = Uint8Array.from([0x6a, ...encodeDataPush(new TextEncoder().encode('TMBT')), ...encodeDataPush(Uint8Array.of(1)), ...encodeDataPush(new Uint8Array(31)), ...encodeDataPush(new Uint8Array(32))]);
    expect(decodeAnchorScript(short)).toBe('wrong_version');
    expect(decodeAnchorScript(Uint8Array.of(0x76, 0xa9))).toBe('no_payload');
  });
});

describe('commitment transaction', () => {
  it('accepts a signed transaction whose input spends from the bound address', () => {
    expect(commitmentFromTransaction(signedBy(keys.bchPrivateKey), keys.address)).toEqual(payload);
  });

  it('rejects a transaction whose inputs are not from the address', () => {
    // Same payload, but signed and spent by another key: anyone can write the bytes, only the address key can spend.
    expect(commitmentFromTransaction(signedBy(other.bchPrivateKey, other.address), keys.address)).toBe('not_from_address');
    expect(commitmentFromTransaction(hexToBin('00'), keys.address)).toBe('not_transaction');
  });

  it('reports a transaction from the address without a payload', () => {
    const tx = decodeTransaction(signedBy(keys.bchPrivateKey));
    if (typeof tx === 'string') throw new Error(tx);
    const plain = { ...tx, outputs: tx.outputs.slice(1) };
    expect(commitmentFromTransaction(encodeTransaction(plain), keys.address)).toBe('no_payload');
  });
});

describe('earliest commitment', () => {
  const at = (height: number, txid: string, pubkey = payload.pubkey): Commitment => ({ ...payload, pubkey, txid, height });

  it('dates the pair by the earliest confirmed block, ignoring unconfirmed ones', () => {
    const list = [at(900_100, 'bb'), at(0, 'cc'), at(900_000, 'dd'), at(900_000, 'aa')];
    expect(earliestCommitment(list, payload.pubkey)?.txid).toBe('aa');
    expect(earliestCommitment([at(0, 'cc')], payload.pubkey)).toBeNull();
  });

  it('ignores commitments to a Nostr key other than the one the current binding names', () => {
    const list = [at(800_000, 'old', other.nostrPubkey), at(900_000, 'new')];
    expect(earliestCommitment(list, payload.pubkey)?.txid).toBe('new');
    expect(earliestCommitment(list, '00'.repeat(32))).toBeNull();
  });
});

describe('unsigned commitment transaction', () => {
  it('has exactly one OP_RETURN and the change back to the same address, fee within the limit', () => {
    const t = buildAnchorTransaction(keys.address, [utxo, { ...utxo, vout: 2, satoshis: 600 }], payload);
    const locking = cashAddressToLockingBytecode(keys.address);
    if (typeof locking === 'string') throw new Error(locking);
    expect(t.transaction.outputs).toHaveLength(2);
    expect(decodeAnchorScript(t.transaction.outputs[0]!.lockingBytecode)).toEqual(payload);
    expect(t.transaction.outputs[0]!.valueSatoshis).toBe(0n);
    expect(binToHex(t.transaction.outputs[1]!.lockingBytecode)).toBe(binToHex(locking.bytecode));
    expect(t.changeSats + t.feeSats).toBe(10_600);
    expect(t.feeSats).toBeLessThanOrEqual(raw.anchor.maxFeeSats);
    expect(t.sourceOutputs.map((s) => s.valueSatoshis)).toEqual([10_000n, 600n]);
    // The estimate covers the real signed size, so the fee rate is never below feePerByte.
    expect(signP2pkh(t.transaction, t.sourceOutputs, keys.bchPrivateKey).length).toBeLessThanOrEqual(t.feeSats / raw.anchor.feePerByte);
  });

  it('refuses a fee above the limit, dust change and an address without coins', () => {
    const many = Array.from({ length: 10 }, (_, vout) => ({ ...utxo, vout }));
    expect(() => buildAnchorTransaction(keys.address, many, payload)).toThrow(/above the limit/);
    expect(() => buildAnchorTransaction(keys.address, [{ ...utxo, satoshis: 700 }], payload)).toThrow(/too little/);
    expect(() => buildAnchorTransaction(keys.address, [], payload)).toThrow(/no unspent/);
  });
});

describe('coins for the anchor', () => {
  const coin = (vout: number, satoshis: number, height: number) => ({ txid: '55'.repeat(32), vout, satoshis, height });
  const spent = (a: ReturnType<typeof anchorFromCoins>) => (typeof a === 'string' ? a : a.sourceOutputs.map((s) => s.outpointIndex));

  it('spends only coins already in a block and never sends unconfirmed ones to the wallet', () => {
    const mixed = [coin(0, 9000, 0), coin(1, 20_000, 900_000), coin(2, 9000, -1)];
    const prepared = anchorFromCoins(keys.address, mixed, payload, true);
    expect(spent(prepared)).toEqual([1]);
    expect(prepared).toMatchObject({ unconfirmed: false });
    expect(anchorFromCoins(keys.address, [coin(0, 20_000, 900_000)], payload, true)).toMatchObject({ unconfirmed: false });
  });

  it('says to wait for a confirmation when only unconfirmed coins would pay the fee', () => {
    expect(anchorFromCoins(keys.address, [coin(0, 50_000, 0)], payload, true)).toBe('unconfirmed');
    expect(anchorFromCoins(keys.address, [coin(0, 600, 900_000), coin(1, 50_000, 0)], payload, true)).toBe('unconfirmed');
    // Missing height is treated as not yet in a block.
    expect(anchorFromCoins(keys.address, [{ txid: '55'.repeat(32), vout: 0, satoshis: 50_000 }], payload, true)).toBe('unconfirmed');
  });

  it('names no coins, too little and a fee above the limit', () => {
    expect(anchorFromCoins(keys.address, [], payload, true)).toBe('no_coins');
    expect(anchorFromCoins(keys.address, [coin(0, 600, 900_000), coin(1, 100, 0)], payload, true)).toBe('too_little');
    const many = Array.from({ length: 10 }, (_, vout) => coin(vout, 10_000, 900_000));
    expect(anchorFromCoins(keys.address, many, payload, true)).toBe('fee_high');
  });

  it('with confirmedCoinsOnly off, spends every coin and marks the anchor as spending unconfirmed ones', () => {
    const prepared = anchorFromCoins(keys.address, [coin(0, 9000, 0), coin(1, 9000, 900_000)], payload, false);
    expect(spent(prepared)).toEqual([0, 1]);
    expect(prepared).toMatchObject({ unconfirmed: true });
  });
});

describe('anchor config', () => {
  it('accepts the shipped values and rejects a bad prefix or a non-WebSocket server', () => {
    expect(parseConfig(raw).anchor.maxFeeSats).toBeLessThanOrEqual(1000);
    expect(raw.walletConnect.methods).toContain('bch_signTransaction');
    const bad = (anchor: object) => () => parseConfig({ ...raw, anchor: { ...raw.anchor, ...anchor } });
    expect(bad({ prefix: 'TAMBAT' })).toThrow(/anchor.prefix/);
    expect(bad({ electrum: ['https://example.com'] })).toThrow(/anchor.electrum/);
  });
});
