/**
 * Writes examples/reputation-bundle.json: a portable reputation bundle (docs/SPEC.md "Portable reputation") of the
 * main demo identity, made so that every counting rule shows. It carries the published demo attestation
 * (examples/attestation-vc.json) plus three made here and NOT published: a second issuer (the recovery demo key),
 * the holder vouching for itself, and the second demo key attesting an older binding of the holder. The bundle counts
 * two; the verifier names why each of the other two is skipped. The anchor block comes from an agreed chain read.
 * Reads the demo phrases from state/ (never printed). Usage: npx tsx scripts/make-reputation-example.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { finalizeEvent } from 'nostr-tools/pure';
import { config } from '../src/config.js';
import { addressStatus, electrumServers } from '../src/core/anchor-chain.js';
import { createAttestationEvent, parseAttestation } from '../src/core/attest.js';
import { lookupByPubkey } from '../src/core/discover.js';
import type { Event } from '../src/core/nostr.js';
import { bindingFromKeys, keysFromPhrase, type PhraseKeys } from '../src/core/paytaca.js';
import { buildReputationBundle, summarizeReputation, verifyReputationBundle } from '../src/core/reputation.js';
import { credentialFrom, exportCredential, type AttestationCredential } from '../src/core/vc.js';
import { verifyBinding } from '../src/core/verify.js';
import { readPhrase } from '../src/node/manage.js';
import { nodeRelayQuery } from '../src/node/relay.js';

const demo = (file: string): PhraseKeys => keysFromPhrase(readPhrase(resolve(file)), config.network);
const holder = demo('state/demo-keys.json');
const second = demo('state/demo-keys-2.json');
const recovery = demo('state/demo-keys-recover.json');

const published = JSON.parse(readFileSync('examples/attestation-vc.json', 'utf8')) as AttestationCredential;
const bindingEvent = published.proof.binding;
const binding = verifyBinding(bindingEvent);
if (!binding.ok || binding.pubkey !== holder.nostrPubkey) throw new Error('examples/attestation-vc.json does not carry the demo binding');
const live = await lookupByPubkey(holder.nostrPubkey, { query: nodeRelayQuery });
if (live?.eventId !== binding.eventId) throw new Error(`the relays name another current binding: ${live?.eventId ?? 'none'}`);

const now = Math.floor(Date.now() / 1000);
const attest = (by: PhraseKeys, pinned: Event, at: number): Event =>
  finalizeEvent(createAttestationEvent({ subject: holder.nostrPubkey, bindingEventId: pinned.id, createdAt: at }), by.nostrSecretKey);
const exported = (event: Event, pinned: Event): AttestationCredential => {
  const r = exportCredential(event, pinned);
  if (!r.ok) throw new Error(r.reason);
  return r.credential;
};

const older = bindingFromKeys(holder, bindingEvent.created_at - 3600);
const own = attest(holder, bindingEvent, now);
if (parseAttestation(own) !== 'self') throw new Error('expected the self attestation to be refused');
const credentials = [
  published,
  exported(attest(recovery, bindingEvent, now), bindingEvent),
  credentialFrom({ event: own, attester: holder.nostrPubkey, subject: holder.nostrPubkey, bindingEventId: bindingEvent.id }, binding),
  exported(attest(second, older, older.created_at + 60), older),
];

const status = await addressStatus(binding.claims[0]!.address, binding.pubkey, binding.eventId, electrumServers()).catch(() => null);
const since = summarizeReputation({ attestations: null, receipts: null, chain: status }).anchoredSince;
const bundle = buildReputationBundle({ binding, credentials, anchoredSince: since.kind === 'block' ? since.commitment : null, now });
const check = verifyReputationBundle(JSON.parse(JSON.stringify(bundle)), { chain: status });
if (!check.ok) throw new Error(`the bundle does not verify: ${check.reason}`);
writeFileSync('examples/reputation-bundle.json', `${JSON.stringify(bundle, null, 2)}\n`);
console.log(
  `wrote examples/reputation-bundle.json: ${check.count.counted.length} counted, skipped ${check.count.excluded.map((e) => e.reason).join(', ')}, anchor ${check.anchor.kind}`,
);
