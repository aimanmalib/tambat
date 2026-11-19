/** publishEvent against real local sockets: a relay that accepts, one that refuses, and one that never answers. */
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { publishEvent } from '../src/core/publish.js';
import { clone, vectors } from './helpers.js';

const servers: WebSocketServer[] = [];

async function relay(answer: (id: string) => unknown[] | null): Promise<string> {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  servers.push(wss);
  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data)) as [string, { id: string }];
      const reply = msg[0] === 'EVENT' ? answer(msg[1].id) : null;
      if (reply) ws.send(JSON.stringify(reply));
    });
  });
  await new Promise<void>((done) => wss.once('listening', done));
  return `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`;
}

let accepting = '';
let refusing = '';
let silent = '';

beforeAll(async () => {
  accepting = await relay((id) => ['OK', id, true, '']);
  refusing = await relay((id) => ['OK', id, false, 'blocked: not on the allow list']);
  silent = await relay(() => null);
});

afterAll(async () => {
  for (const s of servers) {
    for (const c of s.clients) c.terminate();
    await new Promise<void>((done) => s.close(() => done()));
  }
});

describe('publishEvent', () => {
  it('reports each relay: accepted, refused with its message, or no answer', async () => {
    const relays = [accepting, refusing, silent];
    const outcomes = await publishEvent(clone(vectors.bindingEvent), relays, 600, WebSocket as unknown as typeof globalThis.WebSocket);
    expect(outcomes.map((o) => o.relay)).toEqual(relays);
    expect(outcomes[0]).toMatchObject({ relay: accepting, ok: true });
    expect(outcomes[0]?.ms).toBeLessThan(600);
    expect(outcomes[1]).toMatchObject({ relay: refusing, ok: false });
    expect(outcomes[1]?.ms).toBeGreaterThanOrEqual(0);
    expect(outcomes[1]?.reason).toContain('blocked: not on the allow list');
    expect(outcomes[1]?.noAnswer).toBeUndefined();
    expect(outcomes[2]).toMatchObject({ relay: silent, ok: false, noAnswer: true });
    expect(outcomes[2]?.ms).toBeUndefined();
  });
});
