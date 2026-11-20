import { useEffect, useRef, useState } from 'react';
import { config } from '../../src/config';
import { electrumServers } from '../../src/core/anchor-chain';
import { answeredCount, createRelayWatch, type RelayStatus } from '../../src/core/relay-watch';
import { addLiveEvent, createWallPool, loadWall, refreshWall, wallFromPool, type Wall, type WallOptions } from '../../src/core/wall';
import { documentVisibility, startRefreshLoop } from './refresh-loop';
import { readAttestationCount } from './strip';
import { subscribeBindings } from './subscribe';

export type WallState =
  | { kind: 'busy' }
  | ({ kind: 'done'; reachable: boolean; relays: RelayStatus[]; attestations: number | null; updatedAt: Date } & Wall);

/** New events from the subscription are verified together after this pause, so a burst rebuilds the wall once. */
const LIVE_BATCH_MS = 500;

/**
 * The wall, kept current: one full read when the page opens, then an open subscription for new identity events and a
 * check of every relay's newest page each `wall.refreshSeconds` while the page is visible.
 */
export function useWallLive(): WallState {
  const [state, setState] = useState<WallState>({ kind: 'busy' });
  const relays = useRef<RelayStatus[]>([]);
  const attestations = useRef<number | null>(null);

  useEffect(() => {
    let live = true;
    const pool = createWallPool();
    const chain = { servers: electrumServers() };
    const show = (wall: Wall, statuses: RelayStatus[]) => {
      if (!live) return;
      relays.current = statuses;
      const empty = wall.entries.length === 0 && wall.hidden === 0;
      const reachable = !empty || answeredCount(statuses) > 0;
      setState({ kind: 'done', reachable, relays: statuses, attestations: attestations.current, updatedAt: new Date(), ...wall });
    };
    /** Shows a finished read, then counts the attestations of what it lists. */
    const settle = async (wall: Wall, statuses: RelayStatus[]) => {
      show(wall, statuses);
      attestations.current = await readAttestationCount(wall.entries).catch(() => null);
      show(wall, statuses);
    };
    /** One read. Only the first shows the wall before the chain answers; a later one keeps the last wall until it is done. */
    const read = async (step: (o: WallOptions) => Promise<Wall>, early: boolean) => {
      const watch = createRelayWatch(config.nostr.relays);
      const options: WallOptions = early ? { watch, chain, onRelays: (w) => show(w, watch.statuses()) } : { watch, chain };
      const wall = await step(options).catch(
        (): Wall => ({ entries: [], hidden: 0, scanned: 0 }),
      );
      await settle(wall, watch.statuses());
    };

    let stopLoop = () => {};
    let unsubscribe = () => {};
    let batch: ReturnType<typeof setTimeout> | null = null;
    const opened = Math.floor(Date.now() / 1000);
    void read((o) => loadWall(o, pool), true).then(() => {
      if (!live) return;
      unsubscribe = subscribeBindings(config.nostr.relays, opened, (item) => {
        if (!addLiveEvent(pool, item) || batch !== null) return;
        batch = setTimeout(() => {
          batch = null;
          void wallFromPool(pool, { chain }).then((w) => settle(w, relays.current));
        }, LIVE_BATCH_MS);
      });
      stopLoop = startRefreshLoop(config.wall.refreshSeconds * 1000, () => read((o) => refreshWall(pool, o), false), documentVisibility);
    });
    return () => {
      live = false;
      stopLoop();
      unsubscribe();
      if (batch !== null) clearTimeout(batch);
    };
  }, []);
  return state;
}
