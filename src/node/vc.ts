/**
 * Verifiable Credentials from the command line (ADR 0017). `vc export` turns an attestation into a W3C VC 2.0: the
 * attestation comes from a file or, by event id, from the relays, and so does the binding it pins. `vc verify`
 * checks a credential file offline and names the first thing that is wrong.
 */
import { readFileSync } from 'node:fs';
import { config } from '../config.js';
import { guardedQuery, type QueryFn } from '../core/discover.js';
import { toNpub } from '../core/nostr.js';
import { exportCredential, verifyCredential, type VcProblem } from '../core/vc.js';

const EVENT_ID = /^[0-9a-f]{64}$/;

export const VC_REASONS: Record<string, string> = {
  shape: 'not a W3C VC 2.0 attestation credential (context, type)',
  proof: `no proof of type ${config.vc.proofType}`,
  attestation_shape: 'the embedded attestation is not a Nostr event',
  attestation_event_id: 'the embedded attestation does not match its event id',
  attestation_signature: 'the embedded attestation signature does not verify',
  attestation_not_attestation: 'the embedded event is not an attestation label',
  attestation_no_subject: 'the embedded attestation names no single subject key',
  attestation_no_binding: 'the embedded attestation pins no single binding event',
  attestation_self: 'the embedded attestation attests its own key',
  binding: 'the embedded binding event does not verify',
  pin: 'the attestation does not pin the embedded binding',
  issuer: 'the issuer is not the key that signed the attestation',
  field: 'a field differs from what the signed events say',
};

export const vcReason = (reason: VcProblem, path?: string): string =>
  `${VC_REASONS[reason] ?? reason}${path ? ` (${path})` : ''}`;

const readJson = (file: string): unknown => JSON.parse(readFileSync(file === '-' ? 0 : file, 'utf8'));

async function eventById(id: string, query: QueryFn): Promise<unknown> {
  const found = await guardedQuery(query, config.nostr.relays, { ids: [id] }, config.nostr.queryTimeoutMs);
  return found.find((e) => (e as { id?: unknown }).id === id);
}

/**
 * Prints the credential as JSON. `source` is an attestation event id (read from the relays) or a file; the binding
 * is read from `bindingFile` when given, otherwise fetched from the relays by the id the attestation pins.
 */
export async function vcExport(source: string, bindingFile: string | undefined, query: QueryFn): Promise<number> {
  const attestation = EVENT_ID.test(source) ? await eventById(source, query) : readJson(source);
  if (attestation === undefined) {
    console.error(`no event ${source} on ${config.nostr.relays.join(', ')}`);
    return 1;
  }
  const pinned = ((attestation as { tags?: unknown[][] }).tags ?? []).find((t) => t[0] === 'e')?.[1];
  const binding = bindingFile ? readJson(bindingFile) : typeof pinned === 'string' && EVENT_ID.test(pinned) ? await eventById(pinned, query) : undefined;
  const r = exportCredential(attestation, binding);
  if (!r.ok) {
    console.error(`cannot export: ${vcReason(r.reason)}`);
    return 1;
  }
  console.log(JSON.stringify(r.credential, null, 2));
  return 0;
}

/** Exit 0 when the credential verifies, 1 with the reason when it does not. */
export function vcVerify(file: string, json: boolean): number {
  const r = verifyCredential(readJson(file));
  if (json) console.log(JSON.stringify(r.ok ? { ok: true, issuer: r.credential.issuer, credentialSubject: r.credential.credentialSubject } : r, null, 2));
  else if (r.ok) {
    const s = r.credential.credentialSubject;
    console.log(
      [
        `VERIFIED  credential ${config.vc.type}`,
        `  issuer   ${toNpub(r.attestation.attester)} (${r.credential.issuer})`,
        `  subject  ${toNpub(r.attestation.subject)}`,
        ...s.bchAddress.map((a) => `  address  ${a}`),
        `  binding  ${s.bindingEvent}`,
        `  attestation ${s.attestationEvent} (${r.credential.validFrom})`,
        'Checked offline. Whether that binding is still current: tambat attestations <npub>',
      ].join('\n'),
    );
  } else console.log(`NOT VERIFIED  ${vcReason(r.reason, r.path)}`);
  return r.ok ? 0 : 1;
}
