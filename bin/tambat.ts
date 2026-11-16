#!/usr/bin/env -S npx tsx
/**
 * tambat command line: an independent verifier that needs no server of ours.
 *   tambat text <npub>                 print the exact text the BCH wallet must sign
 *   tambat verify <event.json>         verify a binding event offline ("-" reads stdin)
 *   tambat lookup <npub|cashaddr>      fetch from the configured relays and verify
 * Add --json for machine-readable output. Exit code 0 = verified, 1 = not verified, 2 = usage error.
 */
import { readFileSync } from 'node:fs';
import { lookupByAddress, lookupByPubkey } from '../src/core/discover.js';
import { nodeRelayQuery } from '../src/node/relay.js';
import { parsePubkey, toNpub, verificationText } from '../src/core/nostr.js';
import { verifyBinding, type BindingResult } from '../src/core/verify.js';

const USAGE = 'usage: tambat text <npub> | verify <event.json|-> | lookup <npub|cashaddr> [--json]';

function render(result: BindingResult): string {
  const lines = [`${result.ok ? 'VERIFIED' : 'NOT VERIFIED'}  ${result.npub || '(no author)'}`];
  for (const s of result.steps) lines.push(`  ${s.status.padEnd(4)} ${s.name}${s.reason ? `: ${s.reason}` : ''}`);
  if (result.steps.length > 1 && result.claims.length === 0) lines.push('  fail claims: event has no bch: identity tag');
  for (const c of result.claims) {
    lines.push(`  claim ${c.address}`);
    for (const s of c.steps) lines.push(`    ${s.status.padEnd(4)} ${s.name}${s.reason ? `: ${s.reason}` : ''}`);
  }
  return lines.join('\n');
}

function out(json: boolean, results: BindingResult[], emptyMessage: string): number {
  if (json) console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
  else console.log(results.length ? results.map(render).join('\n\n') : emptyMessage);
  return results.length > 0 && results.every((r) => r.ok) ? 0 : 1;
}

export async function main(argv: string[]): Promise<number> {
  const json = argv.includes('--json');
  const [command, arg] = argv.filter((a) => a !== '--json');
  if (!command || !arg) {
    console.error(USAGE);
    return 2;
  }
  if (command === 'text') {
    const key = parsePubkey(arg);
    if ('error' in key) return usageError(key.error);
    console.log(verificationText(toNpub(key.hex)));
    return 0;
  }
  if (command === 'verify') {
    let event: unknown;
    try {
      event = JSON.parse(readFileSync(arg === '-' ? 0 : arg, 'utf8'));
    } catch (err) {
      return usageError(`cannot read event: ${(err as Error).message}`);
    }
    return out(json, [verifyBinding(event)], '');
  }
  if (command === 'lookup') {
    if (arg.includes(':')) {
      try {
        return out(json, await lookupByAddress(arg, { query: nodeRelayQuery }), `no verified binding found for ${arg}`);
      } catch (err) {
        return usageError((err as Error).message);
      }
    }
    const key = parsePubkey(arg);
    if ('error' in key) return usageError(key.error);
    const result = await lookupByPubkey(key.hex, { query: nodeRelayQuery });
    return out(json, result ? [result] : [], `no binding event found for ${toNpub(key.hex)}`);
  }
  return usageError(`unknown command ${command}`);
}

function usageError(message: string): number {
  console.error(`${message}\n${USAGE}`);
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
