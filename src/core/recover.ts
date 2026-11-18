/**
 * Recovery: a new Nostr key takes over the binding of a lost one. The new key publishes an ordinary kind 10011
 * binding for the same BCH address and adds one tag, `["replaces", <old npub>, "bch:<address>", <signature>]`, where
 * the signature is a BCH signed message by the bound address over the exact text `replaces <old npub>`. A verifier
 * accepts it only when the old key's newest binding still claims that address and the signature recovers to the
 * address key. The steps are named in `RECOVERY_STEPS` (binding.ts); they never change whether the binding verifies.
 */
import { config } from '../config.js';
import { recoverSigner } from './bchmsg.js';
import { claimIdentity, claimFromTag, createBindingEvent, type BchClaim } from './binding.js';
import { keyControlsPayload, parseP2pkhAddress } from './cashaddr.js';
import { parsePubkey, type Event, type EventTemplate } from './nostr.js';
import { fail, pass, skip, type BindingResult, type Step } from './verify.js';

export interface RecoveryClaim {
  /** The lost key as written in the tag (npub) and as hex. */
  npub: string;
  pubkey: string;
  /** The CashAddr the recovery is signed for. */
  address: string;
  signature: string;
}

export interface RecoveryResult {
  /** Accepted: every step passed, including the look-up of the old key's newest binding. */
  ok: boolean;
  /** The old key named by the tag, as written (empty when the tag cannot be read). */
  from: string;
  fromPubkey: string;
  address: string;
  steps: Step[];
}

/** The exact text the bound BCH key signs to hand its binding over from `oldNpub`. */
export const recoveryText = (oldNpub: string): string => config.nostr.recoveryText.replace('{npub}', oldNpub);

/** The raw recovery tag of an event, or null when it has none. */
export const recoveryTagOf = (event: Pick<Event, 'tags'>): string[] | null =>
  event.tags.find((t) => t[0] === config.nostr.recoveryTag) ?? null;

/** Reads a recovery tag; a string explains why it cannot be read. */
export function parseRecoveryTag(tag: readonly string[]): RecoveryClaim | string {
  const [, npub = '', identity = '', signature = ''] = tag;
  const key = npub.startsWith('npub1') ? parsePubkey(npub) : { error: 'the old key must be an npub' };
  if ('error' in key) return `old key: ${key.error}`;
  const claim = claimFromTag(['i', identity]);
  if (!claim) return `the address must be written as ${config.nostr.platform}:<cashaddr>`;
  const parsed = parseP2pkhAddress(claim.address);
  if (typeof parsed === 'string') return parsed;
  if (signature.trim() === '') return 'the recovery signature is empty';
  return { npub, pubkey: key.hex, address: parsed.address, signature };
}

export interface CreateRecoveryInput {
  /** The new key's own claim for the address: a BCH signature over the verification text of the NEW npub. */
  claim: BchClaim;
  oldNpub: string;
  /** BCH signature by the same address over `recoveryText(oldNpub)`. */
  recoverySignature: string;
  createdAt?: number;
}

/** Builds the new key's binding event carrying the recovery tag. The new key has no earlier event to keep tags from. */
export function createRecoveryEvent(input: CreateRecoveryInput): EventTemplate {
  const base = createBindingEvent(input.createdAt === undefined ? { claim: input.claim } : { claim: input.claim, createdAt: input.createdAt });
  const tag = [config.nostr.recoveryTag, input.oldNpub, claimIdentity(input.claim.address), input.recoverySignature.trim()];
  const parsed = parseRecoveryTag(tag);
  if (typeof parsed === 'string') throw new Error(parsed);
  return { ...base, tags: [...base.tags, tag] };
}

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function oldBindingStep(claim: RecoveryClaim, old: BindingResult | null | undefined): Step {
  if (old === undefined) return skip('old_binding', 'no_relay_results', 'no relay results given; run lookup to check the old key');
  const bound = old !== null && old.ok && old.claims.some((c) => sameAddress(c.address, claim.address));
  return bound
    ? pass('old_binding')
    : fail('old_binding', 'old_not_bound', `the newest binding of ${claim.npub} does not claim ${claim.address}`, {
        npub: claim.npub,
        address: claim.address,
      });
}

function cycleStep(result: BindingResult, claim: RecoveryClaim, old: BindingResult | null | undefined): Step {
  if (claim.pubkey === result.pubkey) return fail('no_cycle', 'recovery_self', 'a key cannot recover from itself');
  if (old === undefined) return skip('no_cycle', 'no_relay_results', 'no relay results given; run lookup to check the old key');
  const back = old?.event ? recoveryTagOf(old.event) : null;
  const backClaim = back ? parseRecoveryTag(back) : null;
  return backClaim && typeof backClaim !== 'string' && backClaim.pubkey === result.pubkey
    ? fail('no_cycle', 'recovery_cycle', `${claim.npub} in turn claims to recover from ${result.npub}`, { npub: claim.npub })
    : pass('no_cycle');
}

/**
 * Checks the recovery claim of a verified binding. `old` is the old key's newest binding from relays: null when relays
 * hold none, undefined when it was not looked up (offline), which leaves the last two steps skipped and `ok` false.
 * Returns null when the event carries no recovery tag. Only one hop is checked; the old key's own recovery is not followed.
 */
export function verifyRecovery(result: BindingResult, old?: BindingResult | null): RecoveryResult | null {
  const tag = result.event ? recoveryTagOf(result.event) : null;
  if (!tag) return null;
  const claim = parseRecoveryTag(tag);
  if (typeof claim === 'string') {
    const steps = [fail('recovery_tag', 'recovery_malformed', claim)];
    return { ok: false, from: tag[1] ?? '', fromPubkey: '', address: '', steps };
  }
  const own = result.claims.find((c) => sameAddress(c.address, claim.address));
  const signer = recoverSigner(recoveryText(claim.npub), claim.signature);
  const payload = parseP2pkhAddress(claim.address);
  const signed = typeof signer !== 'string' && typeof payload !== 'string' && keyControlsPayload(signer.publicKey, payload.payload);
  const steps: Step[] = [
    pass('recovery_tag'),
    result.ok && own?.ok
      ? pass('recovery_claim')
      : fail('recovery_claim', 'recovery_unclaimed', `this binding does not verify a claim for ${claim.address}`, { address: claim.address }),
    signed
      ? pass('recovery_sig')
      : fail('recovery_sig', 'recovery_wrong_signer', `the recovery signature was not made by the key of ${claim.address} over "${recoveryText(claim.npub)}"`, {
          address: claim.address,
          npub: claim.npub,
        }),
    oldBindingStep(claim, old),
    cycleStep(result, claim, old),
  ];
  return { ok: steps.every((s) => s.status === 'pass'), from: claim.npub, fromPubkey: claim.pubkey, address: claim.address, steps };
}

/**
 * Marks, in one address look-up, each key that another key in the same results has recovered from. Both keys still
 * claim the address (the lost key cannot publish), so the note tells a reader which one is current.
 */
export function markRecovered(results: BindingResult[]): BindingResult[] {
  return results.map((r) => {
    const by = results.find((o) => o.recovery?.ok && o.recovery.fromPubkey === r.pubkey);
    return by ? { ...r, recoveredBy: by.npub } : r;
  });
}
