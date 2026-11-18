/**
 * Recovery: key B takes over the binding of lost key A for the same address. Keys come from the public phrase only:
 * A = account 0 (Nostr and BCH), B = the Nostr key of account 1, X = the BCH address of account 0.
 */
import { finalizeEvent } from 'nostr-tools/pure';
import { describe, expect, it } from 'vitest';
import { signMessage } from '../src/core/bchmsg.js';
import { createBindingEvent, createRevocationEvent, createRotationEvent } from '../src/core/binding.js';
import { lookupByAddress, lookupByPubkey } from '../src/core/discover.js';
import { verificationText, type Event } from '../src/core/nostr.js';
import { createRecoveryEvent, recoveryTagOf, recoveryText, verifyRecovery } from '../src/core/recover.js';
import { verifyBinding } from '../src/core/verify.js';
import { fakeRelay, keys, other } from './helpers.js';

const T = 1_800_000_000;
const A = { secret: keys.nostrSecretKey, npub: keys.npub, pubkey: keys.nostrPubkey };
const B = { secret: other.nostrSecretKey, npub: other.npub, pubkey: other.nostrPubkey };
const X = keys.address;

function binding(who: typeof A, createdAt: number): Event {
  const claim = { address: X, signature: signMessage(keys.bchPrivateKey, verificationText(who.npub)) };
  return finalizeEvent(createBindingEvent({ claim, createdAt }), who.secret);
}

function recovery(who: typeof A, from: string, createdAt: number, opts: { text?: string; signer?: Uint8Array } = {}): Event {
  const claim = { address: X, signature: signMessage(keys.bchPrivateKey, verificationText(who.npub)) };
  const recoverySignature = signMessage(opts.signer ?? keys.bchPrivateKey, opts.text ?? recoveryText(from));
  return finalizeEvent(createRecoveryEvent({ claim, oldNpub: from, recoverySignature, createdAt }), who.secret);
}

const lookup = (events: Event[], pubkey: string) => lookupByPubkey(pubkey, { query: fakeRelay(events) });
const failed = (r: Awaited<ReturnType<typeof lookup>>) => r?.recovery?.steps.filter((s) => s.status !== 'pass').map((s) => `${s.name}:${s.code}`);

describe('recovery', () => {
  it('accepts B recovering from A when A still claims the address', async () => {
    const r = await lookup([binding(A, T), recovery(B, A.npub, T + 10)], B.pubkey);
    expect(r?.ok).toBe(true);
    expect(r?.recovery?.ok).toBe(true);
    expect(r?.recovery?.from).toBe(A.npub);
    expect(r?.recovery?.steps.map((s) => s.name)).toEqual(['recovery_tag', 'recovery_claim', 'recovery_sig', 'old_binding', 'no_cycle']);
  });

  it('refuses when the old key does not claim the address (never bound, revoked or moved)', async () => {
    const a = binding(A, T);
    expect(failed(await lookup([recovery(B, A.npub, T + 10)], B.pubkey))).toEqual(['old_binding:old_not_bound']);
    const revoked = finalizeEvent(createRevocationEvent(a, T + 5), A.secret);
    expect(failed(await lookup([a, revoked, recovery(B, A.npub, T + 10)], B.pubkey))).toEqual(['old_binding:old_not_bound']);
    const moved = finalizeEvent(
      createRotationEvent(a, X, { address: other.address, signature: signMessage(other.bchPrivateKey, verificationText(A.npub)) }, T + 5),
      A.secret,
    );
    expect(failed(await lookup([a, moved, recovery(B, A.npub, T + 10)], B.pubkey))).toEqual(['old_binding:old_not_bound']);
  });

  it('refuses a signature over any text other than "replaces <old npub>"', async () => {
    for (const text of [`replaces ${B.npub}`, `Replaces ${A.npub}`, `replaces ${A.npub} `, verificationText(B.npub)]) {
      const r = await lookup([binding(A, T), recovery(B, A.npub, T + 10, { text })], B.pubkey);
      expect(failed(r), text).toEqual(['recovery_sig:recovery_wrong_signer']);
    }
  });

  it('refuses a recovery signed by the key of another address', async () => {
    const r = await lookup([binding(A, T), recovery(B, A.npub, T + 10, { signer: other.bchPrivateKey })], B.pubkey);
    expect(failed(r)).toEqual(['recovery_sig:recovery_wrong_signer']);
    expect(r?.ok).toBe(true); // the binding of B itself still verifies; only the recovery claim is refused
  });

  it('refuses both sides of a cycle A -> B -> A and terminates', async () => {
    const events = [binding(A, T), recovery(B, A.npub, T + 10), recovery(A, B.npub, T + 20)];
    expect(failed(await lookup(events, B.pubkey))).toEqual(['no_cycle:recovery_cycle']);
    expect(failed(await lookup(events, A.pubkey))).toEqual(['no_cycle:recovery_cycle']);
  });

  it('refuses a key recovering from itself and a recovery whose own claim does not verify', async () => {
    expect(failed(await lookup([binding(A, T), recovery(A, A.npub, T + 10)], A.pubkey))).toEqual(['no_cycle:recovery_self']);
    const r = recovery(B, A.npub, T + 10);
    const copied = finalizeEvent({ ...r, tags: [['i', `bch:${X}`, signMessage(keys.bchPrivateKey, verificationText(A.npub))], r.tags[1] as string[]] }, B.secret);
    const res = await lookup([binding(A, T), copied], B.pubkey);
    expect(res?.ok).toBe(false);
    expect(failed(res)).toEqual(['recovery_claim:recovery_unclaimed']);
  });

  it('explains a malformed tag and skips the relay steps offline', () => {
    const r = recovery(B, A.npub, T + 10);
    const broken = finalizeEvent({ ...r, tags: [r.tags[0] as string[], ['replaces', A.pubkey, `bch:${X}`, 'x']] }, B.secret);
    expect(verifyRecovery(verifyBinding(broken))?.steps.map((s) => s.code)).toEqual(['recovery_malformed']);
    const offline = verifyRecovery(verifyBinding(r));
    expect(offline?.ok).toBe(false);
    expect(offline?.steps.filter((s) => s.status === 'skip').map((s) => s.name)).toEqual(['old_binding', 'no_cycle']);
    expect(verifyRecovery(verifyBinding(binding(A, T)))).toBeNull();
  });

  it('marks the recovered key in an address look-up and drops the tag from later events', async () => {
    const b = recovery(B, A.npub, T + 10);
    const results = await lookupByAddress(X, { query: fakeRelay([binding(A, T), b]) });
    expect(results.map((r) => [r.npub, r.recoveredBy ?? ''])).toEqual(
      expect.arrayContaining([[A.npub, B.npub], [B.npub, '']]),
    );
    expect(recoveryTagOf(createRevocationEvent(b))).toBeNull();
    expect(recoveryTagOf(createBindingEvent({ claim: { address: X, signature: 'c2ln' }, previous: b }))).toBeNull();
  });
});
