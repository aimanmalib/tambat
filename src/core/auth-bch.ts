/**
 * Sign-in with a BCH key only (ADR 0005). The wallet signs the same challenge text as the optional BCH answer of a
 * Nostr sign-in. The signature is checked first, with no network access; only then is the nonce consumed, and only
 * after that does the server look on relays for the Nostr key bound to the address.
 */
import { config } from '../config.js';
import { bchChallengeText, nowSeconds, type Challenge, type ChallengeStore } from './auth.js';
import { recoverSigner } from './bchmsg.js';
import { keyControlsPayload, parseP2pkhAddress } from './cashaddr.js';

export const BCH_LOGIN_TYPE = 'bch';

export interface BchLoginInput {
  type: typeof BCH_LOGIN_TYPE;
  address: string;
  signature: string;
  nonce: string;
}

export type BchLoginError = 'input' | 'address' | 'bch_sig' | 'challenge_unknown' | 'challenge_expired' | 'origin';

export type BchLoginCheck =
  | { ok: true; address: string; challenge: Challenge }
  | { ok: false; error: BchLoginError; reason: string };

export interface BchLoginContext {
  /** Origin header of the login request, already checked against the allowed list. */
  origin: string;
  store: ChallengeStore;
  now?: number;
  network?: string;
}

const no = (error: BchLoginError, reason: string): BchLoginCheck => ({ ok: false, error, reason });
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** True when the body asks for a BCH-only sign-in. */
export const isBchLogin = (body: unknown): boolean =>
  typeof body === 'object' && body !== null && (body as { type?: unknown }).type === BCH_LOGIN_TYPE;

/**
 * Checks a BCH-only sign-in answer. The text the wallet signed is rebuilt from the request origin and the nonce, so a
 * signature made for another site or another nonce never matches. The nonce is consumed once the signature verifies,
 * even when a later check fails.
 */
export function verifyBchLogin(input: unknown, ctx: BchLoginContext): BchLoginCheck {
  const now = ctx.now ?? nowSeconds();
  const network = ctx.network ?? config.network;
  const body = (typeof input === 'object' && input !== null ? input : {}) as Partial<Record<keyof BchLoginInput, unknown>>;
  if (!isText(body.address) || !isText(body.signature) || !isText(body.nonce)) {
    return no('input', 'address, signature and nonce must be non-empty strings');
  }
  const parsed = parseP2pkhAddress(body.address);
  if (typeof parsed === 'string') return no('address', parsed);
  if (parsed.prefix !== network) return no('address', `address is on ${parsed.prefix}, this app uses ${network}`);
  const nonce = body.nonce.trim();
  const recovered = recoverSigner(bchChallengeText({ origin: ctx.origin, nonce }), body.signature.trim());
  if (typeof recovered === 'string') return no('bch_sig', recovered);
  if (!keyControlsPayload(recovered.publicKey, parsed.payload)) {
    return no('bch_sig', 'signature over the challenge was not made by this address');
  }
  const challenge = ctx.store.take(nonce);
  if (!challenge) return no('challenge_unknown', 'challenge was never issued or was already used');
  if (challenge.expiresAt <= now) return no('challenge_expired', 'challenge expired; request a new one');
  if (challenge.origin !== ctx.origin) return no('origin', 'challenge was issued to a different origin');
  return { ok: true, address: parsed.address, challenge };
}
