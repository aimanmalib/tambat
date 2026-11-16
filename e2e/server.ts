/** Test stack: the real app server with its relay lookups pointed at a local fake relay (ports in ports.ts). */
import { buildApp } from '../server/app.js';
import { startFakeRelay } from './fake-relay.js';
import { E2E } from './ports.js';

startFakeRelay(E2E.relayPort);
const app = buildApp({ relays: [E2E.relayUrl], allowedOrigins: [E2E.origin], timeoutMs: 1500 });
await app.listen({ host: '127.0.0.1', port: E2E.port });
console.log(`e2e server on ${E2E.origin}, fake relay on ${E2E.relayUrl}`);
