/** Nostr signers the user can choose. Secret keys never leave the browser; the demo key lives only in memory. */
import { BunkerSigner, parseBunkerInput } from 'nostr-tools/nip46';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { Event, EventTemplate } from '../../src/core/nostr';
import { TextError } from '../../src/errors';

export type NostrSignerKind = 'extension' | 'bunker' | 'demo';

export interface NostrSigner {
  kind: NostrSignerKind;
  pubkey: string;
  sign(template: EventTemplate): Promise<Event>;
}

interface WindowNostr {
  getPublicKey(): Promise<string>;
  signEvent(template: EventTemplate): Promise<Event>;
}

declare global {
  interface Window {
    nostr?: WindowNostr;
  }
}

export const hasExtension = (): boolean => typeof window !== 'undefined' && typeof window.nostr?.signEvent === 'function';

/** NIP-07 browser extension. */
export async function extensionSigner(): Promise<NostrSigner> {
  const ext = window.nostr;
  if (!ext) throw new TextError('errors.noExtension');
  const pubkey = await ext.getPublicKey();
  return { kind: 'extension', pubkey, sign: (t) => ext.signEvent(t) };
}

/** NIP-46 remote signer from a bunker:// address (or a NIP-05 name that points to one). */
export async function bunkerSigner(input: string): Promise<NostrSigner> {
  const pointer = await parseBunkerInput(input.trim());
  if (!pointer) throw new TextError('errors.notBunker');
  const signer = BunkerSigner.fromBunker(generateSecretKey(), pointer);
  await signer.connect();
  const pubkey = await signer.getPublicKey();
  return { kind: 'bunker', pubkey, sign: (t) => signer.signEvent(t) };
}

/** A throwaway key for trying the flow. */
export function demoNostrSigner(): NostrSigner {
  const secret = generateSecretKey();
  return { kind: 'demo', pubkey: getPublicKey(secret), sign: async (t) => finalizeEvent(t, secret) };
}
