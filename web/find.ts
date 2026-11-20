/** One search box for the web app: npub, hex key, BCH address or NIP-05 name. Names resolve on the domain, then verify on relays. */
import { electrumServers } from '../src/core/anchor-chain';
import { lookupInput } from '../src/core/discover';
import { lookupByNip05, parseNip05 } from '../src/core/nip05';
import type { BindingResult } from '../src/core/verify';
import { config } from '../src/config';
import { createRelayWatch, type RelayStatus } from '../src/core/relay-watch';
import { TextError } from '../src/errors';

export interface Found {
  results: BindingResult[];
  /** Set when the input was a NIP-05 name: the name as typed and the key its domain points to. */
  via?: { name: string; npub: string };
  /** Every configured relay with whether it answered this lookup, and how fast. Absent when no relay was asked. */
  relays?: RelayStatus[];
}

/** Throws a TextError (`nip05.<problem>`) when a name does not resolve; 'bad_input' when the input is none of the four forms. */
export async function findIdentity(input: string): Promise<Found | 'bad_input'> {
  const value = input.trim();
  const target = parseNip05(value);
  const watch = createRelayWatch(config.nostr.relays);
  if (!target) {
    const results = await lookupInput(value, { watch, chain: { servers: electrumServers() } });
    return results === 'bad_input' ? results : { results, relays: watch.statuses() };
  }
  const name = `${target.name}@${target.domain}`;
  const { resolution, binding } = await lookupByNip05(target, { watch, chain: { servers: electrumServers() } });
  if (!resolution.ok) throw new TextError(`nip05.${resolution.problem}`, { name });
  return { results: binding ? [binding] : [], via: { name, npub: resolution.npub }, relays: watch.statuses() };
}
