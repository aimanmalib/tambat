/**
 * The home page's live check: which candidate the card shows, then each step. The bindings are the owner's real Paytaca
 * binding (public relay data in tests/fixtures/paytaca-binding.json, written in the older prefixed form) and bindings
 * signed by the public BIP39 test keys; relays and chain servers are fakes, so nothing touches the network.
 */
import { describe, expect, it } from 'vitest';
import { config, parseConfig } from '../src/config.js';
import type { AddressStatus } from '../src/core/anchor-chain.js';
import type { Commitment } from '../src/core/anchor.js';
import { anchorStep, HERO_STEPS, isCanonical, pickHeroCandidate, runHeroCheck, type HeroDeps, type HeroStep } from '../src/core/hero-check.js';
import type { Event } from '../src/core/nostr.js';
import { secp256k1 } from '@bitauth/libauth';
import { finalizeEvent } from 'nostr-tools/pure';
import { signMessage } from '../src/core/bchmsg.js';
import { createBindingEvent } from '../src/core/binding.js';
import { addressFromPublicKey } from '../src/core/cashaddr.js';
import { parsePubkey, verificationText } from '../src/core/nostr.js';
import en from '../lang/en.json' with { type: 'json' };
import ms from '../lang/ms.json' with { type: 'json' };
import { bindingFromKeys, keysFromPhrase, type PhraseKeys } from '../src/core/paytaca.js';
import vectors from '../examples/vectors.json' with { type: 'json' };
import binding from './fixtures/paytaca-binding.json' with { type: 'json' };

/** A valid address of another key (the Nostr secret used as a BCH key). */
const otherAddress = (k: PhraseKeys) => addressFromPublicKey(secp256k1.derivePublicKeyCompressed(k.nostrSecretKey) as Uint8Array, 'bitcoincash');

const event = binding as Event;
const paytaca = { npub: config.judges.paytaca.npub, signer: 'paytaca' };
const target = { candidates: [paytaca], timeoutMs: 200 };
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
    const own = { candidates: [{ npub: keys.npub, signer: 'demo' }], timeoutMs: 200 };
    const signed = (address: string, signature: string) =>
      finalizeEvent(createBindingEvent({ claim: { address, signature }, previous: null, createdAt: 1_800_000_000 }), keys.nostrSecretKey);
    const runFor = async (e: Event) => {
      const steps: HeroStep[] = [];
      const outcome = await runHeroCheck(own, deps({ fetchEvents: async () => [e] }), (s) => steps.push(s));
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

  it('does not take an event of another author or another kind', async () => {
    const otherAuthor = { ...event, pubkey: '11'.repeat(32) };
    expect((await run(deps({ fetchEvents: async () => [otherAuthor] }))).names).toEqual(['relay=fail']);
    const otherKind = { ...event, kind: 1 };
    expect((await run(deps({ fetchEvents: async () => [otherKind] }))).names).toEqual(['relay=fail']);
  });

  it('checks the newest binding of the author, not an older one a relay still holds', async () => {
    const forgedNewer = { ...event, created_at: event.created_at + 10, sig: `${event.sig.slice(0, -2)}${event.sig.endsWith('00') ? '11' : '00'}` };
    expect((await run(deps({ fetchEvents: async () => [event, forgedNewer] }))).names).toEqual(['relay=pass', 'nostr_sig=fail']);
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

describe('pickHeroCandidate', () => {
  const keys = keysFromPhrase(vectors.phrase, 'bitcoincash');
  const test = { npub: keys.npub, signer: 'paytaca' };
  const canonical = bindingFromKeys(keys, 1_800_000_000);
  const prefixed = (createdAt: number) =>
    finalizeEvent(
      { kind: config.nostr.bindingKind, created_at: createdAt, content: '', tags: [['i', `bch:${keys.address}`, signMessage(keys.bchPrivateKey, verificationText(keys.npub))]] },
      keys.nostrSecretKey,
    );
  const hex = (npub: string) => (parsePubkey(npub) as { hex: string }).hex;
  /** A fake relay answering per author. */
  const relayOf = (byAuthor: Record<string, Event[]>): HeroDeps => deps({ fetchEvents: async (pubkey) => byAuthor[pubkey] ?? [] });

  it('falls back to the next candidate while the first binding is in the older prefixed form', async () => {
    const pick = await pickHeroCandidate({ candidates: [paytaca, { npub: keys.npub, signer: 'demo' }], timeoutMs: 200 }, relayOf({ [event.pubkey]: [event], [hex(keys.npub)]: [canonical] }));
    expect(pick.candidate.signer).toBe('demo');
    expect(pick.event?.id).toBe(canonical.id);
  });

  it('shows the first candidate once its newest binding is canonical and passes', async () => {
    const pick = await pickHeroCandidate({ candidates: [test, { npub: paytaca.npub, signer: 'demo' }], timeoutMs: 200 }, relayOf({ [event.pubkey]: [event], [hex(keys.npub)]: [canonical] }));
    expect(pick.candidate).toEqual(test);
  });

  it('goes by the newest event: a newer prefixed binding is no longer canonical, so the first that passes is shown', async () => {
    const newer = prefixed(1_800_000_100);
    const pick = await pickHeroCandidate(
      { candidates: [{ npub: paytaca.npub, signer: 'demo' }, test], timeoutMs: 200 },
      relayOf({ [event.pubkey]: [event], [hex(keys.npub)]: [canonical, newer] }),
    );
    expect(pick.candidate.signer).toBe('demo');
    const alone = await pickHeroCandidate({ candidates: [test], timeoutMs: 200 }, relayOf({ [hex(keys.npub)]: [canonical, newer] }));
    expect(alone.event?.id).toBe(newer.id);
  });

  it('passes over a candidate whose canonical binding fails, and over one with no binding on the relays', async () => {
    const broken = { ...canonical, sig: `${canonical.sig.slice(0, -2)}${canonical.sig.endsWith('00') ? '11' : '00'}` };
    const pick = await pickHeroCandidate({ candidates: [test, paytaca], timeoutMs: 200 }, relayOf({ [event.pubkey]: [event], [hex(keys.npub)]: [broken] }));
    expect(pick.candidate).toEqual(paytaca);
    const none = await pickHeroCandidate({ candidates: [test, paytaca], timeoutMs: 200 }, relayOf({ [event.pubkey]: [event] }));
    expect(none.candidate).toEqual(paytaca);
  });

  it('shows the first candidate, failing, when no candidate passes', async () => {
    const steps: HeroStep[] = [];
    let picked = '';
    const outcome = await runHeroCheck({ candidates: [test, paytaca], timeoutMs: 200 }, relayOf({}), (s) => steps.push(s), (c) => (picked = c.npub));
    expect(picked).toBe(keys.npub);
    expect(outcome).toMatchObject({ verified: false, failedAt: 'relay', candidate: test });
  });

  it('calls a binding canonical only when a claim tag reads bch:q… without the prefix', () => {
    expect(isCanonical(canonical, keys.address)).toBe(true);
    expect(isCanonical(prefixed(1), keys.address)).toBe(false);
    expect(isCanonical(event, config.judges.anchor.address)).toBe(false);
  });
});

describe('config.hero', () => {
  it('lists the owner\'s Paytaca binding first and the demo binding of the judges page as the fallback', () => {
    expect(config.hero.candidates[0]?.npub).toBe(config.judges.paytaca.npub);
    expect(config.hero.candidates.at(-1)?.npub).toBe(config.judges.sample.npub);
    expect(event.id).toBe(config.judges.paytaca.eventId);
  });

  it('has a signer text in both languages for every candidate', () => {
    for (const c of config.hero.candidates) {
      expect((en.hero.signedBy as Record<string, string>)[c.signer]).toMatch(/\S/);
      expect((ms.hero.signedBy as Record<string, string>)[c.signer]).toMatch(/\S/);
    }
  });

  const bad = (edit: (h: { candidates: { npub: string; signer: string }[]; timeoutMs: number }) => void) => {
    const c = structuredClone(config);
    edit(c.hero);
    return () => parseConfig(c);
  };
  it('rejects an empty list, a bad npub, a bad signer key, a repeated npub and a bad timeout', () => {
    expect(bad((h) => (h.candidates = []))).toThrow(/hero\.candidates/);
    expect(bad((h) => (h.candidates[0]!.npub = 'npub1short'))).toThrow(/hero\.candidates\.0\.npub/);
    expect(bad((h) => (h.candidates[1]!.signer = 'Demo key'))).toThrow(/hero\.candidates\.1\.signer/);
    expect(bad((h) => (h.candidates[1]!.npub = h.candidates[0]!.npub))).toThrow(/repeat/);
    expect(bad((h) => (h.timeoutMs = 0))).toThrow(/hero\.timeoutMs/);
  });
});
