/**
 * An open subscription for new identity events, so a binding published while the wall is open joins it without a
 * reload. Events are passed on unverified: the wall verifies every event itself and only counts the ones that fail.
 */
import { AbstractSimplePool } from 'nostr-tools/abstract-pool';
import { config } from '../../src/config';

export function subscribeBindings(
  relays: string[],
  since: number,
  onEvent: (item: unknown) => void,
  websocketImplementation: typeof WebSocket = globalThis.WebSocket,
): () => void {
  const pool = new AbstractSimplePool({ verifyEvent: () => true, maxWaitForConnection: config.nostr.queryTimeoutMs, websocketImplementation });
  const sub = pool.subscribeMany(relays, { kinds: [config.nostr.bindingKind], since }, { onevent: onEvent });
  // The library sends CLOSE once the socket is ready, a step later; closing the sockets in the same step would make
  // that send hit a closing socket and throw. So the subscription closes first and the sockets one step after.
  return () => {
    sub.close();
    setTimeout(() => pool.close(relays), 0);
  };
}
