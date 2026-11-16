/** Publishing a signed event to relays and reporting, per relay, whether it was accepted. */
import { AbstractSimplePool } from 'nostr-tools/abstract-pool';
import { verifyEvent } from 'nostr-tools/pure';
import type { Event } from './nostr.js';

export interface RelayOutcome {
  relay: string;
  ok: boolean;
  /** The relay's message on rejection, or the connection error. Text from the relay, not translated. */
  reason?: string;
  /** Set when the relay did not answer in time, so a user interface can say so in its own language. */
  noAnswer?: boolean;
}

/**
 * Sends the event to every relay and waits for each answer up to the timeout. Never rejects: a relay that is down,
 * refuses the event or stays silent is reported as not ok with its reason.
 */
export async function publishEvent(
  event: Event,
  relays: string[],
  timeoutMs: number,
  websocketImplementation?: typeof WebSocket,
): Promise<RelayOutcome[]> {
  const pool = new AbstractSimplePool({
    verifyEvent,
    maxWaitForConnection: timeoutMs,
    websocketImplementation: websocketImplementation ?? globalThis.WebSocket,
  });
  try {
    const answers = pool.publish(relays, event, { maxWait: timeoutMs });
    const settled = await Promise.allSettled(answers);
    return relays.map((relay, i) => {
      const s = settled[i];
      if (s?.status === 'fulfilled') return { relay, ok: true };
      if (s?.status !== 'rejected') return { relay, ok: false, reason: 'no answer', noAnswer: true };
      const reason = String((s.reason as Error)?.message ?? s.reason);
      return /timed out/.test(reason) ? { relay, ok: false, reason, noAnswer: true } : { relay, ok: false, reason };
    });
  } finally {
    pool.close(relays);
  }
}
