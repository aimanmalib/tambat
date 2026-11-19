/**
 * The live check behind the home page's first card. One real binding is fetched from the relays and checked in the
 * order a verifier has to check it: the Nostr signature, then the BCH signature, then that the BCH signer owns the
 * claimed address, then the address's commitment on the BCH chain. Each step is reported the moment its own result is
 * known, so a check mark on the page is never ahead of the check it stands for. Verification itself is verifyBinding.
 */
import type { AddressStatus } from './anchor-chain.js';
import { parsePubkey, type Event } from './nostr.js';
import { boundSince } from './since.js';
import { verifyBinding, type BindingResult } from './verify.js';

export const HERO_STEPS = ['relay', 'nostr_sig', 'bch_sig', 'address_match', 'anchor'] as const;
export type HeroStepName = (typeof HERO_STEPS)[number];

/** Why the anchor step did not pass: the chain has no commitment for this pair, or no agreed answer came in time. */
export type AnchorMiss = 'none' | 'unreadable';

export type HeroStep =
  /** `block` comes with a passed anchor step; `address` with a passed address step (the claimed address, now verified). */
  | { name: HeroStepName; status: 'pass'; block?: number; address?: string }
  | { name: Exclude<HeroStepName, 'anchor'>; status: 'fail' }
  | { name: 'anchor'; status: 'skip'; miss: AnchorMiss };

export interface HeroTarget {
  npub: string;
  eventId: string;
  timeoutMs: number;
}

export interface HeroDeps {
  /** The events the relays return for this id and author (unchecked; may be empty). */
  fetchEvents: (eventId: string, pubkey: string, timeoutMs: number) => Promise<unknown[]>;
  /** One agreed read of the chain for the address (src/core/anchor-chain.ts addressStatus). */
  readChain: (address: string, pubkey: string, eventId: string) => Promise<AddressStatus>;
  /** Lets the page draw the step just reported before the next one is computed. Tests pass nothing. */
  paint?: () => Promise<void>;
}

export interface HeroOutcome {
  /** True when every relay and signature step passed; the anchor step is extra and never decides this. */
  verified: boolean;
  /** The step that failed, when one did. */
  failedAt?: HeroStepName;
  /** The address the binding claims, once the event was read. */
  address?: string;
  result?: BindingResult;
}

/** What the chain read says for the anchor step: the block it is bound since, or why there is no mark. */
export function anchorStep(status: AddressStatus | null): HeroStep {
  const block = boundSince(status);
  if (block !== null) return { name: 'anchor', status: 'pass', block };
  const kind = status?.anchor.kind;
  return { name: 'anchor', status: 'skip', miss: kind === 'unknown' || kind === 'unreachable' || !status ? 'unreadable' : 'none' };
}

/** Resolves to `fallback` when `work` has not settled after `ms` (or throws). */
export async function within<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([work.catch(() => fallback), late]);
  } finally {
    clearTimeout(timer);
  }
}

const passed = (r: BindingResult['steps'], names: string[]) => names.every((n) => r.find((s) => s.name === n)?.status === 'pass');

/** Runs the hero check, calling `report` once per step in HERO_STEPS order, and stops at the first failed step. */
export async function runHeroCheck(target: HeroTarget, deps: HeroDeps, report: (step: HeroStep) => void): Promise<HeroOutcome> {
  const paint = deps.paint ?? (async () => undefined);
  const stop = (name: Exclude<HeroStepName, 'anchor'>, rest: Omit<HeroOutcome, 'verified' | 'failedAt'> = {}): HeroOutcome => {
    report({ name, status: 'fail' });
    return { verified: false, failedAt: name, ...rest };
  };
  const key = parsePubkey(target.npub);
  if ('error' in key) return stop('relay');

  const events = await within(deps.fetchEvents(target.eventId, key.hex, target.timeoutMs), target.timeoutMs + 250, []);
  const event = events.find((e): e is Event => !!e && typeof e === 'object' && (e as Event).id === target.eventId);
  if (!event || event.pubkey !== key.hex) return stop('relay');
  report({ name: 'relay', status: 'pass' });
  await paint();

  const result = verifyBinding(event);
  if (!passed(result.steps, ['event_shape', 'kind', 'event_id', 'nostr_sig'])) return stop('nostr_sig', { result });
  report({ name: 'nostr_sig', status: 'pass' });
  await paint();

  const claim = result.claims[0];
  if (!claim) return stop('bch_sig', { result });
  const address = claim.address;
  if (!passed(claim.steps, ['bch_sig'])) return stop('bch_sig', { result, address });
  report({ name: 'bch_sig', status: 'pass' });
  await paint();

  if (!claim.ok) return stop('address_match', { result, address });
  report({ name: 'address_match', status: 'pass', address });
  await paint();

  const status = await within<AddressStatus | null>(deps.readChain(address, event.pubkey, event.id), target.timeoutMs, null);
  report(anchorStep(status));
  return { verified: true, address, result };
}
