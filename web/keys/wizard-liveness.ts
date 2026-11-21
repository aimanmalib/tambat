/**
 * Noticing a WizardConnect wallet that is gone (docs/decisions/0025-wallet-disconnect.md). The library's session
 * manager says `disconnect` only when the wallet sends a Disconnect message; a wallet that closes its app or loses its
 * network goes silent, and the manager then reports its relay link as `reconnecting` (after its own pings go
 * unanswered). The watch ends the session once, when:
 *   (a) the manager reports `disconnect`, at any point of the session (not only before the wallet connected);
 *   (b) the manager reports `reconnecting` after the wallet connected, and the wallet sends nothing within `graceMs`
 *       (a relay blip while the QR code waits is not a wallet leaving).
 * Anything waiting on the wallet (a sign request) is rejected at that moment, so the page does not hang. `stop()` is
 * for the page closing the session itself: it detaches without calling anyone.
 */
import { TextError } from '../../src/errors.js';

/** The event surface of the session manager (an EventEmitter in the WizardConnect library). */
export interface SessionEvents {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  off(event: string, listener: (...args: unknown[]) => void): unknown;
}

export interface SessionWatch {
  /** Called once when the wallet ends the session or stays silent past the grace period. */
  onClose(listener: () => void): void;
  /** Settles like `work`, or rejects with `wizard.disconnected` as soon as the session ends. */
  guard<T>(work: Promise<T>): Promise<T>;
  readonly ended: boolean;
  /** Detaches without ending anything (the page closed the session). */
  stop(): void;
}

export const disconnected = (): TextError => new TextError('wizard.disconnected');

export function watchSession(events: SessionEvents, o: { graceMs: number }): SessionWatch {
  const closeListeners: (() => void)[] = [];
  const waiting = new Set<() => void>();
  let ended = false;
  let stopped = false;
  let connected = false;
  let grace: ReturnType<typeof setTimeout> | undefined;

  const end = () => {
    if (ended || stopped) return;
    ended = true;
    detach();
    for (const reject of waiting) reject();
    waiting.clear();
    for (const l of closeListeners) l();
  };
  /** Any message from the wallet means it is there. */
  const heard = () => {
    connected = true;
    clearTimeout(grace);
    grace = undefined;
  };
  const onReconnecting = () => {
    if (connected && grace === undefined) grace = setTimeout(end, o.graceMs);
  };
  const handlers: [string, () => void][] = [
    ['messagereceived', heard],
    ['walletready', heard],
    ['reconnecting', onReconnecting],
    ['disconnect', end],
  ];
  for (const [e, h] of handlers) events.on(e, h);
  function detach() {
    clearTimeout(grace);
    for (const [e, h] of handlers) events.off(e, h);
  }

  return {
    onClose: (l) => void closeListeners.push(l),
    get ended() {
      return ended;
    },
    guard<T>(work: Promise<T>): Promise<T> {
      if (ended) return Promise.reject(disconnected());
      return new Promise<T>((resolve, reject) => {
        const fail = () => reject(disconnected());
        waiting.add(fail);
        work.then(
          (v) => {
            waiting.delete(fail);
            resolve(v);
          },
          (e: unknown) => {
            waiting.delete(fail);
            reject(ended ? disconnected() : e);
          },
        );
      });
    },
    stop() {
      stopped = true;
      detach();
      waiting.clear();
    },
  };
}
