/**
 * What the one-file verifier does with its two fields. A pasted event is checked on this device only; an npub,
 * hex key or BCH address is looked up on the listed relays and every event they return is checked here.
 */
import { lookupInput, type QueryFn } from '../src/core/discover.js';
import { verifyBinding, type BindingResult } from '../src/core/verify.js';

export type CheckOutcome =
  | { kind: 'pasted'; result: BindingResult }
  | { kind: 'found'; results: BindingResult[]; relays: string[] }
  | { kind: 'error'; key: 'verifier.badJson' | 'verifier.badRelays' | 'lookup.inputError'; vars?: Record<string, string> };

/** One relay URL per line or separated by spaces or commas; each must be ws:// or wss://. */
export function parseRelays(text: string): string[] | { bad: string } {
  const relays = [...new Set(text.split(/[\s,]+/).filter((s) => s !== ''))];
  const bad = relays.find((r) => !/^wss?:\/\/[^\s/]+/.test(r));
  if (bad !== undefined) return { bad };
  return relays.length > 0 ? relays : { bad: '' };
}

export async function check(input: string, relayText: string, query?: QueryFn): Promise<CheckOutcome> {
  const text = input.trim();
  if (text.startsWith('{')) {
    let event: unknown;
    try {
      event = JSON.parse(text);
    } catch (e) {
      return { kind: 'error', key: 'verifier.badJson', vars: { reason: e instanceof Error ? e.message : String(e) } };
    }
    return { kind: 'pasted', result: verifyBinding(event) };
  }
  const relays = parseRelays(relayText);
  if (!Array.isArray(relays)) return { kind: 'error', key: 'verifier.badRelays', vars: { relay: relays.bad } };
  const results = await lookupInput(text, query ? { relays, query } : { relays });
  if (results === 'bad_input') return { kind: 'error', key: 'lookup.inputError' };
  return { kind: 'found', results, relays };
}
