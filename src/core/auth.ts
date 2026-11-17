/**
 * Challenge and response sign-in for a relying app (ADR 0002). The server issues a single-use nonce bound to the
 * page origin and an expiry; the user answers with a NIP-98 event (kind 27235) carrying the nonce. Optionally the
 * user also signs a BCH message over the same nonce. Runs in Node and the browser (Web Crypto only).
 */
import { binToHex } from '@bitauth/libauth';
import { config } from '../config.js';
import { recoverSigner } from './bchmsg.js';
import { keyControlsPayload, parseP2pkhAddress } from './cashaddr.js';
import { eventShapeError, idMatches, signatureValid, type Event, type EventTemplate } from './nostr.js';

export const LOGIN_PATH = '/api/rp/login';
export const LOGIN_METHOD = 'POST';

export interface Challenge {
  nonce: string;
  origin: string;
  /** Unix seconds. */
  expiresAt: number;
}

export const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/** 32 random bytes as hex, from Web Crypto. */
export function randomToken(): string {
  return binToHex(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

/** In-memory single-use nonces. Expired entries are pruned on every issue; the oldest go first at the size cap. */
export class ChallengeStore {
  private readonly pending = new Map<string, Challenge>();

  constructor(
    private readonly ttlSeconds = config.auth.challengeTtlSeconds,
    private readonly max = config.auth.maxPendingChallenges,
  ) {}

  issue(origin: string, now = nowSeconds()): Challenge {
    for (const [nonce, c] of this.pending) if (c.expiresAt <= now) this.pending.delete(nonce);
    while (this.pending.size >= this.max) {
      const oldest = this.pending.keys().next().value;
      if (oldest === undefined) break;
      this.pending.delete(oldest);
    }
    const challenge = { nonce: randomToken(), origin, expiresAt: now + this.ttlSeconds };
    this.pending.set(challenge.nonce, challenge);
    return challenge;
  }

  /** Removes and returns the challenge, so a nonce can be answered at most once. */
  take(nonce: string): Challenge | undefined {
    const c = this.pending.get(nonce);
    this.pending.delete(nonce);
    return c;
  }

  get size(): number {
    return this.pending.size;
  }
}

export const loginUrl = (origin: string): string => `${origin}${LOGIN_PATH}`;

/** The text a BCH wallet signs to answer the challenge as well. */
export function bchChallengeText(challenge: Pick<Challenge, 'origin' | 'nonce'>): string {
  return `Sign in to ${challenge.origin} with challenge ${challenge.nonce}`;
}

/** The unsigned NIP-98 event a client signs to answer a challenge. */
export function createAuthEvent(challenge: Pick<Challenge, 'origin' | 'nonce'>, createdAt = nowSeconds()): EventTemplate {
  return {
    kind: config.nostr.authKind,
    created_at: createdAt,
    content: '',
    tags: [
      ['u', loginUrl(challenge.origin)],
      ['method', LOGIN_METHOD],
      ['challenge', challenge.nonce],
    ],
  };
}

export type LoginError =
  | 'event_shape'
  | 'kind'
  | 'event_id'
  | 'nostr_sig'
  | 'url'
  | 'method'
  | 'created_at'
  | 'challenge_unknown'
  | 'challenge_expired'
  | 'origin';

export type LoginCheck =
  | { ok: true; pubkey: string; challenge: Challenge }
  | { ok: false; error: LoginError; reason: string };

export interface LoginContext {
  /** Origin header of the login request, already checked against the allowed list. */
  origin: string;
  store: ChallengeStore;
  now?: number;
  clockSkewSeconds?: number;
}

const tagValue = (e: Event, name: string): string | undefined => e.tags.find((t) => t[0] === name)?.[1];
const no = (error: LoginError, reason: string): LoginCheck => ({ ok: false, error, reason });

/**
 * Checks a sign-in event. The nonce is consumed as soon as a correctly signed event names it, even when a later
 * check fails, so a leaked or misused nonce cannot be tried again.
 */
export function verifyLogin(input: unknown, ctx: LoginContext): LoginCheck {
  const now = ctx.now ?? nowSeconds();
  const skew = ctx.clockSkewSeconds ?? config.auth.clockSkewSeconds;
  const shape = eventShapeError(input);
  if (shape) return no('event_shape', shape);
  const e = input as Event;
  if (e.kind !== config.nostr.authKind) return no('kind', `kind ${e.kind} is not ${config.nostr.authKind}`);
  if (!idMatches(e)) return no('event_id', 'id does not match the event fields');
  if (!signatureValid(e)) return no('nostr_sig', 'Schnorr signature does not verify for this pubkey');
  if (tagValue(e, 'u') !== loginUrl(ctx.origin)) return no('url', `u tag must be ${loginUrl(ctx.origin)}`);
  if (tagValue(e, 'method') !== LOGIN_METHOD) return no('method', `method tag must be ${LOGIN_METHOD}`);
  if (Math.abs(e.created_at - now) > skew) return no('created_at', `created_at is more than ${skew} s from server time`);
  const challenge = ctx.store.take(tagValue(e, 'challenge') ?? '');
  if (!challenge) return no('challenge_unknown', 'challenge was never issued or was already used');
  if (challenge.expiresAt <= now) return no('challenge_expired', 'challenge expired; request a new one');
  if (challenge.origin !== ctx.origin) return no('origin', 'challenge was issued to a different origin');
  return { ok: true, pubkey: e.pubkey, challenge };
}

/** True when the BCH signature over the challenge text was made by the key of the address; else the reason. */
export function bchAnswerValid(challenge: Pick<Challenge, 'origin' | 'nonce'>, signature: string, address: string): true | string {
  const parsed = parseP2pkhAddress(address);
  if (typeof parsed === 'string') return parsed;
  const recovered = recoverSigner(bchChallengeText(challenge), signature);
  if (typeof recovered === 'string') return recovered;
  return keyControlsPayload(recovered.publicKey, parsed.payload) ? true : 'signature was not made by this address';
}
