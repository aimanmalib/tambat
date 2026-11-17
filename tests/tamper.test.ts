import { describe, expect, it } from 'vitest';
import { claimsOf } from '../src/core/binding.js';
import { failedSteps, TAMPER_CATCHES, TAMPER_FIELDS, tamperEvent, verifyTampered } from '../src/core/tamper.js';
import { verifyBinding } from '../src/core/verify.js';
import { clone, vectors } from './helpers.js';

const original = () => verifyBinding(clone(vectors.bindingEvent), { sameAuthorEvents: [] });

describe('tamper demo', () => {
  it('starts from a binding that passes every step', () => {
    expect(original().ok).toBe(true);
    expect(failedSteps(original())).toEqual([]);
  });

  for (const field of TAMPER_FIELDS) {
    it(`an edited ${field} fails exactly the steps it should`, () => {
      const r = verifyTampered(original(), field);
      expect(r?.ok).toBe(false);
      expect(failedSteps(r!)).toEqual(TAMPER_CATCHES[field]);
    });
  }

  it('never changes the original event', () => {
    const event = clone(vectors.bindingEvent);
    const before = JSON.stringify(event);
    for (const field of TAMPER_FIELDS) tamperEvent(event, field);
    expect(JSON.stringify(event)).toBe(before);
  });

  it('points the tag at a different valid address on the same network', () => {
    const event = clone(vectors.bindingEvent);
    const [was] = claimsOf(event);
    const [now] = claimsOf(tamperEvent(event, 'tag'));
    expect(now?.address).not.toBe(was?.address);
    expect(now?.address.split(':')[0]).toBe(was?.address.split(':')[0]);
    expect(now?.signature).toBe(was?.signature);
    const claim = verifyTampered(original(), 'tag')?.claims[0];
    expect(claim?.steps.find((s) => s.name === 'address_match')?.code).toBe('wrong_signer');
    expect(claim?.steps.find((s) => s.name === 'network')?.status).toBe('pass');
  });

  it('keeps the relay comparison of the original result', () => {
    const r = verifyTampered(original(), 'sig');
    expect(r?.steps.find((s) => s.name === 'newest')?.status).toBe('pass');
    const unchecked = verifyTampered(verifyBinding(clone(vectors.bindingEvent)), 'sig');
    expect(unchecked?.steps.find((s) => s.name === 'newest')?.status).toBe('skip');
  });

  it('returns null when the original had no event to copy', () => {
    expect(verifyTampered(verifyBinding({}), 'content')).toBeNull();
  });
});
