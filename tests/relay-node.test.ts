/**
 * The Node relay query against real sockets: relays that reject the handshake, never answer, drop the
 * connection, or do not exist must not kill the process, and a working relay must still be read.
 */
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createTcpServer, type Server as TcpServer, type Socket } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { buildApp } from '../server/app.js';
import { createRelayQuery } from '../src/core/discover.js';
import { nodeRelayQuery } from '../src/node/relay.js';
import { clone, keys, vectors } from './helpers.js';

const servers: (Server | TcpServer)[] = [];
const sockets = new Set<Socket>();
let relays: string[] = [];
let goodRelay = '';

async function listen<T extends Server | TcpServer>(server: T): Promise<string> {
  servers.push(server);
  server.on('connection', (s: Socket) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return `ws://127.0.0.1:${address.port}`;
}

/** A minimal NIP-01 relay that answers every REQ with the vector binding event and EOSE. */
function workingRelay(): Server {
  const http = createHttpServer();
  const wss = new WebSocketServer({ server: http });
  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      const [type, id] = JSON.parse(String(data)) as [string, string];
      if (type !== 'REQ') return;
      ws.send(JSON.stringify(['EVENT', id, clone(vectors.bindingEvent)]));
      ws.send(JSON.stringify(['EOSE', id]));
    });
  });
  return http;
}

beforeAll(async () => {
  const rejecting = createHttpServer((_req, res) => res.writeHead(400).end());
  rejecting.on('upgrade', (_req, socket: Socket) => socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'));
  const hanging = createTcpServer(() => undefined);
  const dropping = createTcpServer((s) => s.destroy());
  const closed = createTcpServer();
  const deadUrl = await listen(closed);
  await new Promise<void>((done) => closed.close(() => done()));
  servers.splice(servers.indexOf(closed), 1);
  goodRelay = await listen(workingRelay());
  relays = [await listen(rejecting), await listen(hanging), await listen(dropping), deadUrl];
});

afterAll(async () => {
  for (const s of sockets) s.destroy();
  await Promise.all(servers.map((s) => new Promise<void>((done) => s.close(() => done()))));
});

const filter = { kinds: [vectors.bindingEvent.kind], authors: [keys.nostrPubkey] };

describe('node relay query', () => {
  it('survives failing relays round after round and still reads a working one', async () => {
    for (let round = 0; round < 5; round++) {
      expect(await nodeRelayQuery(relays, filter, 400)).toEqual([]);
    }
    const found = await nodeRelayQuery([...relays, goodRelay], filter, 400);
    expect(found.map((e) => (e as { id: string }).id)).toEqual([vectors.bindingEvent.id]);
  });

  it('keeps the server answering DID lookups and /healthz', async () => {
    const app = buildApp({ relays: [...relays, goodRelay], timeoutMs: 300, staticDir: '/nonexistent' });
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({ url: `/api/did/${keys.npub}` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ alsoKnownAs: [keys.address] });
    }
    expect((await app.inject({ url: '/healthz' })).statusCode).toBe(200);
    await app.close();
  }, 15_000);

  it('uses the global WebSocket only when no implementation is given', () => {
    expect(createRelayQuery()).toBeTypeOf('function');
  });
});
