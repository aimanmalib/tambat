/** A minimal in-memory NIP-01 relay for end-to-end tests: EVENT, REQ (with limit), CLOSE. No network access. */
import type { Page } from '@playwright/test';
import { WebSocket, WebSocketServer } from 'ws';
import { matchFilter, type Filter } from 'nostr-tools/filter';
import { verifyEvent, type Event } from 'nostr-tools/pure';

export function startFakeRelay(port: number, host = '127.0.0.1'): { close: () => Promise<void>; events: Map<string, Event> } {
  const events = new Map<string, Event>();
  const server = new WebSocketServer({ port, host });
  const send = (ws: WebSocket, msg: unknown[]) => ws.send(JSON.stringify(msg));

  server.on('connection', (ws) => {
    ws.on('message', (data) => {
      let msg: unknown[];
      try {
        msg = JSON.parse(String(data)) as unknown[];
      } catch {
        return send(ws, ['NOTICE', 'invalid json']);
      }
      if (msg[0] === 'EVENT') {
        const event = msg[1] as Event;
        const ok = verifyEvent({ ...event });
        if (ok) events.set(event.id, event);
        return send(ws, ['OK', event.id, ok, ok ? '' : 'invalid: bad signature']);
      }
      if (msg[0] === 'REQ') {
        const subId = String(msg[1]);
        for (const filter of msg.slice(2) as Filter[]) {
          const hits = [...events.values()].filter((e) => matchFilter(filter, e)).sort((a, b) => b.created_at - a.created_at);
          for (const e of hits.slice(0, filter.limit ?? hits.length)) send(ws, ['EVENT', subId, e]);
        }
        return send(ws, ['EOSE', subId]);
      }
    });
  });
  // Open page connections would keep the server from closing, so they are ended first.
  const close = () =>
    new Promise<void>((resolve) => {
      for (const client of server.clients) client.terminate();
      server.close(() => resolve());
    });
  return { events, close };
}

/** Sends every wss: connection of the page to the fake relay on `port`. Register chain routes after this so they win. */
export async function routeToRelay(page: Page, port: number) {
  await page.routeWebSocket(/^wss:\/\//, (ws) => {
    const upstream = new WebSocket(`ws://127.0.0.1:${port}`);
    const queue: string[] = [];
    upstream.on('open', () => queue.splice(0).forEach((m) => upstream.send(m)));
    upstream.on('message', (data) => ws.send(String(data)));
    upstream.on('close', () => ws.close());
    upstream.on('error', () => ws.close());
    ws.onMessage((m) => (upstream.readyState === WebSocket.OPEN ? upstream.send(String(m)) : queue.push(String(m))));
    ws.onClose(() => upstream.close());
  });
}
