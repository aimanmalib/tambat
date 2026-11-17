#!/usr/bin/env -S npx tsx
/**
 * tambat command line: an independent verifier that needs no server of ours.
 *   tambat text <npub>                 print the exact text the BCH wallet must sign
 *   tambat verify <event.json>         verify a binding event offline ("-" reads stdin)
 *   tambat lookup <npub|cashaddr>      fetch from the configured relays and verify
 *   tambat revoke <cashaddr>           publish an event that removes this address from your binding
 *   tambat rotate <old> <new>          publish one event that moves your binding to another address of the wallet
 *   tambat anchor-lookup <cashaddr>    read the BCH chain only (no relays): Nostr keys this address committed to
 * revoke and rotate sign with the phrase in --keys <file> (default from config: cli.keysFile).
 * Add --json for machine-readable output. Exit code 0 = verified, 1 = not verified, 2 = usage error.
 */
import { readFileSync } from 'node:fs';
import { lookupByAddress, lookupByPubkey } from '../src/core/discover.js';
import { nodeRelayQuery } from '../src/node/relay.js';
import { config } from '../src/config.js';
import { parsePubkey, toNpub, verificationText } from '../src/core/nostr.js';
import { publishEvent } from '../src/core/publish.js';
import { readPhrase, revokeAddress, rotateAddress, type ManageDeps } from '../src/node/manage.js';
import { RelaySocket } from '../src/node/relay.js';
import { verifyBinding, type BindingResult } from '../src/core/verify.js';
import { electrumChain, readCommitments, type OpenChain } from '../src/core/anchor-chain.js';
import { parseP2pkhAddress } from '../src/core/cashaddr.js';

const USAGE =
  'usage: tambat text <npub> | verify <event.json|-> | lookup <npub|cashaddr> [--json]\n' +
  '       tambat revoke <cashaddr> | rotate <old cashaddr> <new cashaddr> [--keys <file>]\n' +
  '       tambat anchor-lookup <cashaddr> [--json]';

const nodeDeps: ManageDeps = {
  query: nodeRelayQuery,
  publish: (event) =>
    publishEvent(event, config.nostr.relays, config.nostr.publishTimeoutMs, RelaySocket as unknown as typeof WebSocket),
};

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

/** Chain only: every commitment the address made, oldest block first. Exit 0 when one is confirmed. */
async function anchorLookup(address: string, json: boolean, open: OpenChain): Promise<number> {
  const parsed = parseP2pkhAddress(address);
  if (typeof parsed === 'string') return usageError(parsed);
  let chain;
  try {
    chain = await open();
  } catch (err) {
    console.error(`chain servers unreachable: ${(err as Error).message}`);
    return 1;
  }
  try {
    const found = (await readCommitments(parsed.address, chain)).map((c) => ({ ...c, npub: toNpub(c.pubkey) }));
    if (json) console.log(JSON.stringify(found, null, 2));
    else if (found.length === 0) console.log(`no commitment found on BCH for ${parsed.address}`);
    else {
      for (const c of found) {
        const when = c.height > 0 ? `block ${c.height} (${new Date((c.blockTime ?? 0) * 1000).toISOString()})` : 'unconfirmed';
        console.log(`${when}  ${c.npub}\n  event ${c.eventId}\n  tx ${c.txid}`);
      }
      console.log('A commitment counts only while that key\'s newest binding still names this address: tambat lookup <npub>');
    }
    return found.some((c) => c.height > 0) ? 0 : 1;
  } catch (err) {
    console.error(`chain servers unreachable: ${(err as Error).message}`);
    return 1;
  } finally {
    await chain.close();
  }
}

export async function main(argv: string[], deps: ManageDeps = nodeDeps, openChain: OpenChain = electrumChain()): Promise<number> {
  const json = argv.includes('--json');
  const k = argv.indexOf('--keys');
  const keysFile = k >= 0 ? argv[k + 1] : config.cli.keysFile;
  const [command, arg, arg2] = argv.filter((a, i) => a !== '--json' && (k < 0 || (i !== k && i !== k + 1)));
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
        return out(json, await lookupByAddress(arg, { query: deps.query }), `no verified binding found for ${arg}`);
      } catch (err) {
        return usageError((err as Error).message);
      }
    }
    const key = parsePubkey(arg);
    if ('error' in key) return usageError(key.error);
    const result = await lookupByPubkey(key.hex, { query: deps.query });
    return out(json, result ? [result] : [], `no binding event found for ${toNpub(key.hex)}`);
  }
  if (command === 'anchor-lookup') return anchorLookup(arg, json, openChain);
  if (command === 'revoke' || command === 'rotate') {
    if (!keysFile || (command === 'rotate' && !arg2)) return usageError(`${command} needs its addresses and a key file`);
    try {
      const phrase = readPhrase(keysFile);
      const result =
        command === 'revoke' ? await revokeAddress(phrase, arg, deps) : await rotateAddress(phrase, arg, arg2 ?? '', deps);
      console.log(JSON.stringify(result, null, 2));
      return result.outcomes.some((o) => o.ok) ? 0 : 1;
    } catch (err) {
      return usageError((err as Error).message);
    }
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
