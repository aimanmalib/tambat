# Measured

Facts measured on a real run, failures included. Newest first.

## 2026-11-16: server against the default relays

- Before the fix (ADR 0003): `GET /api/did/<npub of the test vector>` against the default relays answered 200 a few times and then
  the process exited with `RangeError: Maximum call stack size exceeded` from the WebSocket error handler. Reproduced on
  in-process sockets: a relay that rejects the handshake ends the process on the first query.
- After the fix: `npm start` on Node 22, `GET /api/did/<npub of the test vector>` 12 times in a row: 12 x HTTP 200, 0.79 to
  0.99 s each. `GET /healthz` afterwards: 200. No error lines in the server log.
