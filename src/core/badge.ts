/**
 * The state an embedded badge shows for one npub, hex key or BCH address. The badge checks in the visitor's browser:
 * it looks the identity up on relays and verifies every event itself, exactly like Look up. When nothing verified is
 * found it asks whether any relay answered at all, so "relays unreachable" is never shown as "not linked".
 */
import { config } from '../config.js';
import { parseP2pkhAddress } from './cashaddr.js';
import { lookupInput, type DiscoverOptions } from './discover.js';
import { parsePubkey } from './nostr.js';
import type { BindingResult } from './verify.js';

export type BadgeState =
  | { state: 'verified'; npub: string; address: string }
  | { state: 'not_linked' }
  | { state: 'unreachable' }
  | { state: 'bad_input' };

/** How many of the relays answered a request within the timeout. Must not reject. */
export type ProbeFn = (relays: string[], timeoutMs: number) => Promise<number>;

export interface BadgeOptions extends DiscoverOptions {
  probe: ProbeFn;
}

/** The newest result that verifies and still claims the address (when one was given). */
function verifiedLink(results: BindingResult[], address: string | null): { npub: string; address: string } | null {
  const sorted = [...results].sort((a, b) => b.createdAt - a.createdAt);
  for (const r of sorted) {
    if (!r.ok) continue;
    const claim = r.claims.find((c) => c.ok && (address === null || c.address.toLowerCase() === address));
    if (claim) return { npub: r.npub, address: claim.address };
  }
  return null;
}

export async function badgeStatus(input: string, options: BadgeOptions): Promise<BadgeState> {
  const value = input.trim();
  const parsed = parseP2pkhAddress(value);
  const address = typeof parsed === 'string' ? null : parsed.address;
  if (address === null && 'error' in parsePubkey(value)) return { state: 'bad_input' };

  const { probe, ...discover } = options;
  const relays = discover.relays ?? config.nostr.relays;
  const timeoutMs = discover.timeoutMs ?? config.nostr.queryTimeoutMs;
  const [results, answered] = await Promise.all([lookupInput(value, { ...discover, relays, timeoutMs }), probe(relays, timeoutMs)]);
  const link = results === 'bad_input' ? null : verifiedLink(results, address);
  if (link) return { state: 'verified', ...link };
  return answered > 0 ? { state: 'not_linked' } : { state: 'unreachable' };
}

/** Path prefix of the badge page; the rest of the path is the npub, hex key or address. */
export const EMBED_PATH = '/embed/';

/** Short forms for the badge, which has room for one line of identity. */
export const shortNpub = (npub: string): string => (npub.length > 20 ? `${npub.slice(0, 10)}…${npub.slice(-6)}` : npub);

export function shortAddress(address: string): string {
  const bare = address.replace(/^[a-z]+:/, '');
  return bare.length > 16 ? `${bare.slice(0, 8)}…${bare.slice(-6)}` : bare;
}
