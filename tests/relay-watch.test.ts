/**
 * Which relays answered a lookup. Pure cases for the watch itself, then real sockets: one relay refuses the handshake
 * with 503, one accepts and stays silent, one closes the subscription, one answers; each must be reported as such.
 */
import { createServer as createHttpServer, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { lookupByPubkey } from '../src/core/discover.js';
import { answeredCount, createRelayWatch, messageVerdict, relayKey } from '../src/core/relay-watch.js';
import { nodeRelayQuery } from '../src/node/relay.js';
import { clone, keys, vectors } from './helpers.js';

describe('relay watch', () => {
  it('lists every relay in order and reads silence as no answer', () => {
    let t = 1000;
    const watch = createRelayWatch(['wss://a.example', 'wss://b.example', 'wss://c.example'], () => t);
    t = 1250;
    watch.record('wss://b.example/', 'answered');
    t = 1400;
    watch.record('wss://a.example', 'refused');
    expect(watch.statuses()).toEqual([
      { relay: 'wss://a.example', state: 'refused', ms: 400 },
      { relay: 'wss://b.example', state: 'answered', ms: 250 },
      { relay: 'wss://c.example', state: 'silent', ms: null },
    ]);
    expect(answeredCount(watch.statuses())).toBe(1);
  });

  it('keeps the first answer and lets a later answer replace a refusal', () => {
    let t = 0;
    const watch = createRelayWatch(['wss://a.example'], () => t);
    t = 10;
    watch.record('wss://a.example', 'refused');
    t = 20;
    watch.record('wss://a.example', 'refused');
    expect(watch.statuses()[0]).toMatchObject({ state: 'refused', ms: 10 });
    t = 30;
    watch.record('wss://a.example', 'answered');
    t = 40;
    watch.record('wss://a.example', 'refused');
    watch.record('wss://a.example', 'answered');
    expect(watch.statuses()[0]).toMatchObject({ state: 'answered', ms: 30 });
  });

  it('reads relay messages', () => {
    expect(messageVerdict('["EOSE","s"]')).toBe('answered');
    expect(messageVerdict('["EVENT","s",{}]')).toBe('answered');
    expect(messageVerdict('["CLOSED","s","blocked: no"]')).toBe('refused');
    expect(messageVerdict('["NOTICE","hello"]')).toBeNull();
    expect(messageVerdict('not json')).toBeNull();
    expect(relayKey(' WSS://Relay.Example/ ')).toBe('wss://relay.example');
  });
});

const servers: Server[] = [];
const sockets = new Set<Socket>();
let answering = '';
let refusing = '';
let silent = '';
let closing = '';

async function listen(server: Server): Promise<string> {
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

/** A relay that answers every REQ with `reply(id)`; null keeps it silent. */
function relay(reply: (id: string) => unknown[][] | null): Server {
  const http = createHttpServer();
  const wss = new WebSocketServer({ server: http });
  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      const [type, id] = JSON.parse(String(data)) as [string, string];
      if (type !== 'REQ') return;
      for (const m of reply(id) ?? []) ws.send(JSON.stringify(m));
    });
  });
  return http;
}

beforeAll(async () => {
  const unavailable = createHttpServer((_req, res) => res.writeHead(503).end());
  unavailable.on('upgrade', (_req, socket: Socket) => socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n'));
  refusing = await listen(unavailable);
  answering = await listen(relay((id) => [['EVENT', id, clone(vectors.bindingEvent)], ['EOSE', id]]));
  silent = await listen(relay(() => null));
  closing = await listen(relay((id) => [['CLOSED', id, 'restricted: not allowed']]));
});

afterAll(async () => {
  for (const s of sockets) s.destroy();
  await Promise.all(servers.map((s) => new Promise<void>((done) => s.close(() => done()))));
});

describe('relay watch over real sockets', () => {
  it('reports a 503 relay as refused, a silent one as no answer and a working one as answered', async () => {
    const relays = [refusing, silent, answering, closing];
    const watch = createRelayWatch(relays);
    const result = await lookupByPubkey(keys.nostrPubkey, { relays, query: nodeRelayQuery, timeoutMs: 600, watch });
    expect(result?.ok).toBe(true);
    // The pool closes the silent socket after the query; that close lands later and must not read as a refusal.
    await new Promise((done) => setTimeout(done, 300));
    const statuses = watch.statuses();
    expect(statuses.map((s) => s.state)).toEqual(['refused', 'silent', 'answered', 'refused']);
    expect(statuses[1]?.ms).toBeNull();
    for (const i of [0, 2, 3]) expect(statuses[i]?.ms).toBeGreaterThanOrEqual(0);
    expect(statuses[2]?.ms).toBeLessThan(600);
  });

  it('counts no relay as answered when every one refuses or stays silent', async () => {
    const relays = [refusing, silent];
    const watch = createRelayWatch(relays);
    expect(await lookupByPubkey(keys.nostrPubkey, { relays, query: nodeRelayQuery, timeoutMs: 400, watch })).toBeNull();
    expect(answeredCount(watch.statuses())).toBe(0);
  });
});
