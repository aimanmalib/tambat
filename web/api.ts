/** Calls to the relying app server (the demo app). Same origin; the browser sends the Origin header itself. */
import type { BindingResult } from '../src/core/verify';
import { ApiError } from '../src/errors';

export interface Challenge {
  nonce: string;
  expiresAt: number;
  url: string;
  method: string;
  bchText: string;
}

export interface SessionView {
  method: 'nostr' | 'bch';
  pubkey: string;
  npub: string;
  address: string | null;
  bchSigned: boolean;
  expiresAt: number;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...init, headers: { 'content-type': 'application/json', ...init.headers } });
  const body = res.status === 204 ? null : ((await res.json()) as unknown);
  if (!res.ok) {
    const b = body as { reason?: string; error?: string } | null;
    throw new ApiError(b?.error ?? '', b?.reason ?? `HTTP ${res.status}`);
  }
  return body as T;
}

export const getChallenge = () => call<Challenge>('/api/rp/challenge', { method: 'POST', body: '{}' });
export const login = (event: unknown, bchSignature?: string) =>
  call<{ session: SessionView; binding: BindingResult | null }>('/api/rp/login', {
    method: 'POST',
    body: JSON.stringify(bchSignature ? { event, bchSignature } : { event }),
  });
/** BCH-only sign-in: the wallet's signature over the challenge text, for the address it belongs to. */
export const loginWithBch = (address: string, signature: string, nonce: string) =>
  call<{ session: SessionView; binding: BindingResult | null }>('/api/rp/login', {
    method: 'POST',
    body: JSON.stringify({ type: 'bch', address: address.trim(), signature: signature.trim(), nonce }),
  });
/** The current session, or null when nobody is signed in (the server answers 200 either way). */
export const getSession = () => call<{ session: SessionView | null }>('/api/rp/session');
export const logout = () => call<null>('/api/rp/logout', { method: 'POST', body: '{}' });
