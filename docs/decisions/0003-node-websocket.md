# 0003: WebSocket implementation for relay queries on Node

Status: accepted

## Context

The server and the command line query relays with a nostr-tools pool. On Node 22 the pool used the built-in WebSocket
(undici). When a relay rejected or dropped the handshake, the pool's error handler closed the socket, undici reported the
failure again from inside `close()`, and the handler ran again until the stack overflowed. The error is thrown from a socket
event, so no `try` around the query catches it: the process exited. A few lookups of a real npub against the default relays
were enough to stop the server. All server tests used an in-process fake query, so none of them opened a socket.

## Decision

- `createRelayQuery(websocketImplementation)` in `src/core/discover.ts` builds a query on a fresh pool. Browsers call it with no
  argument and use the global WebSocket.
- Node code (`server/app.ts`, `bin/tambat.ts`) uses `nodeRelayQuery` from `src/node/relay.ts`, built on the `ws` package. The
  socket class there keeps one `error` listener for its whole life: closing a socket that is still connecting makes `ws` emit an
  `error` after the pool has removed its handlers, and an `error` event with no listener is thrown.
- Each pool waits for a connection no longer than the query timeout, so a relay that accepts TCP and never answers cannot hold a
  lookup past it.
- `tests/relay-node.test.ts` runs the real query against in-process sockets: a relay that rejects the handshake, one that never
  answers, one that drops the connection, a port with no listener, and a working relay. It then checks that the server still
  answers DID lookups and `/healthz`.

## Consequences

`ws` becomes a direct runtime dependency (it was already installed through WalletConnect). Code in `src/core` stays free of Node
imports so the web app can use it. A future web build must not import `src/node`.
