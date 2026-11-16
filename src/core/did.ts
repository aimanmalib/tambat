/**
 * A did:nostr DID document (W3C Nostr Community Group draft) for a Nostr key, extended with the verified BCH
 * address as a second verification method and a pointer to the binding event that proves it (ADR 0002).
 */
import { neventEncode } from 'nostr-tools/nip19';
import { config, type Network } from '../config.js';
import type { BindingResult } from './verify.js';

export const DID_CONTEXT = [
  'https://www.w3.org/ns/did/v1',
  'https://w3id.org/nostr/context',
  'https://w3id.org/security/suites/secp256k1recovery-2020/v2',
];

/** Multibase base16 ("f") + multicodec secp256k1-pub (0xe7 0x01) + compressed key with the even-y prefix BIP-340 implies. */
const MULTIKEY_PREFIX = 'fe70102';

export interface VerificationMethod {
  id: string;
  type: string;
  controller: string;
  publicKeyMultibase?: string;
  blockchainAccountId?: string;
}

export interface DidDocument {
  '@context': string[];
  id: string;
  type: 'DIDNostr';
  verificationMethod: VerificationMethod[];
  authentication: string[];
  assertionMethod: string[];
  alsoKnownAs?: string[];
  service?: { id: string; type: string; serviceEndpoint: string }[];
}

export const didOf = (pubkeyHex: string): string => `did:nostr:${pubkeyHex}`;

/** CAIP-10 account id: CAIP-2 chain id, then the CashAddr without its prefix (CAIP-10 forbids a colon there). */
export function caip10(address: string, network: Network): string {
  return `${config.did.chains[network]}:${address.slice(address.indexOf(':') + 1)}`;
}

export interface DidOptions {
  network?: Network;
  /** Relays to name in the nevent pointer to the binding event. */
  relays?: string[];
}

/**
 * Builds the document. BCH addresses appear only from a binding that passed every step; a failed or missing
 * binding gives the plain Nostr document.
 */
export function didDocument(pubkeyHex: string, binding: BindingResult | null, options: DidOptions = {}): DidDocument {
  const id = didOf(pubkeyHex);
  const network = options.network ?? config.network;
  const doc: DidDocument = {
    '@context': DID_CONTEXT,
    id,
    type: 'DIDNostr',
    verificationMethod: [
      { id: `${id}#key1`, type: 'Multikey', controller: id, publicKeyMultibase: `${MULTIKEY_PREFIX}${pubkeyHex}` },
    ],
    authentication: [`${id}#key1`],
    assertionMethod: [`${id}#key1`],
  };
  if (!binding?.ok || binding.pubkey !== pubkeyHex) return doc;
  const claims = binding.claims.filter((c) => c.ok);
  claims.forEach((c, i) => {
    const methodId = `${id}#bch${i === 0 ? '' : `-${i + 1}`}`;
    doc.verificationMethod.push({
      id: methodId,
      type: 'EcdsaSecp256k1RecoveryMethod2020',
      controller: id,
      blockchainAccountId: caip10(c.address, network),
    });
    doc.assertionMethod.push(methodId);
  });
  doc.alsoKnownAs = claims.map((c) => c.address);
  const nevent = neventEncode({
    id: binding.eventId,
    author: pubkeyHex,
    kind: config.nostr.bindingKind,
    relays: options.relays ?? config.nostr.relays,
  });
  doc.service = [{ id: `${id}#bch-binding`, type: 'NostrBindingEvent', serviceEndpoint: `nostr:${nevent}` }];
  return doc;
}
