/**
 * NIP-05 names (`name@domain`) as a way to find someone. The domain's answer is only a pointer to a Nostr key: the
 * BCH address still comes from that key's own signed binding, verified like any other lookup. A domain can point a
 * name at a different key, but it cannot make a binding verify for a key that never signed one.
 */
import { NIP05_REGEX } from 'nostr-tools/nip05';
import { config } from '../config.js';
import { lookupByPubkey, type DiscoverOptions } from './discover.js';
import { toNpub } from './nostr.js';
import type { BindingResult } from './verify.js';

export interface Nip05Name {
  /** Local part, lower case; `_` when the input was a bare `_@domain`. */
  name: string;
  domain: string;
}

/**
 * Why a name did not resolve: `unreachable` (no answer, a redirect, not JSON), `bad_answer` (JSON without a `names`
 * object), `unknown_name` (the domain does not list this name) or `bad_key` (the listed key is not 64 hex characters).
 */
export type Nip05Problem = 'unreachable' | 'bad_answer' | 'unknown_name' | 'bad_key';

export type Nip05Resolution = ({ ok: true; pubkey: string; npub: string } | { ok: false; problem: Nip05Problem; reason: string }) & Nip05Name;

export interface Nip05Options {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

const KEY = /^[0-9a-f]{64}$/;

/** Parses `name@domain`. Returns null for anything else, including a bare domain, so npubs and addresses never match. */
export function parseNip05(input: string): Nip05Name | null {
  const value = input.trim().toLowerCase();
  if (!value.includes('@')) return null;
  const m = NIP05_REGEX.exec(value);
  if (!m?.[1] || !m[2]) return null;
  return { name: m[1], domain: m[2] };
}

/** The URL NIP-05 defines for a name: `https://<domain>/.well-known/nostr.json?name=<name>`. */
export function nip05Url({ name, domain }: Nip05Name): string {
  return `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`;
}

const REASONS: Record<Nip05Problem, string> = {
  unreachable: 'the domain did not answer with a NIP-05 document',
  bad_answer: 'the domain answered without a names list',
  unknown_name: 'the domain does not list this name',
  bad_key: 'the domain lists this name with an invalid key',
};

/** Asks the domain for the key behind a name. Redirects are refused, as NIP-05 requires. Never rejects. */
export async function resolveNip05(target: Nip05Name, options: Nip05Options = {}): Promise<Nip05Resolution> {
  const fail = (problem: Nip05Problem): Nip05Resolution => ({ ok: false, problem, reason: REASONS[problem], ...target });
  const doFetch = options.fetch ?? ((url: string, init?: RequestInit) => globalThis.fetch(url, init));
  let body: unknown;
  try {
    const res = await doFetch(nip05Url(target), {
      redirect: 'error',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(options.timeoutMs ?? config.nip05.timeoutMs),
    });
    if (!res.ok) return fail('unreachable');
    body = await res.json();
  } catch {
    return fail('unreachable');
  }
  const names = (body as { names?: unknown } | null)?.names;
  if (!names || typeof names !== 'object' || Array.isArray(names)) return fail('bad_answer');
  if (!Object.hasOwn(names, target.name)) return fail('unknown_name');
  const key = (names as Record<string, unknown>)[target.name];
  if (typeof key !== 'string' || !KEY.test(key)) return fail('bad_key');
  return { ok: true, pubkey: key, npub: toNpub(key), ...target };
}

export interface NameLookup {
  resolution: Nip05Resolution;
  /** The key's newest binding; null when the name did not resolve or the key has none. */
  binding: BindingResult | null;
}

/** Name to key (from the domain) to newest binding (from relays, verified here). */
export async function lookupByNip05(target: Nip05Name, options: DiscoverOptions & Nip05Options = {}): Promise<NameLookup> {
  const resolution = await resolveNip05(target, options);
  if (!resolution.ok) return { resolution, binding: null };
  return { resolution, binding: await lookupByPubkey(resolution.pubkey, options) };
}

/** The answer for this site's own /.well-known/nostr.json: only names from config, and only the one asked for. */
export function servedNames(name: unknown, names: Record<string, string> = config.nip05.names): { names: Record<string, string> } {
  if (typeof name !== 'string' || !Object.hasOwn(names, name.toLowerCase())) return { names: {} };
  const key = name.toLowerCase();
  return { names: { [key]: names[key] as string } };
}
