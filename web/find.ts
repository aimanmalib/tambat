/** One search box for the web app: npub, hex key, BCH address or NIP-05 name. Names resolve on the domain, then verify on relays. */
import { lookupInput } from '../src/core/discover';
import { lookupByNip05, parseNip05 } from '../src/core/nip05';
import type { BindingResult } from '../src/core/verify';
import { TextError } from '../src/errors';

export interface Found {
  results: BindingResult[];
  /** Set when the input was a NIP-05 name: the name as typed and the key its domain points to. */
  via?: { name: string; npub: string };
}

/** Throws a TextError (`nip05.<problem>`) when a name does not resolve; 'bad_input' when the input is none of the four forms. */
export async function findIdentity(input: string): Promise<Found | 'bad_input'> {
  const value = input.trim();
  const target = parseNip05(value);
  if (!target) {
    const results = await lookupInput(value);
    return results === 'bad_input' ? results : { results };
  }
  const name = `${target.name}@${target.domain}`;
  const { resolution, binding } = await lookupByNip05(target);
  if (!resolution.ok) throw new TextError(`nip05.${resolution.problem}`, { name });
  return { results: binding ? [binding] : [], via: { name, npub: resolution.npub } };
}
