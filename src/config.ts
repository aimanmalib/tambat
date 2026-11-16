/** Typed access to config/tambat.json. Every value that may change lives in that file; code reads it. */
import raw from '../config/tambat.json' with { type: 'json' };

export type Network = 'bitcoincash' | 'bchtest';

export interface TambatConfig {
  network: Network;
  nostr: {
    bindingKind: number;
    authKind: number;
    platform: string;
    relays: string[];
    queryTimeoutMs: number;
    publishTimeoutMs: number;
  };
  auth: {
    challengeTtlSeconds: number;
    sessionTtlSeconds: number;
    allowedOrigins: string[];
  };
  walletConnect: {
    projectId: string;
    chains: Record<Network, string>;
    methods: string[];
  };
  site: {
    publicUrl: string;
    defaultLanguage: string;
    languages: string[];
  };
  banner: {
    deckUrl: string;
    repoUrl: string;
    contactAddress: string;
  };
}

const NETWORKS: readonly Network[] = ['bitcoincash', 'bchtest'];

function fail(path: string, why: string): never {
  throw new Error(`config ${path}: ${why}`);
}

function positiveInt(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) fail(path, 'must be a positive integer');
  return value;
}

function nonEmptyStrings(value: unknown, path: string, test?: (s: string) => boolean): string[] {
  if (!Array.isArray(value) || value.length === 0) fail(path, 'must be a non-empty list');
  for (const item of value) {
    if (typeof item !== 'string' || item === '' || (test && !test(item))) fail(path, `invalid entry ${JSON.stringify(item)}`);
  }
  return value as string[];
}

/** Checks the shape of a config object and returns it typed. Throws with the offending path. */
export function parseConfig(input: unknown): TambatConfig {
  const c = input as TambatConfig;
  if (!c || typeof c !== 'object') fail('', 'must be an object');
  if (!NETWORKS.includes(c.network)) fail('network', `must be one of ${NETWORKS.join(', ')}`);
  positiveInt(c.nostr?.bindingKind, 'nostr.bindingKind');
  positiveInt(c.nostr?.authKind, 'nostr.authKind');
  if (typeof c.nostr.platform !== 'string' || !/^[a-z0-9._/-]+$/.test(c.nostr.platform)) {
    fail('nostr.platform', 'must use a-z, 0-9 and ._-/ only (NIP-39)');
  }
  nonEmptyStrings(c.nostr.relays, 'nostr.relays', (s) => /^wss:\/\/[^\s/]+/.test(s));
  positiveInt(c.nostr.queryTimeoutMs, 'nostr.queryTimeoutMs');
  positiveInt(c.nostr.publishTimeoutMs, 'nostr.publishTimeoutMs');
  positiveInt(c.auth?.challengeTtlSeconds, 'auth.challengeTtlSeconds');
  positiveInt(c.auth.sessionTtlSeconds, 'auth.sessionTtlSeconds');
  nonEmptyStrings(c.auth.allowedOrigins, 'auth.allowedOrigins', (s) => /^https?:\/\/[^\s/]+$/.test(s));
  if (typeof c.walletConnect?.projectId !== 'string') fail('walletConnect.projectId', 'must be a string');
  for (const n of NETWORKS) {
    if (typeof c.walletConnect.chains?.[n] !== 'string') fail(`walletConnect.chains.${n}`, 'must be a string');
  }
  nonEmptyStrings(c.walletConnect.methods, 'walletConnect.methods');
  if (!c.site?.languages?.includes(c.site.defaultLanguage)) fail('site.defaultLanguage', 'must be one of site.languages');
  for (const k of ['deckUrl', 'repoUrl', 'contactAddress'] as const) {
    if (typeof c.banner?.[k] !== 'string') fail(`banner.${k}`, 'must be a string (empty hides it)');
  }
  return c;
}

export const config: TambatConfig = parseConfig(raw);
