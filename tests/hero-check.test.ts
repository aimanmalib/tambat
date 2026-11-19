/**
 * The home page's live check, step by step. The binding is the owner's real Paytaca binding (public relay data in
 * tests/fixtures/paytaca-binding.json); relays and chain servers are fakes, so nothing touches the network.
 */
import { describe, expect, it } from 'vitest';
import { config, parseConfig } from '../src/config.js';
import type { AddressStatus } from '../src/core/anchor-chain.js';
import type { Commitment } from '../src/core/anchor.js';
import { anchorStep, HERO_STEPS, runHeroCheck, type HeroDeps, type HeroStep } from '../src/core/hero-check.js';
import type { Event } from '../src/core/nostr.js';
import { secp256k1 } from '@bitauth/libauth';
import { finalizeEvent } from 'nostr-tools/pure';
import { signMessage } from '../src/core/bchmsg.js';
import { createBindingEvent } from '../src/core/binding.js';
import { addressFromPublicKey } from '../src/core/cashaddr.js';
import { verificationText } from '../src/core/nostr.js';
import { bindingFromKeys, keysFromPhrase, type PhraseKeys } from '../src/core/paytaca.js';
import vectors from '../examples/vectors.json' with { type: 'json' };
import binding from './fixtures/paytaca-binding.json' with { type: 'json' };

/** A valid address of another key (the Nostr secret used as a BCH key). */
const otherAddress = (k: PhraseKeys) => addressFromPublicKey(secp256k1.derivePublicKeyCompressed(k.nostrSecretKey) as Uint8Array, 'bitcoincash');

const event = binding as Event;
const target = { npub: config.hero.npub, eventId: config.hero.eventId, timeoutMs: 200 };
const tally = { quorum: 2, total: 3, agreed: ['a', 'b', 'c'], differing: [], unreachable: [] };
const since: Commitment = { pubkey: event.pubkey, eventId: event.id, txid: 'ab'.repeat(32), height: 977_901 };
const bound: AddressStatus = { anchor: { kind: 'anchored', commitment: since, sameEvent: true }, verdict: { kind: 'bound', since }, servers: tally };

function deps(over: Partial<HeroDeps> = {}): HeroDeps {
  return { fetchEvents: async () => [event], readChain: async () => bound, ...over };
}

async function run(d: HeroDeps) {
  const steps: HeroStep[] = [];
  const outcome = await runHeroCheck(target, d, (s) => steps.push(s));
  return { steps, outcome, names: steps.map((s) => `${s.name}=${s.status}`) };
}

describe('runHeroCheck', () => {
  it('reports every step in order for the real Paytaca binding, ending with the anchor block', async () => {
    const { names, steps, outcome } = await run(deps());
    expect(names).toEqual(HERO_STEPS.map((n) => `${n}=pass`));
    expect(steps.at(-1)).toEqual({ name: 'anchor', status: 'pass', block: 977_901 });
    expect(steps[3]).toEqual({ name: 'address_match', status: 'pass', address: config.judges.anchor.address });
    expect(outcome).toMatchObject({ verified: true, address: config.judges.anchor.address });
  });

  it('has reported the four signature steps before the chain is asked, and the anchor only after it answers', async () => {
    const steps: HeroStep[] = [];
    let release: (s: AddressStatus) => void = () => undefined;
    let seenWhenAsked = -1;
    const check = runHeroCheck(
      target,
      deps({ readChain: () => { seenWhenAsked = steps.length; return new Promise((r) => (release = r)); } }),
      (s) => steps.push(s),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(seenWhenAsked).toBe(4);
    expect(steps.map((s) => s.name)).toEqual(['relay', 'nostr_sig', 'bch_sig', 'address_match']);
    release(bound);
    await check;
    expect(steps).toHaveLength(5);
  });

  it('stops at the Nostr signature when the event signature is broken', async () => {
    const forged = { ...event, sig: `${event.sig.slice(0, -2)}${event.sig.endsWith('00') ? '11' : '00'}` };
    const { names, outcome } = await run(deps({ fetchEvents: async () => [forged] }));
    expect(names).toEqual(['relay=pass', 'nostr_sig=fail']);
    expect(outcome).toMatchObject({ verified: false, failedAt: 'nostr_sig' });
  });

  it('stops at the BCH signature, then at the address, for bindings signed by the public test keys', async () => {
    const keys = keysFromPhrase(vectors.phrase, 'bitcoincash');
    const own = { npub: keys.npub, eventId: '', timeoutMs: 200 };
    const signed = (address: string, signature: string) =>
      finalizeEvent(createBindingEvent({ claim: { address, signature }, previous: null, createdAt: 1_800_000_000 }), keys.nostrSecretKey);
    const runFor = async (e: Event) => {
      const steps: HeroStep[] = [];
      const outcome = await runHeroCheck({ ...own, eventId: e.id }, deps({ fetchEvents: async () => [e] }), (s) => steps.push(s));
      return { names: steps.map((s) => `${s.name}=${s.status}`), outcome };
    };
    const good = bindingFromKeys(keys, 1_800_000_000);
    expect((await runFor(good)).names).toEqual(HERO_STEPS.map((n) => `${n}=pass`));
    const unreadable = await runFor(signed(keys.address, 'AAAA'));
    expect(unreadable.names).toEqual(['relay=pass', 'nostr_sig=pass', 'bch_sig=fail']);
    expect(unreadable.outcome.failedAt).toBe('bch_sig');
    const real = signMessage(keys.bchPrivateKey, verificationText(keys.npub));
    const wrongAddress = await runFor(signed(otherAddress(keys), real));
    expect(wrongAddress.names).toEqual(['relay=pass', 'nostr_sig=pass', 'bch_sig=pass', 'address_match=fail']);
  });

  it('says the relay step failed when no relay holds the event, or one answers too late', async () => {
    expect((await run(deps({ fetchEvents: async () => [] }))).names).toEqual(['relay=fail']);
    const late = await run(deps({ fetchEvents: () => new Promise(() => undefined) }));
    expect(late.names).toEqual(['relay=fail']);
    expect(late.outcome.failedAt).toBe('relay');
    expect((await run(deps({ fetchEvents: async () => { throw new Error('socket'); } }))).names).toEqual(['relay=fail']);
  });

  it('does not take an event with another id or another author', async () => {
    const otherId = { ...event, id: 'ff'.repeat(32) };
    expect((await run(deps({ fetchEvents: async () => [otherId] }))).names).toEqual(['relay=fail']);
    const otherAuthor = { ...event, pubkey: '11'.repeat(32) };
    expect((await run(deps({ fetchEvents: async () => [otherAuthor] }))).names).toEqual(['relay=fail']);
  });

  it('keeps the binding verified but gives no anchor mark when the chain cannot be read or has no commitment', async () => {
    const down = await run(deps({ readChain: async () => ({ anchor: { kind: 'unreachable' }, verdict: null, servers: tally }) }));
    expect(down.steps.at(-1)).toEqual({ name: 'anchor', status: 'skip', miss: 'unreadable' });
    expect(down.outcome.verified).toBe(true);
    const slow = await run(deps({ readChain: () => new Promise(() => undefined) }));
    expect(slow.steps.at(-1)).toEqual({ name: 'anchor', status: 'skip', miss: 'unreadable' });
    const none = await run(deps({ readChain: async () => ({ anchor: { kind: 'none' }, verdict: { kind: 'none' }, servers: tally }) }));
    expect(none.steps.at(-1)).toEqual({ name: 'anchor', status: 'skip', miss: 'none' });
  });
});

describe('anchorStep', () => {
  it('gives a block only for an agreed bound verdict', () => {
    expect(anchorStep(bound)).toEqual({ name: 'anchor', status: 'pass', block: 977_901 });
    expect(anchorStep({ ...bound, verdict: { kind: 'revoked', revocation: since } })).toEqual({ name: 'anchor', status: 'skip', miss: 'none' });
    expect(anchorStep({ anchor: { kind: 'unknown' }, verdict: null, servers: tally })).toEqual({ name: 'anchor', status: 'skip', miss: 'unreadable' });
    expect(anchorStep(null)).toEqual({ name: 'anchor', status: 'skip', miss: 'unreadable' });
  });
});

describe('config.hero', () => {
  it('names the owner\'s Paytaca binding recorded for the judges page', () => {
    expect(config.hero.npub).toBe(config.judges.paytaca.npub);
    expect(config.hero.eventId).toBe(config.judges.paytaca.eventId);
    expect(event.id).toBe(config.hero.eventId);
  });

  it.each([
    ['npub', 'npub1short', /hero\.npub/],
    ['eventId', 'd7c03eee', /hero\.eventId/],
    ['timeoutMs', 0, /hero\.timeoutMs/],
  ] as const)('rejects a bad %s', (key, value, err) => {
    const c = structuredClone(config) as unknown as { hero: Record<string, unknown> };
    c.hero[key] = value;
    expect(() => parseConfig(c)).toThrow(err);
  });
});
