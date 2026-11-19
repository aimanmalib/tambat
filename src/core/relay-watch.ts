/**
 * Which relays answered a lookup, and how fast. The watch wraps the WebSocket class the relay pool uses, so it reports
 * what the real query saw rather than a second probe: a relay that sends EOSE or an event answered; one that refuses
 * the handshake, drops the connection or closes the subscription before answering refused; one that stays silent until
 * the query gives up has no answer.
 */

export type RelayState = 'answered' | 'refused' | 'silent';

export interface RelayStatus {
  relay: string;
  state: RelayState;
  /** Milliseconds from the start of the watch to the first answer or refusal; null when the relay stayed silent. */
  ms: number | null;
}

export interface RelayWatch {
  /** Records an answer or a refusal. An answer is final; a refusal only stands until the relay answers a later query. */
  record(relay: string, state: Exclude<RelayState, 'silent'>): void;
  /** One status per watched relay, in the order given when the watch was made. */
  statuses(): RelayStatus[];
}

/** Relay URLs compare without a trailing slash, since the pool adds one to the URL it opens. */
export function relayKey(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase();
}

export function createRelayWatch(relays: string[], now: () => number = () => Date.now()): RelayWatch {
  const start = now();
  const seen = new Map<string, { state: Exclude<RelayState, 'silent'>; ms: number }>();
  return {
    record(relay, state) {
      const key = relayKey(relay);
      const before = seen.get(key);
      if (before?.state === 'answered' || before?.state === state) return;
      seen.set(key, { state, ms: Math.max(0, Math.round(now() - start)) });
    },
    statuses() {
      return relays.map((relay) => {
        const s = seen.get(relayKey(relay));
        return s ? { relay, state: s.state, ms: s.ms } : { relay, state: 'silent', ms: null };
      });
    },
  };
}

/** How many of the statuses answered. */
export function answeredCount(statuses: RelayStatus[]): number {
  return statuses.filter((s) => s.state === 'answered').length;
}

const ANSWERS = new Set(['EOSE', 'EVENT']);

/** The relay's verdict carried by one message, or null when the message says nothing about the query. */
export function messageVerdict(data: unknown): Exclude<RelayState, 'silent'> | null {
  try {
    const msg: unknown = JSON.parse(String(data));
    if (!Array.isArray(msg)) return null;
    if (ANSWERS.has(String(msg[0]))) return 'answered';
    return msg[0] === 'CLOSED' ? 'refused' : null;
  } catch {
    return null;
  }
}

type Listening = { addEventListener(type: string, listener: (ev: { data?: unknown }) => void): void };

/**
 * A WebSocket class that reports to `watch`. A close the pool asks for itself (its timeout, or tidying up after the
 * answer) is not a refusal; only an error or close the relay causes before it answered is.
 */
export function watchedSocket(Base: typeof WebSocket, watch: RelayWatch): typeof WebSocket {
  return class WatchedSocket extends Base {
    private closing = false;

    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      const relay = String(url);
      let settled = false;
      const self = this as unknown as Listening;
      self.addEventListener('message', (ev) => {
        const verdict = settled ? null : messageVerdict(ev.data);
        if (!verdict) return;
        settled = true;
        watch.record(relay, verdict);
      });
      const refused = () => {
        if (settled || this.closing) return;
        settled = true;
        watch.record(relay, 'refused');
      };
      self.addEventListener('error', refused);
      self.addEventListener('close', refused);
    }

    override close(code?: number, reason?: string): void {
      this.closing = true;
      super.close(code, reason);
    }
  };
}
