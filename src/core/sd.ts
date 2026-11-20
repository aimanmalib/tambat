/**
 * Selective disclosure in the SD-JWT style (ADR 0019, docs/SPEC.md "Selective disclosure"). The holder of a binding
 * issues a W3C VC 2.0 about itself in which each field is only a salted SHA-256 digest (`_sd`). The proof is a Nostr
 * label event signed by the holder's key whose content is the digest of the canonical credential, so no field can be
 * added or removed afterwards. A presentation carries the credential plus the disclosures `[salt, name, value]` the
 * holder chose to reveal; every other field stays a digest. The `bchAddress` disclosure carries the address and the
 * BCH signature over the binding text for the holder's npub, so whoever receives it can also check that one person
 * holds both keys. Not JWT, not zero-knowledge: a revealed value is seen as it is.
 */
import { base64ToBin, binToBase64, sha256, utf8ToBin } from '@bitauth/libauth';
import { finalizeEvent } from 'nostr-tools/pure';
import { config } from '../config.js';
import { claimsOf, fullClaimAddress } from './binding.js';
import { didOf } from './did.js';
import { canonicalize } from './jcs.js';
import { eventShapeError, idMatches, isPubkeyHex, signatureValid, toNpub, type Event } from './nostr.js';
import { VC_CONTEXT } from './vc.js';
import { verifyClaim, type BindingResult } from './verify.js';

export const SD_ALG = 'sha-256';

/** The value of a `bchAddress` disclosure: the address and the BCH signature over the binding text of the holder. */
export interface BchAddressValue {
  address: string;
  signature: string;
}

export interface SdCredential {
  '@context': string[];
  type: string[];
  issuer: string;
  validFrom: string;
  _sd_alg: string;
  credentialSubject: { id: string; _sd: string[] };
  proof: { type: string; proofPurpose: 'assertionMethod'; verificationMethod: string; created: string; event: Event };
}

export interface SdPresentation {
  '@context': string[];
  type: string[];
  holder: string;
  verifiableCredential: [SdCredential];
  disclosures: string[];
}

/**
 * Why a presentation does not verify. `shape`: not a presentation or credential of this type. `issuer`: holder,
 * issuer, subject and proof key are not one key. `proof`: proof fields missing or the event is not a selective
 * disclosure label. `proof_event`: the embedded event does not match its id. `proof_signature`: its signature does not
 * verify. `proof_hash`: it signs another credential. `disclosure_malformed`: not `[salt, name, value]` with a long
 * enough salt and a known field. `disclosure_duplicate`: the same disclosure or field twice. `disclosure_unknown`: its
 * digest is not in `_sd` (a changed value lands here). `bch_signature`: the address value is not signed for the holder.
 */
export type SdProblem =
  | 'shape'
  | 'issuer'
  | 'proof'
  | 'proof_event'
  | 'proof_signature'
  | 'proof_hash'
  | 'disclosure_malformed'
  | 'disclosure_duplicate'
  | 'disclosure_unknown'
  | 'bch_signature';

export interface SdDisclosed {
  name: string;
  value: unknown;
}

export type SdCheck =
  | { ok: true; holder: string; validFrom: string; disclosed: SdDisclosed[]; hidden: number; fields: number }
  | { ok: false; reason: SdProblem; path?: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const isoSeconds = (unix: number): string => new Date(unix * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

export const base64url = (bytes: Uint8Array): string => binToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function fromBase64url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  return base64ToBin(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

/** SHA-256 of the ASCII disclosure text, base64url without padding (the SD-JWT digest rule). */
export const disclosureDigest = (disclosure: string): string => base64url(sha256.hash(utf8ToBin(disclosure)));

/** Digest the proof event signs: SHA-256 of the RFC 8785 text of the credential without its proof. */
export function credentialDigest(credential: Omit<SdCredential, 'proof'> | Record<string, unknown>): string {
  const rest = { ...credential } as Record<string, unknown>;
  delete rest.proof;
  return base64url(sha256.hash(utf8ToBin(canonicalize(rest))));
}

export const makeDisclosure = (salt: string, name: string, value: unknown): string =>
  base64url(utf8ToBin(JSON.stringify([salt, name, value])));

/** The field values a binding gives: the first verified address with its signature, the network, the event and time. */
export function fieldsOf(binding: BindingResult): Record<string, unknown> {
  if (!binding.ok || !binding.event) throw new Error('the binding does not verify');
  const claim = binding.claims.find((c) => c.ok);
  const signed = claim && claimsOf(binding.event).find((c) => fullClaimAddress(c.address, claim.address.split(':')[0]) === claim.address.toLowerCase());
  if (!claim || !signed) throw new Error('the binding has no verified address');
  const all: Record<string, unknown> = {
    bchAddress: { address: claim.address, signature: signed.signature } satisfies BchAddressValue,
    network: claim.address.split(':')[0],
    bindingEvent: binding.eventId,
    boundAt: isoSeconds(binding.createdAt),
  };
  return Object.fromEntries(config.sd.fields.map((f) => [f, all[f]]));
}

export interface IssueInput {
  binding: BindingResult;
  /** The holder's Nostr secret key; it must be the binding's author. */
  secretKey: Uint8Array;
  now?: number;
  random?: (n: number) => Uint8Array;
}

/** Issues the credential with every disclosure. The holder keeps this file and presents parts of it. */
export function issueSd(input: IssueInput): SdPresentation {
  const random = input.random ?? ((n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n)));
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const fields = fieldsOf(input.binding);
  const disclosures = Object.entries(fields).map(([name, value]) => makeDisclosure(base64url(random(config.sd.saltBytes)), name, value));
  const holder = didOf(input.binding.pubkey);
  const validFrom = isoSeconds(now);
  const body = {
    '@context': [VC_CONTEXT],
    type: ['VerifiableCredential', config.sd.credentialType],
    issuer: holder,
    validFrom,
    _sd_alg: SD_ALG,
    credentialSubject: { id: holder, _sd: disclosures.map(disclosureDigest).sort() },
  };
  const event = finalizeEvent(
    {
      kind: config.sd.kind,
      created_at: now,
      tags: [['L', config.sd.namespace], ['l', config.sd.label, config.sd.namespace]],
      content: credentialDigest(body),
    },
    input.secretKey,
  );
  if (event.pubkey !== input.binding.pubkey) throw new Error('the key is not the binding author');
  const credential: SdCredential = {
    ...body,
    proof: { type: config.vc.proofType, proofPurpose: 'assertionMethod', verificationMethod: `${holder}#key1`, created: validFrom, event },
  };
  return presentationOf(credential, disclosures);
}

const presentationOf = (credential: SdCredential, disclosures: string[]): SdPresentation => ({
  '@context': [VC_CONTEXT],
  type: ['VerifiablePresentation', config.sd.presentationType],
  holder: credential.issuer,
  verifiableCredential: [credential],
  disclosures,
});

/** Keeps only the disclosures of the named fields. Unknown names are an error, so a typo never hides a field. */
export function presentSd(issued: SdPresentation, reveal: readonly string[]): SdPresentation {
  const byName = new Map(issued.disclosures.map((d) => [decodeDisclosure(d)?.name, d]));
  for (const name of reveal) if (!byName.has(name)) throw new Error(`no disclosure for field ${name}`);
  return presentationOf(issued.verifiableCredential[0], issued.disclosures.filter((d) => reveal.includes(decodeDisclosure(d)?.name ?? '')));
}

/** Decodes `[salt, name, value]`, or null when the text is not one. */
export function decodeDisclosure(text: string): { salt: string; name: string; value: unknown } | null {
  const bytes = typeof text === 'string' ? fromBase64url(text) : null;
  if (!bytes) return null;
  try {
    const arr: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!Array.isArray(arr) || arr.length !== 3 || typeof arr[0] !== 'string' || typeof arr[1] !== 'string') return null;
    return { salt: arr[0], name: arr[1], value: arr[2] };
  } catch {
    return null;
  }
}

const DIGEST = /^[A-Za-z0-9_-]{43}$/;
const minSalt = (): number => Math.ceil((config.sd.saltBytes * 4) / 3);

function valueProblem(name: string, value: unknown, holderHex: string): SdProblem | null {
  if (name === 'bchAddress') {
    if (!isObject(value) || typeof value.address !== 'string' || typeof value.signature !== 'string') return 'disclosure_malformed';
    return verifyClaim(value.address, value.signature, toNpub(holderHex), holderHex, config.network).ok ? null : 'bch_signature';
  }
  return typeof value === 'string' ? null : 'disclosure_malformed';
}

function credentialProblem(input: Record<string, unknown>, holder: string): { reason: SdProblem; path?: string } | null {
  const vcs = input.verifiableCredential;
  const c: unknown = Array.isArray(vcs) && vcs.length === 1 ? vcs[0] : null;
  if (!isObject(c)) return { reason: 'shape', path: 'verifiableCredential' };
  const ctx = c['@context'];
  const subject = c.credentialSubject;
  if (!Array.isArray(ctx) || ctx[0] !== VC_CONTEXT || !Array.isArray(c.type) || !c.type.includes('VerifiableCredential') || !c.type.includes(config.sd.credentialType) || c._sd_alg !== SD_ALG || !isObject(subject)) {
    return { reason: 'shape', path: 'verifiableCredential[0]' };
  }
  const sd = subject._sd;
  if (!Array.isArray(sd) || sd.length === 0 || !sd.every((d) => typeof d === 'string' && DIGEST.test(d)) || new Set(sd).size !== sd.length) {
    return { reason: 'shape', path: 'credentialSubject._sd' };
  }
  if (c.issuer !== holder || subject.id !== holder) return { reason: 'issuer', path: c.issuer !== holder ? 'issuer' : 'credentialSubject.id' };
  const proof = c.proof;
  if (!isObject(proof) || proof.type !== config.vc.proofType || proof.proofPurpose !== 'assertionMethod' || proof.verificationMethod !== `${holder}#key1` || proof.created !== c.validFrom) {
    return { reason: 'proof', path: 'proof' };
  }
  const event = proof.event;
  if (eventShapeError(event) !== null) return { reason: 'proof_event', path: 'proof.event' };
  const e = event as Event;
  if (!idMatches(e)) return { reason: 'proof_event', path: 'proof.event.id' };
  if (!signatureValid(e)) return { reason: 'proof_signature', path: 'proof.event.sig' };
  if (didOf(e.pubkey) !== holder) return { reason: 'issuer', path: 'proof.event.pubkey' };
  const labelled = e.kind === config.sd.kind && e.tags.some((t) => t[0] === 'L' && t[1] === config.sd.namespace) && e.tags.some((t) => t[0] === 'l' && t[1] === config.sd.label);
  if (!labelled) return { reason: 'proof', path: 'proof.event.tags' };
  if (e.content !== credentialDigest(c)) return { reason: 'proof_hash', path: 'proof.event.content' };
  return null;
}

/** Verifies a presentation offline: the credential and its proof, then each disclosure against `_sd`. */
export function verifySdPresentation(input: unknown): SdCheck {
  if (!isObject(input)) return { ok: false, reason: 'shape' };
  const ctx = input['@context'];
  const type = input.type;
  if (!Array.isArray(ctx) || ctx[0] !== VC_CONTEXT || !Array.isArray(type) || !type.includes('VerifiablePresentation') || !type.includes(config.sd.presentationType)) {
    return { ok: false, reason: 'shape' };
  }
  const holder = typeof input.holder === 'string' ? input.holder : '';
  const holderHex = holder.replace(/^did:nostr:/, '');
  if (!holder.startsWith('did:nostr:') || !isPubkeyHex(holderHex)) return { ok: false, reason: 'shape', path: 'holder' };
  const bad = credentialProblem(input, holder);
  if (bad) return { ok: false, ...bad };
  const credential = (input.verifiableCredential as SdCredential[])[0]!;
  const digests = new Set(credential.credentialSubject._sd);
  const list = input.disclosures;
  if (!Array.isArray(list)) return { ok: false, reason: 'shape', path: 'disclosures' };
  const seen = new Set<string>();
  const names = new Set<string>();
  const disclosed: SdDisclosed[] = [];
  for (const [i, text] of list.entries()) {
    const path = `disclosures[${i}]`;
    const d = decodeDisclosure(text as string);
    if (!d || d.salt.length < minSalt() || !config.sd.fields.includes(d.name)) return { ok: false, reason: 'disclosure_malformed', path };
    if (seen.has(text as string) || names.has(d.name)) return { ok: false, reason: 'disclosure_duplicate', path };
    seen.add(text as string);
    names.add(d.name);
    if (!digests.has(disclosureDigest(text as string))) return { ok: false, reason: 'disclosure_unknown', path };
    const problem = valueProblem(d.name, d.value, holderHex);
    if (problem) return { ok: false, reason: problem, path: `${path}.${d.name}` };
    disclosed.push({ name: d.name, value: d.value });
  }
  const fields = digests.size;
  return { ok: true, holder: holderHex, validFrom: credential.validFrom, disclosed, hidden: fields - disclosed.length, fields };
}

/** File name of a presentation: prefix plus the first 12 hex characters of the proof event id. */
export const sdFileName = (p: SdPresentation): string => `${config.sd.filePrefix}-${p.verifiableCredential[0].proof.event.id.slice(0, 12)}.json`;
