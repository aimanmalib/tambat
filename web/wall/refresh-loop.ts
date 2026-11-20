/**
 * Runs a check every `intervalMs` while the page is visible. A hidden tab is not checked; when it shows again a check
 * that fell due meanwhile runs at once and the interval starts over. A check never overlaps the one before: the next
 * one is timed from the end of the last.
 */

export interface RefreshDeps {
  /** True while the page is hidden (`document.hidden`). */
  hidden: () => boolean;
  /** Calls back when the page is hidden or shown again; returns a function that stops listening. */
  onVisibility: (cb: () => void) => () => void;
  now?: () => number;
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

export function startRefreshLoop(intervalMs: number, check: () => Promise<void>, deps: RefreshDeps): () => void {
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer = deps.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let last = now();
  let timer: unknown = null;
  let running = false;
  let stopped = false;

  const cancel = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const schedule = (ms: number) => {
    cancel();
    if (!stopped && !deps.hidden()) timer = setTimer(run, Math.max(0, ms));
  };
  function run() {
    timer = null;
    if (stopped || running || deps.hidden()) return;
    running = true;
    void check()
      .catch(() => undefined)
      .finally(() => {
        running = false;
        last = now();
        schedule(intervalMs);
      });
  }
  const unlisten = deps.onVisibility(() => {
    if (deps.hidden()) cancel();
    else if (!running) schedule(intervalMs - (now() - last));
  });
  schedule(intervalMs);
  return () => {
    stopped = true;
    cancel();
    unlisten();
  };
}

/** The browser's page visibility, for `startRefreshLoop`. */
export const documentVisibility: RefreshDeps = {
  hidden: () => document.hidden,
  onVisibility: (cb) => {
    document.addEventListener('visibilitychange', cb);
    return () => document.removeEventListener('visibilitychange', cb);
  },
};
