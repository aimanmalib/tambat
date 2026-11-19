/**
 * The "anchored since block N" badge of a binding shown in a list (wall, Pay). It is earned only by an agreed chain read
 * whose verdict is `bound` (src/core/chain-status.ts); revoked, conflicting, unknown or unreachable reads give no badge,
 * and a failed read is never an error: the badge is extra, the binding was already verified from the relays.
 */
import type { AddressStatus } from './anchor-chain.js';

/** The block since which the chain binds the address to the relay binding's key, or null when it does not say so. */
export function boundSince(status: AddressStatus | null): number | null {
  const verdict = status?.verdict;
  if (verdict?.kind !== 'bound' || verdict.since.height <= 0) return null;
  return verdict.since.height;
}

/**
 * Runs at most `max` tasks at once; the rest wait in order. Used so a long list never opens a chain connection per
 * entry at the same time.
 */
export function createLimiter(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  let running = 0;
  const waiting: (() => void)[] = [];
  const next = () => {
    if (running >= max) return;
    const start = waiting.shift();
    if (!start) return;
    running += 1;
    start();
  };
  return <T>(task: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      waiting.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            running -= 1;
            next();
          });
      });
      next();
    });
}
