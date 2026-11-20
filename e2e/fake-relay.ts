/**
 * A minimal in-memory NIP-01 relay for end-to-end tests: EVENT, REQ (with limit), CLOSE. A REQ stays open after EOSE,
 * so an event stored later is sent to every open subscription it matches, as a real relay does. No network access.
 */
import type { Page } from '@playwright/test';
import { WebSocket, WebSocketServer } from 'ws';
import { matchFilter, type Filter } from 'nostr-tools/filter';
import { verifyEvent, type Event } from 'nostr-tools/pure';

export function startFakeRelay(port: number, host = '127.0.0.1'): { close: () => Promise<void>; events: Map<string, Event> } {
  const events = new Map<string, Event>();
  const server = new WebSocketServer({ port, host });
  const send = (ws: WebSocket, msg: unknown[]) => ws.send(JSON.stringify(msg));
  const open = new Map<WebSocket, Map<string, Filter[]>>();
  /** Stores an event and passes it to the open subscriptions it matches. */
  const store = (event: Event) => {
    events.set(event.id, event);
    for (const [ws, subs] of open) {
      for (const [subId, filters] of subs) if (filters.some((f) => matchFilter(f, event))) send(ws, ['EVENT', subId, event]);
    }
  };

  server.on('connection', (ws) => {
    open.set(ws, new Map());
    ws.on('close', () => open.delete(ws));
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
        if (ok) store(event);
        return send(ws, ['OK', event.id, ok, ok ? '' : 'invalid: bad signature']);
      }
      if (msg[0] === 'REQ') {
        const subId = String(msg[1]);
        open.get(ws)?.set(subId, msg.slice(2) as Filter[]);
        for (const filter of msg.slice(2) as Filter[]) {
          const hits = [...events.values()].filter((e) => matchFilter(filter, e)).sort((a, b) => b.created_at - a.created_at);
          for (const e of hits.slice(0, filter.limit ?? hits.length)) send(ws, ['EVENT', subId, e]);
        }
        return send(ws, ['EOSE', subId]);
      }
      if (msg[0] === 'CLOSE') open.get(ws)?.delete(String(msg[1]));
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
