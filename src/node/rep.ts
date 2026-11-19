/**
 * Portable reputation from the command line (docs/SPEC.md "Portable reputation"). `rep export` reads a key's
 * current binding and its attestations from the configured relays, turns each into a credential (ADR 0017), reads
 * the chain for the anchor block and writes the bundle. `rep verify` recounts a bundle offline; with `--chain` it
 * also reads the chain to check the claimed anchor block.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { decode } from 'nostr-tools/nip19';
import { addressStatus, type AddressStatus, type ChainChoice } from '../core/anchor-chain.js';
import { attestationsOf } from '../core/attest-find.js';
import { lookupByPubkey } from '../core/discover.js';
import { parsePubkey, toNpub } from '../core/nostr.js';
import { buildReputationBundle, summarizeReputation, verifyReputationBundle, type BundleCheck, type RepExclusion } from '../core/reputation.js';
import { credentialFrom } from '../core/vc.js';
import type { ManageDeps } from './manage.js';
import { vcReason } from './vc.js';

/** An npub, nprofile or 64-character hex key. */
export function parseHolder(input: string): { hex: string } | { error: string } {
  const value = input.trim();
  if (!value.startsWith('nprofile1')) return parsePubkey(value);
  try {
    const decoded = decode(value as `nprofile1${string}`);
    if (decoded.type === 'nprofile') return { hex: decoded.data.pubkey };
  } catch {
    // reported below
  }
  return { error: 'invalid nprofile' };
}

/** Writes the bundle to `out` (or prints it). Exit 1 when the key has no verified binding. */
export async function repExport(holderInput: string, out: string | undefined, deps: Pick<ManageDeps, 'query'>, chain: ChainChoice): Promise<number> {
  const key = parseHolder(holderInput);
  if ('error' in key) throw new Error(key.error);
  const binding = await lookupByPubkey(key.hex, { query: deps.query });
  if (!binding?.ok) {
    console.error(`no verified binding found for ${toNpub(key.hex)}`);
    return 1;
  }
  const summary = await attestationsOf(key.hex, { query: deps.query }, binding);
  const status: AddressStatus | null = await addressStatus(binding.claims[0]?.address ?? '', binding.pubkey, binding.eventId, chain).catch(() => null);
  const since = summarizeReputation({ attestations: null, receipts: null, chain: status }).anchoredSince;
  const bundle = buildReputationBundle({
    binding,
    credentials: summary.current.map((a) => credentialFrom(a, binding)),
    anchoredSince: since.kind === 'block' ? since.commitment : null,
  });
  const text = `${JSON.stringify(bundle, null, 2)}\n`;
  if (out) {
    writeFileSync(out, text);
    const s = bundle.reputationSummary;
    console.error(`wrote ${out}: ${s.attestations} attestation(s) from ${s.issuers.length} issuer(s)${s.anchoredSince ? `, anchored since block ${s.anchoredSince.height}` : ''}`);
  } else process.stdout.write(text);
  return 0;
}

export const EXCLUSION_TEXT: Record<RepExclusion, string> = {
  credential: 'does not verify',
  self: 'the holder attests itself',
  subject: 'it is about another key',
  old_binding: 'it pins an older binding of the holder',
  duplicate_issuer: 'the same issuer is already counted',
};

const BUNDLE_REASONS: Record<string, string> = {
  shape: 'not a W3C VP 2.0 reputation summary (context, type, credentials, summary)',
  holder: 'the holder is not a did:nostr key',
  binding: 'the named binding does not verify or is not the holder\'s',
  stale_binding: 'a credential carries a newer binding of the holder than the one named',
  count: 'a claimed count differs from the recount',
  anchor: 'the chain does not bind the address since the claimed block',
};

function render(r: BundleCheck, vcs: unknown[]): string {
  if (!r.ok) return `NOT VERIFIED  ${BUNDLE_REASONS[r.reason] ?? r.reason}${r.path ? ` (${r.path})` : ''}${r.count ? `; recount: ${r.count.counted.length} attestation(s)` : ''}`;
  const lines = [
    `VERIFIED  reputation summary of ${toNpub(r.holder)}`,
    `  binding      ${r.binding.eventId}`,
    `  attestations ${r.count.counted.length} counted of ${vcs.length} credential(s), one per issuer`,
    ...r.count.counted.map((c) => `    counted  ${c.issuer} (${c.validFrom})`),
    ...r.count.excluded.map((e) => `    skipped  #${e.index}: ${EXCLUSION_TEXT[e.reason]}${e.problem ? ` (${vcReason(e.problem, e.path)})` : ''}`),
  ];
  if (r.anchor.kind === 'confirmed') lines.push(`  anchor       since block ${r.anchor.height}, confirmed by an agreed chain read`);
  if (r.anchor.kind === 'claimed') lines.push(`  anchor       since block ${r.anchor.height}, claimed (not checked on the chain; add --chain)`);
  lines.push(`  made ${r.created}. Recounted offline; whether a newer binding exists: tambat lookup <npub>`);
  return lines.join('\n');
}

/** Exit 0 when the bundle verifies and its counts match the recount, 1 otherwise. */
export async function repVerify(file: string, json: boolean, chain: ChainChoice | null): Promise<number> {
  const bundle = JSON.parse(readFileSync(file === '-' ? 0 : file, 'utf8')) as Record<string, unknown>;
  let status: AddressStatus | null = null;
  if (chain) {
    const offline = verifyReputationBundle(bundle);
    if (offline.ok) status = await addressStatus(offline.binding.claims[0]?.address ?? '', offline.holder, offline.binding.eventId, chain).catch(() => null);
  }
  const r = verifyReputationBundle(bundle, { chain: status });
  const vcs = Array.isArray(bundle.verifiableCredential) ? bundle.verifiableCredential : [];
  if (json) {
    const shown = r.ok ? { ok: true, holder: r.holder, binding: r.binding.eventId, count: r.count, anchor: r.anchor, created: r.created } : r;
    console.log(JSON.stringify(shown, null, 2));
  } else console.log(render(r, vcs));
  return r.ok ? 0 : 1;
}
