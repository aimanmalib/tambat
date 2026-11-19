import { useEffect, useRef, useState } from 'react';
import { config } from '../../src/config';
import { addressStatus, electrumServers } from '../../src/core/anchor-chain';
import { boundSince, createLimiter, createReadOnce } from '../../src/core/since';
import { useText } from '../i18n';

/** Wall badges share one queue, so a long wall never opens more than `wall.chainConcurrency` chain reads at once. */
const queue = createLimiter(config.wall.chainConcurrency);
/** One read per binding for the life of the page. */
const readOnce = createReadOnce<number | null>();

/**
 * True once the element's parent has come within `wall.sinceRootMargin` of the screen; true at once where the browser
 * cannot tell. The parent is watched because the element itself is empty, so has no size, until there is a badge to show.
 * The margin lets entries just below the fold be read before the reader scrolls to them (docs/decisions/0016).
 */
function useSeen<T extends Element>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin: config.wall.sinceRootMargin },
    );
    observer.observe(el.parentElement ?? el);
    return () => observer.disconnect();
  }, [seen]);
  return { ref, seen };
}

/** The badge itself: nothing until the chain binds the address to this key. */
export function SinceLabel({ height }: { height: number | null }) {
  const { t } = useText();
  if (height === null) return null;
  return <p className="badge badge--anchor" data-since={height}>{t('anchor.badge', { height })}</p>;
}

/**
 * "Anchored since block N" for one wall entry, read from the chain only once the entry is on screen. Any read that is
 * not an agreed `bound` verdict (src/core/since.ts) leaves no badge and no error.
 */
export function SinceBadge({ address, pubkey, eventId }: { address: string; pubkey: string; eventId: string }) {
  const { ref, seen } = useSeen<HTMLSpanElement>();
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    if (!seen) return;
    let live = true;
    void readOnce(`${address} ${pubkey} ${eventId}`, () =>
      queue(() => addressStatus(address, pubkey, eventId, electrumServers())).then(boundSince),
    )
      .then((h) => {
        if (live) setHeight(h);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [seen, address, pubkey, eventId]);
  return (
    <span ref={ref} className="since" data-since-read={seen ? 'yes' : 'no'}>
      <SinceLabel height={height} />
    </span>
  );
}
