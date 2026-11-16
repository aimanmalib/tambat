import { describe, expect, it } from 'vitest';
import { makeBinding } from '../examples/paytaca-binding.js';
import { bindingFromKeys } from '../src/core/paytaca.js';
import { verifyBinding } from '../src/core/verify.js';
import { keys, vectors } from './helpers.js';

describe('examples/paytaca-binding.ts (the code shown in docs/PAYTACA.md)', () => {
  const createdAt = vectors.bindingEvent.created_at;
  const event = makeBinding(vectors.phrase, createdAt);

  it('writes a binding that passes every verification step', () => {
    const result = verifyBinding(event);
    expect(result.ok).toBe(true);
    expect(result.npub).toBe(vectors.nostr.npub);
    expect(result.claims.map((c) => c.address)).toEqual([vectors.bch.address.bitcoincash]);
  });

  it('produces the same claim as the library, so the standalone code and src/core agree', () => {
    const fromLibrary = bindingFromKeys(keys, createdAt);
    expect(event.id).toBe(fromLibrary.id);
    expect(event.tags).toEqual(fromLibrary.tags);
    expect(event.tags[0]?.[2]).toBe(vectors.bchSignature);
  });
});
