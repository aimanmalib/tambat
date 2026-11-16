/** Calls to the relying app server (the demo app). Same origin; the browser sends the Origin header itself. */
import type { BindingResult } from '../src/core/verify';

export interface Challenge {
  nonce: string;
  expiresAt: number;
  url: string;
  method: string;
  bchText: string;
}

export interface SessionView {
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
    throw new Error(b?.reason ?? b?.error ?? `HTTP ${res.status}`);
  }
  return body as T;
}

export const getChallenge = () => call<Challenge>('/api/rp/challenge', { method: 'POST', body: '{}' });
export const login = (event: unknown, bchSignature?: string) =>
  call<{ session: SessionView; binding: BindingResult | null }>('/api/rp/login', {
    method: 'POST',
    body: JSON.stringify(bchSignature ? { event, bchSignature } : { event }),
  });
export const getSession = () => call<{ session: SessionView }>('/api/rp/session');
export const logout = () => call<null>('/api/rp/logout', { method: 'POST', body: '{}' });
