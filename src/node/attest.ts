/**
 * Attestations from the command line: attest another key's current binding with the Nostr key of a phrase file,
 * or list the attestations of a key that still count. Nothing secret is printed.
 */
import { finalizeEvent } from 'nostr-tools/pure';
import { config } from '../config.js';
import { createAttestationEvent } from '../core/attest.js';
import { attestationsOf } from '../core/attest-find.js';
import { lookupByPubkey } from '../core/discover.js';
import { parsePubkey, toNpub } from '../core/nostr.js';
import { keysFromPhrase } from '../core/paytaca.js';
import type { RelayOutcome } from '../core/publish.js';
import type { ManageDeps } from './manage.js';

export interface PublishedAttestation {
  npub: string;
  id: string;
  subject: string;
  bindingEventId: string;
  outcomes: RelayOutcome[];
}

/**
 * Looks up the subject's current binding on the relays, refuses unless it verifies, then signs an attestation
 * pinned to that event id with the phrase's Nostr key and publishes it.
 */
export async function publishAttestation(phrase: string, subject: string, deps: ManageDeps): Promise<PublishedAttestation> {
  const key = parsePubkey(subject);
  if ('error' in key) throw new Error(key.error);
  const keys = keysFromPhrase(phrase, config.network);
  if (keys.nostrPubkey === key.hex) throw new Error('a key cannot attest its own binding');
  const binding = await lookupByPubkey(key.hex, { query: deps.query });
  if (!binding?.ok) throw new Error(`no verified binding found for ${toNpub(key.hex)}`);
  const now = (deps.now ?? (() => Math.floor(Date.now() / 1000)))();
  const template = createAttestationEvent({ subject: key.hex, bindingEventId: binding.eventId, createdAt: now });
  const event = finalizeEvent(template, keys.nostrSecretKey);
  return { npub: keys.npub, id: event.id, subject: toNpub(key.hex), bindingEventId: binding.eventId, outcomes: await deps.publish(event) };
}

/** Lists the attestations of a key's current binding. Exit 0 only when at least one still counts. */
export async function attestationLookup(subject: string, json: boolean, deps: Pick<ManageDeps, 'query'>): Promise<number> {
  const key = parsePubkey(subject);
  if ('error' in key) throw new Error(key.error);
  const s = await attestationsOf(key.hex, { query: deps.query });
  const current = s.current.map((a) => ({ attester: toNpub(a.attester), eventId: a.event.id, bindingEventId: a.bindingEventId, createdAt: a.event.created_at }));
  if (json) console.log(JSON.stringify({ subject: toNpub(key.hex), bindingEventId: s.binding?.ok ? s.binding.eventId : null, current, replaced: s.replaced }, null, 2));
  else {
    const lines = [`attestations of ${toNpub(key.hex)}`];
    if (!s.binding?.ok) lines.push('  no verified binding on the relays, so no attestation counts');
    for (const a of current) lines.push(`  verified by ${a.attester}\n    attestation ${a.eventId}\n    binding ${a.bindingEventId}`);
    if (s.binding?.ok && current.length === 0) lines.push('  no attestation of the current binding');
    if (s.replaced > 0) lines.push(`  ${s.replaced} attester(s) attested an earlier binding only; those no longer count`);
    console.log(lines.join('\n'));
  }
  return current.length > 0 ? 0 : 1;
}
