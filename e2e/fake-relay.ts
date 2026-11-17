/** A minimal in-memory NIP-01 relay for end-to-end tests: EVENT, REQ (with limit), CLOSE. No network access. */
import { WebSocketServer, type WebSocket } from 'ws';
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
