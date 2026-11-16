/**
 * Relay query for Node (server and command line). Node's built-in WebSocket overflows the stack when a relay
 * rejects or drops the handshake and the pool then closes the socket, which kills the process. The `ws`
 * package does not, but it emits an 'error' event after the pool has already removed its handlers (closing a
 * socket that is still connecting), and an 'error' event with no listener is thrown. The subclass below keeps
 * one listener for the lifetime of the socket so such late errors are dropped; the pool still sees every error
 * that arrives while it is listening.
 */
import WebSocket from 'ws';
import { createRelayQuery, type QueryFn } from '../core/discover.js';

class RelaySocket extends WebSocket {
  constructor(address: string | URL, protocols?: string | string[]) {
    super(address, protocols);
    this.on('error', () => undefined);
  }
}

export const nodeRelayQuery: QueryFn = createRelayQuery(RelaySocket as unknown as typeof globalThis.WebSocket);
