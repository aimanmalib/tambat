/**
 * Independent verification of a binding event. Every check is a named step with a reason, so a person can see
 * exactly why a binding passes or fails. Nothing here trusts a server: inputs are the event and, optionally,
 * the other kind 10011 events the caller fetched for the same author.
 */
import { binToHex } from '@bitauth/libauth';
import { config, type Network } from '../config.js';
import { recoverSigner } from './bchmsg.js';
import { claimsOf, type StepName } from './binding.js';
import { keyControlsPayload, parseP2pkhAddress } from './cashaddr.js';
import type { RecoveryResult } from './recover.js';
import { eventShapeError, idMatches, plainEvent, signatureValid, toNpub, verificationText, type Event } from './nostr.js';
import { checkTxProof, parseProofs, type ProofForm, type TxLookup } from './tx-proof.js';

export type { StepName };

/** Stable code for why a step failed or was skipped, so a user interface can show the reason in its own language. */
export const REASON_CODES = [
  'event_malformed',
  'wrong_kind',
  'id_mismatch',
  'nostr_sig_invalid',
  'no_relay_results',
  'replaced',
  'signature_unreadable',
  'address_invalid',
  'no_public_key',
  'wrong_signer',
  'wrong_network',
  'same_key',
  'recovery_malformed',
  'recovery_unclaimed',
  'recovery_wrong_signer',
  'old_not_bound',
  'recovery_self',
  'recovery_cycle',
  'tx_not_found',
  'tx_id_mismatch',
  'tx_no_input_from_address',
  'tx_text_mismatch',
  'chain_unreadable',
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

export type ReasonVars = Record<string, string | number>;

export interface Step {
  name: StepName;
  status: 'pass' | 'fail' | 'skip';
  /** English reason for logs, the CLI and the JSON API. */
  reason?: string;
  /** Present whenever `reason` is: the same reason as a code plus the values it mentions. */
  code?: ReasonCode;
  vars?: ReasonVars;
}

export interface ClaimResult {
  address: string;
  ok: boolean;
  /** How the claim proves control of the address: a signed message, or a transaction from it (`tx:<txid>`). */
  proof: ProofForm;
  /** The transaction of an on-chain proof. */
  txid?: string;
  /** Hex public key recovered from the BCH signature, when recovery worked. */
  bchPublicKey?: string;
  steps: Step[];
}

export interface BindingResult {
  ok: boolean;
  /** Id of the verified event; empty when the input was not an event. */
  eventId: string;
  pubkey: string;
  npub: string;
  createdAt: number;
  steps: Step[];
  claims: ClaimResult[];
  /** The checked event (NIP-01 fields only), so callers can show it or keep its other tags. */
  event?: Event;
  /** Present when the event carries a recovery claim: whether this key took over the binding of a lost key. */
  recovery?: RecoveryResult;
  /** Set by an address look-up when another key found for the same address recovered this one: that key's npub. */
  recoveredBy?: string;
}

export interface VerifyOptions {
  network?: Network;
  /**
   * Other kind 10011 events from relays for the same author. When given, the `newest` step checks that no newer
   * event exists (a newer event replaces this one, which is how a claim is revoked). When absent the step is skipped.
   */
  sameAuthorEvents?: Event[];
  /**
   * What the chain said about each txid named by an on-chain proof (`tx:<txid>`), keyed by txid. A proof whose txid is
   * not here was not read: its steps are skipped and the claim does not pass (verify-chain.ts reads them).
   */
  txLookups?: Record<string, TxLookup>;
}

export const pass = (name: StepName): Step => ({ name, status: 'pass' });
const explained = (name: StepName, status: 'fail' | 'skip', code: ReasonCode, reason: string, vars?: ReasonVars): Step =>
  vars ? { name, status, reason, code, vars } : { name, status, reason, code };
export const fail = (name: StepName, code: ReasonCode, reason: string, vars?: ReasonVars): Step =>
  explained(name, 'fail', code, reason, vars);
export const skip = (name: StepName, code: ReasonCode, reason: string): Step => explained(name, 'skip', code, reason);
const allPass = (steps: Step[]) => steps.every((s) => s.status !== 'fail');

/** NIP-01 replaceable ordering: newer created_at wins, ties go to the lower id. */
export function isNewer(a: Pick<Event, 'created_at' | 'id'>, b: Pick<Event, 'created_at' | 'id'>): boolean {
  return a.created_at > b.created_at || (a.created_at === b.created_at && a.id < b.id);
}

function newestStep(event: Event, others: Event[] | undefined): Step {
  if (!others) return skip('newest', 'no_relay_results', 'no relay results given; run lookup to check for a newer event');
  const newer = others.find(
    (o) => o.pubkey === event.pubkey && o.kind === event.kind && o.id !== event.id && isNewer(o, event) && signatureValid(o),
  );
  return newer ? fail('newest', 'replaced', `replaced by newer event ${newer.id} (created_at ${newer.created_at})`, {
        id: newer.id,
        createdAt: newer.created_at,
      }) : pass('newest');
}

/** A claim address as written; a CashAddr without prefix is read on the verifier's network (its checksum covers the prefix). */
export const fullAddress = (address: string, network: Network): string => (address.includes(':') ? address : `${network}:${address}`);

function networkStep(prefix: string, network: Network): Step {
  return prefix === network
    ? pass('network')
    : fail('network', 'wrong_network', `address is on ${prefix}, this verifier expects ${network}`, { prefix, network });
}

function separationStep(publicKey: Uint8Array | undefined, nostrPubkey: string): Step {
  if (!publicKey) return skip('key_separation', 'no_public_key', 'no public key recovered');
  return binToHex(publicKey.slice(1, 33)) === nostrPubkey
    ? fail('key_separation', 'same_key', 'the BCH key and the Nostr key are the same key; use separate keys')
    : pass('key_separation');
}

/** Checks a claim whose proof is a transaction. Every step must pass: a proof the chain was not asked about is not passed. */
function verifyTxClaim(address: string, txid: string, npub: string, nostrPubkey: string, network: Network, lookup?: TxLookup): ClaimResult {
  const steps: Step[] = [];
  const parsed = parseP2pkhAddress(address);
  let publicKey: Uint8Array | undefined;
  const unread = 'the transaction was not read from the chain servers';
  if (!lookup || lookup.kind === 'unread') {
    const servers = lookup?.servers ? [...lookup.servers.differing, ...lookup.servers.unreachable].join(', ') : '';
    steps.push(
      skip('tx_found', 'chain_unreadable', servers ? `${unread} (no agreement: ${servers})` : unread),
      skip('address_match', 'chain_unreadable', unread),
      skip('tx_text', 'chain_unreadable', unread),
    );
  } else if (lookup.kind === 'missing') {
    steps.push(fail('tx_found', 'tx_not_found', `the chain servers do not have transaction ${txid}`, { txid }));
  } else if (typeof parsed === 'string') {
    steps.push(fail('address_match', 'address_invalid', parsed));
  } else {
    const check = checkTxProof(txid, parsed, npub, lookup.evidence);
    if (check.ok) {
      publicKey = check.publicKey;
      steps.push(pass('tx_found'), pass('address_match'), pass('tx_text'));
    } else {
      const order = ['tx_found', 'address_match', 'tx_text'] as const;
      const at = order.indexOf(check.step);
      for (const name of order.slice(0, at)) steps.push(pass(name));
      const vars = check.code === 'tx_no_input_from_address' ? { address: parsed.address } : check.code === 'tx_text_mismatch' ? { npub } : { txid };
      steps.push(fail(check.step, check.code, check.reason, vars));
    }
  }
  steps.push(typeof parsed === 'string' ? fail('network', 'address_invalid', parsed) : networkStep(parsed.prefix, network));
  steps.push(separationStep(publicKey, nostrPubkey));
  const result: ClaimResult = { address, ok: steps.every((s) => s.status === 'pass'), proof: 'tx', txid, steps };
  if (publicKey) result.bchPublicKey = binToHex(publicKey);
  return result;
}

/**
 * Checks one BCH claim (address and proof) against the Nostr key that carries it. The proof is a base64 signed message
 * (optionally written `msg:<signature>`), an on-chain proof `tx:<txid>` or a bare txid, which needs `txLookups` from the
 * chain, or several of these joined by `|`; then every one is checked and all must pass.
 */
export function verifyClaim(address: string, signature: string, npub: string, nostrPubkey: string, network: Network, txLookups?: Record<string, TxLookup>): ClaimResult {
  const full = fullAddress(address.trim(), network);
  return mergeClaims(
    parseProofs(signature).map((proof) =>
      proof.form === 'tx'
        ? verifyTxClaim(full, proof.txid, npub, nostrPubkey, network, txLookups?.[proof.txid])
        : verifyMessageClaim(full, proof.signature, npub, nostrPubkey, network),
    ),
  );
}

const RANK = { pass: 0, skip: 1, fail: 2 } as const;

/**
 * One result for several readings of the same address (proofs joined by `|`, or several `i` tags in different forms).
 * It passes only when every reading passes; a step checked more than once reports its worst outcome.
 */
export function mergeClaims(results: ClaimResult[]): ClaimResult {
  const [first] = results;
  if (!first) throw new Error('no claim to merge');
  if (results.length === 1) return first;
  const steps = new Map<StepName, Step>();
  for (const step of results.flatMap((r) => r.steps)) {
    const seen = steps.get(step.name);
    if (!seen || RANK[step.status] > RANK[seen.status]) steps.set(step.name, step);
  }
  const merged: ClaimResult = {
    address: first.address,
    ok: results.every((r) => r.ok),
    proof: results.some((r) => r.proof === 'message') ? 'message' : 'tx',
    steps: [...steps.values()],
  };
  const txid = results.find((r) => r.txid)?.txid;
  const key = results.find((r) => r.bchPublicKey)?.bchPublicKey;
  if (txid) merged.txid = txid;
  if (key) merged.bchPublicKey = key;
  return merged;
}

function verifyMessageClaim(full: string, signature: string, npub: string, nostrPubkey: string, network: Network): ClaimResult {
  const steps: Step[] = [];
  const parsed = parseP2pkhAddress(full);
  const recovered = recoverSigner(verificationText(npub), signature);
  let bchPublicKey: string | undefined;
  if (typeof recovered === 'string') {
    steps.push(fail('bch_sig', 'signature_unreadable', recovered));
  } else {
    bchPublicKey = binToHex(recovered.publicKey);
    steps.push(pass('bch_sig'));
  }
  if (typeof parsed === 'string') {
    steps.push(fail('address_match', 'address_invalid', parsed), fail('network', 'address_invalid', parsed));
  } else {
    if (typeof recovered === 'string') steps.push(skip('address_match', 'no_public_key', 'no public key recovered'));
    else if (keyControlsPayload(recovered.publicKey, parsed.payload)) steps.push(pass('address_match'));
    else steps.push(fail('address_match', 'wrong_signer', `signature was not made by the key of ${parsed.address} for ${npub}`, {
          address: parsed.address,
          npub,
        }));
    steps.push(networkStep(parsed.prefix, network));
  }
  steps.push(separationStep(typeof recovered === 'string' ? undefined : recovered.publicKey, nostrPubkey));
  const result: ClaimResult = { address: full, ok: allPass(steps), proof: 'message', steps };
  if (bchPublicKey) result.bchPublicKey = bchPublicKey;
  return result;
}

/** Runs every verification step on one event. `ok` needs every event step and at least one claim to pass. */
export function verifyBinding(input: unknown, options: VerifyOptions = {}): BindingResult {
  const network = options.network ?? config.network;
  const shape = eventShapeError(input);
  const event = input as Event;
  if (shape) {
    return { ok: false, eventId: '', pubkey: '', npub: '', createdAt: 0, steps: [fail('event_shape', 'event_malformed', shape)], claims: [] };
  }
  const npub = toNpub(event.pubkey);
  const steps: Step[] = [pass('event_shape')];
  steps.push(
    event.kind === config.nostr.bindingKind
      ? pass('kind')
      : fail('kind', 'wrong_kind', `kind ${event.kind} is not ${config.nostr.bindingKind}`, {
          kind: event.kind,
          expected: config.nostr.bindingKind,
        }),
  );
  steps.push(idMatches(event) ? pass('event_id') : fail('event_id', 'id_mismatch', 'id does not match the event fields (edited after signing)'));
  steps.push(signatureValid(event) ? pass('nostr_sig') : fail('nostr_sig', 'nostr_sig_invalid', 'Schnorr signature does not verify for this pubkey'));
  steps.push(newestStep(event, options.sameAuthorEvents));
  // Tags naming the same address (in different forms, for other verifiers) are one claim, and every tag must pass.
  const byAddress = new Map<string, ClaimResult[]>();
  for (const c of claimsOf(event)) {
    const result = verifyClaim(c.address, c.signature, npub, event.pubkey, network, options.txLookups);
    byAddress.set(result.address.toLowerCase(), [...(byAddress.get(result.address.toLowerCase()) ?? []), result]);
  }
  const claims = [...byAddress.values()].map(mergeClaims);
  const ok = allPass(steps) && claims.length > 0 && claims.every((c) => c.ok);
  return { ok, eventId: event.id, pubkey: event.pubkey, npub, createdAt: event.created_at, steps, claims, event: plainEvent(event) };
}

/** The author's newest event is genuine but carries no BCH claim: the link was revoked or never made. */
export const hasNoCurrentLink = (r: BindingResult): boolean => r.claims.length === 0 && r.steps.every((s) => s.status !== 'fail');
