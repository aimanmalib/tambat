/**
 * Asks each relay for nothing (a REQ with limit 0) and counts the relays that answer. Used by the badge to tell
 * "no relay answered" apart from "relays answered and hold no verified link".
 */
import { config } from '../config.js';
import type { ProbeFn } from './badge.js';

type Socket = Pick<WebSocket, 'send' | 'close'> & {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
};
type SocketClass = new (url: string) => Socket;

const ANSWERS = new Set(['EOSE', 'EVENT', 'CLOSED', 'NOTICE']);

function probeOne(Impl: SocketClass, url: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let ws: Socket | null = null;
    let settled = false;
    const finish = (answered: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        // Already closed.
      }
      resolve(answered);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try {
      ws = new Impl(url);
    } catch {
      finish(false);
      return;
    }
    ws.onopen = () => ws?.send(JSON.stringify(['REQ', 'tambat-probe', { kinds: [config.nostr.bindingKind], limit: 0 }]));
    ws.onmessage = (ev) => {
      try {
        const msg: unknown = JSON.parse(String(ev.data));
        if (Array.isArray(msg) && ANSWERS.has(String(msg[0]))) finish(true);
      } catch {
        // Not a relay message; keep waiting.
      }
    };
    ws.onerror = () => finish(false);
    ws.onclose = () => finish(false);
  });
}

/** A probe over the given WebSocket class; browsers pass nothing and get the global one. */
export function createProbe(Impl?: SocketClass): ProbeFn {
  return async (relays, timeoutMs) => {
    const cls = Impl ?? (globalThis.WebSocket as unknown as SocketClass | undefined);
    if (!cls) return 0;
    const answers = await Promise.all(relays.map((url) => probeOne(cls, url, timeoutMs)));
    return answers.filter(Boolean).length;
  };
}
