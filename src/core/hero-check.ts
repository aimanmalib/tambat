/**
 * The live check behind the home page's first card. The card has an ordered list of candidate keys (config
 * hero.candidates): the newest binding of each is fetched from the relays, and the card shows the first one whose binding
 * passes and is written in the canonical form (`bch:q…`); failing that, the first one that passes; failing that, the
 * first candidate, so a failure is shown rather than hidden. The chosen binding is then reported in the order a verifier
 * has to check it: the Nostr signature, then the BCH signature, then that the BCH signer owns the
 * claimed address, then the address's commitment on the BCH chain. Each step is reported the moment its own result is
 * known, so a check mark on the page is never ahead of the check it stands for. Verification itself is verifyBinding.
 */
import type { AddressStatus } from './anchor-chain.js';
import { config } from '../config.js';
import { claimIdentity } from './binding.js';
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

/** One key the card may show; `signer` names the lang text that says what signed its binding (hero.signedBy). */
export interface HeroCandidate {
  npub: string;
  signer: string;
}

export interface HeroTarget {
  candidates: HeroCandidate[];
  timeoutMs: number;
}

export interface HeroDeps {
  /** The binding events (config nostr.bindingKind) the relays return for this author (unchecked; may be empty). */
  fetchEvents: (pubkey: string, timeoutMs: number) => Promise<unknown[]>;
  /** One agreed read of the chain for the address (src/core/anchor-chain.ts addressStatus). */
  readChain: (address: string, pubkey: string, eventId: string) => Promise<AddressStatus>;
  /** Lets the page draw the step just reported before the next one is computed. Tests pass nothing. */
  paint?: () => Promise<void>;
}

export interface HeroPick {
  candidate: HeroCandidate;
  /** The candidate's newest binding event from the relays, or null when none came back in time. */
  event: Event | null;
}

export interface HeroOutcome {
  /** The candidate the card shows. */
  candidate?: HeroCandidate;
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

/** True when one claim tag of the event spells its address in the canonical form, `bch:q…` on mainnet. */
export function isCanonical(event: Event, address: string): boolean {
  const wanted = claimIdentity(address, 'bare');
  return wanted.split(':').length === 2 && event.tags.some((t) => t[0] === 'i' && t[1] === wanted);
}

/** The newest binding event of one author among what the relays returned; other authors and kinds are dropped. */
export function newestBinding(events: unknown[], pubkey: string): Event | null {
  const own = events.filter(
    (e): e is Event => !!e && typeof e === 'object' && (e as Event).pubkey === pubkey && (e as Event).kind === config.nostr.bindingKind,
  );
  own.sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id));
  return own[0] ?? null;
}

/** Asks the relays for every candidate at once, then picks the one the card shows (see the module comment). */
export async function pickHeroCandidate(target: HeroTarget, deps: HeroDeps): Promise<HeroPick> {
  const picks = await Promise.all(
    target.candidates.map(async (candidate): Promise<HeroPick> => {
      const key = parsePubkey(candidate.npub);
      if ('error' in key) return { candidate, event: null };
      const events = await within(deps.fetchEvents(key.hex, target.timeoutMs), target.timeoutMs + 250, []);
      return { candidate, event: newestBinding(events, key.hex) };
    }),
  );
  const passing = picks.filter((p) => p.event && verifyBinding(p.event).ok);
  const canonical = passing.find((p) => p.event && isCanonical(p.event, verifyBinding(p.event).claims[0]?.address ?? ''));
  const first = picks[0];
  if (!first) throw new Error('hero.candidates is empty');
  return canonical ?? passing[0] ?? first;
}

/**
 * Runs the hero check: picks a candidate (`onPick` is called once with it), then calls `report` once per step in
 * HERO_STEPS order and stops at the first failed step.
 */
export async function runHeroCheck(
  target: HeroTarget,
  deps: HeroDeps,
  report: (step: HeroStep) => void,
  onPick: (candidate: HeroCandidate) => void = () => undefined,
): Promise<HeroOutcome> {
  const paint = deps.paint ?? (async () => undefined);
  const { candidate, event } = await pickHeroCandidate(target, deps);
  onPick(candidate);
  const stop = (name: Exclude<HeroStepName, 'anchor'>, rest: Omit<HeroOutcome, 'verified' | 'failedAt'> = {}): HeroOutcome => {
    report({ name, status: 'fail' });
    return { verified: false, failedAt: name, candidate, ...rest };
  };
  if (!event) return stop('relay');
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
  return { verified: true, candidate, address, result };
}
