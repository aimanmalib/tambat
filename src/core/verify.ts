/**
 * Independent verification of a binding event. Every check is a named step with a reason, so a person can see
 * exactly why a binding passes or fails. Nothing here trusts a server: inputs are the event and, optionally,
 * the other kind 10011 events the caller fetched for the same author.
 */
import { binToHex, hash160 } from '@bitauth/libauth';
import { config, type Network } from '../config.js';
import { recoverSigner } from './bchmsg.js';
import { claimsOf, type StepName } from './binding.js';
import { parseP2pkhAddress } from './cashaddr.js';
import { eventShapeError, idMatches, plainEvent, signatureValid, toNpub, verificationText, type Event } from './nostr.js';

export type { StepName };

export interface Step {
  name: StepName;
  status: 'pass' | 'fail' | 'skip';
  reason?: string;
}

export interface ClaimResult {
  address: string;
  ok: boolean;
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
}

export interface VerifyOptions {
  network?: Network;
  /**
   * Other kind 10011 events from relays for the same author. When given, the `newest` step checks that no newer
   * event exists (a newer event replaces this one, which is how a claim is revoked). When absent the step is skipped.
   */
  sameAuthorEvents?: Event[];
}

const pass = (name: StepName): Step => ({ name, status: 'pass' });
const fail = (name: StepName, reason: string): Step => ({ name, status: 'fail', reason });
const skip = (name: StepName, reason: string): Step => ({ name, status: 'skip', reason });
const allPass = (steps: Step[]) => steps.every((s) => s.status !== 'fail');

/** NIP-01 replaceable ordering: newer created_at wins, ties go to the lower id. */
export function isNewer(a: Pick<Event, 'created_at' | 'id'>, b: Pick<Event, 'created_at' | 'id'>): boolean {
  return a.created_at > b.created_at || (a.created_at === b.created_at && a.id < b.id);
}

function newestStep(event: Event, others: Event[] | undefined): Step {
  if (!others) return skip('newest', 'no relay results given; run lookup to check for a newer event');
  const newer = others.find(
    (o) => o.pubkey === event.pubkey && o.kind === event.kind && o.id !== event.id && isNewer(o, event) && signatureValid(o),
  );
  return newer ? fail('newest', `replaced by newer event ${newer.id} (created_at ${newer.created_at})`) : pass('newest');
}

/** Checks one BCH claim (address and signature) against the Nostr key that carries it. */
export function verifyClaim(address: string, signature: string, npub: string, nostrPubkey: string, network: Network): ClaimResult {
  const steps: Step[] = [];
  const parsed = parseP2pkhAddress(address);
  const recovered = recoverSigner(verificationText(npub), signature);
  let bchPublicKey: string | undefined;
  if (typeof recovered === 'string') {
    steps.push(fail('bch_sig', recovered));
  } else {
    bchPublicKey = binToHex(recovered.publicKey);
    steps.push(pass('bch_sig'));
  }
  if (typeof parsed === 'string') {
    steps.push(fail('address_match', parsed), fail('network', parsed));
  } else {
    if (typeof recovered === 'string') steps.push(skip('address_match', 'no public key recovered'));
    else if (binToHex(hash160(recovered.publicKey)) === binToHex(parsed.payload)) steps.push(pass('address_match'));
    else steps.push(fail('address_match', `signature was not made by the key of ${parsed.address} for ${npub}`));
    steps.push(
      parsed.prefix === network
        ? pass('network')
        : fail('network', `address is on ${parsed.prefix}, this verifier expects ${network}`),
    );
  }
  if (typeof recovered === 'string') {
    steps.push(skip('key_separation', 'no public key recovered'));
  } else {
    const x = binToHex(recovered.publicKey.slice(1, 33));
    steps.push(
      x === nostrPubkey
        ? fail('key_separation', 'the BCH key and the Nostr key are the same key; use separate keys')
        : pass('key_separation'),
    );
  }
  const result: ClaimResult = { address, ok: allPass(steps), steps };
  if (bchPublicKey) result.bchPublicKey = bchPublicKey;
  return result;
}

/** Runs every verification step on one event. `ok` needs every event step and at least one claim to pass. */
export function verifyBinding(input: unknown, options: VerifyOptions = {}): BindingResult {
  const network = options.network ?? config.network;
  const shape = eventShapeError(input);
  const event = input as Event;
  if (shape) {
    return { ok: false, eventId: '', pubkey: '', npub: '', createdAt: 0, steps: [fail('event_shape', shape)], claims: [] };
  }
  const npub = toNpub(event.pubkey);
  const steps: Step[] = [pass('event_shape')];
  steps.push(
    event.kind === config.nostr.bindingKind
      ? pass('kind')
      : fail('kind', `kind ${event.kind} is not ${config.nostr.bindingKind}`),
  );
  steps.push(idMatches(event) ? pass('event_id') : fail('event_id', 'id does not match the event fields (edited after signing)'));
  steps.push(signatureValid(event) ? pass('nostr_sig') : fail('nostr_sig', 'Schnorr signature does not verify for this pubkey'));
  steps.push(newestStep(event, options.sameAuthorEvents));
  const claims = claimsOf(event).map((c) => verifyClaim(c.address, c.signature, npub, event.pubkey, network));
  const ok = allPass(steps) && claims.length > 0 && claims.every((c) => c.ok);
  return { ok, eventId: event.id, pubkey: event.pubkey, npub, createdAt: event.created_at, steps, claims, event: plainEvent(event) };
}
