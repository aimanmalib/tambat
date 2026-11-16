import { decode } from 'nostr-tools/nip19';
import { describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { caip10, didDocument } from '../src/core/did.js';
import { verifyBinding } from '../src/core/verify.js';
import { clone, keys, vectors } from './helpers.js';

describe('did:nostr document', () => {
  const binding = verifyBinding(clone(vectors.bindingEvent));

  it('has the Nostr key as a Multikey and the bound address as a CAIP-10 account', () => {
    const doc = didDocument(keys.nostrPubkey, binding, { relays: ['wss://relay.example'] });
    const id = `did:nostr:${keys.nostrPubkey}`;
    expect(doc.id).toBe(id);
    expect(doc.verificationMethod[0]).toMatchObject({ id: `${id}#key1`, publicKeyMultibase: `fe70102${keys.nostrPubkey}` });
    expect(doc.verificationMethod[1]).toMatchObject({
      id: `${id}#bch`,
      type: 'EcdsaSecp256k1RecoveryMethod2020',
      blockchainAccountId: `${config.did.chains.bitcoincash}:${keys.address.split(':')[1]}`,
    });
    expect(doc.assertionMethod).toEqual([`${id}#key1`, `${id}#bch`]);
    expect(doc.authentication).toEqual([`${id}#key1`]);
    expect(doc.alsoKnownAs).toEqual([keys.address]);
  });

  it('points at the binding event with an nevent', () => {
    const doc = didDocument(keys.nostrPubkey, binding, { relays: ['wss://relay.example'] });
    const endpoint = doc.service?.[0]?.serviceEndpoint ?? '';
    const decoded = decode(endpoint.replace(/^nostr:/, '') as `nevent1${string}`);
    expect(decoded.type).toBe('nevent');
    expect(decoded.data).toMatchObject({ id: vectors.bindingEvent.id, author: keys.nostrPubkey, relays: ['wss://relay.example'] });
  });

  it('leaves out BCH when the binding failed or belongs to another key', () => {
    const forged = verifyBinding({ ...clone(vectors.bindingEvent), content: 'edited' });
    for (const b of [null, forged]) {
      const doc = didDocument(keys.nostrPubkey, b);
      expect(doc.verificationMethod).toHaveLength(1);
      expect(doc.alsoKnownAs).toBeUndefined();
      expect(doc.service).toBeUndefined();
    }
    expect(didDocument('1'.repeat(64), binding).verificationMethod).toHaveLength(1);
  });

  it('formats CAIP-10 without the CashAddr prefix', () => {
    expect(caip10('bchtest:qq123', 'bchtest')).toBe(`${config.did.chains.bchtest}:qq123`);
  });
});
