/**
 * Attestations as W3C Verifiable Credentials 2.0 (docs/SPEC.md "Attestations as Verifiable Credentials", ADR 0017).
 * The NIP-32 attestation stays the source of truth; the credential is an export view of it. Its proof carries the two
 * signed Nostr events it was made from (the attestation and the binding it pins), so anyone can check it offline:
 * both signatures, the BCH signature inside the binding, and that every credential field is exactly what those events
 * say (compared as RFC 8785 canonical JSON). No JSON-LD processing and no context download is needed.
 */
import { config } from '../config.js';
import { parseAttestation, type AttestationProblem, type ParsedAttestation } from './attest.js';
import { didOf } from './did.js';
import { canonicalize } from './jcs.js';
import type { Event } from './nostr.js';
import { verifyBinding, type BindingResult } from './verify.js';

export const VC_CONTEXT = 'https://www.w3.org/ns/credentials/v2';

export interface AttestationCredential {
  '@context': string[];
  type: string[];
  issuer: string;
  validFrom: string;
  credentialSubject: {
    id: string;
    bchAddress: string[];
    bindingEvent: string;
    attestationEvent: string;
  };
  proof: {
    type: string;
    proofPurpose: 'assertionMethod';
    verificationMethod: string;
    created: string;
    attestation: Event;
    binding: Event;
  };
}

/**
 * Why a credential does not verify. `shape`: not a credential of this type. `proof`: no proof of the expected type.
 * `attestation_*`: the embedded attestation event fails that check. `binding`: the embedded binding does not verify.
 * `pin`: the attestation does not pin that binding. `issuer`: the issuer is not the attester. `field`: another field
 * differs from what the events say (see `path`).
 */
export type VcProblem = 'shape' | 'proof' | `attestation_${AttestationProblem}` | 'binding' | 'pin' | 'issuer' | 'field';

export type VcCheck =
  | { ok: true; credential: AttestationCredential; attestation: ParsedAttestation; binding: BindingResult }
  | { ok: false; reason: VcProblem; path?: string };

const isoSeconds = (unix: number): string => new Date(unix * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The credential an attestation and the binding it pins imply. Both must already be checked. */
export function credentialFrom(a: ParsedAttestation, binding: BindingResult): AttestationCredential {
  if (!binding.event) throw new Error('the binding result carries no event');
  const issuer = didOf(a.attester);
  const validFrom = isoSeconds(a.event.created_at);
  return {
    '@context': [VC_CONTEXT],
    type: ['VerifiableCredential', config.vc.type],
    issuer,
    validFrom,
    credentialSubject: {
      id: didOf(a.subject),
      bchAddress: binding.claims.filter((c) => c.ok).map((c) => c.address),
      bindingEvent: binding.eventId,
      attestationEvent: a.event.id,
    },
    proof: {
      type: config.vc.proofType,
      proofPurpose: 'assertionMethod',
      verificationMethod: `${issuer}#key1`,
      created: validFrom,
      attestation: a.event,
      binding: binding.event,
    },
  };
}

type Built = { ok: true; credential: AttestationCredential; attestation: ParsedAttestation; binding: BindingResult };

/** Checks both events and builds the credential they imply, or names what is wrong with them. */
export function exportCredential(attestationEvent: unknown, bindingEvent: unknown): Built | { ok: false; reason: VcProblem } {
  const a = parseAttestation(attestationEvent);
  if (typeof a === 'string') return { ok: false, reason: `attestation_${a}` };
  const binding = verifyBinding(bindingEvent);
  if (!binding.ok || !binding.event) return { ok: false, reason: 'binding' };
  if (a.bindingEventId !== binding.eventId || a.subject !== binding.pubkey) return { ok: false, reason: 'pin' };
  return { ok: true, credential: credentialFrom(a, binding), attestation: a, binding };
}

/** The first path at which two JSON values differ, or null when they are the same. */
function firstDifference(got: unknown, want: unknown, path = ''): string | null {
  if (isObject(got) && isObject(want)) {
    for (const k of [...new Set([...Object.keys(want), ...Object.keys(got)])].sort()) {
      const d = firstDifference(got[k], want[k], path ? `${path}.${k}` : k);
      if (d !== null) return d;
    }
    return null;
  }
  if (Array.isArray(got) && Array.isArray(want)) {
    for (let i = 0; i < Math.max(got.length, want.length); i++) {
      const d = firstDifference(got[i], want[i], `${path}[${i}]`);
      if (d !== null) return d;
    }
    return null;
  }
  return canonicalize(got ?? null) === canonicalize(want ?? null) && (got === undefined) === (want === undefined) ? null : path;
}

/** Verifies a credential offline. Nothing is fetched: the proof carries the events. */
export function verifyCredential(input: unknown): VcCheck {
  if (!isObject(input)) return { ok: false, reason: 'shape' };
  const ctx = input['@context'];
  const type = input.type;
  if (!Array.isArray(ctx) || ctx[0] !== VC_CONTEXT || !Array.isArray(type) || !type.includes('VerifiableCredential') || !type.includes(config.vc.type)) {
    return { ok: false, reason: 'shape' };
  }
  const proof = input.proof;
  if (!isObject(proof) || proof.type !== config.vc.proofType) return { ok: false, reason: 'proof' };
  const built = exportCredential(proof.attestation, proof.binding);
  if (!built.ok) return built;
  if (input.issuer !== built.credential.issuer) return { ok: false, reason: 'issuer', path: 'issuer' };
  if (canonicalize(input) !== canonicalize(built.credential)) {
    return { ok: false, reason: 'field', path: firstDifference(input, built.credential) ?? '' };
  }
  return built;
}

/** File name for a downloaded credential: prefix plus the first 12 hex characters of the attestation id. */
export const credentialFileName = (c: AttestationCredential): string =>
  `${config.vc.filePrefix}-${c.credentialSubject.attestationEvent.slice(0, 12)}.json`;
