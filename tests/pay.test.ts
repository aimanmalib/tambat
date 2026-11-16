import { describe, expect, it } from 'vitest';
import { amountError, paymentUri } from '../src/core/pay.js';
import { vectors } from './helpers.js';

const address = vectors.bch.address.bitcoincash;

describe('paymentUri', () => {
  it('gives the bare address when nothing else is set', () => {
    expect(paymentUri({ address })).toBe(address);
  });

  it('adds amount, label and message as BIP21 parameters', () => {
    const uri = paymentUri({ address, amount: '0.001', label: 'Ana B', message: 'for tea & cake' });
    expect(uri).toBe(`${address}?amount=0.001&label=Ana%20B&message=for%20tea%20%26%20cake`);
  });

  it('rejects a P2SH or malformed address and a bad amount', () => {
    expect(() => paymentUri({ address: 'bitcoincash:nope' })).toThrow();
    expect(() => paymentUri({ address, amount: '1.123456789' })).toThrow(/8 decimals/);
  });
});

describe('amountError', () => {
  it.each([['', null], ['1', null], ['0.00000001', null], ['21000000', null]])('accepts %j', (v, want) => {
    expect(amountError(v)).toBe(want);
  });

  it.each(['0', '0.0', '-1', '1e3', '01', '1.', 'abc'])('rejects %j', (v) => {
    expect(amountError(v)).not.toBeNull();
  });
});
