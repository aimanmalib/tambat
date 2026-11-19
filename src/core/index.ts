/**
 * Public entry of the library package (`packages/core`). It exposes the pieces a Nostr client or a wallet needs
 * to write, find and check a BCH binding. Values such as relays and kinds come from the config frozen at build
 * time; `configure()` replaces any of them.
 */
export { config, configure, parseConfig } from '../config.js';
export type { ConfigOverrides, Network, TambatConfig } from '../config.js';

export { VERIFY_STEPS, claimIdentity, claimsOf, createBindingEvent, createRevocationEvent, hasClaim } from './binding.js';
export type { BchClaim, CreateBindingInput, StepName } from './binding.js';
export { REASON_CODES, hasNoCurrentLink, verifyBinding, verifyClaim } from './verify.js';
export type { BindingResult, ClaimResult, ReasonCode, Step, VerifyOptions } from './verify.js';
export { idMatches, parsePubkey, signatureValid, toNpub, verificationText } from './nostr.js';
export type { Event, EventTemplate } from './nostr.js';
export { messageHash, recoverSigner, signMessage } from './bchmsg.js';
export { addressFromPublicKey, parseP2pkhAddress } from './cashaddr.js';
export { createRelayQuery, lookupByAddress, lookupByPubkey, lookupInput } from './discover.js';
export type { DiscoverOptions, QueryFn } from './discover.js';
export { BCH_PATH, NOSTR_PATH, bindingFromKeys, keysFromPhrase } from './paytaca.js';
export type { PhraseKeys } from './paytaca.js';
export { didDocument, didOf } from './did.js';
export { createAttestationEvent, parseAttestation } from './attest.js';
export { exportCredential, verifyCredential } from './vc.js';
export { canonicalize } from './jcs.js';
