#!/usr/bin/env -S npx tsx
/**
 * tambat command line: an independent verifier that needs no server of ours.
 *   tambat text <npub>                 print the exact text the BCH wallet must sign
 *   tambat verify <event.json>         verify a binding event offline ("-" reads stdin)
 *   tambat lookup <npub|cashaddr>      fetch from the configured relays and verify
 *   tambat revoke <cashaddr>           publish an event that removes this address from your binding
 *   tambat rotate <old> <new>          publish one event that moves your binding to another address of the wallet
 *   tambat anchor-lookup <cashaddr>    read the BCH chain only (no relays): Nostr keys this address committed to
 *   tambat recover <old npub>          bind the address of a lost Nostr key to the key in --keys, signed by --bch-keys
 *   tambat receipt <txid>              find payment receipts for a BCH transaction and check them against the chain
 *   tambat receipt-publish <payee> <txid>  publish a receipt for a payment you made, signed by the Nostr key in --keys
 *   tambat attest <npub>               attest the current binding of another key, signed by the Nostr key in --keys
 *   tambat attestations <npub>         list attestations of a key's current binding (older bindings drop)
 * revoke and rotate sign with the phrase in --keys <file> (default from config: cli.keysFile). recover takes the new
 * Nostr key from --keys and the wallet phrase that holds the bound address from --bch-keys.
 * Add --json for machine-readable output. Exit code 0 = verified, 1 = not verified, 2 = usage error.
 */
import { readFileSync } from 'node:fs';
import { lookupByAddress, lookupByPubkey } from '../src/core/discover.js';
import { nodeRelayQuery } from '../src/node/relay.js';
import { config } from '../src/config.js';
import { parsePubkey, toNpub, verificationText } from '../src/core/nostr.js';
import { publishEvent } from '../src/core/publish.js';
import { readPhrase, recoverFrom, revokeAddress, rotateAddress, type ManageDeps } from '../src/node/manage.js';
import { verifyRecovery } from '../src/core/recover.js';
import { RelaySocket } from '../src/node/relay.js';
import { verifyBinding, type BindingResult } from '../src/core/verify.js';
import { electrumChain, readCommitments, type OpenChain } from '../src/core/anchor-chain.js';
import { parseP2pkhAddress } from '../src/core/cashaddr.js';
import { publishReceipt, receiptLookup } from '../src/node/receipt.js';
import { attestationLookup, publishAttestation } from '../src/node/attest.js';

const USAGE =
  'usage: tambat text <npub> | verify <event.json|-> | lookup <npub|cashaddr> [--json]\n' +
  '       tambat revoke <cashaddr> | rotate <old cashaddr> <new cashaddr> [--keys <file>]\n' +
  '       tambat anchor-lookup <cashaddr> [--json]\n' +
  '       tambat recover <old npub> --keys <new key file> --bch-keys <wallet phrase file>\n' +
  '       tambat receipt <txid> [--json] | receipt-publish <payee npub> <txid> [--keys <file>]\n' +
  '       tambat attest <npub> [--keys <file>] | attestations <npub> [--json]';

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
  if (result.recoveredBy) lines.push(`  note: the owner of this address recovered to ${result.recoveredBy}`);
  if (result.recovery) {
    const r = result.recovery;
    const verdict = r.ok ? 'recovered from' : r.steps.some((s) => s.status === 'fail') ? 'recovery not accepted from' : 'recovery not checked (run lookup) from';
    lines.push(`  ${verdict} ${r.from || '(unreadable)'}`);
    for (const s of r.steps) lines.push(`    ${s.status.padEnd(4)} ${s.name}${s.reason ? `: ${s.reason}` : ''}`);
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
  const flags = new Map<string, number>(['--keys', '--bch-keys'].map((f) => [f, argv.indexOf(f)]));
  const valueOf = (flag: string) => {
    const i = flags.get(flag) ?? -1;
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const keysFile = valueOf('--keys') ?? config.cli.keysFile;
  const flagged = new Set([...flags.values()].filter((i) => i >= 0).flatMap((i) => [i, i + 1]));
  const [command, arg, arg2] = argv.filter((a, i) => a !== '--json' && !flagged.has(i));
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
    const result = verifyBinding(event);
    const recovery = verifyRecovery(result);
    return out(json, [recovery ? { ...result, recovery } : result], '');
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
  if (command === 'receipt') {
    if (!/^[0-9a-fA-F]{64}$/.test(arg)) return usageError('receipt needs a 64-character hex transaction id');
    return receiptLookup(arg.toLowerCase(), json, deps, openChain);
  }
  if (command === 'receipt-publish') {
    if (!keysFile || !arg2) return usageError('receipt-publish needs the payee, the transaction id and a key file');
    try {
      const result = await publishReceipt(readPhrase(keysFile), arg, arg2, deps);
      console.log(JSON.stringify(result, null, 2));
      return result.outcomes.some((o) => o.ok) ? 0 : 1;
    } catch (err) {
      return usageError((err as Error).message);
    }
  }
  if (command === 'attestations') {
    try {
      return await attestationLookup(arg, json, deps);
    } catch (err) {
      return usageError((err as Error).message);
    }
  }
  if (command === 'attest') {
    if (!keysFile) return usageError('attest needs the npub to attest and a key file');
    try {
      const result = await publishAttestation(readPhrase(keysFile), arg, deps);
      console.log(JSON.stringify(result, null, 2));
      return result.outcomes.some((o) => o.ok) ? 0 : 1;
    } catch (err) {
      return usageError((err as Error).message);
    }
  }
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
  if (command === 'recover') {
    const bchKeys = valueOf('--bch-keys');
    if (!keysFile || !bchKeys) return usageError('recover needs --keys <new key file> and --bch-keys <wallet phrase file>');
    try {
      const result = await recoverFrom(readPhrase(keysFile), readPhrase(bchKeys), arg, deps);
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
